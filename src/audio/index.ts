// Car Smash Stunt Tracks audio: one AudioSystem per page (getAudio()). Everything is synthesised (FM tones, filtered
// noise); the music is our own, written in the sequencer's pattern language (./songs).
//
//   const audio = getAudio();
//   audio.engine(0, 'v8').set({ rpm: 4200, throttle: 1, load: 0.7, gear: 2 });   // per frame
//   audio.tyres(0).set({ slip: [0, 0, 0.6, 0.7], surface: 'dirt', speed: 31 });  // per frame
//   audio.scrape(0).set(0.5); audio.wind(42);                                      // per frame
//   audio.sfx('crash', { strength: 1 }); audio.music('race'); audio.toggleMute(); audio.setVolume('music', 0.5);
//   audio.emit('car', { … })  — the event contract in ./events.ts, which does all of the above from game events.
//
// The AudioContext is created on the first key press, click or tap (autoplay policy). Before that, calls are kept as
// state (the wanted song plays on unlock) or dropped (one-shots). M toggles mute. Continuous voices that stop getting
// updates fade out after 0.4 s.
import { ENGINE_PROFILES, EngineVoice, PROFILES, type EngineParams, type EngineProfile } from './engine';
import type { AudioEvents, AudioEventSink, AudioEventType, AudioScene, CarAudioFrame } from './events';
import { SongPlayer, scheduleAll, songSeconds } from './sequencer';
import { loadSettings, saveSettings, type AudioSettings } from './settings';
import { playSfx, ScrapeVoice, SFX_NAMES, TyreVoice, WindVoice, type SfxName, type SfxParams, type TyreParams } from './sfx';
import { SONG_NAMES, SONGS, type SongName } from './songs';

export type { AudioEvents, AudioEventSink, AudioEventType, AudioScene, CarAudioFrame } from './events';
export type { EngineParams, EngineProfile } from './engine';
export type { SfxName, SfxParams, Surface, TyreParams } from './sfx';
export type { AudioSettings } from './settings';
export type { SongName } from './songs';
export { ENGINE_PROFILES, PROFILES, SFX_NAMES, SONG_NAMES, SONGS, songSeconds };

/** UI sounds bypass the pause gate. */
const UI_SFX = new Set<SfxName>(['click', 'select', 'back', 'place', 'erase', 'beep', 'go', 'finish', 'checkpoint']);
const STALE = 0.4;

/** Master chain shared by live and offline contexts: music + sfx buses → master → limiter → out (+ analyser tap). */
function buildMix(ctx: BaseAudioContext, out: AudioNode) {
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 4;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.2;
  const master = ctx.createGain();
  const music = ctx.createGain();
  const sfx = ctx.createGain();
  /** Car sounds and in-world one-shots (muted while paused). */
  const world = ctx.createGain();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  world.connect(sfx);
  music.connect(master);
  sfx.connect(master);
  master.connect(limiter).connect(out);
  limiter.connect(analyser);
  return { master, music, sfx, world, limiter, analyser };
}
type Mix = ReturnType<typeof buildMix>;

/** A car's engine, addressable before audio is unlocked. */
export class EngineHandle {
  voice: EngineVoice | null = null;
  constructor(
    private sys: AudioSystem,
    readonly id: number,
    public profile: EngineProfile,
  ) {}
  set(p: EngineParams & { profile?: EngineProfile }) {
    if (p.profile && p.profile !== this.profile) this.setProfile(p.profile);
    const mix = this.sys.mixer;
    if (!mix || !this.sys.ctx) return this;
    this.voice ??= new EngineVoice(this.sys.ctx, mix.world, this.profile);
    this.voice.apply(p);
    return this;
  }
  setProfile(p: EngineProfile) {
    this.profile = p;
    this.voice?.dispose();
    this.voice = null;
    return this;
  }
  /** Play a gear change without a gear number (set({gear}) does this automatically). */
  shift(up = true) {
    this.voice?.shift(up);
  }
  stop() {
    this.voice?.dispose();
    this.voice = null;
  }
}

