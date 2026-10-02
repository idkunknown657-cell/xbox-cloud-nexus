/**
 * Game details — a full overlay rather than a route, so it can be opened from
 * anywhere (rails, search, library) and dismissed with Escape.
 */
import { h, clear, fmtRelative } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import * as cat from '../catalog.js';
import { settings } from '../store.js';
import { launchGame, profileFor } from '../launch.js';
import { openLaunchPanel } from '../launch-panel.js';
import { configureControlsForGame } from './controls.js';
import { go } from '../nav.js';
import { openOverlay, confirmDialog } from '../modal.js';
import { toastOk } from '../toast.js';
import { promptDialog } from '../modal.js';

/** Small labelled fact list. Always renders, even for sparse metadata. */
function facts(p) {
  const rows = [];
  const push = (k, v) => { if (v) rows.push(h('dt', k), h('dd', v)); };
  push(t('developer'), p.developer);
  push(t('publisher'), p.publisher);
  push(t('genres'), (Array.isArray(p.genres) ? p.genres : []).join(', ') || null);
  if (p.rating?.value) push(t('rating'), `${p.rating.system || ''} ${p.rating.value}`.trim());
  if (p.lastModified) push('Updated', fmtRelative(Date.parse(p.lastModified)));
  push('Availability', [
    cat.isGamePass(p.id) ? t('game_pass') : null,
    cat.hasAds(p.id) ? t('play_with_ads_badge') : null,
    cat.hasKbm(p.id) ? t('kbm_supported') : null,
  ].filter(Boolean).join(' · ') || t('cloud_gaming'));
  push('Product ID', p.id);
  return h('div.panel', [
    h('h3', t('game_details')),
    h('dl.kv', rows),
  ]);
}

function screenshotStrip(p) {
  const shot = p.art?.screenshot;
  const extra = [p.art?.hero, p.art?.tile].filter(Boolean);
  const sources = [shot, ...extra].filter(Boolean);
  if (!sources.length) return null;
  return h('div.panel', [
    h('h3', 'Screenshots'),
    h('div.shot-grid', sources.map((src) => h('img.shot', { src, alt: '', loading: 'lazy', decoding: 'async' }))),
  ]);
}

function profileRow(ctx, overlay) {
  const profiles = settings.get('input.profiles', []) || [];
  const assigned = settings.get('input.gameProfiles', {}) || {};
  const currentId = ctx.game.id;
  const cur = assigned[currentId] || settings.get('input.activeProfile');
  const sel = h('select.select', {
    'aria-label': t('per_game'),
    onchange: async (e) => {
      const val = e.target.value || null;
      try {
        await window.nexus.profiles.assignGame(currentId, val);
        const map = { ...(settings.get('input.gameProfiles', {}) || {}) };
        if (val) map[currentId] = val; else delete map[currentId];
        await settings.set('input.gameProfiles', map);
        toastOk(t('profile_saved'), val ? (profiles.find((p) => p.id === val)?.name || '') : t('no_profile'));
      } catch { e.target.value = cur || ''; }
    },
  }, [
    h('option', { value: '', selected: !assigned[currentId] }, `${t('no_profile')} (${(profiles.find((p) => p.id === settings.get('input.activeProfile')) || {}).name || '—'})`),
    ...profiles.map((p) => h('option', { value: p.id, selected: assigned[currentId] === p.id }, p.name)),
  ]);
  const profile = profileFor(currentId);
  return h('div.panel', [
    h('h3', t('per_game')),
    h('p.p-desc', t('per_game_desc')),
    h('div.row', [
      h('div.r-main', [
        h('div.r-title', t('controls_title')),
        h('div.r-desc', profile ? `${profile.name} · ${Object.keys(profile.mapping || {}).length} bindings` : t('no_profile')),
      ]),
      sel,
    ]),
    h('button.btn.sm.mt-8', {
      onclick: () => {
        overlay?.close?.();
        configureControlsForGame(currentId, { navigate: go });
      },
    }, [icon('controller', { size: 14 }), 'Configure controls for this game']),
  ]);
}

/**
 * Open the details overlay for a product.
 * @param {{id:string}} game
 */
