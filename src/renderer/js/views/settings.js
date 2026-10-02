/**
 * Settings center.
 *
 * Organized as a searchable list of categories. Every control writes straight
 * to the persisted settings and applies immediately, so nothing here is
 * decorative. Categories that have their own dedicated screen (Controls &
 * Input) delegate to that view instead of duplicating the remap UI.
 */
import { h, clear, debounce, copyText } from '../dom.js';
import { icon } from '../icons.js';
import { t, setLang, availableLangs, getLang } from '../i18n.js';
import { settings, on } from '../store.js';
import { applyTheme, ACCENT_PRESETS, effectiveTheme } from '../theme.js';
import { confirmDialog, openModal, infoDialog, promptDialog } from '../modal.js';
import { toastOk, toastInfo, toastErr, toastWarn } from '../toast.js';
import { switchControl, sliderControl, setControlsTab, profiles } from './controls.js';
import { onStreamControllerChange } from '../gamepad.js';
import { unlockAudio, sfx } from '../sfx.js';
import * as cat from '../catalog.js';

const CATEGORIES = [
  { id: 'account', label: () => t('set_account'), iconName: 'shield' },
  { id: 'cloud', label: () => t('set_cloud'), iconName: 'cloudPlay' },
  { id: 'appearance', label: () => t('set_appearance'), iconName: 'palette' },
  { id: 'animations', label: () => t('set_animations'), iconName: 'sparkle' },
  { id: 'performance', label: () => t('set_performance'), iconName: 'gauge' },
  { id: 'language', label: () => t('set_language'), iconName: 'globe' },
  { id: 'audio', label: () => t('set_audio'), iconName: 'speaker' },
  { id: 'accessibility', label: () => t('set_accessibility'), iconName: 'eye' },
  { id: 'window', label: () => t('set_window'), iconName: 'window' },
  { id: 'controls', label: () => t('set_controls'), iconName: 'controller' },
  { id: 'about', label: () => t('set_about'), iconName: 'info' },
];

/**
 * Extra search terms per category. Typing "keyboard" or "mouse" should land on
 * Controls & Input even though the visible label says "Controls & Input".
 */
const SEARCH_TERMS = {
  account: ['microsoft', 'xbox', 'sign in', 'signin', 'sign out', 'logout', 'session', 'privacy', 'credentials'],
  cloud: ['stream', 'streaming', 'region', 'locale', 'catalog', 'network', 'resolution'],
  appearance: ['theme', 'dark', 'light', 'accent', 'color', 'colour', 'gradient', 'background', 'swatch'],
  animations: ['animation', 'motion', 'transition', 'speed', 'reduce'],
  performance: ['low end', 'potato', 'fps', 'blur', 'shadow', 'hardware acceleration', 'quality', 'memory', 'cpu'],
  language: ['locale', 'translate', 'hindi', 'english'],
  audio: ['sound', 'volume', 'mute', 'notification', 'speaker'],
  accessibility: ['contrast', 'text size', 'screen reader', 'reduced motion', 'tab'],
  window: ['fullscreen', 'maximize', 'minimize', 'display', 'monitor', 'borderless'],
  controls: ['keyboard', 'mouse', 'controller', 'remap', 'binding', 'input', 'profile', 'gamepad', 'stick', 'trigger', 'kbm', 'test'],
  about: ['version', 'logs', 'debug', 'credits', 'license', 'update', 'better xcloud', 'devtools'],
};
/** Rows carry searchable keywords so the settings search can jump to them. */
function row(title, desc, control, keywords = '') {
  const el = h('div.row.setting-row', { dataset: { keywords: `${title} ${desc} ${keywords}`.toLowerCase() } }, [
    h('div.r-main', [h('div.r-title', title), desc ? h('div.r-desc', desc) : null]),
    control,
  ]);
  return el;
}

function panel(title, desc, rows) {
  return h('div.panel', [
    title ? h('h3', title) : null,
    desc ? h('p.p-desc', desc) : null,
    rows.filter(Boolean),
  ].filter(Boolean));
}

function segment(options, current, onPick) {
  const bar = h('div.seg');
  for (const o of options) {
    bar.appendChild(h(`button${o.value === current ? '.on' : ''}`, {
      onclick: () => onPick(o.value),
    }, o.label));
  }
  return bar;
}

