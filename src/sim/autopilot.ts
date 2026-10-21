// A simple driver for the simulation: follows the circuit's centre line (src/sim/track-path.ts) and produces the
// same input bytes a player would. Used by the demo race, the test autopilot and the path-following opponent.
// Deterministic: floating maths on the car's state only (same inputs → same bytes on every machine that follows
// IEEE doubles).
//
// How it drives:
//   - speed: each section has a limit (corner radius and grip; minimums for stunts that need speed, ceilings for the
//     ones that punish it); the target is the lowest limit ahead that the brakes can still reach, and it never
//     brakes on a run-up to a jump or inside a stunt;
//   - steering: pure pursuit of a point ahead on the line, damped by the car's yaw rate; inside a loop it follows
//     the loop's drifting lane, inside a corkscrew roll it climbs round the tube on the roll's helical line.
import { cloneCarState, type CarParams, type CarState, type SimRules } from './car';
import { stepCar } from './step';
import type { TrackSurface } from './surface';
import { INPUT_ACCEL, INPUT_BRAKE, INPUT_LEFT, INPUT_RIGHT, INPUT_SHIFT_DOWN, INPUT_SHIFT_UP } from './engine';
import { nearestOnPath, pointAt, toLocal, type PathSection, type TrackPath } from './track-path';
import type { PieceKind } from '../track/types';

/** Metres per track unit. */
const UNIT_M = 0.06096;
const MPH = 0.44704;

/** Pieces the car drives through hands off unless a stunt controller steers (upside down the heading means nothing). */
const HANDS_OFF: ReadonlySet<PieceKind> = new Set(['loop', 'corkscrew-roll', 'pipe', 'pipe-obstacle']);
/** Pieces driven on the centre line whatever the lane (tubes, stunts, ramps). */
const CENTRE_ONLY: ReadonlySet<PieceKind> = new Set([
  'loop', 'corkscrew-roll', 'corkscrew-helix', 'pipe', 'pipe-entry', 'pipe-obstacle', 'ramp', 'ramp-solid', 'ramp-bridge', 'slalom', 'tunnel',
]);

/** The driver's lane is given up this far (track units) before a centre-only piece and taken again this far after. */
const LANE_CLEAR_BEFORE = 700;
const LANE_CLEAR_AFTER = 200;
/** Into a corkscrew roll on the right-hand side of the floor (it climbs the right wall first). */
const ROLL_LANE = 45;

/** Speeds (mph) per stunt: [minimum, maximum] on entry. */
const STUNT_SPEED: Partial<Record<PieceKind, [number, number]>> = {
  loop: [50, 72],
  'corkscrew-roll': [38, 46],
  'corkscrew-helix': [0, 42],
  pipe: [35, 60],
  'pipe-entry': [35, 60],
  'pipe-obstacle': [35, 50],
  slalom: [0, 40],
};

/** The minimum take-off speed (mph) to clear a jump of `gap` empty tiles from a ramp. */
export function jumpSpeed(gap: number): number {
  return gap <= 0 ? 0 : 108 + 60 * (gap - 1);
}

/** The tube of a pipe and of the corkscrew roll: centre height above the road and radius (track units). */
const TUBE_CENTRE = 117;
const TUBE_RADIUS = 100;
/** Pipe obstacles: pass this far round the tube (up the right wall), within this distance of the bump, easing over. */
const PIPE_WALL = Math.PI / 2.4;
const PIPE_CLEAR = 200;
const PIPE_RAMP = 520;
/**
 * Its helical line: face k of the tube is there from z = -1024k/11 to 1024 - 1024(k-1)/11, so the line through the
 * middle of every face's stretch turns 150° every 465 units, 180° (the roof) at the middle; a car that keeps to it
 * comes in on the right of the floor (30°) and leaves on the left (330°). Below the middle of the tube a wall runs
 * along the floor where no face is: keep right of it on the way in.
 */
const ROLL_RATE = (Math.PI * 5) / 6 / 465;
const ROLL_FROM = Math.PI / 6;
const ROLL_TO = (Math.PI * 11) / 6;
/** How far ahead of the middle of the windows the autopilot aims (the steering takes a while to wind on). */
const ROLL_LEAD = 120;

export interface AutopilotOptions {
  /** 0..1: how close to the limit it drives (corner speeds). */
  pace?: number;
  /** Lane offset from the centre line (track units, positive = right). */
  lane?: number;
  /**
   * The race's track surface and rules: with them the driver rehearses each jump on a copy of its car before the
   * run-up and picks a throttle pattern that lands it (the take-off depends on where the suspension's bounce is at
   * the lip). Without them it simply drives the run-up flat out.
   */
  sim?: { surface: TrackSurface; rules: SimRules };
}

