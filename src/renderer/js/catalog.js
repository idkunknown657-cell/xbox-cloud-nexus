/**
 * Catalog model for the renderer.
 *
 * Owns the in-memory index of cloud games, all derived lists (favorites,
 * recent, free-with-ads, KBM-supported…), and every card/rail/grid builder.
 * Network work is delegated to the main process; this layer only shapes data
 * and paints DOM. Images load lazily through a single shared IntersectionObserver.
 */
import { h, clear, stableShuffle } from './dom.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { settings, emit } from './store.js';
import { toastOk, toastInfo } from './toast.js';
import { accessFor as decide, accountFromSettings } from './entitlements.js';

// ---------- Store artwork ----------
//
// Covers are the single biggest cost on the home and library screens: the store
// serves 2–4 MB originals, and asking for hundreds of them is what makes
// thumbnails feel slow. Microsoft's image host accepts resize/format hints, so
// every cover is requested once, at roughly the size it is painted at, and only
// when it scrolls into view.
const ART_WIDTH = { tiny: 180, card: 300, wide: 640, hero: 1280 };
const artCache = new Map();

/**
 * Rewrite a store image URL to the size we actually paint.
 * Unknown hosts are returned untouched so a change on Microsoft's side can
 * never break the covers entirely.
 */
export function sizedArt(url, width, format = 'jpg') {
  if (!url) return null;
  const key = `${url}|${width}|${format}`;
  const hit = artCache.get(key);
  if (hit !== undefined) return hit;
  let out = url;
  try {
    const u = new URL(url);
    if (/(^|\.)xboxlive\.com$/.test(u.hostname) || /(^|\.)microsoft\.com$/.test(u.hostname)) {
      if (width) u.searchParams.set('w', String(width));
      if (/images-eds/i.test(u.hostname)) {
        u.searchParams.set('format', format);
        u.searchParams.set('q', '78');
        u.searchParams.set('h', String(Math.round(width * 1.5)));
      } else {
        u.searchParams.set('q', '78');
      }
    }
    out = u.toString();
  } catch { /* keep the original URL */ }
  artCache.set(key, out);
  return out;
}

// ---------- Shared lazy image observer ----------
let imgObserver = null;
function observer() {
  if (imgObserver) return imgObserver;
  imgObserver = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const img = e.target;
      imgObserver.unobserve(img);
      const src = img.dataset.src;
      if (!src) continue;
      // The hint must be cleared before src is set, otherwise the browser keeps
      // painting the placeholder while the real cover downloads.
      img.removeAttribute('data-src');
      img.addEventListener('load', () => { img.classList.add('loaded'); img.classList.remove('art-pending'); }, { once: true });
      img.addEventListener('error', () => { img.classList.add('art-fallback'); img.removeAttribute('src'); }, { once: true });
      img.src = src;
    }
  }, { rootMargin: '600px 0px', threshold: 0.01 });
  return imgObserver;
}

/**
 * Mark an <img> for lazy loading (avoids decoding hundreds of covers at once).
 * Width/height are set before the source so the browser reserves the box and
 * the grid never reflows as covers arrive — that reflow is the "laggy" bit.
 */
function lazyImg(src, alt, cls = 'art', width = ART_WIDTH.card) {
  const img = h(`img.${cls}`, {
    alt: alt || '',
    decoding: 'async',
    loading: 'lazy',
    draggable: false,
    width: String(width),
    height: String(Math.round(width * 1.5)),
  });
  const full = src ? sizedArt(src, width) : null;
  if (full) {
    img.dataset.src = full;
    observer().observe(img);
  } else {
    img.classList.add('art-fallback');
  }
  return img;
}

// ---------- State ----------
export const state = {
  loaded: false,
  loading: false,
  error: null,
  fetchedAt: 0,
  details: new Map(),   // productId -> product
  seen: new Set(),      // every productId known from any list
  lists: {},            // key -> { title, ids: [] }
  order: [],            // stable ordering of every known productId
  fromCache: false,
};

const listeners = new Set();
export function onCatalogChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function notify() { for (const fn of listeners) { try { fn(state); } catch { /* view went away */ } } }

// ---------- Loading ----------
export async function loadCatalog({ force = false } = {}) {
  if (state.loading) return state;
  if (state.loaded && !force) return state;
  state.loading = true;
  state.error = null;
  notify();
  try {
    const data = await window.nexus.catalog.library();
    ingest(data);
    state.loaded = true;
    state.loading = false;
    streamDetails();
    notify();
  } catch (err) {
    state.loading = false;
    state.error = err?.message || String(err);
    // Keep whatever we already had: stale data beats an empty screen.
    notify();
  }
  return state;
}

