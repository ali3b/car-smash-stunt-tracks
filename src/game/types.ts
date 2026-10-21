// The integration points between the game flow (src/game, src/ui) and the other lanes:
//   SIM    provides a RaceSession (the deterministic 20 Hz race: player car, optional opponent, checkpoints, penalties)
//          and a ReplayPlayer (plays a recorded input stream back, with seeking).
//   RENDER provides a RaceView (the 3D race: track, cars, cameras incl. the in-car dashboard).
// Until they register their own (src/game/integrations.ts), the flow runs the stubs in src/game/stub-*.ts: a
// kinematic car that follows the road centre, and a plain three.js view with a chase / cockpit / TV camera.
//
// Coordinates in snapshots are the renderer's: metres, x east, y up, -z north (src/track/types.ts).
import type * as THREE from 'three';
import type { TrackFile } from '../track/types';
import type { CarSound } from './car-sound';

/** Simulation steps per second. Replays are one input byte per step. */
export const SIM_HZ = 20;
export const SIM_DT = 1 / SIM_HZ;

export type Gearbox = 'auto' | 'manual';

/** What the player picked before a race. Ids are from src/game/catalog.ts and src/track/tracks/index.ts. */
export interface RaceSetup {
  trackId: string;
  track: TrackFile;
  /** A car id (= its model name in ssg.models.json, e.g. 'car-rally'). */
  carId: string;
  /** Paint variant name (KHR_materials_variants), or null for the model's own look. */
  paint: string | null;
  /** null = a solo time trial. */
  opponentId: string | null;
  gearbox: Gearbox;
}

/** One car at one simulation step. */
export interface CarState {
  /** World position of the car's axle centre (metres). */
  pos: [number, number, number];
  /** Orientation as a quaternion [x, y, z, w]; the car's nose is its local +Z. */
  quat: [number, number, number, number];
  speedMph: number;
  /** 0 = neutral, -1 = reverse, 1..n forward gears. */
  gear: number;
  /** Engine speed 0..1 of the rev range (tacho, audio). */
  rpm: number;
  /** All wheels off the road. */
  airborne: boolean;
  /** Wrecked (stops the race for this car). */
  crashed: boolean;
  /** Steering angle -1..1 (wheel and dashboard animation). */
  steer: number;
  /** What the car sounds like at this step (src/game/car-sound.ts); absent on the stub session. */
  sound?: CarSound;
}

export interface Progress {
  /** Checkpoints passed in order, 0..checkpoints. */
  checkpoint: number;
  checkpoints: number;
  /** 0..1 along the lap. */
  fraction: number;
}

/** The race at one simulation step: what the HUD and the view draw. */
export interface RaceSnapshot {
  tick: number;
  /** Race time in seconds (tick / SIM_HZ, from the start signal). */
  time: number;
  player: CarState;
  opponent: CarState | null;
  progress: Progress;
  opponentProgress: Progress | null;
  /** The player is driving against the course. */
  wrongWay: boolean;
  /** Penalty seconds so far (missed checkpoints, cut corners). */
  penaltySeconds: number;
  /** A one-off event at this step for the HUD ('PENALTY +5 S', 'CHECKPOINT', 'JUMP!'), else null. */
  event: string | null;
  finished: boolean;
  opponentFinished: boolean;
}

export interface RaceResult {
  trackId: string;
  carId: string;
  opponentId: string | null;
  /** Driven time (s), without penalties. */
  timeSeconds: number;
  penaltySeconds: number;
  /** time + penalties: the high-score time. */
  totalSeconds: number;
  topSpeedMph: number;
  jumps: number;
  distanceM: number;
  /** Crossed the finish (false = wrecked or gave up). */
  finished: boolean;
  crashed: boolean;
  opponentTotalSeconds: number | null;
  /** vs an opponent: who won (null in a time trial). */
  won: boolean | null;
}

/**
 * The deterministic race (SIM lane). One step = 1 / SIM_HZ s. Input is the original-style input byte
 * (src/sim/input.ts encodeInputByte). The same setup and input bytes always give the same race.
 */
export interface RaceSession {
  start(setup: RaceSetup): void;
  step(input: number): RaceSnapshot;
  snapshot(): RaceSnapshot;
  /** Set once the race is over (finished, crashed or over the time limit). */
  result(): RaceResult | null;
  /** Every input byte so far, one per step (the replay). */
  inputs(): Uint8Array;
  /** The input byte a built-in driver would give the player's car now (demo race, test autopilot). Optional. */
  autopilotInput?(): number;
}

/** A recorded race: the setup ids plus the input stream. */
export interface ReplayData {
  version: 1;
  trackId: string;
  carId: string;
  paint: string | null;
  opponentId: string | null;
  gearbox: Gearbox;
  /** One byte per step. */
  inputs: Uint8Array;
}

/** Plays a replay back (SIM lane); the VCR overlay drives it. */
export interface ReplayPlayer {
  load(replay: ReplayData, track: TrackFile): void;
  /** Steps in the replay. */
  readonly length: number;
  /** Current step 0..length. */
  readonly tick: number;
  readonly playing: boolean;
  /** Playback rate: 1 normal, 4 fast forward, -4 rewind. */
  speed: number;
  play(): void;
  pause(): void;
  seek(tick: number): void;
  /** Advance by real seconds × speed (called every frame). */
  update(dt: number): void;
  /** The two steps around the playback position and how far between them it is (for interpolation). */
  frame(): { prev: RaceSnapshot; next: RaceSnapshot; alpha: number };
  /** The race's result at the end of the replay. */
  result(): RaceResult | null;
}

export type CameraMode = 'cockpit' | 'chase' | 'tv' | 'orbit';

/** The 3D race (RENDER lane). Created per race; the renderer is shared. */
export interface RaceView {
  init(setup: RaceSetup): Promise<void>;
  /** Draw between two consecutive snapshots (alpha 0..1); dt = real seconds since the last frame. */
  update(prev: RaceSnapshot, next: RaceSnapshot, alpha: number, dt: number): void;
  readonly cameras: readonly CameraMode[];
  camera: CameraMode;
  render(renderer: THREE.WebGLRenderer): void;
  resize(width: number, height: number): void;
  dispose(): void;
  /** Where the sound is heard from: the camera drawing the race (stereo position and distance of the cars). */
  listener?(): THREE.Object3D | null;
}
