// The circuit as the race logic and the autopilot see it: the pieces in driving order from the start-finish line
// (traced with the validator's road ends, src/track/validate.ts), each with a centre line in track units.
//
// Units: track units (1024 per tile), x east, z north, y up. Headings: 1024 per turn, 0 = north, increasing towards
// the west (the car simulation's yaw).
import { pieceDef, rotatedFootprint, type Side } from '../track/pieces';
import { GRID, HILL_UNITS, type Piece, type PieceKind, type TrackFile } from '../track/types';
import { linkOf, pathThrough, sideHeight, tileIndex, worldEnds, type WorldEnd } from '../track/validate';

export type P3 = [number, number, number];

/** One traversal of one piece (a crossroads driven twice is two sections). */
export interface PathSection {
  index: number;
  /** Index into track.pieces. */
  piece: number;
  kind: PieceKind;
  variant?: string;
  entry: WorldEnd;
  exit: WorldEnd;
  /** Centre line from the entry edge to the exit edge (track units). y is the road level (ground, hill or deck). */
  points: P3[];
  /** Running distance (horizontal, track units) at each point, from the start of the lap. */
  cum: number[];
  /** Distance along the lap at the entry edge and at the exit edge. */
  start: number;
  end: number;
  /** Empty tiles flown over after the exit (a jump), 0 otherwise. */
  jumpGap: number;
  /** Tiles the piece covers. */
  tiles: number[];
  /** Driven from the piece's rot-0 entry to its exit (false: the other way round). */
  forward: boolean;
}

export interface TrackPath {
  track: TrackFile;
  sections: PathSection[];
  /** Lap length (track units, horizontal). */
  length: number;
  /** The trace came back to the start line. */
  closed: boolean;
  /** Section indices per tile (z * 30 + x); empty for tiles no section covers. */
  tileSections: number[][];
  /** Start-finish piece index, or -1. */
  startPiece: number;
}

export interface PathPoint {
  section: number;
  /** Distance along the lap (0..length). */
  s: number;
  /** Signed distance from the centre line, positive to the right of the driving direction. */
  lateral: number;
  /** Driving direction as a heading (1024 per turn, 0 north, increasing to the west). */
  heading: number;
  /** The centre line point. */
  pos: P3;
}

const SIDE_DIR: Record<Side, [number, number]> = { N: [0, 1], E: [1, 0], S: [0, -1], W: [-1, 0] };

/** The middle of an end's tile edge (track units) and the unit direction into the piece there. */
export function endPoint(track: TrackFile, e: WorldEnd): { pos: P3; inward: [number, number] } {
  const [sx, sz] = SIDE_DIR[e.side];
  const x = e.x * 1024 + 512 + sx * 512;
  const z = e.z * 1024 + 512 + sz * 512;
  const y = e.level === 'elevated' ? HILL_UNITS : sideHeight(track, e.x, e.z, e.side) * HILL_UNITS;
  return { pos: [x, y, z], inward: [-sx, -sz] };
}

/** Heading (sim yaw) of a horizontal direction. */
export function headingOf(dx: number, dz: number): number {
  return Math.round((Math.atan2(-dx, dz) * 512) / Math.PI) & 1023;
}

/** Piece frame (rot 0, origin at the footprint centre) → world, as the track surface defines it. */
export function toWorld(p: Piece, lx: number, lz: number): [number, number] {
  const def = pieceDef(p)!;
  const [w, d] = rotatedFootprint(def, p.rot);
  const cx = p.x * 1024 + w * 512;
  const cz = p.z * 1024 + d * 512;
  switch (p.rot & 3) {
    case 1: return [cx + lz, cz - lx];
    case 2: return [cx - lx, cz - lz];
    case 3: return [cx - lz, cz + lx];
    default: return [cx + lx, cz + lz];
  }
}

/** World → piece frame (rot 0, origin at the footprint centre). */
export function toLocal(p: Piece, x: number, z: number): [number, number] {
  const def = pieceDef(p)!;
  const [w, d] = rotatedFootprint(def, p.rot);
  const dx = x - (p.x * 1024 + w * 512);
  const dz = z - (p.z * 1024 + d * 512);
  switch (p.rot & 3) {
    case 1: return [-dz, dx];
    case 2: return [-dx, -dz];
    case 3: return [dz, -dx];
    default: return [dx, dz];
  }
}

function bezier(a: P3, h1: P3, h2: P3, b: P3, u: number): P3 {
  const v = 1 - u;
  const w = [v * v * v, 3 * v * v * u, 3 * v * u * u, u * u * u];
  return [0, 1, 2].map((i) => w[0] * a[i] + w[1] * h1[i] + w[2] * h2[i] + w[3] * b[i]) as P3;
}

