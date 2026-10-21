// A small 2-operator FM synth in the spirit of an early-90s FM sound card (adapted from our own Off Road audio): one
// modulator operator drives the carrier's frequency; each has its own envelope (the modulator's sets the brightness
// over time). Operator waveforms: sine, half-sine, abs-sine and quarter (pulse) sine. Plus a few FM-ish drums.

export type Wave = 'sine' | 'half' | 'abs' | 'quarter' | 'square' | 'sawtooth' | 'triangle';

export interface Patch {
  /** Carrier and modulator waveforms. */
  car: Wave;
  mod: Wave;
  /** Modulator frequency / note frequency. */
  ratio: number;
  /** Carrier frequency / note frequency (default 1). */
  carRatio?: number;
  /** Peak modulation index (deviation = index × modulator frequency). */
  index: number;
  /** Index fraction it settles to (default 1 = steady) and the time it takes (s, default 0.2). */
  indexEnd?: number;
  indexTime?: number;
  /** Seconds for the index to swell in (brass); 0 = starts bright. */
  indexAttack?: number;
  /** Carrier amplitude envelope: attack s, decay s, sustain 0..1, release s. */
  a: number;
  d: number;
  s: number;
  r: number;
  /** Peak level of one note at velocity 1. */
  gain: number;
  /** Vibrato [rate Hz, depth cents]. */
  vib?: [number, number];
  /** Optional lowpass cutoff (Hz) after the carrier. */
  lp?: number;
  /** Fraction of the written length the note is held (default 0.9). */
  gate?: number;
}

const waveCache = new WeakMap<BaseAudioContext, Map<Wave, PeriodicWave>>();

function shape(w: Wave, ph: number) {
  const s = Math.sin(2 * Math.PI * ph);
  switch (w) {
    case 'half':
      return Math.max(0, s);
    case 'abs':
      return Math.abs(s);
    case 'quarter':
      return ph % 0.5 < 0.25 ? Math.abs(s) : 0;
    default:
      return s;
  }
}

/** Apply a waveform to an oscillator (native types directly, OPL shapes as a cached PeriodicWave without DC). */
export function setWave(ctx: BaseAudioContext, osc: OscillatorNode, w: Wave) {
  if (w === 'sine' || w === 'square' || w === 'sawtooth' || w === 'triangle') {
    osc.type = w;
    return;
  }
  let cache = waveCache.get(ctx);
  if (!cache) waveCache.set(ctx, (cache = new Map()));
  let pw = cache.get(w);
  if (!pw) {
    const N = 1024;
    const H = 40;
    const real = new Float32Array(H);
    const imag = new Float32Array(H);
    for (let k = 1; k < H; k++) {
      let re = 0;
      let im = 0;
      for (let n = 0; n < N; n++) {
        const x = shape(w, n / N);
        re += x * Math.cos((2 * Math.PI * k * n) / N);
        im += x * Math.sin((2 * Math.PI * k * n) / N);
      }
      real[k] = (2 * re) / N;
      imag[k] = (2 * im) / N;
    }
    pw = ctx.createPeriodicWave(real, imag);
    cache.set(w, pw);
  }
  osc.setPeriodicWave(pw);
}

export const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Play one FM note into `dest` starting at `t` for `dur` seconds (plus release). */
export function playNote(ctx: BaseAudioContext, dest: AudioNode, p: Patch, freq: number, t: number, dur: number, vel = 0.8) {
  const car = ctx.createOscillator();
  setWave(ctx, car, p.car);
  car.frequency.value = freq * (p.carRatio ?? 1);
  const mod = ctx.createOscillator();
  setWave(ctx, mod, p.mod);
  const modHz = freq * p.ratio;
  mod.frequency.value = modHz;
  const dev = ctx.createGain();
  const peakDev = p.index * modHz;
  const ia = p.indexAttack ?? 0;
  if (ia > 0) {
    dev.gain.setValueAtTime(peakDev * 0.15, t);
    dev.gain.linearRampToValueAtTime(peakDev, t + Math.min(ia, dur));
  } else dev.gain.setValueAtTime(peakDev, t);
  if ((p.indexEnd ?? 1) !== 1) dev.gain.setTargetAtTime(peakDev * (p.indexEnd ?? 1), t + ia, (p.indexTime ?? 0.2) / 3);
  mod.connect(dev).connect(car.frequency);

  const nodes: AudioNode[] = [car, mod, dev];
  if (p.vib) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = p.vib[0];
    const depth = ctx.createGain();
    const depthHz = freq * (p.carRatio ?? 1) * (Math.pow(2, p.vib[1] / 1200) - 1);
    // Vibrato fades in after the attack, like a player leaning on a held note.
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(depthHz, t + Math.min(0.25, dur));
    lfo.connect(depth).connect(car.frequency);
    lfo.start(t);
    lfo.stop(t + dur + p.r * 1.5 + 0.05);
    nodes.push(lfo, depth);
  }

  const env = ctx.createGain();
  const peak = p.gain * vel;
  const a = Math.max(0.002, Math.min(p.a, dur * 0.5));
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + a);
  env.gain.setTargetAtTime(peak * p.s, t + a, Math.max(0.005, p.d / 3));
  env.gain.setTargetAtTime(0, t + dur, Math.max(0.005, p.r / 4));
  let last: AudioNode = car;
  if (p.lp) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = p.lp;
    f.Q.value = 0.7;
    car.connect(f);
    last = f;
    nodes.push(f);
  }
  last.connect(env).connect(dest);
  nodes.push(env);
  const end = t + dur + p.r * 1.5 + 0.03;
  car.start(t);
  mod.start(t);
  car.stop(end);
  mod.stop(end);
  car.onended = () => nodes.forEach((n) => n.disconnect());
}

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
/** 2 s of white noise, shared per context. */
export function noiseBuffer(ctx: BaseAudioContext) {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    // Deterministic LCG so offline renders are repeatable.
    let x = 12345;
    for (let i = 0; i < d.length; i++) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      d[i] = (x / 0x3fffffff - 1) * 0.9;
    }
    noiseCache.set(ctx, b);
  }
  return b;
}

