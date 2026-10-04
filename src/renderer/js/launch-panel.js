/**
 * Pre-launch panel.
 *
 * Everything a player needs right before a game starts, in one sheet: the
 * profile the game will use, controller ⇄ keyboard & mouse, the mouse aiming
 * settings that are translated into right-stick input, and display options.
 * "Configure Controls" opens the full remapper scoped to this game.
 *
 * Every control here writes through the same helpers the Controls screen uses,
 * so what you set is exactly what the stream bridge ships to Better xCloud.
 */
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { settings } from './store.js';
import { openModal } from './modal.js';
import { toastOk } from './toast.js';
import { sfx } from './sfx.js';
import { dropdown, slider, toggle } from './ui-kit.js';
import { portraitArt } from './catalog.js';
import * as cat from './catalog.js';
import { profiles, configureControlsForGame, mouseSettingsOf, patchProfileMouse } from './views/controls.js';

const RESOLUTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
  { value: '1080p-hq', label: '1080p HQ' },
];

const CURVES = [
  { value: 'linear', label: 'Linear' },
  { value: 'expo', label: 'Exponential' },
  { value: 'classic', label: 'Classic' },
];

function line(label, desc, control) {
  return h('div.lp-row', [
    h('div.r-main', [h('div.r-title', label), desc ? h('div.r-desc', desc) : null].filter(Boolean)),
    control,
  ]);
}

/**
 * @param {{id:string,title?:string,art?:object}} game
 * @param {{navigate:Function}} ctx
 * @returns {Promise<boolean>} whether the game was launched
 */
