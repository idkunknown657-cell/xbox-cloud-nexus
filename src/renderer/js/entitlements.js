/**
 * Entitlements — renderer half, the single implementation of the access rules.
 *
 * Inputs:
 *   game.access   entitlement facts parsed in the main process from Microsoft's
 *                 own per-market payload (subscribed / free / requiresPurchase /
 *                 requiresText)
 *   ads           whether the title is on Xbox's Play-with-Ads list
 *   account       the signed-in state and plan reported by the main process
 *
 * Output is what the launcher is willing to promise. Microsoft still decides
 * every launch; this exists so the UI never shows a green "Play" for a game the
 * account cannot start, and never hides a game it can.
 */

/** Plan names Microsoft itself prints in its requirement copy. */
export const PLAN_PATTERNS = [
  { id: 'ultimate', label: 'Game Pass Ultimate', re: /game pass ultimate/i },
  { id: 'pc', label: 'Game Pass PC', re: /game pass pc\b/i },
  { id: 'console', label: 'Game Pass Console', re: /game pass console/i },
  { id: 'core', label: 'Game Pass Core', re: /game pass core/i },
  { id: 'standard', label: 'Game Pass Standard', re: /game pass standard/i },
  { id: 'ea', label: 'EA Play', re: /ea play/i },
  { id: 'ubisoft', label: 'Ubisoft+', re: /ubisoft\s*\+/i },
  { id: 'any', label: 'Game Pass', re: /game pass\b/i },
];

const norm = (v) => String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9]/g, '');

/** Which of our plan ids a given account tier satisfies. */
const SATISFIES = {
  ultimate: ['ultimate', 'any', 'ea', 'ubisoft'],
  pc: ['pc', 'any'],
  console: ['console', 'any'],
  core: ['core', 'any'],
  standard: ['standard', 'any'],
  any: ['any'],
  none: [],
};

/** Plan ids named in Microsoft's requirement text for a title. */
export function plansFromText(text) {
  const s = String(text || '');
  const ids = [];
  for (const p of PLAN_PATTERNS) if (p.re.test(s) && !ids.includes(p.id)) ids.push(p.id);
  // Specificity wins: "with Game Pass Ultimate" must not also count as "any
  // Game Pass", or a Core subscriber would be told a Ultimate title is covered.
  if (ids.includes('any') && ids.some((id) => id !== 'any')) return ids.filter((id) => id !== 'any');
  return ids;
}

/** Human labels for the plan ids named in a requirement string. */
export function planNamesFromText(text) {
  const ids = plansFromText(text);
  return ids.map((id) => (PLAN_PATTERNS.find((p) => p.id === id) || { label: 'Game Pass' }).label)
    .filter((label, i, arr) => arr.indexOf(label) === i);
}

/** Does the account's tier cover a title that needs one of `planIds`? */
export function planSatisfies(planIds, accountPlan) {
  const want = SATISFIES[norm(accountPlan) || 'none'] || [];
  return (planIds || []).some((id) => want.includes(norm(id)));
}

/** Human label for the account's plan chip. */
export function planLabel(planId) {
  const key = norm(planId);
  if (!key || key === 'auto' || key === 'none') return 'No subscription';
  const hit = PLAN_PATTERNS.find((p) => p.id === key);
  return hit ? hit.label : 'Game Pass';
}

/**
 * The one decision the whole app asks.
 *
 * @param {object} game  catalog summary (may carry `access` / `available`)
 * @param {{ads?:boolean, signedIn?:boolean, plan?:string, planKnown?:boolean}} account
 * @returns {{state:string, label:string, reason:string, play:boolean, tag:string|null}}
 *   state: included | ads | free | requiresSubscription | unavailable | unknown
 */
export function accessFor(game, account = {}) {
  const acc = (game && game.access) || {};
  const ads = account.ads === true;
  const signedIn = account.signedIn === true;
  const planKnown = account.planKnown === true;
  const plan = norm(account.plan || 'none');
  const plans = planNamesFromText(acc.requiresText);

  // Availability: the catalogue is queried per market, so anything in the book
  // is offered here; an explicit flag from the payload overrides that.
  if (game && game.available === false) {
    return {
      state: 'unavailable', label: 'Not available', tag: null, play: false,
      reason: 'Xbox is not offering this title in your region right now.',
    };
  }

  // The Play-with-Ads list is Microsoft's own answer for the title, and it is
  // the answer for *every* account: a title on it is streamed with a short ad
  // regardless of tier. Reading the plan first is what produced a launch panel
  // that called the same game both "Free with ads" and "Not in your plan" —
  // two statements that cannot both be true, so neither was believed.
  if (ads) {
    return {
      state: 'ads', label: 'Play with Ads', tag: 'ADS', play: true,
      reason: signedIn
        ? 'Free to stream — Xbox plays a short ad in the game window before your session starts.'
        : 'Free to stream with a short Xbox ad. Sign in with your Microsoft account to start it.',
    };
  }

  // A subscription title is one Microsoft says a Game Pass-style entitlement
  // satisfies; whether *this* account's tier covers it depends on the plan.
  const isSubscriptionTitle = acc.subscribed === true;
  const covered = isSubscriptionTitle && (!planKnown || planSatisfies(plansFromText(acc.requiresText), plan));

  if (!signedIn) {
    if (acc.requiresPurchase === true) {
      return {
        state: 'requiresSubscription', label: 'Requires subscription', tag: 'SUB', play: true,
        reason: 'This is not a free or ad-supported title. Sign in to see whether your plan includes it.',
      };
    }
    return {
      state: 'unknown', label: 'Sign in to play', tag: null, play: true,
      reason: 'Sign in with your Microsoft account to see exactly what your plan includes.',
    };
  }

  if (covered && planKnown) {
    return {
      state: 'included', label: 'Play', tag: 'INCLUDED', play: true,
      reason: plans.length
        ? `Included with ${plans.join(' / ')}.`
        : 'Included with your subscription.',
    };
  }
  if (acc.subscribed === true && !planKnown) {
    // We can see it is a subscription title but not which tier the account has.
    // Never block: let Microsoft be the authority.
    return {
      state: 'included', label: 'Play', tag: 'INCLUDED?', play: true,
      reason: 'Included with a Game Pass plan. Pick your tier in Settings → Account to see exact badges.',
    };
  }
  if (acc.free === true && acc.requiresPurchase !== true) {
    return {
      state: 'free', label: 'Play', tag: 'FREE', play: true,
      reason: 'Free to play on your account.',
    };
  }
  if (isSubscriptionTitle || acc.requiresPurchase === true) {
    return {
      state: 'requiresSubscription', label: 'Requires subscription', tag: 'SUB', play: false,
      reason: plans.length
        ? `Your plan does not include this title. Xbox lists it with ${plans.join(' / ')}.`
        : 'Your plan does not include this title, and it is not offered with ads.',
    };
  }
  // Nothing in Microsoft's payload named a plan and the title is not free: let
  // Xbox answer at launch rather than inventing a requirement.
  return {
    state: 'unknown', label: 'Play', tag: null, play: true,
    reason: 'Xbox will confirm access when the game starts.',
  };
}

/** Account state straight out of the persisted settings. */
export function accountFromSettings(get) {
  return {
    signedIn: get('account.signedIn', false) === true,
    gamertag: get('account.gamertag', '') || '',
    plan: get('account.plan', 'auto') || 'auto',
    planSource: get('account.planSource', '') || '',
  };
}