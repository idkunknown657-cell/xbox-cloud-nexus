/**
 * Layout regression probe for the Keyboard & Mouse panel.
 *
 * Renders BOTH routes the panel appears on — embedded in the Controls screen's
 * Controller Mapping column, and standalone as the Keyboard & Mouse section —
 * across a range of viewport sizes, and asserts that the keyboard visual, the
 * tab bar and the Mouse Settings card never intersect and that keys never
 * collapse into unreadable slivers.
 *
 * Everything runs over ONE DevTools session: a viewport override is scoped to
 * the session that set it, so resizing and measuring from separate connections
 * silently measures the old size.
 */
const PORT = process.env.CDP_PORT || '9222';

const SIZES = [
  [1920, 1080], [1600, 900], [1440, 900], [1366, 768],
  [1280, 800], [1152, 864], [1024, 768], [860, 700],
];

const PROBE = `(() => {
  const R = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l:r.left, r:r.right, t:r.top, b:r.bottom, w:r.width }; };
  const overlap = (a, b) => {
    if (!a || !b) return false;
    return !(a.r <= b.l + 0.5 || b.r <= a.l + 0.5 || a.b <= b.t + 0.5 || b.b <= a.t + 0.5);
  };
  const split = document.querySelector('.kbm-split');
  const kbd = R('.keyboard');
  const tabs = R('.kbm-tabs');
  const mouse = R('.mouse-card');
  const left = R('.kbm-left');
  const keys = [...document.querySelectorAll('.kb-key')].map(e => e.getBoundingClientRect().width);
  const main = document.querySelector('.main');
  return JSON.stringify({
    vp: [innerWidth, innerHeight],
    route: document.querySelector('.controls-3col') ? 'embedded' : 'standalone',
    cols: split ? getComputedStyle(split).gridTemplateColumns : null,
    kbdW: kbd && Math.round(kbd.w),
    mouseW: mouse && Math.round(mouse.w),
    minKey: keys.length ? Math.round(Math.min(...keys)) : null,
    tabsOverMouse: overlap(tabs, mouse),
    kbdOverMouse: overlap(kbd, mouse),
    kbdOverTabs: overlap(kbd, tabs),
    kbdClipped: !!(left && kbd && kbd.r > left.r + 1),
    tabsClipped: !!(left && tabs && tabs.r > left.r + 1),
    mainScrolls: main ? main.scrollHeight > main.clientHeight + 4 : null,
  });
})()`;

// This probe measures the real rendered app, so it needs the app running with
// the debugging port open. Failing with a raw connection stack trace would look
// like the probe is broken rather than the precondition being missing.
let targets;
try {
  targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
} catch {
  console.error(`LAYOUT SKIPPED — nothing is listening on 127.0.0.1:${PORT}.`);
  console.error('Start the app first:');
  console.error('  npx electron . --remote-debugging-port=9222');
  process.exit(2);
}
const page = targets.filter((t) => t.type === 'page').find((t) => /nexus:\/\/app/.test(t.url));
if (!page) {
  console.error(`LAYOUT SKIPPED — port ${PORT} is open but the launcher window is not there.`);
  console.error('Start the app first:');
  console.error('  npx electron . --remote-debugging-port=9222');
  process.exit(2);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', () => rej(new Error('devtools websocket failed')), { once: true });
});

let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  const p = msg.id && pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  if (msg.error) p.reject(new Error(msg.error.message));
  else p.resolve(msg.result);
});
const send = (method, params = {}) => {
  const i = ++id;
  ws.send(JSON.stringify({ id: i, method, params }));
  return new Promise((res, rej) => {
    pending.set(i, { resolve: res, reject: rej });
    setTimeout(() => { if (pending.delete(i)) rej(new Error(`${method} timed out`)); }, 20000);
  });
};
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
  return r.result.value;
};

const setSize = (w, h) => send('Emulation.setDeviceMetricsOverride', {
  width: w, height: h, deviceScaleFactor: 1, mobile: false,
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Section order matches SECTIONS in views/controls.js. Selecting by index is
// what the nav actually does; matching on label text broke on substring overlap.
const selectSection = async (index) => {
  await evaluate(`(() => {
    const items = [...document.querySelectorAll('.controls-nav-item')];
    const want = items[${index}];
    if (want && !want.classList.contains('active')) want.click();
    return items.length;
  })()`);
  await wait(350);
};

await setSize(1600, 900);
await wait(400);

/** The app routes on location.hash at boot, so a lost route needs a reload. */
async function ensureOnControls() {
  for (let i = 0; i < 3; i++) {
    const ok = await evaluate(`!!document.querySelector('.controls-nav-item')`);
    if (ok) return true;
    await evaluate(`location.hash = '#controls'; location.reload();`);
    await wait(2500);
  }
  throw new Error('could not reach the Controls screen');
}

const lines = [];
let failures = 0;

for (const [w, h] of SIZES) {
  await setSize(w, h);
  await wait(350);
  for (const [index, wantRoute] of [[0, 'embedded'], [1, 'standalone']]) {
    await ensureOnControls();
    await selectSection(index);
    const m = JSON.parse(await evaluate(PROBE));
    const bad = [];
    if (m.route !== wantRoute) bad.push(`expected ${wantRoute}, got ${m.route}`);
    if (m.vp[0] !== w) bad.push(`viewport override not applied (${m.vp[0]} != ${w})`);
    if (m.tabsOverMouse) bad.push('.kbm-tabs overlaps Mouse Settings');
    if (m.kbdOverMouse) bad.push('.keyboard overlaps Mouse Settings');
    if (m.kbdOverTabs) bad.push('.keyboard overlaps the tab bar');
    if (m.kbdClipped) bad.push('keyboard clipped by its column');
    if (m.tabsClipped) bad.push('tab bar clipped by its column');
    // 14 keys plus 13 gaps cannot exceed ~29px each in a 460px panel; that is the
// physical limit of the layout, not a squeeze bug. Below it, keys would have no
// glyph room at all.
if (m.minKey != null && m.minKey < 28) bad.push(`keys collapsed to ${m.minKey}px`);
    failures += bad.length;
    lines.push(
      `${bad.length ? 'FAIL' : ' ok '} ${String(w).padStart(4)}x${String(h)} ${wantRoute.padEnd(10)}` +
      ` cols=${String(m.cols).padEnd(20)} kbd=${String(m.kbdW).padEnd(5)} mouse=${String(m.mouseW).padEnd(5)} key=${m.minKey}px` +
      (bad.length ? `\n       - ${bad.join('\n       - ')}` : ''),
    );
  }
}

console.log(lines.join('\n'));
console.log(failures ? `\nLAYOUT FAIL — ${failures} problem(s)` : '\nLAYOUT OK');
process.exit(failures ? 1 : 0);