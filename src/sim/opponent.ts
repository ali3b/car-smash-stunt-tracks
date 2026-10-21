// The computer opponent: a car that drives itself along the track's route (research/SPEC.md "Opponent driving").
//
// Each 20 Hz step the driver looks at the next waypoint of its route (a point on the road with a left and a right
// lane point), moves its steering towards it, picks throttle / brake from the target speed of the piece it is on and
// from its grip, and then runs the same engine, grip and motion code as the player's car (in their computer-car
// variants: drive force scaled by skill, double brakes, no slide model). Exact integer behaviour, deterministic.
import type { CarParams, CarState, Vec3 } from './car';
import { createCarState } from './car';
import { INPUT_ACCEL, INPUT_BRAKE, updateSpeed } from './engine';
import { cos1024, fmul14, s16, sin1024, u16 } from './fixed';
import { updateGrip } from './grip';
import { crash, CRASH_FINISH, updateMotion, type MotionEnv } from './motion';
import type { TrackSurface } from './surface';
import { atan2i, hypot2, length3, rotZXY, vmul, type Vec3i } from './vec';

/** Number of target-speed slots: piece class (0 straight, 3 sharp corner, 6 wide corner, 9..14 stunts) + surface. */
export const SPEED_SLOTS = 15;

/** Speed slot bases per piece class; roads and corners add the surface (0 paved, 1 dirt, 2 ice). */
export const SpeedClass = {
  Straight: 0,
  SharpCorner: 3,
  WideCorner: 6,
  Ramp: 9,
  Slalom: 10,
  Helix: 11,
  Chicane: 12,
  Loop: 13,
  Pipe: 14,
} as const;

/** How one computer driver drives. Our own rivals live in opponents.ts. */
export interface OpponentProfile {
  id: string;
  /**
   * Target speed in mph per slot (SpeedClass base + surface), 15 entries, 0..255. The driver accelerates while its
   * wheel speed is more than `accelMargin` below the target and brakes when it is more than `brakeMargin` above.
   */
  speeds: number[];
  /** 0..200: the share of the engine's drive force the driver uses (200 = all of it). */
  skill: number;
  /** Distance (track units) at which a waypoint counts as reached. */
  reachRadius: number;
  /** Steering moves at most this much per frame towards the waypoint's direction. */
  steerRate: number;
  /** Largest steering angle the driver uses. */
  steerLimit: number;
  /** Speed below the target at which the driver accelerates (256 = 1 mph). */
  accelMargin: number;
  /** Speed above the target at which the driver brakes (256 = 1 mph). */
  brakeMargin: number;
  /** Brake whenever the turn asks for more grip than the tyres have. */
  brakeOnSlide: boolean;
  /** Pull out to the other lane to pass a car close ahead. */
  overtakes: boolean;
}

/** The constants the original's driver uses; profiles override what makes them different. */
export const BASE_PROFILE: Omit<OpponentProfile, 'id' | 'speeds' | 'skill'> = {
  reachRadius: 200,
  steerRate: 8,
  steerLimit: 0x41,
  accelMargin: 0x100,
  brakeMargin: 0x300,
  brakeOnSlide: true,
  overtakes: true,
};

/** A waypoint of the route (track units). `centre[1] === -1` means "on the ground": only x and z count. */
export interface RouteWaypoint {
  centre: Vec3i;
  /** The two lane points either side of the centre (the original's order: the first and second edge point). */
  left: Vec3i;
  right: Vec3i;
  /** Route-specific lane word (kept in the car record; 1 on divided highways). */
  lane: number;
  /** Speed slot of the piece (SpeedClass base + surface). */
  slot: number;
  /** This is the piece's last waypoint: the next one belongs to the next piece. */
  last: boolean;
  /**
   * Our routes only (the original has no such field): the least target speed the piece needs (a jump and its
   * run-up), whatever the profile says for its slot.
   */
  minMph?: number;
}

/** The road one lap long, in driving order, cut into pieces ("steps") of one or more waypoints. */
export interface OpponentRoute {
  /** Waypoint `k` (0-based) of step `step`. */
  waypoint(step: number, k: number): RouteWaypoint;
  /** Steps of one lap; step 0 is the start/finish piece. */
  readonly steps: number;
  /** The finish line: the car (track units) is past it when this is negative. */
  finishSide(x: number, z: number): number;
}

/** The driver's memory between frames (besides the car record, which keeps the waypoints and progress). */
export interface OpponentMemory {
  /** Target speed of the current piece, mph (0..255). */
  targetMph: number;
  /** 0 none, 1 / 2: passing a car close ahead on the first / second lane point's side. */
  overtaking: number;
  /** The input byte chosen in the last step (accelerate / brake bits). */
  lastInput: number;
}

