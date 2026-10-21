// Frame-exact capture for trailers and the documentary (?scene=capture, or ?capture): window.__cs.capture.
// Nothing runs on the wall clock. A take is a race on one of our bundled tracks, simulated in full up front on the
// real 20 Hz simulation (the path follower drives, optionally flat out into jumps, optionally against a rival); then
// every video frame is rendered on request at an exact take time with a shot from the cinematic director
// (src/render/cinema.ts), overlays in the game's style (capture-overlay.ts) composited on top, and returned as a
// JPEG. Slow motion is just smaller time steps between frames (the take is interpolated between steps). The sound
// of each clip is the game's own engine / tyre / impact voices, logged per rendered frame and rendered offline
// (src/audio/take.ts). scripts/record.mjs drives this with Playwright and pipes the frames to ffmpeg.
//
//   const cap = window.__cs.capture;
//   await cap.load({ track: 'lagoon-leap', car: 'car-super', rival: 'nova', seconds: 60 })   // -> moments
//   cap.clipStart(60);  const jpeg = await cap.frame({ t: 12.5, shot: { type: 'chase' }, dt: 1 / 60 });
//   const wav = await cap.clipSound();
import * as THREE from 'three';
import { createScene, createStage } from '../engine/renderer';
import { hasModels, loadModel } from '../models';
import { carInfo, opponentInfo } from '../game/catalog';
import { CarSoundTracker, type CarSound } from '../game/car-sound';
import { PROFILES } from '../audio/engine';
import { viewCar } from '../game/sim-session';
import type { CarState as GameCar } from '../game/types';
import { CarView } from '../render/car-view';
import { Dashboard } from '../render/dashboard';
import { Director, type CinemaCar, type Shot, type TakeTimeline } from '../render/cinema';
import { CinemaFx, type Burst } from '../render/cinema-fx';
import { buildWorld, type World } from '../render/world';
import { Autopilot } from '../sim/autopilot';
import type { CarState as SimCar } from '../sim/car';
import { INPUT_ACCEL, INPUT_BRAKE } from '../sim/engine';
import { Race, RULES, type RacerEvent } from '../sim/race';
import { RouteDriver } from '../sim/opponent';
import { opponentProfile } from '../sim/opponents';
import { nearestOnPath } from '../sim/track-path';
import { carParams } from '../sim/tunings';
import { getTrack, TRACKS } from '../track/tracks';
import { PIXEL_FONT } from '../ui/pixel';
import { renderTakeSound, wavBytes, type TakeCarSound, type TakeSoundFrame } from '../audio/take';
import type { Surface } from '../audio/sfx';
import { drawOverlays, type Overlay } from './capture-overlay';

const HZ = 20;
const MPH = 0.44704;

const SURFACE: Surface[] = ['paved', 'paved', 'dirt', 'ice', 'grass', 'dirt'];

export interface TakeSpec {
  /** A bundled track id (src/track/tracks/): never a local reference track. */
  track: string;
  car: string;
  paint?: string | null;
  /** A rival id (src/game/catalog.ts OPPONENTS) or null. */
  rival?: string | null;
  /** The player's path-follower pace 0..1 (default 0.8) and lane (track units, + right). */
  pace?: number;
  lane?: number;
  /** Flat out from this many path sections before each jump (0 = the path follower's own throttle). */
  flat?: number;
  /** Staged driving between take times: 'coast' (off the throttle: a jump falls short), 'brake', 'flat' (flat out). */
  override?: { from: number; to: number; mode: 'coast' | 'brake' | 'flat' }[];
  /** Take length to simulate (s). */
  seconds: number;
}

interface TickCar {
  view: GameCar;
  rpm: number;
  idle: number;
  max: number;
  gear: number;
  throttle: number;
  slip: number;
  surface: Surface;
  grounded: boolean;
  /** Wheels in water. */
  water: boolean;
  /** The game's own sound state for this step (src/game/car-sound.ts): what live races and replays play. */
  sound: CarSound;
  events: RacerEvent['kind'][];
}

interface Tick {
  player: TickCar;
  rival: TickCar | null;
  kind: string;
  section: number;
}

