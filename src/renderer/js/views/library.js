/**
 * Library view — the browsable game list with instant search, filters and sort.
 * Cloud Gaming, Favorites, Play with Ads, Recently Played and the genre pages
 * all reuse this component with a different id source, which keeps behaviour
 * identical everywhere and the code small enough to stay fast.
 */
import { h, clear, debounce } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import * as cat from '../catalog.js';

/** Per-view UI state, kept outside the DOM so re-renders stay cheap. */
const ui = {
  query: '',
  sort: 'name',
  genre: null,
  view: 'grid',
  filter: 'all',
};

const SOURCES = {
  all: { title: () => t('all_games'), ids: () => cat.idsAll().filter((id) => !cat.isHidden(id)) },
  cloud: { title: () => t('cloud_gaming'), ids: () => cat.idsGamePass().filter((id) => !cat.isHidden(id)) },
  playads: { title: () => t('free_with_ads'), sub: () => t('freeWithAds_sub'), ids: () => cat.idsFreeWithAds().filter((id) => !cat.isHidden(id)) },
  recent: { title: () => t('recently_played'), ids: () => cat.recents().filter((id) => cat.get(id)) },
  favorites: { title: () => t('filter_favorites'), ids: () => cat.favorites().filter((id) => cat.get(id) && !cat.isHidden(id)) },
  genre: {
    title: () => (cat.GENRES.find((g) => g.key === ui.genre)?.label || t('genre')),
    ids: () => cat.idsGenre(ui.genre).filter((id) => !cat.isHidden(id)),
  },
};

const FILTERS = [
  { id: 'all', label: () => t('filter_all'), keep: () => true },
  { id: 'fav', label: () => t('filter_favorites'), keep: (id) => cat.isFav(id) },
  { id: 'cloud', label: () => t('cloud_gaming'), keep: (id) => cat.isGamePass(id) },
  { id: 'ads', label: () => t('free_with_ads'), keep: (id) => cat.hasAds(id) },
  { id: 'kbm', label: () => t('kbm_supported'), keep: (id) => cat.hasKbm(id) },
  { id: 'recent', label: () => t('sort_recent'), keep: (id) => cat.recents().includes(id) },
];

function applyFilters(ids) {
  const active = FILTERS.find((f) => f.id === ui.filter) || FILTERS[0];
  return ids.filter(active.keep);
}

/** Visible items after query + filter + genre + sort. */
function visibleItems(viewKey) {
  const src = SOURCES[viewKey] || SOURCES.all;
  const base = applyFilters(src.ids());
  if (ui.query.trim()) {
    const allowed = new Set(base);
    return cat.searchGames(ui.query, 400).filter((x) => allowed.has(x.id)).map((x) => ({ id: x.id, p: x.p }));
  }
  return cat.sortGames(base.map((id) => ({ id, p: cat.get(id) })).filter((x) => x.p), ui.sort);
}

// ---------- Sub-views ----------
function toolbar(onChange) {
  // Handlers read the control from the closure, not from the event, so a late
  // debounced callback can never dereference a detached target.
  const input = h('input', {
    type: 'search',
    placeholder: t('search_games'),
    value: ui.query,
    spellcheck: false,
    'aria-label': t('search_games'),
  });
  const onQuery = debounce(() => { ui.query = input.value; onChange(); }, 140);
  input.addEventListener('input', onQuery);

  const sortSel = h('select.select', {
    'aria-label': t('sort_by'),
    onchange: () => { ui.sort = sortSel.value; onChange(); },
  }, [
    h('option', { value: 'name', selected: ui.sort === 'name' }, t('sort_name')),
    h('option', { value: 'popular', selected: ui.sort === 'popular' }, t('sort_popular')),
    h('option', { value: 'recent', selected: ui.sort === 'recent' }, t('sort_recent')),
    h('option', { value: 'added', selected: ui.sort === 'added' }, t('recently_added')),
  ]);

  const viewBtn = h(`button.iconbtn${ui.view === 'grid' ? '.active' : ''}`, {
    title: ui.view === 'grid' ? t('grid') : t('rows'),
    'aria-label': t('sort_by'),
    onclick: () => { ui.view = ui.view === 'grid' ? 'rail' : 'grid'; onChange(); },
  }, icon(ui.view === 'grid' ? 'rows' : 'grid', { size: 18 }));

  return h('div.toolbar', [
    h('div.searchbox.tb-search', [icon('search', { size: 16 }), input]),
    h('span.muted', { style: { fontSize: '13px' } }, t('sort_by')),
    sortSel,
    viewBtn,
  ]);
}

function chipBar(onChange) {
  const bar = h('div.chipbar');
  for (const f of FILTERS) {
    bar.appendChild(h(`button.fchip${ui.filter === f.id ? '.on' : ''}`, { onclick: () => { ui.filter = f.id; onChange(); } }, f.label()));
  }
  return bar;
}

function genreBar(onChange) {
  const bar = h('div.chipbar');
  for (const g of cat.GENRES) {
    bar.appendChild(h(`button.fchip${ui.genre === g.key ? '.on' : ''}`, {
      onclick: () => { ui.genre = ui.genre === g.key ? null : g.key; onChange(); },
    }, g.label));
  }
  return bar;
}

/** Render the item list, paging in batches so scrolling never blocks paint. */
function results(viewKey, ctx) {
  const src = SOURCES[viewKey] || SOURCES.all;
  const items = visibleItems(viewKey);
  const sec = h('div.section');

  sec.appendChild(h('div.section-head', [
    h('h2.section-title', [src.title(), h('span.chip', String(items.length))]),
    src.sub ? h('span.section-sub', src.sub()) : null,
  ].filter(Boolean)));

  if (!items.length) {
    sec.appendChild(h('div.empty', [
      icon('search', { size: 44 }),
      h('div.e-title', t('no_results')),
      h('div', t('no_results_sub')),
    ]));
    return sec;
  }

  const gridMode = ui.view === 'grid';
  const holder = gridMode
    ? h('div.grid-games')
    : h('div.rail', { style: { flexWrap: 'wrap', height: 'auto', overflow: 'visible' } });
  const more = h('div.mt-16');
  const batchSize = gridMode ? 48 : 24;
  let shown = 0;

  const appendBatch = () => {
    const slice = items.slice(shown, shown + batchSize);
    if (!slice.length) { more.remove(); return; }
    shown += slice.length;
    for (const { p } of slice) holder.appendChild(cat.gameCard(p, { onOpen: ctx.openDetails }));
    if (shown < items.length) {
      more.appendChild(h('button.btn', { onclick: appendBatch }, `${t('view_all')} · ${items.length - shown}`));
    } else {
      more.remove();
    }
  };

  appendBatch();
  sec.append(holder, more);
  return sec;
}

/**
 * Build the whole page for a source key.
 * @param {string} viewKey
 * @param {{openDetails:Function}} ctx
 */
export function buildPage(viewKey, ctx) {
  const page = h('div.page');
  const refresh = () => {
    clear(page);
    page.append(toolbar(refresh), chipBar(refresh), genreBar(refresh), results(viewKey, ctx));
  };
  refresh();
  return page;
}

/** View factory used by the router. */
export function createView(viewKey, ctx) {
  return {
    id: viewKey,
    setGenre(key) { ui.genre = key; },
    render(root) {
      const page = buildPage(viewKey, ctx);
      root.appendChild(page);
      const rebuild = () => { clear(page); page.append(toolbar(rebuild), chipBar(rebuild), genreBar(rebuild), results(viewKey, ctx)); };
      const unsub = cat.onCatalogChange(rebuild);
      return () => unsub();
    },
  };
}