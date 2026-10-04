import { CARS } from './cars.js';

const $ = id => document.getElementById(id);
const isAdminPage = /^\/admin\/?$/.test(window.location.pathname);
const numberFormat = new Intl.NumberFormat('fa-IR');
const format = value => numberFormat.format(Math.max(0, Number(value) || 0));
const storagePrefix = 'cargame.v2.';
const carLabels = { compact: 'شهری', sedan: 'سدان', suv: 'شاسی‌بلند', sport: 'اسپرت', super: 'سوپر اسپرت', hyper: 'هایپرکار' };
let currentUser = null;
let selectedCar = CARS[0];
let activeQueue = [];
let flushPromise = null;
let retryTimer = null;
let authVersion = 0;
let authLoading = !isAdminPage;
let engineReady = false;
let engineFailed = false;
let driving = false;
let storageWarningShown = false;
let activeTab = 'login';
let sessionInvalid = false;
const pendingMemory = new Map();

function readStorage(key, fallback) {
  try { const raw = localStorage.getItem(storagePrefix + key); return raw === null ? fallback : JSON.parse(raw); }
  catch { return fallback; }
}

function writeStorage(key, value) {
  try { localStorage.setItem(storagePrefix + key, JSON.stringify(value)); return true; }
  catch {
    if (!storageWarningShown) {
      storageWarningShown = true;
      showMessage('مرورگر اجازهٔ ذخیرهٔ محلی نمی‌دهد؛ پیشرفت مهمان تا پایان این صفحه نگه داشته می‌شود.');
    }
    return false;
  }
}

function normalizeProgress(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(number))) : 0;
}

const savedGuest = readStorage('guest', {});
const guest = { coins: normalizeProgress(savedGuest?.coins), score: normalizeProgress(savedGuest?.score) };
let volume = Math.min(100, Math.max(0, Number(readStorage('volume', 80)) || 0));
const savedCar = readStorage('selectedCar', null);
selectedCar = CARS.find(car => car.id === savedCar) || CARS[0];

function showMessage(message) {
  $('menuMessage').textContent = message;
  $('menuMessage').hidden = !message;
}

function showError(id, message) {
  const element = $(id);
  element.textContent = message || '';
  element.hidden = !message;
}

function createRequestId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return crypto.randomUUID();
  const random = typeof globalThis.crypto?.getRandomValues === 'function'
    ? Array.from(crypto.getRandomValues(new Uint8Array(12)), value => value.toString(16).padStart(2, '0')).join('')
    : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return 'p_' + Date.now().toString(36) + '_' + random;
}

function queuePrefix(userId) { return storagePrefix + 'pending.' + userId + '.'; }
function validEntry(row) {
  return row && typeof row.requestId === 'string' && /^[A-Za-z0-9_:-]{8,100}$/.test(row.requestId)
    && Number.isInteger(row.coinsDelta) && row.coinsDelta >= 0 && row.coinsDelta <= 1000
    && Number.isInteger(row.scoreDelta) && row.scoreDelta >= 0 && row.scoreDelta <= 50000;
}
function memoryQueue(userId) {
  if (!pendingMemory.has(userId)) pendingMemory.set(userId, new Map());
  return pendingMemory.get(userId);
}
function persistEntry(userId, entry) {
  memoryQueue(userId).set(entry.requestId, entry);
  writeStorage('pending.' + userId + '.' + entry.requestId, entry);
}
function loadQueue(userId) {
  const memory = memoryQueue(userId);
  try {
    const prefix = queuePrefix(userId);
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const row = JSON.parse(localStorage.getItem(key));
      if (validEntry(row)) memory.set(row.requestId, row);
    }
  } catch { /* Pending entries also remain in memory if browser storage is blocked. */ }
  return Array.from(memory.values());
}
function acknowledgeEntry(userId, requestId) {
  memoryQueue(userId).delete(requestId);
  try { localStorage.removeItem(queuePrefix(userId) + requestId); } catch { /* Memory still acknowledges the receipt. */ }
}
function accountActive() { return currentUser?.role === 'user'; }
function pendingTotals() {
  return activeQueue.reduce((totals, item) => {
    totals.coins += item.coinsDelta;
    totals.score += item.scoreDelta;
    return totals;
  }, { coins: 0, score: 0 });
}

