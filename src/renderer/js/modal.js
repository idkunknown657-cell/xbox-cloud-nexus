/**
 * Modal dialogs — confirmations, prompts and the details overlay shell.
 * Escape closes, focus is trapped, and the veil swallows background clicks.
 */
import { h, $, clear } from './dom.js';
import { icon } from './icons.js';
import { t } from './i18n.js';

let openCount = 0;

/**
 * Show a modal.
 * @param {{title?:string, body?:Node|string, actions?:Array<{label:string,kind?:string,value?:any,autofocus?:boolean}>,
 *          onMount?:(root:HTMLElement, close:(v:any)=>void)=>void, width?:number, dismissable?:boolean}} opts
 * @returns {Promise<any>} resolves with the chosen action value (or null when dismissed)
 */
export function openModal(opts = {}) {
  const overlays = $('#overlays');
  const dismissable = opts.dismissable !== false;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      openCount = Math.max(0, openCount - 1);
      document.removeEventListener('keydown', onKey, true);
      veil.remove();
      if (opts.onClose) opts.onClose(value);
      resolve(value);
    };

    const card = h('div.modal', { role: 'dialog', 'aria-modal': 'true', tabindex: '-1' });
    if (opts.width) card.style.width = `min(${opts.width}px, 92vw)`;

    if (opts.title) card.appendChild(h('h3', opts.title));
    const body = h('div.m-body');
    if (typeof opts.body === 'string') body.textContent = opts.body;
    else if (opts.body) body.appendChild(opts.body);
    card.appendChild(body);

    const actions = opts.actions || [{ label: t('cancel'), value: null }];
    const bar = h('div.m-actions');
    for (const a of actions) {
      const cls = `button.btn${a.kind ? '.' + a.kind : ''}${a.danger ? '.danger' : ''}`;
      bar.appendChild(h(cls, {
        onclick: () => { const v = 'value' in a ? a.value : a.label; if (a.onClick) a.onClick(v); finish(v); },
      }, a.label));
    }
    card.appendChild(bar);

    const veil = h('div.modal-veil', {
      onclick: (e) => { if (e.target === veil && dismissable) finish(null); },
    }, card);

    const onKey = (e) => {
      if (!veil.isConnected) return;
      if (e.key === 'Escape' && dismissable) { e.stopPropagation(); e.preventDefault(); finish(null); }
      if (e.key === 'Tab') {
        const f = Array.from(card.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])'));
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);

    overlays.appendChild(veil);
    openCount++;
    card.focus();
    const autofocus = card.querySelector('.btn.primary') || card.querySelector('button');
    if (autofocus) setTimeout(() => autofocus.focus(), 30);
    if (opts.onMount) opts.onMount(card, finish);
  });
}

/** Yes/no dialog. Resolves true only when the confirm action is chosen. */
export async function confirmDialog(opts = {}) {
  const value = await openModal({
    title: opts.title || t('confirm_title', {}) || 'Are you sure?',
    body: opts.message || '',
    actions: [
      { label: opts.cancelLabel || t('cancel'), value: false, kind: 'ghost' },
      { label: opts.confirmLabel || t('reset_confirm'), value: true, kind: opts.danger === false ? 'primary' : 'danger' },
    ],
    width: opts.width,
  });
  return value === true;
}

/** Single-line text prompt. Resolves the string, or null when cancelled. */
export async function promptDialog(opts = {}) {
  const input = h('input.textin', {
    type: 'text',
    value: opts.value || '',
    placeholder: opts.placeholder || '',
    maxlength: opts.maxlength || 64,
    spellcheck: false,
  });
  let value = null;
  const res = await openModal({
    title: opts.title || t('rename'),
    body: h('div', [opts.message ? h('p.muted.mb8', opts.message) : null, input]),
    actions: [
      { label: t('cancel'), value: false, kind: 'ghost' },
      { label: opts.confirmLabel || t('apply'), value: true, kind: 'primary' },
    ],
    width: opts.width || 420,
    onMount: () => { setTimeout(() => { input.focus(); input.select(); }, 40); },
    onClose: (v) => { if (v === true) value = input.value.trim(); },
  });
  return res === true ? value : null;
}

/**
 * Full-width overlay used for game details. Content is injected by the caller.
 * @returns {{root:HTMLElement, close:()=>void, setContent:(n:Node)=>void}}
 */
export function openOverlay(opts = {}) {
  const overlays = $('#overlays');
  const content = h('div.overlay-card');
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    veil.remove();
    if (opts.onClose) opts.onClose();
  };
  const onKey = (e) => {
    if (!veil.isConnected) return;
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); }
  };
  const veil = h('div.overlay-veil', {
    onclick: (e) => { if (e.target === veil && opts.dismissable !== false) close(); },
  }, content);
  document.addEventListener('keydown', onKey, true);
  overlays.appendChild(veil);
  content.focus();
  if (opts.onMount) opts.onMount(content, close);
  return { root: content, close, setContent: (n) => { clear(content); content.appendChild(n); } };
}

/** Simple informational dialog with a single dismiss button. */
export async function infoDialog(title, message) {
  return openModal({
    title,
    body: typeof message === 'string' ? h('div', message) : message,
    actions: [{ label: t('cancel'), value: true, kind: 'primary' }],
    width: 520,
  });
}

/** Prompt used by the recovery flow so users can reach the Reset dialogs. */
export function recoveryBanner(onReset) {
  return h('div.recovery-banner', [
    icon('alert', { size: 20 }),
    h('div.grow', [
      h('div.r-title', 'Configuration problem detected'),
      h('div.r-desc', 'Your settings file could not be read and was reset to defaults. A copy was kept for support.'),
    ]),
    h('button.btn.sm.primary', { onclick: onReset }, t('reset_settings')),
  ]);
}