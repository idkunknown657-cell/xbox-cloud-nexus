#!/usr/bin/env node
/**
 * Entitlement rules — offline assertions.
 *
 *   npm run verify:entitlements
 *
 * Runs against scripts/fixtures/entitlements.json (real Microsoft payloads
 * captured with `node scripts/capture-entitlements.cjs`) plus synthetic edge
 * cases. No network, no account, no credentials — the point is to prove the
 * access decision never lies in either direction:
 *
 *   - it must not offer Play for a title the account cannot start
 *   - it must not hide a title the account *can* start
 */
'use strict';
const path = require('path');
const { readProductAccess } = require('../src/main/entitlements.cjs');

let pass = 0;
let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`PASS  ${name}`); } else { fail++; console.log(`FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
};

(async () => {
  const rules = await import('../src/renderer/js/entitlements.js');
  const fixture = require(path.join(__dirname, 'fixtures', 'entitlements.json'));

  // ---------- Payload parsing (main process) ----------
  ok('fixture holds real catalogue products', fixture.products.length >= 10, `${fixture.products.length} products`);
  const parsed = fixture.products.map((p) => ({
    id: p.id,
    title: (p.payload.LocalizedProperties[0] || {}).ProductTitle,
    access: readProductAccess(p.payload),
  }));

  const allShape = parsed.every((p) => typeof p.access.subscribed === 'boolean'
    && typeof p.access.free === 'boolean'
    && typeof p.access.requiresPurchase === 'boolean'
    && typeof p.access.requiresText === 'string');
  ok('every product yields the same access shape', allShape);

  ok('cloud titles carry no list price in this market', parsed.every((p) => p.access.price === null),
    parsed.map((p) => `${p.title}:${p.access.price}`).slice(0, 3).join(' '));
  ok('no fixture title is mislabelled as a store purchase',
    parsed.every((p) => p.access.requiresPurchase === false),
    parsed.filter((p) => p.access.requiresPurchase).map((p) => p.title).join(', '));

  const withText = parsed.filter((p) => /game pass/i.test(p.access.requiresText));
  ok('subscription wording is read from Microsoft\'s own copy', withText.length >= 3, `${withText.length} titles`);
  ok('subscription wording yields a plan id',
    withText.every((p) => rules.plansFromText(p.access.requiresText).length > 0));
  const ea = parsed.filter((p) => /ea play/i.test(p.access.requiresText));
  ok('EA Play titles are recognised', ea.length > 0 && ea.every((p) => rules.plansFromText(p.access.requiresText).includes('ea')),
    `${ea.length} titles`);

  // ---------- Plan matching ----------
  ok('Ultimate satisfies a Game Pass requirement', rules.planSatisfies(['any'], 'ultimate'));
  ok('Core does not satisfy an Ultimate-only requirement', !rules.planSatisfies(['ultimate'], 'core'));
  ok('PC satisfies a plain Game Pass requirement', rules.planSatisfies(['any'], 'pc'));
  ok('no plan satisfies anything when there is no subscription', !rules.planSatisfies(['any'], 'none'));
  ok('plan labels are human readable', rules.planLabel('ultimate') === 'Game Pass Ultimate', rules.planLabel('ultimate'));

  // ---------- The decision matrix ----------
  const gpGame = {
    id: 'GP1',
    title: 'Game Pass title',
    access: { subscribed: true, free: true, requiresPurchase: false, price: null, requiresText: 'With Game Pass Ultimate, you can play more great games anytime.' },
  };
  const paidOnly = {
    id: 'PAY1',
    title: 'Subscription-only title',
    access: { subscribed: true, free: false, price: 6999, requiresPurchase: true, requiresText: 'With Game Pass Ultimate, you can play more great games anytime.' },
  };
  const freeGame = {
    id: 'FREE1',
    title: 'Free to play',
    access: { subscribed: false, free: true, requiresPurchase: false, price: null, requiresText: '' },
  };

  const included = rules.accessFor(gpGame, { signedIn: true, plan: 'ultimate', planKnown: true });
  ok('Game Pass title + Ultimate = Play', included.state === 'included' && included.play === true, JSON.stringify(included));
  ok('an included title names the plan in its reason', /Game Pass/i.test(included.reason), included.reason);

  const core = rules.accessFor(paidOnly, { signedIn: true, plan: 'core', planKnown: true });
  ok('subscription-only title + wrong tier = Requires Game Pass, Play disabled',
    core.state === 'requiresSubscription' && core.play === false, JSON.stringify(core));
  ok('the requirement is explained in words', /does not include/i.test(core.reason), core.reason);

  const unknownPlan = rules.accessFor(gpGame, { signedIn: true, plan: 'auto', planKnown: false });
  ok('an unreadable plan never blocks a subscription title', unknownPlan.play === true, JSON.stringify(unknownPlan));
  ok('an unreadable plan is flagged as uncertain', /included/i.test(unknownPlan.tag || '') && String(unknownPlan.tag).includes('?'), unknownPlan.tag);
  ok('a specifically named tier is not satisfied by another tier',
    !rules.planSatisfies(rules.plansFromText('With Game Pass Ultimate, you can play.'), 'core'));
  ok('a generic Game Pass requirement is satisfied by any tier',
    rules.planSatisfies(rules.plansFromText('Get Xbox Game Pass today to enjoy a catalog of games.'), 'core'));

  const adsSignedOut = rules.accessFor(gpGame, { signedIn: false, ads: true });
  ok('signed out + ad title = Play with Ads', adsSignedOut.state === 'ads' && adsSignedOut.play === true, JSON.stringify(adsSignedOut));
  const adsSignedIn = rules.accessFor(paidOnly, { signedIn: true, plan: 'none', planKnown: true, ads: true });
  ok('no subscription + ad title = Play with Ads, not a wall',
    adsSignedIn.state === 'ads' && adsSignedIn.play === true, JSON.stringify(adsSignedIn));

  const freeNoPlan = rules.accessFor(freeGame, { signedIn: true, plan: 'none', planKnown: true });
  ok('free-to-play title = Play for a free account',
    freeNoPlan.state === 'free' && freeNoPlan.play === true, JSON.stringify(freeNoPlan));

  const signedOut = rules.accessFor(paidOnly, { signedIn: false });
  ok('signed out never blocks a launch outright', signedOut.play === true, JSON.stringify(signedOut));
  ok('signed out asks for sign-in instead of promising access',
    /sign in/i.test(signedOut.reason), signedOut.reason);

  const gone = rules.accessFor({ ...freeGame, available: false }, { signedIn: true, plan: 'ultimate', planKnown: true });
  ok('a title Xbox is not offering is reported unavailable', gone.state === 'unavailable' && gone.play === false);

  const pascal = rules.accessFor({ ...gpGame, access: null }, { signedIn: false });
  ok('missing entitlement data degrades gracefully', !!pascal.state && pascal.play === true, JSON.stringify(pascal));

  // ---------- Play-with-Ads is the answer for every tier ----------
  //
  // This is the launch panel from the bug report: Fortnite on Xbox's own ads
  // list, with an Ultimate account, rendered "Free with ads" *and* "Play with
  // Ads — Not in your plan (Game Pass Ultimate)" at the same time. A title on
  // the ads list is streamed with a short ad whatever the account holds, so no
  // tier may turn it into a plan problem.
  const adsSubscribed = { ...gpGame, access: { ...gpGame.access, subscribed: true, requiresText: 'Requires Game Pass Ultimate' } };
  const adTiers = ['ultimate', 'pc', 'console', 'core', 'standard', 'none'];
  const adResults = adTiers.map((plan) => [plan, rules.accessFor(adsSubscribed, { ads: true, signedIn: true, plan, planKnown: true })]);
  ok('an ads title is Play with Ads for every tier',
    adResults.every(([, r]) => r.state === 'ads' && r.play === true),
    adResults.filter(([, r]) => r.state !== 'ads').map(([p, r]) => `${p}:${r.state}`).join(','));
  ok('an ads title never claims the plan is the problem',
    adResults.every(([, r]) => !/not in your plan|does not include/i.test(r.reason)),
    adResults.map(([, r]) => r.reason).find((x) => /not in your plan|does not include/i.test(x)) || '');
  ok('an ads title explains the ad it is paid for with',
    adResults.every(([, r]) => /ad\b/i.test(r.reason)), adResults[0][1].reason);
  const adsNoAccount = rules.accessFor(adsSubscribed, { ads: true, signedIn: false });
  ok('an ads title still offers Play when signed out',
    adsNoAccount.state === 'ads' && adsNoAccount.play === true, JSON.stringify(adsNoAccount));
  // The other half of the bug: a title that is NOT on the ads list must never
  // borrow the ad wording to excuse a plan problem.
  const noAds = rules.accessFor({ ...gpGame, access: { ...gpGame.access, subscribed: true, requiresText: 'Requires Game Pass Ultimate' } },
    { ads: false, signedIn: true, plan: 'core', planKnown: true });
  ok('a title without ads does not promise an ad it will not play',
    noAds.state !== 'ads' && !/short ad|plays a short/i.test(noAds.reason), JSON.stringify(noAds));

  // ---------- Real payloads through the real rules ----------
  const real = parsed.map((p) => rules.accessFor({ id: p.id, title: p.title, access: p.access },
    { signedIn: true, plan: 'ultimate', planKnown: true }));
  ok('real Game Pass titles are playable for an Ultimate account',
    real.every((r) => r.play === true), real.filter((r) => !r.play).map((r) => r.state).join(','));
  const realFree = parsed.map((p) => rules.accessFor({ id: p.id, access: p.access },
    { signedIn: true, plan: 'none', planKnown: true }));
  ok('real free titles stay playable without a subscription',
    realFree.every((r) => r.play === true), realFree.filter((r) => !r.play).map((r) => `${r.state}`).join(','));

  console.log(fail === 0 ? `\nENTITLEMENTS OK — ${pass} checks passed` : `\nENTITLEMENTS FAILED — ${fail} of ${pass + fail}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  console.error('ENTITLEMENTS ERROR', err);
  process.exit(1);
});