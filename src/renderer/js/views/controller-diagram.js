/**
 * Xbox-style controller diagram.
 *
 * Layout is measured, never guessed: the drawn body is an inline SVG with a
 * known viewBox, and every hotspot is positioned by mapping viewBox coordinates
 * onto the SVG's real rendered rectangle. That keeps the buttons glued to the
 * artwork at any window size and stops the old class of bugs where a callout
 * hung off the edge or a face button sat on top of the D-pad.
 *
 * Remapping stays incremental: `paintOne(id, mapping)` touches two text nodes,
 * so changing a binding never rebuilds the diagram.
 *
 * Remappable inputs (25): face buttons, shoulders, triggers, View/Menu/Xbox,
 * both stick clicks, four D-pad directions, four left-stick directions and four
 * right-stick directions.
 */
import { h } from '../dom.js';
import { BUTTONS, buttonLabel, bindLabel, isMouseCode } from '../buttons.js';

const VB = { w: 400, h: 200 };        // SVG viewBox units
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Geometry in viewBox units — one source of truth for drawing and hotspots. */
const G = {
  ls: { x: 120, y: 74, r: 25 },
  rs: { x: 280, y: 74, r: 25 },
  dpad: { x: 160, y: 140, arm: 12 },
  face: {
    gamepadY: [268, 110], gamepadB: [296, 140], gamepadX: [240, 140], gamepadA: [268, 170],
  },
  guide: [224, 104],
  view: [178, 104],
  start: [272, 104],
  lt: [64, 62], lb: [44, 86], rt: [336, 62], rb: [356, 86],
};

/** Callouts live in side columns; `anchor` is the body point the leader points at. */
const CALLOUTS = [
  { id: 'gamepadLT', col: 'left', anchor: G.lt },
  { id: 'gamepadLB', col: 'left', anchor: G.lb },
  { id: 'gamepadSelect', col: 'left', anchor: G.view },
  { id: 'gamepadRT', col: 'right', anchor: G.rt },
  { id: 'gamepadRB', col: 'right', anchor: G.rb },
  { id: 'gamepadStart', col: 'right', anchor: G.start },
  { id: 'gamepadGuide', col: 'center', anchor: G.guide },
];

/** Direction chips around each stick and the D-pad. */
const AXES = [
  { id: 'gamepadLSU', at: [G.ls.x, G.ls.y - 30], dir: 'up' },
  { id: 'gamepadLSD', at: [G.ls.x, G.ls.y + 30], dir: 'down' },
  { id: 'gamepadLSL', at: [G.ls.x - 30, G.ls.y], dir: 'left' },
  { id: 'gamepadLSR', at: [G.ls.x + 30, G.ls.y], dir: 'right' },
  { id: 'gamepadRSU', at: [G.rs.x, G.rs.y - 30], dir: 'up' },
  { id: 'gamepadRSD', at: [G.rs.x, G.rs.y + 30], dir: 'down' },
  { id: 'gamepadRSL', at: [G.rs.x - 30, G.rs.y], dir: 'left' },
  { id: 'gamepadRSR', at: [G.rs.x + 30, G.rs.y], dir: 'right' },
];

const DPAD_DIRS = [
  { id: 'gamepadDUp', dir: 'up', at: [G.dpad.x, G.dpad.y - G.dpad.arm] },
  { id: 'gamepadDDown', dir: 'down', at: [G.dpad.x, G.dpad.y + G.dpad.arm] },
  { id: 'gamepadDLeft', dir: 'left', at: [G.dpad.x - G.dpad.arm, G.dpad.y] },
  { id: 'gamepadDRight', dir: 'right', at: [G.dpad.x + G.dpad.arm, G.dpad.y] },
];

const FACE_COLOR = { gamepadA: '#6cd850', gamepadB: '#ff5f57', gamepadX: '#4c9bff', gamepadY: '#f5d020' };
const FACE_LETTER = { gamepadA: 'A', gamepadB: 'B', gamepadX: 'X', gamepadY: 'Y' };
const ARROW = { up: '↑', down: '↓', left: '←', right: '→' };

