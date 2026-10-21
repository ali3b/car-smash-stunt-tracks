// A route for the computer opponent on one of our tracks: the circuit as the race traces it (src/sim/track-path.ts:
// the pieces in driving order from the start/finish line, with the slalom's weave, the loop's lane, the helix's
// spiral and the highway's carriageway) cut into waypoints, each with two lane points either side. Our own
// construction (track units, 1024 per tile); see research/SPEC.md "Opponent driving".
import { HILL_UNITS, type PieceKind, type TrackFile } from '../track/types';
import type { Vec3 } from './car';
import { cos1024, fmul14, s16, sin1024 } from './fixed';
import { gridOffsets, SpeedClass, type OpponentRoute, type OpponentStart, type RouteWaypoint } from './opponent';
import { toWorld, tracePath, type P3, type PathSection, type TrackPath } from './track-path';
import type { Vec3i } from './vec';

const TILE = 1024;
/** Lane points sit this far either side of the centre line (half a road is 120). */
const LANE = 120;
/** Spacing of waypoints along a piece (track units). */
const SPACING = 300;
/** The loop's circle (piece frame): its foot at the piece centre, this radius. */
const LOOP_R = 487;

/** Driving heading (1024 per turn, 0 = north, clockwise) when leaving through a side. */
const HEADING = { N: 0, E: 256, S: 512, W: 768 } as const;

/** Speed slot base of a piece kind; roads and corners add their surface. */
function slotBase(kind: PieceKind): { base: number; surfaced: boolean } {
  switch (kind) {
    case 'corner-small':
      return { base: SpeedClass.SharpCorner, surfaced: true };
    case 'corner-large':
    case 'elevated-corner':
    case 'banked-corner':
    case 'split-large':
      return { base: SpeedClass.WideCorner, surfaced: true };
    case 'ramp':
    case 'ramp-solid':
    case 'ramp-bridge':
      return { base: SpeedClass.Ramp, surfaced: false };
    case 'slalom':
      return { base: SpeedClass.Slalom, surfaced: false };
    case 'corkscrew-helix':
      return { base: SpeedClass.Helix, surfaced: false };
    case 'chicane':
      return { base: SpeedClass.Chicane, surfaced: false };
    case 'loop':
      return { base: SpeedClass.Loop, surfaced: false };
    case 'pipe':
    case 'pipe-entry':
    case 'pipe-obstacle':
    case 'corkscrew-roll':
      return { base: SpeedClass.Pipe, surfaced: false };
    default:
      return { base: SpeedClass.Straight, surfaced: true };
  }
}

const SURFACE_INDEX = { paved: 0, dirt: 1, ice: 2 } as const;

/**
 * Speed (mph) to ask for on the run-up to a jump of `gap` empty tiles: a one-tile gap needs about 112 mph at the lip
 * (src/sim/autopilot.ts jumpSpeed), so the run-up is driven flat out. A wider gap cannot be cleared.
 */
export const jumpMph = (gap: number): number => 118 + 45 * (gap - 1);
/** Run-up before a jump: up to this much road (track units) of straight pieces before it asks for the jump's speed. */
const RUN_UP = 12 * TILE;

interface Step {
  kind: PieceKind;
  points: { c: Vec3i; l: Vec3i; r: Vec3i }[];
  slot: number;
  minMph: number;
}

/** Points every ~SPACING along a polyline (from half a spacing in to its end), with the direction of travel. */
function resample(pts: P3[], spacing = SPACING): { p: P3; dx: number; dz: number }[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]));
  const len = cum[cum.length - 1];
  const n = Math.max(2, Math.round(len / spacing));
  const out: { p: P3; dx: number; dz: number }[] = [];
  let j = 1;
  for (let k = 0; k < n; k++) {
    const s = ((k + 0.5) / n) * len;
    while (j < pts.length - 1 && cum[j] < s) j++;
    const a = pts[j - 1];
    const b = pts[j];
    const t = cum[j] > cum[j - 1] ? (s - cum[j - 1]) / (cum[j] - cum[j - 1]) : 0;
    out.push({ p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], dx: b[0] - a[0], dz: b[2] - a[2] });
  }
  return out;
}

const r16 = (q: number) => s16(Math.round(q));

function waypoint(p: P3, dx: number, dz: number, y: number): { c: Vec3i; l: Vec3i; r: Vec3i } {
  const len = Math.hypot(dx, dz) || 1;
  // left of travel = (-dz, dx) seen from above (x east, z north)
  const lx = (-dz / len) * LANE;
  const lz = (dx / len) * LANE;
  const yy = y === -1 ? -1 : r16(y);
  return { c: [r16(p[0]), yy, r16(p[2])], l: [r16(p[0] + lx), yy, r16(p[2] + lz)], r: [r16(p[0] - lx), yy, r16(p[2] - lz)] };
}

