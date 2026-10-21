(function (root) {
  'use strict';

  // Supabase owns passwords, session persistence, refresh and PKCE. This module
  // only adapts its public API; it never writes credentials to game storage.
  class CloudError extends Error {
    constructor(code, message, status = 0, retryable = false) {
      super(message);
      this.name = 'CloudError';
      this.code = code;
      this.status = status;
      this.retryable = retryable;
    }
  }

  const fail = (code, message, status, retryable) => new CloudError(code, message, status, retryable);
  const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const safeCount = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const noSession = (error) => error && (error.code === 'session_not_found' || error.name === 'AuthSessionMissingError');

  function asError(error, status = 0) {
    if (error instanceof CloudError) return error;
    const code = String(error && error.code || '');
    const message = String(error && error.message || '');
    const http = Number(error && error.status || status || 0);
    if (code === 'PT409' || http === 409 || (code === 'P0001' && /revision|conflict|stale|版本|冲突/i.test(message))) {
      return fail('CONFLICT', '云端进度已在另一处更新，请先加载最新进度后再保存。', 409);
    }
    if (code === 'invalid_credentials') return fail('INVALID_CREDENTIALS', '邮箱或密码不正确。', http);
    if (code === 'email_not_confirmed') return fail('EMAIL_UNCONFIRMED', '请先在注册邮箱中确认邮件，再登录。', http);
    if (code === 'weak_password') return fail('WEAK_PASSWORD', '密码强度不足，请使用更长且包含多种字符的密码。', http);
    if (code === 'same_password') return fail('SAME_PASSWORD', '新密码不能与原密码相同。', http);
    if (code === 'user_already_exists' || code === 'email_exists') return fail('ACCOUNT_EXISTS', '此邮箱无法再次注册，请尝试登录或找回密码。', http);
    if (code === 'email_address_invalid' || code === 'validation_failed') return fail('INVALID_INPUT', '填写的信息不符合要求，请检查后重试。', http);
    if (http === 429 || /rate_limit|over_email_send_rate_limit|over_request_rate_limit/.test(code)) {
      return fail('RATE_LIMIT', '操作过于频繁，请稍后再试。', http || 429, true);
    }
    if (noSession(error) || http === 401 || code === 'PGRST301' || code === 'PT401') {
      return fail('UNAUTHENTICATED', '登录已失效，请重新登录后继续。', 401);
    }
    if (http === 403 || code === '42501' || code === 'PT403') return fail('FORBIDDEN', '当前账号没有执行此操作的权限。', 403);
    if (code === '42P01' || code === 'PGRST202' || code === 'PGRST205') {
      return fail('SETUP_REQUIRED', '云端数据表尚未配置，请联系老师完成部署。', http);
    }
    if (http >= 500) return fail('UNAVAILABLE', '云端服务暂时不可用，请稍后重试。', http, true);
    if ((error && error.name === 'AuthRetryableFetchError') || /fetch|network|网络|timeout|timed out|Load failed/i.test(message)) {
      return fail('NETWORK', '网络连接失败，尚未同步到云端，请联网后重试。', http, true);
    }
    // Do not expose raw provider messages, request bodies or tokens to the UI.
    return fail('CLOUD_ERROR', '操作未完成，请稍后重试。', http);
  }

  function revision(value) {
    if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) {
      throw fail('INVALID_REVISION', '进度版本无效，请重新加载云端进度。');
    }
    const result = String(value);
    if (!/^(0|[1-9][0-9]*)$/.test(result) || BigInt(result) > 9223372036854775807n) {
      throw fail('INVALID_REVISION', '进度版本无效，请重新加载云端进度。');
    }
    return result;
  }

  function emailValue(email) {
    const value = typeof email === 'string' ? email.trim() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 254) throw fail('INVALID_EMAIL', '请输入有效的邮箱地址。');
    return value;
  }

  function passwordValue(password, creating) {
    if (typeof password !== 'string' || password.length < (creating ? 8 : 1) || password.length > 256) {
      throw fail('INVALID_PASSWORD', creating ? '密码需要 8 至 256 个字符。' : '请输入密码。');
    }
    return password;
  }

  function redirectValue(value) {
    const target = value === undefined && root.location ? root.location.href : value;
    if (!target) return undefined;
    let url;
    try { url = new URL(target); } catch (_) { throw fail('INVALID_REDIRECT', '账户回调网址无效。'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw fail('INVALID_REDIRECT', '账户回调网址无效。');
    url.hash = '';
    ['code', 'error', 'error_code', 'error_description', 'token_hash', 'type', 'access_token', 'refresh_token'].forEach((key) => url.searchParams.delete(key));
    return url.href;
  }

  function progressRow(row, expectedUserId) {
    if (!isObject(row) || row.user_id !== expectedUserId || !isObject(row.state)) {
      throw fail('INVALID_RESPONSE', '云端返回的进度不完整，请重新加载。');
    }
    return {
      userId: row.user_id, state: clone(row.state), revision: revision(row.revision),
      rankIndex: safeCount(row.rank_index), completedCount: safeCount(row.completed_count),
      stars: safeCount(row.stars), xp: safeCount(row.xp), updatedAt: row.updated_at || null,
    };
  }

  class CalculusCloud {
    constructor(config, createClient) {
      const url = config && typeof config.url === 'string' ? config.url.trim() : '';
      const key = config && typeof config.publishableKey === 'string' ? config.publishableKey.trim() : '';
      let endpoint;
      try { endpoint = new URL(url); } catch (_) { throw fail('NOT_CONFIGURED', '请先配置云端项目地址与公开密钥。'); }
      if (!key || key.startsWith('sb_secret_') || endpoint.username || endpoint.password ||
          (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)))) {
        throw fail('NOT_CONFIGURED', '云端地址需要 HTTPS，并且只能使用公开密钥。');
      }
      // Legacy anon JWTs are public keys; legacy service_role JWTs are not.
      if (key.split('.').length === 3 && typeof root.atob === 'function') {
        try {
          const payload = JSON.parse(root.atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
          if (payload.role === 'service_role') throw fail('SECRET_KEY', '浏览器中禁止使用 service_role 密钥，请改用公开密钥。');
        } catch (error) { if (error instanceof CloudError) throw error; }
      }
      const factory = createClient || (root.supabase && root.supabase.createClient);
      if (typeof factory !== 'function') throw fail('SDK_MISSING', '账户组件尚未加载，请刷新页面。');
      this.listeners = new Set();
      this.identityEpoch = 0;
      this.userId = undefined;
      this.disposed = false;
      this.lastAuthEvent = null;
      this.client = factory(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
      });
      const registration = this.client.auth.onAuthStateChange((event, session) => {
        this._observeIdentity(session && session.user ? session.user.id : null);
        this.lastAuthEvent = { event, session, epoch: this.identityEpoch };
        const snapshot = this.lastAuthEvent;
        // Never call another SDK API from inside the auth notification lock.
        setTimeout(() => {
          if (this.disposed || snapshot.epoch !== this.identityEpoch) return;
          this.listeners.forEach((listener) => this._notify(listener, event, session));
        }, 0);
      });
      this.subscription = registration.data.subscription;
    }

    _observeIdentity(userId) {
      if (this.userId !== undefined && this.userId !== userId) this.identityEpoch += 1;
      this.userId = userId;
    }

    _notify(listener, event, session) {
      try {
        const result = listener(event, session);
        if (result && typeof result.catch === 'function') result.catch(() => {});
      } catch (_) { /* A UI listener cannot block SDK auth cleanup. */ }
    }

    _assertContext(context) {
      if (this.disposed || context.epoch !== this.identityEpoch || this.userId !== context.user.id) {
        throw fail('SESSION_CHANGED', '账号已切换，本次操作已停止，请重试。');
      }
    }

    async _call(operation) {
      let result;
      try { result = await operation(); } catch (error) { throw asError(error); }
      if (!result || result.error) throw asError(result && result.error, result && result.status);
      return result.data;
    }

    async _context(allowAnonymous = false, expectedUserId) {
      const epoch = this.identityEpoch;
      const session = await this.getSession();
      if (this.disposed || epoch !== this.identityEpoch || (!session && this.userId)) {
        throw fail('SESSION_CHANGED', '账号已切换，本次操作已停止，请重试。');
      }
      if (!session) {
        if (allowAnonymous) { this._observeIdentity(null); return null; }
        throw fail('UNAUTHENTICATED', '请先注册或登录后再使用。', 401);
      }
      const data = await this._call(() => this.client.auth.getUser(session.access_token));
      const user = data && data.user;
      if (!user || !user.id || !session.user || user.id !== session.user.id) throw fail('UNAUTHENTICATED', '登录验证失败，请重新登录。', 401);
      if (this.userId === undefined) this._observeIdentity(user.id);
      const context = { epoch, user, session };
      this._assertContext(context);
      if (expectedUserId !== undefined && user.id !== expectedUserId) {
        throw fail('SESSION_CHANGED', '账号已切换，本次操作已停止，请重试。');
      }
      return context;
    }

    _bind(request, context) {
      this._assertContext(context);
      if (!request || typeof request.setHeader !== 'function') {
        throw fail('SDK_UNSUPPORTED', '账户组件版本过旧，请更新网页后重试。');
      }
      // Pin each request to the verified identity. A sign-in in another tab must
      // never cause A's queued progress to be written under B's access token.
      return request.setHeader('Authorization', `Bearer ${context.session.access_token}`);
    }

    async init() {
      const context = await this._context(true);
      return context ? { user: context.user, session: context.session } : { user: null, session: null };
    }

    async getSession() {
      const data = await this._call(() => this.client.auth.getSession());
      return data && data.session || null;
    }

    async getUser() {
      const context = await this._context(true);
      return context ? context.user : null;
    }

    async signUp(email, password, displayName, redirectUrl) {
      const name = typeof displayName === 'string' ? displayName.trim() : '';
      if (!name || name.length > 40) throw fail('INVALID_NAME', '昵称需要 1 至 40 个字符。');
      const options = { data: { display_name: name } };
      const redirect = redirectValue(redirectUrl);
      if (redirect) options.emailRedirectTo = redirect;
      const data = await this._call(() => this.client.auth.signUp({
        email: emailValue(email), password: passwordValue(password, true), options,
      }));
      return { user: data && data.user || null, session: data && data.session || null };
    }

    async signIn(email, password) {
      const data = await this._call(() => this.client.auth.signInWithPassword({ email: emailValue(email), password: passwordValue(password, false) }));
      return { user: data && data.user || null, session: data && data.session || null };
    }

    async signOut() {
      let signoutError = null;
      try { await this._call(() => this.client.auth.signOut({ scope: 'local' })); }
      catch (error) { signoutError = error; }
      // New SDKs also remove local credentials on revocation network failures.
      // Verify this instead of pretending a failed logout has cleared them.
      const remaining = await this.getSession();
      if (remaining) throw signoutError || fail('SIGNOUT_FAILED', '退出尚未完成，请联网后重试。');
      this._observeIdentity(null);
      return { localSignedOut: true, remoteRevoked: !signoutError };
    }

    async resetPassword(email, redirectUrl) {
      const options = {};
      const redirect = redirectValue(redirectUrl);
      if (redirect) options.redirectTo = redirect;
      await this._call(() => this.client.auth.resetPasswordForEmail(emailValue(email), options));
      return { requested: true };
    }

    async updatePassword(password) {
      const data = await this._call(() => this.client.auth.updateUser({ password: passwordValue(password, true) }));
      return data && data.user || null;
    }

    onAuthChange(listener) {
      if (typeof listener !== 'function') throw new TypeError('listener 必须是函数。');
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }

    async loadProgress(expectedUserId) {
      const context = await this._context(false, expectedUserId);
      const request = this.client.from('calculus_progress')
        .select('user_id,state,revision,rank_index,completed_count,stars,xp,updated_at')
        .eq('user_id', context.user.id).maybeSingle();
      const data = await this._call(() => this._bind(request, context));
      this._assertContext(context);
      return data === null ? null : progressRow(data, context.user.id);
    }

    async saveProgress(state, expectedRevision, expectedUserId) {
      if (!isObject(state)) throw fail('INVALID_STATE', '进度数据无效，无法保存。');
      let snapshot;
      try { snapshot = clone(state); } catch (_) { throw fail('INVALID_STATE', '进度数据无效，无法保存。'); }
      const expected = revision(expectedRevision);
      const context = await this._context(false, expectedUserId);
      const request = this.client.rpc('calculus_save_progress', { p_state: snapshot, p_expected_revision: expected });
      const data = await this._call(() => this._bind(request, context));
      this._assertContext(context);
      return progressRow(Array.isArray(data) && data.length === 1 ? data[0] : data, context.user.id);
    }

    async isTeacher(expectedUserId) {
      const context = await this._context(false, expectedUserId);
      const data = await this._call(() => this._bind(this.client.rpc('calculus_is_teacher'), context));
      this._assertContext(context);
      return data === true;
    }

    async listStudents(offset = 0, limit = 100, expectedUserId) {
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw fail('INVALID_PAGINATION', '学生列表页码无效。');
      }
      const context = await this._context(false, expectedUserId);
      const request = this.client.rpc('calculus_teacher_progress', { p_offset: offset, p_limit: limit });
      const data = await this._call(() => this._bind(request, context));
      this._assertContext(context);
      if (!Array.isArray(data)) throw fail('INVALID_RESPONSE', '学生列表读取失败，请重试。');
      return data.map((row) => ({
        userId: row.user_id, displayName: String(row.display_name || ''),
        rankIndex: safeCount(row.rank_index), completedCount: safeCount(row.completed_count),
        stars: safeCount(row.stars), xp: safeCount(row.xp),
        updatedAt: row.updated_at || null, createdAt: row.created_at || null,
      }));
    }

    dispose() {
      this.disposed = true;
      this.identityEpoch += 1;
      this.listeners.clear();
      this.lastAuthEvent = null;
      if (this.subscription) this.subscription.unsubscribe();
    }
  }

  CalculusCloud.CloudError = CloudError;
  CalculusCloud.asError = asError;
  if (typeof module !== 'undefined' && module.exports) module.exports = CalculusCloud;
  else root.CalculusCloud = CalculusCloud;
})(typeof globalThis !== 'undefined' ? globalThis : this);
