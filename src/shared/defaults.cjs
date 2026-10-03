/**
 * Default settings schema. The store deep-merges saved user data over this.
 *
 * Input settings are split into:
 *   input.mouse   — aiming behaviour for the mouse → right-stick translation
 *   input.stick   — analogue stick feel for a real controller
 *   input.profiles— per-profile button/stick bindings
 */
'use strict';

const DEFAULT_MOUSE = {
  enabled: true,          // mouse drives the right stick at all
  sensitivity: 1.0,       // master multiplier
  sensitivityX: 1.0,      // horizontal multiplier
  sensitivityY: 1.0,      // vertical multiplier
  invertY: false,
  deadzone: 0.0,          // 0..0.4 of the stick radius
  smoothingEnabled: true, // master switch for the smoothing amount below
  smoothing: 0,           // 0..0.9; anything > 0 adds latency, kept opt-in
  responseCurve: 'linear',// linear | expo | classic
  acceleration: true,     // scale input with stick deflection
};

const DEFAULT_STICK = {
  leftDeadzone: 0.15,
  rightDeadzone: 0.15,
  responseCurve: 'linear', // linear | expo | classic
  invertY: false,
};

const DEFAULT_MAPPING = {
  gamepadA: { key: 'Space', code: 'Space' },
  gamepadB: { key: 'E', code: 'KeyE' },
  gamepadX: { key: 'R', code: 'KeyR' },
  gamepadY: { key: 'Q', code: 'KeyQ' },
  gamepadLB: { key: 'Shift', code: 'ShiftLeft' },
  gamepadRB: { key: 'Ctrl', code: 'ControlLeft' },
  gamepadLT: { key: 'Right Mouse', code: 'Mouse2' },
  gamepadRT: { key: 'Left Mouse', code: 'Mouse0' },
  gamepadLS: { key: 'C', code: 'KeyC' },
  gamepadRS: { key: 'V', code: 'KeyV' },
  gamepadDUp: { key: 'W', code: 'KeyW' },
  gamepadDDown: { key: 'S', code: 'KeyS' },
  gamepadDLeft: { key: 'A', code: 'KeyA' },
  gamepadDRight: { key: 'D', code: 'KeyD' },
  gamepadStart: { key: 'Enter', code: 'Enter' },
  gamepadSelect: { key: 'Tab', code: 'Tab' },
  gamepadGuide: { key: 'Esc', code: 'Escape' },
  // Stick directions are separate axes, not buttons, in the BX preset format.
  gamepadLSU: { key: 'W', code: 'KeyW' },
  gamepadLSD: { key: 'S', code: 'KeyS' },
  gamepadLSL: { key: 'A', code: 'KeyA' },
  gamepadLSR: { key: 'D', code: 'KeyD' },
  gamepadRSU: null,
  gamepadRSD: null,
  gamepadRSL: null,
  gamepadRSR: null,
};

module.exports = {
  app: {
    version: 1,
    locale: 'en',
    wizardCompleted: false,
    debugMode: false,
  },

  appearance: {
    theme: 'dark',              // dark | light | system
    accent: '#6cd850',
    accentPreset: 'nexus',
    backgroundMode: 'solid',    // solid | gradient
    bgColor: '#0b0f0d',
    gradient: {
      from: '#0e1f14',
      mid: '#12331f',
      to: '#0b0f0d',
      useMid: false,
      angle: 160,
      intensity: 70,
    },
    animations: 'full',         // full | reduced | minimal | off
    animationSpeed: 1.0,
    textScale: 1.0,
    highContrast: false,
  },

  performance: {
    preset: 'balanced',         // low | balanced | quality
    hwAccel: true,
    uiQuality: 'high',          // low | medium | high
    blur: true,
    shadows: true,
    backgroundFx: true,
    lowEndMode: false,
  },

  audio: {
    uiSounds: true,
    uiVolume: 0.6,
    notifications: true,
  },

  window: {
    mode: 'maximized',          // normal | maximized | fullscreen | borderless
    rememberBounds: true,
    bounds: null,
    startMaximized: true,
  },

  cloud: {
    region: 'default',
    // Target stream resolution. The service negotiates the real resolution from
    // the connection; this is the ceiling/cap Better xCloud asks for.
    targetResolution: 'auto',      // auto | 720p | 1080p | 1080p-hq
    lockResolution: false,         // hold the stream at the target instead of letting it drop
    preferredLocale: 'en-US',
    fullscreenOnPlay: true,
    windowModePlay: 'fullscreen',
    maxFps: 60,                    // 60 = uncapped (Better xCloud range is 10..60)
    renderer: 'default',           // default | webgl2 (WebGL2 allows clarity boost)
    sharpen: 0,                    // 0..10 clarity boost
    sharpenMode: 'performance',    // performance | quality
    powerPreference: 'default',    // default | high-performance | low-power
    pollingRate: 60,               // controller polling in Hz — the input-latency dial
  },

  input: {
    kbmEnabled: true,
    kbmToggleKey: 'F8',
    showStreamStats: false,
    mouse: { ...DEFAULT_MOUSE },
    stick: { ...DEFAULT_STICK },
    profiles: [
      {
        id: 'default',
        name: 'Default',
        builtin: true,
        mapping: { ...DEFAULT_MAPPING },
        mouse: { ...DEFAULT_MOUSE },
        stick: { ...DEFAULT_STICK },
      },
    ],
    activeProfile: 'default',
    gameProfiles: {},           // productId -> profileId
  },

  // Microsoft account state. `signedIn` is only ever set by observing the
  // official sign-in window — no credentials are stored by this app.
  account: {
    signedIn: false,
    gamertag: '',
    xuid: '',
    avatarUrl: '',
    // 'none' | 'ok' | 'expired', read from the official session records.
    sessionState: 'none',
    checkedAt: 0,
    skippedSignIn: false,
    // 'auto' = read it off Microsoft's signed-in page; anything else is the
    // player's own declaration (Settings -> Account). Never guessed silently.
    plan: 'auto',
    planSource: '',
  },

  favorites: [],
  hiddenGames: [],
  recentPlayed: [],
  notificationsSeen: {},
};

module.exports.DEFAULT_MOUSE = DEFAULT_MOUSE;
module.exports.DEFAULT_STICK = DEFAULT_STICK;
module.exports.DEFAULT_MAPPING = DEFAULT_MAPPING;