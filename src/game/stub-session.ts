// Stand-ins for the SIM lane until it registers the real race (src/game/integrations.ts): a kinematic car that rolls
// along the road's centre line (src/game/centreline.ts), steering only shifts it across the road. Deterministic (no
// wall clock, no random), so a replay is still just its input bytes. Pace comes from the showroom stats (catalog.ts).
import { carInfo, opponentInfo } from './catalog';
import { centreLine, sampleAt, type CentreLine, type V3 } from './centreline';
import { SIM_DT, SIM_HZ, type CarState, type Progress, type RaceResult, type RaceSession, type RaceSetup, type RaceSnapshot, type ReplayData, type ReplayPlayer } from './types';
import { INPUT_ACCEL, INPUT_BRAKE, INPUT_LEFT, INPUT_RIGHT, INPUT_SHIFT_DOWN, INPUT_SHIFT_UP } from '../sim/input';
import { ROAD_M, type TrackFile } from '../track/types';
import { getTrack } from '../track/tracks';

const MPH = 0.44704;
/** Give up after ten minutes. */
const TIME_LIMIT_TICKS = 10 * 60 * SIM_HZ;
const WRONG_WAY_PENALTY_TICKS = 4 * SIM_HZ;
/** After the player finishes, how long the rival gets to finish too. */
const OPP_WAIT_TICKS = 30 * SIM_HZ;
/** Axle height above the road (the snapshot gives the axle centre). */
const AXLE_M = 0.36;

interface Car {
  s: number;
  maxS: number;
  v: number;
  lat: number;
  steer: number;
  gear: number;
  gears: number;
  maxV: number;
  accel: number;
  hop: number;
  hopV: number;
  airborne: boolean;
  nextJump: number;
  jumps: number;
  distance: number;
  top: number;
  checkpoint: number;
  finishedTick: number | null;
  prevBits: number;
  backwardsTicks: number;
}

function newCar(carId: string, lat: number): Car {
  const c = carInfo(carId);
  return {
    s: 0, maxS: 0, v: 0, lat, steer: 0, gear: 1, gears: c.gears,
    // The stub runs the cars a little slower than their brochure numbers, so the corners look sane.
    maxV: c.topSpeedMph * MPH * 0.62,
    accel: (60 * MPH) / c.zeroSixty,
    hop: 0, hopV: 0, airborne: false, nextJump: 0, jumps: 0, distance: 0, top: 0, checkpoint: 0, finishedTick: null, prevBits: 0, backwardsTicks: 0,
  };
}

/** Quaternion [x, y, z, w] for a nose (+Z) pointing along `dir` (yaw, then pitch). */
function quatFromDir(dir: V3, roll = 0): [number, number, number, number] {
  const yaw = Math.atan2(dir[0], dir[2]);
  const pitch = -Math.atan2(dir[1], Math.hypot(dir[0], dir[2]));
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
  const cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
  const cr = Math.cos(roll / 2), sr = Math.sin(roll / 2);
  // q = yaw(Y) * pitch(X) * roll(Z)
  const qx = cy * sp, qy = sy * cp, qz = -sy * sp, qw = cy * cp;
  // … then roll about the local Z: q * (0, 0, sr, cr).
  return [qx * cr + qy * sr, qy * cr - qx * sr, qw * sr + qz * cr, qw * cr - qz * sr];
}

export class StubRaceSession implements RaceSession {
  private setup!: RaceSetup;
  private line!: CentreLine;
  private player!: Car;
  private opp: Car | null = null;
  private oppSkill = 3;
  private tick = 0;
  private bytes: number[] = [];
  private checkpoints = 6;
  private penalty = 0;
  private wrongWay = false;
  private event: string | null = null;
  private done: RaceResult | null = null;
  private snap!: RaceSnapshot;

