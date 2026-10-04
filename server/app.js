import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, relative, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, publicUser, publicAdmin } from './database.js';
import { hashPassword, verifyPassword, validPassword } from './passwords.js';

const defaultPublicDirectory = fileURLToPath(new URL('../', import.meta.url));
const cookieName = 'cargame_session';
const maxBodyBytes = 16 * 1024;
const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
};
const staticFolders = new Set(['scripts', 'js', 'game', 'modules', 'assets', 'vendor']);
const staticFiles = new Set(['index.html', 'admin.html', 'style.css', 'game.js', 'favicon.ico']);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function normalizeMobile(value) {
  if (typeof value !== 'string' || value.length > 40) return '';
  let mobile = value.trim().replace(/[۰-۹٠-٩]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.includes(digit) ? '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit) : '٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/[\s()\-]/g, '');
  if (/^(\+98|0098|98)9\d{9}$/.test(mobile)) mobile = '0' + mobile.replace(/^(\+98|0098|98)/, '');
  return /^\+?\d{10,15}$/.test(mobile) ? mobile : '';
}

function cleanText(value, min, max) {
  if (typeof value !== 'string') return '';
  const result = value.trim();
  return result.length >= min && result.length <= max && !/[\u0000-\u001f\u007f]/u.test(result) ? result : '';
}

function tokenFromRequest(request) {
  const cookie = (request.headers.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith(`${cookieName}=`));
  const token = cookie?.slice(cookieName.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token || '') ? token : null;
}

const tokenHash = token => createHash('sha256').update(token).digest('hex');

async function parseBody(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) throw new HttpError(415, 'درخواست باید با قالب JSON ارسال شود.');
  if (Number(request.headers['content-length']) > maxBodyBytes) {
    request.resume();
    throw new HttpError(413, 'حجم درخواست بیش از حد مجاز است.');
  }
  let bytes = 0;
  let tooLarge = false;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBodyBytes) tooLarge = true;
    if (!tooLarge) chunks.push(chunk);
  }
  if (tooLarge) throw new HttpError(413, 'حجم درخواست بیش از حد مجاز است.');
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'اطلاعات درخواست معتبر نیست.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'اطلاعات درخواست معتبر نیست.');
  return body;
}

