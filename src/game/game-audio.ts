// The game's sound, the one place the flow talks to src/audio (through its event contract, src/audio/events.ts):
//   screens: scene() picks the music per screen, menu() / tap() the clicks, countdown() the 3-2-1-GO (the race music
//            starts at GO), pause() ducks the music and silences the cars;
//   races:   startRace() per race or replay; cars() once per rendered frame, the continuous voices of the player's car
//            (id 0) and the rival (id 1): engine, tyres per wheel and surface, wall scrape, wind, panned and attenuated
//            from the camera (the listener), smoothed so the 20 Hz steps don't click; events() once per simulation
//            step, the one-offs read from the sim (CarState.sound, src/game/car-sound.ts): landings, bumps, wall and
//            car hits, crashes, checkpoints, the finish; replayPlayback() mutes the cars while a replay is paused or
//            winding; silenceCars() fades every car voice out (results, menus, leaving a replay).
import * as THREE from 'three';
import { getAudio, PROFILES, type AudioSystem, type EngineProfile } from '../audio';
import { carInfo, opponentInfo } from './catalog';
import type { MenuEvent } from '../engine/input';
import type { AudioScene } from '../audio';
import type { CameraMode, CarState, RaceSetup, RaceSnapshot } from './types';

const MPH = 0.44704;
const PLAYER = 0;
const RIVAL = 1;

/** Exponential smoothing towards `to` with time constant `tau` (s). */
const ease = (from: number, to: number, dt: number, tau: number) => from + (to - from) * (1 - Math.exp(-dt / tau));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface Voice {
  throttle: number;
  load: number;
  slip: [number, number, number, number];
  scrape: number;
  /** Silent while crashed (its crash sound plays; the engine comes back when the car is put back). */
  gone: boolean;
}

const voice = (): Voice => ({ throttle: 0, load: 0, slip: [0, 0, 0, 0], scrape: 0, gone: false });

/** One race's (or replay's) car voices. */
class RaceVoices {
  private audio: AudioSystem = getAudio();
  private profiles: [EngineProfile, EngineProfile | null];
  private voices: [Voice, Voice] = [voice(), voice()];
  private ear = new THREE.Vector3();
  private right = new THREE.Vector3(1, 0, 0);
  private hasEar = false;
  /** 1 while racing; falls to 0 once the race is over and frozen (the engines die away instead of droning on). */
  private fade = 1;
  private stopped = false;

  constructor(setup: RaceSetup) {
    const opp = opponentInfo(setup.opponentId);
    this.profiles = [carInfo(setup.carId).engine, opp ? carInfo(opp.carId).engine : null];
  }

  /** The listener: a camera (its position and its right-hand direction). */
  private listen(listener: THREE.Object3D | null | undefined) {
    if (!listener) return;
    listener.updateMatrixWorld();
    this.ear.setFromMatrixPosition(listener.matrixWorld);
    this.right.setFromMatrixColumn(listener.matrixWorld, 0).normalize();
    this.hasEar = true;
  }

  /** Stereo position -1..1 and distance (m) of a point from the listener. */
  private place(pos: THREE.Vector3): { x: number; d: number } {
    if (!this.hasEar) return { x: 0, d: 0 };
    const rel = pos.clone().sub(this.ear);
    const d = rel.length();
    return { x: Math.max(-1, Math.min(1, rel.dot(this.right) / Math.max(d, 6))), d };
  }

  /** Loudness of a car from its distance: the player stays present (it is the game), the rival fades with distance. */
  private level(id: number, d: number, camera: CameraMode) {
    if (id === PLAYER) return camera === 'cockpit' || camera === 'chase' ? 1 : Math.max(0.4, Math.min(1, 28 / Math.max(1, d)));
    return 0.7 * Math.min(1, Math.pow(14 / Math.max(1, d), 1.1));
  }

  /**
   * Once per rendered frame. `frozen`: the race is over and the picture holds still (engines wind down and stop).
   */
  frame(prev: RaceSnapshot, next: RaceSnapshot, alpha: number, dt: number, camera: CameraMode, listener: THREE.Object3D | null | undefined, frozen = false) {
    if (this.stopped) return;
    this.listen(listener);
    this.audio.setCabin(camera === 'cockpit');
    this.fade = frozen ? Math.max(0, this.fade - dt / 1.2) : 1;
    if (this.fade <= 0) return;
    this.car(PLAYER, prev.player, next.player, alpha, dt, camera);
    if (prev.opponent && next.opponent && this.profiles[1]) this.car(RIVAL, prev.opponent, next.opponent, alpha, dt, camera);
  }

