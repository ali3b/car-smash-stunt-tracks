// One frame of driver input. The simulation consumes exactly this per fixed step, so replays are input streams.
export interface CarInput {
  /** 0..1 */
  throttle: number;
  /** 0..1: brakes while rolling forward, reverses once stopped. */
  brake: number;
  /** -1 (left) .. 1 (right) */
  steer: number;
  /** Held: the gear-change button (manual gearbox: with throttle = up, with brake = down). */
  shift: boolean;
}

// ---- The original-style input byte (one per 20 Hz step; replays are streams of these) -------------------------------
export const INPUT_ACCEL = 1 << 0;
export const INPUT_BRAKE = 1 << 1;
export const INPUT_RIGHT = 1 << 2;
export const INPUT_LEFT = 1 << 3;
export const INPUT_SHIFT_UP = 1 << 4;
export const INPUT_SHIFT_DOWN = 1 << 5;

/**
 * CarInput → input byte. Analog values count as pressed past half way. The shift button held with the throttle is a
 * shift up, with the brake a shift down (the throttle / brake bits stay set too; the simulation decides what a
 * manual-gearbox shift does to them, and an automatic gearbox ignores the shift bits).
 */
export function encodeInputByte(i: CarInput): number {
  let b = 0;
  const accel = i.throttle > 0.5;
  const brake = i.brake > 0.5;
  if (accel) b |= INPUT_ACCEL;
  if (brake) b |= INPUT_BRAKE;
  if (i.steer > 0.5) b |= INPUT_RIGHT;
  if (i.steer < -0.5) b |= INPUT_LEFT;
  if (i.shift && accel) b |= INPUT_SHIFT_UP;
  if (i.shift && brake) b |= INPUT_SHIFT_DOWN;
  return b;
}
