/**
 * Modal / launch panel reachability probe.
 *
 * The launch panel is ~900px of profile, input and display controls. It used to
 * be shown in a dialog that could neither scroll nor shrink, so on a short
 * window its Play button was clipped off the bottom with no way to reach it.
 *
 * This drives the real dialog in the real app and asserts, at several window
 * heights, that the Play button is inside the viewport, that the body scrolls
 * when it does not fit, and that scrolling reveals the bottom content.
 */
const PORT = process.env.CDP_PORT || '9222';

const HEIGHTS = [1080, 900, 800, 720, 640];

/*
 * Home's "Play Now" calls launchGame() directly and never opens this dialog, so
 * the route under test is Game Details -> Play Now. The wizard and the sign-in
 * gateway are cleared first because a fresh profile starts behind them.
 */
const STEP = `(() => {
  const byText = (sel, re) => [...document.querySelectorAll(sel)].find(x => re.test(x.textContent.trim()));
  if (document.querySelector('.modal')) return 'dialog-open';
  if (document.querySelector('.overlay-card')) {
    const play = byText('.overlay-card button', /^play now$/i) || byText('.overlay-card button', /^play$/i);
    if (play) { play.click(); return 'clicked-play'; }
    return 'overlay-without-play';
  }
  const gate = byText('.signin-gate .btn', /browse without/i);
  if (gate) { gate.click(); return 'cleared-gate'; }
  const wz = byText('button', /^(skip|next|finish|done|got it)$/i);
  if (wz && document.querySelector('.wizard, .wz, [class*="wizard"]')) { wz.click(); return 'cleared-wizard'; }
  const details = byText('button', /^game details$/i);
  if (details) { details.click(); return 'clicked-details'; }
  const home = byText('.nav-item', /^home$/i);
  if (home) { home.click(); return 'clicked-home'; }
  return 'stuck';
})()`;

/** Walks Home -> Game Details -> Play Now until the launch dialog is open. */
async function openDialog() {
  let last = '';
  for (let i = 0; i < 12; i++) {
    const r = await evaluate(STEP);
    if (r === 'dialog-open') return true;
    if (r === 'stuck') break;
    if (r === 'overlay-without-play') { last = r; break; }
    await wait(600);
  }
  if (last) console.error(`  (could not open the dialog: ${last})`);
  return false;
}

const PROBE = `(() => {
  const veil = document.querySelector('.modal-veil');
  const modal = document.querySelector('.modal');
  const body = document.querySelector('.modal .m-body');
  if (!veil || !modal || !body) return JSON.stringify({ missing: true });
  const btn = [...document.querySelectorAll('.modal .m-actions button')]
    .find(x => /play now/i.test(x.textContent));
  const R = (e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) }; };
  const vr = R(veil);
  const before = body.scrollTop;
  body.scrollTop = body.scrollHeight;
  const after = body.scrollTop;
  body.scrollTop = before;
  const br = btn ? R(btn) : null;
  return JSON.stringify({
    vp: [innerWidth, innerHeight],
    veilScrollable: veil.scrollHeight > veil.clientHeight + 1,
    veilOverflow: getComputedStyle(veil).overflowY,
    modalH: R(modal).h,
    modalTopClipped: R(modal).top < vr.top - 1,
    bodyScrollable: body.scrollHeight > body.clientHeight + 1,
    bodyScrollRange: after - before,
    playBtnPresent: !!btn,
    playBtnTop: br && br.top,
    playBtnBottom: br && br.bottom,
    playBtnReachable: !!(br && br.top >= vr.top - 1 && br.bottom <= vr.bottom + 1),
    title: (document.querySelector('.modal h3') || {}).textContent || '',
  });
})()`;

let targets;
try {
  targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
} catch {
  console.error(`MODAL SKIPPED — nothing is listening on 127.0.0.1:${PORT}.`);
  console.error('  npx electron . --remote-debugging-port=9222');
  process.exit(2);
}
const page = targets.filter((t) => t.type === 'page').find((t) => /nexus:\/\/app/.test(t.url));
if (!page) { console.error('MODAL SKIPPED — the launcher window is not open.'); process.exit(2); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', () => rej(new Error('devtools websocket failed')), { once: true });
});
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  const p = m.id && pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const closeDialog = () => evaluate(`(() => {
  for (const sel of ['.modal', '.overlay-card']) {
    document.querySelectorAll(sel).forEach(el => el.closest('[class*="veil"], .overlay-card')?.remove() || el.remove());
  }
  return !document.querySelector('.modal');
})()`);

const lines = [];
let failures = 0;

for (const height of HEIGHTS) {
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height, deviceScaleFactor: 1, mobile: false });
  await wait(250);
  await closeDialog();
  await wait(300);

  const opened = await openDialog();
  if (!opened) { failures++; lines.push(`FAIL h=${height} could not open the launch dialog`); continue; }
  await wait(500);

  const m = JSON.parse(await evaluate(PROBE));
  const bad = [];
  if (m.missing) {
    failures++;
    lines.push(`FAIL h=${height} the launch dialog did not render`);
    continue;
  }
  if (!m.playBtnPresent) bad.push('the Play button is missing');
  if (!m.playBtnReachable) bad.push(`Play button outside the viewport (${m.playBtnTop}..${m.playBtnBottom} vs 0..${(m.vp || [])[1]})`);
  if (m.modalTopClipped) bad.push('the top of the dialog is clipped off-screen');
  if (m.bodyScrollable && m.bodyScrollRange <= 0) bad.push('the body claims to scroll but does not');
  if (m.veilOverflow === 'hidden') bad.push('the veil cannot scroll');
  if (/^Launching/i.test(m.title)) bad.push(`the dialog still claims to be launching ("${m.title}")`);
  failures += bad.length;
  lines.push(
    `${bad.length ? 'FAIL' : ' ok '} h=${String(height).padEnd(5)} dialog=${String(m.modalH).padEnd(4)}px bodyScroll=${String(m.bodyScrollable).padEnd(5)}` +
    ` range=${String(m.bodyScrollRange).padEnd(5)} playBtn=${m.playBtnTop}..${m.playBtnBottom} title="${m.title}"` +
    (bad.length ? `\n       - ${bad.join('\n       - ')}` : ''),
  );
}

console.log(lines.join('\n'));
console.log(failures ? `\nMODAL FAIL — ${failures} problem(s)` : '\nMODAL OK');
process.exit(failures ? 1 : 0);