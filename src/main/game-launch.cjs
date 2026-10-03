/**
 * Starting a specific game in the official Xbox Cloud Gaming web app.
 *
 * Loading https://www.xbox.com/<locale>/play only ever opens the *catalogue*.
 * The official router starts a title from a deeper route:
 *
 *     https://www.xbox.com/<locale>/play/launch/<slug>/<productId>
 *
 * That route — plus the fallbacks around it — is how XFly launches games, and
 * it is reimplemented here (MIT, credited in README) rather than reinvented.
 *
 * The navigation itself is done in the page, not with loadURL: the click goes
 * through Xbox's own client-side router, which is what resolves a bad slug onto
 * the correct one. Navigating straight to the URL in the main process worked
 * less often, and a launch that silently lands on the catalogue looks exactly
 * like a successful launch that never starts a game.
 */
'use strict';

/** Product title -> the slug the xCloud router expects. */
function productTitleToSlug(title) {
  const slug = String(title || '')
    .replace(/[;,/?:@&=+_`~$%#^*()!^™\xae\xa9]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim()
    .substring(0, 50)
    .replace(/ /g, '-')
    .toLowerCase();
  // A title made entirely of punctuation would otherwise produce an empty path
  // segment, and the router would silently send the player back to the
  // catalogue — the exact failure this whole module exists to prevent.
  return slug || 'game';
}

/** The official catalogue page — also where the launch is driven from. */
function playUrl(locale = 'en-US') {
  const loc = String(locale || 'en-US').replace(/[^a-zA-Z-]/g, '') || 'en-US';
  return `https://www.xbox.com/${loc}/play`;
}

/**
 * The direct launch URL for a title. Kept for logging, for the "open in browser"
 * fallback and for the launch regression test; the window itself navigates via
 * the in-page router so a wrong slug can be corrected.
 */
function launchUrl(locale, slug, productId) {
  return `${playUrl(locale)}/launch/${slug}/${productId}`;
}

/**
 * Script injected into the stream window once the play page has loaded.
 *
 * It clicks the router link and then *verifies* that a stream actually started.
 * Without that check a router that rewrote the slug, or a store page for a title
 * that will never stream, both look like a working launch. Every give-up path
 * reports back through `window.nexusLaunchReport` so the player is told what
 * happened instead of staring at a page that is never a game.
 */
function launchScript({ slug, productId, locale }) {
  return `(() => {
  // One launch driver per document. The window re-injects on every load (the
  // launch navigation needs a fresh driver in the new document), so the flag
  // has to be per-document, not per-window.
  if (window.__nexusLaunchDriver) return;
  window.__nexusLaunchDriver = true;

  const PRODUCT = ${JSON.stringify(String(productId))};
  const SLUG = ${JSON.stringify(String(slug))};
  const BASE = ${JSON.stringify(playUrl(locale))};
  let reported = false;
  let corrected = false;
  let tries = 0;

  const report = (state, reason) => {
    if (reported) return;
    reported = true;
    try { window.nexusLaunchReport && window.nexusLaunchReport(state, reason || ''); } catch (e) { /* ignore */ }
  };

  // Announce success as soon as the router lands on the launch route, so the
  // player sees "connecting" rather than a spinner that could mean anything.
  const announceStarted = () => {
    const here = decodeURIComponent(location.pathname);
    if (here.includes('/launch/') && here.includes(PRODUCT)) report('starting', '');
  };

  const giveUp = (why) => {
    report('denied', why);
    // Leave the dead page so the next pick starts clean.
    setTimeout(() => { try { location.assign(BASE); } catch (e) { /* ignore */ } }, 200);
  };

  // A signed-out xCloud shows a marketing/"compare plans" page that looks like
  // a page you can play from. Naming the real reason beats "Xbox did not start
  // the game" while the player stares at a subscribe button.
  const signedOutReason = () => {
    const text = (document.body && document.body.innerText) || '';
    if (/compare plans|get it now|start your free trial|sign in to play|join xbox cloud/i.test(text)
        && !document.querySelector('a[href*="/launch/"], [class*="GameCard"], [data-testid*="gamecard" i]')) {
      return 'You are signed out of Xbox. Sign in again, then press Play.';
    }
    return '';
  };

  const clickTo = (target) => {
    const page = document.getElementById('PageContent') || document.body;
    if (!page) return false;
    const m = location.href.match(/^(https:\\/\\/[^/]+\\/[a-zA-Z]{2}-[a-zA-Z]{2}\\/play)/);
    const base = m ? m[1] : BASE;
    const a = document.createElement('a');
    a.href = base + '/launch/' + target + '/' + PRODUCT;
    a.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;opacity:0';
    page.appendChild(a);
    a.click();
    setTimeout(() => { try { a.remove(); } catch (e) { /* ignore */ } }, 1000);
    setTimeout(verify, 4000);
    return true;
  };

  // Some titles only start from their store page's own Play button.
  const clickPlay = () => {
    const play = Array.from(document.querySelectorAll('button, a')).find(
      (b) => (b.textContent || '').trim() === 'Play' && b.offsetParent !== null);
    if (!play) return false;
    play.click();
    return true;
  };

  const verify = () => {
    const here = decodeURIComponent(location.pathname);
    if (here.includes('/launch/') && here.includes(PRODUCT)) {
      announceStarted();
      return true;
    }

    // Routed to the game's store page instead of streaming. Either the router
    // rewrote the slug (retry with its own), or the title needs its Play button
    // pressed. A store page that says outright the game will never stream gets
    // told so instead of being clicked forever.
    const m = here.match(/\\/play\\/games\\/([^/]+)\\/([^/]+)/);
    if (m && m[2] === PRODUCT) {
      if (/not\\s+cloud\\s+playable|not\\s+currently\\s+supported\\s+on\\s+xbox\\s+cloud/i.test(document.body.innerText || '')) {
        giveUp('This title is not available on Xbox Cloud Gaming in your region.');
        return;
      }
      if (!corrected) {
        corrected = true;
        if (m[1] !== SLUG) { clickTo(m[1]); }
        else if (!clickPlay()) { giveUp(signedOutReason() || 'Xbox did not offer a Play button for this title.'); return false; }
        setTimeout(verify, 5000);
        return false;
      }
      if (!clickPlay()) giveUp(signedOutReason() || 'The game page did not start a stream.');
      return false;
    }
    giveUp(signedOutReason() || 'Xbox did not start the game.');
    return false;
  };

  const start = () => {
    // Already where we were asked to go (the launch navigation reloaded this
    // document): report success and stop touching the router.
    if (verify() === true) return;
    if (clickTo(SLUG)) return;
    const iv = setInterval(() => {
      if (clickTo(SLUG) || ++tries > 40) { clearInterval(iv); if (tries > 40) giveUp(signedOutReason() || 'Xbox did not load the play page.'); }
    }, 250);
  };

  // The router link only works once the page itself is up: retry across the
  // initial renders instead of betting on a single did-finish-load.
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
  setTimeout(verify, 6000);
})();`;
}

module.exports = { productTitleToSlug, playUrl, launchUrl, launchScript };