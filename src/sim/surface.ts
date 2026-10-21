// The contract between the car simulation (src/sim/step.ts) and the track geometry (src/sim/track-surface.ts).
// Two views of one lookup: TrackSampler (track-surface.ts: the detailed sample per point, heights, normals, surface
// names, walls) and TrackSurface (what the car step asks per wheel), built on it by createTrackProbe (probe.ts).
//
// The car asks one question per wheel per 20 Hz step: "what is under this point?". The answer is plain data in the
// simulation's integer units; the car code does all the arithmetic itself (height above the plane, moving along it,
// wall bounces), so that the integer rounding is identical whatever implements the track.
//
// Units (see research/SPEC.md §1 and "Car physics"):
//   - Points are in track units (shape units): 1 unit = 0.06096 m, a tile is 1024 units, x = east, y = up, z = north.
//     Car positions are kept in physics units (64 per track unit); the car probes at `pos >> 6` (16-bit values).
//   - Angles: 1024 per turn.
//   - Rotation matrices are 16-bit fixed point with 0x4000 (16384) = 1.0; plane normals use 0x2000 (8192) = 1.0.
// All numbers in this interface are integers. Implementations must be deterministic.

/** Wheel surface codes. They index the car's grip table (CarParams.surfaceGrip). */
export const SurfaceCode = {
  /** No usable surface (also what the car itself sets for a wheel in the air). */
  None: 0,
  Paved: 1,
  Dirt: 2,
  Ice: 3,
  /** Plain terrain next to the road (the default when no piece covers the point). */
  Ground: 4,
  /** Lake terrain: no grip; all four wheels in water ends the run. */
  Water: 5,
} as const;
export type SurfaceCode = (typeof SurfaceCode)[keyof typeof SurfaceCode];

export type Vec3i = [number, number, number];
export type Mat3i = [number, number, number, number, number, number, number, number, number];

/**
 * The (infinite) plane that holds the ground under a probed point. Each track piece is made of a few such planes
 * (flat road, ramp, banking, loop segments...); the probe picks the one that applies at the point.
 */
export interface SurfacePlane {
  /**
   * Identity of the plane (the same id must always mean the same orientation and origin). 0 is the flat ground at
   * height 0 (the car falls back to it when it is far below the plane it found).
   */
  id: number;
  /**
   * True for horizontal planes: then the height of a point above the plane is simply `y - origin[1]`. A horizontal
   * plane must also have normal [0, 0x2000, 0] and the identity matrix, so both ways give the same result.
   */
  flat: boolean;
  /** The plane's roll (about the z axis) and pitch (about the x axis), 1024 per turn. 0, 0 when horizontal. */
  roll: number;
  pitch: number;
  /** A point on the plane, world track units (tile offset and elevation already added). */
  origin: Vec3i;
  /**
   * Upward unit normal, **0x2000 = 1**. Height of point p above the plane = trunc(dot(p - origin, normal) / 0x2000)
   * (32-bit dot product).
   */
  normal: Vec3i;
  /**
   * Plane-to-world rotation, row-major 3×3, 0x4000 = 1 (identity when horizontal). Row vectors: a vector v in plane
   * coordinates (x across, y up out of the plane, z along) is v·M in world coordinates; world to plane is v·Mᵀ.
   */
  matrix: Mat3i;
}

/** A vertical wall the probed point may be hitting (road barriers, tunnel and pipe sides, bridge rails...). */
export interface SurfaceWall {
  /** Identity of the wall. */
  id: number;
  /** The wall's heading, 1024 per turn: the direction the wall line runs, as seen from above (0 = north). */
  angle: number;
  /** A point on the wall line, world track units (x, z). */
  x: number;
  z: number;
  /**
   * The wall exists for heights h with bottom < h < top, where h is the probed point's height above the plane of
   * this same probe (not world y).
   */
  bottom: number;
  top: number;
}

export interface SurfaceProbe {
  /** What the point sits on (grip, water). */
  surface: SurfaceCode;
  plane: SurfacePlane;
  /** The wall the point is checked against, or null when there is none. */
  wall: SurfaceWall | null;
  /**
   * True when `plane` is a raised deck (bridge, elevated road, ramp top) that can be driven under. A wheel more than
   * 12 units below such a plane both before and after its step is under the deck, not on it: the car falls back to
   * flat ground at `tileY` (or crashes when its roof is just under the deck). False for ordinary road and terrain.
   */
  elevated: boolean;
  /** Elevation of the tile's own flat ground (0, or the hill height on hill tiles; road decks add their thickness). */
  tileY: number;
}