function select(options, current, onPick, ariaLabel) {
  const sel = h('select.select', {
    'aria-label': ariaLabel || '',
    onchange: (e) => onPick(e.target.value),
  }, options.map((o) => h('option', { value: o.value, selected: o.value === current }, o.label)));
  return sel;
}

// ---------- Categories ----------
function accountPanel(ctx) {
  const rows = [];
  rows.push(row(
    'Microsoft / Xbox account',
    t('signout_note'),
    h('button.btn.sm', { onclick: () => openSignIn(ctx) }, icon('external', { size: 14 }), t('open_xbox'))
  ));
  rows.push(row('Session & privacy', 'Sign-in happens only on official Microsoft pages. This app never sees or stores your password, and no tokens are written to disk or logs.',
    h('span.status-chip.ok', [h('span.dot'), 'Protected'])));
  rows.push(row('Open the Xbox web app', 'Manage your account, subscription and profile on Microsoft’s own site.',
    h('button.btn.sm', { onclick: () => window.nexus.openExternal('https://account.xbox.com') }, icon('external', { size: 14 }), 'account.xbox.com')));
  return panel(t('set_account'), null, rows);
}

async function openSignIn(ctx) {
  // Sign-in always happens on Microsoft's own site inside the stream window,
  // never in a fake in-app login form.
  try {
    await window.nexus.launch({ productId: 'SIGNIN', title: 'Xbox Cloud Gaming' });
    toastInfo(t('open_xbox'));
  } catch {
    await window.nexus.openExternal('https://account.xbox.com');
  }
}

