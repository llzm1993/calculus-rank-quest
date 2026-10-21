const test = require('node:test');
const assert = require('node:assert/strict');
const CalculusCloud = require('../cloud.js');

const userA = { id: 'student-a', email: 'a@example.com' };
const userB = { id: 'student-b', email: 'b@example.com' };
const sessionFor = (user) => user ? { user, access_token: `test-token-${user.id}` } : null;
const progress = (user = userA, revision = 1) => ({
  user_id: user.id, state: { version: 1, xp: 10, completed: {} }, revision,
  rank_index: 0, completed_count: 0, stars: 0, xp: 10, updated_at: '2026-10-21T08:00:00Z',
});
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

function fixture(initialUser = userA) {
  let session = sessionFor(initialUser);
  let authCallback;
  const calls = [];
  const handlers = {};
  const f = { calls, handlers, get session() { return session; } };
  const result = (name, fallback, ...args) => {
    calls.push({ name, args });
    return handlers[name] ? handlers[name](...args) : Promise.resolve(fallback);
  };
  const auth = {
    onAuthStateChange(callback) { authCallback = callback; return { data: { subscription: { unsubscribe() { f.unsubscribed = true; } } } }; },
    getSession: () => result('getSession', { data: { session }, error: null }),
    getUser: (token) => result('getUser', { data: { user: session && session.user }, error: null }, token),
    signUp: (args) => result('signUp', { data: { user: userA, session: null }, error: null }, args),
    signInWithPassword: (args) => result('signIn', { data: { user: userA, session: sessionFor(userA) }, error: null }, args),
    signOut: (args) => result('signOut', { error: null }, args).then((response) => {
      if (!response.error) f.emit('SIGNED_OUT', null);
      return response;
    }),
    resetPasswordForEmail: (email, options) => result('resetPassword', { data: {}, error: null }, email, options),
    updateUser: (args) => result('updatePassword', { data: { user: userA }, error: null }, args),
  };
  f.emit = (event, user) => { session = sessionFor(user); return authCallback(event, session); };
  const builder = (name, fallback, args) => {
    const query = { headers: {}, filters: [], selected: null };
    const api = {
      select(columns) { query.selected = columns; return api; },
      eq(column, value) { query.filters.push([column, value]); return api; },
      maybeSingle() { query.single = true; return api; },
      setHeader(name, value) { query.headers[name] = value; return api; },
      then(resolve, reject) { return result(name, fallback, args, query).then(resolve, reject); },
    };
    return api;
  };
  const client = {
    auth,
    from: (table) => builder('load', { data: null, error: null }, table),
    rpc: (name, args) => builder(name, { data: name === 'calculus_is_teacher' ? false : [progress()], error: null }, args),
  };
  f.cloud = new CalculusCloud({ url: 'https://project.supabase.co', publishableKey: 'sb_publishable_example' }, (...args) => {
    f.factoryArgs = args; return client;
  });
  return f;
}

test('client delegates PKCE and persistent sessions to the official SDK', () => {
  const f = fixture();
  assert.deepEqual(f.factoryArgs[2], { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } });
  assert.throws(() => new CalculusCloud({ url: 'http://evil.example', publishableKey: 'x' }, () => {}), { code: 'NOT_CONFIGURED' });
  assert.throws(() => new CalculusCloud({ url: 'https://project.supabase.co', publishableKey: 'sb_secret_example' }, () => {}), { code: 'NOT_CONFIGURED' });
});

test('registration sends nickname metadata and clean redirect, without creating a profile client-side', async () => {
  const f = fixture(null);
  assert.deepEqual(await f.cloud.signUp(' learner@example.com ', 'long-password', ' 学生小明 ', 'https://school.example/game/?code=old&lesson=1#access_token=bad'), { user: userA, session: null });
  assert.deepEqual(f.calls.find((call) => call.name === 'signUp').args[0], {
    email: 'learner@example.com', password: 'long-password',
    options: { data: { display_name: '学生小明' }, emailRedirectTo: 'https://school.example/game/?lesson=1' },
  });
  assert.equal(f.calls.length, 1);
  await assert.rejects(f.cloud.signUp('a@example.com', 'short', '学生'), { code: 'INVALID_PASSWORD' });
});

test('sign in and password recovery use SDK methods and safe callback URL', async () => {
  const f = fixture();
  const signedIn = await f.cloud.signIn(' a@example.com ', 'pass');
  assert.equal(signedIn.user.id, userA.id);
  await f.cloud.resetPassword('a@example.com', 'https://school.example/game/?code=old#recovery');
  assert.deepEqual(f.calls.find((call) => call.name === 'resetPassword').args, ['a@example.com', { redirectTo: 'https://school.example/game/' }]);
  assert.equal((await f.cloud.updatePassword('updated-password')).id, userA.id);
  assert.deepEqual(f.calls.find((call) => call.name === 'updatePassword').args, [{ password: 'updated-password' }]);
});

