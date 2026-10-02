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

// 5) Relay controller lifecycle to the launcher
function relay(obj) { try { ipcRenderer.send('stream:event', obj); } catch { /* ignore */ } }
window.addEventListener('gamepadconnected', (e) => relay({ kind: 'controller', connected: true, id: String((e.gamepad && e.gamepad.id) || '').slice(0, 60) }));
window.addEventListener('gamepaddisconnected', () => relay({ kind: 'controller', connected: false }));

// Boot order matters: prefs -> preset -> inject, all before page scripts.
applyGlobalPrefs();
applyStreamPrefs();
injectBxCloud();
applyControlProfile();