export interface OpponentStepEnv {
  surface: TrackSurface;
  /** The player's car: the driver avoids it and can collide with it. */
  player?: { car: CarState; params: CarParams; onCrash?: (kind: number) => void };
  /** Original "input mode 2" (no race running): the driver cruises at 64 mph and ignores other cars. */
  cruise?: boolean;
  onCrash?: (kind: number) => void;
}

const shr6 = (v: number): number => s16(v >> 6);
const half = (a: number, b: number): number => s16(Math.trunc((s16(a) + s16(b)) / 2));

/** Target speed (mph) for a waypoint's piece. */
function targetOf(w: RouteWaypoint, profile: OpponentProfile): number {
  const mph = profile.speeds[w.slot] ?? 0;
  return w.minMph ? Math.min(255, Math.max(mph, w.minMph)) : mph;
}

/** Load waypoint k = fieldB4 of the current step into the car record; advances the step after its last waypoint. */
function loadWaypoint(c: CarState, m: OpponentMemory, route: OpponentRoute, profile: OpponentProfile): void {
  const k = c.fieldB4;
  c.fieldB4 = (c.fieldB4 + 1) & 0xff;
  const w = route.waypoint(c.pathIndex, k);
  m.targetMph = targetOf(w, profile);
  c.vecA = [w.centre[0], w.centre[1], w.centre[2]];
  c.vecB = [w.left[0], w.left[1], w.left[2]];
  c.vecC = [w.right[0], w.right[1], w.right[2]];
  c.w9c = w.lane;
  if (w.last) {
    c.pathIndex++;
    if (c.pathIndex >= route.steps) {
      c.fieldB3 = (c.fieldB3 + 1) & 0xff;
      c.pathIndex = 0;
    }
    c.fieldB4 = 0;
  }
}

/** Point half way between the centre and a lane point (y stays "ground" when the centre is on the ground). */
function laneTarget(centre: Vec3, lane: Vec3): Vec3i {
  return [half(centre[0], lane[0]), centre[1] === -1 ? -1 : half(centre[1], lane[1]), half(centre[2], lane[2])];
}

/**
 * Decide the steering and the pedal input for this frame (mutates steering, waypoint progress and, while the car
 * slides sideways, its speed). Returns the input byte (accelerate / brake bits) for the engine step.
 */
export function opponentDecide(
  c: CarState,
  m: OpponentMemory,
  route: OpponentRoute,
  profile: OpponentProfile,
  player: CarState | undefined,
  cruise = false,
): number {
  const me: Vec3i = [shr6(c.pos[0]), shr6(c.pos[1]), shr6(c.pos[2])];
  c.soundFlags = 1;
  m.overtaking = 0;

  if (c.crash !== 0) {
    if (c.speed2 === 0) c.soundFlags = 0;
  } else {
    // Close to the waypoint: take the next one.
    const a = c.vecA;
    const d =
      a[1] !== -1
        ? length3([s16(a[0] - me[0]), s16(a[1] - me[1]), s16(a[2] - me[2])])
        : hypot2(s16(a[0] - me[0]), s16(a[2] - me[2]));
    if (s16(d) < profile.reachRadius) loadWaypoint(c, m, route, profile);

    const toCar = rotZXY(c.roll, c.pitch, c.yaw, true);
    let target: Vec3i = [c.vecA[0], c.vecA[1], c.vecA[2]];
    if (!cruise && player && profile.overtakes) {
      const pl: Vec3i = [shr6(player.pos[0]), shr6(player.pos[1]), shr6(player.pos[2])];
      const r = vmul([s16(pl[0] - me[0]), s16(pl[1] - me[1]), s16(pl[2] - me[2])], toCar);
      const ax = s16(Math.abs(r[0]));
      if (r[1] <= 0x5a && ax <= 0xb4 && r[2] <= 0x258 && r[2] >= -0xb4) {
        // A car close ahead: aim half way to the lane point on the side away from it.
        const ya = c.vecA[1] === -1 ? 0 : s16(pl[1] - c.vecA[1]);
        const q = vmul([s16(pl[0] - c.vecA[0]), ya, s16(pl[2] - c.vecA[2])], toCar);
        if (q[0] < 0) {
          target = laneTarget(c.vecA, c.vecC);
          if (r[2] > -0x4e) m.overtaking = 2;
        } else {
          target = laneTarget(c.vecA, c.vecB);
          if (r[2] > -0x4e) m.overtaking = 1;
        }
      }
    }
    const t = vmul([s16(target[0] - me[0]), s16(target[1] - me[1]), s16(target[2] - me[2])], toCar);
    let angle = atan2i(t[0], t[2]);
    // The waypoint is behind us (we passed it): take the next one; still steer for this one this frame.
    if (!c.sliding && Math.abs(angle) > 0x100) loadWaypoint(c, m, route, profile);
    if (c.surfFront === 0) angle = 0;
    if (angle > profile.steerLimit) angle = profile.steerLimit;
    else if (angle < -profile.steerLimit) angle = -profile.steerLimit;
    const gap = angle < c.steering ? c.steering - angle : angle - c.steering;
    if (gap > profile.steerRate) c.steering = s16(c.steering + (angle < c.steering ? -profile.steerRate : profile.steerRate));
    else c.steering = angle;
  }

  // Pedals.
  let input = 0;
  if (c.surfRear !== 0) {
    if (c.crash !== 0) input = INPUT_BRAKE;
    else if (c.slideAngle !== 0) {
      // Knocked sideways: scrub speed until straight again.
      if (c.speed2 < 0x200) {
        c.speed2 = 0;
        c.slideAngle = 0;
      } else c.speed2 -= 0x200;
    } else if (profile.brakeOnSlide && c.demandedGrip > c.availableGrip) input = INPUT_BRAKE;
    else {
      const want = cruise ? 0x4000 : (m.targetMph & 0xff) << 8;
      if (u16(want - profile.accelMargin) > c.speed) input = INPUT_ACCEL;
      else if (u16(want + profile.brakeMargin) < c.speed) input = INPUT_BRAKE;
    }
  }
  m.lastInput = input;
  return input;
}

