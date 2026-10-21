// Engine voices. One oscillator plays a whole four-stroke cycle (two crank turns) as a PeriodicWave, so its frequency
// is rpm / 120 and the firing pulses are harmonic `cylinders` of it; the lower "uneven" harmonics give each layout its
// character (a cross-plane V8's burble, a boxer's half-order growl). Around it: a detuned twin for beating, a slow
// pitch jitter, exhaust rasp (noise band-passed at the firing frequency), a soft-clip that hardens with load, a lowpass
// that opens with rpm and throttle, and per-profile extras (turbo whistle + blow-off, overrun crackle).
// Every method takes an optional time, so the same voice renders live or into an OfflineAudioContext.
import { noise, perc } from './fm';

export type EngineProfile = 'v8' | 'flat6' | 'turbo4' | 'f1';

interface ProfileDef {
  label: string;
  /** Firing pulses per cycle (= cylinders). */
  cyl: number;
  idle: number;
  redline: number;
  /** Extra harmonic weights (harmonic number of the cycle frequency → amplitude), on top of the firing series. */
  accents: Record<number, number>;
  /** Firing-series rolloff exponent (smaller = brighter). */
  roll: number;
  /** Level of the irregular in-between harmonics (roughness). */
  rough: number;
  lp: [base: number, perRpm: number, perThrottle: number];
  q: number;
  drive: number;
  rasp: number;
  turbo: boolean;
  crackle: number;
  gain: number;
}

export const PROFILES: Record<EngineProfile, ProfileDef> = {
  v8: { label: 'V8 muscle', cyl: 8, idle: 750, redline: 6800, accents: { 1: 0.12, 2: 0.25, 4: 0.7, 12: 0.2 }, roll: 1.1, rough: 0.09, lp: [380, 2600, 1400], q: 1.6, drive: 2.6, rasp: 0.5, turbo: false, crackle: 1, gain: 0.55 },
  flat6: { label: 'flat-6 sports', cyl: 6, idle: 900, redline: 8200, accents: { 3: 0.75, 9: 0.3, 1: 0.05 }, roll: 0.85, rough: 0.05, lp: [520, 3800, 1600], q: 2.2, drive: 1.9, rasp: 0.38, turbo: false, crackle: 0.4, gain: 0.5 },
  turbo4: { label: 'turbo 4', cyl: 4, idle: 850, redline: 7200, accents: { 2: 0.55, 6: 0.18, 1: 0.06 }, roll: 0.95, rough: 0.07, lp: [450, 3000, 1300], q: 1.4, drive: 2.2, rasp: 0.55, turbo: true, crackle: 0.6, gain: 0.5 },
  f1: { label: 'F1 V10', cyl: 10, idle: 4000, redline: 18000, accents: { 5: 0.45, 20: 0.55, 30: 0.3, 15: 0.15 }, roll: 0.6, rough: 0.03, lp: [1400, 7000, 2500], q: 1.2, drive: 1.6, rasp: 0.25, turbo: false, crackle: 0.25, gain: 0.32 },
};
export const ENGINE_PROFILES = Object.keys(PROFILES) as EngineProfile[];

export interface EngineParams {
  /** Revolutions per minute (real rpm; idle..redline of the profile). */
  rpm: number;
  /** Pedal 0..1. */
  throttle: number;
  /** Engine load 0..1 (how hard it is pulling: high in a low gear uphill, ~0 off the clutch / in the air). */
  load?: number;
  /** Current gear; a change plays a shift (upshift: ignition cut, downshift: rev blip). */
  gear?: number;
  /** Stereo position -1..1. */
  x?: number;
  /** Loudness multiplier (opponents ~0.35). */
  level?: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const waves = new WeakMap<BaseAudioContext, Map<EngineProfile, PeriodicWave>>();

function cycleWave(ctx: BaseAudioContext, p: EngineProfile) {
  let m = waves.get(ctx);
  if (!m) waves.set(ctx, (m = new Map()));
  let w = m.get(p);
  if (w) return w;
  const d = PROFILES[p];
  const N = Math.max(64, d.cyl * 5);
  const real = new Float32Array(N);
  const imag = new Float32Array(N);
  let seed = d.cyl * 7919;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 1; k < N; k++) {
    let a = k % d.cyl === 0 ? 1 / Math.pow(k / d.cyl, d.roll) : (d.rough * (0.4 + rnd())) / Math.sqrt(k);
    a += d.accents[k] ?? 0;
    // Mixed phases: a lumpy pressure wave rather than a click train.
    const ph = rnd() * Math.PI * 0.6;
    real[k] = a * Math.sin(ph);
    imag[k] = a * Math.cos(ph);
  }
  w = ctx.createPeriodicWave(real, imag);
  m.set(p, w);
  return w;
}

const shapers = new WeakMap<BaseAudioContext, Float32Array>();
function softClip(ctx: BaseAudioContext) {
  let c = shapers.get(ctx);
  if (!c) {
    c = new Float32Array(1024);
    for (let i = 0; i < c.length; i++) c[i] = Math.tanh(((i / (c.length - 1)) * 2 - 1) * 1.5);
    shapers.set(ctx, c);
  }
  return c;
}

