/**
 * Stream window launch — regression test.
 *
 *   npx electron src/main/windowtest.cjs
 *
 * This drives the *real* `WindowManager.launchGame()` — the exact code path the
 * Play and Quick play buttons run — against a local stub page, so "clicking
 * Play actually opens a visible game window" is verified without a Microsoft
 * account or a live stream.
 *
 * The bug it guards: the reveal handler used to be registered *after*
 * `await loadURL()`, so on a fast load `ready-to-show` had already fired, the
 * window was never shown, and the launcher still reported "launched".
 */
'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const http = require('http');
const path = require('path');
const fs = require('fs');

process.env.NEXUS_NO_AUTO_BROWSER = '1';

const results = [];
const ok = (name, cond, extra) => { results.push({ name, cond: !!cond, extra: extra || '' }); };

// A local stand-in for the official play page: it resolves instantly, which is
// exactly the fast-load path that used to lose the reveal event.
let hits = 0;
const server = http.createServer((_req, res) => {
  hits++;
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!doctype html><title>stub play page</title><body>stub</body>');
});

process.on('unhandledRejection', (e) => { console.log('UNHANDLED', e && e.stack || e); app.exit(9); });
process.on('uncaughtException', (e) => { console.log('UNCAUGHT', e && e.stack || e); app.exit(9); });

app.whenReady().then(async () => {
  try {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  process.env.NEXUS_PLAY_URL = `http://127.0.0.1:${port}/play`;

  const { WindowManager } = require('./windows.cjs');
  const events = [];
  const wm = new WindowManager({
    store: { get: () => ({}), set: () => {} },
    log: { info() {}, warn() {}, error() {} },
    sendToRenderer: (ch, payload) => events.push({ ch, payload }),
    getStreamBundle: () => null,
  });

  // Keep-alive: with no launcher window, closing the game window would end the app
  // before the assertions ran.
  const keepAlive = new BrowserWindow({ show: false });
  console.log('server up, stub at', process.env.NEXUS_PLAY_URL);
  // The real app answers the stream preload's synchronous bundle request; without
  // that listener the preload throws, the page fails to load, and the error
  // path would reveal the window — hiding the very regression under test.
  ipcMain.on('stream:request-bundle', (e) => { e.returnValue = null; });

  const before = BrowserWindow.getAllWindows().length;

  // ---- 1. Launch a game the way the Play button does ----
  let res = null;
  try {
    res = await wm.launchGame({ productId: 'TESTPRODUCT', title: 'Stub Game', locale: 'en-US' });
  } catch (err) {
    ok('launchGame resolves', false, err.message);
  }
  console.log('launchGame returned', JSON.stringify(res));
  ok('launchGame resolves', !!res && res.reused === false, JSON.stringify(res));
  ok('exactly one game window was created', BrowserWindow.getAllWindows().length === before + 1,
    `${BrowserWindow.getAllWindows().length - before} extra`);

  const game = wm.streamWindows.get('TESTPRODUCT');
  ok('the window is tracked by product id', !!game);

  // The regression itself, checked at the exact moment the launcher tells the
  // UI 'launched': the window must already be on screen. Checking later would
  // let a fallback timer paper over the very bug this guards.
  ok('the game window is VISIBLE the moment the launch resolves (the Play button bug)',
    game && game.isVisible(), game ? `isVisible=${game.isVisible()}` : 'no window');
  await new Promise((r) => setTimeout(r, 600));
  ok('the game window stays visible', game && game.isVisible(),
    game ? `isVisible=${game.isVisible()}` : 'no window');
  ok('the game window loaded the play page', game && game.webContents.getURL().includes('127.0.0.1'),
    game ? game.webContents.getURL() : '');
  ok('the stub page was actually requested', hits >= 1, `${hits} hits`);
  ok('a loaded status was reported to the launcher',
    events.some((e) => e.ch === 'stream:status' && e.payload.state === 'loaded'),
    JSON.stringify(events.map((e) => e.payload && e.payload.state)));
  ok('no error status was reported',
    !events.some((e) => e.ch === 'stream:status' && e.payload.state === 'error'),
    JSON.stringify(events.filter((e) => e.payload && e.payload.state === 'error')));

  // ---- 2. Launching the same game again reuses the window ----
  const again = await wm.launchGame({ productId: 'TESTPRODUCT', title: 'Stub Game', locale: 'en-US' });
  ok('launching again reuses the window', again.reused === true, JSON.stringify(again));
  ok('no duplicate window is created', BrowserWindow.getAllWindows().length === before + 1,
    `${BrowserWindow.getAllWindows().length - before} extra`);

  // ---- 3. Fullscreen toggle reaches the window ----
  const fs1 = wm.setStreamFullscreen('TESTPRODUCT', true);
  ok('fullscreen can be requested', fs1 === true, String(fs1));

  // ---- 4. Closing cleans up ----
  wm.closeStream('TESTPRODUCT');
  await new Promise((r) => setTimeout(r, 600));
  ok('closing the game forgets it', !wm.streamWindows.has('TESTPRODUCT'));
  ok('the window is gone', BrowserWindow.getAllWindows().length === before,
    `${BrowserWindow.getAllWindows().length - before} extra`);

  // ---- 5. The shipped code keeps the ordering that fixes the bug ----
  const source = fs.readFileSync(path.join(__dirname, 'windows.cjs'), 'utf8');
  const idxHandler = source.indexOf("win.once('ready-to-show', reveal)");
  const idxLoad = source.indexOf('await win.loadURL(url);', source.indexOf('const url = this.playUrl(locale);'));
  ok('the reveal handler is registered before the page load starts',
    idxHandler !== -1 && idxLoad !== -1 && idxHandler < idxLoad, `handler@${idxHandler} load@${idxLoad}`);
  ok('the reveal is also called after the load resolves',
    /finally\s*\{[\s\S]{0,160}reveal\(\);/.test(source));

  await new Promise((r) => server.close(r));

  let pass = true;
  for (const r of results) {
    console.log(`${r.cond ? 'PASS' : 'FAIL'}  ${r.name}${r.extra ? ' — ' + r.extra : ''}`);
    if (!r.cond) pass = false;
  }
  console.log(pass ? 'WINDOW OK' : 'WINDOW FAILED');
  app.exit(pass ? 0 : 1);
  } catch (err) { console.log('THREW', err && err.stack || err); app.exit(9); }
});