class VoiceHandle<V extends { lastUpdate: number; silence(): void; dispose(): void }, A extends unknown[]> {
  voice: V | null = null;
  constructor(
    private sys: AudioSystem,
    private make: (ctx: AudioContext, dest: AudioNode) => V,
    private apply: (v: V, ...a: A) => unknown,
  ) {}
  set(...a: A) {
    const mix = this.sys.mixer;
    if (!mix || !this.sys.ctx) return undefined;
    this.voice ??= this.make(this.sys.ctx, mix.world);
    return this.apply(this.voice, ...a);
  }
  stop() {
    this.voice?.dispose();
    this.voice = null;
  }
}

export class AudioSystem implements AudioEventSink {
  ctx: AudioContext | null = null;
  settings: AudioSettings = loadSettings();
  /** The car whose frames drive the wind when a frame doesn't say `player`. */
  playerCar = 0;
  /** M toggles mute (the game turns this off while initials are typed). */
  muteKey = true;
  private mix: Mix | null = null;
  private player: SongPlayer | null = null;
  private songName: SongName | null = null;
  private wantedSong: SongName | null = null;
  private engines = new Map<number, EngineHandle>();
  private tyreVoices = new Map<number, VoiceHandle<TyreVoice, [TyreParams]>>();
  private scrapes = new Map<number, VoiceHandle<ScrapeVoice, [number, number?]>>();
  private windVoice: WindVoice | null = null;
  private pendingRace = false;
  private raceTimer: ReturnType<typeof setTimeout> | null = null;
  private reaper: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<() => void>();
  private paused = false;
  /** Music level in the current scene (races duck it under the cars). */
  private musicDuck = 1;
  /** Car sounds off (a replay paused or winding). */
  private worldMuted = false;
  /** The camera is in the car: louder engine, muffled wind and tyres. */
  private cabin = false;

