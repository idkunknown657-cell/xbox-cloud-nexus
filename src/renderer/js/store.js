/**
 * Renderer settings mirror — single source of truth in the UI.
 * Reads once at boot, then applies optimistic local updates and persists
 * through IPC. A tiny pub/sub keeps the UI in sync.
 */
class SettingsMirror {
  constructor() {
    this.data = null;
    this.listeners = new Set();
  }

  async load() {
    // Share one in-flight request so concurrent callers never race.
    if (!this._loading) {
      this._loading = window.nexus.settings.get()
        .then((d) => { this.data = d; return d; })
        .finally(() => { this._loading = null; });
    }
    return this._loading;
  }

  get(path, fallback) {
    if (!this.data) return fallback;
    const v = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), this.data);
    return v === undefined ? fallback : v;
  }

  /**
   * Update a path, notify subscribers, persist.
   * Safe to call before load() resolves (the first-run wizard does exactly
   * that): we await the in-flight load first, then apply.
   */
  async set(path, value) {
    if (!this.data) { try { await this.load(); } catch { /* keep defaults in main */ } }
    if (!this.data) this.data = {};
    const keys = path.split('.');
    let obj = this.data;
    for (let i = 0; i < keys.length - 1; i++) {
      if (typeof obj[keys[i]] !== 'object' || obj[keys[i]] === null) obj[keys[i]] = {};
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    this._emit(path);
    try {
      await window.nexus.settings.set(path, value);
    } catch (err) {
      // Surfaced by the caller's toast; never reject here.
      try { window.dispatchEvent(new CustomEvent('nexus:settings-error', { detail: err })); } catch { /* ignore */ }
    }
  }

  replaceAll(next) {
    this.data = next;
    this._emit('*');
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit(path) { for (const fn of this.listeners) { try { fn(path, this.data); } catch { /* ignore */ } } }
}

export const settings = new SettingsMirror();

/** Simple pub/sub event bus for app-wide signals. */
export const bus = new EventTarget();
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
export const on = (name, fn) => bus.addEventListener(name, (e) => fn(e.detail));
