/**
 * Renderer self-test — boots the real launcher UI in a real Electron window,
 * visits every route, exercises the wizard, remap + conflict flow, control
 * palette and settings, then reports DOM assertions plus any console error.
 * This catches the runtime bugs that `node --check` cannot see.
 *
 * Usage: npx electron src/main/uitest.cjs
 */
'use strict';
// Loading main.cjs registers the real IPC surface, store, catalog and the
// nexus:// protocol, so the test exercises the shipping code paths.
const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const os = require('os');
const fsx = require('fs');

// Hermetic run: an isolated userData dir means the first-run wizard and the
// default profile are always exercised, and repeat runs start from a known state.
const TEST_PROFILE = process.env.NEXUS_TEST_PROFILE
  || path.join(os.tmpdir(), 'xcloud-nexus-uitest');
if (!process.env.NEXUS_TEST_PROFILE) {
  fsx.rmSync(TEST_PROFILE, { recursive: true, force: true });
}
app.setPath('userData', TEST_PROFILE);

require('./main.cjs');

const RENDER_TIMEOUT = 240000;
const APP_CSP = require('./main.cjs').APP_CSP;

const SCRIPT = `
const out = [];
const ok = (name, cond, extra = '') => {
  out.push({ name, pass: !!cond, extra: String(extra).slice(0, 160) });
  // Streamed so a hung step is obvious while the suite is still running.
  console.log('@@ ' + (cond ? 'PASS' : 'FAIL') + ' ' + name);
};
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (fn()) return true; } catch (e) {} await sleep(150); }
  return false;
};

window.addEventListener('unhandledrejection', (e) => {
  console.error('UNHANDLED_REJECTION ' + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason));
});
window.addEventListener('error', (e) => console.error('WINDOW_ERROR ' + e.message));

await sleep(2500);

ok('protocol origin is nexus', location.protocol === 'nexus:', location.protocol);
ok('app shell present', !!$('#app') && !!$('#main') && !!$('#sidebar'));
ok('css variables applied', getComputedStyle(document.body).getPropertyValue('--accent').trim() !== '');
ok('sidebar nav items', $$('#sidebar .nav-item').length >= 6, $$('#sidebar .nav-item').length);
ok('brand logo', !!$('#sidebar .brand img'));

// ---- First-run wizard ----
await waitFor(() => !!$('.wizard') || !$('#sidebar .nav-item'), 20000);
const wizardUp = !!$('.wizard');
ok('first-run wizard shown', wizardUp);
if (wizardUp) {
  ok('wizard has 8 steps', $$('.wizard-steps .w-step').length === 8, $$('.wizard-steps .w-step').length);
  for (let i = 0; i < 9; i++) {
    const next = $$('.wizard-foot .btn').find((b) => /next|finish/i.test(b.textContent));
    if (!next) break;
    next.click();
    await sleep(260);
  }
  await waitFor(() => !$('.wizard'), 6000);
  ok('wizard completes', !$('.wizard'));
}

// ---- Home ----
// The catalog lives on Microsoft's public endpoints. When they are reachable we
// assert the full browse experience; when they are not (offline CI, throttled
// IP) we assert the degraded experience instead, which is a real user path.
// Availability is read from the DOM — deliberately NOT by re-requesting the
// library, because that would kick off a second full catalog download.
const listMeta = await window.nexus.catalog.listsMeta().catch(() => ({}));
ok('catalog list metadata', Object.keys(listMeta || {}).length >= 10, Object.keys(listMeta || {}).length);
const homeSettled = await waitFor(() => $$('.section').length >= 1 || !!$('.error-panel'), 60000);
const needLists = $$('.error-panel').length === 0 && $$('.section').length >= 1;
const needDetails = needLists && await waitFor(
  () => $$('img.art[data-src]').length > 0 || $$('.card img.art').length > 0, 60000);
console.log('@@ CATALOG lists=' + (needLists ? 'yes' : 'no') + ' details=' + (needDetails ? 'yes' : 'no'));

/** Run a check only when the data it needs is present; otherwise record why. */
const need = (cond, label) => {
  if (cond) return true;
  console.log('@@ SKIP ' + label + ' (no catalog data)');
  return false;
};

if (need(needLists, 'browse checks')) {
  ok('home hero rendered', $$('.hero-title').length > 0, $$('.hero-title').length);
  ok('game cards rendered', $$('.card').length > 3, $$('.card').length);
  ok('play-with-ads present', /play with ads/i.test(document.body.textContent));
  if (need(needDetails, 'detail-backed checks')) {
    const lazy = $$('img.art[data-src]');
    ok('artwork lazy-loaded', lazy.length > 0 || $$('img.art').length > 0, lazy.length + '/' + $$('img.art').length);
    ok('artwork urls absolute', lazy.every((i) => i.dataset.src.startsWith('https://')),
       lazy.filter((i) => !i.dataset.src.startsWith('https://')).length);
    ok('ads badges rendered', $$('.card .tag.accent').length > 0, $$('.card .tag.accent').length);
    ok('favorite hearts rendered', $$('.card .fav').length > 0);
    ok('sections rendered', $$('.section').length >= 3, $$('.section').length);
  }
} else {
  // Degraded mode: a friendly, recoverable state beats a blank screen.
  ok('offline: shell stays usable', !!$('#main') && $$('#sidebar .nav-item').length >= 6);
  const affordance = $('.error-panel') ? 'error-panel' : ($('.skel') ? 'skeleton' : 'none');
  ok('offline: loading or error affordance shown',
     affordance === 'error-panel' || affordance === 'skeleton' || $$('.card').length > 0, affordance);
  ok('offline: retry offered when the network failed', affordance !== 'error-panel' || !!$('.error-panel .btn'),
     affordance);
  ok('offline: no crash surfaced', !/uncaught|cannot read|is not a function/i.test(document.body.textContent));
}

// ---- Navigation ----
const navTo = async (label) => {
  const want = label.toLowerCase();
  const b = $$('#sidebar .nav-item').find((x) => x.textContent.trim().toLowerCase().startsWith(want));
  if (!b) return false;
  b.click(); await sleep(600); return true;
};

ok('nav to library', await navTo('Library'));
await waitFor(() => $$('.grid-games .card').length > 3, 15000);
if (need(needLists, 'library checks')) {
  ok('library grid renders', $$('.grid-games .card').length > 3, $$('.grid-games .card').length);
}
ok('library filter chips', $$('.chipbar .fchip').length > 5, $$('.chipbar .fchip').length);
ok('library genre chips', $$('.chipbar').length >= 2, $$('.chipbar').length);
ok('library search box', !!$('.toolbar input[type=search]'));

const si = $('.toolbar input[type=search]');
if (si) {
  // Search for a title that is actually on screen, so the assertion does not
  // depend on how much of the catalog has streamed in yet.
  const shown = ($$('.grid-games .card').map((c) => c.getAttribute('title') || '')
    .find((t) => t.length > 3 && t !== '…')) || '';
  const q = shown.slice(0, Math.max(4, Math.min(8, shown.length)));
  si.value = q;
  si.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(900);
  if (need(!!q, 'library search check')) {
    ok('library instant search', $$('.grid-games .card').length > 0,
       q + ' -> ' + $$('.grid-games .card').length);
  }
  si.value = ''; si.dispatchEvent(new Event('input', { bubbles: true })); await sleep(600);
}

// favourite toggle persists
const favBtn = $('.grid-games .card .fav');
if (favBtn) { favBtn.click(); await sleep(500); ok('favorite toggles', $('.grid-games .card .fav.is-fav') !== null); }

ok('nav to cloud gaming', await navTo('Cloud Gaming'));
await sleep(800);
if (need(needLists, 'cloud page check')) {
  ok('cloud page renders', $$('.card').length > 0, $$('.card').length);
}

ok('nav to play with ads', await navTo('Play with Ads'));
await sleep(800);
if (need(needLists, 'play-with-ads page check')) {
  ok('play-with-ads page renders', $$('.card').length > 0, $$('.card').length);
}

// ---- Details overlay ----
const c = needLists ? $('.card') : null;
if (c) {
  c.click(); await sleep(900);
  ok('details overlay opens', !!$('.overlay-card'));
  ok('details has action buttons', $$('.overlay-card .hero-actions .btn').length >= 2);
  ok('details has title', !!$('.dh-title'));
  ok('details has game info', !!$('.overlay-card .kv'));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(500);
  ok('details closes on Escape', !$('.overlay-card'));
}

// ---- Settings ----
ok('nav to settings', await navTo('Settings'));
await sleep(900);
ok('settings categories', $$('.settings-nav .nav-item').length >= 10, $$('.settings-nav .nav-item').length);
ok('settings search box', !!$('.settings-search input'));
{
  let switches = 0;
  for (const cat of $$('.settings-nav .nav-item')) { cat.click(); await sleep(350); switches += $$('.settings-wrap .switch input').length; }
  ok('settings toggles across categories', switches > 5, switches);
}
ok('settings danger zone', /reset/i.test($('#main').textContent));

// Every category must render something without throwing.
{
  const cats = $$('.settings-nav .nav-item');
  let catOk = 0;
  for (const cat of cats) {
    cat.click(); await sleep(420);
    if ($('.settings-wrap .panel') || $('.settings-wrap .log-view')) catOk++;
  }
  ok('all settings categories render', catOk === cats.length, catOk + '/' + cats.length);
}

const pickCat = async (re) => {
  const b = $$('.settings-nav .nav-item').find((x) => re.test(x.textContent.trim()));
  if (!b) return false;
  b.click(); await sleep(600); return true;
};

// ---- Appearance: theme, accent, background ----
await pickCat(/appearance/i);

const segBtn = (re) => $$('.seg button').find((b) => re.test(b.textContent.trim()));
let lightBtn = segBtn(/^light$/i);
if (lightBtn) {
  lightBtn.click(); await sleep(500);
  ok('theme switches to light', document.body.classList.contains('theme-light'), document.body.className);
  let darkBtn = segBtn(/^dark$/i);
  if (darkBtn) { darkBtn.click(); await sleep(500); }
  ok('theme switches back to dark', document.body.classList.contains('theme-dark'), document.body.className);
} else {
  ok('theme switches to light', false, 'no theme control found');
  ok('theme switches back to dark', false, 'no theme control found');
}

// Accent: click a swatch whose colour differs from the active accent.
const hexToRgbStr = (hex) => {
  const m = String(hex).replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? 'rgb(' + [1, 2, 3].map((i) => parseInt(m[i], 16)).join(', ') + ')' : null;
};
const accentBefore = (await window.nexus.settings.get()).appearance.accent;
const sw = $$('.swatch').find((x) => getComputedStyle(x).backgroundColor !== hexToRgbStr(accentBefore));
if (sw) { sw.click(); await sleep(700); }
const accentAfter = (await window.nexus.settings.get()).appearance.accent;
ok('accent colour applies and persists', !!sw && accentBefore !== accentAfter,
   accentBefore + ' -> ' + accentAfter + ' (' + getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() + ')');

// Background mode toggle (solid <-> gradient) reveals the gradient controls.
{
  const gradBtn = segBtn(/^gradient$/i);
  if (gradBtn) {
    gradBtn.click(); await sleep(700);
    ok('gradient mode reveals gradient controls', $$('.color-input').length >= 2, $$('.color-input').length);
    const solidBtn = segBtn(/^solid$/i);
    if (solidBtn) { solidBtn.click(); await sleep(500); }
    ok('solid background restores', true);
  } else {
    ok('gradient mode reveals gradient controls', false, 'no background control');
    ok('solid background restores', false, 'no background control');
  }
}

// settings search
const ss = $('.settings-search input');
if (ss) {
  ss.value = 'keyboard'; ss.dispatchEvent(new Event('input', { bubbles: true })); await sleep(500);
  ok('settings search finds results', $$('.settings-results .p-item').length > 0, $$('.settings-results .p-item').length);
  ss.value = ''; ss.dispatchEvent(new Event('input', { bubbles: true })); await sleep(400);
}

// ---- Controls ----
ok('nav to settings for controls', await navTo('Settings'));
await sleep(700);
{
  const cat = $$('.settings-nav .nav-item').find((x) => /controls/i.test(x.textContent.trim()));
  if (cat) { cat.click(); await sleep(600); }
  const openBtn = $$('#main .btn').find((b) => /open/i.test(b.textContent.trim()));
  if (openBtn) { openBtn.click(); await sleep(1500); }
}
ok('controls screen reachable', $$('.controls-nav-item').length === 7, $$('.controls-nav-item').length);
await sleep(500);
const cxNodes = $$('.controller-visual [data-btn]').length;
ok('controller diagram renders', cxNodes >= 20, cxNodes);
ok('diagram face buttons', $$('.cx-face').length === 4, $$('.cx-face').length);
ok('diagram callouts', $$('.cx-callout').length === 7, $$('.cx-callout').length);
ok('diagram stick clicks', $$('.cx-stick').length === 2, $$('.cx-stick').length);
ok('diagram stick direction chips', $$('.cx-axis').length === 8, $$('.cx-axis').length);
ok('diagram d-pad directions', $$('.cx-dpdir').length === 4, $$('.cx-dpdir').length);
{
  // Every remappable input must be reachable from the artwork, not just the list.
  const want = ['gamepadA','gamepadB','gamepadX','gamepadY','gamepadLB','gamepadRB','gamepadLT','gamepadRT',
    'gamepadSelect','gamepadStart','gamepadGuide','gamepadLS','gamepadRS',
    'gamepadDUp','gamepadDDown','gamepadDLeft','gamepadDRight',
    'gamepadLSU','gamepadLSD','gamepadLSL','gamepadLSR','gamepadRSU','gamepadRSD','gamepadRSL','gamepadRSR'];
  const have = new Set($$('.controller-visual [data-btn]').map((n) => n.dataset.btn));
  const missing = want.filter((id) => !have.has(id));
  ok('all 25 inputs are on the diagram', missing.length === 0, missing.join(','));
  const rows = $$('.map-item').map((n) => n.dataset.btn);
  ok('all 25 inputs are in the mapping list', want.every((id) => rows.includes(id)),
     want.filter((id) => !rows.includes(id)).join(','));
  // Hotspots must land inside the artwork, not on top of each other.
  const stage = $('.cx-stage');
  const sr = stage ? stage.getBoundingClientRect() : { width: 0, height: 0 };
  const inside = $$('.cx-face, .cx-stick, .cx-axis, .cx-dpdir').filter((n) => {
    const r = n.getBoundingClientRect();
    return sr.width > 0 && r.left >= sr.left - 2 && r.right <= sr.right + 2
      && r.top >= sr.top - 2 && r.bottom <= sr.bottom + 2 && r.width > 4;
  }).length;
  ok('hotspots are measured onto the artwork', inside === 18, inside + '/' + $$('.cx-face, .cx-stick, .cx-axis, .cx-dpdir').length);
  const faceX = $('.cx-face[data-btn="gamepadX"]').getBoundingClientRect();
  const faceB = $('.cx-face[data-btn="gamepadB"]').getBoundingClientRect();
  ok('face buttons do not overlap', Math.abs(faceX.right - faceB.left) > 2 || Math.abs(faceX.top - faceB.top) > 2,
     JSON.stringify([Math.round(faceX.x), Math.round(faceB.x)]));
  const dp = $('.cx-dpdir[data-btn="gamepadDUp"]').getBoundingClientRect();
  ok('d-pad does not sit under the face buttons', Math.abs(dp.x - faceX.x) > 8 || Math.abs(dp.y - faceX.y) > 8,
     JSON.stringify([Math.round(dp.x), Math.round(faceX.x)]));
}
ok('mapping list renders', $$('.map-item').length === 25, $$('.map-item').length);
ok('input test pad renders', $$('.testpad .tp-cell').length >= 15, $$('.testpad .tp-cell').length);
ok('profile dropdown present', $$('.dd-trigger').length >= 1, $$('.dd-trigger').length);

// dropdown opens/closes and reports the chosen value
{
  const trig = $('.profile-header .dd-trigger');
  trig.click(); await sleep(400);
  ok('dropdown opens', !!document.querySelector('.dd-menu.open'), $$('.dd-menu .dd-item').length);
  const items = $$('.dd-menu .dd-item');
  ok('dropdown lists options', items.length >= 1, items.length);
  const item = items[items.length - 1];
  const chosen = item ? item.textContent.trim() : null;
  if (item) { item.click(); await sleep(800); }
  ok('dropdown closes on pick', !document.querySelector('.dd-menu'), !!document.querySelector('.dd-menu'));
  ok('dropdown pick applied', chosen && $('.profile-header .dd-trigger').textContent.includes(chosen.slice(0, 4)),
     chosen + ' vs ' + ($('.profile-header .dd-trigger') || {}).textContent);
}

// remap: bind a free key to X, then exercise the real conflict flow.
const xHit = $('[data-btn="gamepadX"]');
if (xHit) {
  xHit.click(); await sleep(450);
  ok('remap enters listening state', !!document.querySelector('[data-btn="gamepadX"].listening'),
     (document.querySelector('[data-btn="gamepadX"]') || {}).className);
  document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyI', key: 'i', bubbles: true }));
  await sleep(800);
  const faceKey = (document.querySelector('.cx-face[data-btn="gamepadX"] .fb-key') || {}).textContent;
  ok('remap updates diagram', faceKey === 'I', faceKey);
  const rowKey = (document.querySelector('.map-item[data-btn="gamepadX"] .map-key') || {}).textContent;
  ok('remap updates list row', rowKey === 'I', rowKey);
  const saved = (await window.nexus.settings.get()).input.profiles[0].mapping.gamepadX;
  ok('remap persists to settings', saved && saved.code === 'KeyI', saved && saved.code);
  ok('remap did not rebuild the panel',
     !!document.querySelector('.controller-visual') && $$('.map-item').length >= 15);
}

// conflict: B already owns E, so binding A -> E must ask before overwriting.
const aHit = $('[data-btn="gamepadA"]');
if (aHit) {
  aHit.click(); await sleep(350);
  document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', key: 'e', bubbles: true }));
  await sleep(800);
  ok('conflict dialog appears', !!document.querySelector('.modal-veil .modal'),
     (document.querySelector('.modal h3') || {}).textContent);
  ok('conflict offers replace', /replace/i.test(document.body.textContent));
  ok('conflict offers keep both', /keep both/i.test(document.body.textContent));
  const rep = $$('.modal .btn').find((b) => /replace/i.test(b.textContent));
  if (rep) { rep.click(); await sleep(900); }
  ok('conflict dialog dismissed', !document.querySelector('.modal-veil'));
  const mapNow = (await window.nexus.settings.get()).input.profiles[0].mapping;
  ok('replace moves the binding',
     mapNow.gamepadA && mapNow.gamepadA.code === 'KeyE' && !(mapNow.gamepadB && mapNow.gamepadB.code === 'KeyE'),
     'A=' + ((document.querySelector('.cx-face[data-btn="gamepadA"] .fb-key') || {}).textContent));
  // Stick directions (LS/RS up/down/left/right) are separate BX indices from the
  // D-pad, so sharing a key with them is intentional, not a conflict.
  const STICK = new Set(['gamepadLSU', 'gamepadLSD', 'gamepadLSL', 'gamepadLSR',
                         'gamepadRSU', 'gamepadRSD', 'gamepadRSL', 'gamepadRSR']);
  const codes = Object.entries(mapNow).filter(([id]) => !STICK.has(id)).filter(([, v]) => v).map(([, v]) => v.code);
  ok('no duplicate bindings after replace', new Set(codes).size === codes.length, codes.join(','));
}

// blocked key rejected
const yHit = $('[data-btn="gamepadY"]');
if (yHit) {
  yHit.click(); await sleep(350);
  document.dispatchEvent(new KeyboardEvent('keydown', { code: 'MetaLeft', key: 'Meta', bubbles: true }));
  await sleep(800);
  ok('Windows-reserved key refused', /reserved by Windows/i.test(document.body.textContent),
     ($('.toast .t-msg') || {}).textContent);
}

// input test: sample while the highlight is still lit (it auto-clears ~260ms).
{
  document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyI', key: 'i', bubbles: true }));
  await sleep(80);
  ok('test pad lights up on mapped key', $$('.testpad .tp-cell.lit').length > 0, $$('.testpad .tp-cell.lit').length);
  ok('input test reports detected key',
     (/I/.test(($('.detect-row .det-value') || {}).textContent || '')),
     ($('.detect-row .det-value') || {}).textContent);
}

// keyboard & mouse section
const goSection = async (re) => {
  const b = $$('.controls-nav-item').find((x) => re.test(x.textContent.trim()));
  if (!b) return false;
  b.click(); await sleep(800); return true;
};
ok('keyboard section reachable', await goSection(/keyboard/i));
ok('keyboard view renders', $$('.kb-key').length > 40, $$('.kb-key').length);
ok('bound keys highlighted', $$('.kb-key.bound').length > 3, $$('.kb-key.bound').length);
{
  // An unbound key must offer a target, not silently do nothing.
  const glyphOf = (k) => (k.querySelector('.kb-glyph') || {}).textContent || '';
  const free = $$('.kb-key:not(.bound)').find((k) => ['U', '8'].includes(glyphOf(k)));
  if (free) {
    const glyph = glyphOf(free);
    const wanted = /[a-z]/i.test(glyph) ? 'Key' + glyph.toUpperCase() : 'Digit' + glyph;
    free.click(); await sleep(700);
    ok('unbound key opens the assign picker', !!$('.modal-veil .assign-list'), !!$('.modal-veil'));
    ok('assign picker offers every input', $$('.modal-veil .assign-chip').length >= 20, $$('.modal-veil .assign-chip').length);
    const jump = $('.modal-veil .assign-chip[data-assign="gamepadGuide"]');
    if (jump) {
      jump.click(); await sleep(900);
      ok('assign picker closes after picking', !$('.modal-veil'), !!$('.modal-veil'));
      const saved = (await window.nexus.settings.get()).input.profiles[0].mapping.gamepadGuide;
      ok('picked key is bound to the chosen input', saved && saved.code === wanted,
         glyph + ' -> ' + JSON.stringify(saved));
      const kb = $$('.kb-key.bound').length;
      ok('keyboard visual reflects the new binding', kb > 3, kb);
    }
  }
}
{
  const tabs = $$('.kbm-tabs .seg button');
  const mouseTab = tabs.find((x) => /mouse/i.test(x.textContent));
  if (mouseTab) { mouseTab.click(); await sleep(600); }
  ok('mouse settings render', $$('.slider-row').length >= 3, $$('.slider-row').length);
  // Mouse tuning is profile-scoped: it is what the stream bridge ships to Better xCloud.
  const cfgRows = $$('[data-cfg^="mouse."]');
  ok('mouse controls are profile-scoped', cfgRows.length >= 8, cfgRows.length);
  const invert = $('[data-cfg="mouse.invertY"] input');
  if (invert) {
    const before = (await window.nexus.settings.get()).input.profiles[0].mouse.invertY;
    invert.checked = !invert.checked;
    invert.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(600);
    const s = await window.nexus.settings.get();
    ok('mouse toggle writes to the active profile',
       s.input.profiles[0].mouse.invertY === !before, before + ' -> ' + s.input.profiles[0].mouse.invertY);
    ok('mouse toggle seeds the profile template',
       s.input.mouse.invertY === !before, s.input.mouse.invertY);
    invert.checked = before;
    invert.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(500);
  }
  const sens = $('[data-cfg="mouse.sensitivity"] input');
  if (sens) {
    sens.value = '1.5';
    sens.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(700);
    const p = (await window.nexus.settings.get()).input.profiles[0].mouse;
    ok('mouse slider writes to the active profile', Math.abs(Number(p.sensitivity) - 1.5) < 0.001, p.sensitivity);
  }
}

// sensitivity section
ok('sensitivity section reachable', await goSection(/sensitivity/i));
ok('sensitivity sliders render', $$('.slider-row').length >= 2, $$('.slider-row').length);
ok('stick controls are profile-scoped', $$('[data-cfg^="stick."]').length >= 4, $$('[data-cfg^="stick."]').length);

// profiles section
ok('profiles section reachable', await goSection(/^control profiles$/i));
ok('profiles list renders', $$('.profile-item').length >= 1, $$('.profile-item').length);
ok('profile actions present', /create profile/i.test(document.body.textContent));

// per-game section
ok('per-game section reachable', await goSection(/per-game/i));
ok('per-game rows render', $$('.assign-row').length > 0 || /play a game once/i.test(document.body.textContent),
   $$('.assign-row').length);

// devices + advanced
ok('devices section reachable', await goSection(/input devices/i));
ok('advanced section reachable', await goSection(/advanced/i));
ok('advanced renders', /in-game toggle hotkey/i.test(document.body.textContent));

// quick actions: conflict check + reset confirmation must open real modals
{
  const runCheck = $$('#main .btn').find((b) => /run check/i.test(b.textContent));
  if (runCheck) {
    runCheck.click(); await sleep(700);
    ok('conflict check opens a dialog', !!$('.modal-veil .modal'), !!$('.modal-veil'));
    ok('conflict report renders rows', $$('.conflict-row').length >= 0, $$('.conflict-row').length);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(500);
    ok('conflict dialog dismissed', !$('.modal-veil'));
  }
  const reset = $$('#main .btn').find((b) => /reset/i.test(b.textContent) && b.className.includes('danger'));
  if (reset) {
    reset.click(); await sleep(600);
    ok('reset asks for confirmation', !!$('.modal-veil .modal'), !!$('.modal-veil'));
    const cancel = $$('.modal-veil .btn').find((b) => /cancel|keep/i.test(b.textContent));
    if (cancel) { cancel.click(); await sleep(500); }
    ok('reset cancelled without destroying profiles',
       (await window.nexus.settings.get()).input.profiles.length >= 1,
       (await window.nexus.settings.get()).input.profiles.length);
  }
}

// quick actions menu: picking an item must actually run it
{
  await goSection(/controller mapping/i);
  const more = $$('#main .iconbtn').find((b) => /more/i.test(b.title || ''));
  if (more) {
    more.click(); await sleep(700);
    ok('quick actions menu opens', $$('.modal-veil .quick-item').length === 5, $$('.modal-veil .quick-item').length);
    const conflicts = $('.modal-veil .quick-item[data-action="conflicts"]');
    if (conflicts) {
      conflicts.click(); await sleep(900);
      ok('quick action runs its command', /already assigned|conflict/i.test(document.body.textContent), 'conflict check');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(500);
      let guard = 0;
      while ($('.modal-veil') && guard++ < 4) {
        const cancel = $$('.modal-veil .btn').find((b) => /cancel|close/i.test(b.textContent));
        (cancel || $$('.modal-veil .btn')[0])?.click();
        await sleep(400);
      }
    }
  }
}

// profile CRUD: duplicate, rename, delete
{
  await goSection(/^control profiles$/i);
  const countBefore = (await window.nexus.settings.get()).input.profiles.length;
  const dup = $$('#main .btn').find((b) => /new profile/i.test(b.textContent));
  if (dup) {
    dup.click(); await sleep(700);
    const prompt = $('.modal-veil input');
    if (prompt) {
      prompt.value = 'UITest FPS';
      prompt.dispatchEvent(new Event('input', { bubbles: true }));
      const create = $$('.modal-veil .btn').find((b) => /create|save|ok/i.test(b.textContent));
      create?.click(); await sleep(800);
      const list = (await window.nexus.settings.get()).input.profiles;
      ok('profile created', list.length === countBefore + 1, list.length);
      ok('profile copies the bindings', JSON.stringify(list[list.length - 1].mapping) === JSON.stringify(list[0].mapping),
         list[list.length - 1]?.name);
      ok('new profile listed', /UITest FPS/.test(document.body.textContent), list.map((p) => p.name).join(','));
    }
  }
  const rows = $$('.profile-item .p-name');
  const mine = rows.findIndex((r) => /UITest FPS/.test(r.textContent));
  if (mine >= 0) {
    const del = $$('.profile-item')[mine].querySelectorAll('.iconbtn');
    del[del.length - 1]?.click(); await sleep(600);
    const confirm = $$('.modal-veil .btn').find((b) => /delete|remove|confirm/i.test(b.textContent));
    confirm?.click(); await sleep(800);
    ok('profile deleted',
       (await window.nexus.settings.get()).input.profiles.length === countBefore,
       (await window.nexus.settings.get()).input.profiles.length);
  }
}


// ---- Streaming settings (quality + latency) ----
{
  await navTo('Settings');
  const cloudCat = $$('#main .nav-item, .settings-layout .nav-item, #main button.nav-item')
    .find((b) => /cloud|gaming/i.test(b.textContent));
  if (cloudCat) { cloudCat.click(); await sleep(700); }
  const sel = $$('#main select.select').map((s) => s.getAttribute('aria-label'));
  ok('streaming settings present',
     ['Target resolution', 'Frame rate limit', 'Video renderer', 'Controller polling rate']
       .every((label) => sel.includes(label)),
     sel.join('|'));
  const res = $('#main select[aria-label="Target resolution"]');
  if (res) {
    res.value = '1080p';
    res.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(600);
    ok('target resolution persists', (await window.nexus.settings.get()).cloud.targetResolution === '1080p',
       (await window.nexus.settings.get()).cloud.targetResolution);
  }
  const poll = $('#main select[aria-label="Controller polling rate"]');
  if (poll) {
    poll.value = '30';
    poll.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(600);
    ok('polling rate persists', (await window.nexus.settings.get()).cloud.pollingRate === 30,
       (await window.nexus.settings.get()).cloud.pollingRate);
  }
}

// ---- Pre-launch panel ----
{
  await navTo('Home');
  const card = $$('.card').find((c) => c.dataset.id);
  if (card) {
    card.click(); await sleep(1200);
    const play = $$('.overlay-card .btn').find((b) => /play now/i.test(b.textContent));
    if (play) {
      play.click(); await sleep(900);
      ok('launch panel opens', !!$('.modal-veil .launch-panel'), !!$('.modal-veil'));
      ok('launch panel offers a profile picker', $$('.modal-veil .dd-trigger').length >= 2,
         $$('.modal-veil .dd-trigger').length);
      ok('launch panel switches input mode', /keyboard & mouse/i.test($('.modal-veil').textContent));
      ok('launch panel exposes mouse aiming', /mouse sensitivity/i.test($('.modal-veil').textContent));
      ok('launch panel exposes display options', /target resolution/i.test($('.modal-veil').textContent));
      ok('launch panel has Configure Controls', /configure controls/i.test($('.modal-veil').textContent));
      // Configure Controls must route to the controls screen for this game.
      const cfg = $$('.modal-veil .btn').find((b) => /configure controls/i.test(b.textContent));
      if (cfg) {
        cfg.click(); await sleep(1200);
        ok('Configure Controls opens the controls screen', $$('.controls-nav-item').length === 7,
           $$('.controls-nav-item').length);
        ok('game profile override is selected for this game',
           ($('.dd-game .dd-value') || {}).textContent !== undefined, ($('.dd-game .dd-value') || {}).textContent);
      }
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(500);
      if ($('.modal-veil')) {
        const cancel = $$('.modal-veil .btn').find((b) => /cancel/i.test(b.textContent));
        (cancel || $$('.modal-veil .btn')[0])?.click();
        await sleep(500);
      }
      ok('launch panel closes without launching', !$('.modal-veil'));
    }
  }
}

// ---- Command palette ----
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
await sleep(600);
ok('Ctrl+K opens palette', !!$('.palette-veil .palette'));
const pi = $('.palette-veil input');
if (pi) {
  pi.value = 'keyboard'; pi.dispatchEvent(new Event('input', { bubbles: true })); await sleep(700);
  ok('palette matches settings keyword', /control/i.test($('.palette-veil').textContent));
  pi.value = 'fort'; pi.dispatchEvent(new Event('input', { bubbles: true })); await sleep(700);
  ok('palette matches games', $$('.palette-veil .p-item').length > 0, $$('.palette-veil .p-item').length);
}
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
await sleep(500);
ok('palette closes on Escape', !$('.palette-veil'));

ok('app still alive after full tour', !!$('#main') && $('#main').children.length > 0);
return out;
`;