function cloudPanel(ctx) {
  const rows = [];
  rows.push(row(t('fullscreen_play'), t('fullscreen_play_desc'), switchControl('cloud.fullscreenOnPlay', settings.get('cloud.fullscreenOnPlay'), () => ctx.repaint())));
  rows.push(row(
    'Target resolution',
    'The ceiling the app asks the service for. The stream always adapts to your connection — 1080p HQ needs a fast, stable link. Press F11 in a game to toggle fullscreen.',
    select([
      { value: 'auto', label: 'Auto (let the service decide)' },
      { value: '720p', label: '720p — lowest bandwidth' },
      { value: '1080p', label: '1080p — recommended' },
      { value: '1080p-hq', label: '1080p HQ — best quality' },
    ], settings.get('cloud.targetResolution', 'auto'), async (v) => {
      await settings.set('cloud.targetResolution', v);
      toastOk(t('saved'), 'Applies to the next game you launch');
    }, 'Target resolution'),
    'resolution, 1080p, 720p, hq, quality, fullscreen, f11',
  ));
  rows.push(row('Lock stream resolution', 'Hold the target resolution instead of letting the stream drop when the network struggles.',
    switchControl('cloud.lockResolution', settings.get('cloud.lockResolution'), () => {})));
  rows.push(row('Frame rate limit', 'Lower the cap to free GPU headroom on older machines.',
    select([
      { value: '60', label: '60 fps (uncapped)' },
      { value: '50', label: '50 fps' },
      { value: '40', label: '40 fps' },
      { value: '30', label: '30 fps' },
    ], String(settings.get('cloud.maxFps', 60)), async (v) => {
      await settings.set('cloud.maxFps', Number(v));
      toastOk(t('saved'), v === '60' ? 'Uncapped' : `${v} fps`);
    }, 'Frame rate limit'),
    'fps, framerate, frame rate, 30, 60, cap',
  ));
  rows.push(row('Video renderer', 'WebGL2 adds a clarity boost. It needs a little more GPU, so low-end mode keeps the default.',
    select([
      { value: 'default', label: 'Default (lowest overhead)' },
      { value: 'webgl2', label: 'WebGL2 (sharper)' },
    ], settings.get('cloud.renderer', 'default'), async (v) => {
      await settings.set('cloud.renderer', v);
      toastOk(t('saved'), v === 'webgl2' ? 'WebGL2' : 'Default');
    }, 'Video renderer'),
    'renderer, webgl, shader, clarity, sharpen',
  ));
  const sharpen = Number(settings.get('cloud.sharpen', 0)) || 0;
  rows.push(row('Clarity boost', sharpen
    ? 'Sharpens the upscaled stream. Small amounts look best.'
    : 'Off — the stream is upscaled without extra filtering.',
    sliderControl('cloud.sharpen', sharpen, 0, 10, 1, ctx, (v) => (v ? String(v) : 'Off'), ''),
    'sharpen, clarity, filter, upscale',
  ));
  rows.push(row('Clarity boost quality', 'Performance keeps frame time low; Quality filters more heavily.',
    select([
      { value: 'performance', label: 'Performance' },
      { value: 'quality', label: 'Quality' },
    ], settings.get('cloud.sharpenMode', 'performance'), async (v) => {
      await settings.set('cloud.sharpenMode', v);
      toastOk(t('saved'), v);
    }, 'Clarity boost quality')));
  rows.push(row('GPU preference', 'High performance keeps clocks up while gaming; Low power throttles for battery.',
    select([
      { value: 'default', label: 'Default' },
      { value: 'high-performance', label: 'High performance' },
      { value: 'low-power', label: 'Battery saving' },
    ], settings.get('cloud.powerPreference', 'default'), async (v) => {
      await settings.set('cloud.powerPreference', v);
      toastOk(t('saved'), v);
    }, 'GPU preference'),
    'gpu, power, battery, performance, hardware acceleration',
  ));
  rows.push(row(
    'Controller polling rate',
    'How often the game receives input. Higher is lower input latency and costs a little CPU. Low-end mode drops this automatically.',
    select([
      { value: '60', label: '60 Hz — lowest latency' },
      { value: '30', label: '30 Hz' },
      { value: '15', label: '15 Hz' },
      { value: '4', label: '4 Hz — minimum CPU' },
    ], String(settings.get('cloud.pollingRate', 60)), async (v) => {
      await settings.set('cloud.pollingRate', Number(v));
      toastOk(t('saved'), `${v} Hz`);
    }, 'Controller polling rate'),
    'polling, latency, input lag, hz, delay',
  ));
  rows.push(row('Preferred region / locale', t('region_note'),
    select([
      { value: 'en-US', label: 'United States (en-US)' },
      { value: 'en-GB', label: 'United Kingdom (en-GB)' },
      { value: 'en-CA', label: 'Canada (en-CA)' },
      { value: 'de-DE', label: 'Deutschland (de-DE)' },
      { value: 'fr-FR', label: 'France (fr-FR)' },
      { value: 'es-ES', label: 'España (es-ES)' },
      { value: 'pt-BR', label: 'Brasil (pt-BR)' },
      { value: 'ja-JP', label: '日本 (ja-JP)' },
      { value: 'hi-IN', label: 'भारत (hi-IN)' },
    ], settings.get('cloud.preferredLocale', 'en-US'), async (v) => { await settings.set('cloud.preferredLocale', v); toastOk(t('saved'), 'Restart the app to fully apply the region change.'); }, 'Preferred region')));
  rows.push(row('Catalog refresh', 'Cached game data refreshes automatically. Force a refresh to pull the newest catalog.',
    h('button.btn.sm', { onclick: () => ctx.refreshCatalog(true) }, icon('refresh', { size: 14 }), t('retry'))));
  rows.push(row('Session storage', 'Games stream on official Microsoft pages. Better xCloud runs locally inside this app to enable keyboard & mouse.',
    h('span.status-chip.ok', [h('span.dot'), 'Legitimate access'])));
  return panel(t('set_cloud'), null, rows);
}

