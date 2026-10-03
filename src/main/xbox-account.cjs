/**
 * Xbox account identification — main process.
 *
 * Two official records tell us who is signed in, and neither is a credential we
 * ever keep:
 *
 *  1. `localStorage["xboxcom_xbl_user_info"]` on xbox.com — the page's own
 *     session record (xuid, gamertag, display claims). We read the identity
 *     fields and stop. Token strings inside it are never returned, logged or
 *     stored.
 *  2. The `XBXXtk` cookie on `.xbox.com`, whose name is the URL-encoded
 *     relying party and whose payload carries an `expiration`. This is how we
 *     tell three states apart that all look "signed in" to a naive check:
 *
 *        none   — no session cookie at all            -> signed out
 *        stale  — cookie present but expired/unusable -> session expired
 *        ok     — cookie present and in date          -> signed in
 *
 * Method borrowed from the XFly project (github.com/m669st/XFly), which
 * pioneered this cookie/localStorage approach for cloud gaming clients.
 */

const PROFILE_RELYING_PARTY = 'http://xboxlive.com';
const XBOX_TOKEN_COOKIE_PREFIX = 'XBXXtk';
const USER_INFO_KEY = 'xboxcom_xbl_user_info';

/** Give up rather than spin forever if the page never resolves (XFly does the same). */
const AUTH_PROBE_MS = 12000;