test('init validates session against auth server and anonymous initialization succeeds', async () => {
  const f = fixture();
  const result = await f.cloud.init();
  assert.equal(result.user.id, userA.id);
  assert.deepEqual(f.calls.find((call) => call.name === 'getUser').args, [sessionFor(userA).access_token]);
  assert.deepEqual(await fixture(null).cloud.init(), { user: null, session: null });
});

test('load selects only the authenticated account, binds identity, and detaches state', async () => {
  const f = fixture();
  const row = progress();
  f.handlers.load = async () => ({ data: row, error: null });
  const loaded = await f.cloud.loadProgress();
  assert.equal(loaded.revision, '1');
  loaded.state.xp = 900;
  assert.equal(row.state.xp, 10);
  const [, query] = f.calls.find((call) => call.name === 'load').args;
  assert.deepEqual(query.filters, [['user_id', userA.id]]);
  assert.equal(query.headers.Authorization, `Bearer ${sessionFor(userA).access_token}`);
  f.handlers.load = async () => ({ data: progress(userB), error: null });
  await assert.rejects(f.cloud.loadProgress(), { code: 'INVALID_RESPONSE' });
});

test('save uses verified user and CAS RPC without accepting a writable user_id', async () => {
  const f = fixture();
  const state = { xp: 10, completed: {} };
  const saving = f.cloud.saveProgress(state, 0);
  state.xp = 20;
  const saved = await saving;
  assert.equal(saved.revision, '1');
  const call = f.calls.find((call) => call.name === 'calculus_save_progress');
  assert.deepEqual(call.args[0], { p_state: { xp: 10, completed: {} }, p_expected_revision: '0' });
  assert.equal(call.args[1].headers.Authorization, `Bearer ${sessionFor(userA).access_token}`);
  assert.equal(Object.hasOwn(call.args[0], 'user_id'), false);
});

test('signed-out users cannot read or save progress', async () => {
  const f = fixture(null);
  await assert.rejects(f.cloud.loadProgress(), { code: 'UNAUTHENTICATED' });
  await assert.rejects(f.cloud.saveProgress({ xp: 0 }, '0'), { code: 'UNAUTHENTICATED' });
  assert.equal(f.calls.some((call) => call.name === 'load' || call.name === 'calculus_save_progress'), false);
});

test('a stale UI cannot read or save another account by reusing its original owner ID', async () => {
  const f = fixture(userB);
  await f.cloud.init();
  await assert.rejects(f.cloud.loadProgress(userA.id), { code: 'SESSION_CHANGED' });
  await assert.rejects(f.cloud.saveProgress({ xp: 100 }, '0', userA.id), { code: 'SESSION_CHANGED' });
  await assert.rejects(f.cloud.isTeacher(userA.id), { code: 'SESSION_CHANGED' });
  await assert.rejects(f.cloud.listStudents(0, 100, userA.id), { code: 'SESSION_CHANGED' });
  assert.equal(f.calls.some((call) => call.name === 'load' || call.name.startsWith('calculus_')), false);
});

test('matching expected identity is accepted but never forwarded as an RPC owner parameter', async () => {
  const f = fixture();
  f.handlers.calculus_teacher_progress = async () => ({ data: [], error: null });
  assert.equal(await f.cloud.loadProgress(userA.id), null);
  assert.equal((await f.cloud.saveProgress({ xp: 10 }, '0', userA.id)).userId, userA.id);
  assert.equal(await f.cloud.isTeacher(userA.id), false);
  assert.deepEqual(await f.cloud.listStudents(0, 100, userA.id), []);
  assert.deepEqual(f.calls.find((call) => call.name === 'calculus_save_progress').args[0], {
    p_state: { xp: 10 }, p_expected_revision: '0',
  });
  assert.equal(f.calls.find((call) => call.name === 'calculus_is_teacher').args[0], undefined);
  assert.deepEqual(f.calls.find((call) => call.name === 'calculus_teacher_progress').args[0], { p_offset: 0, p_limit: 100 });
});

test('account switch during verification stops a save before sending it', async () => {
  const f = fixture();
  await f.cloud.init();
  f.handlers.getUser = async () => {
    f.emit('SIGNED_IN', userB);
    return { data: { user: userA }, error: null };
  };
  await assert.rejects(f.cloud.saveProgress({ xp: 100 }, '0'), { code: 'SESSION_CHANGED' });
  assert.equal(f.calls.some((call) => call.name === 'calculus_save_progress'), false);
});

test('switching accounts while a request runs discards its old-account response', async () => {
  const f = fixture();
  await f.cloud.init();
  f.handlers.load = async () => {
    f.emit('SIGNED_IN', userB);
    return { data: progress(userA), error: null };
  };
  await assert.rejects(f.cloud.loadProgress(), { code: 'SESSION_CHANGED' });
});

