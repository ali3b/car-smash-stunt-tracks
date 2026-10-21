// One 20 Hz step of a player car: engine and gearbox, steering, grip, then motion (research/SPEC.md "Car physics").
import { cloneCarState, type CarParams, type CarState, type SimRules } from './car';
import { beginFrame, updateSpeed, updateSteering } from './engine';
import { updateGrip } from './grip';
import { updateMotion, type MotionEnv } from './motion';
import type { TrackSurface } from './surface';

/** The fixed simulation rate. */
export const STEP_HZ = 20;

export interface StepEvents {
  /** First crash of the car: 1 hit, 2 water, 3 finish (finish is raised by the race logic, not here). */
  onCrash?: (kind: number) => void;
  /** All four wheels left the ground. */
  onJump?: () => void;
}

export interface StepOptions extends StepEvents {
  /** The other car on the track, for car-to-car collisions (it can be changed by the impact too). */
  other?: MotionEnv['other'];
}

/**
 * Advance car `c` by one step in place. `input` is the frame's input byte: bit0 accelerate, bit1 brake, bit2 right,
 * bit3 left, bit4 shift up, bit5 shift down. A crashed car ignores the input and brakes.
 */
export function stepCar(
  c: CarState,
  p: CarParams,
  rules: SimRules,
  input: number,
  surface: TrackSurface,
  events: StepOptions = {},
): void {
  const used = beginFrame(c, input);
  updateSpeed(c, p, used);
  updateSteering(c, rules, used);
  updateGrip(c, p, (x, z) => surface.bankedCorner(x, z));
  const env: MotionEnv = { surface, onCrash: events.onCrash, onJump: events.onJump, other: events.other };
  updateMotion(c, p, env);
}

/** Pure variant of stepCar: returns the next state, leaves `c` untouched. */
export function step(
  c: CarState,
  p: CarParams,
  rules: SimRules,
  input: number,
  surface: TrackSurface,
  events: StepOptions = {},
): CarState {
  const n = cloneCarState(c);
  stepCar(n, p, rules, input, surface, events);
  return n;
}
