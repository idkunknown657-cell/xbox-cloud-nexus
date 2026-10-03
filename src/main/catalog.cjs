/**
 * Cloud catalog service — main process.
 *
 * Data sources (all official/public, unauthenticated):
 *  - catalog.gamepass.com/sigls/v2 : curated product-ID lists used by xbox.com/play
 *  - displaycatalog.mp.microsoft.com : public product metadata (title, art, genres)
 *
 * We only read public metadata. No auth, DRM or access controls are touched.
 * Everything is cached to disk with a TTL so launches are instant and we make
 * no more traffic than one lightweight request per list per TTL window.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { readProductAccess } = require('./entitlements.cjs');

const LIST_IDS = {
  all: 'af206485-e87d-4624-9007-cb7f6d0cc42e',
  popular: '6a589fa0-d493-472b-8e20-3813699d7056',
  freeWithAds: '51f14e5d-bdcb-4e04-b9cb-76e5057702df',
  freeToPlay: 'd8f4afcd-882a-49e3-86b3-f61fa0172b75',
  playWithMkb: '3aa7a358-f15b-476b-af7e-134a250c08a0',
  recentlyAdded: '06323672-b8c8-43cc-b0de-32d5a9834749',
  leavingSoon: '31ff2361-2772-4622-849b-f4f1abb4ad1b',
  freePlayDays: '32d63c6c-c555-4baf-af74-61a99b64a3b9',
  eaPlay: 'e8e34eab-2bdb-4680-8fb8-28ce7a507bce',
  ubisoftPlus: '66ec875c-a391-44f5-9a54-a28bd6f976ce',
  family: 'c51f789c-cc6c-4f31-b9ed-0cc97b04d455',
  genres: {
    'action-adventure': 'f913b4be-6ca1-44ac-946a-1a481602595c',
    'role-playing': '455e5b52-9454-41ad-a00a-9f2d5e9d6549',
    shooter: '725d2704-860d-4bdf-a827-ac93dc729a96',
    strategy: '67aaebe2-6215-4258-aeab-2c837bc7e34c',
    simulation: 'cd6e5cbb-9f14-4d0d-bb38-a4b22b10f403',
    fighting: 'd34a6cdb-e678-4193-89a1-0dc86360cfa7',
    indie: '36f22fa5-3d2e-4b1d-818f-4308ab0ffa2e',
  },
};

const TTL = {
  lists: 30 * 60 * 1000,      // 30 min for curated lists
  details: 24 * 60 * 60 * 1000, // 24 h for product details
};

// Cold-start budget. The hero and the small rails need ~260 products; the full
// Game Pass catalogue is ~900; the bundled lists repeat most of it.
const POPULAR_CAP = 120;
const MAX_DETAILS = 1200;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 xCloudNexus/1.0';

/**
 * Store images come back protocol-relative ("//host/path"). The launcher UI is
 * served from a custom nexus:// origin, where those would never resolve, so we
 * pin them to https here.
 */
