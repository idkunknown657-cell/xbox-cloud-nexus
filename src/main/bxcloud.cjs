/**
 * Better xCloud bridge — main side.
 * Loads the vendored MIT-licensed userscript from disk for injection into the
 * official xbox.com/play pages (document-start preload). Handles attribution
 * and version pinning.
 *
 * Better xCloud: Copyright (c) 2023 redphx — MIT License.
 * https://github.com/redphx/better-xcloud
 */
const fs = require('fs');
const path = require('path');

const BXCLOUD_VERSION = '6.7.12';
const BXCLOUD_SOURCE = 'https://github.com/redphx/better-xcloud';
const BXCLOUD_LICENSE = 'MIT';

let _cache = null;

function readBxScript(appRoot) {
  if (_cache) return _cache;
  const p = path.join(appRoot, 'vendor', 'better-xcloud', 'better-xcloud.user.js');
  try {
    const code = fs.readFileSync(p, 'utf8');
    const m = code.match(/@version\s+([0-9.]+)/);
    const version = m ? m[1] : BXCLOUD_VERSION;
    _cache = { code, version, source: BXCLOUD_SOURCE, license: BXCLOUD_LICENSE, bytes: code.length };
    return _cache;
  } catch (err) {
    return { code: null, version: null, source: BXCLOUD_SOURCE, license: BXCLOUD_LICENSE, error: err.message };
  }
}

module.exports = { readBxScript, BXCLOUD_VERSION, BXCLOUD_SOURCE, BXCLOUD_LICENSE };
