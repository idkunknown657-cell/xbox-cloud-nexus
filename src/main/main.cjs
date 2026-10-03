/**
 * Xbox Cloud Nexus — main process entry.
 * Owns app lifecycle, security policy, windows, catalog, settings and the IPC API.
 */
const { app, ipcMain, dialog, shell, session, BrowserWindow, globalShortcut, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ---------- Renderer scheme ----------
// Chromium blocks ES modules served over file:// (origin is opaque). We register
// a privileged standard scheme so the launcher UI loads as a real web origin.
protocol.registerSchemesAsPrivileged([{
  scheme: 'nexus',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

const { Logger } = require('./logger.cjs');
const { Store } = require('./store.cjs');
const { Catalog, LIST_IDS } = require('./catalog.cjs');
const { WindowManager } = require('./windows.cjs');
const { buildStreamBundle } = require('./stream-bridge.cjs');
const { readBxScript, BXCLOUD_VERSION } = require('./bxcloud.cjs');
const { readAccount, AUTH_PROBE_MS } = require('./xbox-account.cjs');

// ---------- Single instance ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (winMgr?.mainWindow) {
      if (winMgr.mainWindow.isMinimized()) winMgr.mainWindow.restore();
      winMgr.mainWindow.focus();
    }
  });
}

// ---------- Security hardening ----------
app.commandLine.appendSwitch('disable-features', 'AutofillServerCommunication');

let winMgr = null;
let appQuitting = false;

/**
 * Which control profile a launch should use. A per-game override wins over the
 * active profile; anything missing falls back rather than blocking the launch.
 */
function resolveProfileFor(settings, productId) {
  const gameProfiles = settings?.input?.gameProfiles || {};
  const profileId = (productId && gameProfiles[productId]) || settings?.input?.activeProfile;
  const profiles = settings?.input?.profiles || [];
  return profiles.find((p) => p.id === profileId) || profiles[0] || null;
}

/** Push an event to the launcher window (silent if it is not up yet). */
function pushToRenderer(channel, payload) {
  try {
    if (winMgr?.mainWindow && !winMgr.mainWindow.isDestroyed()) {
      winMgr.mainWindow.webContents.send(channel, payload);
    }
  } catch { /* window went away mid-send */ }
}

/**
 * Push to every launcher surface, not just the tracked main window: the
 * catalog download is shared, so a second launcher window must see it too.
 */
function pushToLaunchers(channel, payload) {
  if (appQuitting) return;
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
    const url = win.webContents.getURL();
    if (url && !url.startsWith('nexus://app/')) continue;
    try { win.webContents.send(channel, payload); } catch { /* window went away */ }
  }
}

// ---------- Globals ----------
const isDev = process.argv.includes('--dev');
const isSmoke = process.argv.includes('--smoke');
const log = new Logger(1200);
log.enableDebug(isDev || isSmoke);

// Bundles awaiting pickup by a stream window's preload (sync IPC).
const pendingStreamBundles = new Map();
// Per-session metadata for running streams (ad-supported flag, title…).
const streamMeta = new Map();

const userDataDir = path.join(app.getPath('userData'));
const settingsPath = path.join(userDataDir, 'settings.json');
const store = new Store(settingsPath, log);
const catalog = new Catalog(path.join(userDataDir, 'cache'), log);

// HW acceleration toggle must be applied before app ready.
if (store.get('performance.hwAccel') === false) {
  app.disableHardwareAcceleration();
  log.info('perf', 'Hardware acceleration disabled by settings');
}

// ---------- Market/locale ----------
function marketInfo() {
  const locale = store.get('cloud.preferredLocale') || 'en-US';
  // Splitting on "-" is not enough: es-419 yields a "419" market and zh-Hant-TW
  // yields "Hant", both of which the catalogue answers with 404s — an empty
  // library forever. Ask Intl for the real region subtag and validate it.
  let market = '';
  try {
    const region = new Intl.Locale(locale).maximize().region || '';
    if (/^[A-Za-z]{2}$/.test(region)) market = region.toUpperCase();
  } catch { /* an unparseable locale is a fallback, not a failure */ }
  // The catalogue wants exactly ll-CC, e.g. en-us. Anything else 400s.
  const language = /^[a-z]{2,3}-[A-Za-z]{2}$/.test(locale) ? locale.toLowerCase() : 'en-US';
  return { locale, market: market || 'US', language };
}

