/**
 * Global search / command palette.
 *
 * One input finds games, settings rows, control profiles and navigation
 * targets. Opened with the toolbar search box or Ctrl+K.
 */
import { h, clear, debounce } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import * as cat from '../catalog.js';
import { settings } from '../store.js';
import { CATEGORIES } from './settings.js';

const NAV_TARGETS = [
  { id: 'home', label: () => t('nav_home'), iconName: 'home', kind: () => t('sections') },
  { id: 'cloud', label: () => t('nav_cloud'), iconName: 'cloud', kind: () => t('sections') },
  { id: 'library', label: () => t('nav_library'), iconName: 'library', kind: () => t('sections') },
  { id: 'playads', label: () => t('nav_playAds'), iconName: 'ads', kind: () => t('sections') },
  { id: 'recent', label: () => t('nav_recent'), iconName: 'clock', kind: () => t('sections') },
  { id: 'favorites', label: () => t('nav_favorites'), iconName: 'heart', kind: () => t('sections') },
  { id: 'settings', label: () => t('nav_settings'), iconName: 'settings', kind: () => t('sections') },
  { id: 'controls', label: () => t('set_controls'), iconName: 'controller', kind: () => t('sections') },
];

/** Extra settings keywords so "keyboard" or "mouse" finds the right page. */
const SETTINGS_HINTS = [
  { cat: 'controls', terms: ['keyboard', 'mouse', 'controller', 'remap', 'input', 'profile', 'gamepad', 'stick', 'trigger', 'kbm'] },
  { cat: 'appearance', terms: ['theme', 'accent', 'color', 'colour', 'gradient', 'background', 'dark', 'light'] },
  { cat: 'animations', terms: ['animation', 'motion', 'speed', 'transition'] },
  { cat: 'performance', terms: ['performance', 'low end', 'potato', 'fps', 'blur', 'shadow', 'hardware acceleration', 'quality'] },
  { cat: 'language', terms: ['language', 'hindi', 'english', 'locale', 'translate'] },
  { cat: 'audio', terms: ['audio', 'volume', 'sound', 'mute', 'notification'] },
  { cat: 'accessibility', terms: ['accessibility', 'contrast', 'text size', 'screen reader', 'reduced motion'] },
  { cat: 'window', terms: ['window', 'fullscreen', 'maximize', 'display', 'monitor', 'resolution'] },
  { cat: 'account', terms: ['account', 'sign in', 'signin', 'microsoft', 'xbox', 'session', 'logout', 'sign out'] },
  { cat: 'cloud', terms: ['cloud', 'region', 'catalog', 'stream', 'network'] },
  { cat: 'about', terms: ['about', 'version', 'logs', 'debug', 'credits', 'license', 'update', 'better xcloud'] },
];

function settingsMatches(q) {
  const out = new Map();
  for (const c of CATEGORIES) {
    const label = c.label();
    if (label.toLowerCase().includes(q)) out.set(c.id, label);
  }
  for (const hint of SETTINGS_HINTS) {
    for (const term of hint.terms) {
      if (!term.includes(q) && !q.includes(term)) continue;
      const cat = CATEGORIES.find((c) => c.id === hint.cat);
      if (cat && !out.has(hint.cat)) out.set(hint.cat, cat.label());
      break;
    }
  }
  return [...out.entries()].map(([id, label]) => ({
    group: t('settings_results'), label, iconName: CATEGORIES.find((c) => c.id === id)?.iconName || 'settings', run: (ctx) => { ctx.navigate('settings', id); },
  }));
}

function profileMatches(q, ctx) {
  const list = settings.get('input.profiles', []) || [];
  return list
    .filter((p) => p.name.toLowerCase().includes(q))
    .map((p) => ({
      group: t('profiles_results'),
      label: p.name,
      sub: p.id === settings.get('input.activeProfile') ? 'Active profile' : t('profile_default'),
      iconName: 'layers',
      run: () => { ctx.navigate('controls'); },
    }));
}

