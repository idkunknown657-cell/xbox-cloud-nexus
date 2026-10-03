/**
 * Controls & Input — the most important settings surface in the app.
 *
 * Sections: Controller mapping · Keyboard & Mouse · Control profiles ·
 *           Per-game profiles · Sensitivity & deadzones · Input devices · Advanced
 *
 * Performance rule: changing one binding must not rebuild the panel. Remapping
 * patches the single label node on the diagram plus its table row, so input
 * feels instant even on a low-end machine. Full repaints happen only when the
 * user switches section or profile.
 */
import { h, clear, debounce, copyText } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { settings } from '../store.js';
import { confirmDialog, promptDialog, openModal } from '../modal.js';
import { toastOk, toastInfo, toastWarn, toastErr } from '../toast.js';
import { sfx } from '../sfx.js';
import {
  BUTTONS, BUTTON_BY_ID, buttonLabel, bindLabel, captureFromEvent,
  findConflicts, sanitizeMapping, makeProfileId, isMouseCode, keyCodeForGlyph, VALID_CODES,
} from '../buttons.js';
import { controllerDiagram } from './controller-diagram.js';
import { watch, PAD_INDEX_TO_BTN } from '../gamepad.js';
import { profilesRail, testCard, quickActionsCard, kbmPanel, mouseSettingsCard } from './controls-panels.js';
import { dropdown, slider, toggle, segmented } from '../ui-kit.js';
import * as cat from '../catalog.js';

// ---------- View state ----------
let section = 'controller';
let selectedId = null;
let listening = false;
let profileId = null;
let diagram = null;          // live diagram node, for incremental updates
let rowNodes = new Map();    // buttonId -> key element in the list
let conflictBadge = null;    // badge element on the Quick Actions "Conflict check" row
const flashTimers = new Map();
let repaint = () => {};
let leaveHooks = [];
let gameCtxId = null;      // set when the controls screen is opened for one game

const SECTIONS = [
  { id: 'controller', label: 'Controller Mapping', iconName: 'controller' },
  { id: 'kbm', label: 'Keyboard & Mouse', iconName: 'keyboard' },
  { id: 'profiles', label: 'Control Profiles', iconName: 'layers' },
  { id: 'pergame', label: 'Per-Game Profiles', iconName: 'gamepad' },
  { id: 'aim', label: 'Sensitivity & Deadzones', iconName: 'gauge' },
  { id: 'devices', label: 'Input Devices', iconName: 'plug' },
  { id: 'advanced', label: 'Advanced Input', iconName: 'wand' },
];

// ---------- Profile helpers ----------
export function profiles() {
  return settings.get('input.profiles', []) || [];
}
export function activeProfile() {
  return profiles().find((p) => p.id === profileId)
    || profiles().find((p) => p.id === settings.get('input.activeProfile'))
    || profiles()[0] || null;
}
function setProfileId(id) { profileId = id; }

/** Merge a partial patch into the active profile (mapping / mouse / stick). */
async function patchProfile(patch) {
  const p = activeProfile();
  if (!p) return null;
  const next = { ...p, ...patch };
  await settings.set('input.profiles', profiles().map((x) => (x.id === p.id ? next : x)));
  return next;
}

/**
 * Mouse / stick tuning lives on the *profile* because that is what the stream
 * bridge sends to Better xCloud. The global block is kept in sync as the
 * template new profiles are cloned from.
 */
function mouseCfg() {
  return { ...(settings.get('input.mouse', {}) || {}), ...((activeProfile()?.mouse) || {}) };
}
function stickCfg() {
  return { ...(settings.get('input.stick', {}) || {}), ...((activeProfile()?.stick) || {}) };
}
async function patchCfg(kind, key, value, profileId) {
  const list = profiles();
  const p = list.find((x) => x.id === profileId) || activeProfile();
  await settings.set(`input.${kind}.${key}`, value);
  if (!p) return;
  await settings.set('input.profiles',
    list.map((x) => (x.id === p.id ? { ...x, [kind]: { ...(x[kind] || {}), [key]: value } } : x)));
}

/** Slider row bound to profile mouse/stick state. */
function cfgSliderRow(label, kind, key, min, max, step, format) {
  const cfg = kind === 'mouse' ? mouseCfg() : stickCfg();
  const pid = activeProfile()?.id;
  const write = debounce((v) => { patchCfg(kind, key, v, pid); }, 110);
  const el = slider({
    value: Number(cfg[key] ?? 0), min, max, step, format,
    onInput: write,
  });
  el.dataset.cfg = `${kind}.${key}`;
  return h('div.row.compact', [h('div.r-main', h('div.r-title', label)), el]);
}

/** Toggle row bound to profile mouse/stick state. */
function cfgSwitchRow(label, kind, key, desc) {
  const cfg = kind === 'mouse' ? mouseCfg() : stickCfg();
  const pid = activeProfile()?.id;
  const el = toggle({
    value: cfg[key] !== false,
    onChange: (v) => { patchCfg(kind, key, v, pid); sfx('toggle'); },
  });
  el.dataset.cfg = `${kind}.${key}`;
  return h('div.row.compact', [
    h('div.r-main', [h('div.r-title', label), desc ? h('div.r-desc', desc) : null].filter(Boolean)),
    el,
  ]);
}

/** Dropdown row bound to profile mouse/stick state. */
function cfgPickRow(label, kind, key, options) {
  const cfg = kind === 'mouse' ? mouseCfg() : stickCfg();
  const dd = dropdown({
    label,
    value: cfg[key] ?? options[0].value,
    options,
    onPick: (v) => patchCfg(kind, key, v, activeProfile()?.id),
    className: 'dd-inline',
  });
  dd.dataset.cfg = `${kind}.${key}`;
  return h('div.row.compact', [h('div.r-main', h('div.r-title', label)), dd]);
}

const CURVE_OPTIONS = [
  { value: 'linear', label: 'Linear' },
  { value: 'expo', label: 'Exponential' },
  { value: 'classic', label: 'Classic' },
];

/** Write one binding into the active profile and patch the UI in place. */
async function setBinding(btnId, bind) {
  const p = activeProfile();
  if (!p) return;
  const mapping = sanitizeMapping({ ...p.mapping, [btnId]: bind });
  await patchProfile({ mapping });
  // Incremental: a handful of text nodes, never a rebuild.
  if (diagram) diagram.paintOne(btnId, mapping);
  paintRow(btnId, bind);
  refreshConflictBadge();
}