/** What a take contains, for choosing shots (times in take seconds). */
export interface TakeSummary {
  duration: number;
  finished: number | null;
  sections: { kind: string; from: number; to: number; section: number }[];
  air: { who: 'player' | 'rival'; from: number; to: number; rise: number; mph: number; landed: boolean }[];
  crashes: { who: 'player' | 'rival'; t: number; kind: string; mph: number }[];
  resets: { who: 'player' | 'rival'; t: number }[];
  /** Times the cars are within 15 m of each other (start of each close spell and its length). */
  close: { from: number; to: number; minGap: number }[];
  speed: number[];
}

function tickCar(c: SimCar, maxRpm: number, crashed: boolean, input: number, events: RacerEvent[], sound: CarSound): TickCar {
  return {
    view: viewCar(c, maxRpm, crashed),
    rpm: c.rpm,
    idle: c.idleRpm,
    max: maxRpm,
    gear: c.gear,
    throttle: input & INPUT_ACCEL ? 1 : 0,
    slip: c.sliding ? Math.min(1, 0.35 + Math.abs(c.slideAngle) / 80) : 0,
    surface: SURFACE[c.wheelSurface.find((s) => s > 0) ?? 1] ?? 'paved',
    grounded: c.surfAll !== 0,
    water: c.wheelSurface.filter((s) => s === 5).length >= 2,
    sound,
    events: events.map((e) => e.kind),
  };
}

class Take implements TakeTimeline {
  ticks: Tick[] = [];
  summary!: TakeSummary;
  bursts: Burst[] = [];
  constructor(
    readonly spec: TakeSpec,
    readonly track = getTrack(spec.track)!.track,
  ) {}

  simulate() {
    const s = this.spec;
    const opp = opponentInfo(s.rival ?? null);
    const race = new Race({
      track: this.track,
      player: carParams(s.car),
      automatic: true,
      opponent: opp ? { driver: new RouteDriver(opponentProfile(opp.id), carParams(opp.carId)) } : null,
    });
    // As the game's session does: the built-in driver keeps to the player's side of the grid while there is a rival.
    const pc = race.player.car;
    const side = race.opponent ? Math.sign(nearestOnPath(race.path, pc.pos[0] / 64, pc.pos[2] / 64, [0])?.lateral ?? -1) : 0;
    const pilot = new Autopilot(race.path, race.player.params, { pace: s.pace ?? 0.8, lane: s.lane ?? side * RULES.gridSide * 0.5, sim: { surface: race.surface, rules: race.rules } });
    race.onAnyReset((r, sec) => {
      if (r === race.player) pilot.resync(sec);
    });
    const secs = race.path.sections;
    const sounds = [new CarSoundTracker(), new CarSoundTracker()];
    const snap = (input: number, oppInput: number): Tick => ({
      player: tickCar(race.player.car, race.player.params.maxRpm, race.player.crashed, input, race.player.events, sounds[0].measure(race.player.car, race.player.params)),
      rival: race.opponent ? tickCar(race.opponent.car, race.opponent.params.maxRpm, race.opponent.crashed, oppInput, race.opponent.events, sounds[1].measure(race.opponent.car, race.opponent.params)) : null,
      kind: secs[Math.min(race.player.section, secs.length - 1)]?.kind ?? '',
      section: race.player.section,
    });
    this.ticks = [snap(0, 0)];
    const n = Math.ceil(s.seconds * HZ);
    let finished: number | null = null;
    for (let i = 0; i < n; i++) {
      let input = pilot.input(race.player.car);
      // Staged moments: lift off (a jump falls short), brake, or flat out, between take times.
      for (const o of s.override ?? [])
        if (i / HZ >= o.from && i / HZ < o.to) input = o.mode === 'coast' ? input & ~(INPUT_ACCEL | INPUT_BRAKE) : o.mode === 'brake' ? (input & ~INPUT_ACCEL) | INPUT_BRAKE : (input & ~INPUT_BRAKE) | INPUT_ACCEL;
      if (s.flat) {
        const here = race.player.section;
        for (let k = 0; k <= s.flat; k++) if (secs[(here + k) % secs.length]?.jumpGap > 0) input = (input & ~INPUT_BRAKE) | INPUT_ACCEL;
      }
      race.step(input);
      if (race.player.finished && finished === null) finished = (i + 1) / HZ;
      // The opponent's pedal is not exposed; its engine sound follows its speed change instead.
      const o = race.opponent?.car;
      this.ticks.push(snap(input, o && o.speedDelta >= 0 ? INPUT_ACCEL : 0));
    }
    this.summary = this.summarise(finished);
    this.bursts = this.findBursts();
  }