function absolutize(url) {
  if (!url || typeof url !== 'string') return null;
  const u = url.trim();
  if (!u) return null;
  if (u.startsWith('//')) return `https:${u}`;
  if (/^https?:\/\//i.test(u)) return u;
  return null;
}

class Catalog {
  constructor(cacheDir, logger) {
    this.cacheDir = cacheDir;
    this.log = logger;
    fs.mkdirSync(cacheDir, { recursive: true });
    this._inflight = new Map();
  }

  _cachePath(name) { return path.join(this.cacheDir, name + '.json'); }

  _readCache(name, ttl) {
    try {
      const p = this._cachePath(name);
      if (!fs.existsSync(p)) return null;
      const stat = fs.statSync(p);
      if (Date.now() - stat.mtimeMs > ttl) return null;
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch { return null; }
  }

  _writeCache(name, data) {
    try {
      const tmp = this._cachePath(name) + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, this._cachePath(name));
    } catch (err) { this.log?.warn('catalog', 'cache write failed', err.message); }
  }

  /** Fetch JSON with timeout, bounded concurrency and one retry per attempt. */
  _fetchJson(url, attempt = 0) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, {
        headers: { 'User-Agent': UA, 'Accept': 'application/json', Connection: 'keep-alive' },
        timeout: 15000,
      }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          const e = new Error(`HTTP ${res.statusCode} for ${url.split('?')[0]}`);
          e.retryable = res.statusCode === 429 || res.statusCode >= 500;
          return reject(e);
        }
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { raw += c; if (raw.length > 30e6) req.destroy(new Error('response too large')); });
        res.on('end', () => {
          try { resolve(JSON.parse(raw)); } catch { reject(new Error('Bad JSON from ' + url.split('?')[0])); }
        });
      });
      req.on('timeout', () => {
        const e = new Error('timeout');
        e.retryable = true;
        req.destroy(e);
      });
      req.on('error', (err) => {
        // Socket-level failures are transient; one delayed retry is enough.
        if (attempt < 1 && (err.retryable || /hang up|ECONNRESET|ETIMEDOUT|ECONNREFUSED/.test(err.code || err.message))) {
          setTimeout(() => this._fetchJson(url, attempt + 1).then(resolve, reject), 400 * (attempt + 1));
          return;
        }
        reject(err);
      });
    });
  }

  async _cached(name, ttl, loader) {
    const hit = this._readCache(name, ttl);
    if (hit) return hit;
    if (this._inflight.has(name)) return this._inflight.get(name);
    const p = (async () => {
      try {
        const data = await loader();
        this._writeCache(name, data);
        return data;
      } catch (err) {
        // Stale cache beats a network failure for browsing UX.
        try {
          const stale = JSON.parse(fs.readFileSync(this._cachePath(name), 'utf8'));
          this.log?.warn('catalog', name, 'using stale cache after error:', err.message);
          return stale;
        } catch {
          throw err;
        }
      } finally {
        this._inflight.delete(name);
      }
    })();
    this._inflight.set(name, p);
    return p;
  }

  /** Fetch a curated list; returns { title, ids } or null if unavailable. */
  async getList(listKey, market = 'US', language = 'en-US') {
    // Accept "genres.shooter" as well as the bare list keys.
    const id = LIST_IDS[listKey] || (typeof listKey === 'string' && listKey.startsWith('genres.')
      ? LIST_IDS.genres[listKey.slice(7)] : null) || listKey;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const url = `https://catalog.gamepass.com/sigls/v2?id=${id}&language=${language}&market=${market}`;
    return this._cached(`list-${id}-${language}-${market}`, TTL.lists, async () => {
      const arr = await this._fetchJson(url);
      if (!Array.isArray(arr) || !arr.length) throw new Error('empty list');
      return { title: arr[0].title || listKey, ids: arr.slice(1).map((x) => x.id).filter(Boolean) };
    }).catch(() => null);
  }

  /** Batch product details. Returns Map productId -> summary. */
  async getDetails(ids, market = 'US', language = 'en-us', onChunk) {
    const out = new Map();
    const missing = [];
    for (const id of ids) {
      const c = this._readCache(`p-${id}-${language}-${market}`, TTL.details);
      if (c) out.set(id, c); else missing.push(id);
    }
    // Batch in chunks of 25 (keeps URLs sane and requests modest)
    const chunks = [];
    for (let i = 0; i < missing.length; i += 25) chunks.push(missing.slice(i, i + 25));
    // Sequential with small concurrency: the endpoint throttles hard on
    // parallel bursts, which is worse for a cold start than a few extra seconds.
    const CONCURRENCY = 3;
    let cursor = 0;
    const worker = async () => {
      while (cursor < chunks.length) {
        const ci = cursor++;
        const batch = new Map();
        await this._loadChunk(chunks[ci], ci, market, language, batch);
        for (const [id, p] of batch) out.set(id, p);
        // Progressive delivery: the UI can show real games while we keep going.
        if (onChunk && batch.size) onChunk(batch);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));
    return out;
  }

  /** Load one batch of product details into `out` (and the per-product cache). */
  async _loadChunk(chunk, ci, market, language, out) {
    const url = `https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${chunk.join(',')}&market=${market}&languages=${language},neutral&MS-CV=DJ1.0`;
    try {
      const j = await this._fetchJson(url);
      for (const P of j.Products || []) {
        try {
          const p = P.Product || P;
          const lp = (p.LocalizedProperties || [])[0] || {};
          // Keep the widest image per type; ImageType is absent on some payloads.
          const images = {};
          for (const img of lp.Images || []) {
            const type = img.ImageType || 'Other';
            if (!images[type] || (img.Width || 0) > (images[type].width || 0)) {
              images[type] = { uri: img.Uri, width: img.Width || 0, height: img.Height || 0 };
            }
          }
          const pick = (...types) => {
            for (const type of types) { if (images[type] && images[type].uri) return absolutize(images[type].uri); }
            return null;
          };
          // Never leave a game without artwork when the payload omits ImageType.
          const anyImage = absolutize((Object.values(images).find((i) => i && i.uri) || {}).uri);
          const props = p.Properties || {};
          const category = props.Category;
          const summary = {
            id: p.ProductId,
            title: lp.ProductTitle || 'Unknown',
            short: lp.ShortDescription || '',
            long: lp.DetailedDescription || '',
            developer: lp.DeveloperName || '',
            publisher: lp.PublisherName || '',
            // Entitlement facts for this market, straight from Microsoft's payload.
            // The UI combines these with the account's plan to decide what it may
            // honestly offer (see main/entitlements.cjs).
            access: readProductAccess(P),
            art: {
              portrait: pick('BoxArt', 'Poster', 'Portrait') || anyImage,
              tile: pick('SuperHero', 'Hero', 'Logo') || anyImage,
              hero: pick('Hero', 'SuperHero', 'Screenshot') || anyImage,
              logo: pick('Logo', 'BrandLogo'),
              screenshot: pick('Screenshot', 'BrandedScreenshot'),
            },
            genres: Array.isArray(category) ? category : (category ? [category] : []),
            capabilities: (props.Capabilities || []).map((c) => c.CapabilityId || c),
            lastModified: P.LastModifiedDate || null,
            rating: (() => {
              try {
                const mp = (p.MarketProperties || [])[0] || {};
                const r = ((mp.Ratings || [])[0] || {}).RatingInfo || null;
                return r ? { system: r.RatingSystem, value: r.RatingValue, descriptors: (r.RatingDescriptors || []).map((d) => d.Value || d) } : null;
              } catch { return null; }
            })(),
          };
          out.set(summary.id, summary);
          this._writeCache(`p-${summary.id}-${language}-${market}`, summary);
        } catch { /* skip malformed product */ }
      }
    } catch (err) {
      if (this.log) this.log.warn('catalog', `detail chunk ${ci} failed:`, err.message);
    }
  }/**
   * Curated lists + every product detail we already hold.
   *
   * Returns as soon as the (small) list requests land, with `missing` saying
   * which product records still need downloading in the background. Waiting for
   * every product before answering left the home screen empty for a minute on a
   * cold cache; now the launcher paints immediately and fills in.
   *
   * The download order is deliberate: the rails the user sees first (ad-supported
   * titles, new arrivals, the popular pick used by the hero) come before the rest
   * of the catalogue, and the whole fetch is bounded — the full `popular` list
   * alone is ~3.6k products, which is far more traffic than browsing deserves.
   */
  async getLibrary(market, language) {
    const keys = ['all', 'popular', 'freeWithAds', 'freeToPlay', 'playWithMkb', 'recentlyAdded', 'leavingSoon', 'freePlayDays', 'eaPlay', 'ubisoftPlus', 'family', ...Object.keys(LIST_IDS.genres)];
    const results = await Promise.all(keys.map((k) => this.getList(k, market, language)));
    const lists = {};
    keys.forEach((k, i) => { lists[k] = results[i]; });

    const order = [];
    const seen = new Set();
    const add = (id) => { if (id && !seen.has(id)) { seen.add(id); order.push(id); } };
    for (const id of lists.freeWithAds?.ids || []) add(id);       // flagship rail + badges
    for (const id of lists.recentlyAdded?.ids || []) add(id);
    for (const id of (lists.popular?.ids || []).slice(0, POPULAR_CAP)) add(id); // hero pool
    for (const id of lists.all?.ids || []) add(id);               // the catalogue
    for (const k of ['leavingSoon', 'playWithMkb', 'freeToPlay', 'family']) {
      for (const id of lists[k]?.ids || []) add(id);
    }
    const wanted = order.slice(0, MAX_DETAILS);

    const cached = {};
    const missing = [];
    for (const id of wanted) {
      const c = this._readCache(`p-${id}-${language}-${market}`, TTL.details);
      if (c) cached[id] = c; else missing.push(id);
    }
    return { lists, details: cached, missing, fetchedAt: Date.now() };
  }

  /** Background half of {@link getLibrary}: fetch what is missing, chunk by chunk. */
  fetchMissing(ids, market, language, onChunk) {
    return this.getDetails(ids, market, language, onChunk);
  }

  /** Details for a single product (game details page). */
  async getProduct(id, market, language) {
    const map = await this.getDetails([id], market, language);
    return map.get(id) || null;
  }
}

module.exports = { Catalog, LIST_IDS };
