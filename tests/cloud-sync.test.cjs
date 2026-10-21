const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const CalculusSync = require('../cloud-sync.js');
const Engine = require('../engine.js');

const courseContext = { window: {} };
vm.runInNewContext(fs.readFileSync(require.resolve('../curriculum.js'), 'utf8'), courseContext);
const curriculum = courseContext.window.CALCULUS_CURRICULUM;
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const firstLesson = curriculum.ranks[0].lessons[0];
const userA = { id: 'student-a' };
const userB = { id: 'student-b' };
const dated = '2026-10-21T08:00:00.000Z';

function error(code, message = code) { return Object.assign(new Error(message), { code }); }
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function stateWithAnswers(count = 0, passed = false) {
  const engine = new Engine(curriculum, null);
  for (let i = 0; i < count; i++) engine.recordAnswer(firstLesson.id, firstLesson.questions[i % 4].id, true);
  if (passed) engine.finishLesson(firstLesson.id, 4, 4);
  engine.state.savedAt = dated;
  return clone(engine.state);
}
function storage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function harness(t) {
  const local = storage();
  const rows = new Map();
  const instances = [];
  const key = (project, userId) => `${project}:${userId}`;
  const seed = (project, user, state, revision = '1') => {
    const row = { userId: user.id, state: clone(state), revision: String(revision), updatedAt: dated };
    rows.set(key(project, user.id), row);
    return clone(row);
  };
  function make({ project = 'classroom', user = userA, store = local } = {}) {
    const calls = [];
    const statuses = [];
    const f = { project, user, calls, statuses, currentUser: user, offline: false, beforeSave: null, beforeLoad: null };
    function check(expectedUserId) {
      if (!f.currentUser || expectedUserId !== f.currentUser.id) throw error('SESSION_CHANGED');
    }
    const cloud = {
      async loadProgress(expectedUserId) {
        calls.push({ method: 'load', expectedUserId });
        check(expectedUserId);
        if (f.beforeLoad) await f.beforeLoad();
        if (f.offline) throw error('NETWORK');
        if (f.loadResult !== undefined) return clone(f.loadResult);
        return clone(rows.get(key(project, expectedUserId)) || null);
      },
      async saveProgress(state, expectedRevision, expectedUserId) {
        const snapshot = clone(state);
        calls.push({ method: 'save', state: snapshot, revision: String(expectedRevision), expectedUserId });
        check(expectedUserId);
        if (f.beforeSave) await f.beforeSave(snapshot, expectedRevision, expectedUserId);
        check(expectedUserId);
        if (f.offline) throw error('NETWORK');
        const current = rows.get(key(project, expectedUserId));
        if (String(current?.revision || '0') !== String(expectedRevision)) throw error('CONFLICT');
        const row = seed(project, f.currentUser, snapshot, String(BigInt(expectedRevision) + 1n));
        return f.saveResult !== undefined ? clone(f.saveResult) : row;
      },
    };
    f.sync = new CalculusSync({ cloud, curriculum, Engine, storage: store, project, onStatus: (status) => statuses.push(clone(status)) });
    f.cloud = cloud;
    f.open = () => f.sync.open(user);
    f.answer = () => f.sync.engine.recordAnswer(firstLesson.id, firstLesson.questions[0].id, true);
    f.saved = () => clone(rows.get(key(project, user.id)) || null);
    f.checkpoint = () => JSON.parse(store.getItem(f.sync.cacheKey) || 'null');
    instances.push(f.sync);
    return f;
  }
  t.after(() => instances.forEach((sync) => sync.stop()));
  return { local, rows, seed, make };
}

test('cloud bootstrap restores actual course completion without rewriting an unchanged record', async (t) => {
  const h = harness(t);
  h.seed('classroom', userA, stateWithAnswers(4, true), '3');
  const f = h.make();
  const engine = await f.open();
  assert.equal(engine.state.xp, 40);
  assert.equal(engine.state.completed[firstLesson.id].stars, 3);
  assert.equal(engine.isUnlocked(curriculum.ranks[0].lessons[1].id), true);
  assert.equal(f.sync.revision, '3');
  assert.equal(f.sync.status, 'synced');
  assert.equal(f.sync.pending, false);
  assert.equal(f.calls.filter((call) => call.method === 'save').length, 0);
});

