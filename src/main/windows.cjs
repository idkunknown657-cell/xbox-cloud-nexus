/**
 * Window management — main window (launcher UI) + stream windows (per game).
 * Stream windows load ONLY official xbox.com/play pages. Better xCloud and the
 * control profile are injected from a document-start preload (stream-preload.cjs),
 * which asks the main process for its bundle via synchronous IPC.
 */
const path = require('path');
const { app, BrowserWindow, shell, session, ipcMain } = require('electron');
const { readAccount, AUTO_SIGNIN_SCRIPT, USER_INFO_KEY } = require('./xbox-account.cjs');
const { productTitleToSlug, playUrl, launchUrl, launchScript } = require('./game-launch.cjs');

const ALLOWED_STREAM_ORIGINS = new Set(['https://www.xbox.com']);

class WindowManager {
  constructor(deps) {
    this.store = deps.store;
    this.log = deps.log;
    this.sendToRenderer = deps.sendToRenderer;
    this.getStreamBundle = deps.getStreamBundle || (() => null); // (productId) => bundle
    this.onAuthProgress = deps.onAuthProgress || (() => {});      // fired as the sign-in window changes page
    this.mainWindow = null;
    this.signInWindow = null;
    this.streamWindows = new Map(); // productId -> BrowserWindow
    this.streamVideo = new Map();   // productId -> last reported picture state
  }

  // ---------- Sign-in ----------
  /**
   * The official page we send people to for signing in.
   *
   * This is Microsoft's own sign-in entry point with a return URL, the same one
   * XFly uses (MIT, credited in README). Loading /play and then trying to find
   * and click a "Sign in" control was the reason sign-in worked for some people
   * and not others: the control is renamed, moved or already present depending
   * on the region and on whether a session cookie is half-alive. The auth entry
   * has no such variability — it always starts the real Microsoft flow and
   * always comes back to the play page.
   */
  signInUrl(locale = 'en-US') {
    const returnUrl = this.playUrl(locale);
    if (process.env.NEXUS_SIGNIN_URL) return process.env.NEXUS_SIGNIN_URL;
    return `https://www.xbox.com/auth/msa?action=logIn&returnUrl=${encodeURIComponent(returnUrl)}`;
  }

  /**
   * The official play page a game window loads.
   *
   * This is the *catalogue*: it is where the sign-in session lives and where the
   * in-page router is driven from. The specific title is started afterwards via
   * /play/launch/<slug>/<productId> — see game-launch.cjs. Overridable by the
   * test harness so the launch path can be exercised without a live stream.
   */
  playUrl(locale = 'en-US') {
    if (process.env.NEXUS_PLAY_URL) return process.env.NEXUS_PLAY_URL;
    return playUrl(locale);
  }