function renderAccount() {
  const pending = accountActive() ? pendingTotals() : { coins: 0, score: 0 };
  const coins = accountActive() ? normalizeProgress(currentUser.coins) + pending.coins : guest.coins;
  const score = accountActive() ? normalizeProgress(currentUser.score) + pending.score : guest.score;
  $('totalCoins').textContent = format(coins);
  $('summaryCoins').textContent = format(coins);
  $('totalScore').textContent = format(score);
  $('profileLabel').textContent = accountActive() ? currentUser.nickname : 'ورود / ثبت‌نام';
  $('accountButton').title = accountActive() ? 'حساب ' + currentUser.nickname : 'ورود یا ثبت‌نام';
  $('guestNote').textContent = accountActive()
    ? 'خوش آمدی ' + currentUser.nickname + '؛ سکه‌ها و امتیازهای تو در حسابت ذخیره می‌شوند.'
    : 'بدون ثبت‌نام هم بازی کن؛ پیشرفت مهمان در همین مرورگر می‌ماند.';
  $('stripAccountButton').firstChild.textContent = accountActive() ? 'مشاهدهٔ حساب راننده ' : 'پیشرفتت را در حساب نگه دار ';
  const signedIn = accountActive();
  document.querySelector('.account-tabs').hidden = signedIn;
  $('profilePanel').hidden = !signedIn;
  if (signedIn) {
    $('loginPanel').hidden = true;
    $('registerPanel').hidden = true;
    $('accountTitle').textContent = 'گاراژ ' + currentUser.nickname;
    $('profileAvatar').textContent = Array.from(currentUser.nickname || 'ر')[0];
    $('profileName').textContent = currentUser.nickname;
    $('profileMobile').textContent = currentUser.mobile || '';
    $('profileCoins').textContent = format(coins);
    $('profileScore').textContent = format(score);
    $('syncStatus').textContent = activeQueue.length
      ? 'پیشرفت تازه در صف ذخیره است؛ هنگام اتصال دوباره ارسال می‌شود.'
      : 'پیشرفت حساب در سامانه ذخیره می‌شود.';
  } else {
    $('accountTitle').textContent = 'مسیرت را نگه دار.';
    switchTab(activeTab);
  }
}

async function api(path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: body === undefined ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(typeof data.error === 'string' ? data.error : 'درخواست انجام نشد. دوباره تلاش کن.');
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError' || error instanceof TypeError) throw new Error('اتصال به سامانه برقرار نشد. اتصال شبکه را بررسی کن و دوباره تلاش کن.');
    throw error;
  } finally { clearTimeout(timeout); }
}

function setUser(user) {
  authVersion += 1;
  sessionInvalid = false;
  currentUser = user?.role === 'user' ? user : null;
  activeQueue = accountActive() ? loadQueue(currentUser.id) : [];
  clearTimeout(retryTimer);
  renderAccount();
  if (activeQueue.length) scheduleFlush(0);
}

function scheduleFlush(delay = 700) {
  clearTimeout(retryTimer);
  if (accountActive() && !sessionInvalid && activeQueue.length) retryTimer = setTimeout(() => { void flushProgress(); }, delay);
}

