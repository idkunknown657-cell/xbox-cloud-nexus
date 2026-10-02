/**
 * Offline verification of the stream side of the input pipeline.
 *
 * The renderer writes control profiles; the stream bridge is what actually
 * reaches Better xCloud and therefore what the game receives. A silent mistake
 * here (a key that never lands in the preset, a sensitivity that never leaves
 * 100%) looks like "my settings do nothing", so it is asserted directly from
 * the real default schema — no Electron, no network.
 *
 * Usage: node scripts/check-stream-bridge.cjs
 */
'use strict';
const path = require('path');
const bridge = require('../src/main/stream-bridge.cjs');
const DEFAULTS = require('../src/shared/defaults.cjs');

const out = [];
const ok = (name, cond, extra = '') => out.push({ name, pass: !!cond, extra: String(extra).slice(0, 160) });
const deep = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const profile = DEFAULTS.input.profiles[0];
const preset = bridge.buildBxPreset(profile);
const mouse = preset.data.mouse;
const mapping = preset.data.mapping;

// ---- preset envelope ----
ok('preset id is ours', preset.id === 9001, preset.id);
ok('preset name carries the profile', /^Default Profile$/.test(preset.name), preset.name);
ok('preset carries mapping + mouse',
   !!preset.data.mapping && !!preset.data.mouse, Object.keys(preset.data).join(','));

// ---- button mapping reaches BX indices ----
const EXPECT = [
  ['Space', 0, 'A'], ['KeyE', 1, 'B'], ['KeyR', 2, 'X'], ['KeyQ', 3, 'Y'],
  ['ShiftLeft', 4, 'LB'], ['ControlLeft', 5, 'RB'],
  ['Mouse2', 6, 'LT'], ['Mouse0', 7, 'RT'],
  ['Tab', 8, 'View'], ['Enter', 9, 'Menu'], ['KeyC', 10, 'LS click'], ['KeyV', 11, 'RS click'],
  ['Escape', 16, 'Xbox'],
  ['KeyW', 12, 'D-pad up'], ['KeyS', 13, 'D-pad down'], ['KeyA', 14, 'D-pad left'], ['KeyD', 15, 'D-pad right'],
];
for (const [code, idx, label] of EXPECT) {
  ok(`${label} -> BX ${idx}`, deep(mapping[idx], [code]), JSON.stringify(mapping[idx] || null));
}
ok('stick axes mapped (100..103)',
   deep(mapping[100], ['KeyW']) && deep(mapping[101], ['KeyS'])
   && deep(mapping[102], ['KeyA']) && deep(mapping[103], ['KeyD']),
   JSON.stringify([mapping[100], mapping[101], mapping[102], mapping[103]]));
ok('unbound right-stick axes omitted',
   !mapping[200] && !mapping[201] && !mapping[202] && !mapping[203],
   JSON.stringify([mapping[200], mapping[201], mapping[202], mapping[203]]));
ok('no unknown key codes in the preset',
   Object.values(mapping).flat().every((c) => bridge.VALID_KEY_CODES.has(c)),
   Object.values(mapping).flat().filter((c) => !bridge.VALID_KEY_CODES.has(c)).join(','));

// ---- mouse -> right stick ----
ok('mouse maps to right stick', mouse.mapTo === 2, mouse.mapTo);
ok('default sensitivity is 100/100', mouse.sensitivityX === 100 && mouse.sensitivityY === 100,
   `${mouse.sensitivityX}/${mouse.sensitivityY}`);
ok('deadzone converted to counterweight', mouse.deadzoneCounterweight === 0, mouse.deadzoneCounterweight);

const tuned = bridge.buildBxMouse({
  ...profile,
  mouse: { ...profile.mouse, sensitivity: 1.5, sensitivityY: 0.8, invertY: true, deadzone: 0.12, smoothingEnabled: true, smoothing: 0.25, responseCurve: 'expo' },
});
ok('master sensitivity multiplies axes', tuned.sensitivityX === 150 && tuned.sensitivityY === -120,
   `${tuned.sensitivityX}/${tuned.sensitivityY}`);
ok('invert Y negates only Y', tuned.sensitivityX > 0 && tuned.sensitivityY < 0,
   `${tuned.sensitivityX}/${tuned.sensitivityY}`);
ok('deadzone 0.12 -> counterweight 30', tuned.deadzoneCounterweight === 30, tuned.deadzoneCounterweight);
ok('response curve forwarded', tuned.nexus.responseCurve === 'expo', tuned.nexus.responseCurve);
ok('smoothing amount forwarded', tuned.nexus.smoothing === 0.25, tuned.nexus.smoothing);

const noSmooth = bridge.buildBxMouse({ ...profile, mouse: { ...profile.mouse, smoothing: 0.5, smoothingEnabled: false } });
ok('smoothing switch wins over amount', noSmooth.nexus.smoothing === 0, noSmooth.nexus.smoothing);

const off = bridge.buildBxMouse({ ...profile, mouse: { ...profile.mouse, enabled: false } });
ok('mouse drive can be disabled', off.nexus.enabled === false, off.nexus.enabled);

// ---- clamping / hostile input ----
const junk = bridge.buildBxMouse({ mapping: { gamepadA: { code: 'NotAKey' }, gamepadNonsense: { code: 'KeyA' } }, mouse: { sensitivity: 'abc', deadzone: 99 } });
ok('unknown button ids are dropped', !junk || Object.keys(bridge.profileToBxMapping({ mapping: { gamepadNonsense: { code: 'KeyA' } } }).mapping).length === 0,
   JSON.stringify(bridge.profileToBxMapping({ mapping: { gamepadNonsense: { code: 'KeyA' } } }).mapping));