  /** Domains the in-app sign-in window is allowed to navigate to itself. */
  static signInHostAllowed(url) {
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
      return /(^|\.)(xbox\.com|xboxlive\.com|live\.com|microsoft\.com|microsoftonline\.com|msftauth\.net|msauth\.net|msn\.com|office\.com|akamaihd\.net|windows\.net)$/.test(u.hostname);
    } catch { return false; }
  }

  /**
   * Drop the stored Xbox session.
   *
   * Clearing the app's own account fields is not enough: the stale cookies and
   * cached service worker in the shared partition keep sending the next window
   * to a half-signed-in page that looks signed in and streams nothing. XFly
   * clears storage and cache on sign-out for the same reason (MIT).
   */
  async clearSession() {
    try {
      await session.fromPartition('persist:stream').clearStorageData();
      await session.fromPartition('persist:stream').clearCache();
      this.log.info('auth', 'signed out: xbox session storage cleared');
      return true;
    } catch (err) {
      this.log.warn('auth', 'could not clear the xbox session:', err.message);
      return false;
    }
  }

  /**
   * Drop the cached account because the real session is gone.
   *
   * Kept separate from clearSession(): nothing here touches cookies. The point
   * is to stop the launcher reporting an account that cannot play, so the next
   * action the player takes is signing in again rather than pressing Play.
   */
  markSessionRevoked() {
    this.store.set('account.signedIn', false);
    this.store.set('account.gamertag', '');
    this.store.set('account.xuid', '');
    this.store.set('account.avatarUrl', '');
    this.store.set('account.sessionState', 'expired');
    this.store.set('account.skippedSignIn', false);
    this.sendToRenderer('auth:changed', {
      signedIn: false, gamertag: '', plan: 'auto', planSource: 'signedOut', sessionState: 'expired',
    });
    // Drop the rejected cookie. Clearing the stored flags alone was not enough:
    // every status read re-derived "signed in" from this cookie, because it
    // still parsed and its own expiry had not passed. Xbox has already told us
    // it is worthless, so the launcher must stop believing it.
    const ses = session.fromPartition('persist:stream');
    ses.cookies.get({}).then((cookies) => {
      const dead = cookies.filter((c) => String(c.name || '').startsWith('XBXXtk'));
      if (!dead.length) return;
      return Promise.all(dead.map((c) => ses.cookies.remove(
        c.url || `https://www.xbox.com/`, c.name,
      ))).then(() => this.log.info('auth', `session revoked by xbox: dropped ${dead.length} stale token cookie(s)`));
    }).catch((err) => this.log.warn('auth', 'could not drop the stale token cookie:', err.message));
  }

  /**
   * Open the *official* Xbox Cloud Gaming page for signing in.
   *
   * We deliberately do not build our own credential form: the user signs in on
   * Microsoft's real page, inside the same session partition the games use, so
   * the password never passes through this app and one sign-in covers every
   * later launch.
   */
  async openSignInWindow(locale = 'en-US') {
    if (this.signInWindow && !this.signInWindow.isDestroyed()) {
      this.signInWindow.show();
      this.signInWindow.focus();
      return { reused: true, url: this.signInUrl(locale) };
    }
    const startUrl = this.signInUrl(locale);
    this.lastLocale = locale;
    this.signInError = '';
    this.signInClosing = false;
    const win = new BrowserWindow({
      width: 620,
      height: 840,
      minWidth: 420,
      minHeight: 560,
      // Shown immediately: waiting for the page to finish meant a slow network
      // looked exactly like a button that does nothing.
      show: true,
      title: 'Sign in — Xbox Cloud Gaming',
      backgroundColor: '#000000',
      autoHideMenuBar: true,
      icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
      webPreferences: {
        // Same partition as the stream windows: sign in once, play everywhere.
        partition: 'persist:stream',
        // The auto sign-in helper has to run in the page's own context at
        // document-start, exactly like the Better xCloud bridge does for games.
        contextIsolation: false,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    win.webContents.on('did-finish-load', () => {
      // Take the player straight to Microsoft's own sign-in form instead of
      // leaving them hunting for a button on the play page.
      try { win.webContents.executeJavaScript(AUTO_SIGNIN_SCRIPT, true).catch(() => {}); } catch { /* ignore */ }
    });

    const allowed = (url) => WindowManager.signInHostAllowed(url);

    // Anything outside the Microsoft/Xbox estate (and any non-web scheme) is
    // handed to the real browser instead of being silently dropped, so a
    // redirect we did not anticipate can never dead-end the sign-in.
    win.webContents.on('will-navigate', (e, url) => {
      if (allowed(url)) return;
      e.preventDefault();
      this.log.warn('auth', 'External sign-in link handed to the browser:', String(url).slice(0, 120));
      try { shell.openExternal(url); } catch { /* ignore */ }
    });

    // Microsoft's sign-in sometimes opens itself in a popup. A popup would be a
    // second window we do not track, and it is where the session has to stick:
    // load it in *this* window instead, which keeps exactly one session for
    // everything. Allowing the popup as a separate window crashed on close.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (allowed(url)) {
        this.log.info('auth', 'Popup loaded in the sign-in window:', String(url).slice(0, 80));
        setTimeout(() => {
          if (win.isDestroyed()) return;
          win.loadURL(url).catch(() => { /* reported by did-fail-load */ });
        }, 0);
        return { action: 'deny' };
      }
      this.log.warn('auth', 'External popup handed to the browser:', String(url).slice(0, 120));
      try { shell.openExternal(url); } catch { /* ignore */ }
      return { action: 'deny' };
    });
    win.webContents.on('did-finish-load', () => this.onAuthProgress());
    win.webContents.on('did-navigate', () => this.onAuthProgress());
    win.webContents.on('did-navigate-in-page', () => this.onAuthProgress());
    win.webContents.on('render-process-gone', (_e, details) => {
      this.log.error('auth', 'Sign-in renderer gone:', details.reason);
      this.reportSignInFailure(`The sign-in window stopped responding (${details.reason}).`);
    });
    win.webContents.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
      // -3 = user aborted; -2 and ERR_ABORTED happen while the window is being
      // torn down or an antiscripted subframe is cancelled, not a real failure.
      if (!isMainFrame || code === -3 || code === -2 || win.isDestroyed()) return;
      this.log.error('auth', 'Sign-in page failed to load:', code, desc, String(failedUrl).slice(0, 80));
      this.reportSignInFailure(`Microsoft's sign-in page could not be loaded (${desc || code}).`);
    });
    win.on('closed', () => { this.signInWindow = null; this.signInClosing = true; this.onAuthProgress(); });

    this.signInWindow = win;
    try { win.show(); win.focus(); } catch { /* ignore */ }

    // Deliberately NOT awaited. A slow or hanging xbox.com used to leave the
    // launcher waiting on this promise, so the sign-in button looked dead for as
    // long as the page took (or forever). The window is already up; the UI
    // follows its progress through signInWindowState() instead.
    win.loadURL(startUrl).catch((err) => {
      // A window the *user* closed while it was still loading is not a failure:
      // reporting it would flash an error at somebody who just hit X.
      if (win.isDestroyed() || this.signInClosing) return;
      // xbox.com always aborts its own first navigation (ERR_ABORTED / -3) when
      // it hands off to the Microsoft sign-in flow. Treating that as "cannot
      // reach xbox.com" would claim a dead connection while the player is
      // signing in perfectly well, and pop a browser for nothing.
      const errno = Number(err?.errno);
      if (errno === -3 || errno === -2 || /ABORTED/i.test(String(err?.code || ''))) {
        this.log.info('auth', 'sign-in navigation superseded by Microsoft (expected)');
        return;
      }
      this.log.warn('auth', 'loadURL rejected:', err.message);
      this.reportSignInFailure('Could not reach xbox.com.');
    });

    // Watchdog: a load that never finishes must not look like patience.
    clearTimeout(this.signInWatchdog);
    this.signInWatchdog = setTimeout(() => {
      if (win.isDestroyed() || this.signInWindow !== win) return;
      if (win.webContents.isLoading()) {
        this.log.warn('auth', 'sign-in page still loading after 20s');
        this.sendToRenderer('auth:error', {
          message: 'Microsoft’s sign-in page is taking a long time to load. Use “Open in my browser” if it never appears.',
          slow: true,
        });
      }
    }, 20000);
    win.on('closed', () => { clearTimeout(this.signInWatchdog); this.signInWatchdog = null; });

    return { reused: false, url: startUrl };
  }

  /**
   * Tell the launcher that the embedded page is not going to load, and make the
   * promise of a fallback real by opening it straight away. Network-level
   * failures are the ones Microsoft's page cannot fix by itself.
   */
  reportSignInFailure(message) {
    const text = `${message} Opening Microsoft's sign-in page in your browser instead.`;
    this.signInError = text;
    this.sendToRenderer('auth:error', { message: text, autoOpenedBrowser: true });
    // Test harnesses must never launch a real browser window.
    if (process.env.NEXUS_NO_AUTO_BROWSER === '1') return;
    try { shell.openExternal(this.signInUrl(this.lastLocale || 'en-US')); } catch { /* ignore */ }
  }

  /** Open the same official page in the user's own browser (fallback path). */
  async openSignInInBrowser(locale = 'en-US') {
    this.lastLocale = locale;
    const url = this.signInUrl(locale);
    try {
      await shell.openExternal(url);
      this.signInError = '';
      return { opened: true, url };
    } catch (err) {
      // Never pretend it worked: the UI keeps the gate open and says so.
      this.log.error('auth', 'openExternal failed:', err.message);
      this.sendToRenderer('auth:error', {
        message: `Your browser could not be opened automatically. Copy this link into a browser: ${url}`,
        url,
      });
      throw new Error(`Could not open your browser (${err.message}). Sign in at ${url}`);
    }
  }

  /** Is the sign-in window up, and which page is it showing? */
  signInWindowState() {
    const win = this.signInWindow;
    if (!win || win.isDestroyed()) return { open: false, url: '', loading: false, error: this.signInError || '' };
    let url = '';
    try { url = String(win.webContents.getURL() || ''); } catch { /* mid-teardown */ }
    return {
      open: true,
      url,
      host: (() => { try { return new URL(url).hostname; } catch { return ''; } })(),
      loading: !win.webContents.isDestroyed() && win.webContents.isLoading(),
      error: this.signInError || '',
    };
  }

  closeSignInWindow() {
    this.signInClosing = true;
    const win = this.signInWindow;
    // Detach BEFORE closing. The load is often still in flight, and every path
    // that could then run (auth:signIn's focus, the page probe, windowState)
    // must see "no window" rather than an object mid-destruction — touching a
    // half-destroyed webContents takes the whole app down with it.
    this.signInWindow = null;
    if (win && !win.isDestroyed()) {
      try { win.close(); } catch { /* already gone */ }
    }
    this.onAuthProgress();
  }

  /** Best-effort account read from the official page (never credentials). */
  async readAccountFromSignInPage() {
    const win = this.signInWindow;
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return null;
    // executeJavaScript waits for a loading page; asking mid-redirect used to
    // park the caller until the page settled (or forever). Skip and retry later.
    if (win.webContents.isLoading()) return null;
    const probe = win.webContents.executeJavaScript(`(() => {
      const txt = (el) => (el && (el.textContent || '').trim()) || '';
      // The page's own session record: the authoritative "who am I" answer.
      // Only the identity fields are read out; the token block inside it is
      // never touched.
      let userInfo = null;
      try { userInfo = localStorage.getItem(${JSON.stringify(USER_INFO_KEY)}); } catch (e) { userInfo = null; }
      // A visible "Sign in" affordance means the session is not authenticated.
      const signIn = Array.from(document.querySelectorAll('a,button'))
        .map((el) => txt(el).toLowerCase())
        .find((s) => s === 'sign in' || s === 'sign in to play' || s === 'sign in now');
      const profile = document.querySelector('[aria-label*="profile" i],[class*="ProfileButton"],[data-testid*="profile" i]');
      const pageGamertag = profile ? (profile.getAttribute('aria-label') || txt(profile)).replace(/profile/i, '').trim().slice(0, 40) : '';
      // Which subscription does THIS account have? Read it off Microsoft's own
      // page copy — no token is requested, read or stored. The launcher uses
      // this only to label games honestly; Microsoft still decides every launch.
      const body = (document.body && document.body.innerText) || '';
      const plan = /game pass ultimate/i.test(body) ? 'ultimate'
        : /game pass console/i.test(body) ? 'console'
        : /game pass pc\\b/i.test(body) ? 'pc'
        : /game pass core/i.test(body) ? 'core'
        : /game pass standard/i.test(body) ? 'standard'
        : /game pass\\b/i.test(body) ? 'any'
        : '';
      return {
        userInfo,
        pageSignedIn: !signIn && !!userInfo,
        pageGamertag,
        plan,
        onLogin: location.hostname.includes('login.') || location.pathname.includes('/auth/msa'),
        href: location.href.slice(0, 120),
      };
    })()`, true);
    // Never let a wedged page stall an IPC reply.
    const timeout = new Promise((r) => setTimeout(() => r(null), 2500));
    try { return await Promise.race([probe, timeout]); } catch { return null; }
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
        // Off on purpose: the stream keeps its own decode/network pipeline warm
        // while the window is not in front, and a game that stalls when the
        // player alt-tabs is worse than the GPU it saves.
        backgroundThrottling: false,
        // Devtools are an authoring tool, not part of the product: in a packaged
        // build they would hand the page a window we cannot style or hide.
        devTools: !app.isPackaged,
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
      // The catalogue page is up; now hand it the specific title. The router
      // needs the page rendered, so this waits for the load instead of racing it.
      armLaunch();
    });
    // A page that never arrives must not look like a successful launch: say so,
    // and leave the window up so the player can see (and retry) it.
    win.webContents.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
      if (!isMainFrame || win.isDestroyed()) return;
      if (code === -3 || code === -2) return;   // superseded navigation, not a failure
      this.log.error('stream', `page failed for ${opts.title}:`, code, desc, String(failedUrl).slice(0, 80));
      this.sendToRenderer('stream:status', {
        productId, state: 'error', title: opts.title, reason: desc || String(code),
      });
      reveal();
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
    win.__nexusLaunchDead = false;

    this.streamWindows.set(productId, win);

    // A page that never reaches the launch route is a failed launch, and the
    // player deserves to know which of the two it was.
    const slug = productTitleToSlug(opts.title || 'game');
    const armLaunch = () => {
      if (win.isDestroyed() || win.__nexusLaunchDead) return;
      // Re-injected on EVERY load, including the one the launch itself causes.
      // A one-shot guard looked tidier but meant the script's timers were
      // destroyed by the very navigation it started, so the page never
      // reported back and a stalled launch looked like a silent success.
      try {
        win.webContents.executeJavaScript(launchScript({ slug, productId, locale }), true)
          .catch(() => { /* the window may already be gone */ });
      } catch { /* ignore */ }
    };
    this.log.info('stream', `launch -> ${launchUrl(locale, slug, productId)} (${opts.title})`);
    // One listener for the whole app: registered per launch it would pile up a
    // handler per game, each one filtering the same events.
    if (!this.__launchReportWired) {
      this.__launchReportWired = true;
      ipcMain.on('nexus-launch-report', (event, state, reason) => {
        const pid = this.productIdForWebContents(event.sender);
        if (!pid) return;
        const win = this.streamWindows.get(pid);
        if (state === 'starting') {
          this.sendToRenderer('stream:status', { productId: pid, state: 'starting' });
          return;
        }
        if (state !== 'denied') return;
        this.log.warn('stream', `launch refused for ${pid}:`, String(reason).slice(0, 160));
        // Xbox rejecting the session is the authority on it. The stored
        // `XBXXtk` cookie can still parse and still look unexpired after the
        // session behind it is revoked, so the launcher would keep reporting
        // "signed in" while nothing can stream. Trust the page, not the cookie.
        if (/signed out/i.test(String(reason || ''))) this.markSessionRevoked();
        this.sendToRenderer('stream:status', { productId: pid, state: 'denied', reason: String(reason || ''), signedOut: /signed out/i.test(String(reason || '')) });
        // The page clears itself by going back to the catalogue, which reloads
        // it and would re-run the whole launch — an endless cycle of failed
        // launches and repeated notifications. Close it instead: the launcher
        // already carries the reason, and the next Play press opens a clean one.
        if (win && !win.isDestroyed()) {
          win.__nexusLaunchDead = true;
          if (win.__nexusLaunchTimer) clearTimeout(win.__nexusLaunchTimer);
          win.__nexusLaunchTimer = setTimeout(() => { try { win.close(); } catch { /* already gone */ } }, 1200);
        }
      });
    }

    const url = this.playUrl(locale);

    // Show-once, registered BEFORE the load starts. Registering it after
    // `await loadURL()` meant a fast or cached page emitted ready-to-show while
    // nobody was listening: the game window was created, the launch was
    // reported as successful, and nothing ever appeared on screen.
    let shown = false;
    const reveal = () => {
      if (shown || win.isDestroyed()) return;
      shown = true;
      try {
        if (fullscreen) win.setFullScreen(true);
        win.show();
        win.focus();
      } catch { /* the window may have been closed mid-load */ }
    };
    win.once('ready-to-show', reveal);
    // Belt and braces: whatever happens during the load, the window must not
    // be left invisible once we have answered the launch request.
    const revealTimer = setTimeout(reveal, 12000);

    try {
      await win.loadURL(url);
    } finally {
      clearTimeout(revealTimer);
      reveal();
    }

    return { reused: false };
  }

  /** Toggle (or set) fullscreen for a running game window. */
  setStreamFullscreen(productId, on) {
    const win = this.streamWindows.get(productId);
    if (!win || win.isDestroyed()) return false;
    win.setFullScreen(on == null ? !win.isFullScreen() : !!on);
    return win.isFullScreen();
  }

  /** Which game a stream renderer belongs to (null when unknown). */
  productIdForWebContents(wc) {
    for (const [pid, win] of this.streamWindows) {
      if (!win.isDestroyed() && win.webContents === wc) return pid;
    }
    return null;
  }

  /** Restart a running stream so new video settings take effect. */
  reloadStream(productId) {
    const win = this.streamWindows.get(productId);
    if (!win || win.isDestroyed()) return false;
    win.webContents.reload();
    return true;
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

  /**
   * Record what the game window's page reached, and tell the launcher.
   *
   * The page reports three distinguishable stages, because they fail for
   * different reasons and a player needs to know which one they are in:
   *
   *   waiting  the page is up but no media element exists yet
   *   splash   Xbox is playing its own intro clip (not the game yet)
   *   playing  the stream has a real picture: `videoWidth` is set, so the
   *            video track negotiated and frames are being decoded
   *
   * `videoWidth` is the honest signal here — XFly watches the same property for
   * the same reason (MIT, credited in README). A `<video>` element that exists
   * but never reports a width is a stream that never started, however healthy
   * the page looks.
   */
  noteStreamVideo(productId, payload) {
    if (!productId) return;
    const state = String(payload.state || '');
    const width = Number(payload.width) || 0;
    const height = Number(payload.height) || 0;
    const meta = this.streamVideo.get(productId) || {};
    if (state === 'playing') {
      if (meta.width === width && meta.height === height) return;  // no repeat noise
      this.streamVideo.set(productId, { width, height, at: Date.now() });
      this.log.info('stream', `picture up for ${productId}: ${width}x${height}`);
    } else if (state === 'splash' || state === 'waiting') {
      if (meta.state === state) return;
      this.streamVideo.set(productId, { ...meta, state });
      if (state === 'waiting') this.log.info('stream', `page up for ${productId}, no picture yet`);
    }
    this.sendToRenderer('stream:status', {
      productId,
      state: state === 'playing' ? 'playing' : state,
      videoWidth: width,
      videoHeight: height,
    });
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
