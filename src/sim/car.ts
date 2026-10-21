// Car state and car parameters of the 20 Hz simulation. See research/SPEC.md "Car physics" for the behaviour.
//
// Units: positions in physics units (64 per track unit, 65536 per tile), angles 1024 per turn, speeds 256 per mph
// (unsigned 16 bit), rpm in revolutions per minute. All fields hold integers and wrap like the 16/32-bit originals.

export type Vec3 = [number, number, number];

/** One car's tuning. Our own cars ship their own values; tests build these from the original's car files. */
export interface CarParams {
  /** Highest gear (1-based; 5 or 6). */
  gears: number;
  /** Divides the drive force: heavier cars accelerate slower. */
  mass: number;
  /** Speed lost per frame while braking (256 = 1 mph per frame). */
  braking: number;
  idleRpm: number;
  /** Automatic gearbox: shift down below this rpm, up above upshiftRpm. */
  downshiftRpm: number;
  upshiftRpm: number;
  /** Rev limit. */
  maxRpm: number;
  /** Gear ratios, index 0 = neutral (0): rpm = speed * ratio >> 16. Length gears + 1 (or more). */
  gearRatios: number[];
  /** Gear-stick knob position per gear (index 0 = neutral), for the shift animation. */
  knobPoints: [number, number][];
  /** Aerodynamic drag coefficient: drag(speed) = aero * (speed >> 10)^2 / 512. */
  aero: number;
  /** Torque used in first gear at low rpm instead of the curve. */
  launchTorque: number;
  /** Torque per 128 rpm (index rpm >> 7). */
  torque: number[];
  /** Grip of the tyres (scaled by the surface factors). */
  grip: number;
  /** Grip factor per wheel surface code (0 none, 1 paved, 2 dirt, 3 ice, 4 ground, 5 water); 256 = full. */
  surfaceGrip: number[];
  /** Collision box: half width, height, half length, bounding radius (track units). */
  box: [number, number, number, number];
  /** Wheel positions in the car frame (track units): front-left, front-right, rear-right, rear-left. */
  wheels: [Vec3, Vec3, Vec3, Vec3];
}

/** Game-wide tables of the simulation (the same for every car). */
export interface SimRules {
  /**
   * Steering rate per speed band (speed >> 12, 16 bands): how far the steering moves per frame while a steering
   * key is held; with no key it returns to centre at the same rate. Slow cars steer fast.
   */
  steerRate: number[];
}

/** The car's whole simulation state (one per car). */
export interface CarState {
  /** Position (physics units). */
  pos: Vec3;
  /** Position before the last step. */
  prevPos: Vec3;
  /** Yaw, pitch, roll (1024 per turn). */
  yaw: number;
  pitch: number;
  roll: number;
  /** Slope force on the speed (positive downhill), from the car's pitch. */
  slopeForce: number;
  /** Steering position, -240..240 (positive = right). */
  steering: number;
  rpm: number;
  lastRpm: number;
  idleRpm: number;
  /** speed2 change over the last step. */
  speedDelta: number;
  /** Wheel speed (engine side), 256 per mph, unsigned 16 bit. */
  speed: number;
  /** Ground speed of the car, 256 per mph. */
  speed2: number;
  lastSpeed: number;
  /** Ratio of the engaged gear (0 while the clutch is out during a shift). */
  gearRatio: number;
  /** Gear-stick knob (dashboard) and its target while shifting. */
  knobX: number;
  knobY: number;
  knobTargetX: number;
  knobTargetY: number;
  /** Slide angle: the car's direction of travel minus its heading while it slides (1024 per turn). */
  slideAngle: number;
  /** Spin rate while sliding (per frame, subtracted from slideAngle). */
  spin: number;
  /** Yaw change this step from steering (before the motion step). */
  turn: number;
  /** Excess lateral demand while sliding (temporary of the grip step). */
  slip: number;
  /** Grip demanded by the current turn and speed, and grip available from the wheels' surfaces. */
  demandedGrip: number;
  availableGrip: number;
  /** Fields 0x46 / 0x48 of the original: track path progress (owned by the race logic). */
  pathByte: number;
  pathIndex: number;
  /** Per-wheel suspension/contact words (fields 0x4a..0x71 of the original; meaning being worked out). */
  wheelA: number[];
  wheelB: number[];
  wheelC: number[];
  wheelD: number[];
  wheelE: number[];
  /** Wheel positions in the world (track units) after the last step. */
  wheelWorld: Vec3[];
  /** Three vectors at 0x8a..0x9b and three words 0x9c..0xa1 (path / camera bookkeeping). */
  vecA: Vec3;
  vecB: Vec3;
  vecC: Vec3;
  w9c: number;
  w9e: number;
  wA0: number;
  braking: boolean;
  accelerating: boolean;
  gear: number;
  /** Number of front / rear / all wheels touching ground (×2 per wheel in the original: 0, 2, 4 / 0..8). */
  surfFront: number;
  surfRear: number;
  surfAll: number;
  /** Surface code under each wheel. */
  wheelSurface: [number, number, number, number];
  /** Frames left in which the engine limiter / wheel-spin blend is active. */
  limiterTimer: number;
  sliding: boolean;
  fieldAE: number;
  /** 0 driving, 1 crashed, 2 ?, 3 finished. */
  crash: number;
  shifting: boolean;
  /** Frames since the last shift started (counts down from 30 after the knob arrives). */
  shiftTimer: number;
  /** 0 manual, 1 automatic. */
  automatic: boolean;
  fieldB3: number;
  fieldB4: number;
  /** Sound-event flags (bit1 skid on paved, bit2 skid elsewhere, bit4 hit ...). */
  soundFlags: number;
  /**
   * Height of each wheel above the ground at the last motion step. Not part of the original's car record: there it
   * is a stack value that keeps its old contents when a wheel is not measured in a step (all four wall retries
   * spent); keeping the last value reproduces that.
   */
  wheelHeight: number[];
}

