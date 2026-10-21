// The car's motion for one 20 Hz step: wheels move along the ground planes, fall when in the air, bounce off walls,
// spring on their suspension; the body is then rebuilt from the four wheels (research/SPEC.md "Car physics" §5-7).
import type { CarParams, CarState, Vec3 } from './car';
import { cos1024, fmul14, s16, sdivPow2, sin1024 } from './fixed';
import { SurfaceCode, type SurfacePlane, type SurfaceProbe, type TrackSurface } from './surface';
import { atan2i, crossZ, hypot2, length3, planeDistance, rotY, rotZXY, transpose, vmul, type Mat3i, type Vec3i } from './vec';

/** Per-frame fall speed added to an airborne wheel (front wheels fall faster than rear ones). */
const FALL = [21, 21, 15, 15];

/** Crash kinds reported by the motion step. */
export const CRASH_HIT = 1;
export const CRASH_WATER = 2;
export const CRASH_FINISH = 3;
/** A hit that also stops the car dead (roof through a surface, wheel jammed under a deck). */
export const CRASH_HIT_STOP = 5;

export interface MotionEnv {
  surface: TrackSurface;
  /** Computer-driven car (does not count jumps). */
  opponent?: boolean;
  /** Called on the first crash (kind 1, 2, 5); the car's crash state is already set. */
  onCrash?: (kind: number) => void;
  /** Called when the car leaves the ground with all four wheels. */
  onJump?: () => void;
  /** The other car on the track (the opponent, or the player for an opponent): the two can collide. */
  other?: { car: CarState; params: CarParams; onCrash?: (kind: number) => void };
}

/** Where a car is for the collision test: track units and its angles. */
interface Placed {
  pos: Vec3i;
  roll: number;
  pitch: number;
  yaw: number;
}

const CORNER_X = [-1, 1, 1, -1];
const CORNER_Z = [1, 1, -1, -1];

/** Does a bottom corner of box `a` lie inside box `b`? (Boxes: half width, height, half length, radius.) */
function cornerInside(ba: CarParams['box'], a: Placed, bb: CarParams['box'], b: Placed): boolean {
  const ma = rotZXY(s16(-a.roll), s16(-a.pitch), s16(-a.yaw));
  const mb = rotZXY(b.roll, b.pitch, b.yaw, true);
  for (let k = 0; k < 4; k++) {
    const v = vmul([s16(CORNER_X[k] * ba[0]), 0, s16(CORNER_Z[k] * ba[2])], ma);
    const corner: Vec3i = [s16(v[0] + a.pos[0]), s16(v[1] + a.pos[1]), s16(v[2] + a.pos[2])];
    const l = vmul([s16(b.pos[0] - corner[0]), s16(b.pos[1] - corner[1]), s16(b.pos[2] - corner[2])], mb);
    if (l[1] >= 0 && bb[1] >= l[1] && l[0] >= -bb[0] && l[0] <= bb[0] && -bb[2] <= l[2] && bb[2] >= l[2]) return true;
  }
  return false;
}

/** Collision test of two boxes: bounding spheres first, then the corners of each in the other. */
export function boxesTouch(ba: CarParams['box'], a: Placed, bb: CarParams['box'], b: Placed): boolean {
  const r = s16(ba[3] + bb[3]);
  for (const k of [0, 2, 1]) if (s16(Math.max(a.pos[k], b.pos[k]) - Math.min(a.pos[k], b.pos[k])) > r) return false;
  const d: Vec3i = [s16(a.pos[0] - b.pos[0]), s16(a.pos[1] - b.pos[1]), s16(a.pos[2] - b.pos[2])];
  if (length3(d) > (r & 0xffff)) return false;
  return cornerInside(ba, a, bb, b) || cornerInside(bb, b, ba, a);
}