/**
 * A binding can appear in the mapping list, in the rail's live table and on the
 * controller artwork, so paint every place it shows up. All of them are text
 * nodes, which is what keeps remapping instant on a low-end machine.
 */
function paintRow(btnId, bind) {
  const text = bind ? bindLabel(bind) : '—';
  const row = rowNodes.get(btnId);
  if (row && row.textContent !== text) {
    row.textContent = text;
    row.classList.toggle('unset', !bind);
  }
}

// ---------- Capture ----------
function installCapture(ctx) {
  const onKeyDown = async (e) => {
    if (!listening) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { selectedId = null; disarm(); ctx.repaint(); return; }
    const capture = captureFromEvent(e);
    if (!capture) return;
    // Capture the target BEFORE disarming, which clears the selection.
    const btnId = selectedId;
    disarm();
    if (capture.blocked) {
      toastWarn(t('conflict_title'), blockedReason(capture.reason, capture.code));
      ctx.repaint();
      return;
    }
    await applyBinding(ctx, capture, btnId);
  };

  const onMouseDown = async (e) => {
    if (!listening) return;
    const capture = captureFromEvent(e);
    if (!capture || capture.blocked) return;
    // While listening, the click belongs to the remap: it must not also press
    // whatever control sits under the pointer (nav item, chip, other row).
    e.preventDefault();
    e.stopPropagation();
    const btnId = selectedId;
    disarm();
    await applyBinding(ctx, capture, btnId);
  };

  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('mousedown', onMouseDown, true);
  return () => {
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('mousedown', onMouseDown, true);
  };
}

function blockedReason(reason, code) {
  if (reason === 'os') return `${code} is reserved by Windows and can’t be used.`;
  if (reason === 'nav') return `${code} is used for app navigation and can’t be remapped.`;
  return `${code} isn’t supported. Pick a letter, number, function key, modifier or mouse button.`;
}

function disarm() { listening = false; if (diagram) diagram.setSelection(selectedId, null); }

/** Chips whose label is a word rather than a letter need a wider badge. */
const WORD_LABELS = new Set(['View', 'Menu', 'Xbox', 'LS', 'RS', 'L3', 'R3']);
function isWordLabel(label) { return WORD_LABELS.has(label) || String(label).length > 2; }

/** Spoken/descriptive name per input, used by tooltips and a11y labels. */
const BTN_NAMES = {
  gamepadA: 'A button', gamepadB: 'B button', gamepadX: 'X button', gamepadY: 'Y button',
  gamepadLB: 'Left bumper', gamepadRB: 'Right bumper', gamepadLT: 'Left trigger', gamepadRT: 'Right trigger',
  gamepadSelect: 'View button', gamepadStart: 'Menu button', gamepadGuide: 'Xbox button',
  gamepadLS: 'Left stick click', gamepadRS: 'Right stick click',
  gamepadDUp: 'D-Pad up', gamepadDDown: 'D-Pad down', gamepadDLeft: 'D-Pad left', gamepadDRight: 'D-Pad right',
  gamepadLSU: 'Left stick up', gamepadLSD: 'Left stick down', gamepadLSL: 'Left stick left', gamepadLSR: 'Left stick right',
  gamepadRSU: 'Right stick up', gamepadRSD: 'Right stick down', gamepadRSL: 'Right stick left', gamepadRSR: 'Right stick right',
};

/**
 * Live feedback: light one input on the artwork and in the mapping list, then
 * fade it out. Used by the test card so a keypress or pad press is visible
 * everywhere the binding appears — the "real time" reaction players expect.
 */
function flash(id, ms = 220) {
  if (!id) return;
  if (diagram?.flash) diagram.flash(id, true);
  const row = rowNodes.get(id)?.closest('.map-item');
  if (row) row.classList.add('live');
  clearTimeout(flashTimers.get(id));
  flashTimers.set(id, setTimeout(() => {
    if (diagram?.flash) diagram.flash(id, false);
    const r = rowNodes.get(id)?.closest('.map-item');
    if (r) r.classList.remove('live');
    flashTimers.delete(id);
  }, ms));
}

/** Every key that currently drives more than one controller input. */
function conflictList() {
  const mapping = sanitizeMapping(activeProfile()?.mapping);
  const seen = new Map();
  for (const b of BUTTONS) {
    // Stick-direction chips intentionally share codes with the D-pad, so they
    // are never reported as conflicts.
    if (STICK_DIR_IDS.has(b.id)) continue;
    const code = mapping[b.id]?.code;
    if (!code) continue;
    seen.set(code, [...(seen.get(code) || []), b]);
  }
  return [...seen.entries()].filter(([, arr]) => arr.length > 1);
}

/** Recount duplicate bindings and update the Quick Actions badge. */
function refreshConflictBadge() {
  if (!conflictBadge) return;
  const n = conflictList().length;
  conflictBadge.textContent = n ? String(n) : '';
  conflictBadge.classList.toggle('on', n > 0);
  conflictBadge.title = n ? `${n} key${n > 1 ? 's' : ''} bound to more than one input` : 'No conflicts';
}

const STICK_DIR_IDS = new Set(['gamepadLSU', 'gamepadLSD', 'gamepadLSL', 'gamepadLSR',
  'gamepadRSU', 'gamepadRSD', 'gamepadRSL', 'gamepadRSR']);

async function applyBinding(ctx, capture, buttonId) {
  const profile = activeProfile();
  if (!profile || !buttonId) return;
  const conflicts = findConflicts(profile.mapping, capture.code, buttonId);

  if (conflicts.length) {
    const choice = await conflictDialog(capture, conflicts[0]);
    if (choice === 'cancel' || choice === null) { ctx.repaint(); return; }
    if (choice === 'replace') {
      await setBinding(conflicts[0], null);
      await setBinding(buttonId, capture);
    } else {
      await setBinding(buttonId, capture);
    }
  } else {
    await setBinding(buttonId, capture);
  }
  selectedId = null;
  if (diagram) diagram.setSelection(null, null);
  if (rowNodes.has(buttonId)) {
    const row = rowNodes.get(buttonId);
    row.parentElement?.classList.remove('selected');
  }
  toastOk(t('saved'), `${buttonLabel(buttonId)} → ${bindLabel(capture)}`);
}

