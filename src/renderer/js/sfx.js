/**
 * UI sounds — synthesized with the Web Audio API so the app ships zero audio
 * assets. Every cue is a short envelope on a small oscillator, which costs
 * microseconds on old hardware compared to decoding an MP3.
 */
import { settings } from './store.js';

let ctx = null;

function context() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { ctx = new AC(); } catch { ctx = null; }
  return ctx;
}

/** Browsers gate audio behind a gesture; call this from the first click. */
export function unlockAudio() {
  const c = context();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}

const CUES = {
  click: { freq: 620, dur: 0.045, type: 'sine', gain: 0.5, slide: -180 },
  tap: { freq: 880, dur: 0.03, type: 'sine', gain: 0.35, slide: 120 },
  toggle: { freq: 520, dur: 0.07, type: 'triangle', gain: 0.5, slide: 260 },
  success: { freq: 540, dur: 0.13, type: 'sine', gain: 0.55, slide: 320 },
  error: { freq: 300, dur: 0.18, type: 'sawtooth', gain: 0.32, slide: -140 },
  notify: { freq: 740, dur: 0.11, type: 'sine', gain: 0.5, slide: 240 },
  launch: { freq: 420, dur: 0.26, type: 'triangle', gain: 0.55, slide: 520 },
  back: { freq: 480, dur: 0.06, type: 'sine', gain: 0.4, slide: -220 },
};

/**
 * Play a UI cue.
 * @param {keyof typeof CUES} name
 * @param {{force?:boolean}} [opts] force ignores the uiSounds preference
 */
export function sfx(name, opts = {}) {
  if (!opts.force && settings.get('audio.uiSounds') === false) return;
  const vol = Number(settings.get('audio.uiVolume', 0.6));
  if (!vol || vol <= 0) return;
  const c = context();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});

  const cue = CUES[name] || CUES.click;
  try {
    const t0 = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = cue.type;
    osc.frequency.setValueAtTime(cue.freq, t0);
    if (cue.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(60, cue.freq + cue.slide), t0 + cue.dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, cue.gain * vol), t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + cue.dur);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + cue.dur + 0.02);
  } catch { /* audio is never critical */ }
}

/** Attach lightweight hover/click feedback to a container (event delegation). */
export function wireSoundCues(rootEl) {
  rootEl.addEventListener('click', (e) => {
    if (e.target.closest('.btn, .fchip, .nav-item, .iconbtn, .seg button, .fav, .map-row, .tp-cell, .profile-item, .fchip, .rail button')) sfx('click');
  });
  rootEl.addEventListener('pointerover', (e) => {
    if (e.target.closest('.btn, .iconbtn, .fchip')) sfx('tap');
  }, { passive: true });
}