/**
 * Local (piece frame) waypoints for pieces whose road is not a plain curve between its ends, listed from the rot-0
 * entry to the exit: the slalom weaves round its blocks, the loop's lane is offset, the helix spirals.
 */
function localWaypoints(p: Piece): [number, number, number][] | null {
  const mid = (a: number, b: number, k: number) => a + (b - a) * k;
  switch (p.kind) {
    case 'slalom':
      // Blocks at x 23..97 (z ≈ -256) and x -97..-23 (z ≈ 256).
      return [[0, 0, -512], [-60, 0, -330], [-60, 0, -180], [60, 0, 180], [60, 0, 330], [0, 0, 512]];
    case 'loop':
      // The approach bends into the loop's lane (x -400..0 at the loop's foot), the car comes out at x 0..400.
      return [[0, 0, -1024], [-120, 0, -500], [-200, 0, -60], [200, 0, 60], [120, 0, 500], [0, 0, 1024]];
    case 'corkscrew-helix': {
      // A full turn round the block centre at radius 512, climbing to the deck, between straight runs.
      const side = p.variant === 'left' ? -1 : 1;
      const out: [number, number, number][] = [[side * 512, 0, -1024], [side * 512, 0, -300]];
      for (let k = 0; k <= 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        out.push([side * 512 * Math.cos(a), mid(0, HILL_UNITS, k / 24), 512 * Math.sin(a)]);
      }
      out.push([side * 512, HILL_UNITS, 300], [side * 512, HILL_UNITS, 1024]);
      return out;
    }
    default:
      return null;
  }
}

function sectionPoints(track: TrackFile, p: Piece, entry: WorldEnd, exit: WorldEnd, forward: boolean): P3[] {
  const a = endPoint(track, entry);
  const b = endPoint(track, exit);
  const local = localWaypoints(p);
  if (local) {
    const pts = local.map(([lx, ly, lz]) => {
      const [x, z] = toWorld(p, lx, lz);
      return [x, mid3(a.pos[1], b.pos[1], ly, p.kind), z] as P3;
    });
    if (!forward) pts.reverse();
    pts[0] = a.pos;
    pts[pts.length - 1] = b.pos;
    return densify(pts, 48);
  }
  const dirOut: [number, number] = [-b.inward[0], -b.inward[1]];
  const chord = Math.hypot(b.pos[0] - a.pos[0], b.pos[2] - a.pos[2]);
  const straight =
    a.inward[0] * dirOut[0] + a.inward[1] * dirOut[1] > 0.999 &&
    Math.abs((b.pos[0] - a.pos[0]) * a.inward[1] - (b.pos[2] - a.pos[2]) * a.inward[0]) < 1;
  if (straight) return densify([a.pos, b.pos], 64);
  const k = 0.39 * chord;
  const h1: P3 = [a.pos[0] + a.inward[0] * k, a.pos[1], a.pos[2] + a.inward[1] * k];
  const h2: P3 = [b.pos[0] - dirOut[0] * k, b.pos[1], b.pos[2] - dirOut[1] * k];
  const n = Math.max(8, Math.ceil(chord / 48));
  const out: P3[] = [];
  for (let i = 0; i <= n; i++) out.push(bezier(a.pos, h1, h2, b.pos, i / n));
  return out;
}

/** Waypoint heights: the helix gives its own climb, others run from the entry level to the exit level. */
function mid3(ya: number, yb: number, ly: number, kind: PieceKind): number {
  return kind === 'corkscrew-helix' ? Math.min(Math.max(ya, yb), Math.max(Math.min(ya, yb), ly)) : ya;
}

function densify(pts: P3[], step: number): P3[] {
  const out: P3[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, a[2] + ((b[2] - a[2]) * k) / n]);
  }
  return out;
}

/** The divided highway is driven on the right-hand carriageway (the centre line runs along its median). */
const HIGHWAY_LANE = 240;

function laneOffset(pts: P3[], kind: PieceKind, forward: boolean): P3[] {
  if (kind !== 'highway' && kind !== 'highway-entry') return pts;
  const n = pts.length - 1;
  const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  return pts.map((q, i) => {
    const t = n ? i / n : 0;
    const k = kind === 'highway' ? 1 : smooth(((forward ? t : 1 - t) - 0.1) / 0.45);
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n, i + 1)];
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    const l = Math.hypot(dx, dz) || 1;
    return [q[0] + (dz / l) * HIGHWAY_LANE * k, q[1], q[2] - (dx / l) * HIGHWAY_LANE * k] as P3;
  });
}

