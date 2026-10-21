(function (root) {
  'use strict';

  // Visual acceptance fixture only. The production build allowlist excludes tests/.
  // No fetch, SDK, real accounts, password persistence, or external network is used.
  const PREFIX = 'calculus-browser-preview-fixture:v1:';
  const SESSION_KEY = 'identity';
  const FIXED_TIME = '2026-10-21T00:00:00.000Z';
  const identities = Object.freeze({
    'student@example.test': { id: 'ca1c0100-0000-4000-8000-000000000001', name: '测试学生', teacher: false },
    'teacher@example.test': { id: 'ca1c0100-0000-4000-8000-000000000002', name: '测试教师', teacher: true },
  });
  const clone = (value) => value === null ? null : JSON.parse(JSON.stringify(value));
  class CloudError extends Error {
    constructor(code, message, status = 0) {
      super(message); this.name = 'CloudError'; this.code = code; this.status = status; this.retryable = false;
    }
  }
  const fail = (code, message, status) => new CloudError(code, message, status);
  function userFor(email) {
    const identity = identities[email];
    return identity ? { id: identity.id, email, user_metadata: { display_name: identity.name }, email_confirmed_at: FIXED_TIME } : null;
  }
  function requireTestEmail(email) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!Object.hasOwn(identities, normalized)) {
      throw fail('INVALID_CREDENTIALS', '本地测试仅支持 student@example.test 或 teacher@example.test，请勿填写真实账号。', 400);
    }
    return normalized;
  }
  function requireTestPassword(password, minimum = 1) {
    if (typeof password !== 'string' || password.length < minimum) throw fail('INVALID_PASSWORD', '请输入非真实的测试密码。', 400);
    // Deliberately never persist, log, or send the supplied password.
  }
  function read(suffix, fallback = null) {
    try {
      const raw = root.localStorage.getItem(PREFIX + suffix);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (_) { throw fail('PREVIEW_STORAGE', '本地测试环境无法读取模拟存档，请允许此页面使用本地存储。'); }
  }
  function write(suffix, value) {
    try {
      if (value === null) root.localStorage.removeItem(PREFIX + suffix);
      else root.localStorage.setItem(PREFIX + suffix, JSON.stringify(value));
    } catch (_) { throw fail('PREVIEW_STORAGE', '本地测试环境无法保存模拟数据。'); }
  }
  function currentSession() {
    const email = read(SESSION_KEY);
    const user = typeof email === 'string' && Object.hasOwn(identities, email) ? userFor(email) : null;
    return user ? { user, access_token: 'local-preview-only-not-a-real-token' } : null;
  }
  function deriveRow(state, userId, revision) {
    if (!state || state.version !== 1 || !root.CalculusEngine || !root.CALCULUS_CURRICULUM) throw fail('INVALID_STATE', '模拟进度格式无效。');
    const raw = JSON.stringify(state);
    if (raw.length > 262144) throw fail('INVALID_STATE', '模拟进度过大。');
    let stored = raw;
    const engine = new root.CalculusEngine(root.CALCULUS_CURRICULUM, {
      getItem: () => stored, setItem: (_, value) => { stored = value; }, removeItem: () => { stored = null; },
    });
    const snapshot = clone(engine.state);
    return {
      userId, state: snapshot, revision: String(revision), rankIndex: engine.getRankIndex(),
      completedCount: engine.getStats().completed,
      stars: Object.values(snapshot.completed).reduce((sum, entry) => sum + entry.stars, 0),
      xp: snapshot.xp, updatedAt: new Date().toISOString(),
    };
  }

  class PreviewCloud {
    constructor() {
      this.listeners = new Set();
      this.disposed = false;
      this._storageListener = (event) => {
        if (event.key !== PREFIX + SESSION_KEY) return;
        const session = currentSession();
        this._emit(session ? 'SIGNED_IN' : 'SIGNED_OUT', session);
      };
      root.addEventListener?.('storage', this._storageListener);
    }
    _emit(event, session) {
      const snapshot = clone(session);
      setTimeout(() => {
        if (this.disposed) return;
        for (const listener of this.listeners) {
          try { Promise.resolve(listener(event, clone(snapshot))).catch(() => {}); } catch (_) {}
        }
      }, 0);
    }
    _context(expectedUserId) {
      const session = currentSession();
      if (!session) throw fail('UNAUTHENTICATED', '请先登录本地测试账号。', 401);
      if (expectedUserId !== undefined && expectedUserId !== session.user.id) throw fail('SESSION_CHANGED', '测试账号已切换，请刷新后继续。');
      return session;
    }
    async init() {
      const session = currentSession();
      return { user: session?.user || null, session };
    }
    async getSession() { return currentSession(); }
    async getUser() { return currentSession()?.user || null; }
    async signIn(email, password) {
      const normalized = requireTestEmail(email);
      requireTestPassword(password);
      write(SESSION_KEY, normalized);
      const session = currentSession();
      this._emit('SIGNED_IN', session);
      return { user: session.user, session };
    }
    async signUp(email, password, displayName) {
      const normalized = requireTestEmail(email);
      requireTestPassword(password, 10);
      if (typeof displayName !== 'string' || displayName.trim().length < 2 || displayName.trim().length > 40) throw fail('INVALID_NAME', '测试昵称需要 2 至 40 个字符。');
      return { user: userFor(normalized), session: null, verificationRequired: true, message: '模拟注册成功，请验证邮箱后登录；本地测试不会发送邮件。' };
    }
    async signOut() {
      write(SESSION_KEY, null);
      this._emit('SIGNED_OUT', null);
      return { localSignedOut: true, remoteRevoked: true };
    }
    async resetPassword(email) {
      requireTestEmail(email);
      return { requested: true, simulated: true };
    }
    async updatePassword(password) {
      requireTestPassword(password, 10);
      return this._context().user;
    }
    onAuthChange(listener) {
      if (typeof listener !== 'function') throw new TypeError('listener 必须是函数。');
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
    async loadProgress(expectedUserId) {
      const { user } = this._context(expectedUserId);
      return clone(read('progress:' + user.id));
    }
    async saveProgress(state, expectedRevision, expectedUserId) {
      const { user } = this._context(expectedUserId);
      const previous = read('progress:' + user.id);
      const revision = String(previous?.revision || '0');
      if (!/^(0|[1-9][0-9]*)$/.test(String(expectedRevision))) throw fail('INVALID_REVISION', '模拟存档版本无效。');
      if (String(expectedRevision) !== revision) throw fail('CONFLICT', '模拟云端存档已更新，请重新加载或处理冲突。', 409);
      const row = deriveRow(state, user.id, BigInt(revision) + 1n);
      write('progress:' + user.id, row);
      return clone(row);
    }
    async isTeacher(expectedUserId) {
      const { user } = this._context(expectedUserId);
      return identities[user.email].teacher;
    }
    async listStudents(offset = 0, limit = 100, expectedUserId) {
      const { user } = this._context(expectedUserId);
      if (!identities[user.email].teacher) throw fail('FORBIDDEN', '测试学生账号无权查看教师列表。', 403);
      if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw fail('INVALID_PAGINATION', '模拟列表分页参数无效。');
      const rows = Object.entries(identities).map(([email, identity]) => {
        const record = read('progress:' + identity.id);
        return { userId: identity.id, displayName: identity.name, rankIndex: record?.rankIndex || 0,
          completedCount: record?.completedCount || 0, stars: record?.stars || 0, xp: record?.xp || 0,
          updatedAt: record?.updatedAt || null, createdAt: FIXED_TIME };
      });
      rows.push(
        { userId: 'ca1c0100-0000-4000-8000-000000000003', displayName: '模拟学员 · 黄金', rankIndex: 2, completedCount: 6, stars: 16, xp: 560, updatedAt: FIXED_TIME, createdAt: FIXED_TIME },
        { userId: 'ca1c0100-0000-4000-8000-000000000004', displayName: '模拟学员 · 钻石', rankIndex: 4, completedCount: 12, stars: 34, xp: 1180, updatedAt: FIXED_TIME, createdAt: FIXED_TIME },
        { userId: 'ca1c0100-0000-4000-8000-000000000005', displayName: '模拟学员 · 王者', rankIndex: 6, completedCount: 21, stars: 63, xp: 1680, updatedAt: FIXED_TIME, createdAt: FIXED_TIME },
      );
      return clone(rows.slice(offset, offset + limit));
    }
    dispose() {
      this.disposed = true;
      this.listeners.clear();
      root.removeEventListener?.('storage', this._storageListener);
    }
  }
  PreviewCloud.CloudError = CloudError;
  PreviewCloud.asError = (error) => error;
  root.CalculusCloud = PreviewCloud;
})(typeof globalThis !== 'undefined' ? globalThis : window);