  constructor() {
    const unlock = () => this.unlock();
    for (const ev of ['keydown', 'pointerdown', 'touchend', 'click']) window.addEventListener(ev, unlock, { capture: true });
    window.addEventListener('keydown', (e) => {
      const t = e.target;
      const typing = t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && !['range', 'checkbox', 'button', 'radio'].includes(t.type));
      if (this.muteKey && e.code === 'KeyM' && !e.repeat && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) this.toggleMute();
    });
  }

  get mixer() {
    return this.mix;
  }
  get unlocked() {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** Create / resume the AudioContext. Safe to call repeatedly; the first call must be inside a user gesture. */
  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.mix = buildMix(this.ctx, this.ctx.destination);
      this.applyVolumes();
      this.reaper = setInterval(() => this.reap(), 150);
      if (this.wantedSong) this.music(this.wantedSong);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** RMS of the final mix right now (0 = silence); for checks and meters. */
  level() {
    if (!this.mix) return 0;
    const a = this.mix.analyser;
    const buf = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(buf);
    let s = 0;
    for (const v of buf) s += v * v;
    return Math.sqrt(s / buf.length);
  }

  /** Peak sample of the final mix right now (0..1); for checks. */
  peak() {
    if (!this.mix) return 0;
    const a = this.mix.analyser;
    const buf = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(buf);
    let p = 0;
    for (const v of buf) p = Math.max(p, Math.abs(v));
    return p;
  }

  // ---- settings ------------------------------------------------------------------------------------------------

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  setVolume(kind: 'master' | 'music' | 'sfx', v: number) {
    this.settings[kind] = Math.max(0, Math.min(1, v));
    this.commit();
  }
  setMuted(m: boolean) {
    this.settings.muted = m;
    this.commit();
  }
  toggleMute() {
    this.setMuted(!this.settings.muted);
  }
  private commit() {
    saveSettings(this.settings);
    this.applyVolumes();
    this.listeners.forEach((f) => f());
  }
  private applyVolumes() {
    if (!this.ctx || !this.mix) return;
    const now = this.ctx.currentTime;
    const s = this.settings;
    this.mix.master.gain.setTargetAtTime(s.muted ? 0 : s.master, now, 0.03);
    // Paused: the music ducks a little further under the pause menu.
    this.mix.music.gain.setTargetAtTime(s.music * 0.8 * this.musicDuck * (this.paused ? 0.6 : 1), now, this.paused ? 0.08 : 0.3);
    this.mix.sfx.gain.setTargetAtTime(s.sfx, now, 0.03);
    this.mix.world.gain.setTargetAtTime(this.paused || this.worldMuted ? 0 : 1, now, 0.05);
  }
  setPaused(p: boolean) {
    this.paused = p;
    this.applyVolumes();
  }
  /** Car sounds on / off without pausing (replays while paused or winding). */
  setWorldMuted(m: boolean) {
    if (m === this.worldMuted) return;
    this.worldMuted = m;
    this.applyVolumes();
  }
  /** The camera is inside the player's car. */
  setCabin(on: boolean) {
    this.cabin = on;
  }
  get inCabin() {
    return this.cabin;
  }

  // ---- music ---------------------------------------------------------------------------------------------------

  get currentSong() {
    return this.songName;
  }
  /** Play a song (looping), or stop with null. */
  music(name: SongName | null) {
    if (name === null) return this.stopMusic();
    if (!SONGS[name]) throw new Error(`unknown song "${name}" (have: ${SONG_NAMES.join(', ')})`);
    this.wantedSong = name;
    if (!this.ctx || !this.mix) return;
    if (this.songName === name && this.player) return;
    this.player?.stop();
    const p = new SongPlayer(this.ctx, this.mix.music, SONGS[name]);
    p.onEnd = () => {
      if (this.player !== p) return;
      this.player = null;
      this.songName = null;
      this.wantedSong = null;
    };
    this.player = p;
    this.songName = name;
    p.start();
  }
  stopMusic() {
    this.wantedSong = null;
    this.songName = null;
    this.player?.stop();
    this.player = null;
  }

  // ---- sfx and voices ------------------------------------------------------------------------------------------

  sfx(name: SfxName, opts: SfxParams = {}) {
    if (!this.ctx || !this.mix || this.ctx.state !== 'running') return;
    playSfx(this.ctx, UI_SFX.has(name) ? this.mix.sfx : this.mix.world, name, opts);
  }

  /** A car's engine voice (created on first use; `profile` sets / swaps the voice). */
  engine(id: number, profile?: EngineProfile) {
    let h = this.engines.get(id);
    if (!h) this.engines.set(id, (h = new EngineHandle(this, id, profile ?? 'v8')));
    else if (profile && profile !== h.profile) h.setProfile(profile);
    return h;
  }

  /** A car's tyres: rolling noise + skid per surface. set() returns true when the surface just changed. */
  tyres(id: number) {
    let h = this.tyreVoices.get(id);
    if (!h)
      this.tyreVoices.set(
        id,
        (h = new VoiceHandle<TyreVoice, [TyreParams]>(
          this,
          (c, d) => new TyreVoice(c, d),
          (v, p) => v.set(p),
        )),
      );
    return h;
  }

  /** A car's wall scrape: set(amount 0..1, x). */
  scrape(id: number) {
    let h = this.scrapes.get(id);
    if (!h)
      this.scrapes.set(
        id,
        (h = new VoiceHandle<ScrapeVoice, [number, number?]>(
          this,
          (c, d) => new ScrapeVoice(c, d),
          (v, a, x) => v.set(a, x),
        )),
      );
    return h;
  }

  /** Wind past the player's car; speed in m/s. */
  wind(speed: number, muffled = false) {
    if (!this.ctx || !this.mix) return;
    this.windVoice ??= new WindVoice(this.ctx, this.mix.world);
    this.windVoice.set(speed, undefined, muffled ? 0.4 : 1.15, muffled);
  }

  /** Stop one car's voices. */
  removeCar(id: number) {
    this.engines.get(id)?.stop();
    this.tyreVoices.get(id)?.stop();
    this.scrapes.get(id)?.stop();
    this.engines.delete(id);
    this.tyreVoices.delete(id);
    this.scrapes.delete(id);
  }

  /** Stop every continuous voice (scene change). */
  stopVoices() {
    for (const id of new Set([...this.engines.keys(), ...this.tyreVoices.keys(), ...this.scrapes.keys()])) this.removeCar(id);
    this.windVoice?.dispose();
    this.windVoice = null;
  }

  private reap() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const voices = [...[...this.engines.values()].map((h) => h.voice), ...[...this.tyreVoices.values()].map((h) => h.voice), ...[...this.scrapes.values()].map((h) => h.voice), this.windVoice];
    for (const v of voices) if (v && v.lastUpdate >= 0 && now - v.lastUpdate > STALE) v.silence();
  }

  // ---- the event contract (./events.ts) -------------------------------------------------------------------------

  emit<K extends AudioEventType>(type: K, e: AudioEvents[K]) {
    switch (type) {
      case 'car':
        return this.carFrame(e as CarAudioFrame);
      case 'impact': {
        const i = e as AudioEvents['impact'];
        const name: SfxName = i.kind === 'bump' ? 'bump' : i.kind === 'land' ? 'land' : i.kind === 'car' ? 'carHit' : 'wallHit';
        return this.sfx(name, { strength: i.strength, x: i.x });
      }
      case 'crash': {
        const c = e as AudioEvents['crash'];
        if (c.car !== undefined) this.removeCar(c.car);
        return this.sfx('crash', { strength: c.strength ?? 1, x: c.x });
      }
      case 'countdown': {
        const n = (e as AudioEvents['countdown']).n;
        if (n > 0) return this.sfx('beep', { n });
        this.sfx('go');
        return this.startRaceMusic();
      }
      case 'checkpoint':
        return this.sfx('checkpoint');
      case 'finish': {
        const f = e as AudioEvents['finish'];
        if (!(f.player ?? f.car === this.playerCar)) return;
        return this.sfx(f.place === undefined || f.place === 1 ? 'finish' : 'checkpoint');
      }
      case 'scene':
        return this.scene((e as AudioEvents['scene']).name);
      case 'ui':
        return this.sfx((e as AudioEvents['ui']).kind);
      case 'carGone':
        return this.removeCar((e as AudioEvents['carGone']).car);
      case 'pause':
        return this.setPaused((e as AudioEvents['pause']).paused);
    }
  }

  private carFrame(f: CarAudioFrame) {
    const player = f.player ?? f.car === this.playerCar;
    const level = f.level ?? (player ? 1 : 0.4);
    const x = f.x ?? 0;
    // In the car: the engine fills the cabin, the tyres and the wind are behind glass. Outside: the other way round.
    const cabin = player && this.cabin;
    this.engine(f.car, f.profile).set({ rpm: f.rpm, throttle: f.throttle, load: f.load, gear: f.gear, x, level: level * (player ? (cabin ? 1.2 : 0.9) : 1) });
    const surface = f.surface ?? 'paved';
    const changed = this.tyres(f.car).set({ slip: f.slip ?? 0, surface, speed: f.speed, grounded: f.grounded, x, level: level * (cabin ? 0.65 : 1) });
    if (changed && player) this.sfx('surface', { surface, x });
    if ((f.scrape ?? 0) > 0 || this.scrapes.has(f.car)) this.scrape(f.car).set((f.scrape ?? 0) * level, x);
    if (player) this.wind(f.speed, cabin);
  }

  private scene(name: AudioScene) {
    this.stopVoices();
    this.worldMuted = false;
    this.musicDuck = name === 'race' || name === 'replay' ? 0.7 : 1;
    this.setPaused(false);
    if (this.raceTimer) clearTimeout(this.raceTimer);
    this.pendingRace = false;
    if (name === 'race') {
      // Race music waits for GO (or 8 s if the countdown never comes).
      this.stopMusic();
      this.pendingRace = true;
      this.raceTimer = setTimeout(() => this.startRaceMusic(), 8000);
    } else if (name === 'replay') this.music('race');
    else if (name === 'silence') this.stopMusic();
    else this.music(name);
  }

  private startRaceMusic() {
    if (this.raceTimer) clearTimeout(this.raceTimer);
    this.raceTimer = null;
    if (this.pendingRace) this.music('race');
    this.pendingRace = false;
  }

  dispose() {
    this.stopMusic();
    this.stopVoices();
    if (this.reaper) clearInterval(this.reaper);
    void this.ctx?.close();
  }
}