function appearancePanel(ctx) {
  const rows = [];
  const theme = settings.get('appearance.theme', 'dark');

  rows.push(row(t('theme'), 'Dark, light, or follow Windows.',
    segment([
      { value: 'dark', label: t('theme_dark') },
      { value: 'light', label: t('theme_light') },
      { value: 'system', label: t('theme_system') },
    ], theme, async (v) => { await settings.set('appearance.theme', v); applyTheme(); ctx.repaint(); })));

  // Accent presets + custom colour.
  const swatches = h('div.flex.gap8.aic', { style: { flexWrap: 'wrap' } });
  for (const p of ACCENT_PRESETS) {
    const cur = settings.get('appearance.accent') === p.hex;
    swatches.appendChild(h(`button.swatch${cur ? '.on' : ''}`, {
      style: { background: p.hex },
      title: p.id,
      'aria-label': `Accent ${p.id}`,
      onclick: async () => { await settings.set('appearance.accent', p.hex); await settings.set('appearance.accentPreset', p.id); applyTheme(); ctx.repaint(); },
    }));
  }
  const custom = h('input', {
    type: 'color', class: 'color-input', value: settings.get('appearance.accent', '#6cd850'), title: t('custom_color'),
    oninput: debounce(async (e) => { await settings.set('appearance.accent', e.target.value); applyTheme(); }, 80),
  });
  swatches.appendChild(custom);
  rows.push(row(t('accent'), 'Used for highlights, the Play button and focus rings.', swatches));

  // Background: solid vs gradient.
  const bgMode = settings.get('appearance.backgroundMode', 'solid');
  rows.push(row(t('background'), 'Solid colour or a two/three-stop gradient.',
    segment([
      { value: 'solid', label: t('solid') },
      { value: 'gradient', label: t('gradient') },
    ], bgMode, async (v) => { await settings.set('appearance.backgroundMode', v); applyTheme(); ctx.repaint(); })));

  if (bgMode === 'solid') {
    rows.push(row('Background colour', 'Applies to the whole launcher.',
      h('input', {
        type: 'color', class: 'color-input', value: settings.get('appearance.bgColor', '#0b0f0d'),
        oninput: debounce(async (e) => { await settings.set('appearance.bgColor', e.target.value); applyTheme(); }, 80),
      })));
  } else {
    const g = settings.get('appearance.gradient', {});
    const colorInput = (path, label, fallback) => row(label, null, h('input', {
      type: 'color', class: 'color-input', value: g[path] || fallback,
      oninput: debounce(async (e) => { await settings.set(`appearance.gradient.${path}`, e.target.value); applyTheme(); }, 80),
    }));
    rows.push(colorInput('from', t('gradient_from'), '#0e1f14'));
    rows.push(row('Middle stop', 'Optional third colour for a smoother ramp.',
      h('span.flex.gap8.aic', [
        h('input', {
          type: 'color', class: 'color-input', value: g.mid || '#12331f',
          oninput: debounce(async (e) => { await settings.set('appearance.gradient.mid', e.target.value); applyTheme(); }, 80),
        }),
        switchControl('appearance.gradient.useMid', !!g.useMid, () => applyTheme()),
      ])));
    rows.push(colorInput('to', t('gradient_to'), '#0b0f0d'));
    rows.push(row(t('gradient_angle'), 'Direction of the gradient.',
      sliderControl('appearance.gradient.angle', Number(g.angle ?? 160), 0, 360, 1, ctx)));
    rows.push(row(t('gradient_intensity'), 'How far the gradient travels.',
      sliderControl('appearance.gradient.intensity', Number(g.intensity ?? 70), 0, 100, 1, ctx)));
  }

  return panel(t('set_appearance'), 'Make the launcher look the way you want.', rows);
}

function animationsPanel(ctx) {
  const rows = [];
  const anim = settings.get('appearance.animations', 'full');
  rows.push(row('Animation style', 'Reduced and off modes also cut GPU work.',
    segment([
      { value: 'full', label: t('animations_full') },
      { value: 'reduced', label: t('animations_reduced') },
      { value: 'minimal', label: t('animations_minimal') },
      { value: 'off', label: t('animations_off') },
    ], anim, async (v) => { await settings.set('appearance.animations', v); applyTheme(); ctx.repaint(); })));
  rows.push(row(t('speed'), 'Multiplier applied to every transition.',
    sliderControl('appearance.animationSpeed', Number(settings.get('appearance.animationSpeed', 1)), 0.2, 2, 0.1, ctx)));
  rows.push(row('Preview', 'Card hover and page transitions use these settings.',
    h('div.flex.gap8.aic', [
      h('button.btn.sm.primary', { onclick: () => { ctx.repaint(); toastOk(t('saved')); } }, 'Play now'),
      h('button.btn.sm', { onclick: () => ctx.repaint() }, 'Secondary'),
    ])));
  return panel(t('set_animations'), null, rows);
}

