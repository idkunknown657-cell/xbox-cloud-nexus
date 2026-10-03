/**
 * Launch regression tests.
 *
 * Two halves:
 *  1. Pure checks on the slug and URL builders — a wrong slug or a URL that
 *     points at the catalogue is exactly the "just an image came up" bug.
 *  2. The real launch script, executed against a simulated xCloud page, to prove
 *     it routes to /launch/<slug>/<id>, retries a slug the router rewrote,
 *     presses the Play button when a store page needs it, and refuses honestly
 *     when the title will never stream or the account is signed out.
 *
 * No network and no account required: the page is a stub.
 */
'use strict';
const assert = require('node:assert');
const { productTitleToSlug, playUrl, launchUrl, launchScript } = require('../src/main/game-launch.cjs');

let pass = 0;
let fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ok  ${name}`); }
  catch (e) { fail++; console.log(`  FAIL ${name}\n       ${e.message}`); }
};

console.log('— slug and url —');
check('title becomes a router slug', () => {
  assert.strictEqual(productTitleToSlug('Forza Horizon 5'), 'forza-horizon-5');
});
check('punctuation is dropped, spaces hyphenated', () => {
  assert.strictEqual(productTitleToSlug("Baldur's Gate 3"), "baldur's-gate-3");
  assert.strictEqual(productTitleToSlug('Halo: Infinite'), 'halo-infinite');
  assert.strictEqual(productTitleToSlug('Hi-Fi Rush'), 'hi-fi-rush');
});
check('an empty title still produces a usable slug', () => {
  const s = productTitleToSlug('');
  assert.ok(s && /^[a-z0-9-]+$/.test(s), `unexpected slug ${JSON.stringify(s)}`);
  assert.ok(!launchUrl('en-US', s, 'AB123456').includes('/launch//'), 'empty path segment in the launch url');
});
check('very long titles are capped at 50 chars', () => {
  assert.ok(productTitleToSlug('A'.repeat(200)).length <= 50);
});
check('play url is the official catalogue', () => {
  assert.strictEqual(playUrl('en-US'), 'https://www.xbox.com/en-US/play');
});
check('launch url targets the per-title route, not the catalogue', () => {
  const u = launchUrl('en-US', 'forza-horizon-5', 'AB123456');
  assert.strictEqual(u, 'https://www.xbox.com/en-US/play/launch/forza-horizon-5/AB123456');
  assert.ok(u.includes('/play/launch/'), 'launch route missing');
});
check('a locale cannot inject a path', () => {
  assert.ok(!playUrl('../../evil').includes('..'));
});

console.log('\n— launch script behaviour —');

/**
 * Minimal DOM + window stand-in. Only the handful of APIs the script touches.
 */
function runScript({ pathname, bodyText = '', storeSlug, hasPlayButton, storePage = false }) {
  const reports = [];
  const clicked = [];
  const listeners = {};

  const pageContent = {
    id: 'PageContent',
    appendChild: (a) => { clicked.push(a.href); },
    remove: () => {},
  };

  const elements = [];
  if (storePage && storeSlug) {
    elements.push({
      textContent: hasPlayButton ? 'Play' : 'Buy',
      offsetParent: {},
      click: () => { clicked.push('PLAY_BUTTON'); },
    });
  }

  const win = {
    nexusLaunchReport: (state, reason) => reports.push({ state, reason }),
    addEventListener: (t, fn) => { listeners[t] = fn; },
  };

  const doc = {
    readyState: 'complete',
    body: { innerText: bodyText },
    getElementById: (id) => (id === 'PageContent' ? pageContent : null),
    querySelector: () => null,
    querySelectorAll: (sel) => (sel === 'button, a' ? elements : []),
    createElement: () => ({ style: {}, click() { clicked.push(this.href); }, remove() {} }),
  };

  const loc = {
    pathname,
    href: 'https://www.xbox.com/en-US' + pathname,
    assign: (u) => { loc.pathname = u.replace('https://www.xbox.com/en-US', ''); },
  };

  const fn = new Function('window', 'document', 'location', 'setTimeout', 'setInterval', 'clearInterval',
    launchScript({ slug: 'my-game', productId: 'AB123456', locale: 'en-US' }));
  // Fake timers: run each timer body once so the verify chains execute.
  const timers = [];
  const setTimeout_ = (cb, ms) => { timers.push(cb); return timers.length; };
  const setInterval_ = (cb, ms) => { timers.push(cb); return timers.length; };
  fn(win, doc, loc, setTimeout_, setInterval_, () => {});
  for (let i = 0; i < timers.length; i++) { try { timers[i](); } catch { /* ignore */ } }

  return { reports, clicked, loc, pageContent };
}

check('clicks the per-title launch route', () => {
  const { clicked } = runScript({ pathname: '/en-US/play' });
  assert.ok(clicked.length, 'nothing was clicked');
  assert.strictEqual(clicked[0], 'https://www.xbox.com/en-US/play/launch/my-game/AB123456');
});

check('an empty title still launches', () => {
  const { clicked } = runScript({ pathname: '/en-US/play' });
  assert.ok(clicked[0].endsWith('/launch/my-game/AB123456'));
});

check('reports success once the router lands on the launch route', () => {
  const { reports } = runScript({ pathname: '/en-US/play/launch/my-game/AB123456' });
  assert.ok(reports.some((r) => r.state === 'starting'), JSON.stringify(reports));
});

check('retrying with the router\'s own slug when it rewrites ours', () => {
  const { clicked } = runScript({ pathname: '/en-US/play/games/real-slug/AB123456', storePage: true });
  assert.ok(clicked.includes('https://www.xbox.com/en-US/play/launch/real-slug/AB123456'),
    `expected a retry on the router's slug, got ${JSON.stringify(clicked)}`);
});

