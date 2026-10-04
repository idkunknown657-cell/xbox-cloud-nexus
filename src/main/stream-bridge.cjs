/**
 * Stream bridge — main side glue between settings, Better xCloud and stream
 * windows. Converts our profile format into the BX virtual-controller preset
 * format and hands the bundle to the stream preload via the sync IPC channel.
 *
 * Better xCloud's preset shape (v6.7.x, IndexedDB `virtual_controllers`):
 *   { id, name, data: { mapping: { <buttonIndex>: [keyCode, ...] }, mouse: {...} } }
 * `mouse.mapTo` is the gamepad button index the pointer is mapped onto (2 = right
 * stick); sensitivity values are percentages; deadzoneCounterweight is 0..100.
 */
const { readBxScript } = require('./bxcloud.cjs');

// Our profile keys -> BX gamepad button indices (standard Gamepad API mapping)
const BTN_INDEX = {
  gamepadA: 0, gamepadB: 1, gamepadX: 2, gamepadY: 3,
  gamepadLB: 4, gamepadRB: 5,
  gamepadLT: 6, gamepadRT: 7,
  gamepadSelect: 8, gamepadStart: 9, gamepadLS: 10, gamepadRS: 11,
  gamepadGuide: 16,
  gamepadDUp: 12, gamepadDDown: 13, gamepadDLeft: 14, gamepadDRight: 15,
  gamepadLSU: 100, gamepadLSD: 101, gamepadLSL: 102, gamepadLSR: 103,
  gamepadRSU: 200, gamepadRSD: 201, gamepadRSL: 202, gamepadRSR: 203,
};

// KeyboardEvent.code values BX accepts; mouse buttons use Mouse<N> aliases.
const VALID_KEY_CODES = new Set([
  ...['Escape', 'Tab', 'CapsLock', 'Space', 'Enter', 'Backspace', 'Backquote',
     'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash', 'Semicolon', 'Quote', 'Comma', 'Period', 'Slash',
     'Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown'],
  ...['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'],
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
  ...['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'],
  ...Array.from({ length: 10 }, (_, i) => `Digit${i}`),
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => `Key${c}`),
  ...Array.from({ length: 10 }, (_, i) => `Numpad${i}`),
  ...['NumpadMultiply', 'NumpadAdd', 'NumpadSubtract', 'NumpadDivide', 'NumpadDecimal'],
  ...['Mouse0', 'Mouse1', 'Mouse2', 'Mouse3', 'Mouse4'],
]);

const MOUSE_CODE_TO_BUTTON = { Mouse0: 0, Mouse1: 1, Mouse2: 2, Mouse3: 3, Mouse4: 4 };

const num = (v, fallback, lo, hi) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
};

/**
 * Convert our profile mapping -> BX preset mapping { [btnIndex]: [code, ...] }.
 * Unsupported codes are skipped rather than written, because a bad entry would
 * make Better xCloud reject the whole preset.
 */
function profileToBxMapping(profile) {
  const mapping = {};
  const m = (profile && profile.mapping) || {};
  for (const [btn, bind] of Object.entries(m)) {
    const idx = BTN_INDEX[btn];
    if (idx == null || !bind || !bind.code) continue;
    if (!VALID_KEY_CODES.has(bind.code)) continue;
    if (!mapping[idx]) mapping[idx] = [];
    // The preset allows several keys per button; ours allows one, so no dupes.
    if (!mapping[idx].includes(bind.code)) mapping[idx].push(bind.code);
  }
  return { mapping, mouse: buildBxMouse(profile) };
}

/**
 * Mouse -> right stick translation block.
 * Sensitivity is a percentage in BX, so our 1.0 master value becomes 100.
 */