function navMatches(q) {
  return NAV_TARGETS
    .filter((n) => n.label().toLowerCase().includes(q) || n.id.includes(q))
    .map((n) => ({ group: t('sections'), label: n.label(), iconName: n.iconName, run: (ctx) => ctx.navigate(n.id) }));
}

/**
 * Open the palette.
 * @param {{navigate:Function, openDetails:Function}} ctx
 * @param {string} [initial]
 */
export function openPalette(ctx, initial = '') {
  const overlays = document.getElementById('overlays');
  const input = h('input', {
    type: 'text', value: initial, spellcheck: false, autocomplete: 'off',
    placeholder: t('search_placeholder'), 'aria-label': t('quick_search'),
  });
  const results = h('div.p-results', { role: 'listbox' });
  const palette = h('div.palette', [
    h('div.p-input', [icon('search', { size: 18 }), input]),
    results,
  ]);
  const veil = h('div.palette-veil', { onclick: (e) => { if (e.target === veil) close(); } }, palette);

  let flat = [];
  let cursor = 0;

  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    veil.remove();
  };

  function collect(qRaw) {
    const q = String(qRaw || '').trim().toLowerCase();
    if (!q) {
      flat = [
        { group: t('quick_search'), label: t('type_to_search'), iconName: 'search', muted: true, run: () => {} },
      ];
      return;
    }
    const games = cat.searchGames(q, 12).map((hit) => ({
      group: t('games'),
      label: hit.p.title,
      sub: hit.p.publisher || hit.p.developer || '',
      img: cat.sizedArt(cat.portraitArt(hit.p), 120),
      run: () => { close(); ctx.openDetails(hit.p); },
    }));
    flat = [...games, ...settingsMatches(q), ...profileMatches(q, ctx), ...navMatches(q)];
    if (!flat.length) {
      flat = [{ group: '', label: t('no_results'), sub: t('no_results_sub'), muted: true, run: () => {} }];
    }
  }

  function paint() {
    clear(results);
    let lastGroup = null;
    flat.forEach((item, i) => {
      if (item.group !== lastGroup && item.group) {
        results.appendChild(h('div.p-group', item.group));
        lastGroup = item.group;
      }
      const el = h(`button.p-item${i === cursor ? '.sel' : ''}${item.muted ? '.muted' : ''}`, {
        role: 'option', dataset: { i: String(i) },
        onclick: () => { if (!item.muted) { close(); item.run(ctx); } },
        onmouseenter: () => { cursor = i; markSelection(); },
      }, [
        item.img ? h('img', { src: item.img, alt: '', loading: 'lazy' }) : h('span.pi-icon', icon(item.iconName || 'dot', { size: 16 })),
        h('span.grow', [h('div.pi-name', item.label), item.sub ? h('div.pi-sub', item.sub) : null].filter(Boolean)),
      ]);
      results.appendChild(el);
    });
  }

  function markSelection() {
    Array.from(results.querySelectorAll('.p-item')).forEach((el) => {
      el.classList.toggle('sel', Number(el.dataset.i) === cursor);
    });
    const sel = results.querySelector('.p-item.sel');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  const update = debounce((v) => { collect(v); cursor = 0; paint(); }, 90);

  input.addEventListener('input', () => update(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); cursor = Math.min(flat.length - 1, cursor + 1); markSelection(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cursor = Math.max(0, cursor - 1); markSelection(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const item = flat[cursor];
      if (item && !item.muted) { close(); item.run(ctx); }
    }
  });

  const onKey = (e) => {
    if (!veil.isConnected) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  };
  document.addEventListener('keydown', onKey, true);

  overlays.appendChild(veil);
  collect(initial);
  cursor = 0;
  paint();
  setTimeout(() => { input.focus(); input.select(); }, 30);
  return { close };
}