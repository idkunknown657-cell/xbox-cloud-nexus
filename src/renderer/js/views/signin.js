/**
 * Microsoft sign-in gateway.
 *
 * Shown before the launcher when no Xbox account is connected. The user signs in
 * on Microsoft's own page — this screen only reports the outcome, because the
 * app must never handle somebody else's password. Two routes are offered and
 * both stay live until the account is actually connected: the in-app window and
 * the user's own browser. Nothing here ever gives up silently, which is what
 * made sign-in look broken when the first attempt did not land.
 */
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { settings } from '../store.js';
import { t } from '../i18n.js';
import { toastOk, toastErr } from '../toast.js';
import { sfx } from '../sfx.js';

let gate = null;
let active = null; // shared polling loop for the gate and the settings card

export function isSignInOpen() { return !!gate; }

/**
 * Start the official in-app sign-in window.
 * @returns {Promise<{ok:boolean, message?:string, url?:string}>}
 */
export async function startSignIn() {
  try {
    const res = await window.nexus.auth.signIn();
    return { ok: true, url: res?.url || '' };
  } catch (err) {
    return { ok: false, message: err?.message || 'Could not open the sign-in window' };
  }
}

/**
 * Fallback for locked-down networks: the official page in the user's browser.
 * Reported honestly — a silent failure here is what used to look like a dead
 * button.
 */
export async function startSignInInBrowser() {
  try {
    const res = await window.nexus.auth.openInBrowser();
    return { ok: true, url: res?.url || '' };
  } catch (err) {
    let url = '';
    try { url = await window.nexus.auth.signInUrl(); } catch { /* ignore */ }
    return { ok: false, message: err?.message || 'Your browser could not be opened', url };
  }
}

/** Re-read the account state from the main process. */
export async function checkAccount() {
  try { return await window.nexus.auth.status(); } catch { return null; }
}

/**
 * @param {{onDone?:Function}} opts
 * @returns {boolean} true when the gateway was shown
 */