export class EngineVoice {
  readonly profile: EngineProfile;
  private def: ProfileDef;
  private oscs: OscillatorNode[] = [];
  private main: OscillatorNode;
  private twin: OscillatorNode;
  private drive: GainNode;
  private filter: BiquadFilterNode;
  private amp: GainNode;
  private pan: StereoPannerNode;
  private rasp: BiquadFilterNode;
  private raspGain: GainNode;
  private noiseSrc: AudioBufferSourceNode;
  private jitterSrc: AudioBufferSourceNode;
  private whistle: OscillatorNode | null = null;
  private whistleGain: GainNode | null = null;
  private out: GainNode;
  private boost = 0;
  private lastThrottle = 0;
  private lastGear: number | undefined;
  private lastT = -1;
  private rpmN = 0;
  private level = 1;
  lastUpdate = -1;

  constructor(
    private ctx: BaseAudioContext,
    dest: AudioNode,
    profile: EngineProfile,
    t = ctx.currentTime,
  ) {
    this.profile = profile;
    this.def = PROFILES[profile];
    this.pan = ctx.createStereoPanner();
    this.pan.connect(dest);
    this.out = ctx.createGain();
    this.out.connect(this.pan);
    this.amp = ctx.createGain();
    this.amp.gain.value = 0;
    this.amp.connect(this.out);
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = this.def.q;
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClip(ctx);
    shaper.oversample = '2x';
    this.drive = ctx.createGain();
    this.drive.connect(shaper).connect(this.filter).connect(this.amp);

    const wave = cycleWave(ctx, profile);
    this.main = ctx.createOscillator();
    this.main.setPeriodicWave(wave);
    this.twin = ctx.createOscillator();
    this.twin.setPeriodicWave(wave);
    const twinGain = ctx.createGain();
    twinGain.gain.value = 0.35;
    this.main.connect(this.drive);
    this.twin.connect(twinGain).connect(this.drive);

    // Slow random pitch wander (a few cents) on both oscillators: real engines never hold a perfect pitch.
    this.jitterSrc = noise(ctx, t, true);
    this.jitterSrc.playbackRate.value = 0.02;
    const jl = ctx.createBiquadFilter();
    jl.type = 'lowpass';
    jl.frequency.value = 12;
    const jg = ctx.createGain();
    jg.gain.value = 60;
    this.jitterSrc.connect(jl).connect(jg);
    jg.connect(this.main.detune);
    jg.connect(this.twin.detune);

    // Exhaust rasp: noise around the firing frequency.
    this.noiseSrc = noise(ctx, t, true);
    this.rasp = ctx.createBiquadFilter();
    this.rasp.type = 'bandpass';
    this.rasp.Q.value = 1.1;
    this.raspGain = ctx.createGain();
    this.raspGain.gain.value = 0;
    this.noiseSrc.connect(this.rasp).connect(this.raspGain).connect(this.filter);

    if (this.def.turbo) {
      this.whistle = ctx.createOscillator();
      this.whistle.type = 'sine';
      this.whistleGain = ctx.createGain();
      this.whistleGain.gain.value = 0;
      this.whistle.connect(this.whistleGain).connect(this.out);
      this.oscs.push(this.whistle);
    }
    this.oscs.push(this.main, this.twin);
    this.apply({ rpm: this.def.idle, throttle: 0 }, t, true);
    for (const o of this.oscs) o.start(t);
  }

  /** Normalised rpm 0 (idle) .. 1 (redline). */
  norm(rpm: number) {
    return clamp01((rpm - this.def.idle) / (this.def.redline - this.def.idle));
  }