/** A rehearsed jump: lap section of the take-off ramp, and the steps (counted from the plan) to lift off the throttle. */
interface JumpPlan {
  section: number;
  step: number;
  lift: Set<number>;
}

/** Throttle patterns tried on a jump's rehearsal, in order: [first step, steps] of lifting off. */
const LIFTS: [number, number][] = [[0, 0]];
for (const len of [1, 2, 3, 5, 8]) for (let at = 0; at <= 30; at += 2) LIFTS.push([at, len]);
/** A rehearsal starts this far (track units) before the take-off ramp and runs at most this many steps. */
const PLAN_AHEAD = 1100;
const PLAN_STEPS = 150;

export class Autopilot {
  /** Section the driver thinks it is on (searched near this first). */
  private section = 0;
  private pace: number;
  private lane: number;
  /** Speed limit (mph) per section on entry. */
  private limits: number[];
  /** Minimum speed (mph) per section on entry (stunts that need speed). */
  private minimums: number[];
  /** Yaw on the last step (for the yaw rate), null after a reset. */
  private lastYaw: number | null = null;
  /** Section index of the loop the car is in, -1 when not in one. */
  private inLoop = -1;
  /** How far round the loop the car is (0..1) as of the last step, -1 when not in one. */
  private loopFrac = -1;
  /** Lap distances of the pipe obstacles' bumps. */
  private pipeAvoid: number[];

  constructor(
    private path: TrackPath,
    private params: CarParams,
    opts: AutopilotOptions = {},
  ) {
    this.pace = opts.pace ?? 0.8;
    this.lane = opts.lane ?? 0;
    this.sim = opts.sim ?? null;
    this.minimums = path.sections.map((s) => Math.max(STUNT_SPEED[s.kind]?.[0] ?? 0, jumpSpeed(s.jumpGap)));
    this.limits = path.sections.map((s, i) => this.sectionLimit(s, this.minimums[i]));
    this.pipeAvoid = path.sections.filter((s) => s.kind === 'pipe-obstacle').map((s) => (s.start + s.end) / 2);
  }

  /** Lateral grip in g on tarmac, from the tuning (a rough fit of the grip model). */
  private get lateralG(): number {
    return (this.params.grip / 230) * 0.55 * (0.7 + 0.4 * this.pace);
  }

  /** The speed (mph) a section can be taken at. */
  private sectionLimit(s: PathSection, min: number): number {
    let r = Infinity;
    const pts = s.points;
    // Radius from the heading change over ~200 units.
    for (let i = 4; i < pts.length; i += 2) {
      const a = pts[i - 4];
      const b = pts[i - 2];
      const c = pts[i];
      const h1 = Math.atan2(b[0] - a[0], b[2] - a[2]);
      const h2 = Math.atan2(c[0] - b[0], c[2] - b[2]);
      let dh = Math.abs(h2 - h1);
      if (dh > Math.PI) dh = 2 * Math.PI - dh;
      const len = Math.hypot(c[0] - a[0], c[2] - a[2]);
      if (dh > 1e-3) r = Math.min(r, len / dh);
    }
    let mph = r === Infinity ? 250 : Math.sqrt(this.lateralG * 9.81 * r * UNIT_M) / MPH;
    if (s.kind === 'banked-corner') mph = Math.max(mph * 1.4, 60);
    // Loose surfaces hold less.
    const surf = this.path.track.pieces[s.piece].surface;
    if (surf === 'dirt') mph *= 0.85;
    else if (surf === 'ice') mph *= 0.6;
    const range = STUNT_SPEED[s.kind];
    if (range) mph = Math.min(mph, range[1]);
    return Math.min(Math.max(mph, min), 250);
  }

  /** Called after a reset (the car was put back on the road). */
  private sim: { surface: TrackSurface; rules: SimRules } | null;
  private plan: JumpPlan | null = null;
  /** Sections whose jump has been rehearsed since the last reset. */
  private planned = new Set<number>();

  resync(section: number) {
    this.plan = null;
    this.planned.clear();
    this.section = section;
    this.lastYaw = null;
    this.inLoop = -1;
    this.loopFrac = -1;
  }