/** Trace the circuit from the start-finish line (the validator's rules: road ends, jumps, forks take the main path). */
export function tracePath(track: TrackFile): TrackPath {
  const idx = tileIndex(track);
  const ends = track.pieces.map(worldEnds);
  const out: TrackPath = { track, sections: [], length: 0, closed: false, tileSections: Array.from({ length: GRID * GRID }, () => []), startPiece: -1 };
  const sf = track.pieces.findIndex((p) => p.kind === 'start-finish');
  out.startPiece = sf;
  if (sf < 0) return out;
  let entry = ends[sf].find((e) => e.which === 0 && e.path === 0)!;
  let exit = ends[sf].find((e) => e.which === 1 && e.path === 0)!;
  const seen = new Set<string>();
  let s = 0;
  for (let guard = 0; guard < 4 * GRID * GRID; guard++) {
    const pi = entry.piece;
    const p = track.pieces[pi];
    const link = linkOf(track, idx, ends, exit);
    const pts = laneOffset(sectionPoints(track, p, entry, exit, entry.which === 0), p.kind, entry.which === 0);
    const cum: number[] = [];
    let len = s;
    pts.forEach((q, i) => {
      if (i > 0) len += Math.hypot(q[0] - pts[i - 1][0], q[2] - pts[i - 1][2]);
      cum.push(len);
    });
    const def = pieceDef(p)!;
    const [w, d] = rotatedFootprint(def, p.rot);
    const tiles: number[] = [];
    for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) tiles.push((p.z + dz) * GRID + p.x + dx);
    const sec: PathSection = {
      index: out.sections.length,
      piece: pi,
      kind: p.kind,
      variant: p.variant,
      entry,
      exit,
      points: pts,
      cum,
      start: s,
      end: len,
      jumpGap: link.kind === 'jump' ? link.gap : 0,
      tiles,
      forward: entry.which === 0,
    };
    out.sections.push(sec);
    for (const t of tiles) if (t >= 0 && t < GRID * GRID) out.tileSections[t].push(sec.index);
    s = len;
    if (link.kind === 'open') break;
    if (link.kind === 'jump') s += link.gap * 1024;
    const next = link.to;
    if (next.piece === sf) {
      out.closed = next.which === 0;
      break;
    }
    const key = `${next.piece}:${next.x},${next.z}${next.side}`;
    if (seen.has(key)) break;
    seen.add(key);
    const through = pathThrough(ends[next.piece], next);
    if (!through) break;
    entry = next;
    exit = through;
  }
  out.length = s;
  return out;
}

/**
 * The nearest centre-line point to (x, z) among the given sections (default: every section). Distances are
 * horizontal; `y` breaks ties between stacked roads (a deck over a road).
 */
export function nearestOnPath(path: TrackPath, x: number, z: number, sections?: Iterable<number>, y?: number): PathPoint | null {
  let best: PathPoint | null = null;
  let bestD = Infinity;
  const list = sections ?? path.sections.map((s) => s.index);
  for (const si of list) {
    const sec = path.sections[si];
    const pts = sec.points;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const dx = b[0] - a[0];
      const dz = b[2] - a[2];
      const l2 = dx * dx + dz * dz || 1;
      const u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / l2));
      const px = a[0] + dx * u;
      const pz = a[2] + dz * u;
      const py = a[1] + (b[1] - a[1]) * u;
      let d = Math.hypot(x - px, z - pz);
      if (y !== undefined) d += Math.abs(y - py) * 0.5;
      if (d < bestD) {
        bestD = d;
        const l = Math.sqrt(l2);
        // right of the driving direction (x east, z north): (dz, -dx)
        const lateral = ((x - px) * dz - (z - pz) * dx) / l;
        best = { section: si, s: sec.cum[i - 1] + (sec.cum[i] - sec.cum[i - 1]) * u, lateral, heading: headingOf(dx, dz), pos: [px, py, pz] };
      }
    }
  }
  return best;
}

/** The centre-line point at lap distance s (wraps on a closed lap). */
export function pointAt(path: TrackPath, s: number): PathPoint | null {
  if (!path.sections.length) return null;
  if (path.closed && path.length > 0) s = ((s % path.length) + path.length) % path.length;
  let sec = path.sections.find((q) => s <= q.end) ?? path.sections[path.sections.length - 1];
  // In a jump's gap: the landing section's start.
  if (s < sec.start) s = sec.start;
  const { points: pts, cum } = sec;
  let i = 1;
  while (i < pts.length - 1 && cum[i] < s) i++;
  const a = pts[i - 1];
  const b = pts[i];
  const u = cum[i] > cum[i - 1] ? Math.max(0, Math.min(1, (s - cum[i - 1]) / (cum[i] - cum[i - 1]))) : 0;
  return {
    section: sec.index,
    s,
    lateral: 0,
    heading: headingOf(b[0] - a[0], b[2] - a[2]),
    pos: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u],
  };
}
