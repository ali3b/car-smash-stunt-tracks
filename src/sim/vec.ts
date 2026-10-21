// 16-bit fixed-point vector and matrix maths of the simulation (research/SPEC.md "Car physics" §1).
// Matrices are row-major 3×3 with 0x4000 = 1. Vectors multiply as rows: (v·M)_j = Σ_i v_i M[3i+j], each product
// truncated (floor) to 1.14 before the 16-bit sum. Angles are 1024 per turn.
import { cos1024, s16, sin1024 } from './fixed';
import type { Mat3i, Vec3i } from './surface';

export type { Mat3i, Vec3i };

/** floor(a * b / 0x4000) wrapped to 16 bits (a, b signed 16-bit). */
const t14 = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : s16(Math.imul(a, b) >> 14));

/** Row vector times matrix. */
export function vmul(v: Vec3i, m: Mat3i): Vec3i {
  return [
    s16(t14(v[0], m[0]) + t14(v[1], m[3]) + t14(v[2], m[6])),
    s16(t14(v[0], m[1]) + t14(v[1], m[4]) + t14(v[2], m[7])),
    s16(t14(v[0], m[2]) + t14(v[1], m[5]) + t14(v[2], m[8])),
  ];
}

/** Matrix product a·b. */
export function mmul(a: Mat3i, b: Mat3i): Mat3i {
  const o = new Array(9) as Mat3i;
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      o[r * 3 + c] = s16(t14(a[r * 3], b[c]) + t14(a[r * 3 + 1], b[3 + c]) + t14(a[r * 3 + 2], b[6 + c]));
  return o;
}

export function transpose(m: Mat3i): Mat3i {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

export const IDENTITY: Mat3i = [0x4000, 0, 0, 0, 0x4000, 0, 0, 0, 0x4000];

/** Rotation about x (pitch). */
export function rotX(a: number): Mat3i {
  const c = cos1024(a);
  const s = sin1024(a);
  return [0x4000, 0, 0, 0, c, s, 0, s16(-s), c];
}
/** Rotation about y (yaw). */
export function rotY(a: number): Mat3i {
  const c = cos1024(a);
  const s = sin1024(a);
  return [c, 0, s16(-s), 0, 0x4000, 0, s, 0, c];
}
/** Rotation about z (roll). */
export function rotZ(a: number): Mat3i {
  const c = cos1024(a);
  const s = sin1024(a);
  return [c, s, 0, s16(-s), c, 0, 0, 0, 0x4000];
}

/**
 * Combined rotation from roll (z), pitch (x) and yaw (y). Angles that are 0 (mod 1024) are left out of the product
 * (which changes the rounding, so this matters). `reverse` = false gives Rz·Rx·Ry (a row vector is rolled first,
 * then pitched, then turned); true gives Ry·Rx·Rz.
 */
export function rotZXY(z: number, x: number, y: number, reverse = false): Mat3i {
  const ms: Mat3i[] = [];
  if (z & 0x3ff) ms.push(rotZ(z));
  if (x & 0x3ff) ms.push(rotX(x));
  if (y & 0x3ff) ms.push(rotY(y));
  if (ms.length === 0) return IDENTITY;
  if (reverse) ms.reverse();
  let m = ms[0];
  for (let i = 1; i < ms.length; i++) m = mmul(m, ms[i]);
  return m;
}

/** atan(i / 256) in 1024ths of a turn, rounded; 257 entries. */
const ATAN: Uint8Array = (() => {
  const t = new Uint8Array(257);
  for (let i = 0; i <= 256; i++) t[i] = Math.round((Math.atan(i / 256) * 512) / Math.PI);
  return t;
})();

/**
 * Angle of the direction (x, z), measured from +z towards +x, 1024 per turn, in -512..512. (0, 0) gives 0.
 * Resolution: the octant ratio is taken to 1/256 and looked up in a rounded arctangent table.
 */
export function atan2i(x: number, z: number): number {
  let flags = 0;
  let a = x;
  let b = z;
  if (a < 0) {
    flags |= 4;
    a = -a;
  }
  if (b < 0) {
    flags |= 2;
    b = -b;
  }
  let r: number;
  if (a === b) {
    if (a === 0) return 0;
    r = 0x80;
  } else {
    if (a > b) {
      const t = a;
      a = b;
      b = t;
      flags |= 1;
    }
    const q = Math.floor((a * 0x10000) / b) & 0xffff;
    r = ATAN[(q + 0x80) >> 8];
  }
  switch (flags) {
    case 0:
      return r;
    case 1:
      return 0x100 - r;
    case 2:
      return 0x200 - r;
    case 3:
      return r + 0x100;
    case 4:
      return -r;
    case 5:
      return r - 0x100;
    case 6:
      return r - 0x200;
    default:
      return -r - 0x100;
  }
}

/** Length of (x, z) from its angle: |z| / cos or |x| / sin (16-bit result). */
export function hypot2(x: number, z: number): number {
  let a = atan2i(x, z);
  if (a < 0) a = -a;
  if (a >= 0x100) a = 0x200 - a;
  if (a <= 0x80) return Math.floor((Math.abs(z) * 0x4000) / cos1024(a)) & 0xffff;
  return Math.floor((Math.abs(x) * 0x4000) / sin1024(a)) & 0xffff;
}

/** Length of a 3D vector: hypot2(hypot2(x, y), z). */
export function length3(v: Vec3i): number {
  return hypot2(s16(hypot2(v[0], v[1])), v[2]);
}

/**
 * Where the segment from b to a crosses the plane "z = target": z is set to target and x, y are interpolated
 * (16-bit, truncating; both factors halved with an unsigned shift when a.z < b.z, as the original does).
 */
export function crossZ(a: Vec3i, b: Vec3i, target: number): Vec3i {
  let t = s16(target - b[2]);
  let d = s16(a[2] - b[2]);
  if (d < 0) {
    t = (t & 0xffff) >>> 1;
    d = (d & 0xffff) >>> 1;
  }
  const f = (ai: number, bi: number) => s16(Math.trunc((s16(ai - bi) * t) / d) + bi);
  return [f(a[0], b[0]), f(a[1], b[1]), s16(target)];
}

/** Height of p above a plane through o with normal n (0x2000 = 1): trunc(dot(p - o, n) / 0x2000). */
export function planeDistance(p: Vec3i, o: Vec3i, n: Vec3i): number {
  const dx = s16(p[0] - o[0]);
  const dy = s16(p[1] - o[1]);
  const dz = s16(p[2] - o[2]);
  const sum = (Math.imul(dx, n[0]) + Math.imul(dz, n[2]) + Math.imul(dy, n[1])) | 0;
  return s16(Math.trunc(sum / 0x2000));
}