  /** Crashes, splashes and hard landings, for the effects. */
  private findBursts(): Burst[] {
    const out: Burst[] = [];
    const vel = (who: 'player' | 'rival', i: number) => {
      const a = this.ticks[Math.max(0, i - 2)][who]!.view.pos;
      const b = this.ticks[Math.max(0, i - 1)][who]!.view.pos;
      return new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).multiplyScalar(HZ);
    };
    for (const who of ['player', 'rival'] as const) {
      let air = 0;
      for (const [i, tk] of this.ticks.entries()) {
        const c = tk[who];
        if (!c) break;
        const pos = new THREE.Vector3(...c.view.pos);
        if (c.events.includes('crash')) {
          // Water: the crash comes a step or two after the wheels touch it.
          const wet = [0, 1, 2, 3].some((k) => this.ticks[Math.max(0, i - k)][who]!.water) || c.water;
          const v = vel(who, i);
          out.push({ kind: wet ? 'splash' : 'crash', t: i / HZ, pos, vel: v, strength: Math.min(1, 0.45 + v.length() / 50) });
        }
        if (!c.grounded) air++;
        else {
          if (air >= 14 && !c.view.crashed && !c.water) out.push({ kind: 'dust', t: i / HZ, pos, vel: vel(who, i), strength: Math.min(1, air / 40) });
          air = 0;
        }
      }
    }
    return out.sort((a, b) => a.t - b.t);
  }

  private summarise(finished: number | null): TakeSummary {
    const sum: TakeSummary = { duration: this.duration, finished, sections: [], air: [], crashes: [], resets: [], close: [], speed: [] };
    let cur: TakeSummary['sections'][number] | null = null;
    const airAt: Record<string, { from: number; y0: number; top: number; mph: number } | null> = { player: null, rival: null };
    let close: TakeSummary['close'][number] | null = null;
    for (const [i, tk] of this.ticks.entries()) {
      const t = i / HZ;
      if (!cur || cur.section !== tk.section) {
        if (cur) cur.to = t;
        cur = { kind: tk.kind, from: t, to: t, section: tk.section };
        sum.sections.push(cur);
      }
      if (i % HZ === 0) sum.speed.push(Math.round(tk.player.view.speedMph));
      for (const who of ['player', 'rival'] as const) {
        const c = tk[who];
        if (!c) continue;
        const a = airAt[who];
        if (!c.grounded && !a) airAt[who] = { from: t, y0: c.view.pos[1], top: c.view.pos[1], mph: c.view.speedMph };
        else if (!c.grounded && a) a.top = Math.max(a.top, c.view.pos[1]);
        else if (c.grounded && a) {
          if (t - a.from >= 0.4) sum.air.push({ who, from: a.from, to: t, rise: +(a.top - a.y0).toFixed(1), mph: Math.round(a.mph), landed: true });
          airAt[who] = null;
        }
        if (c.events.includes('crash')) {
          sum.crashes.push({ who, t, kind: tk.kind, mph: Math.round(this.ticks[Math.max(0, i - 1)][who]!.view.speedMph) });
          const last = sum.air.filter((x) => x.who === who).pop();
          if (last && t - last.to < 0.6) last.landed = false;
          if (a && !c.grounded) {
            sum.air.push({ who, from: a.from, to: t, rise: +(a.top - a.y0).toFixed(1), mph: Math.round(a.mph), landed: false });
            airAt[who] = null;
          }
        }
        if (c.events.includes('reset')) sum.resets.push({ who, t });
      }
      if (tk.rival) {
        const d = Math.hypot(tk.player.view.pos[0] - tk.rival.view.pos[0], tk.player.view.pos[2] - tk.rival.view.pos[2]);
        if (d < 15 && !close) close = { from: t, to: t, minGap: d };
        if (close) {
          close.minGap = Math.min(close.minGap, +d.toFixed(1));
          if (d >= 15) {
            close.to = t;
            if (close.to - close.from >= 1) sum.close.push(close);
            close = null;
          }
        }
      }
    }
    if (cur) cur.to = this.duration;
    return sum;
  }

  get duration() {
    return (this.ticks.length - 1) / HZ;
  }

  private at(t: number): [Tick, Tick, number] {
    const x = Math.max(0, Math.min(this.ticks.length - 1, t * HZ));
    const i = Math.min(this.ticks.length - 2, Math.floor(x));
    return [this.ticks[i], this.ticks[i + 1] ?? this.ticks[i], x - i];
  }

  /** The car at take time t (game coordinates). */
  gameCar(who: 'player' | 'rival', t: number) {
    const [a, b, k] = this.at(t);
    const ca = a[who];
    const cb = b[who];
    if (!ca || !cb) return null;
    // A reset teleports the car: no interpolation across it.
    const jump = Math.hypot(ca.view.pos[0] - cb.view.pos[0], ca.view.pos[1] - cb.view.pos[1], ca.view.pos[2] - cb.view.pos[2]) > 30;
    const kk = jump ? (k < 0.5 ? 0 : 1) : k;
    return { a: ca, b: cb, k: kk, tick: k < 0.5 ? ca : cb };
  }

  /**
   * Orientation easing (s): the 20 Hz simulation turns the car in uneven steps (through a loop's entry the pitch
   * goes 5°, 2.6°, 1.5°, 0°, 1.8° per step), which straight interpolation shows as a judder in the in-car view.
   * The car's orientation is the mean of the interpolated ones over ±`ease` (a box filter two steps wide), so the
   * turn rate ramps instead of jumping. 0 = raw interpolation.
   */
  ease = 0.05;

  /** The car's orientation at take time t (eased). */
  quat(who: 'player' | 'rival', t: number): THREE.Quaternion | null {
    const raw = (tt: number) => {
      const g = this.gameCar(who, tt);
      return g ? new THREE.Quaternion(...g.a.view.quat).slerp(new THREE.Quaternion(...g.b.view.quat), g.k) : null;
    };
    if (!this.ease) return raw(t);
    const a = raw(Math.max(0, t - this.ease));
    const b = raw(Math.min(this.duration, t + this.ease));
    const g = this.gameCar(who, t);
    if (!a || !b || !g) return raw(t);
    // Not across a reset (teleport).
    const pa = this.gameCar(who, Math.max(0, t - this.ease))!.a.view.pos;
    const pb = this.gameCar(who, Math.min(this.duration, t + this.ease))!.b.view.pos;
    if (Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]) > 40) return raw(t);
    // A running mean of samples across the window (a box filter, so the turn rate ramps between steps).
    const q = a.clone();
    const n = 9;
    for (let i = 1; i < n; i++) {
      const s = raw(Math.min(this.duration, Math.max(0, t - this.ease + (2 * this.ease * i) / (n - 1))));
      if (s) q.slerp(s, 1 / (i + 1));
    }
    return q;
  }

  car(who: 'player' | 'rival', t: number): CinemaCar | null {
    const g = this.gameCar(who, t);
    if (!g) return null;
    const { a, b, k } = g;
    return {
      pos: new THREE.Vector3(...a.view.pos).lerp(new THREE.Vector3(...b.view.pos), k),
      quat: this.quat(who, t)!,
      speed: (a.view.speedMph + (b.view.speedMph - a.view.speedMph) * k) * MPH,
      airborne: !g.tick.grounded,
      crashed: g.tick.view.crashed,
    };
  }

  /** One-shot sounds between two take times (exclusive, inclusive): the game's own (CarState.sound hits, crash, finish). */
  hits(who: 'player' | 'rival', t0: number, t1: number) {
    const out: { name: 'land' | 'bump' | 'wallHit' | 'carHit' | 'crash' | 'finish'; strength: number }[] = [];
    const NAME = { land: 'land', bump: 'bump', wall: 'wallHit', car: 'carHit' } as const;
    for (let i = Math.floor(t0 * HZ) + 1; i <= Math.floor(t1 * HZ) && i < this.ticks.length; i++) {
      const c = this.ticks[i][who];
      const prev = this.ticks[i - 1][who];
      if (!c || !prev) continue;
      if (c.view.crashed && !prev.view.crashed) out.push({ name: 'crash', strength: 1 });
      else for (const h of c.sound.hits) out.push({ name: NAME[h.kind], strength: h.strength });
      if (c.events.includes('finish') && who === 'player') out.push({ name: 'finish', strength: 1 });
    }
    return out;
  }
}