async function flushProgress() {
  if (flushPromise) return flushPromise;
  if (!accountActive() || sessionInvalid) return;
  activeQueue = loadQueue(currentUser.id);
  if (!activeQueue.length) return;
  const owner = currentUser.id;
  const version = authVersion;
  const entry = activeQueue[0];
  let failed = false;
  flushPromise = (async () => {
    try {
      const { user } = await api('/api/progress', { ...entry, userId: Number(owner) });
      // A successful receipt acknowledges only this immutable request ID.
      // New events may have appended to the queue while this request was running.
      const sameOwner = accountActive() && currentUser.id === owner;
      acknowledgeEntry(owner, entry.requestId);
      if (sameOwner) activeQueue = loadQueue(owner);
      if (sameOwner && authVersion === version && user?.id === owner) currentUser = user;
      if (sameOwner) renderAccount();
    } catch (error) {
      failed = true;
      if ((error.status === 401 || error.status === 403 || error.status === 409) && accountActive() && currentUser.id === owner && authVersion === version) {
        sessionInvalid = true;
        showMenu();
        const invalidVersion = authVersion;
        try {
          const { user } = await api('/api/me');
          if (authVersion === invalidVersion) {
            if (user?.role === 'user' && user.id === owner) {
              currentUser = user;
              showMessage('ذخیرهٔ پیشرفت نیاز به ورود دوباره دارد. از حساب خارج شو و دوباره وارد شو.');
            } else {
              setUser(user);
              showMessage('حساب مرورگر تغییر کرده است. پیشرفت ارسال‌نشده برای حساب قبلی نگه داشته شد.');
            }
          }
        } catch { showMessage('نشست حساب معتبر نیست؛ برای ادامه از حساب خارج شو و دوباره وارد شو. پیشرفت در صف می‌ماند.'); }
      }
      if (accountActive() && currentUser.id === owner && authVersion === version) {
        $('syncStatus').textContent = 'ذخیره هنوز تأیید نشده؛ پیشرفت در صف می‌ماند. ' + error.message;
        if (!driving) showMessage('پیشرفت تازه هنوز ارسال نشده است. با اتصال دوباره، ذخیره را تکرار می‌کنیم.');
      }
    } finally {
      flushPromise = null;
      if (accountActive() && !sessionInvalid && activeQueue.length) scheduleFlush(failed ? 10000 : 80);
    }
  })();
  return flushPromise;
}

function collectProgress(detail) {
  let coins = normalizeProgress(detail?.coinsDelta);
  let score = normalizeProgress(detail?.scoreDelta);
  if (!coins && !score) return;
  // Engine events are small; bound malformed synthetic events before chunking.
  coins = Math.min(coins, 100000);
  score = Math.min(score, 5000000);
  if (!accountActive()) {
    guest.coins = Math.min(Number.MAX_SAFE_INTEGER, guest.coins + coins);
    guest.score = Math.min(Number.MAX_SAFE_INTEGER, guest.score + score);
    writeStorage('guest', guest);
  } else {
    activeQueue = loadQueue(currentUser.id);
    while (coins > 0 || score > 0) {
      const entry = { requestId: createRequestId(), coinsDelta: Math.min(coins, 1000), scoreDelta: Math.min(score, 50000) };
      activeQueue.push(entry);
      persistEntry(currentUser.id, entry);
      coins -= entry.coinsDelta;
      score -= entry.scoreDelta;
    }
    scheduleFlush();
  }
  renderAccount();
}

function switchTab(tab, focus = false) {
  if (accountActive()) return;
  activeTab = tab;
  const login = tab === 'login';
  $('loginTab').setAttribute('aria-selected', String(login));
  $('registerTab').setAttribute('aria-selected', String(!login));
  $('loginTab').tabIndex = login ? 0 : -1;
  $('registerTab').tabIndex = login ? -1 : 0;
  $('loginPanel').hidden = !login;
  $('registerPanel').hidden = login;
  if (focus) $(login ? 'loginTab' : 'registerTab').focus();
}

function openDialog(id) {
  if (driving) showMenu();
  const dialog = $(id);
  if (id === 'accountDialog') renderAccount();
  if (!dialog.open) dialog.showModal();
}

for (const dialog of document.querySelectorAll('dialog')) {
  for (const close of dialog.querySelectorAll('[data-close]')) close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
}