let system: AudioSystem | null = null;
/** The page's audio system (created on first use; installs the unlock and M listeners). */
export function getAudio() {
  return (system ??= new AudioSystem());
}

// ---- offline renders (checks, tools) ---------------------------------------------------------------------------

export interface RenderStats {
  rms: number;
  peak: number;
  seconds: number;
}

async function renderBuffer(seconds: number, fill: (ctx: OfflineAudioContext, mix: Mix) => void): Promise<AudioBuffer> {
  const rate = 44100;
  const ctx = new OfflineAudioContext(2, Math.ceil(rate * seconds), rate);
  const mix = buildMix(ctx, ctx.destination);
  mix.music.gain.value = 0.8;
  fill(ctx, mix);
  return ctx.startRendering();
}

/** A song rendered offline as stereo samples (scripts/render-music.mjs writes them to WAV for videos). */
export async function renderSongPcm(name: SongName, seconds: number): Promise<{ rate: number; left: Float32Array; right: Float32Array }> {
  const buf = await renderBuffer(seconds, (ctx, mix) => scheduleAll(ctx, mix.music, SONGS[name], 0.05, seconds));
  return { rate: buf.sampleRate, left: buf.getChannelData(0), right: buf.getChannelData(1) };
}

async function renderOffline(seconds: number, fill: (ctx: OfflineAudioContext, mix: Mix) => void): Promise<RenderStats> {
  const buf = await renderBuffer(seconds, fill);
  let sum = 0;
  let peak = 0;
  let n = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (const v of d) {
      sum += v * v;
      peak = Math.max(peak, Math.abs(v));
    }
    n += d.length;
  }
  return { rms: Math.sqrt(sum / n), peak, seconds };
}

