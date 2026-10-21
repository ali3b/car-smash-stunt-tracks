// Sound effects: continuous voices (tyres: rolling + skid per surface, wall scrape, wind) and one-shots. All
// synthesised from FM tones and filtered noise. Every method takes an optional time (live or offline contexts).
import { midiToHz, noise, perc, playNote, type Patch } from './fm';

export type Surface = 'paved' | 'dirt' | 'ice' | 'grass';
export const SURFACES: Surface[] = ['paved', 'dirt', 'ice', 'grass'];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const live = (ctx: BaseAudioContext) => ctx instanceof AudioContext;

function panner(ctx: BaseAudioContext, dest: AudioNode, x = 0) {
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, x)) * 0.8;
  p.connect(dest);
  return p;
}

function filtered(ctx: BaseAudioContext, src: AudioNode, type: BiquadFilterType, hz: number, q: number, dest: AudioNode) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = hz;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = 0;
  src.connect(f).connect(g).connect(dest);
  return { f, g };
}

// ---- tyres ------------------------------------------------------------------------------------------------------

export interface TyreParams {
  /** Slip 0..1, overall or per wheel [fl, fr, rl, rr]. */
  slip: number | readonly number[];
  surface: Surface;
  /** Ground speed in m/s (rolling noise). */
  speed: number;
  /** False while airborne (silences rolling and skid). */
  grounded?: boolean;
  x?: number;
  level?: number;
}

/** One car's tyres: rolling noise and skid/screech, each with a chain per surface that cross-fades on a change. */
export class TyreVoice {
  private src: AudioBufferSourceNode;
  private pan: StereoPannerNode;
  private roll: Record<Surface, { f: BiquadFilterNode; g: GainNode }>;
  private skid: Record<Surface, { f: BiquadFilterNode; g: GainNode }>;
  private squeal: OscillatorNode;
  private squealGain: GainNode;
  private wobble: OscillatorNode;
  private grit: AudioBufferSourceNode;
  private gritGain: GainNode;
  surface: Surface | null = null;
  lastUpdate = -1;

  constructor(
    private ctx: BaseAudioContext,
    dest: AudioNode,
    t = ctx.currentTime,
  ) {
    this.pan = ctx.createStereoPanner();
    this.pan.connect(dest);
    this.src = noise(ctx, t, true);
    this.roll = {
      paved: filtered(ctx, this.src, 'lowpass', 260, 0.9, this.pan),
      dirt: filtered(ctx, this.src, 'bandpass', 520, 0.7, this.pan),
      grass: filtered(ctx, this.src, 'bandpass', 380, 0.6, this.pan),
      ice: filtered(ctx, this.src, 'highpass', 3800, 0.7, this.pan),
    };
    this.skid = {
      paved: filtered(ctx, this.src, 'bandpass', 1900, 7, this.pan),
      dirt: filtered(ctx, this.src, 'bandpass', 900, 0.8, this.pan),
      grass: filtered(ctx, this.src, 'lowpass', 1100, 0.8, this.pan),
      ice: filtered(ctx, this.src, 'bandpass', 5200, 1.2, this.pan),
    };
    // Rubber squeal on tarmac: a wobbling triangle under the band of noise.
    this.squeal = ctx.createOscillator();
    this.squeal.type = 'triangle';
    this.squeal.frequency.value = 1050;
    this.wobble = ctx.createOscillator();
    this.wobble.frequency.value = 9;
    const wg = ctx.createGain();
    wg.gain.value = 45;
    this.wobble.connect(wg).connect(this.squeal.frequency);
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    const sf = ctx.createBiquadFilter();
    sf.type = 'bandpass';
    sf.frequency.value = 1100;
    sf.Q.value = 2;
    this.squeal.connect(sf).connect(this.squealGain).connect(this.pan);
    // Gravel: a second, slowed noise stream whose crackle rides on the dirt chains.
    this.grit = noise(ctx, t, true);
    this.grit.playbackRate.value = 0.25;
    this.gritGain = ctx.createGain();
    this.gritGain.gain.value = 0;
    const gf = ctx.createBiquadFilter();
    gf.type = 'highpass';
    gf.frequency.value = 1500;
    this.grit.connect(gf).connect(this.gritGain).connect(this.pan);
    this.squeal.start(t);
    this.wobble.start(t);
  }