  /** The input byte for this step. */
  input(c: CarState): number {
    let bits = this.drive(c);
    if (this.sim && c.crash === 0) {
      const j = this.jumpAhead();
      if (j >= 0 && !this.planned.has(j)) {
        this.planned.add(j);
        this.plan = this.rehearse(c, j);
      }
      const plan = this.plan;
      if (plan) {
        if (plan.lift.has(plan.step)) bits &= ~INPUT_ACCEL;
        if (++plan.step > PLAN_STEPS) this.plan = null;
      }
    }
    return bits;
  }

  /** The take-off section of a jump starting within PLAN_AHEAD of the car, or -1. */
  private jumpAhead(): number {
    const secs = this.path.sections;
    const n = secs.length;
    const here = secs[this.section];
    for (let k = 0; k <= 3; k++) {
      const j = this.section + k;
      if (j >= n && !this.path.closed) break;
      const s = secs[j % n];
      if (s.jumpGap === 0) continue;
      let d = s.start - (here.start + here.end) / 2;
      if (d < 0 && k > 0) d += this.path.length;
      return d < PLAN_AHEAD ? j % n : -1;
    }
    return -1;
  }

  /** Rehearse the jump at section j on copies of the car with each throttle pattern; the first that lands wins. */
  private rehearse(c: CarState, j: number): JumpPlan | null {
    const sim = this.sim!;
    for (const [at, len] of LIFTS) {
      const lift = new Set<number>();
      for (let k = 0; k < len; k++) lift.add(at + k);
      const ghost: Autopilot = Object.assign(Object.create(Autopilot.prototype), this, { sim: null, plan: null, planned: new Set() });
      const car = cloneCarState(c);
      let flown = false;
      let ok = false;
      for (let t = 0, onFor = 0; t < PLAN_STEPS; t++) {
        let bits = ghost.drive(car);
        if (lift.has(t)) bits &= ~INPUT_ACCEL;
        stepCar(car, this.params, sim.rules, bits & 0xff, sim.surface);
        if (car.crash !== 0) break;
        if (car.surfAll === 0) flown = true;
        onFor = car.surfAll !== 0 ? onFor + 1 : 0;
        // Down and rolling again after the flight.
        if (flown && onFor > 8 && ghost.section !== j) {
          ok = true;
          break;
        }
      }
      if (ok) return len ? { section: j, step: 0, lift } : null;
    }
    return null;
  }

  /** The input byte from the line, speeds and stunt controllers (no rehearsal). */
  private drive(c: CarState): number {
    if (c.crash !== 0) {
      this.lastYaw = null;
      return 0;
    }
    const path = this.path;
    if (!path.sections.length) return INPUT_ACCEL;
    const x = c.pos[0] / 64;
    const y = c.pos[1] / 64;
    const z = c.pos[2] / 64;
    const n = path.sections.length;
    const near: number[] = [];
    for (let k = -1; k <= 3; k++) near.push((((this.section + k) % n) + n) % n);
    const here = nearestOnPath(path, x, z, near, y) ?? nearestOnPath(path, x, z, undefined, y);
    if (!here) return INPUT_ACCEL;
    this.section = here.section;
    const sec = path.sections[here.section];
    const mph = c.speed2 / 256;
    let yawRate = 0;
    if (this.lastYaw !== null) {
      yawRate = (c.yaw - this.lastYaw) & 1023;
      if (yawRate > 512) yawRate -= 1024;
    }
    this.lastYaw = c.yaw;

    // Speed: the lowest limit ahead that the brakes can still reach.
    const decel = ((this.params.braking * 20) / 256) * MPH; // m/s²
    let target = this.limits[here.section];
    let runUp = false;
    for (let k = 1; k <= 8; k++) {
      const j = here.section + k;
      if (j >= n && !path.closed) break;
      const s2 = path.sections[j % n];
      let dist = (s2.start - here.s) * UNIT_M;
      if (dist < 0) dist += path.length * UNIT_M;
      if (dist > 1600 * UNIT_M * 8) break;
      // A jump ahead with nothing to brake for in between: a run-up, flat out.
      if (s2.jumpGap > 0 && target >= this.minimums[j % n]) runUp = true;
      const allowed = Math.sqrt((this.limits[j % n] * MPH) ** 2 + 2 * decel * 0.8 * Math.max(0, dist)) / MPH;
      if (allowed < target) {
        target = allowed;
        if (target < this.minimums[j % n]) runUp = false;
      }
    }
    // Stunts that need speed: never brake for them.
    // Up the loop on the throttle; off it over the top so the car does not come out too fast to hold the road.
    const climbing = sec.kind === 'loop' && this.loopFrac < 0.55;
    if (sec.kind === 'loop' && this.loopFrac >= 0.55) target = Math.min(target, this.limits[here.section]);
    const keepGoing = climbing || sec.kind === 'corkscrew-roll' || sec.jumpGap > 0 || c.surfAll === 0 || runUp;
    let bits = 0;
    if (keepGoing || mph < target) bits |= INPUT_ACCEL;
    else if (mph > target + 4) bits |= INPUT_BRAKE;

    // Steering.
    let want: number | null = null;
    if (sec.kind === 'loop') want = this.loopSteer(c, sec, x, y, z);
    else if (sec.kind === 'corkscrew-roll') want = this.rollSteer(c, sec, x, y, z);
    else if (sec.kind === 'pipe' || sec.kind === 'pipe-obstacle') want = this.pipeSteer(c, sec, x, y, z, here.s);
    const upright = Math.abs(c.pitch) < 48 && Math.abs(c.roll) < 48;
    if (want === null && c.surfAll !== 0 && (upright || !HANDS_OFF.has(sec.kind))) want = this.followSteer(c, here.s, x, z, mph, yawRate);
    if (want !== null) {
      const dead = mph > 60 ? 6 : 10;
      if (want > c.steering + dead) bits |= INPUT_RIGHT;
      else if (want < c.steering - dead) bits |= INPUT_LEFT;
    }

    // A manual gearbox: shift like the automatic would.
    if (!c.automatic && !c.shifting && c.surfRear !== 0) {
      if (c.rpm > this.params.upshiftRpm && c.gear < this.params.gears) bits |= INPUT_SHIFT_UP;
      else if (c.rpm < this.params.downshiftRpm && c.gear > 1) bits |= INPUT_SHIFT_DOWN;
    }
    return bits;
  }