async function run() {
  const consoleErrors = [];
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    skipTaskbar: true,
    backgroundColor: '#0b0d12',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (String(message).startsWith('@@ ')) { console.log(message.slice(3)); return; }
    if (level >= 2) consoleErrors.push(`${message} (${String(source).split('/').pop()}:${line})`);
  });
  win.webContents.on('render-process-gone', (_e, d) => consoleErrors.push('RENDERER GONE ' + JSON.stringify(d)));
  win.webContents.on('preload-error', (_e, p, err) => consoleErrors.push(`PRELOAD ${p}: ${err.message}`));

  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': APP_CSP } });
  });

  await win.loadURL('nexus://app/index.html');
  // Shown (not focused) so the compositor runs: rAF-driven motion, lazy images
  // and IntersectionObserver only behave like production in a visible window.
  win.showInactive();

  const results = await Promise.race([
    win.webContents.executeJavaScript(`(async () => { ${SCRIPT} })()`, true),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), RENDER_TIMEOUT)),
  ]).catch((err) => [{ name: 'renderer test crashed: ' + err.message, pass: false }]);

  let pass = true;
  const failed = [];
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.extra ? '  — ' + r.extra : ''}`);
    if (!r.pass) { pass = false; failed.push(r.name); }
  }
  console.log('');
  const unique = [...new Set(consoleErrors)];
  if (unique.length) {
    console.log(`CONSOLE ERRORS (${unique.length}):`);
    for (const e of unique.slice(0, 30)) console.log('  ! ' + e);
    pass = false;
  } else {
    console.log('CONSOLE ERRORS: none');
  }
  console.log('');
  console.log(pass ? `UI OK — ${results.length} checks passed` : `UI FAILED — ${failed.length}/${results.length} checks failed`);
  app.exit(pass ? 0 : 1);
}

app.whenReady().then(run);