/**
 * The main process keeps downloading product records after the lists land and
 * pushes them here in chunks. Merge them as they arrive and repaint on a timer
 * so a burst of chunks never turns into a burst of full re-renders.
 */
let streaming = false;
function streamDetails() {
  if (streaming || !window.nexus?.events?.catalogDetails) return;
  streaming = true;
  let queued = false;
  window.nexus.events.catalogDetails((payload) => {
    const details = payload?.details;
    if (!details) return;
    let changed = 0;
    for (const [id, p] of Object.entries(details)) {
      if (p && p.id && !state.details.has(id)) { state.details.set(id, p); changed++; }
    }
    if (!changed || queued) return;
    queued = true;
    setTimeout(() => { queued = false; notify(); }, 350);
  });
}

function ingest(data) {
  if (!data) return;
  state.lists = data.lists || {};
  state.fetchedAt = data.fetchedAt || Date.now();
  for (const [id, p] of Object.entries(data.details || {})) {
    if (p && p.id) state.details.set(p.id, p);
  }
  const seen = new Set();
  const add = (id) => {
    state.seen.add(id);
    if (!seen.has(id)) { seen.add(id); state.order.push(id); }
  };
  for (const id of state.lists.all?.ids || []) add(id);
  // Products that only appear in a sub-list still deserve a spot in the order.
  for (const list of Object.values(state.lists)) {
    for (const id of list?.ids || []) add(id);
  }
}

export async function loadProduct(id) {
  if (state.details.has(id)) return state.details.get(id);
  try {
    const p = await window.nexus.catalog.product(id);
    if (p && p.id) { state.details.set(id, p); return p; }
  } catch { /* fall through to the list-only record */ }
  return null;
}

// ---------- Derived lists ----------
/**
 * Products whose detail record hasn't arrived yet (cold start, partial fetch)
 * still get a placeholder so they never silently vanish from a rail.
 */
function placeholder(id) {
  return {
    id,
    title: '…',
    short: '',
    long: '',
    publisher: '',
    developer: '',
    art: { portrait: null, tile: null, hero: null, logo: null, screenshot: null },
    genres: [],
    pending: true,
  };
}

export const get = (id) => state.details.get(id) || (state.seen.has(id) ? placeholder(id) : null);
export const count = (listKey) => (state.lists[listKey]?.ids || []).length;

function listIds(key) { return (state.lists[key]?.ids || []).slice(); }

export const idsAll = () => state.order.filter((id) => state.details.has(id));
export const idsFreeWithAds = () => listIds('freeWithAds');
export const idsPopular = () => listIds('popular');
export const idsRecentlyAdded = () => listIds('recentlyAdded');
export const idsLeavingSoon = () => listIds('leavingSoon');
export const idsKbm = () => listIds('playWithMkb');
export const idsGamePass = () => listIds('all');
export const idsF2P = () => listIds('freeToPlay');
export const idsFamily = () => listIds('family');

export const GENRES = [
  { key: 'action-adventure', label: 'Action / Adventure' },
  { key: 'role-playing', label: 'RPG' },
  { key: 'shooter', label: 'Shooter' },
  { key: 'strategy', label: 'Strategy' },
  { key: 'simulation', label: 'Simulation' },
  { key: 'fighting', label: 'Fighting' },
  { key: 'indie', label: 'Indie' },
];
export const idsGenre = (key) => listIds(`genres.${key}`);

export const hasAds = (id) => (state.lists.freeWithAds?.ids || []).includes(id);
export const hasKbm = (id) => (state.lists.playWithMkb?.ids || []).includes(id);
export const isGamePass = (id) => (state.lists.all?.ids || []).includes(id);

/**
 * What this account may do with a game, given the signed-in state and plan.
 *
 * @param {string|object} game product id or summary
 * @returns {{state:string, label:string, reason:string, play:boolean, tag:string|null}}
 */
export function accessFor(game) {
  const id = typeof game === 'string' ? game : (game && game.id) || '';
  const p = typeof game === 'string' ? get(id) : game;
  // Bound on purpose: settings.get() is a method that reads the store, and an
  // unbound copy throws the moment a card is painted.
  const account = accountFromSettings((k, d) => settings.get(k, d));
  return decide({ ...(p || { id }), access: (p && p.access) || null }, {
    ads: hasAds(id),
    signedIn: account.signedIn,
    plan: account.plan,
    // 'auto' means the page has not been read yet; treat it as unknown rather
    // than assuming the worst and hiding a game the account can play.
    planKnown: account.planSource === 'detected',
  });
}