/** A car at rest at `pos` (physics units) heading `yaw`, in first gear, as the original's init does. */
export function createCarState(p: CarParams, pos: Vec3, yaw: number, automatic: boolean): CarState {
  return {
    pos: [pos[0], pos[1] + 0x200, pos[2]],
    prevPos: [pos[0], pos[1], pos[2]],
    yaw,
    pitch: 0,
    roll: 0,
    slopeForce: 0,
    steering: 0,
    rpm: p.idleRpm,
    lastRpm: p.idleRpm,
    idleRpm: p.idleRpm,
    speedDelta: 0,
    speed: 0,
    speed2: 0,
    lastSpeed: 0,
    gearRatio: p.gearRatios[1],
    knobX: p.knobPoints[1][0],
    knobY: p.knobPoints[1][1],
    knobTargetX: p.knobPoints[1][0],
    knobTargetY: p.knobPoints[1][1],
    slideAngle: 0,
    spin: 0,
    turn: 0,
    slip: 0,
    demandedGrip: 0,
    availableGrip: 1000,
    pathByte: 0,
    pathIndex: 0,
    wheelA: [0, 0, 0, 0],
    wheelB: [0, 0, 0, 0],
    wheelC: [0, 0, 0, 0],
    wheelD: [0, 0, 0, 0],
    wheelE: [0, 0, 0, 0],
    wheelWorld: [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ],
    vecA: [0, 0, 0],
    vecB: [0, 0, 0],
    vecC: [0, 0, 0],
    w9c: 0,
    w9e: 0,
    wA0: 0,
    braking: false,
    accelerating: false,
    gear: 1,
    surfFront: 2,
    surfRear: 2,
    surfAll: 4,
    wheelSurface: [1, 1, 1, 1],
    limiterTimer: 0,
    sliding: false,
    fieldAE: 0,
    crash: 0,
    shifting: false,
    shiftTimer: 0,
    automatic,
    fieldB3: 0,
    fieldB4: 0,
    soundFlags: 1,
    wheelHeight: [0, 0, 0, 0],
  };
}

export function cloneCarState(s: CarState): CarState {
  return {
    ...s,
    pos: [...s.pos],
    prevPos: [...s.prevPos],
    wheelA: [...s.wheelA],
    wheelB: [...s.wheelB],
    wheelC: [...s.wheelC],
    wheelD: [...s.wheelD],
    wheelE: [...s.wheelE],
    wheelWorld: s.wheelWorld.map((w) => [...w] as Vec3),
    vecA: [...s.vecA],
    vecB: [...s.vecB],
    vecC: [...s.vecC],
    wheelSurface: [...s.wheelSurface],
    wheelHeight: [...s.wheelHeight],
  };
}