  /**
   * The lane offset wanted at lap distance s: the driver's lane, but the centre line through tubes, stunts and ramps
   * (from well before them to just after), and the right-hand side of the floor into a corkscrew roll.
   */
  private laneAt(s: number): number {
    const at = pointAt(this.path, s);
    if (!at) return this.lane;
    const secs = this.path.sections;
    const n = secs.length;
    if (secs[at.section].kind === 'corkscrew-roll') return ROLL_LANE;
    for (let k = -1; k <= 3; k++) {
      const j = at.section + k;
      if (j < 0 || (j >= n && !this.path.closed)) continue;
      const sec = secs[j % n];
      if (!CENTRE_ONLY.has(sec.kind) && sec.jumpGap === 0) continue;
      // Distance from s to the section (negative inside it), wrapping round the lap.
      let ahead = sec.start - s;
      let behind = s - sec.end;
      if (this.path.closed && ahead < -this.path.length / 2) ahead += this.path.length;
      if (this.path.closed && behind < -this.path.length / 2) behind += this.path.length;
      if (ahead < LANE_CLEAR_BEFORE && behind < LANE_CLEAR_AFTER) return sec.kind === 'corkscrew-roll' ? ROLL_LANE : 0;
    }
    return this.lane;
  }

  /** Pure pursuit of a point ahead on the line, damped by the yaw rate: the steering position wanted. */
  private followSteer(c: CarState, s: number, x: number, z: number, mph: number, yawRate: number): number | null {
    const look = 100 + mph * 2;
    const t = pointAt(this.path, s + look);
    if (!t) return null;
    const lane = this.laneAt(s + look);
    const hr = (t.heading * Math.PI) / 512;
    const tx = t.pos[0] + Math.cos(hr) * lane; // right of heading h is (cos h, sin h)
    const tz = t.pos[2] + Math.sin(hr) * lane;
    const want = Math.atan2(-(tx - x), tz - z); // sim heading: 0 north, increasing west
    // Where the heading will be in a few steps at this yaw rate (the steering cannot change at once).
    const yaw = ((c.yaw + yawRate * 3) * Math.PI) / 512;
    let err = want - yaw;
    while (err > Math.PI) err -= 2 * Math.PI;
    while (err < -Math.PI) err += 2 * Math.PI;
    // Steering position the error asks for (the sim's steering runs -240..240, positive = right).
    return Math.max(-240, Math.min(240, -err * 360));
  }