async function conflictDialog(capture, otherBtn) {
  let choice = null;
  await openModal({
    title: t('conflict_title'),
    body: h('div', [
      h('p', t('conflict_msg', { key: bindLabel(capture), btn: buttonLabel(otherBtn) })),
      h('p.muted.mt-8.conflict-hint', 'Replace frees the other control. Keep both presses both buttons when the key is held.'),
    ]),
    actions: [
      { label: t('cancel'), value: 'cancel', kind: 'ghost' },
      { label: t('keep_both'), value: 'keep' },
      { label: t('replace'), value: 'replace', kind: 'primary' },
    ],
    width: 460,
    onClose: (v) => { choice = v; },
  });
  return choice;
}

// ---------- Reusable small controls (kept for settings.js + wizard.js) ----------
export function switchControl(path, value, onToggle) {
  const el = toggle({
    value,
    onChange: async (v) => {
      await settings.set(path, v);
      sfx('toggle');
      onToggle?.(v);
    },
  });
  el.dataset.path = path;
  return el;
}

export function sliderControl(path, value, min, max, step, ctx, format) {
  const el = slider({
    value, min, max, step,
    format,
    onInput: debounce(async (v) => { await settings.set(path, v); }, 110),
  });
  el.dataset.path = path;
  return el;
}

export function setControlsTab(id) { section = id === 'kbm' ? 'kbm' : id; }

// ---------- Shared header: profile selectors ----------
function profileHeader(ctx) {
  const list = profiles();
  const assigned = settings.get('input.gameProfiles', {}) || {};
  const current = activeProfile();

  const profileDd = dropdown({
    label: 'Current profile',
    value: current?.id ?? null,
    options: list.map((p) => ({
      value: p.id,
      label: p.name,
      sub: p.id === settings.get('input.activeProfile') ? 'Active' : null,
      icon: p.builtin ? 'shield' : 'layers',
    })),
    onPick: (id) => { setProfileId(id); ctx.repaint(); },
    className: 'dd-profile',
  });

  const gameId = ctx.gameId || gameCtxId;
  const gameDd = dropdown({
    label: 'Game profile override',
    value: assigned[gameId] || '__none__',
    placeholder: 'Auto (Default)',
    options: [
      { value: '__none__', label: 'Auto (Default)', sub: 'Uses the active profile' },
      ...list.map((p) => ({ value: p.id, label: p.name, sub: 'Per-game' })),
    ],
    onPick: async (id) => {
      const map = { ...assigned };
      if (id === '__none__') delete map[gameId];
      else if (gameId) map[gameId] = id;
      await settings.set('input.gameProfiles', map);
      if (gameId) await window.nexus.profiles.assignGame(gameId, id === '__none__' ? null : id);
      toastOk(t('profile_saved'), id === '__none__' ? 'Auto' : list.find((p) => p.id === id)?.name);
    },
    className: 'dd-game',
  });

  return h('div.profile-header', [
    h('div.field', [h('span.field-label', 'Current Profile'), profileDd]),
    h('div.field', [h('span.field-label', 'Game Profile'), gameDd,
      h('span.info-dot', { title: 'Games launch with this profile when a game has its own override.' }, icon('info', { size: 13 }))]),
    h('div.grow'),
    h('button.btn.sm', { onclick: () => createProfile(ctx) }, icon('plus', { size: 14 }), 'New Profile'),
    h('button.btn.sm', { onclick: () => resetProfile(ctx) }, icon('refresh', { size: 14 }), 'Reset'),
    h('button.iconbtn', { title: 'More', onclick: (e) => openQuickMenu(e, ctx) }, icon('dots', { size: 16 })),
  ]);
}async function openQuickMenu(e, ctx) {
  const choice = await openModal({
    title: 'Profile actions',
    body: h('div.quick-list', [
      h('button.quick-item', { dataset: { action: 'reset-profile' } }, [icon('refresh', { size: 15 }), 'Reset current profile']),
      h('button.quick-item', { dataset: { action: 'reset-all' } }, [icon('controller', { size: 15 }), 'Reset all controls']),
      h('button.quick-item', { dataset: { action: 'conflicts' } }, [icon('alert', { size: 15 }), 'Conflict check']),
      h('button.quick-item', { dataset: { action: 'export' } }, [icon('download', { size: 15 }), 'Export profile']),
      h('button.quick-item', { dataset: { action: 'import' } }, [icon('upload', { size: 15 }), 'Import profile']),
    ]),
    actions: [{ label: t('cancel'), value: null, kind: 'ghost' }],
    width: 380,
    // Each item closes the modal and reports back through `finish`, so the
    // selected action always runs.
    onMount: (card, finish) => {
      card.querySelectorAll('.quick-item').forEach((item) => {
        item.addEventListener('click', () => finish(item.dataset.action));
      });
    },
  });
  const p = activeProfile();
  if (choice === 'reset-profile') await resetProfile(ctx);
  else if (choice === 'reset-all') await resetAllControls(ctx);
  else if (choice === 'conflicts') await showConflicts(ctx);
  else if (choice === 'export') await exportProfile(p);
  else if (choice === 'import') await importProfile(ctx);
}