  private car(id: number, a: CarState, b: CarState, alpha: number, dt: number, camera: CameraMode) {
    const v = this.voices[id];
    const sa = a.sound;
    const sb = b.sound;
    if (!sa || !sb) return;
    if (b.crashed) {
      if (!v.gone) this.audio.emit('carGone', { car: id });
      v.gone = true;
      return;
    }
    v.gone = false;
    const profile = this.profiles[id]!;
    const def = PROFILES[profile];
    const pos = new THREE.Vector3(...a.pos).lerp(new THREE.Vector3(...b.pos), alpha);
    const { x, d } = this.place(pos);
    let level = this.level(id, d, camera) * this.fade;
    // Beyond earshot: let the voices fade out on their own (no updates) instead of droning at a whisper.
    if (level < 0.02) return;
    v.throttle = ease(v.throttle, sb.throttle, dt, 0.07);
    v.load = ease(v.load, sb.load, dt, 0.1);
    for (let i = 0; i < 4; i++) v.slip[i] = ease(v.slip[i], lerp(sa.slip[i], sb.slip[i], alpha), dt, 0.06);
    v.scrape = ease(v.scrape, sb.scrape, dt, sb.scrape > v.scrape ? 0.03 : 0.12);
    const rn = lerp(sa.rpm, sb.rpm, alpha) * this.fade;
    const speed = Math.abs(lerp(a.speedMph, b.speedMph, alpha)) * MPH * this.fade;
    level = Math.min(1.2, level);
    this.audio.emit('car', {
      car: id,
      player: id === PLAYER,
      profile,
      rpm: def.idle + (def.redline - def.idle) * rn,
      throttle: v.throttle * this.fade,
      load: v.load * this.fade,
      gear: b.gear,
      speed,
      slip: v.slip,
      surface: sb.surface,
      grounded: sb.grounded,
      scrape: v.scrape,
      x,
      level,
    });
  }

  /** Once per simulation step (prev → next): the one-off sounds. */
  step(prev: RaceSnapshot, next: RaceSnapshot, camera: CameraMode) {
    if (this.stopped) return;
    this.hits(PLAYER, prev.player, next.player, camera);
    if (prev.opponent && next.opponent && this.profiles[1]) this.hits(RIVAL, prev.opponent, next.opponent, camera);
    if (next.progress.checkpoint > prev.progress.checkpoint && !next.finished) this.audio.emit('checkpoint', { car: PLAYER });
    if (next.finished && !prev.finished) {
      // Beaten to the line by the rival: the plain chime; otherwise the fanfare.
      const place = prev.opponentFinished ? 2 : 1;
      this.audio.emit('finish', { car: PLAYER, player: true, place });
    }
  }

  private hits(id: number, a: CarState, b: CarState, camera: CameraMode) {
    const { x, d } = this.place(new THREE.Vector3(...b.pos));
    const level = id === PLAYER ? 1 : this.level(id, d, camera) / 0.7;
    if (b.crashed && !a.crashed) {
      this.audio.emit('crash', { car: id, strength: Math.min(1, level), x });
      this.voices[id].gone = true;
      return;
    }
    if (!b.sound || level < 0.06) return;
    for (const h of b.sound.hits) this.audio.emit('impact', { car: id, kind: h.kind, strength: Math.min(1, h.strength * (id === PLAYER ? 1 : 0.4 + 0.6 * level)), x });
  }

  /** Every car voice fades out (the race is over or left). */
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.audio.emit('carGone', { car: PLAYER });
    this.audio.emit('carGone', { car: RIVAL });
    this.audio.setCabin(false);
  }
}

/** The flow's sound. */
export class GameAudio {
  private readonly sys: AudioSystem = getAudio();
  private race: RaceVoices | null = null;
  private count = -1;

  /** Music for a screen ('race' waits for GO). */
  scene(name: AudioScene) {
    this.count = -1;
    this.sys.emit('scene', { name });
  }

  /** A menu press: select on confirm, back on back, a click on moves (and on letters while typing initials). */
  menu(e: MenuEvent, typing = false) {
    const kind = e.key === 'confirm' ? 'select' : e.key === 'back' ? 'back' : e.key || (e.letter && typing) ? 'click' : null;
    if (kind) this.sys.emit('ui', { kind });
  }

  /** A tap on a menu item or button. */
  tap() {
    this.sys.emit('ui', { kind: 'select' });
  }

  /** The countdown digit shown: 3, 2, 1 beep; 0 = GO (starts the race music). Repeats are ignored. */
  countdown(n: number) {
    if (n === this.count || n > 3) return;
    this.count = n;
    this.sys.emit('countdown', { n });
  }

  pause(on: boolean) {
    this.sys.emit('pause', { paused: on });
  }

  /** M is a letter while initials are typed. */
  set muteKey(on: boolean) {
    this.sys.muteKey = on;
  }

  /** A race or replay begins: its cars' voices (engine per car, src/game/catalog.ts). */
  startRace(setup: RaceSetup) {
    this.race?.stop();
    this.race = new RaceVoices(setup);
    this.sys.setWorldMuted(false);
  }

  /** Once per rendered frame. `frozen`: the race is over and the picture holds still (the engines wind down). */
  cars(prev: RaceSnapshot, next: RaceSnapshot, alpha: number, dt: number, camera: CameraMode, listener: THREE.Object3D | null | undefined, frozen = false) {
    this.race?.frame(prev, next, alpha, dt, camera, listener, frozen);
  }

  /** Once per simulation step (prev → next). */
  events(prev: RaceSnapshot, next: RaceSnapshot, camera: CameraMode) {
    this.race?.step(prev, next, camera);
  }

  /** A replay plays forward at normal speed (true) or is paused / winding (false: the cars are muted). */
  replayPlayback(normal: boolean) {
    this.sys.setWorldMuted(!normal);
  }

  /** The race's cars fall silent (results, menus, leaving a replay). */
  silenceCars() {
    this.race?.stop();
    this.race = null;
  }
}
