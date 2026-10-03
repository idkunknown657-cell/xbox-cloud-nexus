/**
 * Entitlements — main-process half.
 *
 * Reads the entitlement facts Microsoft publishes for a title in the user's
 * market out of the display-catalog payload:
 *
 *   - `subscribed`      a subscription entitlement satisfies this title here
 *   - `free`            no price in this market (free-to-start / F2P)
 *   - `requiresPurchase` neither of the above — a store title the cloud player
 *                       cannot buy for you
 *   - `requiresText`    Microsoft's own wording about what is needed, passed
 *                       through untouched so the UI never paraphrases a
 *                       requirement it did not understand
 *
 * The *account's* plan is decided in the renderer (src/renderer/js/entitlements.js)
 * so there is a single implementation of the rules. Nothing here grants access;
 * Microsoft still decides every launch on the official play page.
 */

/** Normalised lower-case text, for keyword matching. */
const flat = (v) => String(v == null ? '' : v).toLowerCase();

/**
 * Read the entitlement facts out of one displaycatalog product payload.
 *
 * @param {object} product a `Products[]` entry from displaycatalog
 * @returns {{subscribed:boolean, free:boolean, price:number|null,
 *            requiresPurchase:boolean, actions:string[], requiresText:string}}
 */
function readProductAccess(product) {
  const p = (product && product.Product) || product || {};
  const out = {
    subscribed: false,
    free: true,
    price: null,
    requiresPurchase: false,
    actions: [],
    requiresText: '',
  };
  if (!p || typeof p !== 'object') return out;

  // 1. What Microsoft says is needed to play it, in this market's own words.
  const texts = [];
  for (const lp of p.LocalizedProperties || []) {
    for (const r of lp.EligibilityProperties?.Remediations || []) {
      if (r.Description) texts.push(String(r.Description));
    }
  }
  out.requiresText = texts.join(' · ').slice(0, 400);

  // 2. Which subscription entitlements satisfy it, here.
  for (const dsa of p.DisplaySkuAvailabilities || []) {
    for (const av of dsa.Availabilities || []) {
      for (const a of av.Actions || []) if (!out.actions.includes(a)) out.actions.push(a);
      for (const k of av.LicensingData?.SatisfyingEntitlementKeys || []) {
        const ents = k.EntitlementKeys || [];
        // "wes:App:<guid>:Full" is a subscription (Game Pass / EA / Ubisoft);
        // "big:<sku>:0017" style keys are the Game Pass benefit codes.
        if (ents.some((e) => /^wes:/i.test(e) || /:00(10|17|18)$/.test(e))) out.subscribed = true;
      }
    }
  }

  // 3. Price: nothing to pay in this market means it is free to start.
  for (const mp of p.MarketProperties || []) {
    for (const price of mp.Prices || []) {
      const v = Number(price.ListPrice ?? price.Msrp ?? 0);
      if (v > 0) out.price = Math.max(out.price || 0, v);
    }
  }
  out.free = !out.price;
  out.requiresPurchase = !out.subscribed && !out.free;
  return out;
}

module.exports = { readProductAccess, flat };