  start(setup: RaceSetup) {
    this.setup = setup;
    this.line = centreLine(setup.track);
    this.player = newCar(setup.carId, -ROAD_M * 0.22);
    const o = opponentInfo(setup.opponentId);
    this.opp = o ? newCar(o.carId, ROAD_M * 0.22) : null;
    this.oppSkill = o?.skill ?? 3;
    this.checkpoints = Math.max(3, Math.min(10, Math.round(this.line.pieces.length / 6)));
    this.tick = 0;
    this.bytes = [];
    this.penalty = 0;
    this.done = null;
    this.snap = this.makeSnapshot();
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

  step(input: number): RaceSnapshot {
    if (this.done) return this.snap;
    this.event = null;
    this.bytes.push(input & 0xff);
    this.tick++;
    const p = this.player;
    if (p.finishedTick === null) this.drive(p, input, this.setup.gearbox === 'manual');
    else this.drive(p, INPUT_BRAKE, false);
    if (this.opp) {
      const o = this.opp;
      this.drive(o, o.finishedTick === null ? this.aiBits(o) : INPUT_BRAKE, false);
    }
    // Checkpoints and the finish.
    const seg = this.line.length / this.checkpoints;
    for (const car of [p, this.opp]) {
      if (!car || car.finishedTick !== null) continue;
      const cp = Math.min(this.checkpoints, Math.floor(car.maxS / seg));
      if (cp > car.checkpoint) {
        car.checkpoint = cp;
        if (car === p && cp < this.checkpoints) this.event = 'CHECKPOINT';
      }
      if (car.checkpoint >= this.checkpoints) car.finishedTick = this.tick;
    }
    // Driving backwards: WRONG WAY, and a penalty if it goes on.
    p.backwardsTicks = p.v < -0.5 && p.finishedTick === null ? p.backwardsTicks + 1 : 0;
    this.wrongWay = p.backwardsTicks > SIM_HZ;
    if (p.backwardsTicks > 0 && p.backwardsTicks % WRONG_WAY_PENALTY_TICKS === 0) {
      this.penalty += 5;
      this.event = 'PENALTY +5 S';
    }
    const oppDone = !this.opp || this.opp.finishedTick !== null;
    if ((p.finishedTick !== null && (oppDone || this.tick - p.finishedTick > OPP_WAIT_TICKS)) || this.tick >= TIME_LIMIT_TICKS) this.finish();
    this.snap = this.makeSnapshot();
    return this.snap;
  }

  /** The stub opponent: full throttle, lifting before sharp corners (by skill). */
  private aiBits(o: Car): number {
    const here = sampleAt(this.line, o.s).dir;
    const ahead = sampleAt(this.line, o.s + 18 + o.v * 0.8).dir;
    const turn = 1 - (here[0] * ahead[0] + here[2] * ahead[2]);
    const target = o.maxV * (0.62 + 0.07 * this.oppSkill) * (turn > 0.3 ? 0.55 : turn > 0.1 ? 0.75 : 1);
    return o.v < target ? INPUT_ACCEL : o.v > target + 3 ? INPUT_BRAKE : 0;
  }

  private drive(c: Car, bits: number, manual: boolean) {
    const up = (bits & INPUT_SHIFT_UP) !== 0 && (c.prevBits & INPUT_SHIFT_UP) === 0;
    const down = (bits & INPUT_SHIFT_DOWN) !== 0 && (c.prevBits & INPUT_SHIFT_DOWN) === 0;
    c.prevBits = bits;
    const band = c.maxV / c.gears;
    if (manual) {
      if (up) c.gear = Math.min(c.gears, c.gear + 1);
      if (down) c.gear = Math.max(c.v < 0.5 ? -1 : 1, c.gear - 1);
      if (c.gear === 0) c.gear = up ? 1 : -1;
    }
    const shifting = manual && (up || down);
    const accel = (bits & INPUT_ACCEL) !== 0 && !shifting;
    const brake = (bits & INPUT_BRAKE) !== 0 && !shifting;
    const gearTop = manual ? (c.gear > 0 ? band * c.gear : 0) : c.maxV;
    if (accel && !c.airborne) {
      if (c.v < -0.2) c.v += 14 * SIM_DT;
      else if (c.gear > 0 || !manual) {
        // Low gears pull harder; a gear too high for the speed bogs down.
        const lugging = manual && c.v < band * (c.gear - 1.5) ? 0.35 : 1;
        if (c.v < gearTop) c.v += c.accel * Math.max(0.15, 1 - c.v / c.maxV) * 1.7 * lugging * SIM_DT;
      }
    } else if (brake && !c.airborne) {
      if (c.v > 0.3) c.v -= 16 * SIM_DT;
      else c.v = Math.max(-9, c.v - 5 * SIM_DT);
      if (manual && c.v < 0.3 && c.gear === -1) c.v = Math.max(-9, c.v - 2 * SIM_DT);
    } else {
      c.v *= c.airborne ? 0.999 : 0.985;
      if (Math.abs(c.v) < 0.05) c.v = 0;
    }
    if (manual && c.gear > 0 && c.v > gearTop) c.v -= 3 * SIM_DT;
    if (!manual) c.gear = c.v < -0.3 ? -1 : Math.max(1, Math.min(c.gears, Math.ceil(c.v / band)));
    // Steering moves the car across the road.
    const target = (bits & INPUT_RIGHT ? 1 : 0) - (bits & INPUT_LEFT ? 1 : 0);
    c.steer += (target - c.steer) * 0.35;
    const half = ROAD_M / 2 - 1.2;
    c.lat = Math.max(-half, Math.min(half, c.lat + c.steer * 7 * Math.min(1, Math.abs(c.v) / 6) * SIM_DT * Math.sign(c.v || 1)));
    // Along the line.
    const before = c.s;
    c.s += c.v * SIM_DT;
    if (!this.line.closed) c.s = Math.max(0, Math.min(this.line.length, c.s));
    c.maxS = Math.max(c.maxS, c.s);
    if (c.finishedTick === null) {
      c.distance += Math.abs(c.s - before);
      c.top = Math.max(c.top, Math.abs(c.v));
    }
    // Ramps throw the car up.
    while (c.nextJump < this.line.jumps.length && this.line.jumps[c.nextJump] < c.s) {
      if (c.v > 12) {
        c.hopV = Math.min(14, c.v * 0.35);
        c.airborne = true;
        c.jumps++;
        if (c === this.player) this.event = 'JUMP!';
      }
      c.nextJump++;
    }
    if (c.airborne) {
      c.hop += c.hopV * SIM_DT;
      c.hopV -= 9.81 * SIM_DT;
      if (c.hop <= 0) {
        c.hop = 0;
        c.airborne = false;
      }
    }
  }

  private carState(c: Car): CarState {
    const { pos, dir } = sampleAt(this.line, c.s);
    const right: V3 = [-dir[2], 0, dir[0]];
    const band = c.maxV / c.gears;
    const g = Math.max(1, c.gear);
    const rpm = Math.max(0.12, Math.min(1, (Math.abs(c.v) - band * (g - 1)) / band));
    const nose: V3 = c.airborne ? [dir[0], dir[1] + c.hopV * 0.02, dir[2]] : dir;
    return {
      pos: [pos[0] + right[0] * c.lat, pos[1] + c.hop + AXLE_M, pos[2] + right[2] * c.lat],
      quat: quatFromDir(nose, -c.steer * Math.min(1, Math.abs(c.v) / 30) * 0.06),
      speedMph: Math.abs(c.v) / MPH,
      gear: c.v < -0.3 ? -1 : c.gear,
      rpm,
      airborne: c.airborne,
      crashed: false,
      steer: c.steer,
    };
  }

  private progress(c: Car): Progress {
    return { checkpoint: c.checkpoint, checkpoints: this.checkpoints, fraction: Math.min(1, c.maxS / (this.line.length || 1)) };
  }

  private makeSnapshot(): RaceSnapshot {
    return {
      tick: this.tick,
      time: (this.player.finishedTick ?? this.tick) / SIM_HZ,
      player: this.carState(this.player),
      opponent: this.opp ? this.carState(this.opp) : null,
      progress: this.progress(this.player),
      opponentProgress: this.opp ? this.progress(this.opp) : null,
      wrongWay: this.wrongWay,
      penaltySeconds: this.penalty,
      event: this.event,
      finished: this.player.finishedTick !== null,
      opponentFinished: !!this.opp && this.opp.finishedTick !== null,
    };
  }

  private finish() {
    const p = this.player;
    const finished = p.finishedTick !== null;
    const time = (p.finishedTick ?? this.tick) / SIM_HZ;
    const o = this.opp;
    const oppTime = o && o.finishedTick !== null ? o.finishedTick / SIM_HZ : null;
    this.done = {
      trackId: this.setup.trackId,
      carId: this.setup.carId,
      opponentId: this.setup.opponentId,
      timeSeconds: time,
      penaltySeconds: this.penalty,
      totalSeconds: time + this.penalty,
      topSpeedMph: p.top / MPH,
      jumps: p.jumps,
      distanceM: p.distance,
      finished,
      crashed: false,
      opponentTotalSeconds: oppTime,
      won: o ? finished && (oppTime === null || time + this.penalty <= oppTime) : null,
    };
  }
}

/** Plays a replay by re-running the race once and keeping every step (seek = an index). */
export class StubReplayPlayer implements ReplayPlayer {
  private snaps: RaceSnapshot[] = [];
  private pos = 0;
  private res: RaceResult | null = null;
  playing = false;
  speed = 1;