/** A noise source (looped when `loop`), started at `t` from a pseudo-random offset. */
export function noise(ctx: BaseAudioContext, t: number, loop = false) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = loop;
  src.start(t, (t * 7.31) % 1.5);
  return src;
}

/** Percussive envelope on a gain param: instant rise to `peak`, exponential fall over `decay` s. */
export function perc(g: AudioParam, t: number, peak: number, decay: number, attack = 0.002) {
  g.setValueAtTime(0, t);
  g.linearRampToValueAtTime(peak, t + attack);
  g.exponentialRampToValueAtTime(0.0004, t + attack + decay);
  g.setValueAtTime(0, t + attack + decay + 0.001);
}

function noiseHit(ctx: BaseAudioContext, dest: AudioNode, t: number, type: BiquadFilterType, hz: number, peak: number, decay: number, q = 0.7) {
  const src = noise(ctx, t);
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = hz;
  f.Q.value = q;
  const g = ctx.createGain();
  perc(g.gain, t, peak, decay);
  src.connect(f).connect(g).connect(dest);
  src.stop(t + decay + 0.05);
  src.onended = () => g.disconnect();
}

function toneHit(ctx: BaseAudioContext, dest: AudioNode, t: number, from: number, to: number, peak: number, decay: number, type: OscillatorType = 'sine', bend = 0.1) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + bend);
  const g = ctx.createGain();
  perc(g.gain, t, peak, decay);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + decay + 0.05);
  o.onended = () => g.disconnect();
}

/**
 * One drum hit. Letters: k kick, s snare, h closed hat, o open hat, c crash, t low tom, m mid tom, x rim/clap.
 * The OPL2's rhythm mode had the same five-ish kit; these are noise + pitch-dropped sines.
 */
export function drum(ctx: BaseAudioContext, dest: AudioNode, kind: string, t: number, vel = 0.8) {
  switch (kind) {
    case 'k':
      toneHit(ctx, dest, t, 150, 42, 0.95 * vel, 0.32, 'sine', 0.11);
      noiseHit(ctx, dest, t, 'lowpass', 1800, 0.15 * vel, 0.02);
      break;
    case 's':
      noiseHit(ctx, dest, t, 'highpass', 1400, 0.42 * vel, 0.17);
      toneHit(ctx, dest, t, 230, 170, 0.32 * vel, 0.08, 'triangle', 0.05);
      break;
    case 'x':
      noiseHit(ctx, dest, t, 'bandpass', 2200, 0.5 * vel, 0.06, 2);
      break;
    case 'h':
      noiseHit(ctx, dest, t, 'highpass', 7500, 0.16 * vel, 0.035);
      break;
    case 'o':
      noiseHit(ctx, dest, t, 'highpass', 7000, 0.13 * vel, 0.22);
      break;
    case 'c':
      noiseHit(ctx, dest, t, 'highpass', 4200, 0.22 * vel, 1.1);
      break;
    case 't':
      toneHit(ctx, dest, t, 150, 95, 0.6 * vel, 0.3, 'sine', 0.2);
      break;
    case 'm':
      toneHit(ctx, dest, t, 220, 140, 0.55 * vel, 0.26, 'sine', 0.18);
      break;
  }
}