// ---------- Section: Controller mapping ----------
function controllerSection(ctx) {
  const profile = activeProfile();
  if (!profile) return h('div.empty', h('div.e-title', 'No profiles available'));
  const mapping = sanitizeMapping(profile.mapping);

  diagram = controllerDiagram({
    mapping,
    selectedId,
    listeningId: listening ? selectedId : null,
    onSelect: (id) => {
      selectedId = id;
      listening = true;
      repaint();
    },
  });

  // Left list: every button, click to arm. Kept in sync incrementally.
  const list = h('div.map-list');
  rowNodes = new Map();
  const GROUPS = [
    { title: null, ids: BUTTONS.filter((b) => b.group === 'face').map((b) => b.id) },
    { title: 'Shoulders & Triggers', ids: BUTTONS.filter((b) => ['shoulder', 'trigger'].includes(b.group)).map((b) => b.id) },
    { title: 'Center', ids: BUTTONS.filter((b) => b.group === 'center').map((b) => b.id) },
    { title: 'D-Pad', ids: ['gamepadDUp', 'gamepadDRight', 'gamepadDDown', 'gamepadDLeft'] },
    { title: 'Sticks', ids: ['gamepadLS', 'gamepadRS'] },
    { title: 'Left Stick Movement', ids: ['gamepadLSU', 'gamepadLSR', 'gamepadLSD', 'gamepadLSL'] },
    { title: 'Right Stick Movement', ids: ['gamepadRSU', 'gamepadRSR', 'gamepadRSD', 'gamepadRSL'] },
  ];
  for (const g of GROUPS) {
    if (g.title) list.appendChild(h('div.map-group', g.title));
    for (const id of g.ids) {
      const btn = BUTTON_BY_ID[id];
      if (!btn) continue;
      const bind = mapping[id];
      const keyEl = h(`span.map-key${bind ? '' : '.unset'}`, bind ? bindLabel(bind) : '—');
      // One row = the input chip plus what it is bound to. The full name lives in
      // the tooltip and aria-label, so nothing is repeated and the column never
      // has to compete for width with three labels.
      const name = BTN_NAMES[id] || btn.label;
      const row = h(`button.map-item${id === selectedId ? '.selected' : ''}${isWordLabel(btn.label) ? '.wide-badge' : ''}`, {
        type: 'button',
        dataset: { btn: id },
        title: `${name} — ${bind ? `bound to ${bindLabel(bind)}` : 'unassigned'}. Click, then press a key or mouse button.`,
        'aria-label': `${name}, ${bind ? bindLabel(bind) : 'unassigned'}`,
        onclick: () => {
          selectedId = id;
          listening = true;
          repaint();
        },
      }, [
        h(`span.map-badge.fb-${btn.label.toLowerCase().replace(/[^a-z0-9]/g, '')}`, btn.label),
        keyEl,
        h('span.map-chevron', icon('chevronRight', { size: 14 })),
      ]);
      rowNodes.set(id, keyEl);
      list.appendChild(row);
    }
  }

  return h('div.controller-section', [
    h('div.controls-3col', [
      // -- left: the mapping list -------------------------------------------------
      h('div.panel.panel-tight.map-card', [
        h('div.mini-head', [icon('controller', { size: 15 }), h('h4', 'Controller Mapping')]),
        devicePicker(),
        h('div.map-list-wrap', list),
      ]),
      // -- middle: live artwork + keyboard/mouse -------------------------------
      h('div.controls-mid', [
        h('div.panel.panel-flush', [
          h('div.panel-head', [
            h('div', [
              h('h3', 'Controller Mapping'),
              h('p.p-desc', 'Customize your controller and keyboard/mouse inputs. All games use this mapping — even controller-only games.'),
            ]),
            h('span.kbm-live', [h('span.dot'), t('kbm_supported')]),
          ]),
          profileHeader(ctx),
          h('div.diagram-wrap', diagram),
        ]),
      ]),
      // -- right: profiles, live test, quick actions ----------------------------
      h('div.controls-rail', [
        profilesRail(ctx, api),
        testCard(ctx, api),
        quickActionsCard(ctx, api),
      ]),
      /*
       * Keyboard & Mouse gets its own full-width row rather than living in the
       * middle column. In a 460px column a 14-key row has to either scroll
       * sideways or shrink into unreadable slivers, and the settings beside it
       * had nowhere to go — which is exactly the overlap this section had.
       */
      h('div.controls-full', kbmPanel(ctx, api, { embedded: true })),
    ]),
    kbmFooter(),
  ]);
}

/** Attribution + the one-sentence explanation of how KBM translation works. */
function kbmFooter() {
  return h('div.kbm-footer', [
    h('span.kf-note', [icon('info', { size: 15 }),
      h('span', 'Keyboard and mouse input is converted to controller input, allowing you to play all Xbox Cloud Gaming games — even those that only support controller.')]),
    h('span.kf-brand', [
      icon('xbox', { size: 15 }),
      h('span', 'Powered by Better xCloud'),
      h('button.kf-link', { type: 'button', onclick: () => window.nexus.openExternal('https://better-xcloud.github.io/mouse-and-keyboard/') }, 'Learn more'),
    ]),
  ]);
}

/**
 * Which pad the mapping applies to. The translation layer always feeds one
 * virtual Xbox pad, so this is informational — but players want to see whether
 * their real controller was picked up before they start mapping.
 */
function devicePicker() {
  const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter((p) => p && p.connected) : [];
  const options = [
    { value: 'virtual', label: 'Xbox Controller', sub: 'Virtual · always available' },
    ...pads.map((p) => ({ value: `pad-${p.index}`, label: String(p.id || 'Controller').slice(0, 34), sub: 'Connected' })),
  ];
  const dd = dropdown({
    label: 'Controller',
    value: 'virtual',
    options,
    onPick: (v) => {
      const pad = pads.find((p) => `pad-${p.index}` === v);
      if (pad) toastInfo('Controller detected', `${String(pad.id).slice(0, 40)} — mappings apply to every pad`);
      else toastInfo('Virtual Xbox controller', 'Games always receive controller input, real pad or not.');
    },
    className: 'dd-block',
  });
  return dd;
}

/**
 * Clicking an unbound key must do something useful: pick the controller input
 * it should drive, then bind it. This is how a player builds a keyboard layout
 * from scratch ("Q = jump") without hunting through the mapping list first.
 */
async function chooseTargetForCode(ctx, code, glyph) {
  const options = BUTTONS.map((b) => ({
    id: b.id,
    label: b.label === 'LS' || b.label === 'RS' ? `${b.label} Click` : b.label,
    group: b.group,
  }));
  const groups = [];
  for (const o of options) {
    const last = groups[groups.length - 1];
    if (last && last.group === o.group) last.items.push(o);
    else groups.push({ group: o.group, items: [o] });
  }
  // The modal resolves through `finish`, so the picked chip actually runs its
  // action instead of leaving the promise pending forever.
  const chosen = await openModal({
    title: `Assign ${glyph}`,
    body: h('div.assign-list', groups.map((g) => h('div.assign-group', [
      h('div.assign-group-title', GROUP_TITLE[g.group] || g.group),
      h('div.assign-chips', g.items.map((o) => h('button.assign-chip', {
        type: 'button',
        dataset: { assign: o.id },
      }, o.label))),
    ]))),
    actions: [{ label: t('cancel'), value: null, kind: 'ghost' }],
    width: 460,
    onMount: (card, finish) => {
      card.querySelectorAll('.assign-chip').forEach((chip) => {
        chip.addEventListener('click', () => finish(chip.dataset.assign));
      });
    },
  });
  if (!chosen) { ctx.repaint(); return; }
  const profile = activeProfile();
  if (!profile) return;
  const bind = { key: glyph, code };
  const conflicts = findConflicts(profile.mapping, code, chosen);
  if (conflicts.length) {
    const replace = await confirmDialog({
      title: t('conflict_title'),
      message: `${bindLabel(bind)} is already assigned to ${conflicts.map(buttonLabel).join(', ')}. Replace ${conflicts.length > 1 ? 'them' : 'it'}?`,
      confirmLabel: t('replace'),
    });
    if (!replace) { ctx.repaint(); return; }
  }
  const mapping = sanitizeMapping({ ...profile.mapping, [chosen]: bind });
  for (const c of conflicts) mapping[c] = null;
  await patchProfile({ mapping });
  toastOk(t('saved'), `${glyph} → ${buttonLabel(chosen)}`);
  if (diagram) diagram.paintOne(chosen, mapping);
  for (const c of conflicts) {
    if (diagram) diagram.paintOne(c, mapping);
    const row = rowNodes.get(c);
    if (row) { row.textContent = t('unassigned'); row.classList.add('unset'); }
  }
  const row = rowNodes.get(chosen);
  if (row) { row.textContent = bindLabel(bind); row.classList.remove('unset'); }
  // The keyboard visual is rebuilt by the next repaint; do it now so the new
  // key lights up immediately.
  ctx.repaint();
}

