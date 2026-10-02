/**
 * Animated UI kit.
 *
 * Native <select> cannot be styled or animated, which is what makes settings
 * menus feel stiff. These controls animate on compositor-friendly properties
 * only (opacity / transform), close on outside click and Escape, and are fully
 * keyboard navigable. Motion is driven by CSS classes so the global animation
 * mode (off / minimal / reduced / full) and Low-End Mode disable it rather than
 * merely shortening it.
 */
import { h, clear } from './dom.js';
import { icon } from './icons.js';

/** True when motion is suppressed entirely. */
function motionOff() {
  const b = document.body;
  return b.classList.contains('anim-off') || b.classList.contains('perf-noanim');
}

let openPopover = null;

/**
 * Animated dropdown.
 * @param {{options:Array<{value:any,label:string,sub?:string,disabled?:boolean,icon?:string}>,
 *          value:any, onPick:(v:any)=>void, label?:string, placeholder?:string,
 *          width?:number, align?:'left'|'right', className?:string}} opts
 */
export function dropdown(opts) {
  const { options = [], onPick, label, placeholder = 'Select…' } = opts;
  let value = opts.value;          // mutable: the pick updates it in place
  let open = false;
  let menu = null;

  const current = () => options.find((o) => o.value === value) || null;

  const text = h('span.dd-value', current()?.label || placeholder);
  if (current()?.sub) text.appendChild(h('span.dd-sub', current().sub));

  const chevron = h('span.dd-chevron', icon('chevronDown', { size: 15 }));
  const button = h('button.dd-trigger', {
    type: 'button',
    'aria-haspopup': 'listbox',
    'aria-expanded': 'false',
    'aria-label': label || '',
  }, [text, chevron]);

  const root = h(`div.dd${opts.className ? '.' + opts.className : ''}`, button);
  if (opts.width) root.style.width = `${opts.width}px`;

  function setOpen(next) {
    if (open === next) return;
    open = next;
    button.setAttribute('aria-expanded', String(open));
    if (open) {
      menu = buildMenu();
      document.body.appendChild(menu);
      position();
      // One frame so the opening transform actually animates.
      const reveal = () => menu && menu.classList.add('open');
      requestAnimationFrame(reveal);
      // Hidden/occluded windows stop firing rAF; never let that strand the menu.
      setTimeout(reveal, 32);
      if (openPopover) openPopover();
      openPopover = () => setOpen(false);
      document.addEventListener('pointerdown', outside, true);
      document.addEventListener('keydown', onKey, true);
      window.addEventListener('resize', position, { passive: true });
    } else {
      const m = menu;
      menu = null;
      openPopover = null;
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', position);
      if (m) {
        m.classList.remove('open');
        setTimeout(() => m.remove(), motionOff() ? 0 : 140);
      }
      button.focus({ preventScroll: true });
    }
  }

  function outside(e) {
    if (menu && !menu.contains(e.target) && !root.contains(e.target)) setOpen(false);
  }

  function onKey(e) {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); return; }
    const items = Array.from(menu.querySelectorAll('.dd-item:not(.disabled)'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      const cur = items.indexOf(document.activeElement);
      const next = items[Math.min(items.length - 1, Math.max(0, (cur < 0 ? -1 : cur) + dir))];
      next?.focus();
    } else if (e.key === 'Home') { e.preventDefault(); items[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); items[items.length - 1]?.focus(); }
    else if (e.key === 'Tab') { setOpen(false); }
  }

  function position() {
    if (!menu) return;
    const r = button.getBoundingClientRect();
    // Flip above the trigger when there is no room below.
    const spaceBelow = window.innerHeight - r.bottom;
    const below = spaceBelow > 180 || r.top < spaceBelow;
    const room = below ? spaceBelow - 12 : r.top - 12;
    menu.style.position = 'fixed';
    menu.style.minWidth = `${r.width}px`;
    menu.style.maxHeight = `${Math.max(120, Math.min(320, room))}px`;
    if (below) {
      menu.style.top = `${r.bottom + 6}px`;
      menu.style.left = `${r.left}px`;
      menu.style.transformOrigin = 'top center';
      menu.style.transform = '';
      menu.classList.remove('drop-up');
    } else {
      menu.style.top = `${r.top - 6}px`;
      menu.style.left = `${r.left}px`;
      menu.style.transformOrigin = 'bottom center';
      menu.style.transform = 'translateY(-100%)';
      menu.classList.add('drop-up');
    }
  }

  function buildMenu() {
    const list = h('div.dd-menu', { role: 'listbox' });
    if (!options.length) {
      list.appendChild(h('div.dd-empty', 'No options'));
      return list;
    }
    options.forEach((o) => {
      const selected = o.value === value;
      const item = h(`button.dd-item${selected ? '.selected' : ''}${o.disabled ? '.disabled' : ''}`, {
        type: 'button',
        role: 'option',
        'aria-selected': String(selected),
        tabindex: '-1',
        onclick: () => {
          if (o.disabled) return;
          value = o.value;
          clear(text);
          text.appendChild(document.createTextNode(o.label));
          if (o.sub) text.appendChild(h('span.dd-sub', o.sub));
          Array.from(list.querySelectorAll('.dd-item')).forEach((el) => {
            const on2 = el === item;
            el.classList.toggle('selected', on2);
            el.setAttribute('aria-selected', String(on2));
          });
          setOpen(false);
          onPick?.(o.value);
        },
      }, [
        o.icon ? h('span.dd-ico', icon(o.icon, { size: 15 })) : null,
        h('span.dd-label', o.label),
        o.sub ? h('span.dd-sub', o.sub) : null,
        selected ? h('span.dd-check', icon('check', { size: 14 })) : null,
      ].filter(Boolean));
      list.appendChild(item);
    });
    return list;
  }

  button.addEventListener('click', () => setOpen(!open));
  root.addEventListener('keydown', (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      setOpen(true);
    }
  });

  root.setValue = (v) => {
    value = v;
    const c = options.find((o) => o.value === v);
    clear(text);
    text.appendChild(document.createTextNode(c?.label || placeholder));
    if (c?.sub) text.appendChild(h('span.dd-sub', c.sub));
  };
  return root;
}