/** Car-car impact: both cars spin off by their heading difference, `c` loses speed; true for a hard hit. */
function carImpact(c: CarState, o: CarState): boolean {
  c.fieldAE = 1;
  o.fieldAE = 1;
  const v1 = c.speed2 >> 8;
  const v2 = o.speed2 >> 8;
  const dx = s16(fmul14(v2, sin1024(o.yaw)) - fmul14(v1, sin1024(c.yaw)));
  const dz = s16(fmul14(v2, cos1024(o.yaw)) - fmul14(v1, cos1024(c.yaw)));
  let rel = s16(hypot2(dx, dz));
  if (rel < 10) rel = 10;
  c.speed2 = (c.speed2 - sdivPow2(s16(0x300 * rel), 2)) & 0xffff;
  const wrap = (a: number) => {
    let x = s16(a);
    if (x >= 0x200) x = s16(x - 0x400);
    if (x <= -0x200) x = s16(x + 0x400);
    return x;
  };
  c.slideAngle = wrap(o.yaw - c.yaw);
  o.slideAngle = wrap(c.yaw - o.yaw);
  c.speed = c.speed2;
  o.speed = o.speed2;
  return rel > 30;
}

/** Mark the car crashed (first crash only). Kinds 2 and 5 also stop the car. */
export function crash(c: CarState, kind: number, env: MotionEnv): void {
  if (c.crash !== 0) return;
  let stop = false;
  if (kind === CRASH_HIT_STOP) {
    kind = CRASH_HIT;
    stop = true;
  }
  if (kind === CRASH_HIT) c.crash = 1;
  else if (kind === CRASH_WATER) {
    c.crash = 2;
    stop = true;
  } else if (kind === CRASH_FINISH) c.crash = 3;
  if (stop) {
    c.speed2 = 0;
    c.speed = 0;
  }
  env.onCrash?.(kind);
}

const shr6 = (v: number) => s16(v >> 6);
const toShape = (p: Vec3): Vec3i => [shr6(p[0]), shr6(p[1]), shr6(p[2])];

/** Height of p above the plane. */
function heightAbove(pl: SurfacePlane, p: Vec3i): number {
  if (pl.flat) return s16(p[1] - pl.origin[1]);
  return planeDistance(p, pl.origin, pl.normal);
}

interface Frame {
  roll: number;
  pitch: number;
  yaw: number;
  /** Car body to world (row vectors). */
  m: Mat3i;
}

/**
 * Displacement for moving `v` (car frame, z forward) turned by `angle`: on the car's own axes when `plane` is null,
 * else along the plane (the car's heading carried onto the plane).
 */
function moveAlong(f: Frame, plane: SurfacePlane | null, angle: number, v: Vec3i): Vec3i {
  if (!plane) {
    if (angle !== 0) return vmul(vmul(v, rotY(s16(-angle))), f.m);
    return vmul(v, f.m);
  }
  let h: number;
  if (plane.pitch === f.pitch && plane.roll === f.roll) h = f.yaw;
  else {
    const u = vmul(vmul(v, f.m), transpose(plane.matrix));
    h = atan2i(s16(-u[0]), u[2]);
  }
  h = s16(h + angle);
  if (h !== 0) return vmul(vmul(v, rotY(s16(-h))), plane.matrix);
  return vmul(v, plane.matrix);
}

const add3 = (p: Vec3, d: Vec3i): void => {
  p[0] = (p[0] + d[0]) | 0;
  p[1] = (p[1] + d[1]) | 0;
  p[2] = (p[2] + d[2]) | 0;
};

