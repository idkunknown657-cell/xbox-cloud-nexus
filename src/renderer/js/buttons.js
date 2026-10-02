/**
 * Controller/button domain model.
 *
 * Single source of truth for what can be remapped, how a key capture is
 * normalised into the `{ key, code }` binding shape, and how conflicts are
 * detected. The main process mirrors `index` when converting to the Better
 * xCloud preset format, so both sides stay in sync.
 */

export const BTN = {
  A: 'gamepadA', B: 'gamepadB', X: 'gamepadX', Y: 'gamepadY',
  LB: 'gamepadLB', RB: 'gamepadRB',
  LT: 'gamepadLT', RT: 'gamepadRT',
  SELECT: 'gamepadSelect', START: 'gamepadStart',
  LS: 'gamepadLS', RS: 'gamepadRS',
  GUIDE: 'gamepadGuide',
  DUP: 'gamepadDUp', DDOWN: 'gamepadDDown', DLEFT: 'gamepadDLeft', DRIGHT: 'gamepadDRight',
  LSU: 'gamepadLSU', LSD: 'gamepadLSD', LSL: 'gamepadLSL', LSR: 'gamepadLSR',
  RSU: 'gamepadRSU', RSD: 'gamepadRSD', RSL: 'gamepadRSL', RSR: 'gamepadRSR',
};

/**
 * index MUST match src/main/stream-bridge.cjs BTN_INDEX.
 * group drives the layout of the on-screen controller diagram.
 */
export const BUTTONS = [
  { id: BTN.Y, label: 'Y', index: 3, group: 'face', color: '#f5d020' },
  { id: BTN.B, label: 'B', index: 1, group: 'face', color: '#ff5f57' },
  { id: BTN.X, label: 'X', index: 2, group: 'face', color: '#4c9bff' },
  { id: BTN.A, label: 'A', index: 0, group: 'face', color: '#6cd850' },
  { id: BTN.LB, label: 'LB', index: 4, group: 'shoulder' },
  { id: BTN.RB, label: 'RB', index: 5, group: 'shoulder' },
  { id: BTN.LT, label: 'LT', index: 6, group: 'trigger' },
  { id: BTN.RT, label: 'RT', index: 7, group: 'trigger' },
  { id: BTN.SELECT, label: 'View', index: 8, group: 'center' },
  { id: BTN.GUIDE, label: 'Xbox', index: 16, group: 'center' },
  { id: BTN.START, label: 'Menu', index: 9, group: 'center' },
  { id: BTN.DUP, label: 'D-Pad ↑', index: 12, group: 'dpad' },
  { id: BTN.DLEFT, label: 'D-Pad ←', index: 14, group: 'dpad' },
  { id: BTN.DRIGHT, label: 'D-Pad →', index: 15, group: 'dpad' },
  { id: BTN.DDOWN, label: 'D-Pad ↓', index: 13, group: 'dpad' },
  { id: BTN.LS, label: 'L3', index: 10, group: 'stick' },
  { id: BTN.RS, label: 'R3', index: 11, group: 'stick' },
  { id: BTN.LSU, label: 'LS ↑', index: 100, group: 'lstick' },
  { id: BTN.LSL, label: 'LS ←', index: 102, group: 'lstick' },
  { id: BTN.LSD, label: 'LS ↓', index: 101, group: 'lstick' },
  { id: BTN.LSR, label: 'LS →', index: 103, group: 'lstick' },
  { id: BTN.RSU, label: 'RS ↑', index: 200, group: 'rstick' },
  { id: BTN.RSL, label: 'RS ←', index: 202, group: 'rstick' },
  { id: BTN.RSD, label: 'RS ↓', index: 201, group: 'rstick' },
  { id: BTN.RSR, label: 'RS →', index: 203, group: 'rstick' },
];

export const BUTTON_BY_ID = Object.fromEntries(BUTTONS.map((b) => [b.id, b]));
export const BUTTON_BY_INDEX = Object.fromEntries(BUTTONS.map((b) => [b.index, b]));

/** Human label for a button id, safe for unknown ids. */
export function buttonLabel(id) {
  return BUTTON_BY_ID[id]?.label || id;
}

// ---------- Key code vocabulary ----------
const MODIFIERS = {
  ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift',
  ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl',
  AltLeft: 'Left Alt', AltRight: 'Right Alt',
  MetaLeft: 'Left Win', MetaRight: 'Right Win',
};

