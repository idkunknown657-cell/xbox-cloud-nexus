#!/usr/bin/env node
/**
 * Refresh the entitlement fixture from Microsoft's public catalogue feeds.
 *
 *   node scripts/capture-entitlements.cjs
 *
 * The fixture is a trimmed slice of real displaycatalog payloads (a handful of
 * titles from the Play-with-Ads, free-to-play and popular cloud lists). It lets
 * `npm run verify:entitlements` prove the access rules against real payloads
 * without hitting the network in CI.
 *
 * Both feeds are public and unauthenticated; nothing here touches an account.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const MARKET = process.env.NEXUS_MARKET || 'US';
const LANGUAGE = process.env.NEXUS_LANG || 'en-us';
const LISTS = {
  freeWithAds: '51f14e5d-bdcb-4e04-b9cb-76e5057702df',
  freeToPlay: 'd8f4afcd-882a-49e3-86b3-f61fa0172b75',
  popular: '6a589fa0-d493-472b-8e20-3813699d7056',
};
const out = path.join(__dirname, 'fixtures', 'entitlements.json');

const getJson = async (url) => {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
};

/** Keep only the parts the access rules actually read. */
const trim = (P) => ({
  ProductId: P.ProductId,
  LocalizedProperties: (P.LocalizedProperties || []).slice(0, 1).map((lp) => ({
    ProductTitle: lp.ProductTitle,
    EligibilityProperties: lp.EligibilityProperties,
  })),
  DisplaySkuAvailabilities: (P.DisplaySkuAvailabilities || []).slice(0, 1).map((d) => ({
    Availabilities: (d.Availabilities || []).slice(0, 6).map((a) => ({
      Actions: a.Actions,
      LicensingData: a.LicensingData,
    })),
  })),
  MarketProperties: (P.MarketProperties || []).slice(0, 1).map((m) => ({ Prices: m.Prices })),
});

(async () => {
  const groups = {};
  const ids = new Set();
  for (const [key, id] of Object.entries(LISTS)) {
    const arr = await getJson(`https://catalog.gamepass.com/sigls/v2?id=${id}&language=${LANGUAGE}&market=${MARKET}`);
    const list = arr.slice(1).map((x) => x.id).filter(Boolean);
    groups[key] = list.slice(0, 8);
    for (const x of groups[key]) ids.add(x);
  }

  const products = [];
  const all = [...ids];
  for (let i = 0; i < all.length; i += 25) {
    const chunk = all.slice(i, i + 25);
    const data = await getJson(
      `https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${chunk.join(',')}&market=${MARKET}&languages=${LANGUAGE},neutral&MS-CV=DJ1.0`,
    );
    for (const P of data.Products || []) products.push({ id: P.ProductId, payload: trim(P) });
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({
    capturedAt: new Date().toISOString(),
    market: MARKET,
    lists: groups,
    products,
  }, null, 1));

  console.log(`captured ${products.length} products from ${Object.keys(groups).length} lists -> ${path.relative(process.cwd(), out)}`);
  for (const g of Object.keys(groups)) {
    const sample = groups[g].slice(0, 3).map((id) => {
      const p = products.find((x) => x.id === id);
      return `${id}=${(p && p.payload.LocalizedProperties[0].ProductTitle) || '?'}`;
    });
    console.log(`  ${g}: ${sample.join(', ')}`);
  }
})().catch((err) => {
  console.error('capture failed:', err.message);
  process.exit(1);
});