  /** Inside a loop: its lane drifts 400 units to the right over the turn; steer to follow it. null = not in it. */
  private loopSteer(c: CarState, sec: PathSection, x: number, y: number, z: number): number | null {
    const piece = this.path.track.pieces[sec.piece];
    let [lx, lz] = toLocal(piece, x, z);
    if (!sec.forward) {
      lx = -lx;
      lz = -lz;
    }
    const h = y - sec.points[0][1];
    this.loopFrac = -1;
    if (this.inLoop !== sec.index) {
      if (h > 100 && lz > -60) this.inLoop = sec.index;
      else return null;
    }
    let theta = Math.atan2(lz, -(h - 487));
    if (theta < -0.4) theta += 2 * Math.PI;
    const frac = Math.max(0, Math.min(1, theta / (2 * Math.PI)));
    if (frac > 0.8 && h < 40) {
      this.inLoop = -1;
      return null;
    }
    this.loopFrac = frac;
    const want = -200 + 400 * frac;
    const err = want - lx;
    // Damp by the sideways drift of the last step (in the loop's frame).
    let [px] = toLocal(piece, c.prevPos[0] / 64, c.prevPos[2] / 64);
    if (!sec.forward) px = -px;
    const drift = lx - px;
    return Math.max(-160, Math.min(160, err * 1.2 - drift * 6));
  }

  /**
   * Inside a corkscrew roll: the tube's faces turn once round the road over the piece, so the car has to climb the
   * right wall, cross the roof and come down the left wall in step with them, on the roll's helical line.
   */
  private rollSteer(c: CarState, sec: PathSection, x: number, y: number, z: number): number | null {
    const goal = (q: number) => Math.max(ROLL_FROM, Math.min(ROLL_TO, Math.PI + (q + ROLL_LEAD) * ROLL_RATE));
    return this.tubeSteer(c, sec, x, y, z, goal);
  }

  /**
   * Inside a pipe: the coral heads (bumps across the middle of the floor, with sheer faces) are passed high on the
   * right-hand wall; elsewhere the car keeps to the floor.
   */
  private pipeSteer(c: CarState, sec: PathSection, x: number, y: number, z: number, s: number): number | null {
    const { pipeAvoid } = this;
    const goal = (q: number) => {
      let a = 0;
      for (const o of pipeAvoid) {
        const d = Math.abs(q - o);
        a = Math.max(a, d < PIPE_CLEAR ? 1 : d < PIPE_CLEAR + PIPE_RAMP ? 1 - (d - PIPE_CLEAR) / PIPE_RAMP : 0);
      }
      return a * PIPE_WALL;
    };
    return this.tubeSteer(c, sec, x, y, z, (lz, here) => goal(s + lz - here));
  }

  /**
   * Steering in a tube (the pipe's section: floor at 0, roof at 235): `goal(lz)` is the angle round the tube wanted
   * at distance lz along the piece from its middle (`here`: the car's lz) (seen along the driving direction, 0 = the floor, clockwise); steering right
   * climbs the right wall. Steers so the sideways speed round the tube matches the goal's, plus a pull onto it.
   */
  private tubeSteer(c: CarState, sec: PathSection, x: number, y: number, z: number, goal: (lz: number, here: number) => number): number | null {
    const piece = this.path.track.pieces[sec.piece];
    const local = (px: number, pz: number): [number, number] => {
      const [a, b] = toLocal(piece, px, pz);
      return sec.forward ? [a, b] : [-a, -b];
    };
    const [lx, lz] = local(x, z);
    const [px, pz] = local(c.prevPos[0] / 64, c.prevPos[2] / 64);
    const base = sec.points[0][1];
    const at = (q: number) => goal(q, lz);
    const phiT = at(lz);
    const angle = (ax: number, ah: number) => {
      let a = Math.atan2(ax, -(ah - TUBE_CENTRE));
      while (a < phiT - Math.PI) a += 2 * Math.PI;
      while (a > phiT + Math.PI) a -= 2 * Math.PI;
      return a;
    };
    const phi = angle(lx, y - base);
    const prevPhi = angle(px, c.prevPos[1] / 64 - base);
    const fwd = lz - pz;
    if (fwd <= 0) return null;
    const side = (phi - prevPhi) * TUBE_RADIUS;
    const slope = ((at(lz + 40) - at(lz - 40)) / 80) * TUBE_RADIUS;
    const wantSide = fwd * slope + (phiT - phi) * TUBE_RADIUS * 0.2;
    const err = Math.atan2(wantSide, fwd) - Math.atan2(side, fwd);
    return Math.max(-240, Math.min(240, err * 300));
  }
}