/** Codes Better xCloud accepts (kept in sync with stream-bridge.cjs). */
export const VALID_CODES = new Set([
  'Escape', 'Tab', 'CapsLock', 'Space', 'Enter', 'Backspace', 'Backquote',
  'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash', 'Semicolon', 'Quote', 'Comma', 'Period', 'Slash',
  'Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
  ...['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'],
  ...Array.from({ length: 10 }, (_, i) => `Digit${i}`),
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => `Key${c}`),
  ...Array.from({ length: 10 }, (_, i) => `Numpad${i}`),
  'NumpadMultiply', 'NumpadAdd', 'NumpadSubtract', 'NumpadDivide', 'NumpadDecimal',
  'Mouse0', 'Mouse1', 'Mouse2', 'Mouse3', 'Mouse4',
]);

export const MOUSE_CODES = ['Mouse0', 'Mouse1', 'Mouse2', 'Mouse3', 'Mouse4'];

/**
 * Shortcuts we refuse to capture: the app would become un-navigable and the
 * Windows shell would intercept them before the game ever saw them.
 */
export const BLOCKED_CODES = new Set(['MetaLeft', 'MetaRight', 'Tab', 'Escape', 'F12']);

const CODE_LABELS = {
  Space: 'Space', Enter: 'Enter', Tab: 'Tab', Escape: 'Esc', Backspace: 'Backspace', Backquote: '`',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';',
  Quote: "'", Comma: ',', Period: '.', Slash: '/', CapsLock: 'Caps',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Insert: 'Ins', Delete: 'Del', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
  NumpadMultiply: 'Num *', NumpadAdd: 'Num +', NumpadSubtract: 'Num -', NumpadDivide: 'Num /', NumpadDecimal: 'Num .',
  Mouse0: 'Left Mouse', Mouse1: 'Middle Mouse', Mouse2: 'Right Mouse', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5',
  ...MODIFIERS,
};

/** Display name for a `{key, code}` binding. */
export function bindLabel(bind) {
  if (!bind || !bind.code) return '';
  if (bind.code.startsWith('Key')) return bind.code.slice(3);
  if (bind.code.startsWith('Digit')) return bind.code.slice(5);
  if (/^F\d+$/.test(bind.code)) return bind.code;
  if (/^Numpad\d$/.test(bind.code)) return bind.code.replace('Numpad', 'Num ');
  return CODE_LABELS[bind.code] || bind.key || bind.code;
}

export const isMouseCode = (code) => /^Mouse\d$/.test(code);

/**
 * Turn a KeyboardEvent or MouseEvent into a binding, or null when it should be
 * ignored (modifier-only presses, blocked shortcuts, pure scroll gestures).
 * @returns {{key:string, code:string, blocked?:boolean, reason?:string}|null}
 */
export function captureFromEvent(e) {
  if (e.type === 'mousedown' || e.type === 'mouseup') {
    const n = e.button;
    if (n > 4) return null;
    return { key: CODE_LABELS[`Mouse${n}`] || `Mouse${n}`, code: `Mouse${n}` };
  }
  // A bare modifier press is not a binding on its own.
  if (['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight'].includes(e.code)) return null;
  if (e.ctrlKey && e.altKey) return null; // AltGr on many layouts
  if (BLOCKED_CODES.has(e.code)) return { blocked: true, code: e.code, reason: e.code === 'MetaLeft' || e.code === 'MetaRight' ? 'os' : 'nav' };
  if (!VALID_CODES.has(e.code)) return { blocked: true, code: e.code, reason: 'unsupported' };
  return { key: bindLabel({ code: e.code, key: e.key }), code: e.code };
}

// ---------- Mapping helpers ----------
export function emptyMapping() {
  return Object.fromEntries(BUTTONS.map((b) => [b.id, null]));
}

export function sanitizeMapping(mapping) {
  const out = emptyMapping();
  for (const b of BUTTONS) {
    const bind = mapping?.[b.id];
    if (bind && typeof bind === 'object' && VALID_CODES.has(bind.code)) out[b.id] = { key: bind.key || bindLabel(bind), code: bind.code };
  }
  return out;
}

/** Every other button already bound to `code`, excluding `exceptId`. */
export function findConflicts(mapping, code, exceptId) {
  return BUTTONS.filter((b) => b.id !== exceptId && mapping?.[b.id]?.code === code).map((b) => b.id);
}

/** Stable pseudo-unique id for new profiles. */
export function makeProfileId(base = 'custom') {
  return `${base}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}