/**
 * One 20 Hz step of the computer car `c` (mutated in place): its decisions, then the engine, grip and motion of its
 * car. The player's car, if given, is avoided and collided with (and may be changed by an impact).
 */
export function stepOpponent(
  c: CarState,
  p: CarParams,
  m: OpponentMemory,
  route: OpponentRoute,
  profile: OpponentProfile,
  env: OpponentStepEnv,
): void {
  const input = opponentDecide(c, m, route, profile, env.player?.car, env.cruise);
  updateSpeed(c, p, input, { opponent: true, opponentSkill: profile.skill });
  updateGrip(c, p, () => false, { opponent: true });
  const menv: MotionEnv = { surface: env.surface, opponent: true, onCrash: env.onCrash, other: env.player };
  updateMotion(c, p, menv);

  if (c.crash === 0) {
    // Direction to the waypoint relative to the heading (kept in the car record).
    const me: Vec3i = [shr6(c.pos[0]), shr6(c.pos[1]), shr6(c.pos[2])];
    const t = vmul([s16(c.vecA[0] - me[0]), s16(c.vecA[1] - me[1]), s16(c.vecA[2] - me[2])], rotZXY(c.roll, c.pitch, c.yaw, true));
    c.pathByte = atan2i(s16(-t[0]), t[2]) & 0x3ff;
  }
  // After a full lap, crossing the finish line ends the opponent's race.
  if (c.fieldB3 !== 0 && route.finishSide(shr6(c.pos[0]), shr6(c.pos[2])) < 0) crash(c, CRASH_FINISH, menv);
}

/** A fresh driver memory. */
export function createOpponentMemory(): OpponentMemory {
  return { targetMph: 0, overtaking: 0, lastInput: 0 };
}

/** Put a computer car on the grid: at rest at `pos` (physics units) heading `yaw`, aiming at its first waypoint. */
export function createOpponent(
  p: CarParams,
  pos: Vec3,
  yaw: number,
  route: OpponentRoute,
  profile: OpponentProfile,
): { car: CarState; memory: OpponentMemory } {
  const car = createCarState(p, pos, yaw, true);
  const memory = createOpponentMemory();
  const k = car.fieldB4;
  car.fieldB4 = (k + 1) & 0xff;
  const w = route.waypoint(0, k);
  memory.targetMph = targetOf(w, profile);
  car.vecA = [...w.centre];
  car.vecB = [...w.left];
  car.vecC = [...w.right];
  car.w9c = w.lane;
  return { car, memory };
}

/**
 * Grid slots beside the start line, as offsets (track units, x and z) from the start tile's centre for a start line
 * whose driving direction is `angle` (1024 per turn, 0 = north): the player's slot and the opponent's.
 */