test('a stale anonymous getSession response cannot erase a newly signed-in identity', async () => {
  const f = fixture(null);
  f.handlers.getSession = async () => {
    f.emit('SIGNED_IN', userA);
    return { data: { session: null }, error: null };
  };
  await assert.rejects(f.cloud.init(), { code: 'SESSION_CHANGED' });
  assert.equal(f.cloud.userId, userA.id);
});

test('conflicting revisions reject without retries, and unrelated SQL errors stay distinct', async () => {
  for (const error of [{ code: 'PT409' }, { status: 409 }, { code: 'P0001', message: 'revision conflict' }]) {
    const f = fixture();
    f.handlers.calculus_save_progress = async () => ({ data: null, error });
    await assert.rejects(f.cloud.saveProgress({ xp: 10 }, '4'), { code: 'CONFLICT', retryable: false });
    assert.equal(f.calls.filter((call) => call.name === 'calculus_save_progress').length, 1);
  }
  assert.equal(CalculusCloud.asError({ code: 'P0001', message: 'invalid state' }).code, 'CLOUD_ERROR');
});

test('bigint revisions remain exact and invalid numeric revisions are refused', async () => {
  const f = fixture();
  f.handlers.calculus_save_progress = async () => ({ data: [progress(userA, '9007199254740999')], error: null });
  assert.equal((await f.cloud.saveProgress({ xp: 1 }, '9007199254740998')).revision, '9007199254740999');
  await assert.rejects(f.cloud.saveProgress({}, 9007199254740992), { code: 'INVALID_REVISION' });
  await assert.rejects(f.cloud.saveProgress({}, '-1'), { code: 'INVALID_REVISION' });
});

test('network failure rejects, is retryable, and never leaks provider error details', async () => {
  const f = fixture();
  f.handlers.calculus_save_progress = async () => { throw new TypeError('Failed to fetch SECRET_ACCESS_TOKEN'); };
  await assert.rejects(f.cloud.saveProgress({ xp: 1 }, '0'), (error) => {
    assert.equal(error.code, 'NETWORK');
    assert.equal(error.retryable, true);
    assert.equal(JSON.stringify(error).includes('SECRET_ACCESS_TOKEN'), false);
    assert.equal(error.message.includes('SECRET_ACCESS_TOKEN'), false);
    return true;
  });
});

test('teacher list passes bounded RPC pagination and converts field names', async () => {
  const f = fixture();
  f.handlers.calculus_is_teacher = async () => ({ data: true, error: null });
  f.handlers.calculus_teacher_progress = async () => ({ data: [{ ...progress(), display_name: '小明', created_at: '2026-10-21T00:00:00Z' }], error: null });
  assert.equal(await f.cloud.isTeacher(), true);
  const students = await f.cloud.listStudents(100, 50);
  assert.equal(students[0].displayName, '小明');
  assert.equal(students[0].userId, userA.id);
  assert.deepEqual(f.calls.find((call) => call.name === 'calculus_teacher_progress').args[0], { p_offset: 100, p_limit: 50 });
  await assert.rejects(f.cloud.listStudents(0, 101), { code: 'INVALID_PAGINATION' });
  f.handlers.calculus_teacher_progress = async () => ({ data: null, error: { code: '42501' } });
  await assert.rejects(f.cloud.listStudents(), { code: 'FORBIDDEN' });
});

test('auth callbacks are synchronous at SDK boundary and recovery reaches UI outside the lock', async () => {
  const f = fixture();
  const events = [];
  const unsubscribe = f.cloud.onAuthChange(async (event) => { events.push(event); await f.cloud.getUser(); });
  assert.equal(f.emit('PASSWORD_RECOVERY', userA), undefined);
  assert.equal(events.length, 0);
  await tick();
  assert.deepEqual(events, ['PASSWORD_RECOVERY']);
  unsubscribe();
  f.emit('SIGNED_IN', userA);
  await tick();
  assert.equal(events.length, 1);
  f.cloud.dispose();
  assert.equal(f.unsubscribed, true);
});

test('signOut uses local scope and verifies actual removal', async () => {
  const f = fixture();
  assert.deepEqual(await f.cloud.signOut(), { localSignedOut: true, remoteRevoked: true });
  assert.deepEqual(f.calls.find((call) => call.name === 'signOut').args, [{ scope: 'local' }]);
  const broken = fixture();
  broken.handlers.signOut = async () => ({ error: { message: 'Failed to fetch' } });
  await assert.rejects(broken.cloud.signOut(), { code: 'NETWORK' });
  assert.equal(broken.session.user.id, userA.id);
});

test('offline SDK logout with cleared local session is reported without claiming server revocation', async () => {
  const f = fixture();
  f.handlers.signOut = async () => {
    f.emit('SIGNED_OUT', null);
    return { error: { message: 'Failed to fetch' } };
  };
  assert.deepEqual(await f.cloud.signOut(), { localSignedOut: true, remoteRevoked: false });
});