  set(p: TyreParams, t = this.ctx.currentTime) {
    const slips = typeof p.slip === 'number' ? [p.slip] : p.slip.length ? p.slip : [0];
    const max = Math.max(...slips.map(clamp01));
    const mean = slips.reduce((a, b) => a + clamp01(b), 0) / slips.length;
    let s = clamp01(max * 0.7 + mean * 0.3);
    const grounded = p.grounded ?? true;
    const lvl = (p.level ?? 1) * (grounded ? 1 : 0);
    const v = clamp01(Math.abs(p.speed) / 60);
    if (Math.abs(p.speed) < 1) s *= Math.abs(p.speed);
    // Per-wheel slip leans the sound toward the side that slides.
    let x = p.x ?? 0;
    if (slips.length === 4) x += ((slips[1] + slips[3] - slips[0] - slips[2]) / 2) * 0.3;
    this.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, x)) * 0.8, t, 0.05);
    const ROLL: Record<Surface, number> = { paved: 0.22, dirt: 0.2, grass: 0.16, ice: 0.035 };
    const SKID: Record<Surface, number> = { paved: 0.7, dirt: 0.3, grass: 0.18, ice: 0.06 };
    for (const k of SURFACES) {
      const on = k === p.surface ? 1 : 0;
      this.roll[k].g.gain.setTargetAtTime(on * lvl * ROLL[k] * Math.sqrt(v) * (0.3 + 0.7 * v), t, 0.08);
      this.skid[k].g.gain.setTargetAtTime(on * lvl * SKID[k] * Math.pow(s, 1.4), t, 0.04);
    }
    this.roll.paved.f.frequency.setTargetAtTime(160 + 500 * v, t, 0.1);
    this.roll.dirt.f.frequency.setTargetAtTime(320 + 700 * v, t, 0.1);
    this.skid.paved.f.frequency.setTargetAtTime(1500 + 900 * s, t, 0.05);
    const tarmac = p.surface === 'paved' ? 1 : 0;
    this.squealGain.gain.setTargetAtTime(tarmac * lvl * 0.1 * Math.pow(Math.max(0, s - 0.15) / 0.85, 1.3), t, 0.04);
    this.squeal.frequency.setTargetAtTime(950 + 350 * s, t, 0.05);
    const loose = p.surface === 'dirt' || p.surface === 'grass' ? 1 : 0;
    this.gritGain.gain.setTargetAtTime(loose * lvl * (0.05 * v + 0.25 * s), t, 0.05);
    this.lastUpdate = t;
    const changed = this.surface !== null && this.surface !== p.surface;
    this.surface = p.surface;
    return changed && grounded && Math.abs(p.speed) > 2;
  }

  silence(t = this.ctx.currentTime) {
    for (const k of SURFACES) {
      this.roll[k].g.gain.setTargetAtTime(0, t, 0.06);
      this.skid[k].g.gain.setTargetAtTime(0, t, 0.06);
    }
    this.squealGain.gain.setTargetAtTime(0, t, 0.06);
    this.gritGain.gain.setTargetAtTime(0, t, 0.06);
  }

  dispose(t = this.ctx.currentTime) {
    this.silence(t);
    for (const s of [this.src, this.grit, this.squeal, this.wobble]) s.stop(t + 0.5);
    if (live(this.ctx)) setTimeout(() => this.pan.disconnect(), 800);
  }
}

// ---- wall scrape ------------------------------------------------------------------------------------------------

/** Metal along a wall or barrier: grinding noise plus an inharmonic FM ring, with a jittery level. */
export class ScrapeVoice {
  private src: AudioBufferSourceNode;
  private band: BiquadFilterNode;
  private amp: GainNode;
  private car: OscillatorNode;
  private mod: OscillatorNode;
  private ringGain: GainNode;
  private pan: StereoPannerNode;
  private extra: AudioBufferSourceNode;
  lastUpdate = -1;