// ---------- Session: main window uses isolated session; stream windows get their own ----------
function configureSessions() {
  // Stream session (persists MS login inside its own profile)
  const streamSession = session.fromPartition('persist:stream');
  streamSession.setPermissionRequestHandler((wc, permission, cb) => {
    const allow = ['fullscreen', 'pointerLock', 'media', 'audioCapture', 'videoCapture', 'gamepad', 'notifications'].includes(permission);
    cb(allow);
  });
  // Block permission deletions that would degrade streaming.
  streamSession.setPermissionCheckHandler((wc, permission) => {
    return ['fullscreen', 'pointerLock', 'media', 'audioCapture', 'videoCapture', 'gamepad'].includes(permission);
  });
}

// ---------- IPC API ----------
function registerIpc() {
  const wrap = (fn) => async (event, ...args) => {
    const wc = event.sender;
    try {
      // Authorise by origin, not by object identity: only our own renderer
      // origin (nexus://app/) or a stream window may use this API.
      const isMain = wc === winMgr?.mainWindow?.webContents;
      const isNexusApp = String(wc.getURL() || '').startsWith('nexus://app/');
      const isStream = wc.session === session.fromPartition('persist:stream');
      if (!isMain && !isNexusApp && !isStream) throw new Error('Forbidden');
      return { ok: true, result: await fn(...args) };
    } catch (err) {
      log.error('ipc', fn.name || 'anon', err.message);
      return { ok: false, error: err.message || String(err) };
    }
  };

  /** Same authorisation as wrap(), but the handler also receives the sender. */
  const wrapSender = (fn) => async (event, ...args) => {
    const wc = event.sender;
    try {
      const isMain = wc === winMgr?.mainWindow?.webContents;
      const isNexusApp = String(wc.getURL() || '').startsWith('nexus://app/');
      const isStream = wc.session === session.fromPartition('persist:stream');
      if (!isMain && !isNexusApp && !isStream) throw new Error('Forbidden');
      return { ok: true, result: await fn(wc, ...args) };
    } catch (err) {
      log.error('ipc', fn.name || 'anon', err.message);
      return { ok: false, error: err.message || String(err) };
    }
  };

  // ---- Settings ----
  ipcMain.handle('settings:get', wrap(() => store.data));
  ipcMain.handle('settings:set', wrap((keyPath, value) => { store.set(String(keyPath), value); return true; }));
  ipcMain.handle('settings:resetAll', wrap(() => { store.resetAll(); return store.data; }));
  ipcMain.handle('settings:flush', wrap(() => { store.flushSync(); return true; }));

  // ---- Catalog ----
  // One background detail fetch at a time: a second request (a refresh, a second
// window) must not restart the whole 900-product download.
let catalogTail = null;
let catalogTailKey = '';

ipcMain.handle('catalog:library', wrap(async () => {
    const { market, language } = marketInfo();
    const lib = await catalog.getLibrary(market, language);
    const key = `${market}-${language}`;
    // The smoke test drives the download itself; two concurrent full fetches
    // only earn us throttling from the public endpoint.
    if (!isSmoke && lib.missing.length && !(catalogTail && catalogTailKey === key)) {
      catalogTailKey = key;
      catalogTail = catalog.fetchMissing(lib.missing, market, language, (batch) => {
        const details = {};
        for (const [id, p] of batch) details[id] = p;
        pushToLaunchers('catalog:details', { details });
      })
        .catch((err) => log.warn('catalog', 'background details failed:', err.message))
        .finally(() => { catalogTail = null; catalogTailKey = ''; });
    }
    return { lists: lib.lists, details: lib.details, fetchedAt: lib.fetchedAt };
  }));
  ipcMain.handle('catalog:product', wrap((id) => {
    const { market, language } = marketInfo();
    return catalog.getProduct(String(id), market, language);
  }));
  ipcMain.handle('catalog:listsMeta', wrap(() => LIST_IDS));

  // ---- Launch ----
  ipcMain.handle('app:launchGame', wrap(async (opts) => {
    const productId = opts?.productId;
    const { locale } = marketInfo();
    const settings = store.data;
    const profile = resolveProfileFor(settings, productId);
    const bundle = buildStreamBundle(settings, profile, path.join(__dirname, '..', '..'), log);
    if (productId) pendingStreamBundles.set(productId, bundle);
    // Remember how this session is paid for: free-with-ads titles show an
    // Xbox-served pre-roll before the stream, and the in-game panel explains it.
    if (productId) streamMeta.set(productId, { adSupported: opts?.adSupported === true, title: opts?.title || '' });
    try {
      const res = await winMgr.launchGame({ ...opts, locale });
      if (productId) recordRecent(productId);
      return res;
    } catch (err) {
      if (productId) pendingStreamBundles.delete(productId);
      throw err;
    }
  }));

  // ---- App info / UX ----
  ipcMain.handle('app:info', wrap(() => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    hw: { cpus: os.cpus().length, memGB: Math.round(os.totalmem() / 1073741824 * 10) / 10 },
    bx: { version: readBxScript(path.join(__dirname, '..', '..')).version || BXCLOUD_VERSION },
    locale: app.getLocale(),
  })));
  ipcMain.handle('app:debugLogs', wrap(() => log.getLines()));
  ipcMain.handle('app:toggleDevTools', wrap(() => {
    const wc = BrowserWindow.fromFocus()?.webContents || winMgr?.mainWindow?.webContents;
    if (wc) wc.toggleDevTools();
    return true;
  }));
  ipcMain.handle('app:openExternal', wrap((url) => {
    if (/^https:\/\/(www\.)?(github\.com|xbox\.com|microsoft\.com)/.test(String(url))) {
      shell.openExternal(String(url));
      return true;
    }
    throw new Error('URL not allowed');
  }));

  // ---- Account ----
  ipcMain.handle('auth:status', wrap((arg) => authStatus({ probePage: arg?.probe === true })));
  // The single entry point the whole UI uses to start signing in.
  ipcMain.handle('auth:signIn', wrap(async () => {
    const { locale } = marketInfo();
    const res = await winMgr.openSignInWindow(locale);
    // Bring the sign-in window in front of the launcher: a window that opens
    // behind a maximized frameless window looks exactly like nothing happened.
    try { winMgr.signInWindow?.show(); winMgr.signInWindow?.focus(); } catch { /* ignore */ }
    return { ...(await authStatus({ probePage: true })), ...res, window: winMgr.signInWindowState() };
  }));
  ipcMain.handle('auth:signInUrl', wrap(() => {
    const { locale } = marketInfo();
    return winMgr.signInUrl(locale);
  }));
  ipcMain.handle('auth:windowState', wrap(() => winMgr.signInWindowState()));
  ipcMain.handle('auth:closeWindow', wrap(() => { winMgr.closeSignInWindow(); return true; }));
  // Fallback for locked-down networks: the official page in the user's browser.
  ipcMain.handle('auth:openInBrowser', wrap(() => {
    const { locale } = marketInfo();
    return winMgr.openSignInInBrowser(locale);
  }));
  ipcMain.handle('auth:signOut', wrap(async () => {
    const ses = session.fromPartition('persist:stream');
    // Only the stream partition is cleared: that is where the Xbox session
    // lives, so signing out cannot touch anything else on the machine.
    await ses.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] });
    // The cache holds rendered Microsoft pages; leaving them behind makes a
    // signed-out session look half-signed-in on the next attempt.
    try { await ses.clearCache(); } catch { /* not fatal */ }
    store.set('account.signedIn', false);
    store.set('account.gamertag', '');
    store.set('account.xuid', '');
    store.set('account.avatarUrl', '');
    store.set('account.sessionState', 'none');
    store.set('account.plan', 'auto');
    store.set('account.planSource', 'signedOut');
    pushToLaunchers('auth:changed', { signedIn: false, gamertag: '', plan: 'auto', planSource: 'signedOut', sessionState: 'none' });
    return { signedIn: false, gamertag: '', xuid: '', avatarUrl: '', plan: 'auto', planSource: 'signedOut', sessionState: 'none', planKnown: false };
  }));
  // The player can declare their tier once if the signed-in page cannot be read.
  ipcMain.handle('auth:setPlan', wrap(async (plan) => {
    const allowed = ['auto', 'ultimate', 'pc', 'console', 'core', 'standard', 'none'];
    const value = String(plan || 'auto');
    if (!allowed.includes(value)) throw new Error('Unknown plan');
    store.set('account.plan', value);
    store.set('account.planSource', value === 'auto' ? 'unknown' : 'manual');
    const s = await authStatus({ probePage: value === 'auto' });
    pushToLaunchers('auth:changed', s);
    return s;
  }));

  // ---- Window controls (custom titlebar) ----
  ipcMain.handle('win:minimize', wrap(() => { winMgr.mainWindow?.minimize(); return true; }));
  ipcMain.handle('win:maximizeToggle', wrap(() => {
    const w = winMgr.mainWindow; if (!w) return false;
    if (w.isMaximized()) w.unmaximize(); else w.maximize();
    return w.isMaximized();
  }));
  ipcMain.handle('win:close', wrap(() => { winMgr.mainWindow?.close(); return true; }));
  ipcMain.handle('win:mode', wrap((mode) => { winMgr.applyWindowMode(String(mode)); return true; }));

  // ---- Profiles import/export ----
  ipcMain.handle('profiles:export', wrap(async (profile) => {
    const res = await dialog.showSaveDialog(winMgr.mainWindow, {
      title: 'Export control profile',
      defaultPath: `nexus-profile-${profile?.name || 'profile'}.json`.replace(/\s+/g, '-').toLowerCase(),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePath) return null;
    fs.writeFileSync(res.filePath, JSON.stringify({ kind: 'nexus-profile', version: 1, profile }, null, 2));
    return res.filePath;
  }));
  ipcMain.handle('profiles:import', wrap(async () => {
    const res = await dialog.showOpenDialog(winMgr.mainWindow, {
      title: 'Import control profile',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths?.[0]) return null;
    const raw = fs.readFileSync(res.filePaths[0], 'utf8');
    const j = JSON.parse(raw);
    if (j.kind !== 'nexus-profile' || !j.profile || typeof j.profile !== 'object') throw new Error('Not a valid Nexus profile file');
    return j.profile;
  }));

  // ---- Game profile per game ----
  ipcMain.handle('profiles:assignGame', wrap((productId, profileId) => {
    if (!productId) throw new Error('missing product');
    if (profileId == null) { delete store.data.input.gameProfiles[productId]; store.save(); return true; }
    store.set(`input.gameProfiles.${productId}`, String(profileId));
    return true;
  }));

  // ---- Stream events (controller relay etc.) ----
  ipcMain.on('stream:event', (event, payload) => {
    const wc = event.sender;
    if (wc.session !== session.fromPartition('persist:stream')) return;
    if (!payload || typeof payload !== 'object') return;
    if (payload.kind === 'controller') {
      winMgr.sendToRenderer('controllers:changed', { connected: !!payload.connected, id: payload.id || '' });
    }
  });

  ipcMain.handle('stream:setFullscreen', wrap((productId, on) => {
    if (!String(productId || '').match(/^[A-Z0-9]{6,12}$/i)) throw new Error('Invalid product id');
    return winMgr.setStreamFullscreen(productId, on);
  }));

  // ---- In-game panel (the Configure Controls overlay inside a stream window) ----
  ipcMain.handle('stream:ui', wrapSender(async (wc, cmd) => {
    const payload = cmd && typeof cmd === 'object' ? cmd : {};
    // The game is identified from the sending renderer, never from the payload:
    // a page cannot ask us to control somebody else's stream window.
    const productId = winMgr.productIdForWebContents(wc);
    const cloud = () => store.get('cloud', {}) || {};
    const meta = () => streamMeta.get(productId) || {};
    const state = () => ({
      productId,
      title: meta().title || '',
      adSupported: meta().adSupported === true,
      signedIn: store.get('account.signedIn', false) === true,
      kbmEnabled: store.get('input.kbmEnabled', true) !== false,
      resolution: cloud().targetResolution || 'auto',
      frameCap: Number(cloud().frameCap) || 0,
      invertY: (store.get('input.mouse', {}) || {}).invertY === true,
      mouseSensitivity: Number((store.get('input.mouse', {}) || {}).sensitivity) || 1,
    });
    switch (payload.kind) {
      case 'state':
        return state();
      case 'set-kbm': {
        store.set('input.kbmEnabled', !!payload.value);
        return state();
      }
      case 'set-sensitivity': {
        store.set('input.mouse.sensitivity', Math.min(4, Math.max(0.1, Number(payload.value) || 1)));
        return state();
      }
      case 'set-invert-y': {
        store.set('input.mouse.invertY', !!payload.value);
        return state();
      }
      case 'set-quality': {
        const allowed = ['auto', '720p', '1080p', '1080p-hq'];
        if (payload.resolution && allowed.includes(String(payload.resolution))) {
          store.set('cloud.targetResolution', String(payload.resolution));
        }
        if (payload.frameCap != null) store.set('cloud.frameCap', Math.max(0, Math.min(120, Number(payload.frameCap) || 0)));
        return { ...state(), needsRestart: true };
      }
      case 'restart':
        winMgr.reloadStream(productId);
        return state();
      case 'fullscreen':
        winMgr.setStreamFullscreen(productId, payload.value == null ? null : !!payload.value);
        return state();
      case 'open-controls':
        // Bring the launcher forward on the remapper, scoped to this game.
        if (winMgr.mainWindow && !winMgr.mainWindow.isDestroyed()) {
          if (winMgr.mainWindow.isMinimized()) winMgr.mainWindow.restore();
          winMgr.mainWindow.focus();
          pushToRenderer('app:open-controls', { productId });
        }
        return state();
      case 'close':
        winMgr.closeStream(productId);
        return { closed: true };
      default:
        return state();
    }
  }));

  // ---- Stream bundle (preload asks for it synchronously at document-start) ----
  ipcMain.on('stream:request-bundle', (event) => {
    const wc = event.sender;
    if (wc.session !== session.fromPartition('persist:stream')) { event.returnValue = null; return; }
    let bundle = null;
    for (const [pid, win] of winMgr.streamWindows) {
      if (!win.isDestroyed() && win.webContents === wc) { bundle = pendingStreamBundles.get(pid) || null; break; }
    }
    if (!bundle) bundle = buildStreamBundle(store.data, store.data.input.profiles[0], path.join(__dirname, '..', '..'), log);
    event.returnValue = bundle;
  });
}

// ---------- Renderer asset protocol ----------
const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
const BUILD_DIR = path.join(__dirname, '..', '..', 'build');
const APP_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https:; font-src 'self' data:";
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webp': 'image/webp',
};

