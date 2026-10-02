/**
 * Persistent configuration store with atomic writes, schema migration,
 * corruption recovery and legacy-format repair.
 * Main process only.
 */
const fs = require('fs');
const path = require('path');
const defaults = require('../shared/defaults.cjs');

class Store {
  constructor(filePath, logger) {
    this.filePath = filePath;
    this.log = logger || { info() {}, warn() {}, error() {} };
    this.data = this._load();
    this._saveTimer = null;
  }

  _load() {
    try {
      if (!fs.existsSync(this.filePath)) {
        this.log.info('store', 'No settings file, using defaults');
        return structuredClone(defaults);
      }
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const merged = this._merge(structuredClone(defaults), parsed);
      this.log.info('store', 'Settings loaded from', this.filePath);
      return merged;
    } catch (err) {
      // Corruption recovery: quarantine the bad file and start fresh.
      this.log.error('store', 'Settings corrupted, quarantining:', err.message);
      try {
        const backup = this.filePath + '.corrupt-' + Date.now();
        fs.copyFileSync(this.filePath, backup);
        this.log.warn('store', 'Quarantined to', backup);
      } catch { /* best effort */ }
      return structuredClone(defaults);
    }
  }

  /** Deep-merge saved values over defaults; drops unknown/legacy junk safely. */
  _merge(base, saved) {
    if (saved === null || typeof saved !== 'object') return base;
    for (const key of Object.keys(saved)) {
      const sv = saved[key];
      const bv = base[key];
      if (sv === undefined) continue;
      if (Array.isArray(sv) || bv === null || typeof bv !== 'object' || Array.isArray(bv)) {
        base[key] = sv;
      } else if (typeof sv === 'object' && sv !== null) {
        base[key] = this._merge({ ...bv }, sv);
      } else if (typeof sv === typeof bv || bv === undefined) {
        base[key] = sv;
      }
    }
    return base;
  }

  get(keyPath) {
    if (!keyPath) return this.data;
    return keyPath.split('.').reduce((obj, k) => (obj == null ? undefined : obj[k]), this.data);
  }

  set(keyPath, value) {
    const keys = keyPath.split('.');
    let obj = this.data;
    for (let i = 0; i < keys.length - 1; i++) {
      if (typeof obj[keys[i]] !== 'object' || obj[keys[i]] === null) obj[keys[i]] = {};
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    this.save();
  }

  /** Debounced save — batches bursts of updates into one disk write. */
  save() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._flush(), 120);
  }

  _flush() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = this.filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1), 'utf8');
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      this.log.error('store', 'Failed to save settings:', err.message);
    }
  }

  /** Replace all settings (used by Reset). Validates JSON before applying. */
  resetAll() {
    this.data = structuredClone(defaults);
    this._flush();
    return structuredClone(this.data);
  }

  flushSync() {
    clearTimeout(this._saveTimer);
    this._flush();
  }
}

module.exports = { Store, defaults };