/** The controller body. All shapes are drawn from the same geometry constants. */
function bodySvg() {
  return `
<svg viewBox="0 0 ${VB.w} ${VB.h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="cxBody" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="var(--surface-3)"/>
      <stop offset="100%" stop-color="var(--surface-1)"/>
    </linearGradient>
    <radialGradient id="cxGrip" cx="50%" cy="32%" r="72%">
      <stop offset="0%" stop-color="var(--surface-3)"/>
      <stop offset="100%" stop-color="var(--surface-1)"/>
    </radialGradient>
  </defs>
  <path fill="url(#cxBody)" stroke="var(--line-strong)" stroke-width="2.5"
    d="M108 34c-34 2-52 22-62 56-9 30-16 62-8 84 7 19 25 24 42 15 14-8 25-20 36-28 11-8 25-11 42-11s31 3 42 11c11 8 22 20 36 28 17 9 35 4 42-15 8-22 1-54-8-84-10-34-28-54-62-56-14-2-24-2-30-2z"/>
  ${[G.ls, G.rs].map((s) => `
  <circle cx="${s.x}" cy="${s.y}" r="${s.r}" fill="url(#cxGrip)" stroke="var(--line-strong)" stroke-width="2"/>
  <circle cx="${s.x}" cy="${s.y}" r="${s.r - 7}" fill="var(--surface-3)"/>
  <circle cx="${s.x}" cy="${s.y}" r="8" fill="var(--surface-1)"/>`).join('')}
  <path fill="var(--surface-2)" stroke="var(--line-strong)" stroke-width="2" stroke-linejoin="round"
    d="M${G.dpad.x - 6} ${G.dpad.y - G.dpad.arm}h12v6h6v12h-6v6h-12v-6h-6v-12h6z"/>
  <circle cx="${G.guide[0]}" cy="${G.guide[1]}" r="9" fill="none" stroke="var(--text-3)" stroke-width="2"/>
  <path d="M${G.guide[0] - 4} ${G.guide[1]}h8M${G.guide[0]} ${G.guide[1] - 4}v8" stroke="var(--text-3)" stroke-width="2"/>
  <rect x="${G.view[0] - 6}" y="${G.view[1] - 6}" width="12" height="12" rx="2" fill="var(--surface-2)" stroke="var(--line-strong)" stroke-width="1.6"/>
  <path d="M${G.start[0] - 5} ${G.start[1] - 4}h10M${G.start[0] - 5} ${G.start[1]}h10M${G.start[0] - 5} ${G.start[1] + 4}h10" stroke="var(--text-3)" stroke-width="2" stroke-linecap="round"/>
</svg>`;
}

/**
 * @param {{mapping?:object, selectedId?:string|null, listeningId?:string|null,
 *          onSelect?:(id:string)=>void, onAxes?:(id:string)=>void}} opts
 */
