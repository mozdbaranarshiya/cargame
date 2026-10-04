import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApplication } from '../server/app.js';
import { openDatabase } from '../server/database.js';

const password = 'test-only-long-password';
const registration = { firstName: 'آرش', lastName: 'آزمایشی', mobile: '09123456789', gender: 'مرد', nickname: 'راننده تست', password };

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'cargame-api-'));
  await mkdir(join(directory, 'scripts'));
  await mkdir(join(directory, 'vendor'));
  await mkdir(join(directory, 'server'));
  await writeFile(join(directory, 'index.html'), '<!doctype html><title>test game</title>');
  await writeFile(join(directory, 'scripts', 'ui.js'), 'export const ok = true;');
  await writeFile(join(directory, 'vendor', 'three.module.js'), 'export const renderer = true;');
  await writeFile(join(directory, 'server', 'secret.js'), 'private backend file');
  await writeFile(join(directory, '.env'), 'private environment file');
  const databasePath = join(directory, 'data', 'game.sqlite');
  const application = createApplication({ publicDirectory: directory, databasePath, ...options });
  application.server.listen(0, '127.0.0.1');
  await once(application.server, 'listening');
  const origin = `http://127.0.0.1:${application.server.address().port}`;
  t.after(async () => { await application.close(); await rm(directory, { recursive: true, force: true }); });
  async function request(path, { body, cookie, method = body ? 'POST' : 'GET', headers = {} } = {}) {
    const response = await fetch(origin + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json', Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text();
    return { status: response.status, data, headers: response.headers, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  return { ...application, request, databasePath, directory, origin };
}

test('registration, normalized mobile login, durable progress, replay, logout and password privacy', async t => {
  const env = await fixture(t);
  assert.deepEqual((await env.request('/api/me')).data, { user: null });
  const signup = await env.request('/api/register', { body: { ...registration, mobile: '۰۹۱۲ ۳۴۵ ۶۷۸۹' } });
  assert.equal(signup.status, 201);
  assert.match(signup.headers.get('set-cookie'), /HttpOnly; SameSite=Lax; Path=\//);
  assert.equal(signup.data.user.mobile, registration.mobile);
  assert.equal(signup.data.user.role, 'user');
  assert.equal(signup.data.user.password, undefined);
  assert.equal(signup.data.user.password_hash, undefined);
  assert.equal((await env.request('/api/me', { cookie: signup.cookie })).data.user.id, signup.data.user.id);
  assert.equal((await env.request('/api/admin/users', { cookie: signup.cookie })).status, 403);
  const progress = { userId: signup.data.user.id, coinsDelta: 24, scoreDelta: 700, requestId: 'test-progress-1' };
  const saved = await env.request('/api/progress', { cookie: signup.cookie, body: progress });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.user.coins, 24);
  assert.equal(saved.data.user.score, 700);
  const replay = await env.request('/api/progress', { cookie: signup.cookie, body: progress });
  assert.equal(replay.data.user.coins, 24);
  assert.equal(replay.data.user.score, 700);
  assert.equal((await env.request('/api/progress', { cookie: signup.cookie, body: { ...progress, coinsDelta: 25 } })).status, 409);
  const db = openDatabase(env.databasePath);
  const row = db.prepare('SELECT * FROM users').get();
  assert.match(row.password_hash, /^scrypt\$/);
  assert.ok(!row.password_hash.includes(password));
  const session = db.prepare('SELECT token_hash FROM sessions').get();
  assert.match(session.token_hash, /^[a-f0-9]{64}$/);
  assert.notEqual(session.token_hash, signup.cookie.split('=')[1]);
  db.close();
  const logout = await env.request('/api/logout', { cookie: signup.cookie, body: {} });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await env.request('/api/me', { cookie: signup.cookie })).data.user, null);
  assert.equal((await env.request('/api/progress', { cookie: signup.cookie, body: progress })).status, 401);
  const login = await env.request('/api/login', { body: { mobile: '+98 912-345-6789', password } });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.coins, 24);
  assert.notEqual(login.cookie, signup.cookie);
  await env.close();
  const restarted = createApplication({ databasePath: env.databasePath, publicDirectory: env.directory });
  restarted.server.listen(0, '127.0.0.1');
  await once(restarted.server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${restarted.server.address().port}/api/me`, { headers: { Cookie: login.cookie } });
    const restored = await response.json();
    assert.equal(restored.user.score, 700);
  } finally { await restarted.close(); }
});

test('validation rejects malformed registration and untrusted progress while requests stay isolated per player', async t => {
  const env = await fixture(t);
  for (const invalid of [{ gender: 'نامشخص' }, { password: 'short' }, { mobile: 'abc' }, { firstName: '' }, { nickname: 'x' }]) {
    assert.equal((await env.request('/api/register', { body: { ...registration, ...invalid } })).status, 400);
  }
  const first = await env.request('/api/register', { body: registration });
  const second = await env.request('/api/register', { body: { ...registration, mobile: '09123456780', gender: 'زن' } });
  assert.equal((await env.request('/api/register', { body: registration })).status, 409);
  const good = { userId: first.data.user.id, coinsDelta: 10, scoreDelta: 500, requestId: 'same-request-id' };
  for (const invalid of [{ coinsDelta: -1 }, { coinsDelta: 1001 }, { scoreDelta: 50001 }, { scoreDelta: 1.5 }, { requestId: 'short' }, { requestId: '<script>alert(1)</script>' }]) {
    assert.equal((await env.request('/api/progress', { cookie: first.cookie, body: { ...good, ...invalid } })).status, 400);
  }
  assert.equal((await env.request('/api/me', { cookie: first.cookie })).data.user.coins, 0);
  // An old tab for A must not credit A's pending progress to B after another tab logs into B.
  assert.equal((await env.request('/api/progress', { cookie: second.cookie, body: good })).status, 409);
  const { userId, ...missingOwner } = good;
  assert.equal((await env.request('/api/progress', { cookie: first.cookie, body: missingOwner })).status, 409);
  assert.equal((await env.request('/api/progress', { cookie: first.cookie, body: { ...good, userId: String(userId) } })).status, 409);
  assert.equal((await env.request('/api/me', { cookie: first.cookie })).data.user.coins, 0);
  assert.equal((await env.request('/api/me', { cookie: second.cookie })).data.user.coins, 0);
  const updates = await Promise.all([
    env.request('/api/progress', { cookie: first.cookie, body: good }),
    env.request('/api/progress', { cookie: first.cookie, body: good }),
    env.request('/api/progress', { cookie: second.cookie, body: { ...good, userId: second.data.user.id } }),
  ]);
  assert.ok(updates.every(update => update.status === 200));
  assert.equal((await env.request('/api/me', { cookie: first.cookie })).data.user.coins, 10);
  assert.equal((await env.request('/api/me', { cookie: second.cookie })).data.user.coins, 10);
});

test('origin and JSON checks block browser cross-site state changes, and private files never become public', async t => {
  const env = await fixture(t);
  const signup = await env.request('/api/register', { body: registration });
  const progress = { userId: signup.data.user.id, coinsDelta: 1, scoreDelta: 1, requestId: 'origin-test-1' };
  assert.equal((await env.request('/api/progress', { cookie: signup.cookie, body: progress, headers: { Origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await env.request('/api/logout', { cookie: signup.cookie, body: {}, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await env.request('/api/logout', { cookie: signup.cookie, body: {}, headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await env.request('/api/register', { method: 'OPTIONS' })).status, 404);
  assert.equal((await env.request('/api/me', { cookie: signup.cookie })).data.user.id, signup.data.user.id);
  for (const path of ['/', '/admin', '/scripts/ui.js', '/vendor/three.module.js']) assert.equal((await env.request(path)).status, 200);
  await symlink(join(env.directory, 'server', 'secret.js'), join(env.directory, 'scripts', 'escape.js'));
  for (const path of ['/server/secret.js', '/scripts/escape.js', '/data/game.sqlite', '/.env', '/%2eenv', '/package.json', '/tests/server.test.js', '/server.js']) {
    assert.equal((await env.request(path)).status, 404, path);
  }
  const malformed = await fetch(env.origin + '/api/register', { method: 'POST', headers: { Origin: env.origin, 'Content-Type': 'application/json' }, body: '{bad' });
  assert.equal(malformed.status, 400);
  const oversized = await env.request('/api/register', { body: { content: 'x'.repeat(20000) } });
  assert.equal(oversized.status, 413);
  assert.match((await env.request('/')).headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('admin provisioning uses explicit stdin credentials and admin users access requires admin sessions', async t => {
  const env = await fixture(t);
  const command = fileURLToPath(new URL('../server/create-admin.js', import.meta.url));
  const provision = spawnSync(process.execPath, [command, '--username', 'test_admin'], {
    input: password + '\n', encoding: 'utf8', env: { ...process.env, DATABASE_PATH: env.databasePath },
  });
  assert.equal(provision.status, 0, provision.stderr);
  assert.ok(!provision.stdout.includes(password));
  const duplicate = spawnSync(process.execPath, [command, '--username', 'test_admin'], {
    input: password + '\n', encoding: 'utf8', env: { ...process.env, DATABASE_PATH: env.databasePath },
  });
  assert.equal(duplicate.status, 1);
  assert.equal((await env.request('/api/admin/users')).status, 401);
  assert.equal((await env.request('/api/admin/login', { body: { username: 'test_admin', password: 'wrong-password' } })).status, 401);
  const player = await env.request('/api/register', { body: registration });
  await env.request('/api/progress', { cookie: player.cookie, body: { userId: player.data.user.id, coinsDelta: 15, scoreDelta: 150, requestId: 'admin-user-progress' } });
  const admin = await env.request('/api/admin/login', { body: { username: 'test_admin', password } });
  assert.equal(admin.status, 200);
  assert.equal(admin.data.user.role, 'admin');
  assert.equal((await env.request('/api/me', { cookie: admin.cookie })).data.user.role, 'admin');
  const listed = await env.request('/api/admin/users', { cookie: admin.cookie });
  assert.equal(listed.status, 200);
  assert.equal(listed.data.users.length, 1);
  assert.equal(listed.data.users[0].score, 150);
  assert.equal(listed.data.users[0].mobile, registration.mobile);
  assert.equal(listed.data.users[0].password_hash, undefined);
  assert.equal((await env.request('/api/progress', { cookie: admin.cookie, body: { coinsDelta: 1, scoreDelta: 1, requestId: 'admin-cant-play' } })).status, 403);
  assert.equal((await env.request('/api/admin/login', { body: { username: "' OR 1=1 --", password } })).status, 401);
});

test('authentication rate limits recover after the window and expired sessions lose access', async t => {
  let clock = Date.now();
  const env = await fixture(t, { now: () => clock, authLimit: 3, authWindowMs: 1000, sessionDurationMs: 5000 });
  const player = await env.request('/api/register', { body: registration });
  const wrong = { mobile: registration.mobile, password: 'wrong-long-password' };
  assert.equal((await env.request('/api/login', { body: wrong })).status, 401);
  assert.equal((await env.request('/api/login', { body: wrong })).status, 401);
  const blocked = await env.request('/api/login', { body: { mobile: registration.mobile, password } });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  clock += 1001;
  assert.equal((await env.request('/api/login', { body: { mobile: registration.mobile, password } })).status, 200);
  clock += 5000;
  assert.equal((await env.request('/api/me', { cookie: player.cookie })).data.user, null);
  assert.equal((await env.request('/api/admin/users', { cookie: player.cookie })).status, 401);
});

test('secure cookie mode uses Secure and respects an explicit public HTTPS origin', async t => {
  const env = await fixture(t, { secureCookies: true, publicOrigin: 'https://game.example' });
  const signup = await env.request('/api/register', { body: registration, headers: { Origin: 'https://game.example' } });
  assert.equal(signup.status, 201);
  assert.match(signup.headers.get('set-cookie'), /; Secure$/);
  assert.equal((await env.request('/api/logout', { cookie: signup.cookie, body: {} })).status, 403);
});