test('new accounts start empty and first explicit save creates revision one', async (t) => {
  const { make } = harness(t);
  const f = make();
  await f.open();
  assert.equal(f.sync.revision, '0');
  assert.equal(f.sync.engine.state.xp, 0);
  f.answer();
  assert.equal(f.sync.status, 'pending');
  assert.equal(f.checkpoint().pending, true);
  await f.sync.flush();
  assert.equal(f.saved().revision, '1');
  assert.equal(f.saved().state.xp, 10);
  assert.equal(f.checkpoint().pending, false);
});

test('an unsynced checkpoint survives reload and is uploaded with its original base revision', async (t) => {
  const { make } = harness(t);
  const first = make();
  await first.open();
  first.answer();
  first.sync.stop();
  const reopened = make();
  await reopened.open();
  assert.equal(reopened.sync.engine.state.xp, 10);
  assert.equal(reopened.sync.pending, true);
  assert.equal(reopened.sync.status, 'pending');
  await reopened.sync.flush();
  assert.equal(reopened.calls.find((call) => call.method === 'save').revision, '0');
  assert.equal(reopened.saved().state.xp, 10);
});

test('offline failure preserves pending progress and retry reports cloud success only after acknowledgment', async (t) => {
  const { make } = harness(t);
  const f = make();
  await f.open();
  f.answer();
  f.offline = true;
  await assert.rejects(f.sync.flush(), { code: 'NETWORK' });
  assert.equal(f.sync.status, 'error');
  assert.equal(f.sync.pending, true);
  assert.equal(f.checkpoint().pending, true);
  assert.equal(f.saved(), null);
  assert.equal(f.sync.lastSyncedAt, null);
  f.offline = false;
  await f.sync.flush();
  assert.equal(f.sync.status, 'synced');
  assert.equal(f.sync.pending, false);
  assert.equal(f.sync.lastSyncedAt, dated);
  assert.equal(f.saved().state.xp, 10);
});

test('load failure does not replace a pending local checkpoint with an empty state', async (t) => {
  const h = harness(t);
  const first = h.make();
  await first.open();
  first.answer();
  first.sync.stop();
  const before = h.local.getItem(first.sync.cacheKey);
  const reopened = h.make();
  reopened.offline = true;
  await assert.rejects(reopened.open(), { code: 'NETWORK' });
  assert.equal(h.local.getItem(first.sync.cacheKey), before);
  assert.equal(reopened.sync.active, false);
});

test('CAS conflict stops automatic writes and choosing cloud replaces local pending changes', async (t) => {
  const h = harness(t);
  h.seed('classroom', userA, stateWithAnswers(1), '1');
  const f = h.make();
  await f.open();
  f.answer();
  h.seed('classroom', userA, stateWithAnswers(4, true), '2');
  await assert.rejects(f.sync.flush(), { code: 'CONFLICT' });
  assert.equal(f.sync.status, 'conflict');
  const attempted = f.calls.filter((call) => call.method === 'save').length;
  await assert.rejects(f.sync.flush(), { code: 'CONFLICT' });
  assert.equal(f.calls.filter((call) => call.method === 'save').length, attempted);
  await f.sync.useCloud();
  assert.equal(f.sync.engine.state.xp, 40);
  assert.equal(f.sync.revision, '2');
  assert.equal(f.sync.pending, false);
  assert.equal(f.checkpoint().pending, false);
});