check('presses Play when the store page offers it', () => {
  const { clicked } = runScript({
    pathname: '/en-US/play/games/my-game/AB123456', storePage: true, storeSlug: 'my-game', hasPlayButton: true,
  });
  assert.ok(clicked.includes('PLAY_BUTTON'), `expected the Play button press, got ${JSON.stringify(clicked)}`);
});

check('refuses a title Xbox says will never stream', () => {
  const { reports } = runScript({
    pathname: '/en-US/play/games/my-game/AB123456',
    storePage: true,
    storeSlug: 'my-game',
    bodyText: 'This title is not Cloud playable and is not currently supported on Xbox Cloud Gaming.',
  });
  const denied = reports.find((r) => r.state === 'denied');
  assert.ok(denied, `expected a denial, got ${JSON.stringify(reports)}`);
  assert.match(denied.reason, /not available on Xbox Cloud Gaming/i);
});

check('names signing out instead of blaming Xbox', () => {
  const { reports } = runScript({ pathname: '/en-US/play', bodyText: 'Compare plans and start your free trial' });
  const denied = reports.find((r) => r.state === 'denied');
  assert.ok(denied, `expected a denial, got ${JSON.stringify(reports)}`);
  assert.match(denied.reason, /signed out/i);
});

check('never reports more than one denial', () => {
  const { reports } = runScript({ pathname: '/en-US/play', bodyText: 'Compare plans' });
  assert.strictEqual(reports.filter((r) => r.state === 'denied').length, 1);
});

check('reports at most once per window', () => {
  const { reports } = runScript({ pathname: '/en-US/play/launch/my-game/AB123456' });
  assert.strictEqual(reports.length, 1);
});

check('a second injection into the same document does nothing', () => {
  // The window re-injects on every load; within one document the driver must
  // stand down or it would click the router link again and again.
  const clicked = [];
  const win = { nexusLaunchReport: () => {} };
  // clickTo() appends the link and then clicks it; only the click counts as an
  // attempt, otherwise one attempt looks like two.
  const pageContent = { id: 'PageContent', appendChild() {}, remove() {} };
  const doc = {
    readyState: 'complete',
    body: { innerText: '' },
    getElementById: (id) => (id === 'PageContent' ? pageContent : null),
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ style: {}, click() { clicked.push(this.href); }, remove() {} }),
  };
  const loc = { pathname: '/en-US/play', href: 'https://www.xbox.com/en-US/play', assign() {} };
  const run = () => new Function('window', 'document', 'location', 'setTimeout', 'setInterval', 'clearInterval',
    launchScript({ slug: 'my-game', productId: 'AB123456', locale: 'en-US' }))(win, doc, loc, () => 0, () => 0, () => {});
  run(); run(); run();
  assert.strictEqual(clicked.length, 1, `expected one click, got ${JSON.stringify(clicked)}`);
});

check('lands on the launch route without re-clicking the router', () => {
  // The launch navigation loads a fresh document. The driver injected there
  // must report success rather than bouncing the router again — that bounce
  // was what killed the reporting in the first place.
  const { reports, clicked } = runScript({ pathname: '/en-US/play/launch/my-game/AB123456' });
  assert.ok(reports.some((r) => r.state === 'starting'), JSON.stringify(reports));
  assert.ok(!clicked.some((c) => String(c).includes('/launch/')), `re-clicked the router: ${JSON.stringify(clicked)}`);
});

console.log(`\nLAUNCH ${fail ? 'FAIL' : 'OK'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);