const GROUP_TITLE = {
  face: 'Face buttons',
  shoulder: 'Shoulders',
  trigger: 'Triggers',
  center: 'Center buttons',
  dpad: 'D-Pad',
  stick: 'Stick clicks',
  lstick: 'Left stick movement',
  rstick: 'Right stick movement',
};

/**
 * The panels module owns presentation only; this is the single place that
 * exposes live state and mutations to it. Keeping it explicit is what stops the
 * two files from drifting into a tangle of shared module globals.
 */
const api = {
  profiles: () => profiles(),
  activeProfile: () => activeProfile(),
  setProfileId: (id) => setProfileId(id),
  mapping: () => sanitizeMapping(activeProfile()?.mapping),
  mouseCfg: () => mouseCfg(),
  stickCfg: () => stickCfg(),
  cfgSliderRow,
  cfgSwitchRow,
  cfgPickRow,
  curveOptions: CURVE_OPTIONS,
  segmented,
  watch,
  padToBtn: PAD_INDEX_TO_BTN,
  padLabel: (id) => buttonLabel(id),
  isListening: () => listening,
  mouseDrivesStick: () => mouseCfg().enabled !== false,
  flash,
  chooseTarget: (ctx, code, glyph) => chooseTargetForCode(ctx, code, glyph),
  selectForRemap: (id) => { selectedId = id; listening = true; repaint(); },
  registerConflictBadge: (el) => { conflictBadge = el; refreshConflictBadge(); },
  createProfile: (ctx) => createProfile(ctx),
  importProfile: (ctx) => importProfile(ctx),
  go: (id) => { section = id; repaint(); },
  runQuickAction: (action, ctx) => runQuickAction(action, ctx),
};

/** Quick Actions shared by the rail card, the ⋯ menu and the advanced section. */
async function runQuickAction(action, ctx) {
  if (action === 'reset-profile') return resetProfile(ctx);
  if (action === 'reset-all') return resetAllControls(ctx);
  if (action === 'conflicts') return showConflicts(ctx);
  if (action === 'export') return exportProfile(activeProfile());
  if (action === 'import') return importProfile(ctx);
  return undefined;
}

// ---------- Section: Control profiles ----------
function profilesSection(ctx) {
  const list = profiles();
  const active = activeProfile();

  const items = h('div.profile-list', list.map((p) => {
    const count = Object.values(sanitizeMapping(p.mapping)).filter(Boolean).length;
    const isActive = p.id === settings.get('input.activeProfile');
    return h(`div.profile-item${p.id === active?.id ? '.active' : ''}`, {
      onclick: () => { setProfileId(p.id); ctx.repaint(); },
    }, [
      h('span.pi-icon', icon(p.builtin ? 'shield' : 'layers', { size: 16 })),
      h('div.grow', [
        h('div.p-name', p.name),
        h('div.p-meta', `${count} bindings`),
      ]),
      isActive ? h('span.p-flag', 'Active') : h('span.p-flag.muted', 'Custom'),
      h('div.pi-actions', [
        h('button.iconbtn', {
          title: isActive ? 'Active profile' : 'Set as active',
          'aria-label': `Set ${p.name} as active`,
          onclick: async (e) => {
            e.stopPropagation();
            await settings.set('input.activeProfile', p.id);
            setProfileId(p.id);
            toastOk(t('saved'), p.name);
            ctx.repaint();
          },
        }, icon('check', { size: 16 })),
        h('button.iconbtn', {
          title: 'Rename',
          'aria-label': `Rename ${p.name}`,
          onclick: async (e) => { e.stopPropagation(); await renameProfile(p, ctx); },
        }, icon('edit', { size: 15 })),
        h('button.iconbtn', {
          title: 'Duplicate',
          'aria-label': `Duplicate ${p.name}`,
          onclick: async (e) => { e.stopPropagation(); await duplicateProfile(p, ctx); },
        }, icon('copy', { size: 15 })),
        p.builtin ? null : h('button.iconbtn.danger', {
          title: 'Delete',
          'aria-label': `Delete ${p.name}`,
          onclick: async (e) => { e.stopPropagation(); await deleteProfile(p, ctx); },
        }, icon('trash', { size: 15 })),
      ].filter(Boolean)),
    ]);
  }));

  return h('div.panel', [
    h('h3', 'Control Profiles'),
    h('p.p-desc', 'A profile is a full set of button and aiming settings. The active profile is used by every game unless a game has its own override.'),
    items,
    h('div.flex.gap8.mt-16', [
      h('button.btn.sm.primary', { onclick: () => createProfile(ctx) }, icon('plus', { size: 14 }), 'Create Profile'),
      h('button.btn.sm', { onclick: () => importProfile(ctx) }, icon('upload', { size: 14 }), 'Import / Export'),
    ]),
  ]);
}

async function createProfile(ctx) {
  const name = await promptDialog({ title: 'New Profile', placeholder: 'Profile name', confirmLabel: 'Create' });
  if (!name) return;
  const base = activeProfile();
  const profile = {
    id: makeProfileId(),
    name,
    builtin: false,
    mapping: sanitizeMapping(base?.mapping),
    mouse: { ...(base?.mouse || settings.get('input.mouse', {})) },
    stick: { ...(base?.stick || settings.get('input.stick', {})) },
  };
  await settings.set('input.profiles', [...profiles(), profile]);
  setProfileId(profile.id);
  toastOk(t('profile_saved'), name);
  ctx.repaint();
}