/**
 * Map a nexus:// URL to a file on disk, refusing anything outside our roots.
 * Icons live in build/ but are exposed under the app host at /icons/* so they
 * share the renderer's origin (a different hostname would be a different CSP
 * 'self' and the images would be blocked).
 */
function resolveRendererAsset(rawUrl) {
  const url = new URL(rawUrl);
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (rel === '') rel = 'index.html';
  let root = RENDERER_DIR;
  if (url.hostname === 'build' || rel.startsWith('icons/')) {
    if (rel.startsWith('icons/')) rel = rel.slice(6);
    root = BUILD_DIR;
  }
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

function registerRendererProtocol() {
  protocol.handle('nexus', async (request) => {
    try {
      const filePath = resolveRendererAsset(request.url);
      if (!filePath) return new Response('Forbidden', { status: 403 });
      const data = await fs.promises.readFile(filePath);
      const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      return new Response(data, { headers: { 'content-type': type, 'content-security-policy': APP_CSP, 'cache-control': 'no-cache' } });
    } catch (err) {
      log.warn('protocol', 'asset failed:', String(request.url).slice(0, 120), err.code || err.message);
      return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    }
  });
}

/** Recent played bookkeeping */
function recordRecent(productId) {
  const list = store.data.recentPlayed || [];
  const next = [productId, ...list.filter((x) => x !== productId)].slice(0, 30);
  store.set('recentPlayed', next);
}

// ---------- Account / sign-in ----------
//
// The app never asks for Microsoft credentials itself. It opens the official
// Xbox Cloud Gaming page in its own window (same session partition as the
// games) and only *observes* the result: either the session holds an Xbox Live
// auth cookie, or the official page stops offering a "Sign in" action.
const AUTH_COOKIES = new Set(['XBXLive', 'XBXLiveSSO', 'RPSTAuth', 'xsts_uch', 'xbox_live_session']);
// 'none' | 'ok' | 'expired' — set by readAccount() from the official records.
let authTimer = null;

async function authStatus({ probePage = false } = {}) {
  let signedIn = store.get('account.signedIn', false) === true;
  let gamertag = store.get('account.gamertag', '') || '';
  let xuid = store.get('account.xuid', '') || '';
  let avatarUrl = store.get('account.avatarUrl', '') || '';
  let sessionState = store.get('account.sessionState', 'none') || 'none';
  // 'auto' means "ask Microsoft's page"; anything else is the player's own
  // declaration from Settings -> Account, which always wins.
  let plan = store.get('account.plan', 'auto') || 'auto';
  let planSource = store.get('account.planSource', '') || '';
  let detected = '';
  let page = null;

  // The two official records, read directly from the session partition.
  let cookies = [];
  try {
    cookies = await session.fromPartition('persist:stream').cookies.get({ domain: '.xbox.com' });
  } catch { /* keep the remembered values */ }
  if (probePage) {
    try { page = await winMgr?.readAccountFromSignInPage?.(); } catch { /* page not ready */ }
  }
  const account = readAccount({ userInfo: page?.userInfo || null, cookies });
  if (page?.pageSignedIn && !(page?.userInfo)) {
    // Page says signed in but storage was unreachable: trust the page, keep
    // whatever identity we already know.
    signedIn = true;
    sessionState = 'ok';
    if (page?.pageGamertag) gamertag = page.pageGamertag;
  } else if (cookies.length || page?.userInfo) {
    signedIn = account.signedIn;
    sessionState = account.state;
    if (account.gamertag) gamertag = account.gamertag;
    if (account.xuid) xuid = account.xuid;
    if (account.avatarUrl) avatarUrl = account.avatarUrl;
  }
  if (page?.plan) detected = page.plan;
  if (detected) {
    plan = detected;
    planSource = 'detected';
  } else if (planSource === 'manual' || planSource === 'detected') {
    // Keep what we already know until a readable page says otherwise.
  } else {
    // No readable page: never invent a plan, fall back to "no subscription".
    plan = 'none';
    planSource = signedIn ? 'unknown' : 'signedOut';
  }
  const changed = signedIn !== store.get('account.signedIn', false)
    || gamertag !== (store.get('account.gamertag', '') || '')
    || plan !== (store.get('account.plan', 'auto') || 'auto')
    || planSource !== (store.get('account.planSource', '') || '')
    || sessionState !== (store.get('account.sessionState', 'none') || 'none');
  store.set('account.signedIn', signedIn);
  store.set('account.gamertag', gamertag);
  store.set('account.xuid', xuid);
  store.set('account.avatarUrl', avatarUrl);
  store.set('account.sessionState', sessionState);
  store.set('account.plan', plan);
  store.set('account.planSource', planSource);
  store.set('account.checkedAt', Date.now());
  if (changed) pushToLaunchers('auth:changed', { signedIn, gamertag, plan, planSource, sessionState });
  return {
    signedIn,
    gamertag,
    xuid,
    avatarUrl,
    sessionState,
    plan,
    planSource,
    planKnown: signedIn && planSource === 'detected',
    onLoginPage: page?.onLogin === true,
    checkedAt: store.get('account.checkedAt'),
    probeMs: AUTH_PROBE_MS,
  };
}

/** Called whenever the sign-in window moves to another page. */
function onAuthProgress() {
  clearTimeout(authTimer);
  authTimer = setTimeout(() => { authStatus({ probePage: true }).catch(() => {}); }, 900);
}

// ---------- Lifecycle ----------
app.whenReady().then(() => {
  log.info('app', `Xbox Cloud Nexus v${app.getVersion()} starting`, { hwAccel: store.get('performance.hwAccel') });
  configureSessions();
  registerRendererProtocol();
  registerIpc();

  winMgr = new WindowManager({
    store, log,
    sendToRenderer: (ch, payload) => {
      if (winMgr?.mainWindow && !winMgr.mainWindow.isDestroyed()) {
        winMgr.mainWindow.webContents.send(ch, payload);
      }
    },
    getStreamBundle: (productId) => pendingStreamBundles.get(productId) || null,
    onAuthProgress,
  });

  // A remembered sign-in is re-verified in the background on every boot.
  authStatus().catch(() => {});

  winMgr.createMainWindow();

  // CSP belt-and-braces for anything the default session still serves locally.
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': APP_CSP } });
  });

  if (isSmoke) runSmokeTest();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  appQuitting = true;
  try { store.flushSync(); } catch { /* ignore */ }
  globalShortcut.unregisterAll();
});

