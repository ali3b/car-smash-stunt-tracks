// Public API of the car simulation (20 Hz, deterministic integer maths). See research/SPEC.md "Car physics".
export { createCarState, cloneCarState, type CarParams, type CarState, type SimRules, type Vec3 } from './car';
export { INPUT_ACCEL, INPUT_BRAKE, INPUT_LEFT, INPUT_RIGHT, INPUT_SHIFT_DOWN, INPUT_SHIFT_UP, MAX_SPEED } from './engine';
export { CRASH_FINISH, CRASH_HIT, CRASH_HIT_STOP, CRASH_WATER, crash } from './motion';
export { STEP_HZ, step, stepCar, type StepEvents, type StepOptions } from './step';
export {
  SurfaceCode,
  flatPlane,
  flatSurface,
  type SurfacePlane,
  type SurfaceProbe,
  type SurfaceWall,
  type TrackSurface,
} from './surface';
export { DEFAULT_RULES, SPORTS_COUPE } from './tunings';
export { createTrackProbe, type TrackProbe } from './probe';
export { createTrackSurface } from './track-surface';
export type { SurfaceSample, SurfaceType, TrackSampler, WallContact } from './surface';
export {
  BASE_PROFILE,
  RouteDriver,
  SPEED_SLOTS,
  SpeedClass,
  createOpponent,
  gridOffsets,
  stepOpponent,
  type OpponentDriver,
  type OpponentMemory,
  type OpponentProfile,
  type OpponentRoute,
  type OpponentStart,
  type RouteWaypoint,
} from './opponent';
export { buildRoute, gridStarts } from './opponent-route';
export { OPPONENT_PROFILES, RIVALS_BY_NERVE, opponentProfile } from './opponents';