// ---------- User collections (mirrored in settings) ----------
export const favorites = () => settings.get('favorites', []) || [];
export const hidden = () => settings.get('hiddenGames', []) || [];
export const recents = () => settings.get('recentPlayed', []) || [];

export const isFav = (id) => favorites().includes(id);
export const isHidden = (id) => hidden().includes(id);

export async function toggleFavorite(id) {
  const list = favorites();
  const next = list.includes(id) ? list.filter((x) => x !== id) : [id, ...list];
  await settings.set('favorites', next);
  const game = get(id);
  toastOk(list.includes(id) ? t('favorite_removed') : t('favorite_added'), game?.title || '');
  emit('favorites', next);
  notify();
  return next;
}

export async function toggleHidden(id) {
  const list = hidden();
  const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  await settings.set('hiddenGames', next);
  const game = get(id);
  toastInfo(list.includes(id) ? t('game_shown') : t('game_hidden'), game?.title || '');
  emit('hidden', next);
  notify();
  return next;
}

// ---------- Search ----------
/** Normalise for accent-insensitive matching (e.g. "fortnite" ≈ "Forza"). */
function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }

export function searchGames(query, limit = 60) {
  const q = norm(query).trim();
  if (!q) return [];
  const terms = q.split(/\s+/);
  const out = [];
  for (const id of state.order) {
    const p = state.details.get(id);
    if (!p) continue;
    const title = norm(p.title);
    const hay = `${title} ${norm(p.publisher)} ${norm(p.developer)} ${norm((p.genres || []).join(' '))}`;
    let score = 0;
    let ok = true;
    for (const term of terms) {
      if (!hay.includes(term)) { ok = false; break; }
      if (title.startsWith(term)) score += 6;
      else if (title.includes(term)) score += 3;
      else score += 1;
    }
    if (ok) out.push({ id, p, score });
  }
  out.sort((a, b) => b.score - a.score || a.p.title.localeCompare(b.p.title));
  return out.slice(0, limit);
}

// ---------- Sorting ----------
export const SORTS = {
  recent: { key: 'sort_recent', fn: (a, b) => recents().indexOf(a.id) - recents().indexOf(b.id) },
  name: { key: 'sort_name', fn: (a, b) => a.p.title.localeCompare(b.p.title) },
  popular: { key: 'sort_popular', fn: (a, b) => (idsPopular().indexOf(a.id) - idsPopular().indexOf(b.id)) || a.p.title.localeCompare(b.p.title) },
  added: { key: 'recently_added', fn: (a, b) => (idsRecentlyAdded().indexOf(a.id) - idsRecentlyAdded().indexOf(b.id)) || a.p.title.localeCompare(b.p.title) },
  title: { key: 'sort_by', fn: (a, b) => a.p.title.localeCompare(b.p.title) },
};

export function sortGames(items, sortKey) {
  const s = SORTS[sortKey] || SORTS.name;
  return items.slice().sort(s.fn);
}

// ---------- Card builders ----------
function badgesFor(id) {
  const out = [];
  const a = accessFor(id);
  if (a.tag) out.push({ label: a.tag, cls: a.state === 'ads' ? 'accent' : (a.state === 'requiresSubscription' ? 'locked' : 'plan') });
  if (isFav(id)) out.push({ label: '★', cls: '' });
  return out;
}

function artFor(p) {
  return p?.art?.portrait || p?.art?.tile || p?.art?.hero || null;
}

/**
 * The premium hover card used across the whole app.
 * @param {{id:string}} p product
 * @param {{onOpen?:Function, compact?:boolean, showBadges?:boolean}} [opts]
 */
