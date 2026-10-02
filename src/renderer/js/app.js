/**
 * App entry point.
 *
 * Boots settings, applies the theme, wires the shell (titlebar, sidebar,
 * keyboard shortcuts, window and stream events) and owns routing. Views are
 * created lazily and torn down on navigation so nothing keeps running in the
 * background while you are on another screen.
 */
import { setNavigator } from './nav.js';
import { h, clear, $ } from './dom.js';
import { icon } from './icons.js';
import { t, setLang, getLang } from './i18n.js';
import { settings, on, emit } from './store.js';
import { applyTheme } from './theme.js';
import { unlockAudio } from './sfx.js';
import { initGamepad } from './gamepad.js';
import * as cat from './catalog.js';
import { toastOk, toastInfo, toastWarn, toastErr } from './toast.js';
import { launchGame, markStreamOpen, markStreamClosed } from './launch.js';

import { render as renderHome } from './views/home.js';
import { createView as createLibraryView } from './views/library.js';
import { openDetails } from './views/details.js';
import { createView as createSettingsView } from './views/settings.js';
import { createView as createControlsView } from './views/controls.js';
import { openPalette } from './views/search.js';
import { runWizard } from './views/wizard.js';

const main = $('#main');
const sidebar = $('#sidebar');

// ---------- Routing ----------
const ROUTES = {
  home: { label: () => t('nav_home'), icon: 'home' },
  cloud: { label: () => t('nav_cloud'), icon: 'cloud', view: (ctx) => createLibraryView('cloud', ctx) },
  library: { label: () => t('nav_library'), icon: 'library', view: (ctx) => createLibraryView('all', ctx) },
  playads: { label: () => t('nav_playAds'), icon: 'ads', view: (ctx) => createLibraryView('playads', ctx) },
  recent: { label: () => t('nav_recent'), icon: 'clock', view: (ctx) => createLibraryView('recent', ctx) },
  favorites: { label: () => t('nav_favorites'), icon: 'heart', view: (ctx) => createLibraryView('favorites', ctx) },
  settings: { label: () => t('nav_settings'), icon: 'settings', view: (ctx) => createSettingsView(ctx) },
  controls: { label: () => t('set_controls'), icon: 'controller', view: (ctx) => createControlsView(ctx) },
};

let current = 'home';
let teardown = null;
const leaveHooks = [];

/** Shared context handed to every view. */
const ctx = {
  navigate,
  openDetails,
  refreshCatalog,
  refresh: () => paint(),
  repaint: () => paint(),
  /** Register a teardown; returns an unsubscribe function. */
  onLeave: (fn) => {
    leaveHooks.push(fn);
    return () => {
      const i = leaveHooks.indexOf(fn);
      if (i >= 0) leaveHooks.splice(i, 1);
    };
  },
};

/** Navigate to a route id (optionally a settings category). */
function navigate(id, arg) {
  if (!ROUTES[id]) return;
  teardown?.();
  teardown = null;
  while (leaveHooks.length) { try { leaveHooks.pop()(); } catch { /* ignore */ } }
  current = id;
  document.title = `${ROUTES[id].label()} — ${t('appName')}`;
  clear(main);
  main.scrollTop = 0;
  paintSidebar();
  if (id === 'settings' && arg) {
    // The settings view owns its own routing; forward the category on mount.
    pendingSettingsCategory = arg;
  }
  paint();
  location.hash = id;
}

let pendingSettingsCategory = null;

function paint() {
  clear(main);
  const route = ROUTES[current];
  if (!route.view) {
    teardown = renderHome(main, ctx);
    return;
  }
  const view = route.view(ctx);
  if (pendingSettingsCategory && current === 'settings') {
    pendingSettingsCategory = null;
  }
  teardown = view.render(main);
}

// ---------- Sidebar ----------
function paintSidebar() {
  clear(sidebar);
  sidebar.appendChild(h('div.brand', [
    h('img', { src: 'icons/icon-32.png', alt: '' }),
    h('div', [h('div.b-name', t('appName')), h('div.b-sub', 'Cloud Gaming client')]),
  ]));

  const item = (id, opts = {}) => {
    const route = ROUTES[id];
    if (!route) return null;
    return h(`button.nav-item${current === id ? '.active' : ''}`, {
      onclick: () => navigate(id),
      'aria-current': current === id ? 'page' : null,
    }, [
      icon(route.icon, { size: 19 }),
      route.label(),
      opts.badge ? h('span.badge', opts.badge) : null,
    ].filter(Boolean));
  };

  sidebar.append(
    item('home'),
    item('cloud'),
    item('library'),
    item('playads', { badge: 'AD' }),
    item('recent'),
    item('favorites'),
    h('div.nav-sep'),
    item('settings'),
  );

  sidebar.append(h('div.spacer'));

  // Network status (no extra polling — navigator.onLine plus catalog outcome).
  const netChip = h(`div.status-chip${navigator.onLine ? '.ok' : '.err'}`, [
    h('span.dot'),
    navigator.onLine ? (cat.state.error ? t('offline_cached') : 'Connected') : 'Offline',
  ]);
  const padChip = h('div.status-chip', [icon('controller', { size: 14 }), h('span', t('controller'))]);
  sidebar.append(netChip, padChip);
  return { netChip };
}

