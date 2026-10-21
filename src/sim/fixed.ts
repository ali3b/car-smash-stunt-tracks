// Integer arithmetic with the semantics of a 16-bit machine: values wrap at 16 or 32 bits, divisions truncate
// toward zero, shifts of signed values are arithmetic. Every helper takes and returns plain JS numbers holding
// integers; the suffix says which width the result is wrapped to.

/** Wrap to signed 16 bits. */
export const s16 = (v: number): number => (v << 16) >> 16;
/** Wrap to unsigned 16 bits. */
export const u16 = (v: number): number => v & 0xffff;
/** Wrap to signed 8 bits. */
export const s8 = (v: number): number => (v << 24) >> 24;
/** Wrap to unsigned 8 bits. */
export const u8 = (v: number): number => v & 0xff;
/** Wrap to signed 32 bits. */
export const s32 = (v: number): number => v | 0;
/** Wrap to unsigned 32 bits. */
export const u32 = (v: number): number => v >>> 0;

/** Signed division truncating toward zero (as the CPU's idiv). Division by zero returns 0 (never relied on). */
export const idiv = (a: number, b: number): number => (b === 0 ? 0 : Math.trunc(a / b));

/** Signed 16-bit value divided by 2^n, truncating toward zero (|x| >> n with the sign put back). */
export const sdivPow2 = (v: number, n: number): number => (v < 0 ? -(-v >> n) : v >> n);

/** 32-bit signed product, exact (Math.imul wraps like the 32-bit multiply helpers do). */
export const mul32 = (a: number, b: number): number => Math.imul(a, b);

/** Absolute value of a number wrapped to signed 16 bits (wrapping: abs(-32768) = -32768). */
export const abs16 = (v: number): number => {
  const x = s16(v);
  return s16(x < 0 ? -x : x);
};

/**
 * 1.14 fixed-point multiply with rounding: (a * b + 0x2000) >> 14 on the signed 32-bit product, wrapped to 16 bits.
 * Both factors are signed 16-bit values.
 */
export const fmul14 = (a: number, b: number): number => s16((Math.imul(s16(a), s16(b)) + 0x2000) >> 14);

/** Angles: 1024 per turn. Sine quarter table, 257 entries, 0x4000 = 1.0, round-to-nearest of the true sine. */
const SIN_Q: Int16Array = (() => {
  const t = new Int16Array(257);
  for (let i = 0; i <= 256; i++) t[i] = Math.round(Math.sin((i * Math.PI) / 512) * 0x4000);
  return t;
})();

/** sin(angle) * 0x4000 for an angle in 1024ths of a turn (any integer; only the low 10 bits count). */
export function sin1024(angle: number): number {
  const q = (angle >> 8) & 3;
  const i = angle & 0xff;
  switch (q) {
    case 0:
      return SIN_Q[i];
    case 1:
      return SIN_Q[256 - i];
    case 2:
      return -SIN_Q[i];
    default:
      return -SIN_Q[256 - i];
  }
}

/** cos(angle) * 0x4000, 1024ths of a turn. */
export const cos1024 = (angle: number): number => sin1024(angle + 0x100);