async function renameProfile(p, ctx) {
  const name = await promptDialog({ title: t('rename'), value: p.name, confirmLabel: t('rename') });
  if (!name) return;
  await settings.set('input.profiles', profiles().map((x) => (x.id === p.id ? { ...x, name } : x)));
  toastOk(t('profile_saved'), name);
  ctx.repaint();
}

async function duplicateProfile(p, ctx) {
  // Deep-copy every block: aiming and stick feel are per-profile too.
  const copy = {
    ...p,
    id: makeProfileId(),
    name: `${p.name} copy`,
    builtin: false,
    mapping: { ...p.mapping },
    mouse: { ...(p.mouse || {}) },
    stick: { ...(p.stick || {}) },
  };
  await settings.set('input.profiles', [...profiles(), copy]);
  setProfileId(copy.id);
  toastOk(t('profile_saved'), copy.name);
  ctx.repaint();
}

async function deleteProfile(p, ctx) {
  if (p.builtin) return;
  const ok = await confirmDialog({ title: t('delete'), message: `Delete the profile “${p.name}”?`, confirmLabel: t('delete') });
  if (!ok) return;
  const next = profiles().filter((x) => x.id !== p.id);
  await settings.set('input.profiles', next);
  const map = { ...(settings.get('input.gameProfiles', {}) || {}) };
  for (const [gid, pid] of Object.entries(map)) if (pid === p.id) delete map[gid];
  await settings.set('input.gameProfiles', map);
  if (settings.get('input.activeProfile') === p.id) await settings.set('input.activeProfile', next[0]?.id || 'default');
  setProfileId(null);
  toastOk(t('profile_deleted'), p.name);
  ctx.repaint();
}

async function resetProfile(ctx) {
  const ok = await confirmDialog({
    title: t('reset_profile'),
    message: 'Reset every button and aiming setting in this profile back to defaults?',
    confirmLabel: t('reset_confirm'),
  });
  if (!ok) return;
  const base = profiles().find((p) => p.builtin) || profiles()[0];
  await patchProfile({
    mapping: sanitizeMapping(base?.mapping),
    mouse: { ...(base?.mouse || settings.get('input.mouse', {})) },
    stick: { ...(base?.stick || settings.get('input.stick', {})) },
  });
  toastOk(t('profile_saved'));
  ctx.repaint();
}

async function resetAllControls(ctx) {
  const ok = await confirmDialog({
    title: t('reset_all_controls'),
    message: 'Reset every control profile — including per-game bindings — back to defaults?',
    confirmLabel: t('reset_confirm'),
  });
  if (!ok) return;
  const base = profiles().find((p) => p.builtin) || profiles()[0];
  await settings.set('input.profiles', base ? [base] : []);
  await settings.set('input.activeProfile', base?.id || 'default');
  await settings.set('input.gameProfiles', {});
  setProfileId(null);
  toastOk(t('saved'));
  ctx.repaint();
}

/** Report every key bound to more than one control. */
async function showConflicts(ctx) {
  const profile = activeProfile();
  const mapping = sanitizeMapping(profile?.mapping);
  const dupes = conflictList().map(([code, arr]) => [code, arr.map((b) => b.label)]);
  await openModal({
    title: dupes.length ? 'Conflict check' : 'No conflicts',
    body: dupes.length
      ? h('div', dupes.map(([code, labels]) => h('div.conflict-row', [
          h('span.conflict-key', bindLabel({ code })),
          h('span.muted', '→'),
          h('span', labels.join(' + ')),
        ])))
      : h('p.muted', 'Every key is bound to exactly one controller input.'),
    actions: [{ label: t('cancel'), value: true, kind: 'primary' }],
    width: 420,
  });
}

async function exportProfile(p) {
  if (!p) return;
  try {
    const path = await window.nexus.profiles.export(p);
    if (path) toastOk(t('profile_exported'), path);
  } catch (e) { toastErr(e); }
}

async function importProfile(ctx) {
  let choice = null;
  await openModal({
    title: 'Import / Export',
    body: h('div.quick-list', [
      h('button.quick-item', { onclick: () => { choice = 'import'; } }, [icon('upload', { size: 15 }), 'Import profile…']),
      h('button.quick-item', { onclick: () => { choice = 'export'; } }, [icon('download', { size: 15 }), 'Export current profile…']),
      h('button.quick-item', { onclick: () => { choice = 'conflicts'; } }, [icon('alert', { size: 15 }), 'Conflict check']),
    ]),
    actions: [{ label: t('cancel'), value: null, kind: 'ghost' }],
    width: 380,
    onClose: (v) => { choice = choice || (v === true ? null : v); },
  });
  if (choice === 'export') return exportProfile(activeProfile());
  if (choice === 'conflicts') return showConflicts(ctx);
  if (choice !== 'import') return;
  try {
    const imported = await window.nexus.profiles.import();
    if (!imported) return;
    const profile = {
      id: makeProfileId(),
      name: imported.name || 'Imported',
      builtin: false,
      mapping: sanitizeMapping(imported.mapping),
      mouse: imported.mouse || { ...settings.get('input.mouse', {}) },
      stick: imported.stick || { ...settings.get('input.stick', {}) },
    };
    await settings.set('input.profiles', [...profiles(), profile]);
    setProfileId(profile.id);
    toastOk(t('profile_imported'), profile.name);
    ctx.repaint();
  } catch (e) { toastErr(e, 'Import failed'); }
}

// ---------- Section: Per-game profiles ----------
function perGameSection(ctx) {
  const assigned = settings.get('input.gameProfiles', {}) || {};
  const list = profiles();
  const played = cat.recents().map((id) => cat.get(id)).filter(Boolean);
  const rows = played.length ? played : cat.products(cat.idsPopular().slice(0, 12));

  return h('div.panel', [
    h('h3', 'Per-Game Profiles'),
    h('p.p-desc', t('per_game_desc')),
    h('div.pergame-list', rows.map((game) => h('div.assign-row', [
      cat.portraitArt(game) ? h('img', { src: cat.portraitArt(game), alt: '', loading: 'lazy' }) : h('div.assign-thumb-fallback', (game.title || '?')[0]),
      h('div.a-name', game.title),
      dropdown({
        label: 'Profile',
        value: assigned[game.id] || '__none__',
        options: [
          { value: '__none__', label: 'Auto (Default)' },
          ...list.map((p) => ({ value: p.id, label: p.name })),
        ],
        onPick: async (v) => {
          const map = { ...assigned };
          if (v === '__none__') delete map[game.id];
          else map[game.id] = v;
          await settings.set('input.gameProfiles', map);
          await window.nexus.profiles.assignGame(game.id, v === '__none__' ? null : v);
          toastOk(t('profile_saved'), v === '__none__' ? 'Auto' : list.find((p) => p.id === v)?.name);
        },
        className: 'dd-inline',
      }),
    ]))),
    played.length ? null : h('p.muted.mt-8', 'Showing popular titles — play a game once and it appears here for easy binding.'),
  ].filter(Boolean));
}

