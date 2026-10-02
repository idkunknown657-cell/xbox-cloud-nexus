/**
 * Application logger with sensitive-data scrubbing.
 * - Never writes tokens/authorization headers to disk or console.
 * - Keeps an in-memory ring buffer exportable from Settings > Debug.
 */
const ELECTRON = Symbol('electron');

class Logger {
  constructor(maxEntries = 800) {
    this.entries = [];
    this.maxEntries = maxEntries;
    this.debugEnabled = false;
    this.listeners = new Set();
  }

  enableDebug(on) {
    this.debugEnabled = !!on;
  }

  _scrub(args) {
    return args.map((a) => {
      if (typeof a === 'string') {
        return a
          // Bearer / authorization values
          .replace(/(authorization|auth|token|xtoken|x-xbl-[a-z]+|bearer)\s*[:=]\s*\S+/gi, '$1: [redacted]')
          // Long JWT-like blobs
          .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, '[redacted-jwt]')
          // Long hex/base64 secrets (32+ chars) in query strings
          .replace(/([?&](?:token|code|secret|sig)~=)[A-Za-z0-9_-]{24,}/gi, '$1[redacted]');
      }
      if (a && typeof a === 'object') {
        try {
          const s = JSON.stringify(a);
          return JSON.parse(this._scrub([s])[0]);
        } catch { return '[unserializable]'; }
      }
      return a;
    });
  }

  _push(level, tag, args) {
    const entry = {
      t: Date.now(),
      level,
      tag: String(tag),
      msg: this._scrub(args).map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '),
    };
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) this.entries.splice(0, this.entries.length - this.maxEntries);
    if (this.debugEnabled || level === 'error' || level === 'warn') {
      const line = `[${level.toUpperCase()}] [${tag}] ${entry.msg}`;
      if (level === 'error') console.error(line); else console.log(line);
    }
    for (const fn of this.listeners) { try { fn(entry); } catch { /* ignore */ } }
  }

  info(tag, ...args) { this._push('info', tag, args); }
  warn(tag, ...args) { this._push('warn', tag, args); }
  error(tag, ...args) { this._push('error', tag, args); }

  getLines() {
    return this.entries.map((e) => {
      const d = new Date(e.t).toISOString().slice(11, 19);
      return `${d} ${e.level.toUpperCase().padEnd(5)} [${e.tag}] ${e.msg}`;
    });
  }
}

module.exports = { Logger };
