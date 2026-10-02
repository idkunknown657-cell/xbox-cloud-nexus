/**
 * Gamepad monitoring for the launcher window.
 *
 * Two jobs:
 *  1. Report connect/disconnect so the UI can react immediately.
 *  2. Feed the input-test area with live button/axis state.
 *
 * Polling only runs while something is actually watching (test mode or the
 * controller page), so idle CPU usage stays at zero.
 */
import { emit, on } from './store.js';
import { toastOk, toastWarn } from './toast.js';
import { t } from './i18n.js';

const GAMEPAD_STANDARD = { index: 0, id: 'gamepad' };

const watchers = new Set();
let pollTimer = null;
let lastSeen = null;
let announced = false;

function pads() {
  if (!navigator.getGamepads) return [];
  try {
    return Array.from(navigator.getGamepads()).filter((p) => p && p.connected);
  } catch {
    return [];
  }
}

/** Current pad snapshot used by the test area. */
export function connectedPads() { return pads(); }
export function activePad() { return pads()[0] || null; }
export function anyConnected() { return pads().length > 0; }

/** Button index -> our BTN id (standard mapping; matches stream-bridge.cjs). */
export const PAD_INDEX_TO_BTN = {
  0: 'gamepadA', 1: 'gamepadB', 2: 'gamepadX', 3: 'gamepadY',
  4: 'gamepadLB', 5: 'gamepadRB', 6: 'gamepadLT', 7: 'gamepadRT',
  8: 'gamepadSelect', 9: 'gamepadStart', 10: 'gamepadLS', 11: 'gamepadRS',
  12: 'gamepadDUp', 13: 'gamepadDDown', 14: 'gamepadDLeft', 15: 'gamepadDRight',
  16: 'gamepadGuide',
};

export function padButtonLabel(index) {
  const id = PAD_INDEX_TO_BTN[index];
  return id ? id.replace('gamepad', '') : `B${index}`;
}

/** Digital + analog state, normalised for the test pad UI. */
export function snapshot() {
  const pad = activePad();
  if (!pad) return null;
  const buttons = pad.buttons.map((b, i) => ({ index: i, value: typeof b === 'number' ? b : b.value, pressed: (typeof b === 'number' ? b : b.value) > 0.5 }));
  const axes = Array.from(pad.axes || []).map((v) => (Math.abs(v) < 0.14 ? 0 : v));
  return { id: pad.id, index: pad.index, mapping: pad.mapping || GAMEPAD_STANDARD, buttons, axes };
}

/** Start a polling loop that feeds watchers with raw snapshots. */
function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    const snap = snapshot();
    for (const fn of watchers) {
      try { fn(snap); } catch { /* watcher removed */ }
    }
  }, 60);
}

/**
 * Subscribe to live controller state. Polling starts on first subscriber and
 * stops when the last one goes away.
 * @param {(snap:object|null)=>void} fn
 * @returns {()=>void} unsubscribe
 */
export function watch(fn) {
  watchers.add(fn);
  startPolling();
  try { fn(snapshot()); } catch { /* ignore */ }
  return () => {
    watchers.delete(fn);
    if (!watchers.size && pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  };
}

/** Wire the browser-level connect/disconnect events and reflect them in the store. */
export function initGamepad() {
  window.addEventListener('gamepadconnected', (e) => {
    const id = String(e?.gamepad?.id || 'Controller').slice(0, 40);
    emit('controller', { connected: true, id });
    if (!announced) { announced = true; toastOk(t('controller_connected'), id); }
  });
  window.addEventListener('gamepaddisconnected', () => {
    emit('controller', { connected: false, id: '' });
    announced = false;
    toastWarn(t('controller_disconnected'));
  });
  // A pad already connected before boot has no event, so probe once at startup.
  setTimeout(() => {
    const p = activePad();
    if (p && !announced) { announced = true; emit('controller', { connected: true, id: String(p.id).slice(0, 40) }); }
  }, 600);
}

/** Stream windows report their pad lifecycle through IPC; mirror it here. */
export function onStreamControllerChange(fn) {
  return on('stream-controller', fn);
}