// ---------- Section: Sensitivity & deadzones ----------
function aimSection(ctx) {
  return h('div.panel', [
    h('h3', 'Sensitivity & Deadzones'),
    h('p.p-desc', 'Applies to a real controller. Mouse aiming lives under Keyboard & Mouse.'),
    cfgSliderRow('Left Stick Deadzone', 'stick', 'leftDeadzone', 0, 0.5, 0.01, (v) => v.toFixed(2)),
    cfgSliderRow('Right Stick Deadzone', 'stick', 'rightDeadzone', 0, 0.5, 0.01, (v) => v.toFixed(2)),
    cfgPickRow('Response Curve', 'stick', 'responseCurve', CURVE_OPTIONS),
    cfgSwitchRow('Invert Right Stick Y', 'stick', 'invertY'),
  ]);
}

// ---------- Section: Input devices ----------
function devicesSection(ctx) {
  const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter((p) => p && p.connected) : [];
  return h('div.panel', [
    h('h3', 'Input Devices'),
    h('p.p-desc', 'Controllers detected by the launcher. Games always receive controller input — physical or emulated.'),
    pads.length
      ? h('div', pads.map((p) => h('div.device-row', [
          icon('controller', { size: 18 }),
          h('div.grow', [h('div.r-title', String(p.id).slice(0, 60)), h('div.r-desc', `Index ${p.index} · mapping ${p.mapping || 'standard'}`)]),
          h('span.status-chip.ok', [h('span.dot'), 'Connected']),
        ])))
      : h('div.empty', [icon('controller', { size: 36 }), h('div.e-title', t('no_controller'))]),
    h('div.row.compact', [
      h('div.r-main', [h('div.r-title', 'Keyboard & Mouse emulation'), h('div.r-desc', t('kbm_section_desc', { key: settings.get('input.kbmToggleKey', 'F8') }))]),
      switchControl('input.kbmEnabled', settings.get('input.kbmEnabled'), () => {}),
    ]),
    testPanel(ctx),
  ]);
}

// ---------- Section: Advanced ----------
function advancedSection(ctx) {
  return h('div.panel', [
    h('h3', 'Advanced Input'),
    h('p.p-desc', 'Diagnostics and rarely-changed behaviour.'),
    h('div.row.compact', [
      h('div.r-main', [h('div.r-title', 'In-game toggle hotkey'), h('div.r-desc', 'Toggles keyboard & mouse emulation inside a running game.')]),
      h('button.btn.sm', {
        onclick: async () => {
          const code = await captureKey();
          if (!code) return;
          await settings.set('input.kbmToggleKey', code);
          toastOk(t('saved'), code);
          ctx.repaint();
        },
      }, h('span.kbd', settings.get('input.kbmToggleKey', 'F8'))),
    ]),
    h('div.row.compact', [
      h('div.r-main', [h('div.r-title', 'Show stream statistics'), h('div.r-desc', 'Bitrate and latency overlay inside the game window.')]),
      switchControl('input.showStreamStats', settings.get('input.showStreamStats'), () => {}),
    ]),
    h('div.row.compact', [
      h('div.r-main', [h('div.r-title', 'Conflict check'), h('div.r-desc', 'List every key bound to more than one input.')]),
      h('button.btn.sm', { onclick: () => showConflicts(ctx) }, 'Run check'),
    ]),
    h('div.row.compact', [
      h('div.r-main', [h('div.r-title', 'Reset all controls'), h('div.r-desc', 'Restore every profile and per-game binding to defaults.')]),
      h('button.btn.sm.danger', { onclick: () => resetAllControls(ctx) }, 'Reset'),
    ]),
    h('div.attrib.mt-16', t('about_bx')),
  ]);
}

async function captureKey() {
  return new Promise((resolve) => {
    const handler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { done(null); return; }
      const c = captureFromEvent(e);
      if (!c || c.blocked) return;
      done(c.code);
    };
    const done = (v) => { document.removeEventListener('keydown', handler, true); resolve(v); };
    document.addEventListener('keydown', handler, true);
    toastInfo('Press a key…', 'Esc to cancel');
  });
}

