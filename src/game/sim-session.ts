// The real race for the game flow: a RaceSession on the car simulation (src/sim) and the race rules
// (src/sim/race.ts), and the replay player on top of it. Registered in place of the stubs by registerSimSession().
// Snapshots convert the simulation's integer state to the renderer's metres (x east, y up, -z north).
import { Autopilot } from '../sim/autopilot';
import type { CarState as SimCar } from '../sim/car';
import { RouteDriver, type OpponentDriver } from '../sim/opponent';
import { opponentProfile } from '../sim/opponents';
import { Race, RULES, type Racer } from '../sim/race';
import { nearestOnPath } from '../sim/track-path';
import { carParams } from '../sim/tunings';
import { rotZXY } from '../sim/vec';
import { opponentInfo } from './catalog';
import { CarSoundTracker } from './car-sound';
import { registerReplayPlayer, registerSession } from './integrations';
import { StubReplayPlayer } from './stub-session';
import { SIM_HZ, type CarState, type Progress, type RaceResult, type RaceSession, type RaceSetup, type RaceSnapshot } from './types';
import { UNIT_M } from '../track/types';


/** Metres per physics unit (64 per track unit). */
const PHYS_M = UNIT_M / 64;

/** Quaternion [x, y, z, w] of a rotation matrix given by its columns. */
function quatFromColumns(c0: number[], c1: number[], c2: number[]): [number, number, number, number] {
  const m00 = c0[0], m10 = c0[1], m20 = c0[2];
  const m01 = c1[0], m11 = c1[1], m21 = c1[2];
  const m02 = c2[0], m12 = c2[1], m22 = c2[2];
  const tr = m00 + m11 + m22;
  let x: number, y: number, z: number, w: number;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    w = 0.25 / s;
    x = (m21 - m12) * s;
    y = (m02 - m20) * s;
    z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  const l = Math.hypot(x, y, z, w) || 1;
  return [x / l, y / l, z / l, w / l];
}

/** A simulation car as the renderer and the HUD see it. */
export function viewCar(c: SimCar, maxRpm: number, crashed: boolean, sound?: CarState['sound']): CarState {
  // Rows of the car-to-world matrix are the car's right, up and forward axes (sim world: z north).
  const m = rotZXY(-c.roll, -c.pitch, -c.yaw);
  const row = (i: number) => [m[3 * i] / 16384, m[3 * i + 1] / 16384, -m[3 * i + 2] / 16384];
  const right = row(0);
  const up = row(1);
  const fwd = row(2);
  // The model's local axes: +Z nose, +Y up, +X to the car's left.
  const quat = quatFromColumns([-right[0], -right[1], -right[2]], up, fwd);
  return {
    pos: [c.pos[0] * PHYS_M, c.pos[1] * PHYS_M, -c.pos[2] * PHYS_M],
    quat,
    speedMph: c.speed2 / 256,
    gear: c.gear,
    rpm: Math.max(0, Math.min(1, c.rpm / maxRpm)),
    airborne: c.surfAll === 0,
    crashed,
    steer: c.steering / 240,
    sound,
  };
}

const EVENT_TEXT: Record<string, (s?: number) => string> = {
  checkpoint: () => 'CHECKPOINT',
  penalty: (s) => `PENALTY +${s ?? 0} S`,
  jump: () => 'JUMP!',
  crash: () => 'CRASH!',
};

export interface SimSessionOptions {
  /** The opponent's driver for a rival id (default: a RouteDriver with the rival's profile in the rival's car). */
  opponentDriver?: (rivalId: string) => OpponentDriver;
  /** Pace of the built-in driver (autopilotInput), 0..1+ (default 0.8). */
  pace?: number;
}

export class SimRaceSession implements RaceSession {
  private setup!: RaceSetup;
  private race!: Race;
  private pilot!: Autopilot;
  private bytes: number[] = [];
  private snap!: RaceSnapshot;
  private done: RaceResult | null = null;

  constructor(private opts: SimSessionOptions = {}) {}

  start(setup: RaceSetup) {
    this.setup = setup;
    const opp = opponentInfo(setup.opponentId);
    const make = this.opts.opponentDriver ?? ((id: string) => new RouteDriver(opponentProfile(id), carParams(opponentInfo(id)!.carId)));
    this.race = new Race({
      track: setup.track,
      player: carParams(setup.carId),
      automatic: setup.gearbox !== 'manual',
      opponent: opp ? { driver: make(opp.id) } : null,
    });
    // The built-in driver keeps to the player's side of the grid while there is a rival.
    const pc = this.race.player.car;
    const side = this.race.opponent ? Math.sign(nearestOnPath(this.race.path, pc.pos[0] / 64, pc.pos[2] / 64, [0])?.lateral ?? -1) : 0;
    this.pilot = new Autopilot(this.race.path, this.race.player.params, { pace: this.opts.pace ?? 0.8, lane: side * RULES.gridSide * 0.5, sim: { surface: this.race.surface, rules: this.race.rules } });
    this.race.onAnyReset((r, s) => {
      if (r === this.race.player) this.pilot.resync(s);
    });
    this.bytes = [];
    this.done = null;
    this.passed = new Set();
    this.resets = 0;
    this.oppResets = 0;
    this.sounds = [new CarSoundTracker(), new CarSoundTracker()];
    this.snap = this.makeSnapshot(null);
  }
  private sounds = [new CarSoundTracker(), new CarSoundTracker()];

