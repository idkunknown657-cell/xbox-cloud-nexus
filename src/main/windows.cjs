/**
 * Window management — main window (launcher UI) + stream windows (per game).
 * Stream windows load ONLY official xbox.com/play pages. Better xCloud and the
 * control profile are injected from a document-start preload (stream-preload.cjs),
 * which asks the main process for its bundle via synchronous IPC.
 */
const path = require('path');
const { BrowserWindow, shell, session } = require('electron');

const ALLOWED_STREAM_ORIGINS = new Set(['https://www.xbox.com']);

class WindowManager {
  constructor(deps) {
    this.store = deps.store;
    this.log = deps.log;
    this.sendToRenderer = deps.sendToRenderer;
    this.getStreamBundle = deps.getStreamBundle || (() => null); // (productId) => bundle
    this.mainWindow = null;
    this.streamWindows = new Map(); // productId -> BrowserWindow
  }

  // ---------- Main window ----------
  createMainWindow() {
    const winCfg = this.store.get('window') || {};
    const bounds = winCfg.rememberBounds && winCfg.bounds ? winCfg.bounds : { width: 1440, height: 900 };

    const win = new BrowserWindow({
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      minWidth: 940,
      minHeight: 600,
      show: false,
      frame: false,               // custom title bar for a native-app feel
      backgroundColor: '#0b0f0d',
      icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
      title: 'Xbox Cloud Nexus',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        spellcheck: false,
      },
    });

    if (winCfg.mode === 'maximized' || winCfg.startMaximized) win.maximize();
    if (winCfg.mode === 'fullscreen') win.setFullScreen(true);

    win.once('ready-to-show', () => win.show());
    let saveTimer = null;
    const saveBounds = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        if (!win.isDestroyed() && !win.isFullScreen()) this.store.set('window.bounds', win.getNormalBounds());
      }, 400);
    };
    win.on('resize', saveBounds);
    win.on('move', saveBounds);
    win.on('maximize', () => this.sendToRenderer('window:state', { maximized: true, fullscreen: false }));
    win.on('unmaximize', () => this.sendToRenderer('window:state', { maximized: false, fullscreen: false }));
    win.on('enter-full-screen', () => this.sendToRenderer('window:state', { fullscreen: true, maximized: false }));
    win.on('leave-full-screen', () => this.sendToRenderer('window:state', { fullscreen: false, maximized: win.isMaximized() }));
    win.on('closed', () => { this.mainWindow = null; });

    win.loadURL('nexus://app/index.html');
    this.mainWindow = win;
    return win;
  }

  // ---------- Stream windows ----------
  /**
   * Open (or focus) the official xbox.com play experience for a product.
   * @param {{productId:string, title:string, locale:string, fullscreen?:boolean}} opts
   */
  async launchGame(opts) {
    const productId = String(opts.productId || '').trim();
    if (!/^[A-Z0-9]{6,12}$/i.test(productId)) throw new Error('Invalid product id');
    const locale = (opts.locale || 'en-US').replace(/[^a-zA-Z-]/g, '');

    const existing = this.streamWindows.get(productId);
    if (existing && !existing.isDestroyed()) {
      existing.focus();
      return { reused: true };
    }

    const cloud = this.store.get('cloud') || {};
    const fullscreen = opts.fullscreen != null ? !!opts.fullscreen : cloud.fullscreenOnPlay !== false;

    const win = new BrowserWindow({
      width: 1280,
      height: 720,
      minWidth: 640,
      minHeight: 480,
      show: false,
      backgroundColor: '#000000',
      title: opts.title || 'Xbox Cloud Gaming',
      autoHideMenuBar: true,
      icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'stream-preload.cjs'),
        // BX must patch the page's real context at document-start:
        contextIsolation: false,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });

    // Lockdown: stream windows may only ever see official play pages.
    win.webContents.on('will-navigate', (e, url) => {
      try {
        const u = new URL(url);
        const ok = ALLOWED_STREAM_ORIGINS.has(u.origin) && u.pathname.includes('/play');
        if (!ok) { e.preventDefault(); this.log.warn('stream', 'Blocked navigation:', u.origin + u.pathname); }
      } catch { e.preventDefault(); }
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      this.log.warn('stream', 'Blocked window.open:', String(url).slice(0, 80));
      return { action: 'deny' };
    });

    win.webContents.on('did-finish-load', () => {
      this.sendToRenderer('stream:status', { productId, state: 'loaded', title: opts.title });
    });
    // Native-feeling window keys: F11 fullscreen, F12 reload, Esc leaves
    // fullscreen when the page itself does not handle it.
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      if (input.key === 'F11') {
        event.preventDefault();
        win.setFullScreen(!win.isFullScreen());
      } else if (input.key === 'F12') {
        event.preventDefault();
        win.webContents.reload();
      }
    });
    win.webContents.on('render-process-gone', (_e, details) => {
      this.log.error('stream', `renderer gone (${opts.title}):`, details.reason);
      this.sendToRenderer('stream:status', { productId, state: 'crashed', title: opts.title, reason: details.reason });
    });
    win.on('closed', () => {
      this.streamWindows.delete(productId);
      this.sendToRenderer('stream:status', { productId, state: 'closed', title: opts.title });
    });

    this.streamWindows.set(productId, win);

    const url = `https://www.xbox.com/${locale}/play`;
    await win.loadURL(url);

    win.once('ready-to-show', () => {
      if (fullscreen) win.setFullScreen(true);
      win.show();
    });

    return { reused: false };
  }

  /** Toggle (or set) fullscreen for a running game window. */
  setStreamFullscreen(productId, on) {
    const win = this.streamWindows.get(productId);
    if (!win || win.isDestroyed()) return false;
    win.setFullScreen(on == null ? !win.isFullScreen() : !!on);
    return win.isFullScreen();
  }

  focusStream(productId) {
    const win = this.streamWindows.get(productId);
    if (win && !win.isDestroyed()) { win.focus(); return true; }
    return false;
  }

  closeStream(productId) {
    const win = this.streamWindows.get(productId);
    if (win && !win.isDestroyed()) win.close();
  }

  closeAllStreams() {
    for (const [, win] of this.streamWindows) { try { win.close(); } catch { /* ignore */ } }
  }

  applyWindowMode(mode) {
    const win = this.mainWindow;
    if (!win) return;
    switch (mode) {
      case 'fullscreen':
      case 'borderless': win.setFullScreen(true); break;
      case 'maximized': win.setFullScreen(false); win.maximize(); break;
      default: win.setFullScreen(false); win.unmaximize(); break;
    }
    this.store.set('window.mode', mode);
  }
}

module.exports = { WindowManager };