function wheel(cx, cy, radius) {
  const pieces = ['<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + radius + '" ry="' + (radius * 1.1) + '" fill="#071218" stroke="#34434a" stroke-width="3"/>',
    '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + (radius * .73) + '" ry="' + (radius * .8) + '" fill="#1b2930" stroke="#9baeb4" stroke-width="3"/>'];
  for (let i = 0; i < 5; i += 1) {
    const angle = i * Math.PI * 2 / 5;
    const x = cx + Math.sin(angle) * radius * .59;
    const y = cy + Math.cos(angle) * radius * .64;
    pieces.push('<path d="M' + cx + ' ' + cy + 'L' + x.toFixed(1) + ' ' + y.toFixed(1) + '" stroke="#9aaeb5" stroke-width="5"/>');
  }
  pieces.push('<circle cx="' + cx + '" cy="' + cy + '" r="7" fill="#b7c8ce"/><circle cx="' + cx + '" cy="' + cy + '" r="3" fill="#213138"/>');
  return pieces.join('');
}

function carIllustration(car, prefix) {
  const safeColor = /^#[0-9a-f]{6}$/i.test(car.color) ? car.color : '#a7e6d0';
  const shapes = {
    compact: { body:'M104 234L127 199Q149 181 224 173L282 115Q297 104 336 103L468 108L541 175L618 187Q637 195 644 220L650 248L616 263H140L104 254Z', glass:'M251 173L302 121L350 120L352 171ZM365 120L455 124L506 172L369 171Z', roof:'M285 114L465 111L539 177', r:38, rear:551 },
    sedan: { body:'M87 236L112 205L234 180L301 120Q312 112 341 112L465 117L541 174L642 193L675 220L679 249L627 264H128L87 254Z', glass:'M259 179L317 129L358 129L361 176ZM377 129L456 131L508 176L381 176Z', roof:'M304 120L465 120L539 177', r:39, rear:560 },
    suv: { body:'M94 231L115 184L224 164L281 83Q291 72 325 72L480 80L547 163L624 182L650 211L649 255L614 275H130L94 259Z', glass:'M252 162L302 93L352 93L351 160ZM369 94L464 99L506 160L369 160Z', roof:'M282 81L479 84L545 166', r:46, rear:555 },
    sport: { body:'M76 237L101 208L238 181L315 137Q335 126 372 127L466 134L540 176L642 190L682 216L684 251L623 267H115L76 254Z', glass:'M267 181L333 144L379 143L377 178ZM395 145L458 149L504 178L395 178Z', roof:'M314 137L466 137L539 178', r:42, rear:565 },
    super: { body:'M64 242L89 221L228 186L312 145Q333 138 377 137L462 146L522 178L642 182L688 215L689 252L625 269H104L64 258Z', glass:'M256 188L333 153L388 152L379 183ZM406 153L458 156L488 179L401 180Z', roof:'M312 147L461 149L522 182', r:44, rear:567 },
    hyper: { body:'M59 242L81 220L215 193L304 159Q344 139 390 143L464 153L526 182L653 173L694 213L692 255L622 272H100L59 259Z', glass:'M247 195L326 165L391 153L382 186ZM410 157L459 165L496 184L405 187Z', roof:'M306 159L390 147L466 156L525 185', r:46, rear:570 },
  };
  const shape = shapes[car.type] || shapes.sedan;
  const spoiler = ['super', 'hyper'].includes(car.type)
    ? '<path d="M599 163L651 158M618 164L622 181" stroke="#081b24" stroke-width="8" stroke-linecap="round"/><path d="M598 158L665 155" stroke="' + safeColor + '" stroke-width="8" stroke-linecap="round"/>'
    : '';
  const rails = car.type === 'suv' ? '<path d="M307 64L462 69" stroke="#81979e" stroke-width="6" stroke-linecap="round"/>' : '';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 30 760 315" role="img" aria-label="پیش‌نمایش ' + car.name + '">'
    + '<defs><linearGradient id="' + prefix + '-body" x1="0" y1="0" x2=".3" y2="1"><stop stop-color="#effff9"/><stop offset=".2" stop-color="' + safeColor + '"/><stop offset=".64" stop-color="' + safeColor + '"/><stop offset="1" stop-color="#173039"/></linearGradient><linearGradient id="' + prefix + '-glass" x1="0" y1="0" x2=".5" y2="1"><stop stop-color="#7aabb6"/><stop offset=".4" stop-color="#2c4e5d"/><stop offset="1" stop-color="#132a36"/></linearGradient><radialGradient id="' + prefix + '-shadow"><stop stop-color="#030b12" stop-opacity=".8"/><stop offset="1" stop-color="#030b12" stop-opacity="0"/></radialGradient></defs>'
    + '<ellipse cx="389" cy="294" rx="333" ry="27" fill="url(#' + prefix + '-shadow)"/>'
    + rails + spoiler
    + '<path d="' + shape.body + '" fill="url(#' + prefix + '-body)" stroke="#0b252b" stroke-width="3"/>'
    + '<path d="' + shape.glass + '" fill="url(#' + prefix + '-glass)" stroke="#0e2b35" stroke-width="4" stroke-linejoin="round"/>'
    + '<path d="' + shape.roof + '" fill="none" stroke="#eefff9" stroke-opacity=".52" stroke-width="3"/>'
    + '<path d="M123 211Q213 185 247 187L548 184L638 204" fill="none" stroke="#d9fff4" stroke-opacity=".32" stroke-width="3"/>'
    + '<path d="M354 182L359 247M516 182L505 246M278 252L508 252" fill="none" stroke="#092d35" stroke-opacity=".55" stroke-width="2"/>'
    + '<path d="M273 202L325 201M394 197L421 196" stroke="#142e38" stroke-width="4" stroke-linecap="round"/>'
    + '<path d="M115 221L159 211L180 219L167 229L107 237Z" fill="#d6ffff" stroke="#b0fff5" stroke-width="2"/>'
    + '<path d="M96 246L177 238L183 256L106 257Z" fill="#102934"/>'
    + '<path d="M102 247L163 243" stroke="#556c77" stroke-width="2"/>'
    + '<path d="M637 205L664 218L660 232L638 223Z" fill="#ff886e"/>'
    + '<path d="M517 219L552 200L544 230L517 237Z" fill="#143441" opacity="' + (['super','hyper'].includes(car.type) ? '1' : '.16') + '"/>'
    + '<path d="M264 168L285 173L284 185L263 183Z" fill="' + safeColor + '" stroke="#12303a" stroke-width="3"/>'
    + wheel(225, 261, shape.r) + wheel(shape.rear, 256, shape.r)
    + '<path d="M310 234L444 229" stroke="#e0fff7" stroke-width="3" stroke-opacity=".14"/>'
    + '</svg>';
}

function renderCars() {
  $('carCount').textContent = format(CARS.length);
  const grid = $('carGrid');
  grid.replaceChildren();
  CARS.forEach((car, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'car-card';
    button.dataset.carId = car.id;
    button.setAttribute('aria-label', car.name + '، حداکثر ' + format(car.maxSpeed) + ' کیلومتر بر ساعت');
    const number = document.createElement('span');
    number.className = 'car-number'; number.textContent = String(index + 1).padStart(2, '0'); number.setAttribute('aria-hidden', 'true');
    const check = document.createElement('span');
    check.className = 'selected-check'; check.textContent = '✓'; check.setAttribute('aria-hidden', 'true');
    const art = document.createElement('div'); art.className = 'car-visual'; art.innerHTML = carIllustration(car, 'card-' + car.id);
    art.setAttribute('aria-hidden', 'true');
    const title = document.createElement('h3'); title.textContent = car.name;
    const meta = document.createElement('div'); meta.className = 'car-card-meta';
    const type = document.createElement('span'); type.textContent = carLabels[car.type] || 'ماشین';
    const speed = document.createElement('span'); speed.className = 'car-max'; speed.innerHTML = '<b>' + Number(car.maxSpeed) + '</b> km/h';
    meta.append(type, speed); button.append(number, check, art, title, meta);
    button.addEventListener('click', () => selectCar(car));
    grid.append(button);
  });
  selectCar(selectedCar, false);
}

function selectCar(car, persist = true) {
  selectedCar = car;
  if (persist) writeStorage('selectedCar', car.id);
  for (const button of document.querySelectorAll('[data-car-id]')) button.setAttribute('aria-pressed', String(button.dataset.carId === car.id));
  $('heroCar').innerHTML = carIllustration(car, 'hero-' + car.id);
  $('selectedCarName').textContent = car.name;
  $('selectedCarType').textContent = car.description || carLabels[car.type];
  $('selectedCarSpeed').textContent = String(car.maxSpeed);
  $('speedMax').textContent = String(car.maxSpeed);
  $('hudCarName').textContent = car.name;
}

function updateStartState() {
  $('startButton').disabled = authLoading || (!engineReady && !engineFailed);
  $('startButtonLabel').textContent = engineFailed ? 'بارگذاری دوباره' : engineReady && !authLoading ? 'بزن بریم' : 'در حال آماده‌سازی…';
  if (engineFailed) $('engineStatus').textContent = 'محیط بازی بارگذاری نشد؛ دوباره تلاش کن.';
  else if (engineReady && !authLoading) $('engineStatus').textContent = 'ماشینت آماده است. مسیر را تو انتخاب کن.';
  else if (authLoading) $('engineStatus').textContent = 'در حال بررسی حساب و آماده‌سازی محیط…';
}

function readyEngine() {
  if (engineReady) return;
  engineReady = true; engineFailed = false;
  updateStartState();
  window.dispatchEvent(new CustomEvent('game-volume', { detail: { volume: volume / 100 } }));
}

function showMenu() {
  if (isAdminPage) return;
  driving = false;
  window.dispatchEvent(new CustomEvent('game-menu'));
  document.body.classList.remove('in-game');
  document.body.classList.add('in-menu');
  $('startCard').hidden = false;
  $('gameplayUI').hidden = true;
  renderAccount();
  void flushProgress();
}

function startGame() {
  if (engineFailed) { window.location.reload(); return; }
  if (!engineReady || authLoading || isAdminPage) return;
  driving = true;
  document.body.classList.remove('in-menu');
  document.body.classList.add('in-game');
  $('startCard').hidden = true;
  $('gameplayUI').hidden = false;
  window.dispatchEvent(new CustomEvent('game-start', { detail: { carId: selectedCar.id } }));
  $('menuButton').focus({ preventScroll: true });
}

$('startButton').addEventListener('click', startGame);
$('menuButton').addEventListener('click', () => { showMenu(); $('startButton').focus({ preventScroll: true }); });
$('helpButton').addEventListener('click', () => openDialog('helpDialog'));
$('accountButton').addEventListener('click', () => openDialog('accountDialog'));
$('stripAccountButton').addEventListener('click', () => openDialog('accountDialog'));
$('loginTab').addEventListener('click', () => switchTab('login'));
$('registerTab').addEventListener('click', () => switchTab('register'));
document.querySelector('.account-tabs').addEventListener('keydown', event => {
  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    switchTab(event.key === 'Home' ? 'login' : event.key === 'End' ? 'register' : $('loginTab').getAttribute('aria-selected') === 'true' ? 'register' : 'login', true);
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && driving && !document.querySelector('dialog[open]')) {
    event.preventDefault(); showMenu(); $('startButton').focus({ preventScroll: true });
  }
});
window.addEventListener('game-ready', readyEngine);
window.addEventListener('game-error', () => {
  engineFailed = true; engineReady = false;
  if (driving) showMenu();
  updateStartState();
  showMessage('اجرای محیط رانندگی با مشکل روبه‌رو شد. صفحه را دوباره بارگذاری کن.');
});
window.addEventListener('game-progress', event => { if (!isAdminPage) collectProgress(event.detail); });
window.addEventListener('online', () => { if (accountActive()) void flushProgress(); });
window.addEventListener('pagehide', () => {
  if (!accountActive()) writeStorage('guest', guest);
});
document.addEventListener('visibilitychange', () => { if (document.hidden && driving) showMenu(); });

