/**
 * Controls screen panels — the parts that sit beside the controller artwork:
 * the Control Profiles rail, the live "Test Your Controls" card, Quick Actions,
 * and the Keyboard & Mouse panel (keyboard visual, mouse visual, mouse tuning).
 *
 * These are split out of controls.js so the always-visible screen stays
 * readable. Everything stateful (which profile is selected, how a binding is
 * written, when to repaint) is injected through `api`, so there is exactly one
 * owner of that state and no import cycle.
 */
import { h, clear, raf } from '../dom.js';
import { icon } from '../icons.js';
import { settings } from '../store.js';
import { t } from '../i18n.js';
import { toastOk, toastInfo } from '../toast.js';
import { BUTTONS, bindLabel, sanitizeMapping, keyCodeForGlyph } from '../buttons.js';

/** The keyboard rows drawn by the visual (glyph-per-key, physical layout). */
export const KEY_ROWS = [
  { w: 1, keys: ['Esc', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'] },
  { w: 1.2, keys: ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'Backspace'] },
  { w: 1.5, keys: ['Tab', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', '\\'] },
  { w: 1.75, keys: ['Caps', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", 'Enter'] },
  { w: 2.25, keys: ['Shift', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', 'Shift'] },
  { w: 2.75, keys: ['Ctrl', 'Win', 'Alt', 'Space', 'Alt', 'Win', 'Menu', 'Ctrl'] },
];

/** Mouse buttons that can drive controller inputs. */
export const MOUSE_BTNS = [
  { code: 'Mouse0', label: 'Left Click', cls: 'mv-left' },
  { code: 'Mouse2', label: 'Right Click', cls: 'mv-right' },
  { code: 'Mouse1', label: 'Middle Click', cls: 'mv-mid' },
  { code: 'Mouse3', label: 'Mouse 4', cls: 'mv-side1' },
  { code: 'Mouse4', label: 'Mouse 5', cls: 'mv-side2' },
];

const SECTION_META = {
  controller: { label: 'Controller Mapping', icon: 'controller' },
  kbm: { label: 'Keyboard & Mouse', icon: 'keyboard' },
  profiles: { label: 'Control Profiles', icon: 'layers' },
  pergame: { label: 'Per-Game Profiles', icon: 'gamepad' },
  aim: { label: 'Sensitivity & Deadzones', icon: 'gauge' },
  devices: { label: 'Input Devices', icon: 'plug' },
  advanced: { label: 'Advanced Input', icon: 'wand' },
};

/** Glyph -> code, so the visual and the binding model can never disagree. */
export function usedCodeGlyph(code) {
  const row = KEY_ROWS.flatMap((r) => r.keys).find((g) => keyCodeForGlyph(g) === code);
  return row || code.replace(/^Key|^Digit/, '');
}

// ---------------------------------------------------------------- profiles rail
/**
 * Compact Control Profiles list for the right rail: the active profile first,
 * one click to switch, and the manage actions kept one level down so the rail
 * never turns into a wall of buttons.
 */
export function profilesRail(ctx, api) {
  const list = api.profiles();
  const activeId = settings.get('input.activeProfile');
  const selected = api.activeProfile();
  const items = h('div.rail-profile-list');

  for (const p of list) {
    const bound = Object.values(sanitizeMapping(p.mapping)).filter(Boolean).length;
    const isActive = p.id === activeId;
    items.appendChild(h(`button.rail-profile${p.id === selected?.id ? '.selected' : ''}${isActive ? '.is-active' : ''}`, {
      type: 'button',
      'aria-pressed': isActive ? 'true' : 'false',
      title: isActive ? `${p.name} — active profile` : `Use ${p.name}`,
      onclick: async () => {
        if (isActive) { api.setProfileId(p.id); ctx.repaint(); return; }
        await settings.set('input.activeProfile', p.id);
        api.setProfileId(p.id);
        toastOk('Active profile', p.name);
        ctx.repaint();
      },
    }, [
      h('span.rp-ico', icon(p.builtin ? 'shield' : 'layers', { size: 15 })),
      h('div.rp-text', [h('div.rp-name', p.name), h('div.rp-meta', `${bound} bindings`)]),
      isActive
        ? h('span.rp-flag', [h('span.dot'), 'Active'])
        : h('span.rp-flag.muted', 'Custom'),
      h('span.rp-chev', icon('chevronRight', { size: 14 })),
    ]));
  }

  return h('div.panel.panel-tight.rail-card', [
    h('div.mini-head', [
      icon('layers', { size: 15 }),
      h('h4', 'Control Profiles'),
      h('button.linkbtn', { type: 'button', onclick: () => api.go('profiles') }, 'Manage'),
    ]),
    items,
    h('div.rail-actions', [
      h('button.btn.sm.primary', { onclick: () => api.createProfile(ctx) }, icon('plus', { size: 14 }), 'Create Profile'),
      h('button.btn.sm', { onclick: () => api.importProfile(ctx) }, icon('upload', { size: 14 }), 'Import / Export'),
    ]),
  ]);
}

// ------------------------------------------------------------- live test card
/**
 * "Test Your Controls" — a live readout of what the translation layer sees.
 * It is deliberately always on screen next to the artwork: press anything and
 * both the card and the controller light up, which is the fastest way to prove
 * that a binding actually landed.
 */
export function testCard(ctx, api) {
  const detected = h('span.tv-value', '—');
  const mappedTo = h('span.tv-value', '—');
  const padEl = h('div.live-pad');
  let litTimer = null;

  // The lookup is resolved per event, never cached at render time: a key that
  // was remapped a second ago must light up immediately instead of reporting
  // "not mapped".
  let cacheKey = null;
  let cachedLookup = new Map();
  const lookup = () => {
    const m = api.mapping();
    if (cacheKey === m) return cachedLookup;
    cacheKey = m;
    cachedLookup = new Map();
    for (const btn of BUTTONS) {
      const code = m[btn.id]?.code;
      if (code) cachedLookup.set(code, btn.id);
    }
    return cachedLookup;
  };
  const padToBtn = api.padToBtn;

  const showPad = (on) => {
    padEl.classList.toggle('on', !!on);
    if (on) { clearTimeout(litTimer); litTimer = setTimeout(() => padEl.classList.remove('on'), 400); }
  };

  const stopPad = api.watch((snap) => {
    if (!snap) return;
    for (const b of snap.buttons) {
      if (b.value <= 0.25) continue;
      const id = padToBtn[b.index];
      if (!id) continue;
      showPad(true);
      api.flash(id, 240);
      detected.textContent = api.padLabel(id);
      mappedTo.textContent = bindLabel(api.mapping()[id]) || '—';
      break;
    }
    if (snap.axes && (Math.abs(snap.axes[0]) > 0.35 || Math.abs(snap.axes[1]) > 0.35)) {
      api.flash(snap.axes[0] > 0.35 ? 'gamepadLSR' : snap.axes[0] < -0.35 ? 'gamepadLSL' : snap.axes[1] > 0.35 ? 'gamepadLSD' : 'gamepadLSU', 240);
    }
    if (snap.axes && (Math.abs(snap.axes[2]) > 0.35 || Math.abs(snap.axes[3]) > 0.35)) {
      api.flash(snap.axes[2] > 0.35 ? 'gamepadRSR' : snap.axes[2] < -0.35 ? 'gamepadRSL' : snap.axes[3] > 0.35 ? 'gamepadRSD' : 'gamepadRSU', 240);
    }
  });

  const onKey = (e) => {
    if (api.isListening()) return;
    const code = e.code;
    if (!code) return;
    showPad(true);
    detected.textContent = bindLabel({ code, key: e.key }) || code;
    const btnId = lookup().get(code);
    mappedTo.textContent = btnId ? `${api.padLabel(btnId)}` : 'Not mapped';
    if (btnId) api.flash(btnId, 240);
  };
  const onMouse = (e) => {
    if (api.isListening()) return;
    const code = `Mouse${e.button}`;
    if (e.button > 4) return;
    showPad(true);
    detected.textContent = bindLabel({ code }) || code;
    const btnId = lookup().get(code);
    mappedTo.textContent = btnId ? `${api.padLabel(btnId)}` : 'Not mapped';
    if (btnId) api.flash(btnId, 240);
    if (api.mouseDrivesStick()) {
      detected.textContent = bindLabel({ code }) || code;
      mappedTo.textContent = 'Right Stick (mouse)';
      api.flash('gamepadRS', 240);
    }
  };
  // Mouse movement is translated to the right stick, so the artwork should
  // follow the pointer: this is the visible proof of the headline feature.
  // Throttled through dom.js raf(), which keeps a timer fallback for windows
  // the compositor has stopped drawing.
  let pendingMove = null;
  const paintMove = raf(() => {
    const e = pendingMove;
    pendingMove = null;
    if (!e) return;
    const dx = e.movementX || 0;
    const dy = e.movementY || 0;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
    const id = Math.abs(dx) > Math.abs(dy)
      ? (dx > 0 ? 'gamepadRSR' : 'gamepadRSL')
      : (dy > 0 ? 'gamepadRSD' : 'gamepadRSU');
    api.flash(id, 180);
    detected.textContent = 'Mouse move';
    mappedTo.textContent = 'Right Stick';
  });
  const onMove = (e) => {
    if (api.isListening() || !api.mouseDrivesStick()) return;
    pendingMove = e;
    paintMove();
  };

  document.addEventListener('keydown', onKey, true);
  document.addEventListener('mousedown', onMouse, true);
  document.addEventListener('mousemove', onMove, { passive: true });
  ctx.onLeave(() => {
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mousedown', onMouse, true);
    document.removeEventListener('mousemove', onMove);
    clearTimeout(litTimer);
    stopPad();
  });

  return h('div.panel.panel-tight.rail-card', [
    h('div.mini-head', [icon('wand', { size: 15 }), h('h4', 'Test Your Controls')]),
    h('p.rail-desc', 'Press any button, key or move the mouse to test.'),
    h('div.rail-test-row', [
      h('div.live-pad', [h('span.lp-ring'), icon('controller', { size: 16 })]),
      h('div.rail-test-values', [
        h('div.tv-line', [h('span.tv-label', t('detected')), detected]),
        h('div.tv-line', [h('span.tv-label', t('maps_to')), mappedTo]),
      ]),
    ]),
    h('div.rail-test-foot', [
      h('button.btn.sm', {
        onclick: () => { detected.textContent = '—'; mappedTo.textContent = '—'; },
      }, 'Clear Input'),
      h('span.status-chip.ok', [h('span.dot'), 'Working']),
    ]),
  ]);
}

// --------------------------------------------------------------- quick actions
export function quickActionsCard(ctx, api) {
  const actions = [
    { id: 'reset-profile', icon: 'refresh', label: 'Reset Current Profile' },
    { id: 'reset-all', icon: 'controller', label: 'Reset All Controls' },
    { id: 'conflicts', icon: 'alert', label: 'Conflict Check', badge: true },
    { id: 'export', icon: 'upload', label: 'Export Profile' },
    { id: 'import', icon: 'download', label: 'Import Profile' },
  ];
  const list = h('div.quick-actions', actions.map((a) => h('button.quick-item', {
    type: 'button',
    dataset: { action: a.id },
    onclick: () => api.runQuickAction(a.id, ctx),
  }, [
    h('span.qa-ico', icon(a.icon, { size: 15 })),
    h('span.qa-label', a.label),
    a.badge ? h('span.qa-badge') : null,
  ].filter(Boolean))));
  api.registerConflictBadge(list.querySelector('.quick-item[data-action="conflicts"] .qa-badge'));
  return h('div.panel.panel-tight.rail-card', [
    h('div.mini-head', [icon('bolt', { size: 15 }), h('h4', 'Quick Actions')]),
    list,
  ]);
}

// ------------------------------------------------- Keyboard & Mouse panel
function keyUsage(mapping) {
  const map = new Map();
  for (const b of BUTTONS) {
    const code = mapping[b.id]?.code;
    if (!code) continue;
    const arr = map.get(code) || [];
    arr.push(b.label);
    map.set(code, arr);
  }
  return map;
}

/** Clicking a key: jump to its controller input, or offer to bind it. */
function keyClick(ctx, api, code, glyph, used, mapping) {
  if (used && used.length) {
    const owner = BUTTONS.find((b) => mapping[b.id]?.code === code);
    if (owner) { api.selectForRemap(owner.id); return; }
  }
  api.chooseTarget(ctx, code, glyph);
}

function keyboardVisual(ctx, api, mapping, usage) {
  return h('div.keyboard', KEY_ROWS.map((row) => h('div.kb-row', { style: { '--kw': String(row.w) } },
    row.keys.map((glyph) => {
      const code = keyCodeForGlyph(glyph);
      const used = code ? usage.get(code) : null;
      return h(`button.kb-key${used ? '.bound' : ''}`, {
        type: 'button',
        dataset: { code: code || '' },
        title: used ? `${glyph} → ${used.join(', ')}` : `${glyph} — unassigned`,
        onclick: () => {
          if (!code) { toastInfo('Not remappable', `${glyph} is reserved by the system.`); return; }
          keyClick(ctx, api, code, glyph, used, mapping);
        },
      }, [h('span.kb-glyph', glyph), used ? h('span.kb-bind', used[0]) : null].filter(Boolean));
    })
  )));
}

function mouseVisual(ctx, api, mapping, usage) {
  const shell = h('div.mouse-shell', [h('div.ms-body'), h('div.ms-wheel'), h('div.ms-glide')]);
  const host = h('div.mouse-visual', [shell]);
  for (const b of MOUSE_BTNS) {
    const used = usage.get(b.code);
    host.appendChild(h(`button.mv-hot.${b.cls}${used ? '.bound' : ''}`, {
      type: 'button',
      title: used ? `${b.label} → ${used.join(', ')}` : `${b.label} — click to assign`,
      onclick: () => keyClick(ctx, api, b.code, b.label, used, mapping),
    }, [h('span.mv-label', b.label), used ? h('span.mv-bind', used[0]) : null].filter(Boolean)));
  }
  return h('div.mouse-wrap', host);
}

/** The always-visible Mouse Settings card (the values the game receives). */
export function mouseSettingsCard(api) {
  return h('div.mouse-panel.mouse-card', [
    h('div.mini-head', [icon('mouse', { size: 15 }), h('h4', 'Mouse Settings')]),
    api.cfgSwitchRow('Mouse drives right stick', 'mouse', 'enabled', 'Turn off to use the mouse buttons only.'),
    api.cfgSliderRow('Mouse Sensitivity', 'mouse', 'sensitivity', 0.1, 4, 0.05, (v) => `${Math.round(v * 100)}%`),
    api.cfgSliderRow('Horizontal Sensitivity', 'mouse', 'sensitivityX', 0, 3, 0.05, (v) => `${Math.round(v * 100)}%`),
    api.cfgSliderRow('Vertical Sensitivity', 'mouse', 'sensitivityY', 0, 3, 0.05, (v) => `${Math.round(v * 100)}%`),
    api.cfgSwitchRow('Invert Y Axis', 'mouse', 'invertY', 'Flip vertical aiming.'),
    api.cfgSwitchRow('Mouse Smoothing', 'mouse', 'smoothingEnabled', 'Removes pointer jitter at the cost of a little lag.'),
    api.cfgSliderRow('Mouse Deadzone', 'mouse', 'deadzone', 0, 0.4, 0.01, (v) => v.toFixed(2)),
    api.cfgSwitchRow('Stick Acceleration', 'mouse', 'acceleration', 'Input scales with pointer speed.'),
    api.cfgPickRow('Response Curve', 'mouse', 'responseCurve', api.curveOptions),
  ]);
}

function advancedNote(ctx, api) {
  const cfg = api.mouseCfg();
  const stick = api.stickCfg();
  return h('div.kbm-advanced', [
    h('div.row.compact', [
      h('div.r-main', [
        h('div.r-title', 'How keyboard & mouse play works'),
        h('div.r-desc', 'Your keys drive a virtual Xbox controller inside the game. Every title that accepts a controller — including ones with no keyboard support of their own — can be played from the keyboard and mouse.'),
      ]),
      h('span.status-chip.ok', [h('span.dot'), cfg.enabled !== false ? 'Active' : 'Off']),
    ]),
    h('div.assign-hint', `Right stick ← mouse · curve ${cfg.responseCurve || 'linear'} · deadzone ${Math.round((Number(cfg.deadzone) || 0) * 100)}% · smoothing ${Math.round((Number(cfg.smoothing) || 0) * 100)}%`),
    h('div.assign-hint', `Left/right stick deadzone ${(Number(stick.leftDeadzone) || 0).toFixed(2)} / ${(Number(stick.rightDeadzone) || 0).toFixed(2)} — tuned under Sensitivity & Deadzones.`),
    h('div.row.compact', [
      h('div.r-main', [h('div.r-title', 'In-game toggle key'), h('div.r-desc', 'Press inside a game to switch keyboard & mouse emulation on or off without leaving the stream.')]),
      h('span.kbd', settings.get('input.kbmToggleKey', 'F8')),
    ]),
    h('button.btn.sm', { onclick: () => api.go('advanced') }, 'Open advanced input settings'),
  ]);
}

/**
 * Keyboard & Mouse Mapping. `embedded` renders it inside the mapping screen
 * (artwork visible, tab body beside the mouse settings), while the standalone
 * route uses the same components full width.
 */
export function kbmPanel(ctx, api, { embedded = false } = {}) {
  const mapping = api.mapping();
  const usage = keyUsage(mapping);

  let tab = 'keyboard';
  const tabsHost = h('div.kbm-tabs');
  const bodyHost = h('div.kbm-body');
  const bodies = {
    keyboard: () => h('div.kbm-tab-body', keyboardVisual(ctx, api, mapping, usage)),
    mouse: () => h('div.kbm-tab-body', mouseVisual(ctx, api, mapping, usage)),
    advanced: () => advancedNote(ctx, api),
  };
  const render = () => {
    clear(tabsHost);
    tabsHost.appendChild(api.segmented([
      { value: 'keyboard', label: 'Keyboard' },
      { value: 'mouse', label: 'Mouse' },
      { value: 'advanced', label: 'Advanced' },
    ], tab, (v) => { tab = v; render(); }));
    clear(bodyHost);
    bodyHost.appendChild(bodies[tab]());
  };
  render();

  const head = h('div.mini-head', [icon('keyboard', { size: 15 }), h('h4', 'Keyboard & Mouse Mapping')]);
  const split = h('div.kbm-split', [
    h('div.kbm-left', [tabsHost, bodyHost]),
    h('div.kbm-right', mouseSettingsCard(api)),
  ]);

  if (embedded) return h('div.panel.panel-flush.kbm-panel', [head, split]);
  return h('div.panel', [
    h('div.panel-head', [h('div', [h('h3', 'Keyboard & Mouse Mapping'),
      h('p.p-desc', 'Green keys and mouse buttons are bound to a controller input. Click one to remap it, or click an unbound key to assign it.')])]),
    split,
  ]);
}

export { SECTION_META };