function performancePanel(ctx) {
  const rows = [];
  const preset = settings.get('performance.preset', 'balanced');
  rows.push(row(t('preset'), 'Low-End Mode turns off blur, shadows and ambient effects.',
    segment([
      { value: 'low', label: t('perf_low') },
      { value: 'balanced', label: t('perf_balanced') },
      { value: 'quality', label: t('perf_quality') },
    ], preset, async (v) => { await applyPreset(v); ctx.repaint(); })));
  rows.push(row(t('low_end'), t('low_end_desc'), switchControl('performance.lowEndMode', settings.get('performance.lowEndMode'), async () => { await applyPreset(settings.get('performance.preset')); ctx.repaint(); })));
  rows.push(row(t('ui_quality'), 'Higher quality renders shadows and gradients.',
    select([{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }],
      settings.get('performance.uiQuality', 'high'), async (v) => { await settings.set('performance.uiQuality', v); applyTheme(); ctx.repaint(); }, 'UI quality')));
  rows.push(row(t('blur_fx'), null, switchControl('performance.blur', settings.get('performance.blur'), () => { applyTheme(); ctx.repaint(); })));
  rows.push(row(t('shadows_fx'), null, switchControl('performance.shadows', settings.get('performance.shadows'), () => { applyTheme(); ctx.repaint(); })));
  rows.push(row(t('bg_fx'), null, switchControl('performance.backgroundFx', settings.get('performance.backgroundFx'), () => { applyTheme(); ctx.repaint(); })));
  rows.push(row(t('hw_accel'), t('hw_accel_desc'), switchControl('performance.hwAccel', settings.get('performance.hwAccel'), async (v) => {
    if (!v) toastWarn('Restart required', 'Hardware acceleration changes take effect after restart.');
    else toastInfo('Restart required');
  })));
  const info = window.nexus.appInfo ? null : null;
  return panel(t('set_performance'), 'Tuned to keep the launcher smooth on older PCs.', rows);
}

async function applyPreset(preset) {
  await settings.set('performance.preset', preset);
  if (preset === 'low') {
    await settings.set('performance.lowEndMode', true);
    await settings.set('performance.blur', false);
    await settings.set('performance.shadows', false);
    await settings.set('performance.backgroundFx', false);
    await settings.set('performance.uiQuality', 'low');
  } else if (preset === 'quality') {
    await settings.set('performance.lowEndMode', false);
    await settings.set('performance.blur', true);
    await settings.set('performance.shadows', true);
    await settings.set('performance.backgroundFx', true);
    await settings.set('performance.uiQuality', 'high');
  } else {
    await settings.set('performance.lowEndMode', false);
    await settings.set('performance.blur', true);
    await settings.set('performance.shadows', true);
    await settings.set('performance.backgroundFx', true);
    await settings.set('performance.uiQuality', 'medium');
  }
  applyTheme();
}

function languagePanel(ctx) {
  const rows = [];
  rows.push(row('Interface language', t('language_note'),
    select(availableLangs().map((l) => ({ value: l.code, label: l.name })), getLang(), async (v) => {
      await settings.set('app.locale', v);
      setLang(v);
      ctx.repaint();
      ctx.rerenderAll?.();
    }, 'Interface language')));
  return panel(t('set_language'), t('language_note'), rows);
}

function audioPanel(ctx) {
  const rows = [];
  rows.push(row(t('ui_sounds'), t('ui_sounds_desc'), switchControl('audio.uiSounds', settings.get('audio.uiSounds'), () => { sfx('toggle'); ctx.repaint(); })));
  rows.push(row(t('volume'), 'Applies to launcher UI sounds only — game audio is untouched.',
    sliderControl('audio.uiVolume', Number(settings.get('audio.uiVolume', 0.6)), 0, 1, 0.05, ctx)));
  rows.push(row('Notifications', 'Show toasts for launches, profile changes and errors.',
    switchControl('audio.notifications', settings.get('audio.notifications'), () => ctx.repaint())));
  rows.push(row(t('notif_test'), t('notif_test_msg'),
    h('button.btn.sm', { onclick: () => { unlockAudio(); toastOk(t('notif_test'), t('notif_test_msg')); } }, 'Send test')));
  return panel(t('set_audio'), 'Game audio is never modified.', rows);
}

function accessibilityPanel(ctx) {
  const rows = [];
  rows.push(row(t('reduced_motion_os'), 'When Windows asks for reduced motion we soften animations automatically.',
    h('span.status-chip.ok', [h('span.dot'), 'Respected'])));
  rows.push(row(t('high_contrast'), 'Stronger borders and text contrast for readability.',
    switchControl('appearance.highContrast', settings.get('appearance.highContrast'), () => { applyTheme(); ctx.repaint(); })));
  rows.push(row(t('text_size'), 'Scales every text size in the app.',
    sliderControl('appearance.textScale', Number(settings.get('appearance.textScale', 1)), 0.85, 1.4, 0.05, ctx)));
  rows.push(row('Keyboard navigation', 'All controls are reachable with Tab, and Enter/Space activate them.',
    h('span.status-chip.ok', [h('span.dot'), 'Enabled'])));
  rows.push(row('Colour independence', 'Status is always shown with an icon and text, never colour alone.', null));
  return panel(t('set_accessibility'), null, rows);
}

