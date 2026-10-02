/**
 * Inline SVG icon set — no icon font, no network requests, no binary assets.
 * All icons share a 24x24 viewBox and inherit `currentColor`.
 */

const P = {
  home: '<path d="M3.5 11 12 4l8.5 7"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 .4-8A6 6 0 0 0 6 11a3.5 3.5 0 0 0 1 7Z"/>',
  cloudPlay: '<path d="M7 17h10a4 4 0 0 0 .4-8A6 6 0 0 0 6 10a3.5 3.5 0 0 0 1 7Z"/><path d="M10.5 11.5v4l3.5-2z"/>',
  library: '<rect x="3.5" y="4.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="4.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="14.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="14.5" width="7" height="7" rx="1.5"/>',
  ads: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M8 9.5v5l4.5-2.5z"/><path d="M14.5 9.5v5M17.5 10v4"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
  heart: '<path d="M12 20s-7.5-4.4-7.5-9.4A4.1 4.1 0 0 1 12 8a4.1 4.1 0 0 1 7.5 2.6c0 5-7.5 9.4-7.5 9.4Z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 14a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V20a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 18.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.6-4.6"/>',
  play: '<path d="M8 5.5v13l11-6.5z"/>',
  pause: '<path d="M9 5.5v13M15 5.5v13"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5.5"/><circle cx="12" cy="16.2" r="1" fill="currentColor" stroke="none"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r="1" fill="currentColor" stroke="none"/>',
  chevronRight: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
  chevronLeft: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  chevronDown: '<path d="m5.5 9.5 6.5 6.5 6.5-6.5"/>',
  arrowUpRight: '<path d="M8 16 16 8M9.5 8H16v6.5"/>',
  dots: '<circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  grid: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/>',
  rows: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  controller: '<path d="M7.5 8h9a4 4 0 0 1 4 4v1.5a2.8 2.8 0 0 1-5.2 1.4L13.6 12h-3.2l-1.7 2.9A2.8 2.8 0 0 1 3.5 13.5V12a4 4 0 0 1 4-4Z"/><path d="M7 11v3M5.5 12.5h3M16.2 11.6h.01M18.6 13.2h.01"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 9.5h.01M10 9.5h.01M13.5 9.5h.01M17 9.5h.01M6.5 12.5h.01M10 12.5h.01M13.5 12.5h.01M17 12.5h.01M8.5 15.5h7"/>',
  mouse: '<rect x="7" y="3" width="10" height="18" rx="5"/><path d="M12 7v3"/>',
  gamepad: '<path d="M7.5 8h9a4 4 0 0 1 4 4v1.5a2.8 2.8 0 0 1-5.2 1.4L13.6 12h-3.2l-1.7 2.9A2.8 2.8 0 0 1 3.5 13.5V12a4 4 0 0 1 4-4Z"/><path d="M8 10.5v4M6 12.5h4"/>',
  palette: '<path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.4 0 2-.9 2-1.8 0-1.4-1.1-1.7-1.1-2.7 0-.8.7-1.4 1.6-1.4H16a4.6 4.6 0 0 0 4.5-4.6C20.5 6.4 16.7 3.5 12 3.5Z"/><circle cx="8" cy="10" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="7.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="16" cy="10" r="1.2" fill="currentColor" stroke="none"/>',
  sparkle: '<path d="M12 3.5 13.8 9 19 10.8 13.8 12.6 12 18 10.2 12.6 5 10.8 10.2 9Z"/><path d="M18.5 16.5 19.2 18.6 21.3 19.3 19.2 20 18.5 22 17.8 20 15.7 19.3 17.8 18.6Z"/>',
  gauge: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="m12 13 4-3"/><circle cx="12" cy="17" r="1.2" fill="currentColor" stroke="none"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.2 2.3 3.3 5.3 3.3 8.5S14.2 18.2 12 20.5c-2.2-2.3-3.3-5.3-3.3-8.5S9.8 5.8 12 3.5Z"/>',
  speaker: '<path d="M5 9.5h3.5L13 5.5v13L8.5 14.5H5Z"/><path d="M16 9.5a4 4 0 0 1 0 5M18.5 7a7.5 7.5 0 0 1 0 10"/>',
  bell: '<path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4 1.5 5.5 1.5 5.5H5S6.5 14 6.5 10Z"/><path d="M10 19a2.2 2.2 0 0 0 4 0"/>',
  download: '<path d="M12 4v10M8 10.5l4 4 4-4M5 19h14"/>',
  upload: '<path d="M12 20V10M8 13.5l4-4 4 4M5 5h14"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/>',
  trash: '<path d="M4.5 7h15M9.5 7V5h5v2M6.5 7l1 12.5h9l1-12.5"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
  edit: '<path d="M4.5 19.5h4l10-10a2.1 2.1 0 0 0-3-3l-10 10Z"/><path d="m14 6 4 4"/>',
  external: '<path d="M14 4.5h5.5V10"/><path d="M19.5 4.5 11 13"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  eye: '<path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.6"/>',
  eyeOff: '<path d="M4 4l16 16"/><path d="M9.5 9.6A2.6 2.6 0 0 0 12 14.6c.7 0 1.3-.3 1.8-.7"/><path d="M6.4 7.2C4 8.9 2.5 12 2.5 12s3.5 6 9.5 6c1.6 0 3-.4 4.2-1M17.6 15c2.2-1.6 3.9-3 3.9-3S18 6 12 6c-.6 0-1.2.1-1.7.2"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  logout: '<path d="M14 7V5.5A1.5 1.5 0 0 0 12.5 4h-6A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20h6a1.5 1.5 0 0 0 1.5-1.5V17"/><path d="M10 12h10M17 9l3 3-3 3"/>',
  shield: '<path d="M12 3.5 19 6v6c0 4-3 7-7 8.5C8 19 5 16 5 12V6Z"/><path d="m9 12 2 2 4-4"/>',
  cpu: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 4v3M14 4v3M10 17v3M14 17v3M4 10h3M4 14h3M17 10h3M17 14h3"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  sort: '<path d="M7 5v14M4 8l3-3 3 3M17 19V5M14 16l3 3 3-3"/>',
  star: '<path d="m12 4 2.4 5 5.6.8-4 3.9 1 5.5-5-2.7-5 2.7 1-5.5-4-3.9 5.6-.8Z"/>',
  window: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M3.5 9.5h17"/>',
  fullscreen: '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>',
  dot: '<circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/>',
  bug: '<path d="M8.5 8.5a3.5 3.5 0 0 1 7 0v4a3.5 3.5 0 0 1-7 0Z"/><path d="M6 11H3.5M6 14.5H4M18 11h2.5M18 14.5H20M8 8 6 5.5M16 8l2-2.5M12 5V3"/>',
  plug: '<path d="M9 3v5M15 3v5"/><path d="M6.5 8h11v3a5.5 5.5 0 0 1-11 0Z"/><path d="M12 16.5V21"/>',
  link: '<path d="M10 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1.2 1.2"/><path d="M14 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1.2-1.2"/>',
  key: '<circle cx="8" cy="14" r="3.5"/><path d="M10.5 11.5 19 3M16 6l2 2M14 8l2 2"/>',
  wand: '<path d="M4 20 15 9"/><path d="M17 3.5 17.8 6 20 6.8 17.8 7.6 17 10 16.2 7.6 14 6.8 16.2 6Z"/><path d="M8 4 8.6 6 10.5 6.6 8.6 7.2 8 9 7.4 7.2 5.5 6.6 7.4 6Z"/>',
  layers: '<path d="m12 3.5 8.5 4.5L12 12.5 3.5 8Z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5M3.5 16.5 12 21l8.5-4.5"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4.5V10H9"/><path d="M12 8v4.5l3 1.8"/>',
};