function decodeMaybe(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

/**
 * Parse the page's own session record.
 *
 * @param {string|object|null} raw JSON text (or an already-parsed object)
 * @returns {{xuid:string, gamertag:string, displayName:string, avatarUrl:string, gamerscore:string}|null}
 */
function readUserInfo(raw) {
  if (!raw) return null;
  let info = raw;
  if (typeof raw === 'string') {
    try { info = JSON.parse(raw); } catch { return null; }
  }
  if (!info || typeof info !== 'object') return null;

  const claims = info.displayClaims || info.claims || {};
  const gamertag = String(info.gamertag || info.displayName || claims.gtg || claims.gamertag || '').trim();
  if (!gamertag && !info.xuid) return null;

  return {
    xuid: String(info.xuid || claims.xui || claims.xuid || '').trim(),
    gamertag: gamertag.slice(0, 40),
    displayName: String(info.name || info.displayName || claims.name || '').trim().slice(0, 60),
    // Only a URL is ever taken out of here; nothing token-shaped.
    avatarUrl: typeof claims.pic === 'string' && /^https:\/\//i.test(claims.pic) ? claims.pic : '',
    gamerscore: String(info.gamerscore || claims.score || '').trim().slice(0, 12),
  };
}

/**
 * Classify the Xbox session cookie.
 *
 * @param {Array<{name:string, value:string, domain?:string, expirationDate?:number}>} cookies
 * @param {number} [now]
 * @returns {{state:'none'|'stale'|'ok', xuid:string, gamertag:string, expiresAt:number}}
 */
function readSessionCookie(cookies, now = Date.now()) {
  const out = { state: 'none', xuid: '', gamertag: '', expiresAt: 0 };
  const list = Array.isArray(cookies) ? cookies : [];
  if (!list.length) return out;

  const wanted = XBOX_TOKEN_COOKIE_PREFIX + PROFILE_RELYING_PARTY;
  const decodable = list.filter((c) => String(c?.name || '').startsWith(XBOX_TOKEN_COOKIE_PREFIX));
  if (!decodable.length) return out;

  const cookie = decodable.find((c) => decodeMaybe(c.name) === wanted) || decodable[0];
  let data = null;
  try { data = JSON.parse(decodeMaybe(String(cookie?.value || ''))); } catch { data = null; }
  const td = (data && data.tokenData) || {};

  // A cookie that exists but cannot be read is a stale session, not a sign-in.
  if (!td.token || !td.userHash) {
    return { ...out, state: 'stale' };
  }
  // Expiry: an expired session must read as signed out, or the launcher would
  // promise a library the account can no longer open.
  const expiresAt = td.expiration ? new Date(td.expiration).getTime() : 0;
  if (expiresAt && expiresAt < now) {
    return {
      state: 'stale',
      expiresAt,
      xuid: td.userXuid ? String(td.userXuid) : '',
      gamertag: td.userGamertag ? String(td.userGamertag).slice(0, 40) : '',
    };
  }
  return {
    state: 'ok',
    expiresAt,
    xuid: td.userXuid ? String(td.userXuid) : '',
    gamertag: td.userGamertag ? String(td.userGamertag).slice(0, 40) : '',
  };
}

/**
 * Combine both records into the single answer the launcher uses.
 *
 * @param {{userInfo?:string|object|null, cookies?:Array}} input
 * @param {number} [now]
 * @returns {{signedIn:boolean, state:string, xuid:string, gamertag:string,
 *            displayName:string, avatarUrl:string, gamerscore:string, expiresAt:number}}
 */
function readAccount(input = {}, now = Date.now()) {
  const user = readUserInfo(input.userInfo) || {};
  const cookie = readSessionCookie(input.cookies, now);

  // The page's own record survives a sign-out (localStorage is not cleared with
  // the session), so it can only *positively* confirm a sign-in. The cookie is
  // the authority on whether that session is still valid: a stale or expired
  // cookie downgrades everything to "expired", which is exactly the case a
  // naive cookie-name check gets wrong.
  let signedIn;
  let state;
  if (cookie.state === 'stale') {
    signedIn = false;
    state = 'expired';
  } else if (cookie.state === 'ok') {
    signedIn = true;
    state = 'ok';
  } else {
    signedIn = !!(user.gamertag || user.xuid);
    state = signedIn ? 'ok' : 'none';
  }

  return {
    signedIn,
    state,
    xuid: user.xuid || cookie.xuid || '',
    gamertag: user.gamertag || cookie.gamertag || '',
    displayName: user.displayName || '',
    avatarUrl: user.avatarUrl || '',
    gamerscore: user.gamerscore || '',
    expiresAt: cookie.expiresAt || 0,
  };
}

/**
 * Injected at document-start into the sign-in window only.
 *
 * xbox.com/play shows a "Sign in" affordance before the Microsoft login form.
 * Clicking it ourselves means the player lands on Microsoft's real sign-in page
 * instead of hunting for a button in an unfamiliar window. It only ever clicks
 * a control that navigates to Microsoft's own login — it never types, never
 * submits and never touches credentials.
 */
const AUTO_SIGNIN_SCRIPT = `(() => {
  if (window.__nexusAutoSignIn) return;
  window.__nexusAutoSignIn = true;
  const KEY = ${JSON.stringify(USER_INFO_KEY)};
  const done = () => { try { return !!localStorage.getItem(KEY); } catch (e) { return false; } };
  const clickable = (el) => { try { el.click(); return true; } catch (e) { return false; } };
  const findSignIn = () => {
    const direct = [
      'a[href*="/auth/msa"]',
      'a[href*="login.live.com"]',
      '[data-testid*="signin" i]',
      '[data-testid*="sign-in" i]',
      '[aria-label*="sign in" i]',
      'button[aria-label*="sign in" i]',
    ];
    for (const sel of direct) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }
    const all = Array.from(document.querySelectorAll('button, a, [role="button"]'));
    return all.find((el) => /^\\s*sign\\s*in\\s*$/i.test(el.textContent || '')
      || /^\\s*connect\\s*an?\\s*account\\s*$/i.test(el.textContent || '')) || null;
  };
  let tries = 0;
  const timer = setInterval(() => {
    if (done()) { clearInterval(timer); return; }
    if (location.href.includes('/auth/msa') || location.hostname.includes('login.')) {
      // Microsoft's own login form is on screen: the job is done, hands off.
      clearInterval(timer);
      return;
    }
    const btn = findSignIn();
    if (btn) { clearInterval(timer); clickable(btn); return; }
    if (++tries > 40) clearInterval(timer);
  }, 500);
})();`;

module.exports = {
  readUserInfo,
  readSessionCookie,
  readAccount,
  AUTO_SIGNIN_SCRIPT,
  AUTH_PROBE_MS,
  USER_INFO_KEY,
  XBOX_TOKEN_COOKIE_PREFIX,
  PROFILE_RELYING_PARTY,
};