export function openDetails(game) {
  if (!game?.id) return;
  let product = cat.get(game.id);

  let overlayApi = null;   // assigned after openOverlay() returns, but needed inside paint()
  overlayApi = openOverlay({
    dismissable: true,
    onMount: (content) => {
      // A placeholder (id known, details not fetched yet) is not good enough
      // for this screen, so load the real product before painting.
      if (!product || product.pending) {
        cat.loadProduct(game.id).then((full) => {
          if (full) { product = full; }
          if (overlayApi?.root?.isConnected) paint(content, product);
        });
      }
      paint(content, product);
    },
    onClose: () => { window.dispatchEvent(new CustomEvent('nexus:details-closed')); },
  });

  async function paint(content, p) {
    clear(content);
    content.appendChild(h('div.details-loading', cat.skeletonGrid(6)));

    if (!p) {
      p = await cat.loadProduct(game.id);
      if (!overlayApi?.root?.isConnected) return;
    }
    if (!p) {
      clear(overlayApi?.root);
      overlayApi?.root?.appendChild(h('div.empty', [
        icon('alert', { size: 44 }),
        h('div.e-title', t('no_results')),
        h('div', 'Game details are unavailable for this title.'),
      ]));
      return;
    }

    clear(content);
    const fav = cat.isFav(p.id);
    const ads = cat.hasAds(p.id);

    const poster = cat.portraitArt(p);
    const logo = cat.logoArt(p);

    content.appendChild(h('div.details-hero', [
      cat.bgImage(cat.heroArt(p), 'dh-bg'),
      h('div.dh-content', [
        poster ? h('img.dh-poster', { src: poster, alt: p.title, loading: 'lazy' }) : h('div.dh-poster.dh-poster-fallback', (p.title || '?').slice(0, 2).toUpperCase()),
        h('div.grow', [
          logo ? h('img.dh-logo', { src: logo, alt: '', loading: 'lazy' }) : null,
          h('h1.dh-title', p.title),
          h('div.dh-meta', [
            p.publisher ? h('span', p.publisher) : null,
            cat.isGamePass(p.id) ? h('span.tag.accent', t('game_pass')) : null,
            ads ? h('span.tag', t('play_with_ads_badge')) : null,
            cat.hasKbm(p.id) ? h('span.tag', t('kbm_supported')) : null,
          ].filter(Boolean)),
          h('div.hero-actions', [
            h('button.btn.primary.lg', {
              onclick: async () => {
                overlayApi?.close();
                await openLaunchPanel(p, { navigate: go });
              },
            }, icon('play', { size: 15 }), t('play_now')),
            h('button.btn.lg', {
              onclick: () => { overlayApi?.close(); launchGame(p); },
            }, [icon('play', { size: 15 }), t('quick_play')]),
            h(`button.btn.lg${fav ? '.is-fav' : ''}`, { onclick: async () => { await cat.toggleFavorite(p.id); paint(content, p); } },
              icon('heart', { size: 15, fill: fav }), fav ? t('remove_favorite') : t('add_favorite')),
            h('button.btn.lg.ghost', {
              title: cat.isHidden(p.id) ? t('show_game') : t('hide_game'),
              onclick: async () => { await cat.toggleHidden(p.id); paint(content, p); },
            }, icon(cat.isHidden(p.id) ? 'eyeOff' : 'eye', { size: 15 })),
            h('button.iconbtn', { title: t('cancel'), onclick: () => overlayApi?.close() }, icon('x', { size: 18 })),
          ]),
        ]),
      ]),
    ]));

    const main = h('div.details-cols', [
      h('div', [
        p.long ? h('div.panel', [h('h3', p.title), h('p.desc', p.long)]) : null,
        p.short ? h('div.panel', [h('h3', 'About'), h('p.desc', p.short)]) : null,
        screenshotStrip(p),
      ].filter(Boolean)),
      h('div', [facts(p), profileRow({ game: p }, overlayApi), launchNote()].filter(Boolean)),
    ]);
    content.appendChild(main);
  }
}

function launchNote() {
  return h('div.panel', [
    h('h3', t('cloud_gaming')),
    h('p.p-desc', [
      t('available_cloud'), '. ',
      h('span', { style: { display: 'block', marginTop: '8px' } }, t('signout_note')),
    ]),
  ]);
}

export const detailsView = { openDetails };