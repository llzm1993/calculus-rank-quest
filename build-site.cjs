'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Only these application files can be published. Never copy the project folder.
const SITE_FILES = Object.freeze([
  'index.html', 'styles.css', 'curriculum.js', 'engine.js', 'app.js',
  'cloud.js', 'accounts.js', 'cloud-sync.js', 'vendor/supabase.js'
]);

function validateConfig(env = process.env) {
  const urlValue = String(env.SUPABASE_URL || '').trim();
  const publishableKey = String(env.SUPABASE_PUBLISHABLE_KEY || '').trim();
  if (!urlValue || !publishableKey) {
    throw new Error('缺少 SUPABASE_URL 或 SUPABASE_PUBLISHABLE_KEY；停止发布，避免生成无账号保护的网站。');
  }
  let url;
  try { url = new URL(urlValue); } catch {
    throw new Error('SUPABASE_URL 必须为有效的 Supabase HTTPS 项目地址。');
  }
  const hostname = url.hostname.toLowerCase();
  const domainName = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(hostname);
  const privateHost = hostname === 'localhost' || hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') || hostname === '[::1]' || hostname === '[::]' ||
    hostname.startsWith('127.') || hostname.startsWith('10.') || hostname.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) || hostname.startsWith('169.254.') ||
    hostname === '0.0.0.0';
  if (url.protocol !== 'https:' || !domainName || privateHost ||
      url.username || url.password || url.search || url.hash ||
      (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('SUPABASE_URL 需要公开 HTTPS 域名（项目 *.supabase.co 或自定义域名），不能包含路径、凭据或本地地址。');
  }
  let validKey = /^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(publishableKey);
  if (!validKey) {
    // Legacy browser keys are JWTs whose role is anon. Privileged keys must
    // never enter a public artifact. This is a format guard, not JWT verification.
    const parts = publishableKey.split('.');
    if (parts.length === 3 && parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) {
      try {
        const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        validKey = claims.role === 'anon';
      } catch { /* Rejected below without printing the supplied key. */ }
    }
  }
  if (!validKey) {
    throw new Error('SUPABASE_PUBLISHABLE_KEY 只能使用 sb_publishable_… 或旧版 anon key；禁止 secret / service_role / 用户会话密钥。');
  }
  return { mode: 'cloud', url: url.origin, publishableKey };
}

function buildSite({ root = __dirname, env = process.env } = {}) {
  const config = validateConfig(env);
  const projectRoot = fs.realpathSync(root);
  const destination = path.resolve(projectRoot, 'dist');
  // Destructive cleanup is confined to this project's exact dist directory.
  if (path.dirname(destination) !== projectRoot || path.basename(destination) !== 'dist') {
    throw new Error('构建输出目录不安全。');
  }
  if (fs.existsSync(destination) && fs.lstatSync(destination).isSymbolicLink()) {
    throw new Error('拒绝清理符号链接形式的 dist 目录。');
  }
  // Check every source before replacing a previous build.
  for (const file of SITE_FILES) {
    const source = path.resolve(projectRoot, file);
    if (!source.startsWith(projectRoot + path.sep) || !fs.existsSync(source) ||
        !fs.statSync(source).isFile() || fs.realpathSync(source) !== source) {
      throw new Error(`发布文件缺失或路径不安全：${file}`);
    }
  }
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  for (const file of SITE_FILES) {
    const target = path.join(destination, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(projectRoot, file), target);
  }
  const serialized = JSON.stringify(config, null, 2).replace(/</g, '\\u003c');
  fs.writeFileSync(path.join(destination, 'config.js'),
    `// Generated for this deployment. Browser-safe public settings only.\nwindow.CALCULUS_CONFIG = ${serialized};\n`, 'utf8');
  return destination;
}

if (require.main === module) {
  try {
    console.log(`账号版构建成功：${buildSite()}`);
  } catch (error) {
    console.error(`构建失败：${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { SITE_FILES, validateConfig, buildSite };