/** Suspension of wheel i for a measured height h above the ground; returns the wheel's new offset. */
function suspension(c: CarState, h: number, i: number): number {
  const old = c.wheelB[i];
  let delta = 0;
  // the extra rebound target relaxes towards 0 by 4 per frame
  const e = c.wheelE[i];
  if (e < 0) c.wheelE[i] = Math.min(0, e + 4);
  else if (e > 0) c.wheelE[i] = Math.max(0, e - 4);
  if (h < 0 && c.wheelB[i] > -h) h = 0;
  if (h === 0) {
    const target = c.wheelE[i];
    if (c.wheelB[i] > target) {
      c.wheelB[i] = s16(c.wheelB[i] - 0x80);
      if (c.wheelB[i] < target) c.wheelB[i] = target;
      delta = s16(old - c.wheelB[i]);
    } else if (c.wheelB[i] < target) {
      c.wheelB[i] = s16(c.wheelB[i] + 0x80);
      if (c.wheelB[i] > target) c.wheelB[i] = target;
    }
  } else if (h > 0) {
    c.wheelB[i] = s16(c.wheelB[i] + (h > 0xc0 ? 0xc0 : h));
    if (c.wheelB[i] > 0x180) c.wheelB[i] = 0x180;
    c.wheelD[i] = 0;
  } else {
    if (s16(h + c.wheelB[i]) > -0x120) c.wheelB[i] = s16(c.wheelB[i] + h);
    else {
      c.wheelB[i] = s16(c.wheelB[i] + sdivPow2(s16(h * 3), 2));
      if (c.wheelB[i] < -0x180) c.wheelB[i] = -0x180;
    }
    delta = s16(old - c.wheelB[i] + h);
  }
  return s16(old + delta);
}

