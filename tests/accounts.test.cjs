const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../accounts.js'), 'utf8');
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function fixture({ userId = 'student-a', project = 'classroom.supabase.co' } = {}) {
  const f = {
    user: { id: userId },
    app: { innerHTML: '', inert: false },
    handlers: {}, calls: [], lockRequests: [], reloads: 0,
  };
  class Cloud {
    constructor() { f.cloud = this; }
    onAuthChange(listener) { f.calls.push('auth.subscribe'); this.listener = listener; return () => {}; }
    async init() { f.calls.push('auth.init'); return { user: f.user, session: { user: f.user } }; }
    async isTeacher(expectedUserId) { assert.equal(expectedUserId, userId); return false; }
    async signOut() {
      f.calls.push('auth.signOut');
      if (f.handlers.signOut) return f.handlers.signOut();
      return { localSignedOut: true, remoteRevoked: true };
    }
  }
  class Sync {
    constructor(options) {
      f.sync = this;
      this.options = options;
      this.cacheAvailable = true;
      this.active = false;
      this.stopCalls = 0;
    }
    async open(user) { assert.equal(user.id, userId); this.active = true; return { state: {} }; }
    async flush() { f.calls.push('sync.flush'); return f.handlers.flush ? f.handlers.flush() : true; }
    async reset() { f.calls.push('sync.reset'); return f.handlers.reset ? f.handlers.reset() : true; }
    stop() { f.calls.push('sync.stop'); this.stopCalls++; this.active = false; }
  }
  const location = { href: 'https://teacher.github.io/calculus/', reload() { f.reloads++; } };
  const root = {
    CALCULUS_CONFIG: { mode: 'cloud', url: `https://${project}`, publishableKey: 'sb_publishable_test' },
    supabase: { createClient() {} },
    CalculusCloud: Cloud,
    CalculusSync: Sync,
    localStorage: memoryStorage(),
    sessionStorage: memoryStorage(),
    location,
    navigator: {
      locks: {
        request(name, options, callback) {
          f.lockRequests.push({ name, ifAvailable: options.ifAvailable });
          // Keep the granted lock pending just as the browser holds it until
          // this document unloads. A pending Promise creates no Node handles.
          return Promise.resolve().then(() => callback({ name }));
        },
      },
    },
  };
  const document = {
    getElementById(id) {
      assert.equal(id, 'app', 'already-signed-in tests should only need the app shell');
      return f.app;
    },
  };
  vm.runInNewContext(source, { window: root, document, location, URL, setTimeout, clearTimeout });
  f.root = root;
  f.open = () => root.CalculusAccounts.open({ ranks: [] }, class Engine {});
  return f;
}

test('reset holds both input guards until the asynchronous cloud reset finishes', async () => {
  const f = fixture();
  const account = await f.open();
  const gate = deferred();
  f.handlers.reset = () => gate.promise;
  const resetting = account.reset();
  assert.equal(account.transitioning, true);
  assert.equal(f.app.inert, true);
  assert.equal(f.sync.active, true);
  gate.resolve(true);
  assert.equal(await resetting, true);
  assert.equal(account.transitioning, false);
  assert.equal(f.app.inert, false);
  assert.equal(f.sync.stopCalls, 0);
});

test('failed reset restores input guards in finally and keeps synchronization active', async () => {
  const f = fixture();
  const account = await f.open();
  const gate = deferred();
  f.handlers.reset = () => gate.promise;
  const resetting = account.reset();
  assert.equal(account.transitioning, true);
  assert.equal(f.app.inert, true);
  gate.reject(Object.assign(new Error('network unavailable'), { code: 'NETWORK' }));
  await assert.rejects(resetting, { code: 'NETWORK' });
  assert.equal(account.transitioning, false);
  assert.equal(f.app.inert, false);
  assert.equal(f.sync.active, true);
  assert.equal(f.sync.stopCalls, 0);
  assert.equal(f.reloads, 0);
});

test('failed signOut keeps sync active and unlocks input after the cloud logout rejects', async () => {
  const f = fixture();
  const account = await f.open();
  const flushGate = deferred(), logoutGate = deferred(), logoutStarted = deferred();
  f.handlers.flush = () => flushGate.promise;
  f.handlers.signOut = () => { logoutStarted.resolve(); return logoutGate.promise; };
  const signingOut = account.signOut();
  assert.equal(account.transitioning, true);
  assert.equal(f.app.inert, true);
  assert.equal(f.calls.includes('auth.signOut'), false);
  flushGate.resolve(true);
  await logoutStarted.promise;
  assert.equal(f.sync.stopCalls, 0);
  assert.equal(f.sync.active, true);
  assert.equal(f.app.inert, true);
  logoutGate.reject(Object.assign(new Error('logout unavailable'), { code: 'NETWORK' }));
  await assert.rejects(signingOut, { code: 'NETWORK' });
  assert.equal(account.transitioning, false);
  assert.equal(f.app.inert, false);
  assert.equal(f.sync.active, true);
  assert.equal(f.sync.stopCalls, 0);
  assert.equal(f.reloads, 0);
});

test('unsaved work without a local cache blocks logout and restores usable input', async () => {
  const f = fixture();
  const account = await f.open();
  f.sync.cacheAvailable = false;
  f.handlers.flush = async () => { throw Object.assign(new Error('unsaved work'), { code: 'NETWORK' }); };
  await assert.rejects(account.signOut(), { code: 'NETWORK' });
  assert.equal(f.calls.includes('auth.signOut'), false);
  assert.equal(account.transitioning, false);
  assert.equal(f.app.inert, false);
  assert.equal(f.sync.active, true);
  assert.equal(f.sync.stopCalls, 0);
});

test('successful logout flushes before authentication and stops sync only after logout succeeds', async () => {
  const f = fixture();
  const account = await f.open();
  const result = await account.signOut();
  assert.equal(result.localSignedOut, true);
  assert.deepEqual(f.calls.slice(-3), ['sync.flush', 'auth.signOut', 'sync.stop']);
  assert.equal(f.sync.stopCalls, 1);
  assert.equal(f.sync.active, false);
  assert.equal(f.reloads, 1);
});

test('editing locks include both Supabase project hostname and authenticated user ID', async () => {
  const a = fixture();
  const b = fixture({ userId: 'student-b' });
  const otherProject = fixture({ project: 'other-class.supabase.co' });
  await Promise.all([a.open(), b.open(), otherProject.open()]);
  assert.deepEqual(a.lockRequests, [{ name: 'calculus-study:classroom.supabase.co:student-a', ifAvailable: true }]);
  assert.equal(new Set([a, b, otherProject].map((f) => f.lockRequests[0].name)).size, 3);
  assert.equal(a.sync.options.project, 'classroom.supabase.co');
  assert.deepEqual(a.calls.slice(0, 2), ['auth.subscribe', 'auth.init']);
});
