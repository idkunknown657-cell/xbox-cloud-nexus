#!/usr/bin/env node
/**
 * Sign-in / account identification — offline assertions.
 *
 *   npm run verify:auth
 *
 * No network, no account, no credentials: the fixtures below are the two
 * official records a signed-in xbox.com session produces, so every branch —
 * signed in, expired session, stale cookie, signed out, cancelled — is proven
 * without asking anybody to type a password.
 */
'use strict';
const { readUserInfo, readSessionCookie, readAccount, AUTO_SIGNIN_SCRIPT, AUTH_PROBE_MS } = require('../src/main/xbox-account.cjs');

let pass = 0;
let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`PASS  ${name}`); } else { fail++; console.log(`FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
};

const NOW = Date.parse('2026-10-03T12:00:00Z');
const info = (over = {}) => JSON.stringify({
  xuid: '2533274791533122',
  gamertag: 'CloudPilot',
  displayName: 'CloudPilot',
  displayClaims: {
    xui: '2533274791533122',
    gtg: 'CloudPilot',
    pic: 'https://images-eds.xboxlive.com/profile.png',
  },
  tokens: {
    // Present in the real record; the app must never read it out.
    'http://xboxlive.com': { token: 'SUPER-SECRET-XBL-TOKEN', userHash: '1234567890' },
    'http://gssv.xboxlive.com/': { token: 'SUPER-SECRET-GSSV-TOKEN' },
  },
  ...over,
});
const cookie = (over = {}) => JSON.stringify({
  tokenData: {
    token: 'SUPER-SECRET-SESSION-TOKEN',
    userHash: '1234567890',
    userXuid: '2533274791533122',
    userGamertag: 'CloudPilot',
    expiration: '2026-11-03T12:00:00.000Z',
    ...over,
  },
});
const c = (name, value) => ({ name, value, domain: '.xbox.com' });

// ---------- Session record ----------
const parsed = readUserInfo(info());
ok('the signed-in account is identified by gamertag', parsed?.gamertag === 'CloudPilot', parsed?.gamertag);
ok('the xuid is read', parsed?.xuid === '2533274791533122', parsed?.xuid);
ok('the avatar url is read', /^https:\/\//.test(parsed?.avatarUrl || ''));
ok('no token value is ever returned', !JSON.stringify(parsed || {}).includes('SUPER-SECRET'), JSON.stringify(parsed));
ok('an unreadable record yields nothing', readUserInfo('not json') === null);
ok('an empty record yields nothing', readUserInfo('{}') === null);
ok('a record with no cookie or localStorage is not a sign-in', readAccount({ userInfo: null, cookies: [] }).signedIn === false);

// ---------- Session cookie states ----------
const fresh = readSessionCookie([c('XBXXtk' + encodeURIComponent('http://xboxlive.com'), cookie())], NOW);
ok('a live session cookie reads as ok', fresh.state === 'ok', fresh.state);
ok('the cookie carries the gamertag and xuid', fresh.gamertag === 'CloudPilot' && fresh.xuid === '2533274791533122');
ok('a live session cookie never exposes the token', !JSON.stringify(fresh).includes('SUPER-SECRET'));

const expired = readSessionCookie([c('XBXXtk' + encodeURIComponent('http://xboxlive.com'), cookie({ expiration: '2026-09-03T12:00:00.000Z' }))], NOW);
ok('an expired session reads as stale, not signed in', expired.state === 'stale', expired.state);
ok('an expired session still reports when it expired', expired.expiresAt === Date.parse('2026-09-03T12:00:00Z'));

const broken = readSessionCookie([c('XBXXtk' + encodeURIComponent('http://xboxlive.com'), '{"tokenData":{}}')], NOW);
ok('a cookie without a usable token reads as stale', broken.state === 'stale', broken.state);
ok('a corrupt cookie reads as stale', readSessionCookie([c('XBXXtkhttp://xboxlive.com', 'garbage')], NOW).state === 'stale');
ok('no cookie at all reads as none', readSessionCookie([], NOW).state === 'none');

// ---------- Combined decision ----------
const inBoth = readAccount({ userInfo: info(), cookies: [c('XBXXtk' + encodeURIComponent('http://xboxlive.com'), cookie())] }, NOW);
ok('signed in when both records agree', inBoth.signedIn && inBoth.state === 'ok', JSON.stringify({ s: inBoth.state }));
ok('identity survives the combination', inBoth.gamertag === 'CloudPilot');

const pageOnly = readAccount({ userInfo: info(), cookies: [] }, NOW);
ok('a completed page sign-in counts even before the cookie lands', pageOnly.signedIn === true);

const expiredButStaleRecord = readAccount({
  userInfo: info(),
  cookies: [c('XBXXtk' + encodeURIComponent('http://xboxlive.com'), cookie({ expiration: '2026-09-03T12:00:00Z' }))],
}, NOW);
ok('an expired session is reported as expired, not silently ok', expiredButStaleRecord.state === 'expired', expiredButStaleRecord.state);

const nothing = readAccount({}, NOW);
ok('a cancelled sign-in is simply signed out', nothing.signedIn === false && nothing.state === 'none');

// ---------- The auto sign-in injector ----------
ok('the injector waits on the official user-info key', AUTO_SIGNIN_SCRIPT.includes('xboxcom_xbl_user_info'));
ok('the injector only clicks Microsoft sign-in controls',
  AUTO_SIGNIN_SCRIPT.includes('/auth/msa') && AUTO_SIGNIN_SCRIPT.includes('login.live.com'));
ok('the injector stands down on the Microsoft login form',
  AUTO_SIGNIN_SCRIPT.includes("location.hostname.includes('login.')"));
ok('the injector gives up instead of looping forever', /tries > \d+/.test(AUTO_SIGNIN_SCRIPT));
ok('the injector is idempotent', AUTO_SIGNIN_SCRIPT.includes('__nexusAutoSignIn'));
ok('the probe timeout is finite', Number.isFinite(AUTH_PROBE_MS) && AUTH_PROBE_MS >= 5000 && AUTH_PROBE_MS <= 60000, String(AUTH_PROBE_MS));

// The injected script must parse as JavaScript once interpolated.
try {
  // eslint-disable-next-line no-new-func
  new Function(AUTO_SIGNIN_SCRIPT);
  ok('the injected script is syntactically valid', true);
} catch (err) {
  ok('the injected script is syntactically valid', false, err.message);
}

// ---------- The sign-in entry point ----------
//
// Sign-in used to load /play and then hunt for a "Sign in" control to click.
// That control varies by region and by leftover session state, which is why it
// worked for one account and not another. Microsoft's auth entry has no such
// variability, so the URL itself is asserted here.
const { WindowManager } = require('../src/main/windows.cjs');
const wm = Object.create(WindowManager.prototype);
const signInUrl = wm.signInUrl('en-US');

ok('sign-in starts at Microsoft\'s own auth entry', signInUrl.startsWith('https://www.xbox.com/auth/msa?'));
ok('sign-in asks for a login', /[?&]action=logIn\b/.test(signInUrl));
{
  const ret = new URL(signInUrl).searchParams.get('returnUrl') || '';
  ok('sign-in returns to the official play page', ret === 'https://www.xbox.com/en-US/play', ret);
}
ok('a locale cannot escape the xbox origin', !wm.signInUrl('evil.example.com/x').includes('evil.example.com'));
ok('the auth host is one the sign-in window may navigate to',
  WindowManager.signInHostAllowed(signInUrl), 'xbox.com/auth/msa');
ok('the return url host is one the sign-in window may navigate to',
  WindowManager.signInHostAllowed('https://www.xbox.com/en-US/play'));

console.log(fail === 0 ? `\nAUTH OK — ${pass} checks passed` : `\nAUTH FAILED — ${fail} of ${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);