/** The loop: the flat approach into its lane, round the circle (with heights: the car must climb to reach them), out. */
function loopPoints(t: TrackPath, sec: PathSection): Step['points'] {
  const piece = t.track.pieces[sec.piece];
  const f = sec.forward ? 1 : -1;
  const world = (lx: number, lz: number) => toWorld(piece, f * lx, f * lz);
  const base = sec.points[0][1];
  const out: Step['points'] = [];
  const flat = (from: number, to: number, x0: number, x1: number, n: number) => {
    for (let k = 1; k <= n; k++) {
      const u = k / n;
      const [x, z] = world(x0 + (x1 - x0) * u, from + (to - from) * u);
      const [x2, z2] = world(x0 + (x1 - x0) * (u + 0.01), from + (to - from) * (u + 0.01));
      out.push(waypoint([x, base, z], x2 - x, z2 - z, -1));
    }
  };
  flat(-1024, -160, 0, -200, 3);
  const N = 10;
  for (let k = 1; k < N; k++) {
    const th = (k / N) * 2 * Math.PI;
    const lx = -200 + (400 * k) / N;
    const lz = LOOP_R * Math.sin(th);
    const [x, z] = world(lx, lz);
    const [x2, z2] = world(lx, lz + Math.cos(th));
    out.push(waypoint([x, base + LOOP_R * (1 - Math.cos(th)), z], x2 - x, z2 - z, base + LOOP_R * (1 - Math.cos(th))));
  }
  flat(160, 1024, 200, 0, 3);
  return out;
}

function sectionStep(t: TrackPath, sec: PathSection): Step {
  const piece = t.track.pieces[sec.piece];
  let points: Step['points'];
  if (sec.kind === 'loop') points = loopPoints(t, sec);
  else {
    // The helix climbs over itself: its waypoints keep their height. Elsewhere only x and z count.
    const keepY = sec.kind === 'corkscrew-helix';
    // The slalom and the chicane weave: closer waypoints keep the line round their blocks.
    const spacing = sec.kind === 'slalom' || sec.kind === 'chicane' ? SPACING / 2.5 : SPACING;
    points = resample(sec.points, spacing).map(({ p, dx, dz }) => waypoint(p, dx, dz, keepY ? p[1] + 8 : -1));
  }
  const { base, surfaced } = slotBase(sec.kind);
  const slot = base + (surfaced ? SURFACE_INDEX[piece.surface ?? 'paved'] : 0);
  return { kind: sec.kind, points, slot, minMph: sec.jumpGap > 0 ? jumpMph(sec.jumpGap) : 0 };
}

export interface TrackRoute extends OpponentRoute {
  /** Driving direction of the start line (1024 per turn, 0 = north, clockwise). */
  startAngle: number;
  startTile: [number, number];
  /** The circuit the route follows (the race's own trace). */
  path: TrackPath;
}

/** The route of a track (null when it has no start/finish line or its circuit does not close). */
export function buildRoute(t: TrackFile, path: TrackPath = tracePath(t)): TrackRoute | null {
  if (!path.sections.length || !path.closed || path.startPiece < 0) return null;
  const steps = path.sections.map((sec) => sectionStep(path, sec));
  // Run-up: the straight road before a jump asks for the jump's speed.
  steps.forEach((s, i) => {
    if (!s.minMph) return;
    // The landing ramp too: its waypoints are loaded before the lip, and braking for it there falls short.
    const land = steps[(i + 1) % steps.length];
    land.minMph = Math.max(land.minMph, s.minMph);
    let road = 0;
    for (let k = 1; k < steps.length && road < RUN_UP; k++) {
      const j = (i - k + steps.length) % steps.length;
      const prev = path.sections[j];
      if (slotBase(prev.kind).base !== SpeedClass.Straight && prev.kind !== 'ramp' && prev.kind !== 'ramp-solid' && prev.kind !== 'ramp-bridge') break;
      steps[j].minMph = Math.max(steps[j].minMph, s.minMph);
      road += prev.end - prev.start;
    }
  });
  const start = t.pieces[path.startPiece];
  const angle = HEADING[path.sections[0].exit.side];
  const cx = start.x * TILE + 512;
  const cz = start.z * TILE + 512;
  return {
    steps: steps.length,
    startAngle: angle,
    startTile: [start.x, start.z],
    path,
    waypoint(step: number, k: number): RouteWaypoint {
      const s = steps[step % steps.length];
      const p = s.points[Math.min(k, s.points.length - 1)];
      return { centre: p.c, left: p.l, right: p.r, lane: 0, slot: s.slot, last: k >= s.points.length - 1, minMph: s.minMph || undefined };
    },
    finishSide(x: number, z: number): number {
      return s16(fmul14(cos1024(angle), s16(cz - z)) + fmul14(sin1024(angle), s16(cx - x)));
    },
  };
}

function groundAt(t: TrackFile, x: number, z: number): number {
  const h = (cx: number, cz: number) => t.heights[cz]?.[cx] ?? 0;
  return Math.max(h(x, z), h(x + 1, z), h(x, z + 1), h(x + 1, z + 1)) > 0 ? HILL_UNITS : 0;
}

/** Grid places for the player and the opponent beside the start line of a route (physics units, yaw). */
export function gridStarts(t: TrackFile, route: { startAngle: number; startTile: [number, number] }): { player: OpponentStart; opponent: OpponentStart } {
  const [tx, tz] = route.startTile;
  const off = gridOffsets(route.startAngle);
  const y = groundAt(t, tx, tz);
  const at = (o: [number, number]): Vec3 => [(tx * TILE + 512 + o[0]) * 64, y * 64, (tz * TILE + 512 + o[1]) * 64];
  const yaw = s16(-route.startAngle);
  return { player: { pos: at(off.player), yaw }, opponent: { pos: at(off.opponent), yaw } };
}