export interface TrackSurface {
  /**
   * What is under (x, y, z)? Point in world track units (integers; x and z in 0..30719 on the map).
   * `prev` is where the same wheel was probed on the previous step (some pieces, e.g. split roads, decide by the
   * side the wheel comes from); it may equal the point. y matters for stacked geometry (a road under a bridge, the
   * inside of a loop or pipe): return the surface the point is on or just above. Off the map: flat ground at 0.
   */
  probe(x: number, y: number, z: number, prev: Vec3i): SurfaceProbe;
  /**
   * Is tile (tileX, tileZ) (0..29; x = east, z = north) covered by a banked wide corner (the 2×2 banked curve)?
   * A rolling car there gets extra turn from its roll. Multi-tile pieces count on every tile they cover.
   */
  bankedCorner(tileX: number, tileZ: number): boolean;
}

export const IDENTITY: Mat3i = [0x4000, 0, 0, 0, 0x4000, 0, 0, 0, 0x4000];

/** A horizontal plane at height `y`. */
export function flatPlane(y = 0, id = 0): SurfacePlane {
  return { id, flat: true, roll: 0, pitch: 0, origin: [0, y, 0], normal: [0, 0x2000, 0], matrix: IDENTITY };
}

/** The trivial track: endless flat ground of one surface, no walls. Used by tests and as a fallback. */
export function flatSurface(surface: SurfaceCode = SurfaceCode.Paved, y = 0): TrackSurface {
  const probe: SurfaceProbe = { surface, plane: flatPlane(y), wall: null, elevated: false, tileY: y };
  return { probe: () => probe, bankedCorner: () => false };
}

// ---- The detailed sample (src/sim/track-surface.ts) ------------------------------------------------------------
export type SurfaceType = 'paved' | 'dirt' | 'ice' | 'grass' | 'water';

/**
 * A wall the wheel may hit: a vertical line through (x, z) running along `angle` (1/1024 turn, the original's wall
 * orientation), active while the wheel's distance above the surface plane lies strictly between `low` and `high`.
 * The car code tests whether the wheel's previous and current positions lie on different sides of the line.
 */
export interface WallContact {
  /** Index in the wall table (src/sim/track-walls.ts). */
  index: number;
  angle: number;
  x: number;
  z: number;
  low: number;
  high: number;
}

export interface SurfaceSample {
  /**
   * The surface plane's height at (x, z): the y where `distance` is 0. For planes that overhang or stand vertical
   * (loop top, pipe walls) it is the plane's own y there (NaN when the plane is vertical); use `distance` for contact.
   */
  height: number;
  /** Unit plane normal in fixed point, length 8192 (1 << 13), pointing out of the surface (up on the road). */
  normal: [number, number, number];
  surface: SurfaceType;
  /** 'road' when a road (or pipe/loop/ramp) surface was hit, 'terrain' off the road, 'none' outside the 30x30 grid. */
  kind: 'road' | 'terrain' | 'none';
  walls?: WallContact[];

  // Exact data, in the original's integers, for a bit-faithful car step:
  /** Plane index (0..531) in the plane table. Planes 0..3 are the flat ground. */
  plane: number;
  /** Height added to the plane: 0 or 450 (plateau / hill top), +2 on a road surface, +0/+1 checkerboard bumps off-road. */
  baseHeight: number;
  /** The element centre the plane's origin is relative to. */
  centerX: number;
  centerZ: number;
  /** Wheel surface code: 1 paved, 2 dirt, 3 ice, 4 off-road ground, 5 water (indexes the car's grip table). */
  code: number;
  /** False where the deck/ramp/loop logic says the ground is not solid underneath (the original's "solid" flag). */
  solid: boolean;
  /** True inside a corkscrew (helix or roll) footprint. */
  corkscrew: boolean;
}

export interface TrackSampler {
  /**
   * The surface under the point. `prev` is the same wheel's position one frame earlier (the original decides some
   * cases, e.g. ramp and deck edges, from where the wheel came from); it defaults to the point itself. `mode` is the
   * game's input mode: 0 before the start (cars on the start platform), 1 racing (default), 2 forces flat ground.
   */
  surfaceAt(x: number, y: number, z: number, prev?: readonly [number, number, number], mode?: number): SurfaceSample;
  /** Signed distance of a point above the sample's plane, in track units, exactly as the original computes it. */
  distance(sample: SurfaceSample, x: number, y: number, z: number): number;
}
