// The plane table: every flat face a wheel can stand on. 133 base planes, each in four rotations (index 4 * base + r,
// r = 0 for a piece at rot 0, 1 for rot 3, 2 for rot 2, 3 for rot 1). A plane is a point (relative to the piece
// centre) and a unit normal in fixed point (8192 = 1); two angles and a rotation matrix (16384 = 1) give the car's
// orientation on it. Everything here is computed from the piece geometry (track-geometry.ts and the dimensions
// below); tests/surface-tables.test.ts compares the result with the original's table.
import { BANK_ENTRY, LOOP, MEDIAN_HEIGHT, PIPE } from './track-geometry';
import { cos16, polarAngle, sin16 } from './fixmath';

export interface Plane {
  /** Tilt towards x (1/1024 turn): rotation about z. */
  rotZ: number;
  /** Tilt towards -z (1/1024 turn): rotation about x. */
  rotX: number;
  origin: [number, number, number];
  normal: [number, number, number];
  /** Row-major 3x3, 16384 = 1. */
  matrix: number[];
}

type V3 = [number, number, number];
interface Base {
  origin: V3;
  normal: V3;
}

const HILL = 450;
/** Road half width. */
const HALF = 120;
/** A bank's high edge is 130 above its low edge (across the 240-wide road). */
const BANK_RISE = 130;

