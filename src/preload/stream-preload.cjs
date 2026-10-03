/**
 * Stream window preload — runs at document-start with contextIsolation OFF,
 * so this code executes in the page's real context BEFORE any page script.
 *
 * Responsibilities:
 *  1. Fetch the bundle (BX script + prefs + control preset) from main via sync IPC.
 *  2. Write BX global prefs (localStorage "BetterXcloud") before BX boots.
 *  3. Apply the user's control profile into BX's IndexedDB preset store.
 *  4. Inject Better xCloud (MIT-licensed; Copyright (c) 2023 redphx).
 *  5. Relay controller connect/disconnect and MKB toggles to the launcher.
 *
 * Security notes:
 *  - No Node globals are leaked into the page; only this preload's closures use them.
 *  - The main process restricts stream windows to https://www.xbox.com paths.
 */
'use strict';

const { ipcRenderer } = require('electron');

// ---- Bundle (synchronous — must resolve before page scripts run) ----
const __nexus = ipcRenderer.sendSync('stream:request-bundle') || {};

// ---- BX storage constants (match Better xCloud v6.7.x) ----
const BX_DB_NAME = 'BetterXcloud';
const BX_DB_VERSION = 4;
const BX_VC_STORE = 'virtual_controllers';
const BX_LS_KEY = 'BetterXcloud';
const BX_LS_STREAM = 'BetterXcloud.Stream';

function logTag(...args) { try { console.info('%c[Nexus]', 'color:#6cd850;font-weight:bold', ...args); } catch { /* */ } }

// 1) Global prefs (BX reads localStorage during startup)
function applyGlobalPrefs() {
  const prefs = __nexus.bxGlobalPrefs;
  if (!prefs) return;
  try {
    const cur = JSON.parse(localStorage.getItem(BX_LS_KEY) || '{}');
    localStorage.setItem(BX_LS_KEY, JSON.stringify(Object.assign({}, cur, prefs)));
    logTag('BX prefs applied:', Object.keys(prefs).join(', '));
  } catch (e) { logTag('prefs apply failed', e && e.message); }
}

function applyStreamPrefs() {
  const prefs = __nexus.bxStreamPrefs;
  if (!prefs) return;
  try {
    const cur = JSON.parse(localStorage.getItem(BX_LS_STREAM) || '{}');
    localStorage.setItem(BX_LS_STREAM, JSON.stringify(Object.assign({}, cur, prefs)));
  } catch { /* ignore */ }
}

// 2) Control profile -> BX virtual-controller preset (id 9001)
function openBxDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BX_DB_NAME, BX_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const stores = ['virtual_controllers', 'controller_shortcuts', 'controller_customizations', 'controller_settings', 'keyboard_shortcuts'];
      for (const s of stores) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function applyControlProfile() {
  const preset = __nexus.bxPreset;
  if (!preset) return;
  try {
    const db = await openBxDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(BX_VC_STORE, 'readwrite');
      tx.objectStore(BX_VC_STORE).put(preset);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    // Select our preset as the active MKB mapping (p1)
    try {
      const cur = JSON.parse(localStorage.getItem(BX_LS_STREAM) || '{}');
      cur['mkb.p1.preset.mappingId'] = 9001;
      localStorage.setItem(BX_LS_STREAM, JSON.stringify(cur));
    } catch { /* ignore */ }
    logTag('control profile written: preset', preset.id);
  } catch (e) { logTag('profile write failed', e && e.message); }
}

// 3) Inject Better xCloud before page scripts
function injectBxCloud() {
  const bx = __nexus.bx;
  if (!bx || !bx.code) { logTag('Better xCloud unavailable — continuing without enhancements'); return; }
  try {
    window.__BXCLOUD_ATTRIBUTION__ = { name: 'Better xCloud', version: bx.version, author: 'redphx', license: bx.license, source: bx.source };
    new Function(bx.code + '\n//# sourceURL=better-xcloud.user.js')();
    logTag('Better xCloud', bx.version, 'injected');
  } catch (e) {
    logTag('BX injection failed (stream continues without enhancements):', e && e.message);
  }
}