test('choosing local after conflict reloads the current revision before an explicit overwrite', async (t) => {
  const h = harness(t);
  h.seed('classroom', userA, stateWithAnswers(1), '1');
  const f = h.make();
  await f.open();
  f.answer();
  h.seed('classroom', userA, stateWithAnswers(4), '2');
  await assert.rejects(f.sync.flush(), { code: 'CONFLICT' });
  await f.sync.keepLocal();
  const saves = f.calls.filter((call) => call.method === 'save');
  assert.deepEqual(saves.map((call) => call.revision), ['1', '2']);
  assert.equal(f.saved().state.xp, 20);
  assert.equal(f.saved().revision, '3');
  assert.equal(f.sync.status, 'synced');
});

test('stale pending data on reload enters conflict without silently overwriting newer remote progress', async (t) => {
  const h = harness(t);
  const first = h.make();
  await first.open();
  first.answer();
  first.sync.stop();
  h.seed('classroom', userA, stateWithAnswers(4), '2');
  const reopened = h.make();
  await reopened.open();
  assert.equal(reopened.sync.status, 'conflict');
  assert.equal(reopened.sync.engine.state.xp, 10);
  await assert.rejects(reopened.sync.flush());
  assert.equal(reopened.calls.some((call) => call.method === 'save'), false);
  assert.equal(reopened.saved().state.xp, 40);
});

test('user and project namespaces keep unsynced browser records separate', async (t) => {
  const { make } = harness(t);
  const a = make();
  await a.open(); a.answer(); a.sync.stop();
  const b = make({ user: userB });
  await b.open();
  assert.equal(b.sync.engine.state.xp, 0);
  b.answer(); b.answer(); b.sync.stop();
  const otherProject = make({ project: 'other-class' });
  await otherProject.open();
  assert.equal(otherProject.sync.engine.state.xp, 0);
  assert.notEqual(a.sync.cacheKey, b.sync.cacheKey);
  assert.notEqual(a.sync.cacheKey, otherProject.sync.cacheKey);
  const aAgain = make();
  await aAgain.open();
  assert.equal(aAgain.sync.engine.state.xp, 10);
  assert.equal(JSON.parse(b.checkpoint().raw).xp, 20);
});

test('load and save pass expected user ID and reject a session that has switched accounts', async (t) => {
  const { make } = harness(t);
  const f = make();
  await f.open();
  f.answer();
  f.currentUser = userB;
  await assert.rejects(f.sync.flush(), { code: 'SESSION_CHANGED' });
  assert.equal(f.saved(), null);
  assert.equal(f.sync.pending, true);
  assert.equal(f.calls.every((call) => call.expectedUserId === userA.id), true);
});

test('a response for another user is never adopted during bootstrap or after a save', async (t) => {
  const h = harness(t);
  const wrongRow = h.seed('classroom', userB, stateWithAnswers(4), '1');
  const loading = h.make();
  loading.loadResult = wrongRow;
  await assert.rejects(loading.open(), { code: 'SESSION_CHANGED' });
  assert.equal(loading.sync.active, false);
  const saving = h.make();
  await saving.open(); saving.answer();
  saving.saveResult = wrongRow;
  await assert.rejects(saving.sync.flush(), { code: 'SESSION_CHANGED' });
  assert.equal(saving.sync.revision, '0');
  assert.equal(saving.sync.pending, true);
});

test('edits made during a save are drained in a second request using the returned revision', async (t) => {
  const { make } = harness(t);
  const f = make();
  await f.open();
  f.answer();
  const gate = deferred();
  let first = true;
  f.beforeSave = () => { if (first) { first = false; return gate.promise; } };
  const flushing = f.sync.flush();
  f.answer();
  gate.resolve();
  await flushing;
  const saves = f.calls.filter((call) => call.method === 'save');
  assert.deepEqual(saves.map((call) => [call.state.xp, call.revision]), [[10, '0'], [20, '1']]);
  assert.equal(f.saved().state.xp, 20);
  assert.equal(f.saved().revision, '2');
  assert.equal(f.sync.pending, false);
});