  /** The race underneath (tests, drive checks). */
  get sim(): Race {
    return this.race;
  }

  inputs() {
    return Uint8Array.from(this.bytes);
  }
  snapshot() {
    return this.snap;
  }
  result() {
    return this.done;
  }

  /** What the built-in driver would press now (the demo race and the test autopilot). */
  autopilotInput(): number {
    return this.pilot.input(this.race.player.car);
  }

  /** Race statistics for checks: where the player is, what it has driven through, crashes and resets. */
  stats() {
    const p = this.race.player;
    const sec = this.race.path.sections[Math.min(p.section, this.race.path.sections.length - 1)];
    const o = this.race.opponent;
    const osec = o ? this.race.path.sections[Math.min(o.section, this.race.path.sections.length - 1)] : null;
    const opponent = o
      ? { section: o.section, kind: osec?.kind ?? null, laps: this.race.driver?.laps ?? 0, crashes: o.crashes, resets: this.oppResets, penalty: o.penalty, crashed: o.crashed, finished: o.finished }
      : null;
    return { tick: this.race.tick, section: p.section, sections: this.race.path.sections.length, kind: sec?.kind ?? null, passed: [...this.passed], crashes: p.crashes, resets: this.resets, jumps: p.jumps, penalty: p.penalty, crashed: p.crashed, finished: p.finished, opponent };
  }
  private passed = new Set<string>();
  private resets = 0;
  private oppResets = 0;

  step(input: number): RaceSnapshot {
    if (this.done) return this.snap;
    this.bytes.push(input & 0xff);
    const before = this.race.player.section;
    this.race.step(input & 0xff);
    const after = this.race.player.section;
    for (let k = before; k < after && k < this.race.path.sections.length; k++) this.passed.add(this.race.path.sections[k].kind);
    if (this.race.player.events.some((e) => e.kind === 'reset')) this.resets++;
    if (this.race.opponent?.events.some((e) => e.kind === 'reset')) this.oppResets++;
    const ev = this.race.player.events.find((e) => EVENT_TEXT[e.kind]);
    this.snap = this.makeSnapshot(ev ? EVENT_TEXT[ev.kind](ev.seconds) : null);
    if (this.race.over) this.finish();
    return this.snap;
  }

  private progress(r: Racer): Progress {
    const len = this.race.path.length || 1;
    return { checkpoint: r.checkpoint, checkpoints: this.race.checkpoints, fraction: Math.min(1, r.reached / len) };
  }

  private makeSnapshot(event: string | null): RaceSnapshot {
    const r = this.race;
    const p = r.player;
    const o = r.opponent;
    return {
      tick: r.tick,
      time: (p.finishedTick ?? r.tick) / SIM_HZ,
      player: viewCar(p.car, p.params.maxRpm, p.crashed, this.sounds[0].measure(p.car, p.params)),
      opponent: o ? viewCar(o.car, o.params.maxRpm, o.crashed, this.sounds[1].measure(o.car, o.params)) : null,
      progress: this.progress(p),
      opponentProgress: o ? this.progress(o) : null,
      wrongWay: p.wrongWay,
      penaltySeconds: p.penalty,
      event,
      finished: p.finished,
      opponentFinished: !!o && o.finished,
    };
  }

  private finish() {
    const r = this.race;
    const p = r.player;
    const o = r.opponent;
    const finished = p.finished;
    const time = (p.finishedTick ?? r.tick) / SIM_HZ;
    const oppTotal = o && o.finished ? o.finishedTick! / SIM_HZ + o.penalty : null;
    this.done = {
      trackId: this.setup.trackId,
      carId: this.setup.carId,
      opponentId: this.setup.opponentId,
      timeSeconds: time,
      penaltySeconds: p.penalty,
      totalSeconds: time + p.penalty,
      topSpeedMph: p.topSpeed,
      jumps: p.jumps,
      distanceM: p.distance * UNIT_M,
      finished,
      crashed: !finished && p.crashed,
      opponentTotalSeconds: oppTotal,
      won: o ? finished && (oppTotal === null || time + p.penalty <= oppTotal) : null,
    };
  }
}

/** Make the flow race on the real simulation. */
export function registerSimSession(opts: SimSessionOptions = {}) {
  registerSession(() => new SimRaceSession(opts));
  registerReplayPlayer(() => new StubReplayPlayer(() => new SimRaceSession(opts)));
}