  apply(p: EngineParams, t = this.ctx.currentTime, silent = false) {
    const d = this.def;
    const dt = this.lastT < 0 ? 0.05 : Math.max(0.001, Math.min(0.25, t - this.lastT));
    this.lastT = t;
    const rpm = Math.max(d.idle * 0.6, Math.min(d.redline * 1.05, p.rpm));
    const r = this.norm(rpm);
    this.rpmN = r;
    const th = clamp01(p.throttle);
    const load = clamp01(p.load ?? th * 0.8);
    this.level = p.level ?? 1;
    const k = 0.035;
    const f = rpm / 120;
    this.main.frequency.setTargetAtTime(f, t, k);
    this.twin.frequency.setTargetAtTime(f * 1.006, t, k);
    const fire = f * d.cyl;
    this.rasp.frequency.setTargetAtTime(Math.min(9000, fire * 2.2), t, k);
    this.raspGain.gain.setTargetAtTime(d.rasp * (0.15 + 0.85 * th) * (0.3 + 0.7 * r), t, 0.05);
    this.drive.gain.setTargetAtTime(0.35 + d.drive * (0.25 * th + 0.5 * load), t, 0.05);
    this.filter.frequency.setTargetAtTime(Math.min(16000, d.lp[0] + d.lp[1] * r + d.lp[2] * th * (0.5 + load)), t, 0.04);
    const g = silent ? 0 : d.gain * (0.35 + 0.3 * th + 0.25 * load + 0.25 * r) * this.level;
    this.amp.gain.setTargetAtTime(g, t, 0.05);
    this.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, p.x ?? 0)) * 0.8, t, 0.05);

    if (this.whistle && this.whistleGain) {
      const target = th * (0.3 + 0.7 * r) * (0.5 + 0.5 * load);
      // Spool up slowly, dump fast.
      this.boost += (target - this.boost) * Math.min(1, dt * (target > this.boost ? 1.6 : 6));
      this.whistle.frequency.setTargetAtTime(2200 + this.boost * 5200 + r * 800, t, 0.05);
      this.whistleGain.gain.setTargetAtTime(silent ? 0 : this.boost * this.boost * 0.05 * this.level, t, 0.05);
      if (!silent && this.lastThrottle > 0.6 && th < 0.25 && this.boost > 0.35) this.blowOff(t, this.boost);
    }
    // Overrun: lifting off at high revs pops and crackles.
    if (!silent && d.crackle > 0 && th < 0.08 && r > 0.4) {
      const rate = d.crackle * 9 * (r - 0.3) * (this.lastThrottle > 0.5 ? 3 : 1);
      if (Math.random() < rate * dt) this.pop(t + Math.random() * dt, 0.4 + Math.random() * 0.6);
    }
    if (!silent && p.gear !== undefined && this.lastGear !== undefined && p.gear !== this.lastGear) this.shift(p.gear > this.lastGear, t);
    if (p.gear !== undefined) this.lastGear = p.gear;
    this.lastThrottle = th;
    this.lastUpdate = t;
  }

  /** Upshift: a short ignition cut and a clunk. Downshift: a throttle blip (pitch kicks up and settles). */
  shift(up: boolean, t = this.ctx.currentTime) {
    const g = this.out.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(1, t);
    if (up) {
      g.linearRampToValueAtTime(0.25, t + 0.02);
      g.setValueAtTime(0.25, t + 0.07);
      g.linearRampToValueAtTime(1, t + 0.14);
    } else {
      for (const o of [this.main, this.twin]) {
        o.detune.cancelScheduledValues(t);
        o.detune.setValueAtTime(0, t);
        o.detune.linearRampToValueAtTime(420, t + 0.06);
        o.detune.setTargetAtTime(0, t + 0.08, 0.06);
      }
      g.linearRampToValueAtTime(1.35, t + 0.05);
      g.setTargetAtTime(1, t + 0.1, 0.05);
    }
    this.click(t, up ? 0.18 : 0.1);
    if (up && this.def.crackle > 0.5 && this.rpmN > 0.5) this.pop(t + 0.03, 0.6);
  }

  private click(t: number, peak: number) {
    const src = noise(this.ctx, t);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    f.Q.value = 3;
    const g = this.ctx.createGain();
    perc(g.gain, t, peak * this.level, 0.04);
    src.connect(f).connect(g).connect(this.pan);
    src.stop(t + 0.1);
    src.onended = () => g.disconnect();
  }

  /** An exhaust pop (overrun / upshift). */
  pop(t = this.ctx.currentTime, s = 1) {
    const ctx = this.ctx;
    const src = noise(ctx, t);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900 + 1800 * s;
    const g = ctx.createGain();
    perc(g.gain, t, 0.35 * s * this.level, 0.05 + 0.04 * s, 0.001);
    src.connect(f).connect(g).connect(this.pan);
    src.stop(t + 0.15);
    src.onended = () => g.disconnect();
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.06);
    const og = ctx.createGain();
    perc(og.gain, t, 0.3 * s * this.level, 0.07, 0.001);
    o.connect(og).connect(this.pan);
    o.start(t);
    o.stop(t + 0.12);
    o.onended = () => og.disconnect();
  }

  /** Turbo dump valve: a falling hiss. */
  blowOff(t = this.ctx.currentTime, s = 1) {
    const ctx = this.ctx;
    const src = noise(ctx, t);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.8;
    f.frequency.setValueAtTime(5200, t);
    f.frequency.exponentialRampToValueAtTime(1400, t + 0.35);
    const g = ctx.createGain();
    perc(g.gain, t, 0.22 * s * this.level, 0.4, 0.01);
    src.connect(f).connect(g).connect(this.pan);
    src.stop(t + 0.5);
    src.onended = () => g.disconnect();
    this.boost *= 0.2;
  }

  silence(t = this.ctx.currentTime) {
    this.amp.gain.setTargetAtTime(0, t, 0.12);
    this.whistleGain?.gain.setTargetAtTime(0, t, 0.08);
  }

  dispose(t = this.ctx.currentTime) {
    this.silence(t);
    for (const o of this.oscs) o.stop(t + 0.8);
    this.noiseSrc.stop(t + 0.8);
    this.jitterSrc.stop(t + 0.8);
    if (this.ctx instanceof AudioContext) setTimeout(() => this.pan.disconnect(), 1000);
  }
}