/** Render `seconds` of a song offline at full volume. */
export const renderSong = (name: SongName, seconds = 4) => renderOffline(seconds, (ctx, mix) => scheduleAll(ctx, mix.music, SONGS[name], 0.05, seconds));
/** Render a one-shot offline. */
export const renderSfx = (name: SfxName, seconds = 2, p: SfxParams = {}) => renderOffline(seconds, (ctx, mix) => playSfx(ctx, mix.sfx, name, p, 0.05));
/** Render an engine revving idle → redline → idle (full throttle up, lift off down) with an upshift in the middle. */
export const renderEngine = (profile: EngineProfile, seconds = 3) =>
  renderOffline(seconds, (ctx, mix) => {
    const d = PROFILES[profile];
    const v = new EngineVoice(ctx, mix.sfx, profile, 0);
    const steps = Math.floor(seconds / 0.03);
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const up = u < 0.6;
      const r = up ? u / 0.6 : 1 - (u - 0.6) / 0.4;
      v.apply({ rpm: d.idle + (d.redline - d.idle) * r, throttle: up ? 1 : 0, load: up ? 0.8 : 0, gear: u < 0.3 ? 1 : 2 }, i * 0.03);
    }
    v.dispose(seconds);
  });
/** Render a tyre skid on a surface. */
export const renderTyres = (surface: TyreParams['surface'], seconds = 1.5) =>
  renderOffline(seconds, (ctx, mix) => {
    const v = new TyreVoice(ctx, mix.sfx, 0);
    for (let t = 0; t < seconds; t += 0.05) v.set({ slip: [0.2, 0.3, 0.8, 0.9], surface, speed: 30 }, t);
  });