/** One motion step of car `c`. Mutates `c`. */
export function updateMotion(c: CarState, p: CarParams, env: MotionEnv): void {
  const newPos: Vec3 = [c.pos[0], c.pos[1], c.pos[2]];
  c.prevPos = [c.pos[0], c.pos[1], c.pos[2]];
  const f: Frame = { roll: c.roll, pitch: c.pitch, yaw: c.yaw, m: rotZXY(s16(-c.roll), s16(-c.pitch), s16(-c.yaw)) };
  const turnStep = c.surfAll !== 0 ? sdivPow2(c.turn, 2) : 0;
  const dist = Math.floor((c.speed2 * 0x580) / 0x3c00);

  // Slope: gravity along the car's forward axis feeds the engine step of the next frame.
  if (c.pitch !== 0 || c.roll !== 0) c.slopeForce = s16(-vmul([0, 0, 0x82], f.m)[1]);
  else c.slopeForce = 0;

  const spinM = c.spin & 0x3ff ? rotZXY(0, 0, s16(-c.spin)) : null;

  // Upside down on the ground: wheels reach out further (fast) or the body sits on its roof (slow).
  let flip = 0;
  let flipVec: Vec3i = [0, 0, 0];
  if (c.surfAll !== 0 && vmul([0, 30000, 0], f.m)[1] < 0) {
    if (c.speed2 > 0x1e00) {
      flip = 0xc0;
      flipVec = vmul([0, -0xc0, 0], f.m);
    } else flip = -0xc0;
  }

  // Place the wheels and move them forward; front wheels are turned by the steering.
  const pos: Vec3[] = [];
  const prev: Vec3[] = [];
  const ang: number[] = [c.slideAngle, c.slideAngle, c.slideAngle, c.slideAngle];
  for (let i = 0; i < 4; i++) {
    let w: Vec3i = [p.wheels[i][0], s16(-(c.wheelB[i] + 0x180)), p.wheels[i][2]];
    if (flip < 0) w[1] = s16(w[1] - flip);
    if (spinM) w = vmul(w, spinM);
    w = vmul(w, f.m);
    const q: Vec3 = [(newPos[0] + w[0]) | 0, (newPos[1] + w[1]) | 0, (newPos[2] + w[2]) | 0];
    prev.push([q[0], q[1], q[2]]);
    if (dist !== 0) {
      ang[i] = turnStep !== 0 && i < 2 ? s16(c.slideAngle - turnStep) : c.slideAngle;
      add3(q, moveAlong(f, null, ang[i], [0, 0, dist]));
    }
    pos.push(q);
  }

  const heights = c.wheelHeight;
  let attempt = 0;
  for (;;) {
    attempt++;
    if (attempt === 5) {
      c.slideAngle = 0x200;
      crash(c, CRASH_HIT, env);
      break;
    }
    let restart = false;
    for (let i = 0; i < 4 && !restart; i++) {
      const P = toShape(pos[i]);
      const pr: SurfaceProbe = env.surface.probe(P[0], P[1], P[2], c.wheelWorld[i]);
      c.wheelSurface[i] = pr.surface;
      let plane = pr.plane;
      let elevated = pr.elevated;
      let h = heightAbove(plane, P);
      const wall = pr.wall;
      if (wall && h > wall.bottom && h < wall.top) {
        if (hitWall(c, f, wall, P, i, pos, prev, dist, env)) {
          restart = true;
          break;
        }
      }
      // fall-through: no wall contact
      let jammed = false;
      for (;;) {
        if (h > 0) {
          if (flip > 0 && h < 0x18) add3(pos[i], flipVec);
          else {
            // in the air: fall
            c.wheelA[i] = s16(c.wheelA[i] + FALL[i]);
            pos[i][1] = (pos[i][1] - c.wheelA[i]) | 0;
            P[1] = shr6(pos[i][1]);
            h = heightAbove(plane, P);
            // clearly off the ground after falling: no surface under this wheel
            if (h > 12) c.wheelSurface[i] = SurfaceCode.None;
          }
        }
        heights[i] = h;
        if (h > 0) break; // still airborne: next wheel
        if (h < 0) {
          // below the plane: put the wheel back on it
          const T = transpose(plane.matrix);
          const o = plane.origin;
          const rel = (q: Vec3): Vec3i => {
            const s = toShape(q);
            return [s16(s[0] - o[0]), s16(s[1] - o[1]), s16(s[2] - o[2])];
          };
          const pl = vmul(rel(prev[i]), T);
          const cl = vmul(rel(pos[i]), T);
          if (elevated && pl[1] < -12 && cl[1] < -12) {
            if (cl[1] > -24) {
              crash(c, CRASH_HIT_STOP, env);
              jammed = true;
            } else {
              // under a deck: the ground of this tile is what counts
              plane = { id: 0, flat: true, roll: 0, pitch: 0, origin: [0, pr.tileY, 0], normal: [0, 0x2000, 0], matrix: [0x4000, 0, 0, 0, 0x4000, 0, 0, 0, 0x4000] };
              elevated = false;
              const Q = toShape(pos[i]);
              P[0] = Q[0];
              P[1] = Q[1];
              P[2] = Q[2];
              h = heightAbove(plane, P);
              continue;
            }
          }
          if (cl[1] === 0) {
            const d = moveAlong(f, plane, ang[i], [0, 0, 0x40]);
            pos[i][0] = (pos[i][0] - d[0]) | 0;
            pos[i][1] = (pos[i][1] - d[1]) | 0;
            pos[i][2] = (pos[i][2] - d[2]) | 0;
          } else {
            if (pl[1] > 0 && cl[1] < 0) {
              // crossed the plane during the step: the rest of the travel goes along it
              const a: Vec3i = [cl[0], cl[2], s16(-cl[1])];
              const b: Vec3i = [pl[0], pl[2], s16(-pl[1])];
              const x = crossZ(a, b, 0);
              const len = length3([s16((a[0] - x[0]) << 6), s16((a[1] - x[1]) << 6), s16((a[2] - x[2]) << 6)]);
              const total = s16(c.wheelA[i] + dist);
              const rest = s16(total - len);
              const out = moveAlong(f, plane, ang[i], [0, 0, len]);
              for (let k = 0; k < 3; k++) {
                const dk = total === 0 ? 0 : s16(Math.trunc(Math.imul((pos[i][k] - prev[i][k]) | 0, rest) / total));
                pos[i][k] = (prev[i][k] + dk + out[k]) | 0;
              }
            } else {
              const out = moveAlong(f, plane, ang[i], [0, 0, dist]);
              for (let k = 0; k < 3; k++) pos[i][k] = (prev[i][k] + out[k]) | 0;
            }
            let h2 = heightAbove(plane, toShape(pos[i]));
            if (h2 < 0) {
              if (jammed) h2 = s16(-h2 + 6);
              add3(pos[i], vmul([0, s16(-h2 << 6), 0], plane.matrix));
            }
          }
        }
        // on the ground (landed this step or rolling)
        if (c.wheelA[i] > 0xbe) c.soundFlags |= 0x20;
        if (c.wheelA[i] > 0x3a3) crash(c, CRASH_HIT, env);
        c.wheelA[i] = 0;
        break;
      }
    }
    if (!restart) break;
  }

  if (c.wheelSurface.every((s) => s === SurfaceCode.Water)) crash(c, CRASH_WATER, env);

  // Suspension, then the body sits at the middle of the four wheels.
  for (let i = 0; i < 4; i++) {
    c.wheelWorld[i] = toShape(pos[i]);
    const s = suspension(c, heights[i], i);
    add3(pos[i], vmul([0, s16(s + 0x180), 0], f.m));
  }
  for (let k = 0; k < 3; k++) newPos[k] = ((pos[0][k] + pos[1][k] + pos[2][k] + pos[3][k]) | 0) >> 2;
  const rel: Vec3i[] = pos.map((q) => [s16(q[0] - newPos[0]), s16(q[1] - newPos[1]), s16(q[2] - newPos[2])]);
  if (newPos[1] < 0) newPos[1] = 0;
  for (const k of [0, 2]) {
    if (newPos[k] > 0x1df100) newPos[k] = 0x1df0ff;
    else if (newPos[k] < 0xf00) newPos[k] = 0xf00;
  }

  // Heading from rear-to-front, then pitch and roll in the car's own frame.
  const sum = (k: number, a: number, b: number, c0: number, d: number) => s16(rel[a][k] + rel[b][k] - rel[c0][k] - rel[d][k]);
  const yaw = atan2i(sum(0, 3, 2, 0, 1), s16(-sum(2, 3, 2, 0, 1))) & 0x3ff;
  const ry = rotZXY(0, 0, yaw);
  for (let i = 0; i < 4; i++) rel[i] = vmul(rel[i], ry);
  let pitch = 0;
  {
    const pz = sum(2, 3, 2, 0, 1);
    const py = sum(1, 3, 2, 0, 1);
    if (!(py === 0 && pz < 0)) {
      pitch = s16(atan2i(s16(-pz), py) - 0x100);
      if (Math.abs(pitch) < 2) pitch = 0;
    }
  }
  if (pitch !== 0) {
    const rx = rotZXY(0, pitch, 0);
    for (let i = 0; i < 4; i++) rel[i] = vmul(rel[i], rx);
  }
  let roll = 0;
  {
    const rx = sum(0, 1, 2, 0, 3);
    const rY = sum(1, 1, 2, 0, 3);
    if (!(rY === 0 && rx > 0)) {
      roll = s16(atan2i(rx, rY) - 0x100);
      if (Math.abs(roll) < 2) roll = 0;
    }
  }
  c.surfFront = (c.wheelSurface[0] + c.wheelSurface[1]) & 0xff;
  c.surfRear = (c.wheelSurface[2] + c.wheelSurface[3]) & 0xff;

  // Roof check: a wheel's roof point and the wheel itself on opposite sides of a surface means the car went through.
  const m2 = rotZXY(s16(-roll), s16(-pitch), s16(-yaw));
  for (let i = 0; i < 4; i++) {
    const v = vmul([p.wheels[i][0], s16(p.box[1] << 6), p.wheels[i][2]], m2);
    const Q: Vec3i = [shr6((newPos[0] + v[0]) | 0), shr6((newPos[1] + v[1]) | 0), shr6((newPos[2] + v[2]) | 0)];
    const pr = env.surface.probe(Q[0], Q[1], Q[2], Q);
    const h1 = heightAbove(pr.plane, Q);
    const h2 = heightAbove(pr.plane, toShape(pos[i]));
    if ((h1 < -6 && h2 > 6) || (h1 > 6 && h2 < -6)) crash(c, CRASH_HIT_STOP, env);
  }

  const all = (c.surfFront + c.surfRear) & 0xff;
  if (!env.opponent && all === 0 && c.surfAll !== 0) env.onJump?.();
  c.surfAll = all;

  // Touching the other car: the step does not move the car (the cars do not pass through each other).
  if (env.other) {
    const o = env.other.car;
    const me: Placed = { pos: toShape(newPos), roll, pitch, yaw };
    const it: Placed = { pos: toShape(o.pos), roll: o.roll, pitch: o.pitch, yaw: o.yaw };
    if (boxesTouch(p.box, me, env.other.params.box, it)) {
      if (c.fieldAE === 0 && carImpact(c, o)) {
        crash(c, CRASH_HIT, env);
        crash(o, CRASH_HIT, { surface: env.surface, onCrash: env.other.onCrash });
      }
      return;
    }
  }

  c.pos = newPos;
  c.roll = roll;
  c.pitch = pitch;
  c.yaw = yaw;
  c.fieldAE = 0;
}