// ---------- Input test ----------
function testPanel(ctx) {
  const profile = activeProfile();
  const mapping = sanitizeMapping(profile?.mapping);
  const grid = h('div.testpad');
  const cells = new Map();
  const timers = new Map();

  for (const btn of BUTTONS) {
    const bind = mapping[btn.id];
    const cell = h('div.tp-cell', { dataset: { btn: btn.id } }, [
      h('div.tp-name', btn.label),
      h('div.tp-key', bind ? bindLabel(bind) : '—'),
      h('div.tp-live', h('div.fill')),
    ]);
    cells.set(btn.id, cell);
    grid.appendChild(cell);
  }

  const keyToBtn = new Map();
  for (const btn of BUTTONS) {
    const b = mapping[btn.id];
    if (b) keyToBtn.set(b.code, btn.id);
  }

  const detected = h('span.det-value', '—');
  const mappedTo = h('span.det-value', '—');
  const clearBtn = h('button.btn.sm', {
    onclick: () => {
      for (const [id, t2] of timers) { clearTimeout(t2); cells.get(id)?.classList.remove('lit'); }
      timers.clear();
      detected.textContent = '—';
      mappedTo.textContent = '—';
    },
  }, 'Clear Input');

  const light = (btnId) => {
    const cell = cells.get(btnId);
    if (!cell) return;
    cell.classList.add('lit');
    cell.querySelector('.fill').style.transform = 'scaleX(1)';
    clearTimeout(timers.get(btnId));
    timers.set(btnId, setTimeout(() => {
      cell.classList.remove('lit');
      cell.querySelector('.fill').style.transform = 'scaleX(0)';
      timers.delete(btnId);
    }, 260));
  };

  const report = (code) => {
    detected.textContent = code ? bindLabel({ code }) : '—';
    const ids = keyToBtn.get(code);
    mappedTo.textContent = ids ? `${buttonLabel(ids)} Button` : 'Not mapped';
  };

  const keyListener = (e) => {
    const capture = captureFromEvent(e);
    if (!capture || capture.blocked) return;
    if (listening) return;                    // the remap flow owns this key
    report(capture.code);
    const btnId = keyToBtn.get(capture.code);
    if (btnId) { e.preventDefault(); light(btnId); }
  };
  document.addEventListener('keydown', keyListener);
  const mouseListener = (e) => {
    const capture = captureFromEvent(e);
    if (!capture || !isMouseCode(capture.code)) return;
    if (listening) return;
    report(capture.code);
    const btnId = keyToBtn.get(capture.code);
    if (btnId) light(btnId);
  };
  document.addEventListener('mousedown', mouseListener, true);

  // Live controller input, polled only while this panel exists.
  const stopWatch = watch((snap) => {
    if (!snap) return;
    for (const b of snap.buttons) {
      const id = PAD_INDEX_TO_BTN[b.index];
      const cell = id && cells.get(id);
      if (!cell) continue;
      if (b.value > 0.25) {
        cell.classList.add('lit');
        cell.querySelector('.fill').style.transform = `scaleX(${Math.max(0, Math.min(1, b.value))})`;
      } else if (!timers.has(id)) {
        cell.classList.remove('lit');
        cell.querySelector('.fill').style.transform = 'scaleX(0)';
      }
    }
  });

  const teardown = () => {
    document.removeEventListener('keydown', keyListener);
    document.removeEventListener('mousedown', mouseListener, true);
    for (const t2 of timers.values()) clearTimeout(t2);
    stopWatch();
  };
  ctx.onLeave(teardown);

  return h('div.panel.test-panel', [
    h('div.panel-head', [
      h('div', [h('h3', t('test_mode')), h('p.p-desc', 'Press any button, key or mouse button to test.')]),
      h('span.status-chip.ok', [h('span.dot'), 'Working']),
    ]),
    h('div.detect-row', [
      h('div.detect-box', [icon('sparkle', { size: 16 }), h('span.det-label', t('detected')), detected]),
      h('div.detect-box', [icon('controller', { size: 16 }), h('span.det-label', t('maps_to')), mappedTo]),
      clearBtn,
    ]),
    grid,
  ]);
}

// ---------- Game-scoped entry points ----------
/**
 * Open the controls screen focused on one game: the profile it will launch with
 * is selected, and the per-game override dropdown is bound to that game. This is
 * what the launch panel's "Configure Controls" button uses.
 */
export function configureControlsForGame(gameId, ctx) {
  gameCtxId = gameId || null;
  section = 'controller';
  const override = (settings.get('input.gameProfiles', {}) || {})[gameCtxId];
  setProfileId(override || settings.get('input.activeProfile') || profiles()[0]?.id || null);
  ctx.navigate('controls');
}

/** Mouse settings of a specific profile (defaults to the active one). */
export function mouseSettingsOf(pid) {
  const base = settings.get('input.mouse', {}) || {};
  const p = profiles().find((x) => x.id === pid) || activeProfile();
  return { ...base, ...((p && p.mouse) || {}) };
}

/** Write mouse settings straight into a specific profile — used by the launch panel. */
export async function patchProfileMouse(pid, patch) {
  const list = profiles();
  const p = list.find((x) => x.id === pid) || activeProfile();
  for (const [k, v] of Object.entries(patch)) await settings.set(`input.mouse.${k}`, v);
  if (!p) return null;
  const next = { ...p, mouse: { ...(p.mouse || {}), ...patch } };
  await settings.set('input.profiles', list.map((x) => (x.id === p.id ? next : x)));
  return next;
}

/** Every remappable input, grouped for pickers. */
export function buttonGroups() {
  return { ...GROUP_TITLE };
}

// ---------- View ----------
export function createView(ctx) {
  return {
    id: 'controls',
    render(root) {
      const page = h('div.page');
      root.appendChild(page);
      leaveHooks = [];

      const localCtx = {
        ...ctx,
        gameId: gameCtxId,
        repaint: () => {
          for (const fn of leaveHooks) { try { fn(); } catch { /* ignore */ } }
          leaveHooks = [];
          clear(page);
          paint();
        },
        onLeave: (fn) => { leaveHooks.push(fn); return () => { const i = leaveHooks.indexOf(fn); if (i >= 0) leaveHooks.splice(i, 1); }; },
      };
      repaint = localCtx.repaint;

      const paint = () => {
        if (!profileId || !profiles().some((p) => p.id === profileId)) {
          setProfileId(settings.get('input.activeProfile') || profiles()[0]?.id || null);
        }
        if (section !== 'controller') { disarm(); }

        const nav = h('nav.controls-nav', { 'aria-label': 'Controls sections' }, SECTIONS.map((s) => h(
          `button.controls-nav-item${section === s.id ? '.active' : ''}`,
          { onclick: () => { section = s.id; localCtx.repaint(); } },
          [icon(s.iconName, { size: 17 }), s.label]
        )));

        let body;
        switch (section) {
          case 'kbm': body = kbmPanel(localCtx, api); break;
          case 'profiles': body = profilesSection(localCtx); break;
          case 'pergame': body = perGameSection(localCtx); break;
          case 'aim': body = aimSection(localCtx); break;
          case 'devices': body = devicesSection(localCtx); break;
          case 'advanced': body = advancedSection(localCtx); break;
          default: body = controllerSection(localCtx);
        }

        page.appendChild(h('div.controls-wrap', [nav, h('div.controls-body', body)]));

        if (section === 'controller' && diagram) {
          requestAnimationFrame(() => diagram.layout?.());
          refreshConflictBadge();
        }
      };

      paint();
      const removeCapture = installCapture(localCtx);
      const onResize = () => diagram?.layout?.();
      window.addEventListener('resize', onResize, { passive: true });

      return () => {
        window.removeEventListener('resize', onResize);
        disarm();
        removeCapture();
        for (const fn of leaveHooks) { try { fn(); } catch { /* ignore */ } }
        leaveHooks = [];
        diagram = null;
        rowNodes = new Map();
      };
    },
  };
}