export function controllerDiagram(opts = {}) {
  let mapping = opts.mapping || {};
  let selectedId = opts.selectedId || null;
  let listeningId = opts.listeningId || null;

  const select = (id) => (opts.onSelect || opts.onAxes)?.(id);

  const svgHost = h('div.cx-svg', { html: bodySvg() });
  const stage = h('div.cx-stage', [svgHost]);
  const colLeft = h('div.cx-col.cx-col-left');
  const colRight = h('div.cx-col.cx-col-right');
  const colCenter = h('div.cx-col.cx-col-center');
  const leaders = document.createElementNS(SVG_NS, 'svg');
  leaders.setAttribute('class', 'cx-leaders');
  leaders.setAttribute('aria-hidden', 'true');
  const root = h('div.controller-visual', { role: 'group', 'aria-label': 'Controller diagram' },
    [leaders, colLeft, stage, colRight]);
  root.appendChild(colCenter);

  /** labelNodes[buttonId] = { key, node, leader? } */
  const labelNodes = new Map();

  const addCallout = (c) => {
    const btn = BUTTONS.find((b) => b.id === c.id);
    if (!btn) return;
    const key = h('span.co-key');
    const node = h('button.cx-callout', {
      type: 'button',
      dataset: { btn: btn.id },
      onclick: () => select(btn.id),
    }, [h('span.co-chip', btn.label), key]);
    (c.col === 'left' ? colLeft : c.col === 'right' ? colRight : colCenter).appendChild(node);
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('class', 'cx-leader');
    leaders.appendChild(line);
    labelNodes.set(btn.id, { key, node, leader: line, anchor: c.anchor });
  };
  for (const c of CALLOUTS) addCallout(c);

  // Face buttons sit on the drawn artwork.
  for (const [id, pos] of Object.entries(G.face)) {
    const key = h('span.fb-key');
    const node = h('button.cx-face', {
      type: 'button',
      dataset: { btn: id },
      style: { '--fb': FACE_COLOR[id] },
      onclick: () => select(id),
    }, [h('span.fb-letter', FACE_LETTER[id]), key]);
    stage.appendChild(node);
    labelNodes.set(id, { key, node, point: pos });
  }

  // Stick clicks are the stick centres.
  for (const [id, s] of [['gamepadLS', G.ls], ['gamepadRS', G.rs]]) {
    const key = h('span.fb-key');
    const node = h('button.cx-stick', {
      type: 'button',
      dataset: { btn: id },
      onclick: () => select(id),
    }, [key]);
    stage.appendChild(node);
    labelNodes.set(id, { key, node, point: [s.x, s.y] });
  }

  // Direction chips for both sticks.
  for (const a of AXES) {
    const btn = BUTTONS.find((b) => b.id === a.id);
    const key = h('span.ax-key');
    const node = h('button.cx-axis', {
      type: 'button',
      dataset: { btn: a.id },
      style: { '--dir': a.dir },
      title: btn?.label || a.id,
      onclick: () => select(a.id),
    }, [h('span.ax-arrow', ARROW[a.dir]), key]);
    stage.appendChild(node);
    labelNodes.set(a.id, { key, node, point: a.at });
  }

  // D-pad: four directional hotspots on the drawn cross.
  for (const d of DPAD_DIRS) {
    const key = h('span.dp-key');
    const node = h('button.cx-dpdir', {
      type: 'button',
      dataset: { btn: d.id },
      style: { '--dir': d.dir },
      onclick: () => select(d.id),
    }, [key]);
    stage.appendChild(node);
    labelNodes.set(d.id, { key, node, point: d.at });
  }

  /** Paint one button's label + a11y text. Cheap: two text nodes. */
  function paint(id) {
    const entry = labelNodes.get(id);
    if (!entry) return;
    const bind = mapping[id];
    const text = bind ? bindLabel(bind) : '—';
    if (entry.key.textContent !== text) {
      entry.key.textContent = text;
      entry.key.classList.remove('pulse');
      void entry.key.offsetWidth;              // restart the pop animation
      entry.key.classList.add('pulse');
    }
    entry.node.classList.toggle('unmapped', !bind);
    const name = buttonLabel(id);
    entry.node.setAttribute('aria-label', bind ? `${name} mapped to ${text}` : `${name} unassigned`);
    entry.node.title = bind ? `${name} → ${text}` : `${name} — click to assign`;
  }

  function applySelection() {
    for (const [, entry] of labelNodes) {
      const id = entry.node.dataset.btn;
      entry.node.classList.toggle('selected', id === selectedId);
      entry.node.classList.toggle('listening', id === listeningId);
    }
  }

  /** Repaint everything (first build, profile switch, section change). */
  function update(next = mapping, o = {}) {
    mapping = next || {};
    if (o.selectedId !== undefined) selectedId = o.selectedId;
    if (o.listeningId !== undefined) listeningId = o.listeningId;
    for (const b of BUTTONS) paint(b.id);
    applySelection();
    layout();
  }

  /**
   * Map viewBox units onto the artwork, then into root coordinates.
   *
   * `preserveAspectRatio="xMidYMid meet"` letterboxes the drawing inside the
   * SVG element box whenever the container is not exactly 2:1, so the mapping
   * has to reproduce that fit maths instead of assuming the box is the drawing.
   */
  function mapper() {
    const svg = svgHost.querySelector('svg');
    if (!svg) return null;
    const box = svg.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    if (!box.width || !box.height || !stageRect.width) return null;
    const scale = Math.min(box.width / VB.w, box.height / VB.h);
    const offX = (box.width - VB.w * scale) / 2;
    const offY = (box.height - VB.h * scale) / 2;
    // Hotspots live inside .cx-stage, leaders inside .controller-visual, so the
    // same viewBox point needs to be expressed in both coordinate spaces.
    const px = box.left + offX;
    const py = box.top + offY;
    return {
      scale,
      drawWidth: VB.w * scale,
      toStage: ([vx, vy]) => [px - stageRect.left + vx * scale, py - stageRect.top + vy * scale],
      toRoot: ([vx, vy]) => [px - rootRect.left + vx * scale, py - rootRect.top + vy * scale],
    };
  }

  function place(node, x, y) {
    node.style.left = `${Math.round(x)}px`;
    node.style.top = `${Math.round(y)}px`;
  }

  /** Position every hotspot from measured geometry, then draw the leaders. */
  function layout() {
    const m = mapper();
    if (!m) return;
    // Hotspots scale with the artwork so they never overlap each other.
    const s = Math.max(0.62, Math.min(1.15, m.drawWidth / 520));
    root.style.setProperty('--cx-s', String(Math.round(s * 100) / 100));
    for (const [, entry] of labelNodes) {
      if (!entry.point) continue;
      const [x, y] = m.toStage(entry.point);
      place(entry.node, x, y);
    }
    // Leaders only make sense while the columns sit beside the body.
    const rootRect = root.getBoundingClientRect();
    const sideBySide = rootRect.width > 640;
    leaders.style.display = sideBySide ? '' : 'none';
    if (!sideBySide) return;
    for (const [, entry] of labelNodes) {
      if (!entry.leader || !entry.anchor) continue;
      const r = entry.node.getBoundingClientRect();
      const from = [r.left - rootRect.left + (r.width / 2), r.top - rootRect.top + (r.height / 2)];
      const to = m.toRoot(entry.anchor);
      entry.leader.setAttribute('x1', from[0]); entry.leader.setAttribute('y1', from[1]);
      entry.leader.setAttribute('x2', to[0]); entry.leader.setAttribute('y2', to[1]);
    }
  }

  function sizeLeaders() {
    const r = root.getBoundingClientRect();
    if (!r.width) return;
    leaders.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
    leaders.setAttribute('width', r.width);
    leaders.setAttribute('height', r.height);
  }

  root.update = update;
  root.paintOne = (id, nextMapping) => {
    if (nextMapping) mapping = nextMapping;
    paint(id);
  };
  root.setSelection = (sel, listen) => {
    selectedId = sel ?? null;
    listeningId = listen ?? null;
    applySelection();
  };
  root.layout = () => { sizeLeaders(); layout(); };
  root.has = (id) => labelNodes.has(id);
  root.ids = () => [...labelNodes.keys()];
  root.bindLabelFor = (id) => bindLabel(mapping[id]);
  root.isMouseBound = (id) => isMouseCode(mapping[id]?.code || '');

  update(mapping);

  // Geometry needs a measured box: paint once now, once after the first frame,
  // and again whenever the panel is resized. The timer fallback keeps this
  // working in a hidden or occluded window where rAF never fires.
  const relayout = () => { sizeLeaders(); layout(); };
  relayout();
  requestAnimationFrame(relayout);
  setTimeout(relayout, 48);
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => relayout());
    ro.observe(root);
    root._ro = ro;
  }
  window.addEventListener('resize', relayout, { passive: true });
  root._relayout = relayout;
  return root;
}