  constructor(private makeSession: () => RaceSession) {}

  load(replay: ReplayData, track: TrackFile) {
    const s = this.makeSession();
    s.start({ trackId: replay.trackId, track, carId: replay.carId, paint: replay.paint, opponentId: replay.opponentId, gearbox: replay.gearbox });
    this.snaps = [s.snapshot()];
    for (const b of replay.inputs) this.snaps.push(s.step(b));
    this.res = s.result();
    this.pos = 0;
    this.speed = 1;
    this.playing = true;
  }
  get length() {
    return this.snaps.length - 1;
  }
  get tick() {
    return Math.floor(this.pos);
  }
  play() {
    if (this.pos >= this.length && this.speed > 0) this.pos = 0;
    this.playing = true;
  }
  pause() {
    this.playing = false;
  }
  seek(tick: number) {
    this.pos = Math.max(0, Math.min(this.length, tick));
  }
  update(dt: number) {
    if (!this.playing) return;
    this.pos += dt * SIM_HZ * this.speed;
    if (this.pos >= this.length || this.pos <= 0) {
      this.pos = Math.max(0, Math.min(this.length, this.pos));
      this.playing = false;
    }
  }
  frame() {
    const i = Math.floor(this.pos);
    const prev = this.snaps[Math.min(i, this.length)];
    const next = this.snaps[Math.min(i + 1, this.length)];
    return { prev, next, alpha: this.pos - i };
  }
  result() {
    return this.res;
  }
}

/** Load a replay's track from the bundled set (null when that track is gone). */
export function replayTrack(r: ReplayData): TrackFile | null {
  return getTrack(r.trackId)?.track ?? null;
}
