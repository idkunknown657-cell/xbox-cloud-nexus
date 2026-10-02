/**
 * Home view — hero carousel plus the discovery rails.
 * The Play with Ads rail sits high on purpose: it is a major entry point.
 */
import { h, clear, debounce } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import * as cat from '../catalog.js';
import { settings } from '../store.js';
import { launchGame } from '../launch.js';
import { toastErr } from '../toast.js';

let heroTimer = null;

function stopHero() {
  if (heroTimer) { clearInterval(heroTimer); heroTimer = null; }
}

/** Big rotating hero. Auto-advance pauses on hover and when animations are off. */
function heroView(games, openDetails) {
  const wrap = h('section.hero', { 'aria-label': t('featured') });
  if (!games.length) {
    wrap.appendChild(h('div.hero-content', h('div.hero-desc', t('no_results'))));
    return wrap;
  }
  let index = 0;
  const bgHost = h('div.hero-bg');
  const dots = h('div.hero-dots', { role: 'tablist' });
  const content = h('div.hero-content');

  const paint = (i) => {
    index = (i + games.length) % games.length;
    const g = games[index];
    clear(bgHost);
    bgHost.className = 'hero-bg';
    bgHost.appendChild(cat.bgImage(cat.heroArt(g), 'hero-bg'));
    clear(content);
    content.append(
      h('div.hero-kicker', [
        icon(cat.hasAds(g.id) ? 'ads' : 'cloudPlay', { size: 13 }),
        cat.hasAds(g.id) ? t('play_with_ads_badge') : t('featured'),
        cat.isGamePass(g.id) ? h('span.chip', t('game_pass')) : null,
      ]),
      h('h1.hero-title', g.title),
      h('p.hero-desc', g.short || g.long || ''),
      h('div.hero-actions', [
        h('button.btn.primary.lg', { onclick: () => launchGame(g) }, icon('play', { size: 15 }), t('play_now')),
        h('button.btn.lg', { onclick: () => openDetails(g) }, t('game_details')),
      ]),
      h('div.hero-meta', [
        h('span', [icon('controller', { size: 13 }), t('controller')]),
        cat.hasKbm(g.id) ? h('span', [icon('keyboard', { size: 13 }), t('kbm_supported')]) : null,
        cat.isFav(g.id) ? h('span', [icon('heart', { size: 13, fill: true }), t('filter_favorites')]) : null,
      ].filter(Boolean)),
    );
    Array.from(dots.children).forEach((d, di) => d.classList.toggle('on', di === index));
  };

  games.forEach((_, i) => {
    dots.appendChild(h('button', { 'aria-label': `Slide ${i + 1}`, onclick: () => { paint(i); restart(); } }));
  });

  wrap.append(bgHost, content, dots);
  wrap.addEventListener('mouseenter', stopHero);
  wrap.addEventListener('mouseleave', restart);
  wrap.addEventListener('focusin', stopHero);

  const interval = 7000;
  function restart() {
    stopHero();
    if (settings.get('appearance.animations') === 'off') return;
    heroTimer = setInterval(() => paint(index + 1), interval);
  }
  paint(0);
  restart();
  return wrap;
}

function railSection(title, ids, opts = {}) {
  const items = cat.products(ids).slice(0, opts.limit || 20);
  const sec = h('section.section', [
    h('div.section-head', [
      h('h2.section-title', [
        title,
        opts.chip ? h('span.chip', opts.chip) : null,
      ].filter(Boolean)),
      opts.sub ? h('span.section-sub', opts.sub) : null,
      opts.viewAll ? h('button.see-all', { onclick: opts.viewAll }, t('view_all'), icon('chevronRight', { size: 14 })) : null,
    ].filter(Boolean)),
  ]);
  sec.appendChild(items.length ? cat.gameRail(items, opts) : h('div.empty', h('div.e-title', t('no_results'))));
  return sec;
}

function errorPanel(msg, retry) {
  return h('div.error-panel', [
    icon('alert', { size: 20 }),
    h('div.grow', [h('div.e-t', t('network_err')), h('div.e-d', msg || t('network_err_msg'))]),
    h('button.btn.sm', { onclick: retry }, icon('refresh', { size: 14 }), t('retry')),
  ]);
}

export function render(root, ctx) {
  stopHero();
  const page = h('div.page');
  root.appendChild(page);

  const paint = () => {
    clear(page);
    if (cat.state.error && !cat.state.loaded) {
      page.appendChild(errorPanel(cat.state.error, () => ctx.refresh()));
      return;
    }
    if (!cat.state.loaded) {
      page.appendChild(h('div.skel', { style: { height: '380px', borderRadius: 'var(--radius-lg)' } }));
      page.appendChild(cat.skeletonRail(8));
      page.appendChild(cat.skeletonRail(8));
      return;
    }

    page.appendChild(heroView(cat.featuredGames(5), ctx.openDetails));

    const recent = cat.recents().filter((id) => cat.get(id));
    if (recent.length) {
      page.appendChild(railSection(t('recently_played'), recent, { onOpen: ctx.openDetails, viewAll: () => ctx.navigate('recent') }));
    }

    const ads = cat.idsFreeWithAds();
    if (ads.length) {
      page.appendChild(railSection(t('free_with_ads'), ads, {
        chip: 'ADS',
        sub: t('freeWithAds_sub'),
        limit: 24,
        onOpen: ctx.openDetails,
        viewAll: () => ctx.navigate('playads'),
      }));
    }

    const popular = cat.idsPopular().filter((id) => !cat.hasAds(id));
    if (popular.length) {
      page.appendChild(railSection(t('popular_on_cloud'), popular, { limit: 16, onOpen: ctx.openDetails, viewAll: () => ctx.navigate('cloud') }));
    }

    const added = cat.idsRecentlyAdded().filter((id) => !cat.hasAds(id) && !cat.isGamePass(id));
    if (added.length) {
      page.appendChild(railSection(t('recently_added'), added, { limit: 16, onOpen: ctx.openDetails }));
    }

    const favs = cat.favorites().filter((id) => cat.get(id));
    if (favs.length) {
      page.appendChild(railSection(t('filter_favorites'), favs, { limit: 16, onOpen: ctx.openDetails, viewAll: () => ctx.navigate('favorites') }));
    }

    const leaving = cat.idsLeavingSoon();
    if (leaving.length) {
      page.appendChild(railSection('Leaving soon', leaving, { limit: 16, onOpen: ctx.openDetails }));
    }

    page.appendChild(footerNote());
  };

  const unsub = cat.onCatalogChange(() => paint());
  const offCtx = ctx.onLeave(() => { unsub(); stopHero(); });
  paint();
  return () => { unsub(); offCtx(); stopHero(); };
}

function footerNote() {
  return h('div.section', { style: { marginTop: '10px' } },
    h('div.attrib', [t('disclaimer')]));
}

export const homeView = { id: 'home', render };