ok('unsupported key codes are dropped',
   bridge.profileToBxMapping({ mapping: { gamepadA: { code: 'NotAKey' } } }).mapping[0] === undefined,
   JSON.stringify(bridge.profileToBxMapping({ mapping: { gamepadA: { code: 'NotAKey' } } }).mapping));
ok('out-of-range values are clamped',
   junk.sensitivityX > 0 && junk.sensitivityX <= 2000 && junk.deadzoneCounterweight <= 100,
   `${junk.sensitivityX}/${junk.deadzoneCounterweight}`);

// ---- stream prefs ----
const bundle = bridge.buildStreamBundle(DEFAULTS, profile, path.join(__dirname, '..'), null);
ok('bundle ships the BX script', !!bundle.bx.code && bundle.bx.code.length > 10000, bundle.bx.code.length);
ok('bundle credits Better xCloud', bundle.bx.license === 'MIT' || /MIT/.test(bundle.bx.license || ''),
   `${bundle.bx.license} v${bundle.bx.version}`);
ok('bundle preset matches buildBxPreset', deep(bundle.bxPreset, preset));
ok('KBM emulation enabled in prefs', bundle.bxGlobalPrefs['mkb.enabled'] === true);
ok('BX update check disabled', bundle.bxGlobalPrefs.CheckForUpdate === false);
ok('our preset is the selected one', bundle.bxStreamPrefs['mkb.p1.preset.mappingId'] === 9001,
   bundle.bxStreamPrefs['mkb.p1.preset.mappingId']);
ok('controller polls at the max rate by default', bundle.bxStreamPrefs['controller.pollingRate'] === 60,
   bundle.bxStreamPrefs['controller.pollingRate']);
ok('frame rate uncapped by default', bundle.bxStreamPrefs['video.maxFps'] === 60, bundle.bxStreamPrefs['video.maxFps']);
ok('resolution defaults to auto', bundle.bxGlobalPrefs['stream.video.resolution'] === 'auto',
   bundle.bxGlobalPrefs['stream.video.resolution']);

// ---- user-picked quality / latency actually reach the prefs ----
const tuned2 = bridge.buildStreamBundle({
  ...DEFAULTS,
  cloud: { ...DEFAULTS.cloud, targetResolution: '1080p-hq', lockResolution: true, maxFps: 30, renderer: 'webgl2', sharpen: 4, sharpenMode: 'quality', powerPreference: 'high-performance', pollingRate: 120 },
  performance: { ...DEFAULTS.performance, lowEnd: false },
}, profile, path.join(__dirname, '..'), null);
ok('picked resolution reaches global prefs', tuned2.bxGlobalPrefs['stream.video.resolution'] === '1080p-hq',
   tuned2.bxGlobalPrefs['stream.video.resolution']);
ok('resolution lock reaches global prefs', tuned2.bxGlobalPrefs['stream.video.preventResolutionDrops'] === true);
ok('frame cap reaches stream prefs', tuned2.bxStreamPrefs['video.maxFps'] === 30, tuned2.bxStreamPrefs['video.maxFps']);
ok('renderer choice reaches stream prefs', tuned2.bxStreamPrefs['video.player.type'] === 'webgl2');
ok('sharpness reaches stream prefs', tuned2.bxStreamPrefs['video.processing.sharpness'] === 4);
ok('sharpness mode reaches stream prefs', tuned2.bxStreamPrefs['video.processing.mode'] === 'quality');
ok('power preference reaches stream prefs', tuned2.bxStreamPrefs['video.player.powerPreference'] === 'high-performance');
ok('out-of-range polling rate is clamped', tuned2.bxStreamPrefs['controller.pollingRate'] === 60,
   tuned2.bxStreamPrefs['controller.pollingRate']);

const lowEndBundle = bridge.buildStreamBundle({
  ...DEFAULTS, performance: { ...DEFAULTS.performance, lowEnd: true },
  cloud: { ...DEFAULTS.cloud, renderer: 'webgl2', targetResolution: 'nonsense' },
}, profile, path.join(__dirname, '..'), null);
ok('low-end mode disables the WebGL2 renderer', lowEndBundle.bxStreamPrefs['video.player.type'] === 'default',
   lowEndBundle.bxStreamPrefs['video.player.type']);
ok('low-end mode reduces store artwork quality', lowEndBundle.bxGlobalPrefs['ui.imageQuality'] === 60,
   lowEndBundle.bxGlobalPrefs['ui.imageQuality']);
ok('invalid resolution falls back to auto', lowEndBundle.bxGlobalPrefs['stream.video.resolution'] === 'auto',
   lowEndBundle.bxGlobalPrefs['stream.video.resolution']);

// Every pref key we send must be one Better xCloud actually reads.
const bxSource = require('../src/main/bxcloud.cjs').readBxScript(path.join(__dirname, '..')).code || '';
const usedKeys = [...Object.keys(bundle.bxGlobalPrefs), ...Object.keys(bundle.bxStreamPrefs)];
ok('every pref key exists in Better xCloud', usedKeys.every((k) => bxSource.includes(k)),
   usedKeys.filter((k) => !bxSource.includes(k)).join(','));

let pass = true;
const failed = [];
for (const r of out) {
  if (r.pass) console.log(`PASS  ${r.name}${r.extra ? '  — ' + r.extra : ''}`);
  else { pass = false; failed.push(r.name + ' — ' + r.extra); console.log(`FAIL  ${r.name}  — ${r.extra}`); }
}
console.log('');
if (pass) console.log(`BRIDGE OK — ${out.length} checks passed`);
else { console.log(`BRIDGE FAILED — ${failed.length}/${out.length} checks failed`); process.exitCode = 1; }