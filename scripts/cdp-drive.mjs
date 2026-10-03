/**
 * Chrome DevTools Protocol driver for the running app.
 *
 * The app is launched with `--remote-debugging-port=9222`; this talks to it so
 * layout and launch behaviour can be verified against the *real* rendered app
 * instead of a mock.
 *
 *   node scripts/cdp-drive.mjs targets
 *   CDP_MATCH="<regex>" node scripts/cdp-drive.mjs eval "<expression>"
 *   node scripts/cdp-drive.mjs shot docs/screenshots/out.png [width] [height]
 *   node scripts/cdp-drive.mjs resize <width> <height>
 */
import { writeFileSync } from 'node:fs';

const PORT = process.env.CDP_PORT || '9222';
const MATCH = process.env.CDP_MATCH || '';

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return res.json();
}

async function pickTarget() {
  const targets = await listTargets();
  const pages = targets.filter((t) => t.type === 'page');
  if (!pages.length) throw new Error('no page targets');
  const m = MATCH ? new RegExp(MATCH, 'i') : null;
  const found = m ? pages.find((t) => m.test(`${t.title} ${t.url}`)) : pages[0];
  if (!found) throw new Error(`no target matching ${MATCH} in:\n${pages.map((p) => `  ${p.title} :: ${p.url}`).join('\n')}`);
  return found;
}

class Session {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.method) return;   // protocol events are not replies
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data || '')})`));
      else p.resolve(msg.result);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`));
      }, 60000);
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, userGesture: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
    }
    return r.result.value;
  }
}

async function connect() {
  const target = await pickTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('ws error')), { once: true });
  });
  return { session: new Session(ws), target };
}

const [cmd, ...rest] = process.argv.slice(2);

if (cmd === 'targets') {
  const t = await listTargets();
  for (const x of t) console.log(`${x.type}\t${x.title}\t${x.url}`);
} else if (cmd === 'eval') {
  const { session, target } = await connect();
  const out = await session.eval(rest.join(' '));
  console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 2));
} else if (cmd === 'shot') {
  const file = rest[0] || 'docs/screenshots/cdp.png';
  const { session } = await connect();
  await session.send('Page.enable');
  const r = await session.send('Page.captureScreenshot', { format: 'png', fromSurface: false, captureBeyondViewport: false });
  writeFileSync(file, Buffer.from(r.data, 'base64'));
  console.log(`wrote ${file}`);
} else if (cmd === 'resize') {
  // Resize the *renderer viewport*, which is what the layout actually responds
  // to. Browser.setWindowBounds cannot go below the OS minimum window size, so
  // the small sizes in the layout sweep would otherwise be unreachable.
  const { session } = await connect();
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: Number(rest[0]), height: Number(rest[1]), deviceScaleFactor: 1, mobile: false,
  });
  console.log(`viewport ${rest[0]}x${rest[1]}`);
} else {
  console.log('usage: targets | eval <expr> | shot <file> | resize <w> <h>');
}
process.exit(0);