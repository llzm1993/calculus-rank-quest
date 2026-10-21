const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PGlite } = require('@electric-sql/pglite');
const CalculusEngine = require('../engine.js');

const schema = fs.readFileSync(path.join(__dirname, '../supabase/schema.sql'), 'utf8');
const verification = fs.readFileSync(path.join(__dirname, '../supabase/verify.sql'), 'utf8');
const fixtureId = 'ca1c0100-0000-4000-8000-000000000001';

// PGlite runs PostgreSQL locally in memory. Only the Supabase-managed auth schema
// and API roles are fixtures; application SQL, grants, RLS and RPCs are unmodified.
// No network, real accounts, credentials, email, or persistent database is used.
async function withDatabase(run) {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users (
        id uuid primary key, email text, raw_user_meta_data jsonb,
        email_confirmed_at timestamptz, created_at timestamptz, updated_at timestamptz,
        role text, aud text, is_anonymous boolean default false
      );
      create function auth.uid() returns uuid language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
          nullif(current_setting('request.jwt.claims',true),'')::jsonb ->> 'sub')::uuid
      $$;
      grant usage on schema public, auth to anon, authenticated;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    `);
    await db.exec(schema);
    await run(db);
  } finally {
    await db.close();
  }
}

function makeEngine() {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../curriculum.js'), 'utf8'), context);
  const values = new Map();
  return new CalculusEngine(context.window.CALCULUS_CURRICULUM, {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  });
}

test('database: repeatable schema and transactional RLS/CAS/teacher verification', async () => {
  await withDatabase(async (db) => {
    await db.exec(schema);
    await db.exec(verification);
    const { rows: [counts] } = await db.query(`select
      (select count(*)::int from auth.users) as users,
      (select count(*)::int from public.calculus_profiles) as profiles,
      (select count(*)::int from public.calculus_progress) as progress,
      (select count(*)::int from public.calculus_teachers) as teachers`);
    assert.deepEqual(counts, { users: 0, profiles: 0, progress: 0, teachers: 0 }, 'verification must roll back every fixture');
    const { rows: [privileges] } = await db.query(`select
      has_function_privilege('anon','public.calculus_save_progress(jsonb,bigint)','execute') as anonymous_save,
      has_function_privilege('authenticated','public.calculus_save_progress(jsonb,bigint)','execute') as student_save,
      has_function_privilege('service_role','public.calculus_save_progress(jsonb,bigint)','execute') as service_save,
      has_function_privilege('authenticated','public.calculus_validate_state(jsonb)','execute') as private_helper`);
    assert.deepEqual(privileges, { anonymous_save: false, student_save: true, service_save: false, private_helper: false });
  });
});

test('database: every real lesson and answer round-trips; migration preserves existing records', async () => {
  await withDatabase(async (db) => {
    await db.query(`insert into auth.users (id,email_confirmed_at,raw_user_meta_data)
      values ($1,now(),' {"display_name":"验证学员"} '::jsonb)`, [fixtureId]);
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [fixtureId]);
    const engine = makeEngine();
    let revision = 0;
    async function saveAndCompare() {
      const expected = JSON.parse(JSON.stringify(engine.state));
      const { rows: [row] } = await db.query('select * from public.calculus_save_progress($1,$2)', [expected, revision]);
      revision += 1;
      assert.equal(Number(row.revision), revision);
      assert.equal(row.user_id, fixtureId);
      assert.equal(row.rank_index, engine.getRankIndex(), 'server rank must match actual course unlocks');
      assert.equal(row.completed_count, engine.getStats().completed);
      assert.deepEqual(row.state, expected, 'active quiz, answers, settings and activity must survive a save');
    }
    await saveAndCompare();
    for (const lesson of engine.getLessons()) {
      engine.saveSession({
        review: false, lessonId: lesson.id, questionIds: lesson.questions.map((q) => q.id),
        index: 0, selected: null, answers: [], hint: false, view: 'lesson',
      });
      await saveAndCompare();
      engine.saveSession({ ...engine.getSession(), view: 'quiz' });
      await saveAndCompare();
      for (const question of lesson.questions) {
        engine.submitSessionAnswer(question.answer);
        await saveAndCompare();
        engine.advanceSession();
        await saveAndCompare();
      }
    }
    const { rows: [before] } = await db.query('select * from public.calculus_progress');
    assert.deepEqual([before.rank_index, before.completed_count, before.stars, before.xp], [6, 21, 63, 840]);
    await db.exec('reset role');
    await db.query('insert into public.calculus_teachers(user_id) values ($1)', [fixtureId]);
    const { rows: profilesBefore } = await db.query('select * from public.calculus_profiles');
    await db.exec(schema);
    const { rows: [after] } = await db.query('select * from public.calculus_progress');
    const { rows: profilesAfter } = await db.query('select * from public.calculus_profiles');
    assert.deepEqual(after, before, 'rerunning the migration must preserve state and revisions');
    assert.deepEqual(profilesAfter, profilesBefore);
    assert.equal((await db.query('select count(*)::int as n from public.calculus_teachers')).rows[0].n, 1);
  });
});

test('database: malformed, incomplete and oversized states fail validation', async () => {
  await withDatabase(async (db) => {
    const initial = JSON.parse(JSON.stringify(makeEngine().state));
    const invalid = [];
    for (const key of Object.keys(initial).filter((key) => !['savedAt', 'activeSession', 'lastStudyDate'].includes(key))) {
      invalid.push({ ...initial, [key]: null });
    }
    for (const key of Object.keys(initial)) {
      const missing = { ...initial };
      delete missing[key];
      invalid.push(missing);
    }
    invalid.push(
      { ...initial, extra: true },
      { ...initial, version: 2 },
      { ...initial, xp: 1.5 },
      { ...initial, lastStudyDate: '2026-02-30' },
      { ...initial, mistakes: { x: { lessonId: '[', count: 1 } } },
      { ...initial, settings: { sound: null } },
      { ...initial, activity: { '2026-10-21': { answered: 1, correct: 2 } } },
      { ...initial, extra: 'x'.repeat(262145) },
    );
    for (const state of invalid) {
      await assert.rejects(db.query('select public.calculus_validate_state($1)', [state]), { code: '22023' });
    }
  });
});
