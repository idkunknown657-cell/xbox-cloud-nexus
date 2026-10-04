#!/usr/bin/env node
/**
 * Capture the README screenshots from the real UI.
 *
 * Run it with Electron so it uses the shipping renderer, preload and IPC:
 *   npx electron scripts/screenshots.mjs
 *
 * It writes PNGs into docs/screenshots/ using an isolated user-data directory,
 * so it never touches the settings of a real installation, and it never signs
 * in or launches a game.
 *
 * Three rules, each learned from producing a bad set:
 *
 *  1. A shot that is supposed to contain cover art is not accepted until the
 *     covers have actually loaded. The first version slept for a fixed number of
 *     seconds and wrote whatever was on screen, which is how home.png and
 *     library.png ended up as grids of grey shimmer placeholders — worse than no
 *     screenshot, because they advertised a broken app. Missing artwork now
 *     fails the run instead of being published.
 *  2. No two files may be the same picture. `controls.png` and `controls-900.png`
 *     were once byte-identical: this machine's display clamps window height, so
 *     the "smaller" capture was the same size as the first. Sizes and content
 *     hashes are both checked now, and the second shot is a narrower window that
 *     is asserted to have really narrowed.
 *  3. Navigation is asserted, not assumed. Setting `location.hash` and hoping
 *     the view had repainted produced a "library" screenshot that was actually
 *     Home. Each route is now reloaded and its own marker element is awaited.
 */
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outDir = path.join(root, 'docs', 'screenshots');

// Hermetic profile: past the wizard, but not signed in — so the first capture is
// the real sign-in gateway a new user sees, and nothing here claims an account
// or a subscription the app has not observed.
const profile = process.env.NEXUS_SHOT_PROFILE || path.join(os.tmpdir(), 'xcloud-nexus-shots');
if (!process.env.NEXUS_SHOT_PROFILE) fs.rmSync(profile, { recursive: true, force: true });
app.setPath('userData', profile);
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  app: { wizardCompleted: true },
  account: { signedIn: false, skippedSignIn: false, gamertag: '', plan: 'auto', planSource: '' },
}, null, 2));