/** Icons that read better filled than stroked. */
const FILLED = new Set(['play', 'heart', 'star', 'dot', 'pause', 'keyboard', 'mouse']);

/**
 * Build an inline SVG element.
 * @param {string} name key from the set
 * @param {{size?:number, cls?:string, fill?:boolean, stroke?:number, title?:string}} [opts]
 */
export function icon(name, opts = {}) {
  const body = P[name];
  if (!body) return document.createTextNode('');
  const filled = opts.fill != null ? opts.fill : FILLED.has(name);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (opts.size) { svg.setAttribute('width', opts.size); svg.setAttribute('height', opts.size); }
  if (opts.cls) svg.setAttribute('class', opts.cls);
  if (opts.title) {
    svg.setAttribute('role', 'img');
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    t.textContent = opts.title;
    svg.appendChild(t);
  }
  svg.setAttribute('fill', filled ? 'currentColor' : 'none');
  svg.setAttribute('stroke', filled ? 'none' : 'currentColor');
  svg.setAttribute('stroke-width', String(opts.stroke || 1.7));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = body;
  return svg;
}

/** Same as icon() but returns a markup string (for innerHTML use). */
export function iconHtml(name, opts = {}) {
  const body = P[name] || '';
  const filled = opts.fill != null ? opts.fill : FILLED.has(name);
  const size = opts.size ? ` width="${opts.size}" height="${opts.size}"` : '';
  const cls = opts.cls ? ` class="${opts.cls}"` : '';
  return `<svg viewBox="0 0 24 24"${size}${cls} aria-hidden="true" fill="${filled ? 'currentColor' : 'none'}" stroke="${filled ? 'none' : 'currentColor'}" stroke-width="${opts.stroke || 1.7}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

export const iconNames = Object.keys(P);