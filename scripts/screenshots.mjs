#!/usr/bin/env node
/**
 * Capture README screenshots from the real UI.
 *
 * Run it with Electron so it uses the shipping renderer, preload and IPC:
 *   npx electron scripts/screenshots.mjs
 *
 * It writes PNGs into docs/screenshots/ using an isolated user-data directory,
 * so it never touches the settings of a real installation. Navigation is done
 * by hash + renderer reload instead of clicking through menus: a screenshot run
 * must not depend on an animation finishing first.
 */
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outDir = path.join(root, 'docs', 'screenshots');

// Hermetic profile: past the wizard, but not signed in — so the very first
// capture is the real sign-in gateway a new user sees.
const profile = process.env.NEXUS_SHOT_PROFILE || path.join(os.tmpdir(), 'xcloud-nexus-shots');
if (!process.env.NEXUS_SHOT_PROFILE) fs.rmSync(profile, { recursive: true, force: true });
app.setPath('userData', profile);
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({
  app: { wizardCompleted: true },
  account: { signedIn: false, skippedSignIn: false, gamertag: '' },
}, null, 2));

require(path.join(root, 'src', 'main', 'main.cjs'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) { console.error('launcher window missing'); app.exit(1); return; }

  const save = async (name) => {
    const image = await win.webContents.capturePage();
    const file = path.join(outDir, `${name}.png`);
    fs.writeFileSync(file, image.toPNG());
    const { width, height } = image.getSize();
    console.log(`saved docs/screenshots/${name}.png  ${width}x${height}  ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
  };

  /** Set the route, reload the renderer and let it settle. */
  const goto = async (hash, settle = 7000) => {
    await win.webContents.executeJavaScript(`location.hash = ${JSON.stringify('#' + hash)}`, true);
    win.webContents.reload();
    await sleep(settle);
  };

  try {
    win.setContentSize(1600, 1000);
    win.show();
    win.focus();
    await sleep(4000);

    // 1. Sign-in gateway (the first thing a new user sees).
    await sleep(2500);
    await save('signin');

    // 2. Everything else is captured signed-out of the gate but still browsing.
    await win.webContents.executeJavaScript(`window.nexus.settings.set('account.skippedSignIn', true)`, true);
    await goto('home', 14000);
    await save('home');

    await goto('library', 9000);
    await save('library');

    await goto('controls', 9000);
    await save('controls');

    // The size bug reports came in at: a cramped layout must not hide behind a
    // generous viewport.
    win.setContentSize(1600, 900);
    await sleep(1500);
    await save('controls-900');

    win.setContentSize(1600, 900);
    await goto('settings', 7000);
    await win.webContents.executeJavaScript(`(() => {
      const a = Array.from(document.querySelectorAll('.settings-nav .nav-item'))
        .find((x) => /account/i.test(x.textContent.trim()));
      if (a) a.click();
      return !!a;
    })()`, true);
    await sleep(2500);
    await save('account');

    app.exit(0);
  } catch (err) {
    console.error('screenshot run failed:', err.message);
    app.exit(1);
  }
});