/** Wall contact of wheel i: push all wheels back along the wall; returns true (the wheels are re-probed). */
function hitWall(
  c: CarState,
  f: Frame,
  wall: NonNullable<SurfaceProbe['wall']>,
  P: Vec3i,
  _i: number,
  pos: Vec3[],
  prev: Vec3[],
  dist: number,
  env: MotionEnv,
): boolean {
  const i = _i;
  const R = rotY(s16(-wall.angle - 0x100));
  let a = vmul([s16(c.wheelWorld[i][0] - wall.x), 0, s16(c.wheelWorld[i][2] - wall.z)], R);
  let b = vmul([s16(P[0] - wall.x), 0, s16(P[2] - wall.z)], R);
  if ((b[2] > 0 && a[2] > 0) || (b[2] < 0 && a[2] < 0)) return false;
  let swapped = false;
  if (b[2] > a[2]) {
    const t = a;
    a = b;
    b = t;
    swapped = true;
  }
  let before: number; // travel left after the wall
  let at: number; // travel up to the wall
  if (b[2] === 0) {
    before = dist;
    at = 0;
  } else if (a[2] === 0) {
    before = 0;
    at = dist;
  } else {
    const x = crossZ(b, a, 0);
    at = length3([s16((b[0] - x[0]) << 6), s16((b[1] - x[1]) << 6), s16((b[2] - x[2]) << 6)]);
    before = s16(dist - at);
  }
  const rel = (-f.yaw - wall.angle) & 0x3ff;
  let along: number;
  let push: number;
  if (rel < 0x100 || rel > 0x300) {
    along = wall.angle;
    push = 0x300;
  } else {
    along = (wall.angle + 0x200) & 0x3ff;
    push = -0x300;
  }
  if (swapped) push = -push;
  const r = vmul([push, 0, at], rotZXY(s16(-f.roll), s16(-f.pitch), along));
  let si = (-f.yaw - along) & 0x3ff;
  let neg = false;
  if (si > 0x100) {
    si = 0x400 - si;
    neg = true;
  }
  const t = s16(0x64 - sdivPow2(s16(0x46 * si), 8));
  const limit = (t & 0xff) << 8;
  if (c.speed2 > limit) {
    c.slideAngle = s16((neg ? -si : si) << 1);
    crash(c, CRASH_HIT, env);
  }
  c.soundFlags |= 0x10;
  for (let j = 0; j < 4; j++) {
    for (let k = 0; k < 3; k++) {
      const dk = before !== 0 && dist !== 0 ? s16(Math.trunc(Math.imul((pos[j][k] - prev[j][k]) | 0, before) / dist)) : 0;
      pos[j][k] = (prev[j][k] + s16(dk + r[k])) | 0;
    }
  }
  return true;
}
