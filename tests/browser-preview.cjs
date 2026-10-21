'use strict';

// Local-only visual acceptance server. No production file or real service changes.
// Start explicitly: node tests/browser-preview.cjs
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const PORT = 4190;
const HOST = '127.0.0.1';
// Match the production server's explicit asset allowlist. Never serve source
// directories, SQL, dependencies, fixtures by their real paths, or arbitrary paths.
const files = Object.freeze({
  '/': 'index.html', '/index.html': 'index.html', '/styles.css': 'styles.css',
  '/app.js': 'app.js', '/engine.js': 'engine.js', '/curriculum.js': 'curriculum.js',
  '/standalone.html': '微积分晋级.html', '/config.js': 'config.js',
  '/vendor/supabase.js': 'vendor/supabase.js', '/cloud.js': 'cloud.js',
  '/cloud-sync.js': 'cloud-sync.js', '/accounts.js': 'accounts.js',
});
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const fixtureConfig = `window.CALCULUS_CONFIG = Object.freeze({mode:'cloud',url:'https://calculus-preview.example.test',publishableKey:'sb_publishable_local_visual_fixture_only'});\n`;
const fixtureSdk = `window.supabase = Object.freeze({createClient:function(){return {};}});\n`;
const badge = '<aside id="calculus-preview-badge" role="note" style="position:fixed;right:12px;bottom:12px;z-index:2147483647;max-width:calc(100vw - 24px);padding:8px 12px;border:1px solid #d7a846;border-radius:10px;background:#fff5ce;color:#684c11;font:600 12px/1.5 system-ui,sans-serif;box-shadow:0 3px 16px #0002;pointer-events:none">本地测试环境 · 数据为模拟</aside>';

function createPreviewServer() {
  return http.createServer((req, res) => {
    const headers = {
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; connect-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    };
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, headers); res.end('Method not allowed'); return; }
    let pathname;
    try { pathname = new URL(req.url, `http://${HOST}:${PORT}`).pathname; }
    catch (_) { res.writeHead(400, headers); res.end('Bad request'); return; }
    if (!Object.hasOwn(files, pathname)) { res.writeHead(404, headers); res.end('Not found'); return; }
    const name = files[pathname];
    headers['Content-Type'] = types[path.extname(name)] || 'application/octet-stream';
    const send = (data) => { res.writeHead(200, headers); res.end(req.method === 'HEAD' ? undefined : data); };
    if (pathname === '/config.js') { send(fixtureConfig); return; }
    if (pathname === '/vendor/supabase.js') { send(fixtureSdk); return; }
    const filename = pathname === '/cloud.js' ? path.join(__dirname, 'fixtures/cloud-preview.js') : path.join(root, name);
    fs.readFile(filename, (error, data) => {
      if (error) { res.writeHead(404, headers); res.end('Not found'); return; }
      if (path.extname(name) === '.html') data = Buffer.from(data.toString('utf8').replace('</body>', `${badge}</body>`));
      send(data);
    });
  });
}

if (require.main === module) {
  const server = createPreviewServer();
  server.on('error', (error) => { console.error(`本地测试预览无法启动：${error.code || 'SERVER_ERROR'}`); process.exitCode = 1; });
  server.listen(PORT, HOST, () => {
    console.log(`本地测试环境（模拟数据）：http://${HOST}:${PORT}/`);
    console.log('测试邮箱：student@example.test / teacher@example.test；密码使用任意非真实测试文本。');
    console.log('所有认证和云存档均为本地模拟，关闭此进程即停止预览。');
  });
  const stop = () => server.close(() => { process.exitCode = 0; });
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

module.exports = { createPreviewServer, HOST, PORT };