export function createApplication({
  publicDirectory = defaultPublicDirectory,
  databasePath = resolve(publicDirectory, 'data/game.sqlite'),
  secureCookies = false,
  publicOrigin,
  sessionDurationMs = 7 * 24 * 60 * 60 * 1000,
  authLimit = 15,
  authWindowMs = 15 * 60 * 1000,
  now = Date.now,
} = {}) {
  const publicRoot = resolve(publicDirectory);
  const expectedOrigin = publicOrigin ? new URL(publicOrigin).origin : null;
  if (expectedOrigin && !/^https?:\/\//.test(expectedOrigin)) throw new Error('PUBLIC_ORIGIN must use HTTP or HTTPS.');
  const db = openDatabase(databasePath);
  const rateLimits = new Map();
  let lastCleanup = now();
  let closed = false;

  function sendJson(response, status, body) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
  }

  function setCookie(response, token) {
    response.setHeader('Set-Cookie', `${cookieName}=${token || ''}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${token ? Math.floor(sessionDurationMs / 1000) : 0}${secureCookies ? '; Secure' : ''}`);
  }

  function createSession(request, response, identity) {
    const previous = tokenFromRequest(request);
    if (previous) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(previous));
    const token = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions (token_hash, user_id, admin_id, expires_at) VALUES (?, ?, ?, ?)').run(tokenHash(token), identity.role === 'user' ? identity.id : null, identity.role === 'admin' ? identity.id : null, now() + sessionDurationMs);
    setCookie(response, token);
  }

  function sessionIdentity(request) {
    const token = tokenFromRequest(request);
    if (!token) return null;
    const session = db.prepare('SELECT user_id, admin_id, expires_at FROM sessions WHERE token_hash = ?').get(tokenHash(token));
    if (!session) return null;
    if (session.expires_at <= now()) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
      return null;
    }
    if (session.admin_id != null) {
      const row = db.prepare('SELECT id, username FROM admins WHERE id = ?').get(session.admin_id);
      return row ? { id: row.id, role: 'admin', user: publicAdmin(row) } : null;
    }
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
    return row ? { id: row.id, role: 'user', user: publicUser(row) } : null;
  }

  function requireIdentity(request, role) {
    const identity = sessionIdentity(request);
    if (!identity) throw new HttpError(401, 'ابتدا وارد حساب خود شوید.');
    if (identity.role !== role) throw new HttpError(403, 'اجازه دسترسی به این بخش را ندارید.');
    return identity;
  }

  function checkOrigin(request) {
    const source = request.headers.origin;
    const host = request.headers.host;
    const destination = expectedOrigin || `${secureCookies ? 'https' : 'http'}://${host}`;
    if (request.headers['sec-fetch-site'] === 'cross-site' || (source && source !== destination)) throw new HttpError(403, 'درخواست از مبدأ مجاز ارسال نشده است.');
    // JSON-only requests without an Origin header remain usable by local command-line clients.
    // Browser cross-origin JSON requests require a preflight, and this server never permits CORS.
  }

  function checkRate(request, response, kind, limit, window) {
    const timestamp = now();
    if (timestamp - lastCleanup > 60000) {
      for (const [key, entry] of rateLimits) if (entry.reset <= timestamp) rateLimits.delete(key);
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(timestamp);
      lastCleanup = timestamp;
    }
    const key = `${kind}:${request.socket.remoteAddress}`;
    let entry = rateLimits.get(key);
    if (!entry || entry.reset <= timestamp) {
      if (rateLimits.size >= 10000) throw new HttpError(429, 'سرور مشغول است؛ کمی بعد دوباره تلاش کنید.');
      entry = { count: 0, reset: timestamp + window };
      rateLimits.set(key, entry);
    }
    entry.count++;
    if (entry.count > limit) {
      response.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.reset - timestamp) / 1000))));
      throw new HttpError(429, 'تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید.');
    }
  }

  async function api(request, response, path) {
    if (request.method === 'GET' && path === '/api/me') return sendJson(response, 200, { user: sessionIdentity(request)?.user || null });
    if (request.method === 'GET' && path === '/api/health') return sendJson(response, 200, { ok: true });
    if (request.method === 'GET' && path === '/api/admin/users') {
      requireIdentity(request, 'admin');
      return sendJson(response, 200, { users: db.prepare('SELECT * FROM users ORDER BY score DESC, coins DESC, id ASC').all().map(publicUser) });
    }
    if (request.method !== 'POST') throw new HttpError(404, 'این مسیر وجود ندارد.');
    checkOrigin(request);
    const body = await parseBody(request);
    if (['/api/register', '/api/login', '/api/admin/login'].includes(path)) checkRate(request, response, 'auth', authLimit, authWindowMs);
    if (path === '/api/register') {
      const firstName = cleanText(body.firstName, 1, 60);
      const lastName = cleanText(body.lastName, 1, 60);
      const nickname = cleanText(body.nickname, 2, 32);
      const mobile = normalizeMobile(body.mobile);
      if (!firstName || !lastName || !nickname || !mobile || !['مرد', 'زن'].includes(body.gender) || !validPassword(body.password)) throw new HttpError(400, 'نام، نام خانوادگی، شماره موبایل، جنسیت، نام نمایشی و رمز عبور ۸ تا ۱۲۸ نویسه‌ای را درست وارد کنید.');
      const passwordHash = await hashPassword(body.password);
      let inserted;
      try {
        inserted = db.prepare('INSERT INTO users (first_name, last_name, mobile, gender, nickname, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(firstName, lastName, mobile, body.gender, nickname, passwordHash, now());
      } catch (error) {
        if (error.code === 'ERR_SQLITE_ERROR' && error.message.includes('UNIQUE')) throw new HttpError(409, 'این شماره موبایل قبلاً ثبت شده است.');
        throw error;
      }
      const id = Number(inserted.lastInsertRowid);
      createSession(request, response, { id, role: 'user' });
      return sendJson(response, 201, { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
    }
    if (path === '/api/login') {
      const mobile = normalizeMobile(body.mobile);
      if (!mobile || !validPassword(body.password)) throw new HttpError(401, 'شماره موبایل یا رمز عبور نادرست است.');
      const row = db.prepare('SELECT * FROM users WHERE mobile = ?').get(mobile);
      if (!await verifyPassword(body.password, row?.password_hash)) throw new HttpError(401, 'شماره موبایل یا رمز عبور نادرست است.');
      createSession(request, response, { id: row.id, role: 'user' });
      return sendJson(response, 200, { user: publicUser(row) });
    }
    if (path === '/api/admin/login') {
      const username = cleanText(body.username, 3, 40);
      if (!username || !validPassword(body.password)) throw new HttpError(401, 'نام کاربری یا رمز عبور مدیر نادرست است.');
      const row = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
      if (!await verifyPassword(body.password, row?.password_hash)) throw new HttpError(401, 'نام کاربری یا رمز عبور مدیر نادرست است.');
      createSession(request, response, { id: row.id, role: 'admin' });
      return sendJson(response, 200, { user: publicAdmin(row) });
    }
    if (path === '/api/logout') {
      const token = tokenFromRequest(request);
      if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
      setCookie(response, null);
      return sendJson(response, 200, { user: null });
    }
    if (path === '/api/progress') {
      const identity = requireIdentity(request, 'user');
      if (!Number.isSafeInteger(body.userId) || body.userId !== identity.id) throw new HttpError(409, 'حساب فعال تغییر کرده است؛ دوباره وارد حساب خود شوید.');
      checkRate(request, response, 'progress', 120, 60000);
      const { coinsDelta, scoreDelta, requestId } = body;
      if (!Number.isSafeInteger(coinsDelta) || coinsDelta < 0 || coinsDelta > 1000 || !Number.isSafeInteger(scoreDelta) || scoreDelta < 0 || scoreDelta > 50000 || typeof requestId !== 'string' || !/^[A-Za-z0-9_:.-]{8,100}$/.test(requestId)) throw new HttpError(400, 'امتیاز، سکه یا شناسه درخواست معتبر نیست.');
      db.exec('BEGIN IMMEDIATE');
      try {
        const previous = db.prepare('SELECT coins_delta, score_delta FROM progress_requests WHERE user_id = ? AND request_id = ?').get(identity.id, requestId);
        if (previous && (previous.coins_delta !== coinsDelta || previous.score_delta !== scoreDelta)) throw new HttpError(409, 'شناسه این درخواست قبلاً برای اطلاعات دیگری استفاده شده است.');
        if (!previous) {
          const user = db.prepare('SELECT coins, score FROM users WHERE id = ?').get(identity.id);
          if (!Number.isSafeInteger(user.coins + coinsDelta) || !Number.isSafeInteger(user.score + scoreDelta)) throw new HttpError(400, 'امتیاز حساب به سقف مجاز رسیده است.');
          db.prepare('UPDATE users SET coins = coins + ?, score = score + ? WHERE id = ?').run(coinsDelta, scoreDelta, identity.id);
          db.prepare('INSERT INTO progress_requests (user_id, request_id, coins_delta, score_delta, created_at) VALUES (?, ?, ?, ?, ?)').run(identity.id, requestId, coinsDelta, scoreDelta, now());
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return sendJson(response, 200, { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(identity.id)) });
    }
    throw new HttpError(404, 'این مسیر وجود ندارد.');
  }

  function allowedStaticPath(localPath) {
    const parts = localPath.split(/[\\/]/);
    return parts.every(part => part && !part.startsWith('.')) && (parts.length === 1 ? staticFiles.has(localPath) : staticFolders.has(parts[0])) && Boolean(mimeTypes[extname(localPath).toLowerCase()]);
  }

  async function serveStatic(request, response, path) {
    if (!['GET', 'HEAD'].includes(request.method)) throw new HttpError(405, 'این روش درخواست مجاز نیست.');
    let localPath = path === '/' || path === '/admin' || path === '/admin/' ? 'index.html' : path.replace(/^\//, '');
    if (path === '/admin' || path === '/admin/') {
      try { await stat(resolve(publicRoot, 'admin.html')); localPath = 'admin.html'; } catch { /* Unified frontend may render its admin screen from index.html. */ }
    }
    if (!allowedStaticPath(localPath)) throw new HttpError(404, 'این مسیر وجود ندارد.');
    let actual;
    let info;
    try {
      actual = await realpath(resolve(publicRoot, localPath));
      const actualRelative = relative(publicRoot, actual);
      if (actualRelative.startsWith(`..${sep}`) || actualRelative === '..' || !allowedStaticPath(actualRelative)) throw new HttpError(404, 'این مسیر وجود ندارد.');
      info = await stat(actual);
      if (!info.isFile()) throw new HttpError(404, 'این مسیر وجود ندارد.');
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(404, 'این مسیر وجود ندارد.');
    }
    response.writeHead(200, { 'Content-Type': mimeTypes[extname(actual).toLowerCase()], 'Content-Length': info.size, 'Cache-Control': 'no-cache' });
    if (request.method === 'HEAD') return response.end();
    const stream = createReadStream(actual);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  }

  const server = createServer((request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    Promise.resolve().then(async () => {
      let path;
      try { path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
      catch { throw new HttpError(400, 'مسیر درخواست معتبر نیست.'); }
      if (path.startsWith('/api/')) await api(request, response, path);
      else await serveStatic(request, response, path);
    }).catch(error => {
      if (response.headersSent) return response.destroy();
      const status = error instanceof HttpError ? error.status : 500;
      // Never log request bodies, passwords, session tokens, or database rows.
      if (status === 500) console.error('خطای داخلی سرور:', error.code || error.name);
      sendJson(response, status, { error: status === 500 ? 'خطای داخلی سرور؛ دوباره تلاش کنید.' : error.message });
    });
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 60;

  function close() {
    if (closed) return Promise.resolve();
    closed = true;
    return new Promise(resolveClose => {
      server.close(() => { db.close(); resolveClose(); });
      server.closeIdleConnections();
    });
  }
  return { server, close };
}