  constructor(
    private ctx: BaseAudioContext,
    dest: AudioNode,
    t = ctx.currentTime,
  ) {
    this.pan = ctx.createStereoPanner();
    this.pan.connect(dest);
    this.amp = ctx.createGain();
    this.amp.gain.value = 0;
    // Grind: noise, amplitude-modulated by a slowed noise stream (rough contact).
    this.src = noise(ctx, t, true);
    this.band = ctx.createBiquadFilter();
    this.band.type = 'bandpass';
    this.band.frequency.value = 2400;
    this.band.Q.value = 2.5;
    const am = ctx.createGain();
    am.gain.value = 0.6;
    const rough = noise(ctx, t, true);
    rough.playbackRate.value = 0.004;
    rough.connect(am.gain);
    this.src.connect(this.band).connect(am).connect(this.amp);
    this.car = ctx.createOscillator();
    this.car.frequency.value = 730;
    this.mod = ctx.createOscillator();
    this.mod.frequency.value = 730 * 1.414;
    const dev = ctx.createGain();
    dev.gain.value = 730 * 3;
    this.mod.connect(dev).connect(this.car.frequency);
    this.ringGain = ctx.createGain();
    this.ringGain.gain.value = 0;
    this.car.connect(this.ringGain).connect(this.amp);
    this.amp.connect(this.pan);
    this.car.start(t);
    this.mod.start(t);
    rough.stop(t + 3600);
    this.extra = rough;
  }

  /** amount 0..1 (contact force × sliding speed). */
  set(amount: number, x = 0, t = this.ctx.currentTime) {
    const a = clamp01(amount);
    this.amp.gain.setTargetAtTime(a > 0.02 ? 0.25 + 0.45 * a : 0, t, 0.03);
    this.ringGain.gain.setTargetAtTime(0.06 * a, t, 0.04);
    this.band.frequency.setTargetAtTime(1800 + 1800 * a, t, 0.05);
    this.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, x)) * 0.8, t, 0.05);
    this.lastUpdate = t;
  }
  silence(t = this.ctx.currentTime) {
    this.amp.gain.setTargetAtTime(0, t, 0.05);
  }
  dispose(t = this.ctx.currentTime) {
    this.silence(t);
    for (const s of [this.src, this.extra, this.car, this.mod]) s.stop(t + 0.4);
    if (live(this.ctx)) setTimeout(() => this.pan.disconnect(), 700);
  }
}

// ---- wind -------------------------------------------------------------------------------------------------------

/** Air rush past the cockpit: band-passed noise that brightens and swells with speed, with slow gusts. */
export class WindVoice {
  private src: AudioBufferSourceNode;
  private lo: BiquadFilterNode;
  private hi: BiquadFilterNode;
  private amp: GainNode;
  private gust: OscillatorNode;
  lastUpdate = -1;
  constructor(
    private ctx: BaseAudioContext,
    dest: AudioNode,
    t = ctx.currentTime,
  ) {
    this.amp = ctx.createGain();
    this.amp.gain.value = 0;
    this.amp.connect(dest);
    this.src = noise(ctx, t, true);
    this.lo = ctx.createBiquadFilter();
    this.lo.type = 'bandpass';
    this.lo.Q.value = 0.6;
    this.hi = ctx.createBiquadFilter();
    this.hi.type = 'bandpass';
    this.hi.Q.value = 3;
    const hg = ctx.createGain();
    hg.gain.value = 0.35;
    const gustGain = ctx.createGain();
    gustGain.gain.value = 1;
    this.gust = ctx.createOscillator();
    this.gust.frequency.value = 0.23;
    const gd = ctx.createGain();
    gd.gain.value = 0.3;
    this.gust.connect(gd).connect(gustGain.gain);
    this.src.connect(this.lo).connect(gustGain);
    this.src.connect(this.hi).connect(hg).connect(gustGain);
    gustGain.connect(this.amp);
    this.gust.start(t);
  }
  /** speed in m/s. Silent below ~12 m/s, full around 75 m/s. `muffled`: heard from inside the car (darker). */
  set(speed: number, t = this.ctx.currentTime, level = 1, muffled = false) {
    const v = clamp01((Math.abs(speed) - 12) / 63);
    const m = muffled ? 0.45 : 1;
    this.amp.gain.setTargetAtTime(0.32 * v * v * level, t, 0.15);
    this.lo.frequency.setTargetAtTime((300 + 900 * v) * m, t, 0.15);
    this.hi.frequency.setTargetAtTime((1400 + 2400 * v) * m, t, 0.15);
    this.lastUpdate = t;
  }
  silence(t = this.ctx.currentTime) {
    this.amp.gain.setTargetAtTime(0, t, 0.2);
  }
  dispose(t = this.ctx.currentTime) {
    this.silence(t);
    this.src.stop(t + 1);
    this.gust.stop(t + 1);
  }
}