test('an old tab acknowledgment cannot clear the pending checkpoint written by another tab', async (t) => {
  const { make } = harness(t);
  const a = make(), b = make();
  await a.open(); await b.open();
  a.answer();
  const gate = deferred();
  a.beforeSave = () => gate.promise;
  const flushing = a.sync.flush();
  b.answer(); b.answer(); b.sync.stop();
  const before = b.checkpoint();
  gate.resolve();
  await flushing;
  assert.deepEqual(b.checkpoint(), before);
  assert.equal(b.checkpoint().pending, true);
  assert.equal(JSON.parse(b.checkpoint().raw).xp, 20);
  const reopened = make();
  await reopened.open();
  assert.equal(reopened.sync.engine.state.xp, 20);
  assert.equal(reopened.sync.status, 'conflict');
  assert.equal(reopened.saved().state.xp, 10);
});

test('bootstrap rereads a checkpoint edited by another tab while remote loading is in flight', async (t) => {
  const { make } = harness(t);
  const existing = make(), opening = make();
  await existing.open();
  const gate = deferred();
  opening.beforeLoad = () => gate.promise;
  const loading = opening.open();
  existing.answer(); existing.answer(); existing.sync.stop();
  gate.resolve();
  await loading;
  assert.equal(opening.sync.engine.state.xp, 20);
  assert.equal(opening.sync.pending, true);
  assert.equal(JSON.parse(opening.checkpoint().raw).xp, 20);
});

test('storage failure does not falsely claim a local checkpoint, while cloud save can still succeed', async (t) => {
  const { make } = harness(t);
  const brokenStorage = { getItem: () => null, setItem() { throw Error('quota'); }, removeItem() { throw Error('quota'); } };
  const f = make({ store: brokenStorage });
  await f.open();
  f.answer();
  assert.equal(f.sync.cacheAvailable, false);
  assert.equal(f.sync.pending, true);
  await f.sync.flush();
  assert.equal(f.saved().state.xp, 10);
  assert.equal(f.sync.status, 'synced');
  assert.equal(f.sync.cacheAvailable, false);
});

test('stopped syncing refuses a flush instead of claiming unsaved work is saved', async (t) => {
  const { make } = harness(t);
  const f = make();
  await f.open(); f.answer(); f.sync.stop();
  await assert.rejects(f.sync.flush(), /同步已停止/);
  assert.equal(f.saved(), null);
  assert.equal(f.checkpoint().pending, true);
});

test('reset saves an initial state using the current revision and keeps a failed reset pending', async (t) => {
  const h = harness(t);
  h.seed('classroom', userA, stateWithAnswers(4, true), '3');
  const f = h.make();
  await f.open();
  f.offline = true;
  await assert.rejects(f.sync.reset(), { code: 'NETWORK' });
  assert.equal(f.sync.engine.state.xp, 0);
  assert.equal(f.sync.pending, true);
  assert.equal(JSON.parse(f.checkpoint().raw).xp, 0);
  assert.equal(f.saved().state.xp, 40);
  f.offline = false;
  await f.sync.flush();
  assert.equal(f.saved().state.xp, 0);
  assert.deepEqual(f.saved().state.completed, {});
  assert.equal(f.saved().revision, '4');
  assert.equal(f.sync.pending, false);
});

test('a malformed pending checkpoint does not overwrite a valid cloud record', async (t) => {
  const h = harness(t);
  h.seed('classroom', userA, stateWithAnswers(4, true), '3');
  const cacheKey = 'calculus-account:classroom:student-a:checkpoint';
  h.local.setItem(cacheKey, JSON.stringify({ raw: JSON.stringify({ version: 1, xp: 999 }), revision: '3', pending: true, writer: 'old-tab', generation: 1 }));
  const f = h.make();
  await f.open();
  assert.equal(f.sync.engine.state.xp, 40);
  assert.equal(f.sync.pending, false);
  assert.equal(f.sync.status, 'synced');
  await f.sync.flush();
  assert.equal(f.calls.some((call) => call.method === 'save'), false);
  assert.equal(f.saved().state.xp, 40);
});