function buildBxMouse(profile) {
  const cfg = (profile && profile.mouse) || {};
  const master = num(cfg.sensitivity, 1, 0.05, 20);
  const sx = master * num(cfg.sensitivityX, 1, 0, 20);
  const sy = master * num(cfg.sensitivityY, 1, 0, 20);
  const deadzone = num(cfg.deadzone, 0, 0, 0.4);
  const smoothing = cfg.smoothingEnabled === false ? 0 : num(cfg.smoothing, 0, 0, 0.9);
  return {
    mapTo: 2,                                        // right stick
    sensitivityX: Math.round(sx * 100),
    sensitivityY: Math.round(sy * (cfg.invertY ? -1 : 1) * 100),
    deadzoneCounterweight: Math.round(deadzone * 250),
    // Our own terms; the stream preload reads them for the response curve.
    nexus: {
      enabled: cfg.enabled !== false,
      invertY: !!cfg.invertY,
      smoothing,
      responseCurve: ['linear', 'expo', 'classic'].includes(cfg.responseCurve) ? cfg.responseCurve : 'linear',
      acceleration: cfg.acceleration !== false,
    },
  };
}

/** Build the full BX preset object stored in IndexedDB (id 9001 = ours). */
function buildBxPreset(profile) {
  const data = profileToBxMapping(profile);
  return {
    id: 9001,
    name: (profile && profile.name ? profile.name : 'Xbox Cloud Nexus') + ' Profile',
    data: { mapping: data.mapping, mouse: data.mouse },
  };
}

/** localStorage prefs applied before BX boots. */
function buildBxGlobalPrefs(settings) {
  const anim = settings?.appearance?.animations;
  const cloud = settings?.cloud || {};
  const lowEnd = settings?.performance?.lowEnd === true;
  return {
    'mkb.enabled': settings?.input?.kbmEnabled !== false,
    'block.tracking': true,
    'ui.reduceAnimations': anim === 'reduced' || anim === 'minimal' || lowEnd,
    // Never phone home for BX updates; the app owns versioning.
    CheckForUpdate: false,
    // ---- Video target (Better xCloud's own pref names) ----
    'stream.video.resolution': ['720p', '1080p', '1080p-hq'].includes(cloud.targetResolution)
      ? cloud.targetResolution : 'auto',
    'stream.video.preventResolutionDrops': !!cloud.lockResolution,
    // Store artwork is fetched with a quality hint; low-end machines get less.
    'ui.imageQuality': lowEnd ? 60 : 90,
  };
}

/** Stream-scoped prefs (BetterXcloud.Stream) applied before the player boots. */
function buildBxStreamPrefs(settings) {
  const cloud = settings?.cloud || {};
  const stats = settings?.input?.showStreamStats;
  const lowEnd = settings?.performance?.lowEnd === true;
  const renderer = cloud.renderer === 'webgl2' && !lowEnd ? 'webgl2' : 'default';
  return {
    'stats.showWhenPlaying': !!stats,
    // Our profile id (see buildBxPreset) must be the active one for MKB.
    'mkb.p1.preset.mappingId': 9001,
    // ---- Picture quality ----
    'video.player.type': renderer,
    'video.maxFps': num(cloud.maxFps, 60, 10, 60),
    'video.processing': 'usm',
    'video.processing.mode': cloud.sharpenMode === 'quality' ? 'quality' : 'performance',
    'video.processing.sharpness': num(cloud.sharpen, 0, 0, 10),
    'video.player.powerPreference': ['high-performance', 'low-power'].includes(cloud.powerPreference)
      ? cloud.powerPreference : 'default',
    // ---- Input latency: poll the (virtual) gamepad as fast as the stream needs ----
    'controller.pollingRate': num(cloud.pollingRate, 60, 4, 60),
  };
}

/** Assemble everything the stream preload needs. */
function buildStreamBundle(settings, profile, appRoot, log) {
  const bx = readBxScript(appRoot);
  if (!bx.code && log) log.warn('bxcloud', 'vendored script missing:', bx.error || 'not found');
  return {
    bx: { code: bx.code, version: bx.version, source: bx.source, license: bx.license },
    bxPreset: buildBxPreset(profile),
    bxGlobalPrefs: buildBxGlobalPrefs(settings),
    bxStreamPrefs: buildBxStreamPrefs(settings),
    toggleKey: (settings?.input?.kbmToggleKey) || 'F8',
    // Applied by the preload as soon as the stream element exists, so a muted
    // session stays muted across a restart instead of shouting at the player.
    muted: settings?.cloud?.muted === true,
  };
}

module.exports = {
  buildStreamBundle,
  profileToBxMapping,
  buildBxPreset,
  buildBxMouse,
  BTN_INDEX,
  VALID_KEY_CODES,
  MOUSE_CODE_TO_BUTTON,
};