$('volumeSlider').value = String(volume);
$('volumeLabel').textContent = format(volume) + '٪';
$('volumeSlider').addEventListener('input', event => {
  volume = Number(event.target.value);
  $('volumeLabel').textContent = format(volume) + '٪';
  writeStorage('volume', volume);
  window.dispatchEvent(new CustomEvent('game-volume', { detail: { volume: volume / 100 } }));
});

function normalizeMobile(value) {
  return String(value).replace(/[۰-۹]/g, character => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(character)))
    .replace(/[٠-٩]/g, character => String('٠١٢٣٤٥٦٧٨٩'.indexOf(character))).replace(/[\s()-]/g, '');
}

async function submitAccount(event, kind) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const errorId = kind + 'Error';
  const button = form.querySelector('button[type=submit]');
  const fields = Object.fromEntries(new FormData(form));
  fields.mobile = normalizeMobile(fields.mobile);
  for (const name of ['firstName', 'lastName', 'nickname']) if (fields[name]) fields[name] = fields[name].trim();
  showError(errorId, '');
  button.disabled = true;
  try {
    if (flushPromise) await flushPromise;
    const { user } = await api('/api/' + kind, fields);
    setUser(user);
    form.reset();
    showMessage('خوش آمدی ' + currentUser.nickname + '؛ حساب تو آماده است. پیشرفت مهمان جداگانه در همین مرورگر می‌ماند.');
    $('accountDialog').close();
  } catch (error) { showError(errorId, error.message); }
  finally { button.disabled = false; }
}
$('loginForm').addEventListener('submit', event => void submitAccount(event, 'login'));
$('registerForm').addEventListener('submit', event => void submitAccount(event, 'register'));
$('logoutButton').addEventListener('click', async () => {
  const button = $('logoutButton'); button.disabled = true;
  try {
    clearTimeout(retryTimer);
    await flushProgress();
    await api('/api/logout', {});
    setUser(null);
    $('accountDialog').close();
    showMessage('از حساب خارج شدی. اکنون با پیشرفت مهمان همین مرورگر بازی می‌کنی.');
  } catch (error) { $('syncStatus').textContent = error.message; }
  finally { button.disabled = false; }
});