/** Headless-ish smoke test for CI/build verification. */
async function runSmokeTest() {
  const results = [];
  const check = (name, cond, extra) => { results.push({ name, pass: !!cond, extra: extra || '' }); };
  try {
    check('settings loaded', store.data && store.data.app);
    check('catalog cache dir', fs.existsSync(path.join(userDataDir, 'cache')));
    const { market, language } = marketInfo();
    const lib = await catalog.getLibrary(market, language);
    check('library lists', lib && Object.keys(lib.lists).length >= 10, `${Object.keys(lib.lists).filter(k => lib.lists[k]).length} lists ok`);
    // Sample rather than pull the whole catalog: this checks the endpoint, the
    // parser and the cache path without a multi-minute cold download.
    const sample = lib.missing.slice(0, 200);
    const details = await catalog.fetchMissing(sample, market, language);
    const total = Object.keys({ ...lib.details, ...Object.fromEntries(details) }).length;
    check('library details', total > 50, `${total} products (of ${lib.missing.length} uncached)`);
    check('play-with-ads list', lib.lists.freeWithAds && lib.lists.freeWithAds.ids.length > 10, `${lib.lists.freeWithAds?.ids.length} ids`);
    const bx = readBxScript(path.join(__dirname, '..', '..'));
    check('bx script present', !!bx.code, `${bx.bytes} bytes v${bx.version}`);
    const { profileToBxMapping } = require('./stream-bridge.cjs');
    const m = profileToBxMapping(store.data.input.profiles[0]);
    check('profile mapping', m.mapping['0'] && m.mapping['0'][0] === 'Space', `A->${m.mapping['0']?.[0]}`);
    // A per-game override must reach the stream bundle that Better xCloud loads.
    const fps = { id: 'smoke-fps', name: 'Smoke FPS', builtin: false, mapping: { gamepadA: { key: 'Mouse0', code: 'Mouse0' } }, mouse: { ...store.data.input.mouse, invertY: true }, stick: { ...store.data.input.stick } };
    const withOverride = { input: { ...store.data.input, profiles: [...store.data.input.profiles, fps], gameProfiles: { 'SMOKE-PRODUCT': 'smoke-fps' } } };
    const chosen = resolveProfileFor(withOverride, 'SMOKE-PRODUCT');
    const overrideBundle = buildStreamBundle(withOverride, chosen, path.join(__dirname, '..', '..'), null);
    check('per-game profile resolves', chosen && chosen.id === 'smoke-fps', chosen?.name);
    check('per-game mapping reaches the preset',
      overrideBundle.bxPreset.data.mapping[0]?.[0] === 'Mouse0', `A->${overrideBundle.bxPreset.data.mapping[0]?.[0]}`);
    check('per-game mouse tuning reaches the preset',
      overrideBundle.bxPreset.data.mouse.sensitivityY < 0, `Y=${overrideBundle.bxPreset.data.mouse.sensitivityY}`);
    check('fallback profile when the game has no override',
      resolveProfileFor(store.data, 'OTHER-PRODUCT')?.id === store.data.input.activeProfile,
      resolveProfileFor(store.data, 'OTHER-PRODUCT')?.id);
    // Give renderer a moment to boot, then quit
    setTimeout(async () => {
      check('main window', winMgr.mainWindow && !winMgr.mainWindow.isDestroyed());
      let pass = true;
      for (const r of results) {
        console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.extra ? ' — ' + r.extra : ''}`);
        if (!r.pass) pass = false;
      }
      console.log(pass ? 'SMOKE OK' : 'SMOKE FAILED');
      store.flushSync();
      app.exit(pass ? 0 : 1);
    }, 6000);
  } catch (err) {
    console.error('SMOKE ERROR', err);
    results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`));
    app.exit(1);
  }
}

module.exports = {
  registerRendererProtocol,
  APP_CSP,
  resolveRendererAsset,
  marketInfo,
  registerIpc,
  makeStore: () => new Store(settingsPath, log),
  makeCatalog: () => new Catalog(path.join(userDataDir, 'cache'), log),
  getStore: () => store,
  getCatalog: () => catalog,
  setWindowManager: (wm) => { winMgr = wm; },
  getUserDataDir: () => userDataDir,
};