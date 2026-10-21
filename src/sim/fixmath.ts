// Fixed-point helpers with the 1990 original's integer behaviour (research/SPEC.md "Track surfaces", "Fixed-point
// helpers"). Angles are 1024 per turn; sines and matrices are scaled by 16384 (1 << 14). The tables are computed
// here from their definitions (rounded sine / arctangent); tests check them against the original's own tables.

/** sin(i/1024 turn) * 16384, rounded, for i = 0..256 (one quadrant). */
const SIN_Q: Int16Array = (() => {
  const t = new Int16Array(257);
  for (let i = 0; i <= 256; i++) t[i] = Math.round(16384 * Math.sin((i * Math.PI) / 512));
  return t;
})();

/** atan(i/256) in 1/1024 turn, rounded, for i = 0..256 (0..128). */
const ATAN_Q: Uint8Array = (() => {
  const t = new Uint8Array(257);
  for (let i = 0; i <= 256; i++) t[i] = Math.round((Math.atan(i / 256) * 512) / Math.PI);
  return t;
})();

/** The quadrant sine table (exported for tests). */
export const sinQuadrant = (): Int16Array => SIN_Q;
/** The octant arctangent table (exported for tests). */
export const atanOctant = (): Uint8Array => ATAN_Q;

/** Wrap to a signed 16-bit value. */
export const i16 = (v: number): number => ((v << 16) >> 16);

/** sin(a) * 16384 for an angle in 1/1024 turn (any integer; only the low 10 bits count). */
export function sin16(a: number): number {
  const i = a & 0xff;
  switch ((a >> 8) & 3) {
    case 0: return SIN_Q[i];
    case 1: return SIN_Q[256 - i];
    case 2: return -SIN_Q[i];
    default: return -SIN_Q[256 - i];
  }
}

/** cos(a) * 16384. */
export const cos16 = (a: number): number => sin16(a + 256);

/** a * b / 16384, rounded half up (two's complement), as the original's scaled multiply; 16-bit result. */
export function mulScale(a: number, b: number): number {
  const v = (Math.imul(a, b) * 4) | 0; // the 32-bit product shifted left twice, wrapping like the original
  return i16((v >> 16) + ((v >> 15) & 1));
}

/** Signed 32-bit division truncating towards zero (the C runtime's long division). */
export const ldiv = (a: number, b: number): number => Math.trunc(a / b) | 0;

/**
 * The angle of the vector (a, b) measured from the +b axis towards +a, in 1/1024 turn, range -512..512
 * (i.e. atan2(a, b)), with the original's table lookup and rounding.
 */
export function polarAngle(a: number, b: number): number {
  let flags = 0;
  let p = a;
  let q = b;
  if (p < 0) { flags |= 8; p = -p; }
  if (q < 0) { flags |= 4; q = -q; }
  let t: number;
  if (p === q) {
    if (p === 0) return 0;
    t = 128;
  } else {
    if (p > q) { [p, q] = [q, p]; flags |= 2; }
    const ratio = Math.floor((p * 65536) / q); // 0..65535
    t = ATAN_Q[(ratio + 0x80) >> 8];
  }
  switch (flags) {
    case 0: return t;
    case 2: return 256 - t;
    case 4: return 512 - t;
    case 6: return 256 + t;
    case 8: return -t;
    case 10: return t - 256;
    case 12: return t - 512;
    default: return -(t + 256);
  }
}

/** The length of (a, b) as the original measures it: through the angle, |b| / cos or |a| / sin (truncated). */
export function polarRadius2D(a: number, b: number): number {
  let ang = Math.abs(polarAngle(a, b));
  if (ang >= 256) ang = 512 - ang;
  if (ang <= 128) return Math.floor((Math.abs(b) * 16384) / cos16(ang)) & 0xffff;
  return Math.floor((Math.abs(a) * 16384) / sin16(ang)) & 0xffff;
}