async function refreshAdmin(silent = false) {
  const button = $('refreshUsersButton'); button.disabled = true;
  showError('adminDashboardError', '');
  try {
    const { users } = await api('/api/admin/users');
    $('adminLoginPanel').hidden = true;
    $('adminDashboard').hidden = false;
    $('adminLogoutButton').hidden = false;
    const rows = Array.isArray(users) ? users : [];
    $('adminUserCount').textContent = format(rows.length);
    $('adminScoreCount').textContent = format(rows.reduce((total, row) => total + normalizeProgress(row.score), 0));
    $('adminCoinCount').textContent = format(rows.reduce((total, row) => total + normalizeProgress(row.coins), 0));
    $('adminEmpty').hidden = rows.length > 0;
    const body = $('adminUsersBody'); body.replaceChildren();
    for (const user of rows) {
      const row = document.createElement('tr');
      for (const value of [user.nickname, [user.firstName, user.lastName].filter(Boolean).join(' '), user.mobile, user.gender, format(user.score), format(user.coins)]) {
        const cell = document.createElement('td'); cell.textContent = value || '—'; row.append(cell);
      }
      body.append(row);
    }
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      $('adminLoginPanel').hidden = false;
      $('adminDashboard').hidden = true;
      $('adminLogoutButton').hidden = true;
      if (!silent) showError('adminError', error.message);
    } else {
      showError($('adminDashboard').hidden ? 'adminError' : 'adminDashboardError', error.message);
    }
  } finally { button.disabled = false; }
}