/** Unit vector in fixed point (8192), each component truncated towards zero. */
function unit(d: V3): V3 {
  const len = Math.hypot(d[0], d[1], d[2]);
  return [Math.trunc((d[0] / len) * 8192), Math.trunc((d[1] / len) * 8192), Math.trunc((d[2] / len) * 8192)];
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const flat = (y: number, origin: V3 = [0, y, 0]): Base => ({ origin, normal: [0, 8192, 0] });
const fromDir = (origin: V3, dir: V3): Base => ({ origin, normal: unit(dir) });

/** The plane through three points, its normal on the side of `towards`, anchored at `anchor`. */
function triangle(a: V3, b: V3, c: V3, anchor: V3, towards: V3 = [0, 1, 0]): Base {
  let n = cross(sub(b, a), sub(c, a));
  if (dot(n, towards) < 0) n = [-n[0], -n[1], -n[2]];
  return { origin: anchor, normal: unit(n) };
}

/** A point at radius r and angle a (1/1024 turn) around (cx, cz), measured from `start` turning by `dir`. */
export function arcPoint(cx: number, cz: number, r: number, a: number, axis: (c: number, s: number) => [number, number]): [number, number] {
  // Through the fixed-point sine table, rounded: r * sin / 16384.
  const [x, z] = axis(cos16(a), sin16(a));
  return [cx + Math.round((r * x) / 16384), cz + Math.round((r * z) / 16384)];
}

function basePlanes(): Base[] {
  const b: Base[] = [];
  // 0..2: ground, highway median, elevated deck / hill top.
  b.push(flat(0), flat(MEDIAN_HEIGHT), flat(HILL));
  // 3: ramp and hill slope: 0 at the south edge to 450 at the north edge.
  b.push(fromDir([0, 0, -512], [0, 1024, -HILL]));
  // 4, 5: hill corner tiles (one corner raised, one corner lowered): the half-tile triangle that slopes.
  b.push(triangle([512, 0, 512], [-512, 0, -512], [-512, HILL, 512], [512, 0, 512]));
  b.push(triangle([512, 0, -512], [512, HILL, 512], [-512, HILL, -512], [512, 0, -512]));
  // 6: the bank: 0 at x = -120 to 130 at x = 120.
  b.push(fromDir([-HALF, 0, 0], [-BANK_RISE, 2 * HALF, 0]));
  // 7..24: banked corner, 18 sectors of the arc round (-1024, -1024), inner edge r = 1416 at 0, outer r = 1656 at 130.
  b.push(...bankedCorner());
  // 25..44: bank entries (b rising to +x, then a rising to -x).
  b.push(...bankEntry(1), ...bankEntry(-1));
  // 45..56: loop.
  b.push(...loopPlanes());
  // 57..69: pipe section and the obstacle's top.
  b.push(...pipePlanes());
  // 70..78: pipe entry.
  b.push(...pipeEntryPlanes());
  // 79..130: helix corkscrews (left, right).
  b.push(...helixPlanes(-1), ...helixPlanes(1));
  // 131, 132: the start platform the cars wait on before the start (22 high, sloping down over 80 behind it).
  b.push(flat(22, [72, 22, -380]), fromDir([72, 0, -300], [0, 80, 22]));
  return b;
}

/** Sector boundary angles of an arc divided into n parts of a quarter (or full) turn, as whole 1/1024 turns. */
export const sectorAngle = (k: number, n: number, span: number) => Math.floor((span * k) / n);

function bankedCorner(): Base[] {
  const out: Base[] = [];
  const axis = (c: number, s: number): [number, number] => [c, s];
  const inner = 1536 - HALF;
  const outer = 1536 + HALF;
  for (let k = 0; k < 18; k++) {
    const a0 = sectorAngle(k, 18, 256);
    const a1 = sectorAngle(k + 1, 18, 256);
    const [ix0, iz0] = arcPoint(-1024, -1024, inner, a0, axis);
    const [ix1, iz1] = arcPoint(-1024, -1024, inner, a1, axis);
    const [ox0, oz0] = arcPoint(-1024, -1024, outer, a0, axis);
    const [ox1, oz1] = arcPoint(-1024, -1024, outer, a1, axis);
    const I0: V3 = [ix0, 0, iz0];
    const I1: V3 = [ix1, 0, iz1];
    const O0: V3 = [ox0, BANK_RISE, oz0];
    const O1: V3 = [ox1, BANK_RISE, oz1];
    // Each sector is the quad's triangle along its outer edge; the eleventh is split along the other diagonal.
    out.push(k === 10 ? triangle(I0, O0, O1, O1) : triangle(I1, O0, O1, I1));
  }
  return out;
}

/** Bank entry: the edge at side * 120 rises over the tile while the other edge stays at 0. */
function bankEntry(side: number): Base[] {
  const { z: Z, rise } = BANK_ENTRY;
  const L = (i: number): V3 => [-side * HALF, 0, Z[i]];
  const R = (i: number): V3 => [side * HALF, rise[i], Z[i]];
  const out: Base[] = [flat(0)];
  for (let s = 0; s < 4; s++) {
    out.push(triangle(L(s), R(s), L(s + 1), R(s)));
    out.push(triangle(R(s), R(s + 1), L(s + 1), L(s + 1)));
  }
  if (side > 0) out.push(fromDir(L(4), [-BANK_RISE, 2 * HALF, 0]));
  else out.push(triangle(L(4), R(4), [-HALF, BANK_RISE, BANK_ENTRY.fullAt], L(4)));
  return out;
}

function loopPlanes(): Base[] {
  const out: Base[] = [];
  const P = LOOP.planeProfile;
  const centre = (LOOP.profileY[6] / 2) | 0;
  for (const half of [1, -1]) {
    for (let i = 0; i < 6; i++) {
      const a: V3 = [0, P[i][1], half * P[i][0]];
      const c: V3 = [0, P[i + 1][1], half * P[i + 1][0]];
      const anchor = half > 0 ? c : a;
      // Normal in the y-z plane, perpendicular to the segment, pointing into the loop.
      let n: V3 = [0, c[2] - a[2], -(c[1] - a[1])];
      const mid: V3 = [0, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2];
      if (dot(n, sub([0, centre, 0], mid)) < 0) n = [0, -n[1], -n[2]];
      out.push({ origin: anchor, normal: unit(n) });
    }
  }
  return out;
}

/** The pipe section's corners going round from the floor centre towards -x (x, y). */
function pipeCorners(): [number, number][] {
  const [x0, x1, x2] = PIPE.x;
  const [y0, y1, y2, y3, y4, y5] = PIPE.y;
  return [
    [x0, y0], [-x0, y0], [-x1, y1], [-x2, y2], [-x2, y3], [-x1, y4], [-x0, y5],
    [x0, y5], [x1, y4], [x2, y3], [x2, y2], [x1, y1], [x0, y0],
  ];
}

function pipePlanes(): Base[] {
  const c = pipeCorners();
  const out: Base[] = [];
  for (let k = 0; k < 12; k++) {
    const [ax, ay] = c[k];
    const [bx, by] = c[k + 1];
    // Inward normal: the segment direction turned a quarter turn.
    out.push({ origin: [bx, by, 0], normal: unit([by - ay, -(bx - ax), 0]) });
  }
  out.push(flat(PIPE.bumpHeight));
  return out;
}

/** Pipe entry: flat at the near end (z = -len), the pipe's lower section at the far end; each strip split in two. */
function pipeEntryPlanes(): Base[] {
  const len = PIPE.entryHalfLength;
  const c = pipeCorners();
  const near = (x: number): V3 => [x, 0, -len];
  const far = (i: number): V3 => [c[i][0], c[i][1], len];
  // Corners: 1 (-31, 0), 2 (-84, 35), 3 (-115, 88); 12 (31, 0), 11 (84, 35), 10 (115, 88).
  const strip = (i: number, j: number, flatAnchor: 'far' | 'near', slopeAnchor: 'far' | 'near'): Base[] => {
    const A = near(c[i][0]);
    const B = near(c[j][0]);
    const C = far(j);
    const D = far(i);
    const t1 = triangle(A, B, D, flatAnchor === 'far' ? D : A);
    const t2 = triangle(B, C, D, slopeAnchor === 'near' ? B : D);
    return [t1, t2];
  };
  return [
    flat(0),
    ...strip(1, 2, 'far', 'near'),
    ...strip(2, 3, 'far', 'near'),
    // The +x side is the mirror image, its two triangles listed the other way round.
    ...strip(12, 11, 'far', 'far').reverse(),
    ...strip(11, 10, 'near', 'far').reverse(),
  ];
}

/** Helix corkscrew: 24 sectors of 15 degrees round the block centre, climbing 19 per sector to 450. */
function helixPlanes(side: number): Base[] {
  const inner = 512 - HALF;
  const outer = 512 + HALF;
  const axis = (c: number, s: number): [number, number] => [side * c, s];
  const y = (k: number) => Math.min(19 * k, HILL);
  const out: Base[] = [flat(0)];
  for (let k = 0; k < 24; k++) {
    const a0 = sectorAngle(k, 24, 1024);
    const a1 = sectorAngle(k + 1, 24, 1024);
    const p = (r: number, a: number, h: number): V3 => {
      const [x, z] = arcPoint(0, 0, r, a, axis);
      return [x, h, z];
    };
    const I0 = p(inner, a0, y(k));
    const O0 = p(outer, a0, y(k));
    const I1 = p(inner, a1, y(k + 1));
    const O1 = p(outer, a1, y(k + 1));
    out.push(side < 0 ? triangle(I0, O0, I1, I1) : triangle(I0, O0, O1, O1));
  }
  out.push(flat(HILL));
  return out;
}

/** Angle of (a, b) from the +b axis towards +a, rounded to 1/1024 turn, 0..1023. */
const angle = (a: number, b: number) => polarAngle(a, b) & 1023;

function orient(n: V3): { rotZ: number; rotX: number } {
  const [nx, ny, nz] = n;
  if (nz === 0) return { rotZ: angle(nx, ny), rotX: 0 };
  return { rotZ: angle(nx, Math.round(Math.hypot(ny, nz))), rotX: angle(-nz, ny) };
}

/** The car's orientation matrix on a plane tilted by rotZ then rotX (fixed point, products floored like the original). */
function matrix(rotZ: number, rotX: number): number[] {
  const c1 = cos16(rotZ);
  const s1 = sin16(rotZ);
  const c2 = cos16(rotX);
  const s2 = sin16(rotX);
  return [c1, (-s1 * c2) >> 14, (s1 * s2) >> 14, s1, (c1 * c2) >> 14, (-c1 * s2) >> 14, 0, s2, c2];
}

/** A base plane turned for a piece rotation slot r (0: rot 0, 1: rot 3, 2: rot 2, 3: rot 1). */
function turned(p: Base, r: number, tilt = 0): Plane {
  const t = ([x, y, z]: V3): V3 => (r === 1 ? [-z, y, x] : r === 2 ? [-x, y, -z] : r === 3 ? [z, y, -x] : [x, y, z]);
  const origin = t(p.origin).map((v) => v + 0) as V3;
  const normal = t(p.normal).map((v) => v + 0) as V3;
  const o = orient(normal);
  const rotZ = (o.rotZ + tilt) & 1023;
  return { rotZ, rotX: o.rotX, origin, normal, matrix: matrix(rotZ, o.rotX) };
}

/**
 * A measured rounding quirk (tests/surface-tables.test.ts): the quarter-turned copies of banked-corner sector 9
 * (base plane 16) lean one unit further than their normal gives (no integer or float measure of the normal
 * reproduces it). The car's orientation on the plane follows the lean, so a car crossing that sector needs it to
 * step exactly (tests/sim-full.test.ts, one replay drives there).
 */
const TILT_ROUNDING: Record<string, number> = { '16:1': 1, '16:3': -1 };

let cache: Plane[] | null = null;
export function buildPlanes(): Plane[] {
  if (cache) return cache;
  const out: Plane[] = [];
  basePlanes().forEach((p, b) => {
    for (let r = 0; r < 4; r++) out.push(turned(p, r, TILT_ROUNDING[`${b}:${r}`] ?? 0));
  });
  return (cache = out);
}

/** Number of base planes (each has four rotations). */
export const BASE_PLANES = 133;
