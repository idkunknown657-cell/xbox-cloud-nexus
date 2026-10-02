/**
 * Theme engine — turns persisted settings into CSS custom properties and body
 * classes. Everything visual reads from these, so a single apply() call
 * re-themes the whole launcher (including after language or preset changes).
 */
import { settings } from './store.js';

const HEX = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i;

export function hexToRgb(hex) {
  const m = String(hex || '').match(HEX);
  if (!m) return { r: 108, g: 216, b: 80 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

export function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Relative luminance (sRGB) used to pick readable text over an accent. */
export function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastText(hex) {
  return luminance(hex) > 0.42 ? '#0b120c' : '#ffffff';
}

const media = window.matchMedia('(prefers-color-scheme: light)');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

export const ACCENT_PRESETS = [
  { id: 'nexus', hex: '#6cd850' },
  { id: 'blue', hex: '#4c9bff' },
  { id: 'purple', hex: '#a074ff' },
  { id: 'magenta', hex: '#ff6bbf' },
  { id: 'red', hex: '#ff5f57' },
  { id: 'orange', hex: '#ff9f45' },
  { id: 'yellow', hex: '#f5d020' },
  { id: 'cyan', hex: '#35d6e0' },
  { id: 'mint', hex: '#3fe0b0' },
  { id: 'slate', hex: '#9fb0c8' },
];

const root = document.documentElement;
const body = document.body;

/** Effective theme after resolving 'system'. */
export function effectiveTheme() {
  const mode = settings.get('appearance.theme', 'dark');
  if (mode === 'system') return media.matches ? 'light' : 'dark';
  return mode === 'light' ? 'light' : 'dark';
}

/** Animations are clamped by both the user setting and the OS preference. */
export function effectiveAnimations() {
  const mode = settings.get('appearance.animations', 'full');
  if (reducedMotion.matches && mode === 'full') return 'reduced';
  return mode;
}

function applyAccent(hex) {
  const c = hex || '#6cd850';
  root.style.setProperty('--accent', c);
  root.style.setProperty('--accent-soft', rgba(c, 0.16));
  root.style.setProperty('--accent-dim', rgba(c, 0.55));
  root.style.setProperty('--accent-ink', contrastText(c));
}

function applyBackground() {
  const mode = settings.get('appearance.backgroundMode', 'solid');
  if (mode !== 'gradient') {
    const solid = settings.get('appearance.bgColor', '#0b0f0d');
    root.style.setProperty('--bg', solid);
    root.style.setProperty('--bg-gradient', 'none');
    return;
  }
  const g = settings.get('appearance.gradient', {}) || {};
  const from = g.from || '#0e1f14';
  const mid = g.mid || '#12331f';
  const to = g.to || '#0b0f0d';
  const angle = Number(g.angle ?? 160);
  const intensity = Math.max(0, Math.min(100, Number(g.intensity ?? 70)));
  // Intensity scales how far the gradient travels from the base colour.
  const rad = (angle * Math.PI) / 180;
  const dx = Math.cos(rad) * 50 * (intensity / 100);
  const dy = Math.sin(rad) * 50 * (intensity / 100);
  const stops = g.useMid
    ? `rgb(${hexToRgb(from).r}, ${hexToRgb(from).g}, ${hexToRgb(from).b}) 0%, rgb(${hexToRgb(mid).r}, ${hexToRgb(mid).g}, ${hexToRgb(mid).b}) 52%, rgb(${hexToRgb(to).r}, ${hexToRgb(to).g}, ${hexToRgb(to).b}) 100%`
    : `rgb(${hexToRgb(from).r}, ${hexToRgb(from).g}, ${hexToRgb(from).b}) 0%, rgb(${hexToRgb(to).r}, ${hexToRgb(to).g}, ${hexToRgb(to).b}) ${100 - (100 - intensity) * 0.55}%`;
  root.style.setProperty('--bg', to);
  root.style.setProperty('--bg-gradient', `linear-gradient(${Math.round(angle)}deg at ${(50 + dx).toFixed(1)}% ${(50 + dy).toFixed(1)}%, ${stops})`);
}

function applyPerformanceFlags() {
  const low = settings.get('performance.lowEndMode', false);
  const blur = settings.get('performance.blur', true) && !low;
  const noAnim = low || settings.get('performance.uiQuality', 'high') === 'low' || effectiveAnimations() === 'off';
  const noFx = !settings.get('performance.backgroundFx', true) || low;
  const noShadow = !settings.get('performance.shadows', true) || low;
  body.classList.toggle('perf-blur', !!blur);
  body.classList.toggle('perf-noanim', !!noAnim);
  body.classList.toggle('perf-nofx', !!noFx);
  body.classList.toggle('perf-noshadow', !!noShadow);
}

export function applyTheme() {
  const theme = effectiveTheme();
  body.classList.toggle('theme-light', theme === 'light');
  body.classList.toggle('theme-dark', theme !== 'light');

  const anim = effectiveAnimations();
  body.classList.remove('anim-full', 'anim-reduced', 'anim-minimal', 'anim-off');
  body.classList.add(`anim-${anim}`);

  body.classList.toggle('hc', !!settings.get('appearance.highContrast', false));

  const speed = Number(settings.get('appearance.animationSpeed', 1)) || 1;
  root.style.setProperty('--speed', String(Math.max(0.2, Math.min(3, speed))));
  root.style.setProperty('--text-scale', String(Number(settings.get('appearance.textScale', 1)) || 1));

  applyAccent(settings.get('appearance.accent', '#6cd850'));
  applyBackground();
  applyPerformanceFlags();

  document.documentElement.dataset.theme = theme;
}

// Re-apply on OS theme / motion changes so 'system' and accessibility stay live.
media.addEventListener('change', () => { if (settings.get('appearance.theme') === 'system') applyTheme(); });
reducedMotion.addEventListener('change', applyTheme);

/** Walk a settings path and collect every scalar leaf with its i18n label key. */
export function settingsIndex() {
  const out = [];
  const labels = {
    'appearance.theme': 'theme', 'appearance.accent': 'accent', 'appearance.backgroundMode': 'background',
    'appearance.textScale': 'text_size', 'appearance.highContrast': 'high_contrast',
    'appearance.animations': 'animations', 'appearance.animationSpeed': 'speed',
    'performance.preset': 'preset', 'performance.hwAccel': 'hw_accel', 'performance.uiQuality': 'ui_quality',
    'performance.blur': 'blur_fx', 'performance.shadows': 'shadows_fx', 'performance.backgroundFx': 'bg_fx',
    'performance.lowEndMode': 'low_end',
    'audio.uiSounds': 'ui_sounds', 'audio.uiVolume': 'volume',
    'audio.notifications': 'notifications',
    'cloud.targetResolution': 'resolution', 'cloud.fullscreenOnPlay': 'fullscreen_play',
    'window.mode': 'window_mode', 'window.startMaximized': 'start_max', 'window.rememberBounds': 'remember_bounds',
    'input.kbmEnabled': 'kbm_section', 'input.kbmToggleKey': 'toggle_key', 'input.showStreamStats': 'show_stats',
    'app.debugMode': 'debug_mode', 'app.locale': 'language',
  };
  const walk = (obj, prefix) => {
    for (const [k, v] of Object.entries(obj || {})) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, path);
      else if (typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string') out.push({ path, key: labels[path] || path });
    }
  };
  walk(settings.data || {}, '');
  return out;
}