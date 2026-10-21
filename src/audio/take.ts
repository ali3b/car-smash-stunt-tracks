// Offline sound for recorded footage (the capture scene, src/scenes/capture.ts): the game's own engine, tyre, wind
// and impact voices, driven by one sound frame per video frame, rendered into an OfflineAudioContext so the sound
// is exactly in sync with the frames however slowly they were rendered. Music is mixed in later by the editing
// scripts (scripts/trailer.mjs, scripts/documentary.py).
import { EngineVoice, type EngineProfile } from './engine';
import { playSfx, ScrapeVoice, TyreVoice, WindVoice, type SfxName, type Surface } from './sfx';

export interface TakeCarSound {
  car: number;
  profile: EngineProfile;
  rpm: number;
  throttle: number;
  load: number;
  gear: number;
  /** m/s. */
  speed: number;
  slip: number | readonly number[];
  surface: Surface;
  grounded: boolean;
  scrape: number;
  /** Stereo position -1..1 and loudness (distance from the camera). */
  x: number;
  level: number;
  /** The player's car, heard from inside it (engine fills the cabin, tyres and wind behind glass) or outside. */
  cabin?: boolean;
  player?: boolean;
}

export interface TakeSoundFrame {
  /** Seconds from the start of the clip. */
  t: number;
  cars: TakeCarSound[];
  /** One-shots at this frame. */
  hits: { name: SfxName; strength: number; x: number }[];
  /** Wind level (the camera rides with a car: 1; a fixed camera: 0). */
  wind: number;
  windSpeed: number;
}

/** Render a clip's sound as stereo samples at 48 kHz. */
export async function renderTakeSound(frames: TakeSoundFrame[], seconds: number): Promise<{ rate: number; left: Float32Array; right: Float32Array }> {
  const rate = 48000;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(rate * seconds)), rate);
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.knee.value = 4;
  limiter.ratio.value = 10;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  const out = ctx.createGain();
  out.gain.value = 0.9;
  out.connect(limiter).connect(ctx.destination);
  const engines = new Map<number, EngineVoice>();
  const tyres = new Map<number, TyreVoice>();
  const scrapes = new Map<number, ScrapeVoice>();
  let wind: WindVoice | null = null;
  const seen = new Map<number, number>();
  for (const f of frames) {
    const t = f.t + 0.02;
    for (const c of f.cars) {
      let e = engines.get(c.car);
      if (!e || e.profile !== c.profile) {
        e?.dispose(t);
        e = new EngineVoice(ctx, out, c.profile, t);
        engines.set(c.car, e);
      }
      // As the live mix does (src/audio/index.ts carFrame): in the cabin the engine is louder, the tyres quieter.
      const engineLevel = c.level * (c.player ? (c.cabin ? 1.2 : 0.9) : 1);
      e.apply({ rpm: c.rpm, throttle: c.throttle, load: c.load, gear: c.gear, x: c.x, level: engineLevel }, t);
      let ty = tyres.get(c.car);
      if (!ty) tyres.set(c.car, (ty = new TyreVoice(ctx, out, t)));
      ty.set({ slip: c.slip, surface: c.surface, speed: c.speed, grounded: c.grounded, x: c.x, level: c.level * (c.cabin ? 0.65 : 1) }, t);
      if (c.scrape > 0 || scrapes.has(c.car)) {
        let s = scrapes.get(c.car);
        if (!s) scrapes.set(c.car, (s = new ScrapeVoice(ctx, out, t)));
        s.set(c.scrape * c.level, c.x, t);
      }
      seen.set(c.car, t);
    }
    // Cars that left the frame list (a cut to a clip without them) fall silent.
    for (const [id, last] of seen)
      if (t - last > 0.1) {
        engines.get(id)?.silence(t);
        tyres.get(id)?.silence(t);
        scrapes.get(id)?.silence(t);
        seen.delete(id);
      }
    wind ??= new WindVoice(ctx, out, t);
    const cabin = f.cars.some((c) => c.cabin);
    wind.set(f.windSpeed, t, cabin ? 0.4 : 1.15 * f.wind, cabin);
    for (const h of f.hits) playSfx(ctx, out, h.name, { strength: h.strength, x: h.x }, t);
  }
  const end = seconds;
  for (const v of [...engines.values(), ...tyres.values(), ...scrapes.values()]) v.dispose(end);
  wind?.dispose(end);
  const buf = await ctx.startRendering();
  return { rate, left: buf.getChannelData(0), right: buf.getChannelData(1) };
}

/** 16-bit stereo WAV bytes. */
export function wavBytes(rate: number, left: Float32Array, right: Float32Array): Uint8Array {
  const n = left.length;
  const data = new DataView(new ArrayBuffer(44 + n * 4));
  const str = (o: number, s: string) => [...s].forEach((ch, i) => data.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF');
  data.setUint32(4, 36 + n * 4, true);
  str(8, 'WAVEfmt ');
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, 2, true);
  data.setUint32(24, rate, true);
  data.setUint32(28, rate * 4, true);
  data.setUint16(32, 4, true);
  data.setUint16(34, 16, true);
  str(36, 'data');
  data.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    data.setInt16(44 + i * 4, Math.max(-1, Math.min(1, left[i])) * 32767, true);
    data.setInt16(46 + i * 4, Math.max(-1, Math.min(1, right[i])) * 32767, true);
  }
  return new Uint8Array(data.buffer);
}
