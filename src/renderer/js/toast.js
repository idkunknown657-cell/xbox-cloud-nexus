/**
 * Toast notifications — transient, non-blocking, auto-dismissing.
 * Quiet by design: a short slide-in, then gone.
 */
import { h, $ } from './dom.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { settings } from './store.js';

const KIND_ICON = { ok: 'check', info: 'info', warn: 'alert', err: 'alert' };

let container = null;
const live = new Set();

function root() {
  if (!container || !container.isConnected) container = $('#toasts');
  return container;
}

/**
 * Show a toast.
 * @param {string} title
 * @param {string} [msg]
 * @param {'ok'|'info'|'warn'|'err'} [kind]
 * @param {{timeout?:number, silent?:boolean}} [opts]
 */
export function toast(title, msg = '', kind = 'info', opts = {}) {
  // Notifications respect the audio.notifications preference; toasts themselves
  // are always shown unless explicitly silenced for routine events.
  if (opts.silent && settings.get('audio.notifications') === false) return null;

  const host = root();
  if (!host) return null;

  const el = h(`div.toast.${kind}`, [
    icon(KIND_ICON[kind] || 'info', { cls: 't-icon' }),
    h('div.grow', [
      h('div.t-title', title),
      msg ? h('div.t-msg', msg) : null,
    ]),
    h('button.iconbtn', { title: t('cancel'), onclick: () => dismiss(el) }, icon('x', { size: 15 })),
  ]);

  host.appendChild(el);
  live.add(el);

  // Cap the stack so a burst of errors can't cover the screen.
  while (live.size > 4) dismiss([...live][0]);

  const timeout = opts.timeout ?? (kind === 'err' ? 9000 : 4200);
  const timer = setTimeout(() => dismiss(el), timeout);
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  return el;
}

export function dismiss(el) {
  if (!el || !live.has(el)) return;
  live.delete(el);
  el.classList.add('leaving');
  setTimeout(() => el.remove(), 220);
}

export const toastOk = (title, msg) => toast(title, msg, 'ok');
export const toastInfo = (title, msg) => toast(title, msg, 'info');
export const toastWarn = (title, msg) => toast(title, msg, 'warn');
export const toastError = (title, msg) => toast(title, msg, 'err');

/** Convenience: normalise an Error into a user-facing toast. */
export function toastErr(err, fallback = '') {
  const msg = err instanceof Error ? err.message : String(err || '');
  toast(fallback || t('error'), msg, 'err');
}