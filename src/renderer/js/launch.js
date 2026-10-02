/**
 * Launch pipeline shared by every view.
 *
 * We never re-implement streaming: the game opens in the official Xbox Cloud
 * Gaming web app inside its own window, with the active control profile and
 * Better xCloud injected at document-start. This module only resolves the
 * per-game profile, drives the loading state and reports failures honestly.
 */
import { settings } from './store.js';
import { t } from './i18n.js';
import { toastInfo, toastErr, toastOk } from './toast.js';
import { sfx } from './sfx.js';
import { isHidden } from './catalog.js';

const inflight = new Map();

/** Profile that will be used for a given game (per-game override wins). */
export function profileFor(productId) {
  const profiles = settings.get('input.profiles', []) || [];
  const gameMap = settings.get('input.gameProfiles', {}) || {};
  const id = gameMap[productId] || settings.get('input.activeProfile');
  return profiles.find((p) => p.id === id) || profiles[0] || null;
}

/**
 * Launch (or focus) a game's stream window.
 * @param {{id:string,title?:string}} game
 * @returns {Promise<boolean>} true when a window opened or was focused
 */
export async function launchGame(game) {
  if (!game?.id) return false;
  if (inflight.has(game.id)) return inflight.get(game.id);

  const task = (async () => {
    try {
      toastInfo(t('launching'), game.title || '');
      sfx('launch');
      const res = await window.nexus.launch({ productId: game.id, title: game.title || '' });
      if (res?.reused) toastInfo(t('launched'), game.title || '');
      else toastOk(t('launched'), game.title || '');
      // Reflect the launch immediately in this window's recents.
      const list = settings.get('recentPlayed', []) || [];
      await settings.set('recentPlayed', [game.id, ...list.filter((x) => x !== game.id)].slice(0, 30));
      return true;
    } catch (err) {
      toastErr(err, t('error'));
      return false;
    } finally {
      inflight.delete(game.id);
    }
  })();

  inflight.set(game.id, task);
  return task;
}

/** True when a stream window for this game is already open. */
const openStreams = new Set();

export function markStreamOpen(productId) { openStreams.add(productId); }
export function markStreamClosed(productId) { openStreams.delete(productId); }
export function isStreamOpen(productId) { return openStreams.has(productId); }

/** Hidden games are never launched from rails — the guard is here, not in views. */
export function canLaunch(game) {
  return !!game?.id && !isHidden(game.id);
}