function windowPanel(ctx) {
  const rows = [];
  rows.push(row(t('window_mode'), 'Applies immediately to this window.',
    segment([
      { value: 'normal', label: t('win_normal') },
      { value: 'maximized', label: t('win_max') },
      { value: 'fullscreen', label: t('win_full') },
    ], settings.get('window.mode', 'maximized'), async (v) => {
      await settings.set('window.mode', v);
      await window.nexus.window.mode(v);
    })));
  rows.push(row(t('start_max'), null, switchControl('window.startMaximized', settings.get('window.startMaximized'), () => ctx.repaint())));
  rows.push(row(t('remember_bounds'), null, switchControl('window.rememberBounds', settings.get('window.rememberBounds'), () => ctx.repaint())));
  return panel(t('set_window'), null, rows);
}

function controlsPanel(ctx) {
  // Controls has a dedicated screen; show a launcher + live status here.
  const rows = [];
  rows.push(row(t('controls_title'), 'Remap every button, manage profiles and test your inputs.',
    h('button.btn.sm.primary', { onclick: () => { setControlsTab('controller'); ctx.navigate('controls'); } }, icon('controller', { size: 14 }), t('open'))));
  rows.push(row(t('kbm_section'), t('kbm_section_desc', { key: settings.get('input.kbmToggleKey', 'F8') }),
    switchControl('input.kbmEnabled', settings.get('input.kbmEnabled'), () => ctx.repaint())));
  rows.push(row(t('profiles_results'), `${profiles().length} profile(s)`, null));
  rows.push(row(t('reset_all_controls'), 'Restore every control profile to defaults.',
    h('button.btn.sm.danger', { onclick: () => ctx.navigate('controls') }, t('reset_confirm'))));
  return panel(t('set_controls'), null, rows);
}

async function aboutPanel(ctx) {
  const info = await window.nexus.appInfo();
  const rows = [];
  rows.push(row(t('version'), `Electron ${info.electron} · Chromium ${info.chrome} · Node ${info.node}`,
    h('button.btn.sm', { onclick: () => window.nexus.toggleDevTools() }, 'DevTools')));
  rows.push(row('Better xCloud', `v${info.bx?.version || '?'} — MIT, © 2023 redphx. Bundled and injected locally; no updates are fetched online.`,
    h('a.btn.sm', { href: 'https://github.com/redphx/better-xcloud', onclick: (e) => { e.preventDefault(); window.nexus.openExternal('https://github.com/redphx/better-xcloud'); } }, t('credits'))));
  rows.push(row(t('debug_mode'), t('debug_desc'), switchControl('app.debugMode', settings.get('app.debugMode'), () => ctx.repaint())));
  rows.push(row(t('logs_title'), 'Inspect logs for catalog, launch, controller and input issues.',
    h('button.btn.sm', { onclick: () => showLogs(ctx) }, icon('eye', { size: 14 }), t('view_logs'))));
  rows.push(row(t('check_updates'), t('updates_note', { bx: info.bx?.version || '?' }), null));
  rows.push(row('Hardware', `${info.hw.cpus} CPU cores · ${info.hw.memGB} GB RAM`, null));
  return panel(t('set_about'), null, rows);
}

async function showLogs(ctx) {
  const lines = await window.nexus.debugLogs();
  const pre = h('pre.log-view', lines.join('\n') || 'No log entries yet.');
  await openModal({
    title: t('logs_title'),
    body: pre,
    actions: [
      { label: 'Close', value: null, kind: 'ghost' },
      { label: t('copy_logs'), value: 'copy', kind: 'primary' },
    ],
    width: 760,
    onClose: async (v) => {
      if (v === 'copy') { const ok = await copyText(lines.join('\n')); ok ? toastOk(t('saved')) : toastErr(new Error('Clipboard unavailable')); }
    },
  });
}

// ---------- Settings search ----------
function buildSearchIndex() {
  const idx = [];
  for (const c of CATEGORIES) {
    const label = c.label();
    const terms = (SEARCH_TERMS[c.id] || []).join(' ');
    idx.push({
      cat: c.id,
      kind: 'cat',
      label,
      keywords: `${label} settings ${terms}`.toLowerCase(),
      iconName: c.iconName,
    });
  }
  return idx;
}