export interface FrameRequest {
  /** Take time (s). */
  t: number;
  shot: Shot;
  /** Take seconds since the previous frame of this shot (smaller in slow motion). */
  dt: number;
  /** 0..1 through the shot (aerial flights). */
  u?: number;
  overlays?: Overlay[];
  /** Show the speed box (the race HUD) on this frame. */
  hud?: boolean;
  /** Video seconds per take second, for the sound (1 = real time, 0.25 = 4× slow motion). */
  slow?: number;
  /** JPEG quality 0..1. */
  quality?: number;
  /** Motion-blur samples per frame (1 = none). */
  blur?: number;
}

export async function startCapture() {
  if (!hasModels()) throw new Error('capture needs the generator models (npm run assets)');
  const stage = createStage(document.body);
  const renderer = stage.renderer;
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight);
  const W = innerWidth;
  const H = innerHeight;
  await document.fonts.load(`20px ${PIXEL_FONT}`);
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const c2 = out.getContext('2d')!;
  const dash = new Dashboard(document.body);
  const fx = new CinemaFx();

  let take: Take | null = null;
  let world: World | null = null;
  let scene: THREE.Scene | null = null;
  let director: Director | null = null;
  let player: CarView | null = null;
  let rival: CarView | null = null;
  let worldTrack = '';
  let sound: TakeSoundFrame[] = [];
  let clipFps = 60;
  let lastT = -1;
  let carsFor = '';

  async function load(spec: TakeSpec): Promise<TakeSummary> {
    const entry = getTrack(spec.track);
    if (!entry) throw new Error(`no bundled track "${spec.track}" (have: ${TRACKS.map((t) => t.id).join(', ')})`);
    take = new Take(spec, entry.track);
    take.simulate();
    if (worldTrack !== spec.track) {
      scene?.clear();
      const s = new THREE.Scene();
      // Lights as the race uses them (createScene), then the set's atmosphere.
      const made = createScene();
      for (const ch of [...made.scene.children]) s.add(ch);
      world = await buildWorld(s, made.sun, entry.track);
      scene = s;
      worldTrack = spec.track;
      carsFor = '';
    }
    const key = `${spec.track}|${spec.car}|${spec.paint ?? ''}|${spec.rival ?? ''}`;
    if (carsFor !== key) {
      if (player) scene!.remove(player.object);
      if (rival) scene!.remove(rival.object);
      const mk = async (id: string, paint: string | null) => {
        const m = await loadModel(id);
        if (!m) throw new Error(`no model for ${id}`);
        return CarView.create(m, paint ?? undefined);
      };
      player = await mk(spec.car, spec.paint ?? null);
      scene!.add(player.object);
      const opp = opponentInfo(spec.rival ?? null);
      rival = opp ? await mk(opp.carId, spec.paint === 'blue' ? 'red' : 'blue') : null;
      if (rival) scene!.add(rival.object);
      carsFor = key;
    }
    director = new Director(take);
    const ray = new THREE.Raycaster();
    const worldRoot = world!.root;
    director.occluded = (a, b) => {
      const d = b.clone().sub(a);
      const len = d.length();
      ray.set(a, d.normalize());
      ray.far = Math.max(0, len - 3);
      ray.near = 0.5;
      return ray.intersectObject(worldRoot, true).length > 0;
    };
    if (fx.root.parent !== scene) scene!.add(fx.root);
    fx.setBursts(take.bursts);
    director.camera.aspect = W / H;
    // Settle wheels and suspension.
    for (let i = 0; i < 3; i++) placeCars(0, 1 / 60);
    return take.summary;
  }

  function placeCars(t: number, dt: number) {
    for (const [who, view] of [['player', player], ['rival', rival]] as const) {
      if (!view) continue;
      const g = take!.gameCar(who, t);
      if (!g) continue;
      const { a, b, k } = g;
      const mph = a.view.speedMph + (b.view.speedMph - a.view.speedMph) * k;
      view.update(
        {
          position: new THREE.Vector3(...a.view.pos).lerp(new THREE.Vector3(...b.view.pos), k),
          quaternion: take!.quat(who, t)!,
          speed: mph * MPH,
          steer: -(a.view.steer + (b.view.steer - a.view.steer) * k) * 0.55,
          rpm: (a.view.rpm + (b.view.rpm - a.view.rpm) * k) * 8000,
        },
        dt,
      );
    }
  }

  /**
   * A car's continuous sound at take time t, as the game plays it (src/game/game-audio.ts): the sim's sound state
   * (rpm, pedal, load, slip per wheel, surface, scrape) interpolated between steps, the engine voice of the car,
   * placed from the camera with the game's loudness rules. Two touches for film: Doppler on cars passing a fixed
   * camera, and slow motion pitches the engines down.
   */
  function carSound(who: 'player' | 'rival', t: number, cam: THREE.Camera, slow: number, rides: boolean, cockpit: boolean): TakeCarSound | null {
    const g = take!.gameCar(who, t);
    const cc = take!.car(who, t);
    if (!g || !cc) return null;
    if (g.tick.view.crashed) return null;
    const sa = g.a.sound;
    const sb = g.b.sound;
    const k = g.k;
    const carId = who === 'player' ? take!.spec.car : (opponentInfo(take!.spec.rival ?? null)?.carId ?? '');
    const prof = carInfo(carId).engine;
    const def = PROFILES[prof];
    const rel = cc.pos.clone().sub(cam.position);
    const d = rel.length();
    const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const x = rides ? 0 : Math.max(-1, Math.min(1, rel.dot(camRight) / Math.max(6, d)));
    const ahead = take!.car(who, t + 0.05);
    let doppler = 1;
    if (!rides && ahead) {
      const vr = (ahead.pos.distanceTo(cam.position) - d) / 0.05;
      doppler = Math.max(0.75, Math.min(1.25, 343 / (343 + vr)));
    }
    // The game's loudness: the player present (riding cameras full, others by distance), the rival fading.
    const level = who === 'player' ? (rides ? 1 : Math.max(0.25, Math.min(1, 28 / Math.max(1, d)))) : 0.7 * Math.min(1, Math.pow(14 / Math.max(1, d), 1.1));
    const slowK = slow < 1 ? 0.55 + 0.45 * slow : 1;
    const lerp = (a: number, b: number) => a + (b - a) * k;
    return {
      car: who === 'player' ? 0 : 1,
      profile: prof,
      rpm: (def.idle + (def.redline - def.idle) * lerp(sa.rpm, sb.rpm)) * doppler * slowK,
      throttle: sb.throttle,
      load: lerp(sa.load, sb.load),
      gear: g.tick.gear,
      speed: cc.speed * slowK,
      slip: [0, 1, 2, 3].map((i) => lerp(sa.slip[i], sb.slip[i])),
      surface: sb.surface,
      grounded: sb.grounded,
      scrape: sb.scrape,
      x,
      level: level * (slow < 1 ? 0.8 : 1),
      cabin: cockpit && who === 'player',
      player: who === 'player',
    };
  }

  /** Pose the cars, effects and camera for take time t and render the 3D view. */
  function renderAt(t: number, dt: number, req: FrameRequest) {
    placeCars(t, dt);
    fx.update(t);
    const info = director!.frame(req.shot, t, dt, req.u ?? 0);
    const view = info.target === 'rival' ? rival : player;
    player?.setInterior(info.cockpit && view === player);
    rival?.setInterior(info.cockpit && view === rival);
    const cam = director!.camera;
    if (info.cockpit && view) {
      // Re-place with the car's own eye point.
      const cc = take!.car(info.target, t)!;
      cam.position.copy(view.eye).applyQuaternion(cc.quat).add(cc.pos);
    }
    // Shake from hits near the camera.
    const sh = fx.shake(t, (b) => Math.max(0, Math.min(1, 30 / (b.pos.distanceTo(cam.position) + 10))));
    if (sh.yaw || sh.pitch) {
      cam.rotateY(sh.yaw);
      cam.rotateX(sh.pitch);
      cam.position.y += sh.lift;
    }
    cam.updateMatrixWorld();
    world!.atmosphere.update(cam, info.focus, info.wide ? 140 : 55);
    renderer.render(scene!, cam);
    return info;
  }

  async function frame(req: FrameRequest): Promise<string> {
    if (!take || !director || !scene || !world) throw new Error('load a take first');
    const t = Math.max(0, Math.min(take.duration, req.t));
    // Motion blur: several renders across a half-frame shutter, averaged.
    const n = Math.max(1, Math.round(req.blur ?? 1));
    const shutter = 0.5 * Math.max(0, req.dt);
    let info!: ReturnType<Director['frame']>;
    for (let k = 0; k < n; k++) {
      const tk = n === 1 ? t : Math.max(0, t - (shutter * (n - 1 - k)) / (n - 1));
      const dt = k === 0 ? Math.max(0, req.dt - shutter) : shutter / (n - 1);
      info = renderAt(tk, dt, req);
      c2.globalAlpha = 1 / (k + 1);
      c2.drawImage(renderer.domElement, 0, 0, W, H);
    }
    c2.globalAlpha = 1;
    const g = take.gameCar(info.target, t);
    if (info.cockpit && g) {
      dash.visible = true;
      dash.update(Math.abs(g.tick.view.speedMph), g.tick.view.rpm * 8000, 8000);
      c2.drawImage(dash.canvas, 0, H * 0.66, W, H * 0.34);
    } else dash.visible = false;
    const overlays = [...(req.overlays ?? [])];
    if (req.hud && g) overlays.unshift({ kind: 'hud', mph: g.tick.view.speedMph, gear: g.tick.gear, rpm: g.tick.view.rpm });
    drawOverlays(c2, W, H, overlays);
    // Sound for this frame.
    const slow = req.slow ?? 1;
    const rides = ['chase', 'cockpit', 'bumper', 'wheel', 'front', 'side'].includes(req.shot.type);
    const target = info.target;
    const cars = (['player', 'rival'] as const).map((w) => carSound(w, t, director!.camera, slow, rides && w === target, info.cockpit && w === target)).filter((x): x is TakeCarSound => !!x);
    const hits: TakeSoundFrame['hits'] = [];
    if (lastT >= 0 && t > lastT && t - lastT < 0.5)
      for (const w of ['player', 'rival'] as const) {
        const cc = take.car(w, t);
        if (!cc) continue;
        const d = cc.pos.distanceTo(director.camera.position);
        const k = rides && w === target ? 1 : Math.max(0.15, Math.min(1, 14 / (d + 4)));
        for (const h of take.hits(w, lastT, t)) hits.push({ name: h.name, strength: h.strength * k, x: 0 });
      }
    lastT = t;
    const speed = take.car(target, t)?.speed ?? 0;
    sound.push({ t: sound.length / clipFps, cars, hits, wind: rides ? (req.shot.type === 'cockpit' ? 0.6 : 1) : 0.2, windSpeed: speed * (slow < 1 ? 0.6 : 1) });
    return out.toDataURL('image/jpeg', req.quality ?? 0.93).slice('data:image/jpeg;base64,'.length);
  }

  /** A frame with no take behind it: a solid colour (or the last frame) under overlays (title cards). */
  const images = new Map<string, HTMLImageElement>();
  async function image(url: string) {
    let im = images.get(url);
    if (!im) {
      im = new Image();
      im.src = url;
      await im.decode();
      images.set(url, im);
    }
    return im;
  }

  /**
   * A frame with no take behind it, under overlays (title cards, stills): a solid colour, the last frame (keep), or
   * an image (one of our own screenshots, served by the dev server) with a slow push-in, p = 0..1 through the card.
   */
  async function card(overlays: Overlay[], opts: { background?: string; keep?: boolean; image?: string; p?: number; zoom?: number; dim?: number; fit?: 'cover' | 'contain' } = {}): Promise<string> {
    if (!opts.keep) {
      c2.fillStyle = opts.background ?? '#0b0e1c';
      c2.fillRect(0, 0, W, H);
    }
    if (opts.image) {
      const im = await image(opts.image);
      const z = 1 + (opts.zoom ?? 0.08) * (opts.p ?? 0);
      const s = (opts.fit === 'contain' ? Math.min(W / im.width, H / im.height) * 0.94 : Math.max(W / im.width, H / im.height)) * z;
      c2.drawImage(im, (W - im.width * s) / 2, (H - im.height * s) / 2, im.width * s, im.height * s);
      if (opts.dim) {
        c2.fillStyle = `rgba(11,14,28,${opts.dim})`;
        c2.fillRect(0, 0, W, H);
      }
    }
    drawOverlays(c2, W, H, overlays);
    sound.push({ t: sound.length / clipFps, cars: [], hits: [], wind: 0, windSpeed: 0 });
    return out.toDataURL('image/jpeg', 0.93).slice('data:image/jpeg;base64,'.length);
  }

  async function clipSound(): Promise<string> {
    const seconds = sound.length / clipFps + 0.05;
    const pcm = await renderTakeSound(sound, seconds);
    const bytes = wavBytes(pcm.rate, pcm.left, pcm.right);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  window.__cs.capture = {
    size: { width: W, height: H },
    tracks: TRACKS.map((t) => t.id),
    load,
    frame,
    card,
    clipStart: (fps = 60) => {
      sound = [];
      clipFps = fps;
      lastT = -1;
    },
    clipSound,
    /** The car's state at take time t (for scripts that aim shots). */
    car: (who: 'player' | 'rival', t: number) => {
      const c = take?.car(who, t);
      return c ? { pos: c.pos.toArray(), speedMph: c.speed / MPH, airborne: c.airborne, crashed: c.crashed } : null;
    },
    summary: () => take?.summary ?? null,
    /**
     * Smoothness measurements without rendering: per video frame (fps) from take time t0 to t1, the car's and the
     * shot camera's movement since the previous frame (metres) and the camera's change of direction (degrees).
     */
    probe: (shot: Shot, t0: number, t1: number, fps = 60, ease = 0.05) => {
      if (!take || !director) throw new Error('load a take first');
      const was = take.ease;
      take.ease = ease;
      const rows: { t: number; car: number; cam: number; turn: number }[] = [];
      const prevCar = new THREE.Vector3();
      const prevCam = new THREE.Vector3();
      const prevDir = new THREE.Vector3();
      const dir = new THREE.Vector3();
      for (let i = 0, t = t0; t <= t1; i++, t = t0 + i / fps) {
        director.frame(shot, t, i ? 1 / fps : 0);
        const car = take.car('player', t)!.pos;
        director.camera.getWorldDirection(dir);
        if (i) rows.push({ t: +(t - t0).toFixed(4), car: +car.distanceTo(prevCar).toFixed(4), cam: +director.camera.position.distanceTo(prevCam).toFixed(4), turn: +THREE.MathUtils.radToDeg(dir.angleTo(prevDir)).toFixed(4) });
        prevCar.copy(car);
        prevCam.copy(director.camera.position);
        prevDir.copy(dir);
      }
      take.ease = was;
      return rows;
    },
    bursts: () => take?.bursts.map((b) => ({ kind: b.kind, t: b.t, strength: +b.strength.toFixed(2) })) ?? [],
  };
  window.__cs.ready = true;
}
