'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { SITE_FILES, validateConfig, buildSite } = require('../build-site.cjs');

const validEnv = {
  SUPABASE_URL: 'https://test-project.supabase.co/',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_buildtest000000000000',
};
const jwt = (claims) => [
  Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify(claims)).toString('base64url'),
  'testsignature',
].join('.');

function fixture(t) {
  const temporaryParent = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(temporaryParent, 'calculus-build-test-'));
  t.after(() => {
    const target = path.resolve(root);
    assert.equal(path.dirname(target), temporaryParent);
    assert.ok(path.basename(target).startsWith('calculus-build-test-'));
    assert.equal(fs.lstatSync(target).isSymbolicLink(), false);
    fs.rmSync(target, { recursive: true, force: true });
  });
  const write = (name, text = `fixture for ${name}`) => {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text, 'utf8');
  };
  for (const file of SITE_FILES) write(file);
  return { root, write };
}

function listFiles(root) {
  const entries = [];
  function walk(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) walk(path.join(directory, entry.name), relative + '/');
      else entries.push(relative);
    }
  }
  walk(root);
  return entries.sort();
}

test('deployment config permits public publishable and legacy anon keys only', () => {
  assert.deepEqual(validateConfig(validEnv), {
    mode: 'cloud', url: 'https://test-project.supabase.co',
    publishableKey: validEnv.SUPABASE_PUBLISHABLE_KEY,
  });
  assert.equal(validateConfig({ ...validEnv, SUPABASE_URL: 'https://auth.school.edu' }).url,
    'https://auth.school.edu');
  assert.equal(validateConfig({ ...validEnv, SUPABASE_PUBLISHABLE_KEY: jwt({ role: 'anon' }) }).mode, 'cloud');
});

test('missing deployment settings fail closed without a guest fallback', () => {
  for (const env of [{}, { SUPABASE_URL: validEnv.SUPABASE_URL },
    { SUPABASE_PUBLISHABLE_KEY: validEnv.SUPABASE_PUBLISHABLE_KEY },
    { ...validEnv, SUPABASE_URL: '  ' }]) {
    assert.throws(() => validateConfig(env), /缺少/);
  }
});

test('private or user-session keys are rejected and never echoed in errors', () => {
  for (const key of ['sb_secret_do_not_publish_000000', 'service_role', 'database-password',
    jwt({ role: 'service_role' }), jwt({ role: 'authenticated', sub: 'student-id' }),
    jwt({}), 'broken.jwt.value']) {
    assert.throws(() => validateConfig({ ...validEnv, SUPABASE_PUBLISHABLE_KEY: key }), error => {
      assert.match(error.message, /只能使用/);
      if (key.length > 30) assert.equal(error.message.includes(key), false);
      return true;
    });
  }
});

test('deployment rejects local hosts, insecure URLs and embedded URL credentials', () => {
  for (const url of ['http://test-project.supabase.co', 'https://localhost',
    'https://auth.localhost', 'https://server.local', 'https://127.0.0.1',
    'https://10.0.0.1', 'https://192.168.1.2', 'https://172.20.1.1',
    'https://169.254.169.254', 'https://0.0.0.0', 'https://[::1]',
    'https://[::ffff:127.0.0.1]', 'https://user:password@test-project.supabase.co',
    'https://test-project.supabase.co/rest/v1', 'https://test-project.supabase.co?token=private',
    'https://test-project.supabase.co#secret', 'not-a-url']) {
    assert.throws(() => validateConfig({ ...validEnv, SUPABASE_URL: url }), /SUPABASE_URL/);
  }
});

test('build publishes exact allowlist and generated cloud config, excluding private and offline files', t => {
  const { root, write } = fixture(t);
  for (const file of ['.env', '.env.production', 'config.js', '微积分晋级.html',
    'supabase/schema.sql', 'supabase/verify.sql', 'tests/private.test.cjs',
    'node_modules/private-package/index.js', '游戏预览.png', 'README.md', 'DEPLOY.md',
    '.github/workflows/pages.yml', 'screenshots/account.png', 'dist/old-private.txt',
    'dist/obsolete/internal.sql']) write(file, 'PRIVATE_FIXTURE_DO_NOT_PUBLISH');
  const output = buildSite({ root, env: validEnv });
  assert.equal(output, path.join(root, 'dist'));
  assert.deepEqual(listFiles(output), [...SITE_FILES, 'config.js'].sort());
  for (const file of SITE_FILES) {
    assert.equal(fs.readFileSync(path.join(output, file), 'utf8'), `fixture for ${file}`);
  }
  const configText = fs.readFileSync(path.join(output, 'config.js'), 'utf8');
  assert.equal(configText.includes('PRIVATE_FIXTURE_DO_NOT_PUBLISH'), false);
  const context = { window: {} };
  vm.runInNewContext(configText, context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.window.CALCULUS_CONFIG)), validateConfig(validEnv));
  assert.equal(fs.readFileSync(path.join(root, '.env'), 'utf8'), 'PRIVATE_FIXTURE_DO_NOT_PUBLISH');
});

test('invalid config leaves a previous build intact rather than creating an unconfigured site', t => {
  const { root, write } = fixture(t);
  write('dist/index.html', 'LAST_SUCCESSFUL_BUILD');
  assert.throws(() => buildSite({ root, env: {} }), /缺少/);
  assert.equal(fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8'), 'LAST_SUCCESSFUL_BUILD');
  assert.equal(fs.existsSync(path.join(root, 'dist/config.js')), false);
});

test('missing required account files fail before deleting the previous build', t => {
  const { root, write } = fixture(t);
  write('dist/index.html', 'LAST_SUCCESSFUL_BUILD');
  fs.unlinkSync(path.join(root, 'accounts.js'));
  assert.throws(() => buildSite({ root, env: validEnv }), /accounts\.js/);
  assert.equal(fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8'), 'LAST_SUCCESSFUL_BUILD');
});