/** Jump to a category and briefly highlight it. */
function gotoCategory(ctx, id) {
  ctx.repaint();
  requestAnimationFrame(() => {
    const el = document.querySelector(`.settings-wrap [data-cat="${id}"]`);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 900); }
  });
}

// ---------- View ----------
export function createView(ctx) {
  let category = 'appearance';
  return {
    id: 'settings',
    render(root) {
      const page = h('div.page');
      root.appendChild(page);

      const search = h('input', {
        type: 'search',
        placeholder: t('search_settings'),
        'aria-label': t('search_settings'),
        oninput: debounce((e) => renderSearch(e.target.value), 120),
      });

      const results = h('div.settings-results.hidden');

      function renderSearch(q) {
        const query = String(q || '').toLowerCase().trim();
        clear(results);
        if (!query) { results.classList.add('hidden'); return; }
        results.classList.remove('hidden');
        const matches = buildSearchIndex().filter((x) => x.keywords.includes(query));
        if (!matches.length) {
          results.appendChild(h('div.p-empty', t('settings_searched_none')));
          return;
        }
        for (const m of matches) {
          results.appendChild(h('button.p-item', { onclick: () => { category = m.cat; results.classList.add('hidden'); search.value = ''; gotoCategory(ctx, m.cat); } }, [
            h('span.pi-icon', icon(m.iconName, { size: 16 })),
            h('span', [h('div.pi-name', m.label), h('div.pi-sub', t('settings_results'))]),
          ]));
        }
      }

      const paint = () => {
        clear(page);
        page.appendChild(h('div.settings-wrap', [
          h('div', [
            h('div.searchbox.settings-search', [icon('search', { size: 16 }), search]),
            h('nav.settings-nav', { 'aria-label': 'Settings categories' }, [
              ...CATEGORIES.map((c) => h(`button.nav-item${category === c.id ? '.active' : ''}`, {
                dataset: { cat: c.id },
                onclick: () => { category = c.id; paint(); },
              }, [icon(c.iconName, { size: 18 }), c.label()])),
            ]),
          ]),
          h('div', [
            results,
            h('div', { dataset: { cat: category } }, renderCategory(ctx, category)),
            dangerZone(ctx),
          ]),
        ]));
      };

      paint();
      return () => {};
    },
  };
}

function renderCategory(ctx, id) {
  switch (id) {
    case 'account': return accountPanel(ctx);
    case 'cloud': return cloudPanel(ctx);
    case 'appearance': return appearancePanel(ctx);
    case 'animations': return animationsPanel(ctx);
    case 'performance': return performancePanel(ctx);
    case 'language': return languagePanel(ctx);
    case 'audio': return audioPanel(ctx);
    case 'accessibility': return accessibilityPanel(ctx);
    case 'window': return windowPanel(ctx);
    case 'controls': return controlsPanel(ctx);
    case 'about': return aboutPanel(ctx);
    default: return h('div');
  }
}

function dangerZone(ctx) {
  return h('div.panel', [
    h('h3', t('reset_settings')),
    h('p.p-desc', t('reset_settings_msg')),
    h('div.flex.gap8', [
      h('button.btn.sm.danger', { onclick: () => doResetSettings(ctx) }, icon('refresh', { size: 14 }), t('reset_settings')),
      h('button.btn.sm.danger', { onclick: () => doResetControls(ctx) }, icon('controller', { size: 14 }), t('reset_all_controls')),
    ]),
  ]);
}

async function doResetSettings(ctx) {
  const ok = await confirmDialog({ title: t('reset_settings'), message: t('reset_settings_msg'), confirmLabel: t('reset_confirm') });
  if (!ok) return;
  const fresh = await window.nexus.settings.resetAll();
  settings.replaceAll(fresh);
  applyTheme();
  setLang(fresh.app?.locale || 'en');
  ctx.repaint();
  toastOk(t('saved'));
}

async function doResetControls(ctx) {
  const ok = await confirmDialog({ title: t('reset_all_controls'), message: 'Reset every control profile and per-game binding to defaults?', confirmLabel: t('reset_confirm') });
  if (!ok) return;
  await settings.set('input.profiles', [settings.get('input.profiles', [])[0]].filter(Boolean));
  await settings.set('input.activeProfile', 'default');
  await settings.set('input.gameProfiles', {});
  ctx.repaint();
  toastOk(t('saved'));
}

export { CATEGORIES };