export function gridOffsets(angle: number): { player: [number, number]; opponent: [number, number] } {
  const at = (side: number): [number, number] => [
    s16(fmul14(sin1024(angle + 0x200), 0xd2) + fmul14(sin1024(angle + side), 0x24)),
    s16(fmul14(cos1024(angle + 0x200), 0xd2) + fmul14(cos1024(angle + side), 0x24)),
  ];
  return { player: at(0x100), opponent: at(0x300) };
}

// ---- The plug-in interface the race session uses ---------------------------------------------------------------

/** What a driver gets to place its car. */
export interface OpponentStart {
  /** Physics units. */
  pos: Vec3;
  /** 1024 per turn. */
  yaw: number;
}

/**
 * A computer driver: the one opponent interface of the race (src/sim/race.ts drives it). `init` puts the car on the
 * grid; `step` advances it one 20 Hz frame (the driver updates the car state directly, as the original does: it does
 * not produce an input byte for stepCar). The race steps in the original's order: the player's stepCar (with this
 * car as `other`), then the driver's `step` with the player's car.
 */
export interface OpponentDriver {
  readonly profile: OpponentProfile;
  readonly params: CarParams;
  /** The car's state (owned by the driver; read it to draw the car). `init` and `reset` replace the object. */
  readonly car: CarState;
  init(route: OpponentRoute, start: OpponentStart): void;
  /**
   * One frame, after the player's step. `player` is the player's car (an impact can change it too); `onCrash` is
   * told about the driver's own crash (1 hit, 2 water, 3 finished).
   */
  step(surface: TrackSurface, player?: { car: CarState; params: CarParams; onCrash?: (kind: number) => void }): void;
  /**
   * Our race rule, not the original's (its wrecked opponent stays where it is): put the car back on the road at rest
   * at `start`, keeping its laps, and carry on along the route from the nearest waypoint in front of it.
   */
  reset(start: OpponentStart): void;
  /** Laps completed (the route wrapped back to the start/finish piece). */
  readonly laps: number;
}

/** The standard driver: follows an OpponentRoute with an OpponentProfile. */
export class RouteDriver implements OpponentDriver {
  car: CarState;
  memory: OpponentMemory = createOpponentMemory();
  private route: OpponentRoute | null = null;
  onCrash?: (kind: number) => void;

  constructor(
    readonly profile: OpponentProfile,
    readonly params: CarParams,
  ) {
    this.car = createCarState(params, [0, 0, 0], 0, true);
  }

  init(route: OpponentRoute, start: OpponentStart): void {
    this.route = route;
    const o = createOpponent(this.params, start.pos, start.yaw, route, this.profile);
    this.car = o.car;
    this.memory = o.memory;
  }

  step(surface: TrackSurface, player?: { car: CarState; params: CarParams; onCrash?: (kind: number) => void }): void {
    if (!this.route) return;
    stepOpponent(this.car, this.params, this.memory, this.route, this.profile, { surface, player, onCrash: this.onCrash });
  }

  reset(start: OpponentStart): void {
    const route = this.route;
    const old = this.car;
    const car = createCarState(this.params, start.pos, start.yaw, true);
    this.car = car;
    this.memory = createOpponentMemory();
    if (!route) return;
    // The nearest waypoint in front of the car; of two roads in the same place (a crossing, a deck over a road),
    // the one nearer to where the driver was along its route.
    const x = start.pos[0] / 64;
    const z = start.pos[2] / 64;
    const a = (start.yaw * Math.PI) / 512;
    const fx = -Math.sin(a); // yaw 0 = north (+z), increasing towards the west
    const fz = Math.cos(a);
    const n = route.steps;
    let best = { cost: Infinity, u: old.pathIndex, k: 0 };
    for (let du = -Math.floor(n / 2); du < n - Math.floor(n / 2); du++) {
      const u = old.pathIndex + du;
      const s = ((u % n) + n) % n;
      for (let k = 0; k < 64; k++) {
        const w = route.waypoint(s, k);
        const dx = w.centre[0] - x;
        const dz = w.centre[2] - z;
        const cost = Math.hypot(dx, dz) + 40 * Math.abs(du);
        if (dx * fx + dz * fz > 60 && cost < best.cost) best = { cost, u, k };
        if (w.last) break;
      }
    }
    const wraps = Math.floor(best.u / n);
    car.fieldB3 = (old.fieldB3 + wraps) & 0xff;
    car.pathIndex = best.u - wraps * n;
    car.fieldB4 = best.k;
    loadWaypoint(car, this.memory, route, this.profile);
  }

  get laps(): number {
    return this.car.fieldB3;
  }
}