export function showSignInGate({ onDone } = {}) {
  if (gate) return true;

  const status = h('div.sg-status', [h('span.dot'), h('span', 'Not connected')]);
  const spinner = h('span.sg-spin');
  const signInBtn = h('button.btn.primary.sg-primary', { type: 'button' },
    [icon('xbox', { size: 18 }), 'Sign in with Microsoft']);
  const skipBtn = h('button.btn.sg-skip', { type: 'button' }, 'Browse without signing in');
  const browserBtn = h('button.btn.sg-browser', { type: 'button' },
    [icon('link', { size: 15 }), 'Open Xbox in my browser']);
  const gamertag = h('div.sg-gamertag');
  const errorLine = h('div.sg-error');
  const linkLine = h('div.sg-link');
  const windowLine = h('div.sg-window');

  let poll = null;
  let busy = false;
  let checking = false;
  let finishing = false;

  const stopPolling = () => { if (poll) { clearInterval(poll); poll = null; } };
  const startPolling = (ms = 1500) => {
    stopPolling();
    poll = setInterval(() => refresh(), ms);
  };
  const setIdle = () => {
    busy = false;
    signInBtn.classList.remove('busy');
    spinner.classList.remove('on');
  };
  const setBusy = () => {
    busy = true;
    signInBtn.classList.add('busy');
    spinner.classList.add('on');
  };
  const setStatus = (text, cls) => {
    status.className = `sg-status${cls ? ' ' + cls : ''}`;
    status.innerHTML = '';
    status.append(h('span.dot'), h('span', text));
  };
  const showError = (message, url) => {
    errorLine.textContent = message || '';
    errorLine.classList.toggle('on', !!message);
    if (url) {
      linkLine.innerHTML = '';
      linkLine.classList.add('on');
      linkLine.append(h('span', 'Sign in at '), h('a', { href: url, target: '_blank', rel: 'noreferrer' }, url));
    } else {
      linkLine.classList.remove('on');
      linkLine.textContent = '';
    }
  };
  const paintWindow = (state) => {
    if (!state?.open) { windowLine.classList.remove('on'); return; }
    windowLine.classList.add('on');
    windowLine.textContent = state.loading
      ? 'Loading Microsoft’s sign-in page…'
      : `Sign-in window open${state.host ? ` — ${state.host}` : ''}. Sign in there; this screen closes itself when you are connected.`;
  };

  const finish = async (signedIn, tag) => {
    // Several sources can report success at once (the poll loop, the auth
    // event, a click); closing twice used to throw on a null gate.
    if (finishing) return;
    finishing = true;
    if (signedIn) sfx('notify', { force: false });
    const el = gate;
    stopPolling();
    try {
      await settings.set('account.signedIn', !!signedIn);
      if (tag) await settings.set('account.gamertag', tag);
    } catch { /* the account is still on disk from the main process */ }
    el?.classList.add('sg-leaving');
    setTimeout(() => {
      el?.remove();
      if (gate === el) gate = null;
      onDone?.(!!signedIn);
    }, 220);
  };

  const refresh = async () => {
    if (checking) return false;
    checking = true;
    try {
      const state = await window.nexus.auth.windowState().catch(() => null);
      if (state?.open) paintWindow(state);
      if (state?.error) showError(state.error, null);
      // Probe the page as well as the cookies: the official session record and
      // the session cookie are what actually identify the account.
      const s = await window.nexus.auth.status(true);
      if (s?.signedIn) {
        setStatus(s.gamertag ? `Connected as ${s.gamertag}` : 'Connected', 'ok');
        toastOk('Signed in', s.gamertag || 'Xbox account connected');
        sfx('notify');
        await finish(true, s.gamertag);
        setIdle();
        return true;
      }
      if (s?.sessionState === 'expired') {
        // A stale session cookie: the previous sign-in ran out. Say so and offer
        // a fresh one instead of pretending the launcher is connected.
        setStatus('Your Xbox session expired', 'err');
        showError('Microsoft ended the previous session on this PC. Sign in again to reconnect — your games will use the new session.');
        signInBtn.classList.add('highlight');
      } else if (s?.onLoginPage) {
        setStatus('Finish on Microsoft’s sign-in page…');
      } else if (s?.gamertag) gamertag.textContent = s.gamertag;
    } catch { /* the window may be mid-redirect */ } finally {
      checking = false;
    }
    return false;
  };

  signInBtn.addEventListener('click', async () => {
    if (busy) return;
    setBusy();
    showError('');
    setStatus('Opening Microsoft’s sign-in page…');
    const res = await startSignIn();
    if (!res.ok) {
      setIdle();
      setStatus('Could not open the sign-in window', 'err');
      showError(`${res.message} You can still sign in with the browser button below.`, '');
      browserBtn.classList.add('highlight');
      toastErr(new Error(res.message), 'Microsoft sign-in');
      return;
    }
    setStatus('Waiting for Microsoft…');
    startPolling();
    // The page decides when it is ready; this only mirrors it into the gate.
    window.nexus.events.authChanged?.((s) => { if (s?.signedIn) finish(true, s.gamertag); });
    refresh();
    // Never spin forever: if nothing has connected by the probe deadline, say
    // what to do next instead of leaving a spinner up.
    setTimeout(() => {
      if (!gate || gate.classList.contains('sg-leaving')) return;
      const label = status.querySelector('span:last-child');
      if (label && /waiting|opening|loading/i.test(label.textContent)) {
        setStatus('Still waiting for Microsoft', 'warn');
        showError('No sign-in completed yet. Check the sign-in window — if you closed it, press “Sign in with Microsoft” again.');
        signInBtn.classList.add('highlight');
        setIdle();
      }
    }, 15000);
  });

  skipBtn.addEventListener('click', async () => {
    await settings.set('account.skippedSignIn', true);
    finish(false, '');
  });

  // Locked-down networks: the user's own browser always reaches the page. Keep
  // the gate up and keep watching for the session — do not dismiss the gateway
  // and leave the user with no way to retry.
  browserBtn.addEventListener('click', async () => {
    setStatus('Opening your browser…');
    showError('');
    const res = await startSignInInBrowser();
    if (!res.ok) {
      setIdle();
      setStatus('Could not open your browser', 'err');
      showError(res.message, res.url);
      return;
    }
    setIdle();
    setStatus('Signed in to Xbox in your browser?');
    showError('Your browser keeps its own login. Nexus still needs one sign-in in its own window — that session is the one your games use. Click “Sign in with Microsoft” above when you are back.');
    signInBtn.classList.add('highlight');
    signInBtn.focus?.();
    startPolling(2500);
    refresh();
  });

  const unsubscribe = window.nexus.events.authChanged?.((s) => { if (s?.signedIn) finish(true, s.gamertag); });
  // If Microsoft's page cannot load (proxy, offline, firewall), say so instead
  // of leaving a window that looks broken — the browser route stays available.
  const unsubErr = window.nexus.events.authError?.((e) => {
    spinner.classList.remove('on');
    signInBtn.classList.remove('busy');
    busy = false;
    setStatus(e?.autoOpenedBrowser ? 'Microsoft’s page opened in your browser' : 'Microsoft sign-in problem', 'err');
    showError(e?.message || 'Sign-in failed', e?.url || '');
    if (e?.autoOpenedBrowser) startPolling();
  });

  gate = h('div.signin-gate', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Sign in to Xbox' }, [
    h('div.sg-card', [
      h('div.sg-brand', [h('img', { src: '/icons/icon-256.png', alt: '' }), h('span.sg-brand-name', 'Xbox Cloud Nexus')]),
      h('h1.sg-title', 'Sign in to Xbox Cloud Gaming'),
      h('p.sg-sub', 'Use your Microsoft account to connect Xbox Cloud Gaming. Your library, cloud saves and Game Pass entitlements all come from your own account.'),
      h('div.sg-points', [
        h('div.sg-point', [icon('shield', { size: 16 }), h('span', 'You sign in on Microsoft’s official page — Nexus never sees your password.')]),
        h('div.sg-point', [icon('play', { size: 16 }), h('span', 'One sign-in covers every game you launch, and it stays on this PC.')]),
        h('div.sg-point', [icon('keyboard', { size: 16 }), h('span', 'Keyboard & mouse mapping is applied to every game, signed in or not.')]),
      ]),
      h('p.sg-hint', 'A window opens on Xbox’s own play page — choose “Sign in” there and use your Microsoft account. Sign in inside that window: it is the session your games use. Nexus never asks for your password.'),
      status,
      windowLine,
      errorLine,
      linkLine,
      h('div.sg-actions', [signInBtn, browserBtn, spinner]),
      h('div.sg-alt', [skipBtn]),
      gamertag,
      h('p.sg-legal', 'Signing in is optional. Without it you can browse the catalogue; launching games needs an Xbox Cloud Gaming account, and your connection is subject to Microsoft’s terms.'),
    ]),
  ]);

  document.body.appendChild(gate);
  requestAnimationFrame(() => gate?.classList.add('sg-in'));

  // The account may already be connected from a previous run.
  refresh();

  gate._teardown = () => { stopPolling(); unsubscribe?.(); unsubErr?.(); };
  return true;
}

export function closeSignInGate() {
  gate?._teardown?.();
  gate?.remove();
  gate = null;
}

/** Connected-account line for the sidebar/profile menu. */
export function accountLabel() {
  if (settings.get('account.signedIn')) return settings.get('account.gamertag') || t('account');
  return t('signed_out');
}

export { active };