$('adminLoginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const button = form.querySelector('button[type=submit]'); button.disabled = true;
  showError('adminError', '');
  try {
    await api('/api/admin/login', Object.fromEntries(new FormData(form)));
    form.reset();
    await refreshAdmin();
  } catch (error) { showError('adminError', error.message); }
  finally { button.disabled = false; }
});
$('refreshUsersButton').addEventListener('click', () => void refreshAdmin());
$('adminLogoutButton').addEventListener('click', async () => {
  const button = $('adminLogoutButton'); button.disabled = true;
  try {
    await api('/api/logout', {});
    $('adminLoginPanel').hidden = false; $('adminDashboard').hidden = true; button.hidden = true;
  } catch (error) { showError('adminDashboardError', error.message); }
  finally { button.disabled = false; }
});

renderCars();
renderAccount();
if (isAdminPage) {
  document.body.classList.remove('in-menu');
  document.body.classList.add('is-admin');
  $('startCard').hidden = true;
  $('adminPage').hidden = false;
  document.title = 'پنل مدیریت | بازی ماشین';
  void refreshAdmin(true);
} else {
  const bootstrapVersion = authVersion;
  void api('/api/me').then(({ user }) => { if (authVersion === bootstrapVersion) setUser(user); }).catch(error => {
    showMessage('حساب فعلی بررسی نشد؛ فعلاً با حساب مهمان بازی می‌کنی. ' + error.message);
  }).finally(() => { authLoading = false; updateStartState(); });
  if (window.carGame) readyEngine();
  // Also detects readiness if an engine booted before this module subscribed.
  const readyPoll = setInterval(() => {
    if (window.carGame) { clearInterval(readyPoll); readyEngine(); }
    else if (engineFailed) clearInterval(readyPoll);
  }, 250);
  setTimeout(() => {
    clearInterval(readyPoll);
    if (!engineReady) { engineFailed = true; updateStartState(); }
  }, 30000);
  updateStartState();
}
