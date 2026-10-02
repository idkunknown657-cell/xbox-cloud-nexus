/**
 * Tiny DOM toolkit. No framework: the launcher must stay fast on low-end PCs,
 * so we build nodes directly and only touch the DOM when something changes.
 */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Tags h() recognises as the leading segment of its shorthand. */
const HTML_TAGS = new Set([
  'a', 'abbr', 'b', 'br', 'button', 'canvas', 'code', 'dd', 'div', 'dl', 'dt', 'em', 'fieldset',
  'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'i', 'img', 'input',
  'kbd', 'label', 'li', 'main', 'nav', 'ol', 'option', 'p', 'pre', 'section', 'select', 'small',
  'span', 'strong', 'table', 'tbody', 'td', 'textarea', 'th', 'thead', 'tr', 'ul',
]);

/**
 * Create an element.
 * h('div.card', { onclick }, [child, 'text'])  — or any number of children:
 * h('button', { onclick }, icon('play'), 'Play')
 * Tag supports `tag.class.class#id` shorthand. A shorthand with no leading tag
 * (h('btn.primary')) yields a div carrying those classes.
 */
export function h(spec, props = null, ...children) {
  // Allow h(spec, child, ...) with no props object.
  if (props != null && (Array.isArray(props) || typeof props !== 'object' || props instanceof Node)) {
    children.unshift(props);
    props = null;
  }
  // Parse "tag#id.class.class" — a missing/unknown leading tag falls back to div.
  let tag = 'div';
  let rest = String(spec);
  const first = rest.split('.')[0];
  if (HTML_TAGS.has(first.toLowerCase())) {
    tag = first.toLowerCase();
    rest = rest.slice(first.length + 1);
  }
  let id = '';
  const classes = [];
  for (const segment of rest.split('.')) {
    if (!segment) continue;
    if (segment.includes('#')) {
      const [cls, elId] = segment.split('#');
      if (cls) classes.push(cls);
      if (elId) id = elId;
    } else {
      classes.push(segment);
    }
  }
  const el = document.createElement(tag);
  if (id) el.id = id;
  if (classes.length) el.className = classes.join(' ');

  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class' || k === 'className') {
        el.className = el.className ? `${el.className} ${v}` : String(v);
      } else if (k === 'style' && typeof v === 'object') {
        Object.assign(el.style, v);
      } else if (k === 'dataset') {
        for (const [dk, dv] of Object.entries(v)) { if (dv != null) el.dataset[dk] = dv; }
      } else if (k === 'html') {
        el.innerHTML = v;
      } else if (k === 'text') {
        el.textContent = v;
      } else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k in el && k !== 'list' && k !== 'form' && k !== 'type') {
        try { el[k] = v; } catch { el.setAttribute(k, v); }
      } else {
        el.setAttribute(k, v === true ? '' : v);
      }
    }
  }
  append(el, children);
  return el;
}

export function append(parent, children) {
  if (children == null || children === false) return parent;
  if (Array.isArray(children)) {
    for (const c of children) append(parent, c);
    return parent;
  }
  parent.appendChild(children instanceof Node ? children : document.createTextNode(String(children)));
  return parent;
}

export function clear(node) {
  while (node && node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function replace(node, ...children) {
  clear(node);
  append(node, children);
  return node;
}

export function on(el, ev, fn, opts) {
  el.addEventListener(ev, fn, opts);
  return () => el.removeEventListener(ev, fn, opts);
}

export function delegate(root, selector, ev, fn) {
  const handler = (e) => {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) fn(e, target);
  };
  root.addEventListener(ev, handler);
  return () => root.removeEventListener(ev, handler);
}

/** Trailing-edge debounce. */
export function debounce(fn, ms = 180) {
  let t = null;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => { t = null; fn(...args); }, ms);
  };
  wrapped.cancel = () => { clearTimeout(t); t = null; };
  wrapped.flush = (...args) => { if (t) { clearTimeout(t); t = null; fn(...args); } };
  return wrapped;
}

/** rAF-throttled callback (used for scroll/resize work). */
export function raf(fn) {
  let queued = false;
  return (...args) => {
    if (queued) return;
    queued = true;
    let done = false;
    const run = () => { if (done) return; done = true; queued = false; fn(...args); };
    requestAnimationFrame(run);
    // Fully hidden / occluded windows stop firing rAF, so keep a timer escape
    // hatch: UI logic must never depend on the compositor running.
    setTimeout(run, 32);
  };
}

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function fmtRelative(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 0) return '';
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function initials(text) {
  return String(text || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

/** Copy text using the async clipboard with a selection fallback. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

/** Deterministic pseudo-random ordering so the catalog looks stable between boots. */
export function stableShuffle(arr, seed = 1337) {
  const a = arr.slice();
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) % 4294967296;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}