export async function openLaunchPanel(game, ctx) {
  if (!game?.id) return false;
  const assigned = settings.get('input.gameProfiles', {}) || {};
  let profileId = assigned[game.id] || settings.get('input.activeProfile') || profiles()[0]?.id || null;
  let mouseOn = settings.get('input.kbmEnabled') !== false;
  const lowEnd = settings.get('performance.lowEnd') === true;

  const body = h('div.launch-panel');
  const controlsHost = h('div.lp-controls');

  const profileDd = dropdown({
    label: 'Control profile',
    value: profileId,
    options: [
      { value: '__auto__', label: 'Automatic', sub: 'Uses the active profile' },
      ...profiles().map((p) => ({ value: p.id, label: p.name, sub: p.id === settings.get('input.activeProfile') ? 'Active' : 'Per-game' })),
    ],
    onPick: async (id) => {
      if (id === '__auto__') delete assigned[game.id];
      else assigned[game.id] = id;
      await settings.set('input.gameProfiles', { ...assigned });
      await window.nexus.profiles.assignGame(game.id, id === '__auto__' ? null : id);
      profileId = id === '__auto__' ? (settings.get('input.activeProfile') || profiles()[0]?.id) : id;
      toastOk(t('saved'), 'This game uses ' + (profiles().find((p) => p.id === profileId)?.name || 'the active profile'));
      paintControls();
    },
    className: 'dd-launch',
  });

  const modeBar = h('div.seg.seg-lg', [
    h(`button${!mouseOn ? '.on' : ''}`, {
      onclick: async () => {
        mouseOn = false;
        await settings.set('input.kbmEnabled', false);
        for (const b of modeBar.children) b.classList.remove('on');
        modeBar.children[0].classList.add('on');
        paintControls();
      },
    }, [icon('controller', { size: 16 }), 'Controller']),
    h(`button${mouseOn ? '.on' : ''}`, {
      onclick: async () => {
        mouseOn = true;
        await settings.set('input.kbmEnabled', true);
        for (const b of modeBar.children) b.classList.remove('on');
        modeBar.children[1].classList.add('on');
        paintControls();
      },
    }, [icon('keyboard', { size: 16 }), 'Keyboard & Mouse']),
  ]);

  /** Mouse aiming rows, bound to the profile this game will launch with. */
  function paintControls() {
    clear(controlsHost);
    const cfg = mouseSettingsOf(profileId);
    const write = (patch) => patchProfileMouse(profileId, patch);

    if (mouseOn) {
      const enabled = cfg.enabled !== false;
      controlsHost.appendChild(line('Mouse aims', 'Mouse movement drives the right stick in every game.', toggle({
        value: enabled,
        onChange: async (v) => {
          await write({ enabled: v });
          driveChip.textContent = v ? 'Mouse → right stick' : 'Mouse buttons only';
        },
      })));
      controlsHost.appendChild(line('Mouse sensitivity', null, slider({
        value: Number(cfg.sensitivity ?? 1), min: 0.1, max: 4, step: 0.05,
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => write({ sensitivity: v }),
      })));
      controlsHost.appendChild(line('Horizontal', null, slider({
        value: Number(cfg.sensitivityX ?? 1), min: 0, max: 3, step: 0.05,
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => write({ sensitivityX: v }),
      })));
      controlsHost.appendChild(line('Vertical', null, slider({
        value: Number(cfg.sensitivityY ?? 1), min: 0, max: 3, step: 0.05,
        format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => write({ sensitivityY: v }),
      })));
      controlsHost.appendChild(line('Invert Y', null, toggle({
        value: !!cfg.invertY,
        onChange: (v) => write({ invertY: v }),
      })));
      controlsHost.appendChild(line('Response curve', null, dropdown({
        label: 'Response curve',
        value: CURVES.some((c) => c.value === cfg.responseCurve) ? cfg.responseCurve : 'linear',
        options: CURVES,
        onPick: (v) => write({ responseCurve: v }),
        className: 'dd-inline',
      })));
    } else {
      controlsHost.appendChild(h('p.p-desc',
        'Controller mode sends your gamepad through untouched. Switch to Keyboard & Mouse to play with keys and mouse through Better xCloud — it works even for controller-only games.'));
    }
  }

  const driveChip = h('span.status-chip', [h('span.dot'), mouseOn ? 'Mouse → right stick' : 'Mouse buttons only']);
  const adSupported = cat.hasAds(game.id);
  const access = cat.accessFor(game);

  body.append(
    h('div.lp-head', [
      portraitArt(game) ? h('img.lp-art', { src: portraitArt(game), alt: '' }) : null,
      h('div.grow', [
        h('div.lp-title', game.title || t('play_now')),
        h('div.r-desc', 'Keyboard & mouse works on every cloud game, including controller-only titles.'),
      ]),
    ].filter(Boolean)),
    // Free-with-ads titles are paid for by an Xbox-served pre-roll. Say so once:
    // when the access line below already *is* the ad answer (state 'ads'), a
    // second ad row read as a contradiction — the same game advertised as free
    // with ads and, next to it, as not in the plan.
    adSupported && access.state !== 'ads'
      ? h('div.lp-adrow', [icon('ads', { size: 15 }), h('span', 'Free with ads — Xbox plays a short ad in the game window before your session starts. It is what makes this title free, so let it finish.')])
      : null,
    // What this account may actually do with the title, in plain words.
    h(`div.lp-access${access.play === false ? '.blocked' : ''}`, [
      icon(access.play === false ? 'lock' : 'badge', { size: 15 }),
      h('div.grow', [
        h('div.lp-access-title', access.label),
        h('div.r-desc', access.reason),
      ]),
    ]),
    h('div.lp-group', [h('div.lp-group-title', 'Controls profile'), profileDd]),
    h('div.lp-group', [h('div.lp-group-title', 'Input'), modeBar, driveChip]),
    h('div.lp-group', controlsHost),
    h('div.lp-group', [
      h('div.lp-group-title', 'Display'),
      line('Fullscreen', 'Games open fullscreen. Press F11 to toggle any time.',
        toggle({
          value: settings.get('cloud.fullscreenOnPlay') !== false,
          onChange: (v) => settings.set('cloud.fullscreenOnPlay', v),
        })),
      line('Target resolution', lowEnd ? 'Low-end mode is on: 1080p and WebGL2 stay off.' : 'The stream adapts to your connection.',
        dropdown({
          label: 'Target resolution',
          value: settings.get('cloud.targetResolution', 'auto'),
          options: RESOLUTIONS.map((r) => (lowEnd && r.value !== 'auto' ? { ...r, disabled: true } : r)),
          onPick: (v) => { settings.set('cloud.targetResolution', v); toastOk(t('saved'), v); },
          className: 'dd-inline',
        })),
    ]),
  );

  paintControls();

  const choice = await openModal({
    // Not "Launching…": nothing has launched yet. The panel is a confirmation,
    // and the title claimed otherwise, so a player who opened it to change a
    // setting saw a progress state that never progressed.
    title: game.title ? 'Ready — ' + game.title : t('play_now'),
    body,
    dismissable: true,
    width: 620,
    actions: [
      { label: 'Configure Controls', value: 'controls', kind: 'ghost' },
      { label: t('play_now'), value: 'play', kind: 'primary' },
    ],
  });

  if (choice === 'controls') {
    configureControlsForGame(game.id, ctx);
    return false;
  }
  if (choice !== 'play') return false;

  sfx('launch');
  const { launchGame } = await import('./launch.js');
  return launchGame(game);
}