// 4) Commands from main (validated)
ipcRenderer.on('nexus:stream-cmd', (_ev, msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'mkb-toggle') {
    const key = __nexus.toggleKey || 'F8';
    document.dispatchEvent(new KeyboardEvent('keydown', { code: key, key, bubbles: true }));
    setTimeout(() => document.dispatchEvent(new KeyboardEvent('keyup', { code: key, key, bubbles: true })), 60);
  }
});

// 4b) In-game panel ------------------------------------------------------------
// A floating "Configure Controls" button that opens a small panel over the game.
// It lives in a shadow root with its own styles so nothing about the official
// page can reach it, and it only ever *asks* the main process to change things.
const ui = (() => {
  let host = null;
  let shadow = null;
  let panel = null;
  let open = false;
  let state = { kbmEnabled: true, resolution: 'auto', frameCap: 0, signedIn: false };

  const api = (kind, extra) => ipcRenderer.invoke('stream:ui', { kind, ...(extra || {}) })
    .then((res) => (res && res.ok ? res.result : null)).catch(() => null);

  const CSS = `
    :host { all: initial; }
    .wrap { position: fixed; right: 18px; bottom: 18px; z-index: 2147483000;
      font: 13px/1.4 "Segoe UI Variable", "Segoe UI", system-ui, sans-serif; color: #eef2ef; }
    .pill { display: flex; align-items: center; gap: 8px; padding: 8px 13px; border: 1px solid rgba(255,255,255,.16);
      border-radius: 999px; background: rgba(12,16,14,.86); backdrop-filter: blur(6px); cursor: pointer;
      font: inherit; font-weight: 650; color: inherit; transition: border-color .14s ease, transform .14s ease; }
    .pill:hover { border-color: #6cd850; transform: translateY(-1px); }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #6cd850; box-shadow: 0 0 0 3px rgba(108,216,80,.18); }
    .panel { position: absolute; right: 0; bottom: 46px; width: 306px; padding: 14px;
      border-radius: 14px; border: 1px solid rgba(255,255,255,.14); background: rgba(10,13,12,.96);
      box-shadow: 0 18px 40px rgba(0,0,0,.5); display: none; }
    .panel.open { display: block; }
    h4 { margin: 0 0 3px; font-size: 13px; font-weight: 800; }
    .sub { margin: 0 0 11px; font-size: 11.5px; color: #9aa5a0; }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 0; }
    .row + .row { border-top: 1px solid rgba(255,255,255,.07); }
    label { font-size: 12.5px; color: #d6ded9; }
    select { font: inherit; font-size: 12px; padding: 4px 6px; border-radius: 7px; border: 1px solid rgba(255,255,255,.16);
      background: rgba(255,255,255,.06); color: #eef2ef; }
    .sw { position: relative; width: 40px; height: 22px; border: 1px solid rgba(255,255,255,.18); border-radius: 999px;
      background: rgba(255,255,255,.08); cursor: pointer; transition: background .16s ease; }
    .sw::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%;
      background: #eef2ef; transition: transform .16s ease; }
    .sw.on { background: #2f7d3a; border-color: #6cd850; }
    .sw.on::after { transform: translateX(18px); }
    button.act { width: 100%; margin-top: 9px; padding: 9px 12px; border-radius: 9px; cursor: pointer; font: inherit;
      font-weight: 700; color: #06110a; background: #6cd850; border: none; }
    button.act.ghost { background: rgba(255,255,255,.08); color: #eef2ef; border: 1px solid rgba(255,255,255,.18); }
    button.act:hover { filter: brightness(1.06); }
    .note { margin: 10px 0 0; font-size: 11px; color: #8f9a95; }
    .adnote { margin: 8px 0 0; padding: 8px 10px; border-radius: 8px; font-size: 11.5px; line-height: 1.45;
      color: #ffd166; background: rgba(255,209,102,.1); border: 1px solid rgba(255,209,102,.28); }
    .banner { position: fixed; left: 50%; top: 18px; transform: translateX(-50%); z-index: 2147483000;
      padding: 10px 16px; border-radius: 999px; background: rgba(10,13,12,.9); color: #ffd166;
      border: 1px solid rgba(255,209,102,.3); font-size: 12.5px; font-weight: 650; opacity: 0;
      transition: opacity .3s ease; }
    .banner.on { opacity: 1; }
    .keys { margin-top: 8px; font-size: 11px; color: #8f9a95; display: flex; flex-wrap: wrap; gap: 4px 10px; }
    kbd { padding: 1px 6px; border-radius: 5px; background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.16);
      font-family: inherit; font-size: 10.5px; font-weight: 700; }
    .restart { color: #ffd166; font-size: 11px; display: none; margin-top: 6px; }
    .restart.on { display: block; }
  `;

  // A one-off banner explains the pre-roll the first time an ad-supported
  // session opens, then gets out of the way.
  let bannerShown = false;
  function showAdBanner() {
    bannerShown = true;
    try {
      const b = document.createElement('div');
      b.className = 'banner';
      b.textContent = 'Free with ads — a short Xbox ad plays before your game starts.';
      shadow.append(b);
      requestAnimationFrame(() => b.classList.add('on'));
      setTimeout(() => { b.classList.remove('on'); setTimeout(() => b.remove(), 400); }, 9000);
    } catch { /* banner is cosmetic */ }
  }

  const row = (label, node) => {
    const r = document.createElement('div');
    r.className = 'row';
    const l = document.createElement('label');
    l.textContent = label;
    r.append(l, node);
    return r;
  };

  function build() {
    host = document.createElement('div');
    host.id = 'nexus-hud';
    shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;

    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    const pill = document.createElement('button');
    pill.className = 'pill';
    pill.innerHTML = '<span class="dot"></span><span>Configure Controls</span>';
    pill.title = 'Open Nexus in-game controls (F9)';

    panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = '<h4>In-game controls</h4><p class="sub">Keyboard & mouse is translated into controller input.</p>';

    const kbm = document.createElement('div');
    kbm.className = 'sw';
    kbm.title = 'Keyboard & mouse translation (F8)';
    kbm.addEventListener('click', async () => {
      state = (await api('set-kbm', { value: !state.kbmEnabled })) || state;
      paint();
      // Better xCloud flips its own emulation on F8, so the change is live.
      const key = __nexus.toggleKey || 'F8';
      document.dispatchEvent(new KeyboardEvent('keydown', { code: key, key, bubbles: true }));
      setTimeout(() => document.dispatchEvent(new KeyboardEvent('keyup', { code: key, key, bubbles: true })), 60);
    });
    panel.append(row('Keyboard & mouse', kbm));

    const res = document.createElement('select');
    for (const [v, l] of [['auto', 'Auto (best)'], ['720p', '720p'], ['1080p', '1080p'], ['1080p-hq', '1080p HQ']]) {
      const o = document.createElement('option');
      o.value = v; o.textContent = l; res.append(o);
    }
    res.addEventListener('change', async () => {
      state = (await api('set-quality', { resolution: res.value })) || state;
      paint();
    });
    panel.append(row('Stream resolution', res));

    const fps = document.createElement('select');
    for (const [v, l] of [[0, 'Match display'], [30, '30 fps'], [60, '60 fps'], [120, '120 fps']]) {
      const o = document.createElement('option');
      o.value = String(v); o.textContent = l; fps.append(o);
    }
    fps.addEventListener('change', async () => {
      state = (await api('set-quality', { frameCap: Number(fps.value) })) || state;
      paint();
    });
    panel.append(row('Frame rate', fps));

    const sens = document.createElement('select');
    for (const [v, l] of [[0.5, '0.5x'], [1, '1x'], [1.5, '1.5x'], [2, '2x'], [3, '3x']]) {
      const o = document.createElement('option');
      o.value = String(v); o.textContent = l; sens.append(o);
    }
    sens.addEventListener('change', async () => { state = (await api('set-sensitivity', { value: Number(sens.value) })) || state; paint(); });
    panel.append(row('Mouse sensitivity', sens));

    const invert = document.createElement('div');
    invert.className = 'sw';
    invert.addEventListener('click', async () => { state = (await api('set-invert-y', { value: !state.invertY })) || state; paint(); });
    panel.append(row('Invert Y axis', invert));

    const fs = document.createElement('button');
    fs.className = 'act ghost';
    fs.textContent = 'Toggle fullscreen (F11)';
    fs.addEventListener('click', () => api('fullscreen', { value: null }));
    panel.append(fs);

    const restart = document.createElement('button');
    restart.className = 'act';
    restart.textContent = 'Apply & restart stream';
    restart.addEventListener('click', () => api('restart'));
    panel.append(restart);

    const hint = document.createElement('div');
    hint.className = 'restart';
    hint.textContent = 'Video changes apply after a stream restart.';
    panel.append(hint);

    const open_ = document.createElement('button');
    open_.className = 'act';
    open_.textContent = 'Open full controls & mapping…';
    open_.addEventListener('click', () => { api('open-controls'); toggle(false); });
    panel.append(open_);

    const keys = document.createElement('div');
    keys.className = 'keys';
    keys.innerHTML = '<span><kbd>F8</kbd> KBM on/off</span><span><kbd>F9</kbd> this panel</span><span><kbd>F11</kbd> fullscreen</span><span><kbd>F12</kbd> reload</span>';
    panel.append(keys);

    // Free-with-ads sessions: the pre-roll is served by Xbox inside this window.
    const ad = document.createElement('p');
    ad.className = 'adnote';
    ad.textContent = 'Free with ads: Xbox plays a short ad here before your session starts.';
    ad.style.display = 'none';
    panel.append(ad);
    panel._ad = ad;

    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = 'Input translation powered by Better xCloud (MIT, © redphx).';
    panel.append(note);

    panel._hint = hint;
    panel._refs = { kbm, res, fps, sens, invert };

    pill.addEventListener('click', () => toggle(!open));
    wrap.append(panel, pill);
    shadow.append(style, wrap);
    (document.body || document.documentElement).appendChild(host);
  }

  function paint() {
    if (!panel?._refs) return;
    const { kbm, res, fps, sens, invert } = panel._refs;
    kbm.classList.toggle('on', state.kbmEnabled !== false);
    res.value = state.resolution || 'auto';
    fps.value = String(state.frameCap || 0);
    if (state.mouseSensitivity) sens.value = String(state.mouseSensitivity);
    invert.classList.toggle('on', state.invertY === true);
    panel._hint.classList.toggle('on', !!panel._needsRestart);
    if (panel._ad) panel._ad.style.display = state.adSupported ? 'block' : 'none';
    if (state.adSupported && !bannerShown) showAdBanner();
  }

  async function toggle(next) {
    open = next !== false ? !open : !!next;
    if (open) {
      const fresh = await api('state');
      if (fresh) { state = fresh; panel._needsRestart = false; }
      paint();
    }
    panel.classList.toggle('open', open);
  }

  function mount() {
    if (host && document.documentElement.contains(host)) return;
    try { build(); } catch (e) { logTag('HUD unavailable', e && e.message); }
  }

  return {
    mount,
    toggle,
    isOpen: () => open,
    destroy: () => { try { host?.remove(); } catch { /* ignore */ } host = null; panel = null; },
    refresh: async () => { const fresh = await api('state'); if (fresh) { state = fresh; paint(); } },
  };
})();

// F9 opens the panel. The listener runs in the capture phase so the page cannot
// swallow the shortcut, and is written as a plain function on purpose: this file
// runs before any framework exists.
function mountHud() {
  ui.mount();
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F9' && !e.repeat) { e.preventDefault(); ui.toggle(); }
    else if (e.code === 'Escape' && ui.isOpen()) ui.toggle(false);
  }, true);
}

// The HUD needs a body; wait for one when we beat the parser.
if (document.body) mountHud();
else window.addEventListener('DOMContentLoaded', mountHud, { once: true });

// 5) Relay controller lifecycle to the launcher
function relay(obj) { try { ipcRenderer.send('stream:event', obj); } catch { /* ignore */ } }
window.addEventListener('gamepadconnected', (e) => relay({ kind: 'controller', connected: true, id: String((e.gamepad && e.gamepad.id) || '').slice(0, 60) }));
window.addEventListener('gamepaddisconnected', () => relay({ kind: 'controller', connected: false }));

// Boot order matters: prefs -> preset -> inject, all before page scripts.
applyGlobalPrefs();
applyStreamPrefs();
injectBxCloud();
applyControlProfile();