/**
 * Slider with a live numeric readout.
 * @param {{value:number,min:number,max:number,step:number,onInput:(v:number)=>void,
 *          format?:(v:number)=>string,label?:string,unit?:string}} opts
 */
export function slider(opts) {
  const { value, min, max, step, onInput, format, unit = '%' } = opts;
  const input = h('input.slider', {
    type: 'range', min, max, step, value,
    'aria-label': opts.label || '',
  });
  const out = h('span.slider-val', (format ? format(value) : String(value)) + unit);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = (format ? format(v) : String(v)) + unit;
    onInput?.(v);
  });
  const root = h('label.slider-row', [
    opts.label ? h('span.slider-label', opts.label) : null,
    input,
    out,
  ].filter(Boolean));
  root.setValue = (v) => { input.value = String(v); out.textContent = (format ? format(v) : String(v)) + unit; };
  return root;
}

/**
 * Toggle switch.
 * @param {{value:boolean,onChange:(v:boolean)=>void,label?:string}} opts
 */
export function toggle(opts) {
  const input = h('input', { type: 'checkbox', checked: !!opts.value });
  const root = h('label.switch', [input, h('span.track'), h('span.knob')]);
  input.addEventListener('change', () => opts.onChange?.(input.checked));
  root.setValue = (v) => { input.checked = !!v; };
  return root;
}

/** Segmented control (already CSS-animated). */
export function segmented(options, value, onPick) {
  const bar = h('div.seg', { role: 'tablist' });
  const render = () => {
    clear(bar);
    for (const o of options) {
      bar.appendChild(h(`button${o.value === value ? '.on' : ''}`, {
        type: 'button', role: 'tab', 'aria-selected': String(o.value === value),
        onclick: () => { value = o.value; render(); onPick?.(o.value); },
      }, o.label));
    }
  };
  render();
  bar.setValue = (v) => { value = v; render(); };
  return bar;
}