require(path.join(root, 'src', 'main', 'main.cjs'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) { console.error('launcher window missing'); app.exit(1); return; }

  const written = [];
  const problems = [];
  const evaluate = (code) => win.webContents.executeJavaScript(code, true).catch(() => null);

  const save = async (name) => {
    const image = await win.webContents.capturePage();
    const file = path.join(outDir, `${name}.png`);
    const png = image.toPNG();
    fs.writeFileSync(file, png);
    const { width, height } = image.getSize();
    written.push({
      name, width, height, bytes: png.length,
      hash: crypto.createHash('sha1').update(png).digest('hex'),
    });
    console.log(`saved docs/screenshots/${name}.png  ${width}x${height}  ${(png.length / 1024).toFixed(0)} KB`);
  };

  /** Poll a boolean expression in the page. */
  const waitUntil = async (expr, timeout = 20000, every = 400) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await evaluate(expr)) return true;
      await sleep(every);
    }
    return false;
  };

  const covers = () => evaluate(`document.querySelectorAll('img.loaded').length`);

  /** Wait for cover art; returns false when it never arrives. */
  const waitForArt = async (min, timeout = 25000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const seen = (await covers()) || 0;
      if (seen >= min) { console.log(`  covers painted: ${seen}`); return true; }
      await sleep(500);
    }
    console.error(`  cover art did not arrive (${(await covers()) || 0} painted)`);
    return false;
  };

  /**
   * Navigate by hash *and reload*, so the shot is of the view we asked for.
   * @param {string} hash
   * @param {string} marker selector that only exists on that view
   */
  const go = async (hash, marker, settle = 1500) => {
    await evaluate(`location.hash = ${JSON.stringify('#' + hash)}`);
    win.webContents.reload();
    await sleep(settle);
    const there = await waitUntil(`!!document.querySelector(${JSON.stringify(marker)})`, 20000);
    if (!there) problems.push(`${hash}: never showed ${marker}`);
    console.log(`  ${hash}: ${there ? 'rendered' : 'NOT rendered'} (${marker})`);
    return there;
  };

  /** A shot that must contain cover art. */
  const saveWithArt = async (name, min) => {
    const got = await waitForArt(min);
    if (!got) problems.push(`${name}: cover art missing`);
    await save(name);
  };

  // Walking to the launch panel, one step at a time. The details view opens as
  // `.overlay-card`, and *its* Play Now is the button that opens the panel —
  // Home's hero also has a Play button, which launches immediately, so the query
  // is scoped to the overlay on purpose.
  const PANEL_STEP = `(() => {
    const byText = (sel, re) => Array.from(document.querySelectorAll(sel)).find((x) => re.test((x.textContent || '').trim()));
    if (document.querySelector('.modal')) return 'panel-open';
    if (document.querySelector('.overlay-card')) {
      const play = byText('.overlay-card button', /^play now$/i);
      if (play && !play.disabled && !play.classList.contains('disabled')) { play.click(); return 'clicked-play'; }
      const close = document.querySelector('.overlay-card .iconbtn');
      if (close) close.click();
      window.__shotCard = (window.__shotCard || 0) + 1;
      return 'next-card';
    }
    const gate = byText('.signin-gate .btn', /browse without/i);
    if (gate) { gate.click(); return 'cleared-gate'; }
    const card = document.querySelectorAll('#main .card')[window.__shotCard || 0];
    if (card) { card.click(); return 'opened-card'; }
    return 'stuck';
  })()`;

  const openPanel = async () => {
    for (let i = 0; i < 14; i++) {
      const r = await evaluate(PANEL_STEP);
      if (r === 'panel-open') return true;
      if (r === 'stuck') return false;
      await sleep(700);
    }
    return false;
  };

  try {
    win.setContentSize(1600, 900);
    win.show();
    win.focus();
    await sleep(4000);
    console.log(`capture size ${win.getContentSize().join('x')} (requested 1600x900)`);

    // 1. The sign-in gateway — the first thing a new user sees.
    await sleep(2500);
    await save('signin');

    // Everything else is captured signed out of the gate but still browsing.
    await evaluate(`window.nexus.settings.set('account.skippedSignIn', true)`);

    // 2. Home, with the artwork that was missing from the old set.
    await go('home', '.hero, .rail, #main .card');
    await saveWithArt('home', 8);

    // 3. The full cloud catalogue — same grid, different rail, so assert the
    //    view really changed before trusting the picture.
    await go('library', '#main .card');
    await saveWithArt('library', 6);

    // 4. Game details, reached by clicking a card like a player would.
    const details = await evaluate(`(async () => {
      const nap = (ms) => new Promise((r) => setTimeout(r, ms));
      const card = document.querySelector('#main .card');
      if (!card) return 'no card to open';
      card.click();
      await nap(1800);
      return document.querySelector('.overlay-card') ? 'opened' : 'no details view';
    })()`);
    console.log(`  details: ${details}`);
    if (details !== 'opened') problems.push(`details: ${details}`);
    await sleep(1200);
    await saveWithArt('details', 2);

    // 5. The pre-launch panel: control profile, input mode, display options, and
    //    what this account may actually do with the title.
    const opened = await openPanel();
    console.log(`  launch panel: ${opened ? 'open' : 'NOT open'}`);
    if (!opened) problems.push('launch panel: could not be opened without launching a game');
    await sleep(900);
    await save('launch');
    // Never press Play here: a screenshot run must not open a game window.
    await evaluate(`(() => { const x = document.querySelector('.modal .m-actions .ghost'); if (x) x.click(); })()`);
    await sleep(600);

    // 6. Controls & Input, then the same screen in a genuinely narrower window —
    //    the cramped layout is where the KBM panel used to overlap itself.
    await go('controls', '.keyboard, .kbm-panel');
    await sleep(1200);
    await save('controls');

    const before = win.getContentSize();
    win.unmaximize();
    win.setContentSize(1280, 800);
    await sleep(1800);
    const after = win.getContentSize();
    console.log(`  narrow: ${before.join('x')} -> ${after.join('x')}`);
    if (after[0] >= before[0]) {
      problems.push(`controls-narrow: the window would not narrow (${after.join('x')})`);
    } else {
      await save('controls-narrow');
    }

    win.setContentSize(1600, 900);
    await sleep(1200);

    // 7. Settings → Account.
    await go('settings', '.settings-wrap', 1800);
    const tab = await evaluate(`(() => {
      const a = document.querySelector('.settings-wrap [data-cat="account"]');
      if (a) a.click();
      return !!a;
    })()`);
    console.log(`  account tab: ${tab}`);
    if (!tab) problems.push('account: the account tab was not found');
    await sleep(2200);
    await save('account');

    // ---------- Self-check: never publish the defects we were told about ----------
    for (const a of written) {
      for (const b of written) {
        if (a.name < b.name && a.hash === b.hash) problems.push(`${a.name}.png and ${b.name}.png are the same picture`);
      }
    }
    for (const name of ['signin', 'home', 'library', 'details', 'launch', 'controls', 'account']) {
      if (!written.some((w) => w.name === name)) problems.push(`${name}.png was not captured`);
    }
    // A stale file from an earlier run would still be referenced by the README.
    for (const f of fs.readdirSync(outDir)) {
      if (f.endsWith('.png') && !written.some((w) => `${w.name}.png` === f)) problems.push(`${f} is stale — nothing captured it this run`);
    }

    if (problems.length) {
      console.error('\nSCREENSHOTS INCOMPLETE:');
      for (const p of problems) console.error('  - ' + p);
      app.exit(1);
      return;
    }
    console.log('\nSCREENSHOTS OK — ' + written.map((w) => `${w.name} ${w.width}x${w.height} ${(w.bytes / 1024).toFixed(0)}KB`).join(', '));
    app.exit(0);
  } catch (err) {
    console.error('screenshot run failed:', err.message);
    app.exit(1);
  }
});