// ---- one-shots --------------------------------------------------------------------------------------------------

const BEEP: Patch = { car: 'square', mod: 'sine', ratio: 1, index: 0, a: 0.003, d: 0.05, s: 0.9, r: 0.03, gain: 0.16, lp: 3500 };
const BRASS: Patch = { car: 'sawtooth', mod: 'sine', ratio: 1, index: 1.2, indexAttack: 0.05, a: 0.02, d: 0.2, s: 0.8, r: 0.25, gain: 0.07, lp: 2600, vib: [5.5, 14] };
const BELL: Patch = { car: 'sine', mod: 'sine', ratio: 3.5, index: 2.4, indexEnd: 0.1, indexTime: 0.6, a: 0.002, d: 0.9, s: 0, r: 0.4, gain: 0.16 };
const TICK: Patch = { car: 'square', mod: 'sine', ratio: 2, index: 1, indexEnd: 0.1, indexTime: 0.03, a: 0.001, d: 0.04, s: 0, r: 0.02, gain: 0.1, lp: 4000 };
const CLANK: Patch = { car: 'sine', mod: 'square', ratio: 1.41, index: 6, indexEnd: 0.15, indexTime: 0.15, a: 0.001, d: 0.35, s: 0, r: 0.15, gain: 0.14 };

function noiseBurst(ctx: BaseAudioContext, dest: AudioNode, t: number, o: { type: BiquadFilterType; from: number; to?: number; q?: number; peak: number; attack?: number; decay: number; sweep?: number }) {
  const src = noise(ctx, t);
  const f = ctx.createBiquadFilter();
  f.type = o.type;
  f.Q.value = o.q ?? 0.8;
  f.frequency.setValueAtTime(o.from, t);
  if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + (o.sweep ?? o.decay));
  const g = ctx.createGain();
  perc(g.gain, t, o.peak, o.decay, o.attack ?? 0.003);
  src.connect(f).connect(g).connect(dest);
  src.stop(t + (o.attack ?? 0) + o.decay + 0.05);
  src.onended = () => g.disconnect();
}

function thump(ctx: BaseAudioContext, dest: AudioNode, t: number, from: number, to: number, peak: number, decay: number) {
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + decay * 0.6);
  const g = ctx.createGain();
  perc(g.gain, t, peak, decay);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + decay + 0.05);
  o.onended = () => g.disconnect();
}

export interface SfxParams {
  /** 0..1 (impacts: how hard). */
  strength?: number;
  /** Stereo position -1..1. */
  x?: number;
  /** Countdown number (beep: 0 = the GO tone). */
  n?: number;
  /** Target surface for `surface`. */
  surface?: Surface;
  /** Gear direction for `shift`. */
  up?: boolean;
}

export const SFX_NAMES = ['shift', 'backfire', 'blowoff', 'bump', 'land', 'wallHit', 'carHit', 'crash', 'scrape', 'surface', 'beep', 'go', 'finish', 'checkpoint', 'click', 'select', 'back', 'place', 'erase'] as const;
export type SfxName = (typeof SFX_NAMES)[number];