export function gameCard(p, opts = {}) {
  if (!p) return h('div');
  const fav = isFav(p.id);
  const badges = badgesFor(p.id);

  const info = h('div.card-info', [
    h('div.g-title', p.title),
    badges.length ? h('div.g-tags', badges.map((b) => h(`span.tag${b.cls ? '.' + b.cls : ''}`, b.label))) : null,
    h('div.g-play', [icon('play', { size: 13 }), t('play_now')]),
  ]);

  const art = artFor(p);
  const img = lazyImg(art, p.title, 'art');
  if (!art) {
    clear(img);
    // A placeholder is still downloading: shimmer rather than fake initials,
    // so cards never flash "…" or a bogus two-letter title.
    img.className = p.pending ? 'art-pending' : 'art-fallback';
    if (!p.pending) img.textContent = (p.title || '?').slice(0, 2).toUpperCase();
  }

  const card = h('div.card', {
    role: 'button',
    tabindex: '0',
    dataset: { id: p.id },
    title: p.title,
    onclick: (e) => {
      if (e.target.closest('.fav')) return;
      if (opts.onOpen) opts.onOpen(p);
    },
    onkeydown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (opts.onOpen) opts.onOpen(p); }
    },
  }, [
    img,
    h('div.veil'),
    badges.length ? h('div.badges', badges.map((b) => h(`span.tag${b.cls ? '.' + b.cls : ''}`, b.label))) : null,
    info,
    h('button.fav', {
      class: fav ? 'is-fav' : '',
      title: fav ? t('remove_favorite') : t('add_favorite'),
      'aria-pressed': fav ? 'true' : 'false',
      'aria-label': fav ? t('remove_favorite') : t('add_favorite'),
      onclick: async (e) => { e.stopPropagation(); await toggleFavorite(p.id); opts.onChange?.(p); },
    }, icon('heart', { size: 16, fill: fav })),
  ]);
  return card;
}

/** Horizontal carousel. */
export function gameRail(items, opts = {}) {
  const rail = h('div.rail', { role: 'list' });
  for (const p of items) {
    if (!p) continue;
    const cell = h('div', { role: 'listitem', style: { minWidth: '0' } }, gameCard(p, opts));
    rail.appendChild(cell);
  }
  return rail;
}

/** Responsive grid. */
export function gameGrid(items, opts = {}) {
  const grid = h('div.grid-games');
  for (const p of items) {
    if (!p) continue;
    grid.appendChild(gameCard(p, opts));
  }
  return grid;
}

/** Skeleton placeholders keep the layout stable while data loads. */
export function skeletonRail(n = 8) {
  const rail = h('div.rail');
  for (let i = 0; i < n; i++) rail.appendChild(h('div.skel.card'));
  return rail;
}

export function skeletonGrid(n = 12) {
  const grid = h('div.grid-games');
  for (let i = 0; i < n; i++) grid.appendChild(h('div.skel.card'));
  return grid;
}

/** Resolve a list of ids to product objects, preserving order. */
export function products(ids) {
  return (ids || []).map((id) => get(id)).filter(Boolean);
}

/** Hero rotation picks a deterministic spread so it is not the same every boot. */
export function featuredGames(n = 5) {
  const pool = [...new Set([...idsPopular(), ...idsRecentlyAdded(), ...idsFreeWithAds()])];
  const shuffled = stableShuffle(pool, 20240115);
  // Recently played first — that is what the user actually wants to resume.
  const recentFirst = recents().map((id) => state.details.get(id)).filter(Boolean);
  const seen = new Set(recentFirst.map((p) => p.id));
  const out = [...recentFirst];
  const waiting = [];
  for (const id of shuffled) {
    if (out.length >= n) break;
    if (seen.has(id)) continue;
    seen.add(id);
    const p = state.details.get(id);
    // Details stream in after the lists; real games win, and anything still
    // downloading keeps its slot as a placeholder so the hero never jumps.
    if (p) out.push(p); else waiting.push(id);
  }
  for (const id of waiting) {
    if (out.length >= n) break;
    const p = get(id);
    if (p) out.push(p);
  }
  return out.slice(0, n);
}

// ---------- Art helpers for detail views ----------
export function heroArt(p) { return p?.art?.hero || p?.art?.portrait || p?.art?.tile || null; }
export function logoArt(p) { return p?.art?.logo || null; }
export function portraitArt(p) { return p?.art?.portrait || p?.art?.tile || null; }

/** Full-bleed background image element with a load fade. */
export function bgImage(src, cls = 'hero-bg', width = ART_WIDTH.hero) {
  const sized = src ? sizedArt(src, width) : null;
  const el = h(`div.${cls}`, { style: sized ? { backgroundImage: `url("${sized}")` } : {} });
  if (sized) {
    // Reveal only once the bytes are here: a half-loaded backdrop looks worse
    // than the gradient that is already behind it.
    const probe = new Image();
    probe.onload = () => el.classList.add('loaded');
    probe.src = sized;
  }
  return el;
}
