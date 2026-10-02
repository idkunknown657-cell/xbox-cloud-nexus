/**
 * First-launch wizard.
 *
 * Eight short steps, skippable at any point, that establish the minimum
 * needed for a good first session: sign-in explanation, controller detection,
 * keyboard & mouse choice, appearance and performance preset.
 */
import { h, clear } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { settings } from '../store.js';
import { applyTheme, ACCENT_PRESETS } from '../theme.js';
import { toastOk } from '../toast.js';
import { sfx } from '../sfx.js';
import { activePad, watch } from '../gamepad.js';
import { switchControl } from './controls.js';

const STEPS = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'signin', label: 'Sign in' },
  { id: 'basic', label: 'Basic setup' },
  { id: 'controller', label: 'Controller' },
  { id: 'kbm', label: 'Keyboard & Mouse' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'performance', label: 'Performance' },
  { id: 'finish', label: 'Finish' },
];

export function runWizard(onDone) {
  let index = 0;
  const host = document.getElementById('overlays');
  const overlay = h('div.wizard', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Setup' });
  host.appendChild(overlay);

  let stopWatch = null;
  const finish = async () => {
    if (stopWatch) stopWatch();
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    await settings.set('app.wizardCompleted', true);
    await window.nexus.settings.flush?.();
    onDone?.();
  };

  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); skip(); }
  };
  document.addEventListener('keydown', onKey, true);

  async function skip() {
    await settings.set('app.wizardCompleted', true);
    await window.nexus.settings.flush?.();
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
    onDone?.();
  }

  function paint() {
    clear(overlay);
    const side = h('div.wizard-side', [
      h('div.about-logo', [
        h('img', { src: 'icons/icon-64.png', alt: '' }),
        h('div', [h('div.b-name', t('appName')), h('div.b-sub', 'Independent desktop client')]),
      ]),
      h('div.wizard-steps', STEPS.map((s, i) => h(`div.w-step${i === index ? '.current' : i < index ? '.done' : ''}`, [
        h('span.n', i < index ? icon('check', { size: 12 }) : String(i + 1)),
        s.label,
      ]))),
      h('div.grow'),
      h('button.btn.sm.ghost', { onclick: skip }, t('skip')),
    ]);

    const main = h('div.wizard-main');
    main.appendChild(stepContent());
    main.appendChild(footer());

    overlay.appendChild(h('div.wizard-card', h('div.wizard-body', [side, main])));
  }

  function footer() {
    const isFirst = index === 0;
    const isLast = index === STEPS.length - 1;
    return h('div.wizard-foot', [
      !isFirst ? h('button.btn.ghost', { onclick: () => { index--; sfx('back'); paint(); } }, t('back_wiz')) : null,
      isLast
        ? h('button.btn.primary', { onclick: finish }, icon('check', { size: 15 }), t('finish'))
        : h('button.btn.primary', { onclick: () => { index++; sfx('click'); paint(); } }, t('next'), icon('chevronRight', { size: 15 })),
    ].filter(Boolean));
  }

  function heading(title, desc) {
    return h('div', [h('h2', title), h('p.w-desc', desc)]);
  }

  function stepContent() {
    const s = STEPS[index];
    switch (s.id) {
      case 'welcome': {
        const box = h('div.w-content');
        box.append(
          heading(t('wizard_welcome'), t('wizard_welcome_msg')),
          h('div', [
            h('div.bullets', [
              bullet('cloud', t('cloud_gaming')),
              bullet('controller', t('controller')),
              bullet('keyboard', t('kbm_supported')),
              bullet('palette', t('set_appearance')),
            ].filter(Boolean)),
          ]),
        );
        return box;
      }
      case 'signin': {
        const box = h('div.w-content');
        box.append(
          heading(t('wizard_signin'), t('wizard_signin_msg')),
          h('div.attrib', [
            icon('shield', { size: 16 }),
            h('span', ' Sign-in happens on Microsoft’s own page. Your password is never entered in this app.'),
          ]),
        );
        return box;
      }
      case 'basic': {
        const box = h('div.w-content');
        const full = settings.get('cloud.fullscreenOnPlay', true);
        box.append(
          heading('Basic setup', 'Two defaults that matter most.'),
          h('div.panel', [
            h('div.row', [
              h('div.r-main', [h('div.r-title', t('fullscreen_play')), h('div.r-desc', t('fullscreen_play_desc'))]),
              switchControl('cloud.fullscreenOnPlay', full, async (v) => { await settings.set('cloud.fullscreenOnPlay', v); }),
            ]),
            h('div.row', [
              h('div.r-main', [h('div.r-title', t('start_max')), h('div.r-desc', 'Open the launcher maximized at startup.')]),
              switchControl('window.startMaximized', settings.get('window.startMaximized'), async (v) => { await settings.set('window.startMaximized', v); }),
            ]),
          ]),
        );
        return box;
      }
      case 'controller': {
        const box = h('div.w-content');
        const status = h('div.wizard-controller-status');
        const render = (pad) => {
          clear(status);
          status.append(pad
            ? h('div.status-chip.ok', [h('span.dot'), `${t('controller_found')}: ${String(pad.id).slice(0, 40)}`])
            : h('div.status-chip.warn', [h('span.dot'), t('no_controller')]));
        };
        render(activePad());
        stopWatch?.();
        stopWatch = watch((snap) => render(snap));
        box.append(
          heading(t('wizard_controller'), t('wizard_controller_msg')),
          status,
          h('p.muted.mt-8', { style: { fontSize: '13px' } }, 'You can remap every button later in Settings → Controls & Input.'),
        );
        return box;
      }
      case 'kbm': {
        const box = h('div.w-content');
        box.append(
          heading(t('wizard_kbm'), t('wizard_kbm_msg')),
          h('div.panel', [
            h('div.row', [
              h('div.r-main', [h('div.r-title', t('kbm_section')), h('div.r-desc', t('kbm_section_desc', { key: settings.get('input.kbmToggleKey', 'F8') }))]),
              switchControl('input.kbmEnabled', settings.get('input.kbmEnabled'), async (v) => {
                await settings.set('input.kbmEnabled', v);
                toastOk(v ? t('kbm_enabled_toast') : t('kbm_disabled_toast'));
              }),
            ]),
          ]),
          h('div.attrib.mt-16', 'Powered by Better xCloud (MIT). Enabled titles in the library are marked “Keyboard & Mouse”.'),
        );
        return box;
      }
      case 'appearance': {
        const box = h('div.w-content');
        const theme = settings.get('appearance.theme', 'dark');
        const swatches = h('div.flex.gap8.aic', { style: { flexWrap: 'wrap' } });
        for (const p of ACCENT_PRESETS.slice(0, 6)) {
          const cur = settings.get('appearance.accent') === p.hex;
          swatches.appendChild(h(`button.swatch${cur ? '.on' : ''}`, {
            style: { background: p.hex },
            'aria-label': `Accent ${p.id}`,
            onclick: async () => { await settings.set('appearance.accent', p.hex); applyTheme(); paint(); },
          }));
        }
        box.append(
          heading(t('wizard_look'), t('wizard_look_msg')),
          h('div.panel', [
            h('div.row', [
              h('div.r-main', [h('div.r-title', t('theme'))]),
              h('div.seg', [
                ['dark', t('theme_dark')], ['light', t('theme_light')], ['system', t('theme_system')],
              ].map(([v, l]) => h(`button${theme === v ? '.on' : ''}`, {
                onclick: async () => { await settings.set('appearance.theme', v); applyTheme(); paint(); },
              }, l))),
            ]),
            h('div.row', [h('div.r-main', [h('div.r-title', t('accent'))]), swatches]),
          ]),
        );
        return box;
      }
      case 'performance': {
        const box = h('div.w-content');
        const cur = settings.get('performance.preset', 'balanced');
        const cards = h('div.preset-cards', [
          ['low', t('perf_low'), 'Best for older PCs'],
          ['balanced', t('perf_balanced'), 'Recommended'],
          ['quality', t('perf_quality'), 'Best-looking'],
        ].map(([v, l, d]) => h(`button.preset-card${cur === v ? '.on' : ''}`, {
          onclick: async () => {
            await settings.set('performance.preset', v);
            if (v === 'low') {
              await settings.set('performance.lowEndMode', true);
              await settings.set('performance.blur', false);
              await settings.set('performance.shadows', false);
              await settings.set('performance.backgroundFx', false);
              await settings.set('performance.uiQuality', 'low');
            } else if (v === 'quality') {
              await settings.set('performance.lowEndMode', false);
              await settings.set('performance.blur', true);
              await settings.set('performance.shadows', true);
              await settings.set('performance.backgroundFx', true);
              await settings.set('performance.uiQuality', 'high');
            } else {
              await settings.set('performance.lowEndMode', false);
              await settings.set('performance.blur', true);
              await settings.set('performance.shadows', true);
              await settings.set('performance.backgroundFx', true);
              await settings.set('performance.uiQuality', 'medium');
            }
            applyTheme();
            paint();
          },
        }, [h('div.preset-name', l), h('div.preset-desc', d)])));
        box.append(heading(t('wizard_perf'), t('wizard_perf_msg')), cards);
        return box;
      }
      case 'finish':
      default: {
        const box = h('div.w-content');
        box.append(
          heading(t('wizard_done'), t('wizard_done_msg')),
          h('div.wizard-done-icon', icon('check', { size: 40 })),
        );
        return box;
      }
    }
  }

  function bullet(iconName, label) {
    return h('div.bullet', [icon(iconName, { size: 17 }), h('span', label)]);
  }

  paint();
  return { close: finish };
}