/** Play a one-shot at time `t` into `dest`. Works on live and offline contexts. */
export function playSfx(ctx: BaseAudioContext, dest: AudioNode, name: SfxName, p: SfxParams = {}, t = ctx.currentTime) {
  const s = clamp01(p.strength ?? 0.7);
  const out = panner(ctx, dest, p.x ?? 0);
  switch (name) {
    case 'shift':
      // Gearbox: a dog-ring clunk and a short whine.
      noiseBurst(ctx, out, t, { type: 'bandpass', from: 1600, q: 3, peak: 0.22, decay: 0.05 });
      thump(ctx, out, t, p.up === false ? 260 : 200, 90, 0.2, 0.08);
      break;
    case 'backfire':
      noiseBurst(ctx, out, t, { type: 'lowpass', from: 2600, to: 300, peak: 0.6, decay: 0.12, attack: 0.001 });
      thump(ctx, out, t, 160, 45, 0.5, 0.12);
      noiseBurst(ctx, out, t + 0.07, { type: 'lowpass', from: 1800, to: 300, peak: 0.25, decay: 0.08, attack: 0.001 });
      break;
    case 'blowoff':
      noiseBurst(ctx, out, t, { type: 'bandpass', from: 5200, to: 1300, q: 1.8, peak: 0.3, attack: 0.01, decay: 0.4, sweep: 0.35 });
      break;
    case 'bump':
      // Suspension knock: a short mid thud and a body rattle.
      thump(ctx, out, t, 140 + 60 * s, 70, 0.2 + 0.4 * s, 0.09 + 0.06 * s);
      noiseBurst(ctx, out, t, { type: 'bandpass', from: 700, q: 1.5, peak: 0.08 + 0.18 * s, decay: 0.07 });
      break;
    case 'land':
      // Heavy chassis landing: low boom, a crunch, then the springs creaking back.
      thump(ctx, out, t, 85 + 40 * s, 32, 0.45 + 0.5 * s, 0.25 + 0.2 * s);
      noiseBurst(ctx, out, t, { type: 'lowpass', from: 1200 + 1500 * s, to: 150, peak: 0.15 + 0.35 * s, decay: 0.18 + 0.1 * s });
      if (s > 0.35) for (let i = 0; i < 2; i++) playNote(ctx, out, { ...CLANK, ratio: 2.76, index: 1.5, gain: 0.03 * s, d: 0.15 }, 620 - i * 90, t + 0.09 + i * 0.13, 0.08);
      break;
    case 'wallHit':
      thump(ctx, out, t, 120, 45, 0.3 + 0.5 * s, 0.22 + 0.12 * s);
      noiseBurst(ctx, out, t, { type: 'lowpass', from: 1200 + 3000 * s, to: 220, peak: 0.25 + 0.4 * s, decay: 0.16 + 0.18 * s });
      playNote(ctx, out, { ...CLANK, gain: 0.05 + 0.1 * s }, 210, t, 0.12);
      break;
    case 'carHit':
      playNote(ctx, out, { ...CLANK, gain: 0.1 + 0.15 * s }, 180, t, 0.15);
      noiseBurst(ctx, out, t, { type: 'bandpass', from: 2500, to: 600, q: 1.2, peak: 0.2 + 0.3 * s, decay: 0.15 });
      thump(ctx, out, t, 90, 40, 0.3 * s, 0.2);
      break;
    case 'crash': {
      // The big one: a boom, crumpling metal, glass bursting into tinkles, and debris settling.
      thump(ctx, out, t, 110, 28, 0.9, 0.7);
      noiseBurst(ctx, out, t, { type: 'lowpass', from: 4500, to: 160, peak: 0.6, decay: 0.9, sweep: 0.7 });
      for (let i = 0; i < 4; i++) playNote(ctx, out, { ...CLANK, gain: 0.12 - i * 0.02 }, [170, 233, 141, 305][i], t + i * 0.07, 0.18);
      noiseBurst(ctx, out, t + 0.04, { type: 'highpass', from: 5000, peak: 0.28, decay: 0.45 });
      let seed = 91;
      for (let i = 0; i < 14; i++) {
        seed = (seed * 9301 + 49297) % 233280;
        const r = seed / 233280;
        const at = t + 0.08 + i * 0.045 + r * 0.06;
        playNote(ctx, out, { car: 'sine', mod: 'sine', ratio: 2.9 + r, index: 1.2, indexEnd: 0.2, a: 0.001, d: 0.12, s: 0, r: 0.08, gain: 0.05 * (1 - i / 16) }, 2600 + r * 3400, at, 0.05);
      }
      for (let i = 0; i < 5; i++) noiseBurst(ctx, out, t + 0.5 + i * 0.16 + (i % 2) * 0.05, { type: 'bandpass', from: 900 + i * 300, q: 2, peak: 0.12 - i * 0.02, decay: 0.08 });
      break;
    }
    case 'scrape':
      noiseBurst(ctx, out, t, { type: 'bandpass', from: 3200, to: 1600, q: 2.5, peak: 0.2 + 0.3 * s, attack: 0.02, decay: 0.35 + 0.3 * s });
      playNote(ctx, out, { ...CLANK, a: 0.02, d: 0.4, gain: 0.03 + 0.05 * s }, 730, t, 0.3);
      break;
    case 'surface': {
      // Crossing onto a new surface: a short burst coloured like it.
      const k = p.surface ?? 'dirt';
      if (k === 'dirt' || k === 'grass') noiseBurst(ctx, out, t, { type: 'lowpass', from: k === 'dirt' ? 1600 : 900, to: 300, peak: 0.28, decay: 0.22 });
      else if (k === 'ice') noiseBurst(ctx, out, t, { type: 'highpass', from: 4500, peak: 0.12, decay: 0.25 });
      else thump(ctx, out, t, 180, 90, 0.2, 0.07);
      break;
    }
    case 'beep':
      playNote(ctx, out, BEEP, midiToHz(p.n === 0 ? 81 : 69), t, p.n === 0 ? 0.6 : 0.18, 1);
      break;
    case 'go':
      playNote(ctx, out, BEEP, midiToHz(81), t, 0.6, 1);
      playNote(ctx, out, BEEP, midiToHz(76), t, 0.6, 0.6);
      break;
    case 'finish': {
      // Our finish fanfare: a rising brass call (C – G – C – E… G) over a bell.
      const call: [number, number, number][] = [
        [60, 0, 0.12],
        [67, 0.14, 0.12],
        [72, 0.28, 0.12],
        [76, 0.42, 0.22],
        [72, 0.66, 0.12],
        [79, 0.8, 0.9],
      ];
      for (const [m, at, d] of call) {
        playNote(ctx, out, BRASS, midiToHz(m), t + at, d, 1);
        playNote(ctx, out, BRASS, midiToHz(m - 12), t + at, d, 0.6);
      }
      for (const m of [60, 64, 67]) playNote(ctx, out, BRASS, midiToHz(m), t + 0.8, 0.9, 0.5);
      playNote(ctx, out, BELL, midiToHz(91), t + 0.8, 0.8);
      for (const at of [0.8, 0.8 + 0.5]) noiseBurst(ctx, out, t + at, { type: 'highpass', from: 4200, peak: 0.1, decay: 0.9 });
      break;
    }
    case 'checkpoint':
      playNote(ctx, out, BELL, midiToHz(84), t, 0.25);
      playNote(ctx, out, BELL, midiToHz(88), t + 0.1, 0.4);
      break;
    case 'click':
      playNote(ctx, out, TICK, midiToHz(84), t, 0.03);
      break;
    case 'select':
      playNote(ctx, out, TICK, midiToHz(79), t, 0.05);
      playNote(ctx, out, TICK, midiToHz(86), t + 0.06, 0.08);
      break;
    case 'back':
      playNote(ctx, out, TICK, midiToHz(79), t, 0.05);
      playNote(ctx, out, TICK, midiToHz(72), t + 0.06, 0.08);
      break;
    case 'place':
      thump(ctx, out, t, 300, 120, 0.3, 0.07);
      playNote(ctx, out, TICK, midiToHz(76), t, 0.04);
      break;
    case 'erase':
      noiseBurst(ctx, out, t, { type: 'bandpass', from: 2400, to: 500, q: 1.5, peak: 0.35, decay: 0.15 });
      break;
  }
  // Drop the panner once everything above has rung out (offline renders just discard the graph).
  if (live(ctx)) setTimeout(() => out.disconnect(), 4000);
}