let chrome = null;
function paintChrome() {
  chrome = paintSidebar();
}

// ---------- Catalog ----------
let catalogPromise = null;
async function refreshCatalog(force = false) {
  if (catalogPromise && !force) return catalogPromise;
  catalogPromise = cat.loadCatalog({ force }).finally(() => { catalogPromise = null; });
  await catalogPromise;
  paintChrome();
  paint();
}

// ---------- Shell ----------
function wireTitlebar() {
  $('#tb-min').addEventListener('click', () => window.nexus.window.minimize());
  $('#tb-max').addEventListener('click', () => window.nexus.window.maximizeToggle());
  $('#tb-close').addEventListener('click', () => window.nexus.window.close());

  window.nexus.events.windowState(({ maximized, fullscreen }) => {
    const btn = $('#tb-max');
    if (btn) btn.title = maximized ? 'Restore' : 'Maximize';
    if (chrome) chrome.netChip.classList.toggle('warn', !!fullscreen);
  });
}

function wireShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(ctx); return; }
    if (e.key === 'F5' && e.ctrlKey) { e.preventDefault(); refreshCatalog(true); return; }
    // Alt+1..6 jump between main sections.
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const order = ['home', 'cloud', 'library', 'playads', 'recent', 'favorites'];
      const idx = Number(e.key) - 1;
      if (order[idx]) { e.preventDefault(); navigate(order[idx]); }
    }
  });
}

function wireEvents() {
  window.addEventListener('online', () => { paintChrome(); toastOk('Connected'); refreshCatalog(true); });
  window.addEventListener('offline', () => { paintChrome(); toastWarn('Offline', 'Showing cached library data.'); });

  window.nexus.events.streamStatus((payload) => {
    if (!payload) return;
    if (payload.state === 'loaded') { markStreamOpen(payload.productId); toastInfo(t('launched'), payload.title || ''); }
    else if (payload.state === 'closed') { markStreamClosed(payload.productId); }
    else if (payload.state === 'crashed') {
      markStreamClosed(payload.productId);
      toastErr(new Error(payload.reason || 'renderer gone'), t('stream_crashed'));
      toastInfo(t('stream_crashed_msg'));
    }
  });

  window.nexus.events.controllers(({ connected, id }) => {
    emit('controller', { connected, id });
    const pad = $('#tb-pad');
    if (pad) pad.classList.toggle('active', !!connected);
    paintChrome();
  });

  on('controller', ({ connected, id }) => {
    const pad = $('#tb-pad');
    if (pad) pad.classList.toggle('active', !!connected);
    const chips = sidebar.querySelectorAll('.status-chip');
    const padChip = chips[chips.length - 1];
    if (padChip) {
      padChip.classList.toggle('ok', !!connected);
      padChip.classList.toggle('warn', !connected);
      const label = padChip.querySelector('span:last-child') || padChip.lastChild;
      if (label && label.textContent !== undefined) label.textContent = connected ? (id || t('controller')).slice(0, 22) : t('no_controller');
    }
  });
}

function wireAudioUnlock() {
  const unlock = () => { unlockAudio(); document.removeEventListener('pointerdown', unlock); };
  document.addEventListener('pointerdown', unlock, { once: true });
}

// ---------- Boot ----------
async function boot() {
  setNavigator(navigate);
  try {
    const data = await settings.load();
    setLang(data.app?.locale || getLang() || 'en');
    applyTheme();
  } catch (err) {
    console.error('settings load failed', err);
    toastErr(err, 'Settings could not be loaded');
  }

  paintSidebar();
  wireTitlebar();
  wireShortcuts();
  wireEvents();
  wireAudioUnlock();
  initGamepad();

  const hash = (location.hash || '').replace('#', '');
  current = ROUTES[hash] ? hash : 'home';
  paintSidebar();
  paint();

  // Catalog loads in the background; views repaint themselves when it lands.
  refreshCatalog();

  if (!settings.get('app.wizardCompleted', false)) {
    runWizard(() => {
      navigate('home');
      refreshCatalog();
    });
  }
}

boot();