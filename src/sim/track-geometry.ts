// Shape dimensions of the pieces whose drivable surface is not a single plane or a circle. All values are track
// units in the piece's own frame (rot 0, origin at the centre of its footprint, z towards the exit). The surface
// rules (track-surface.ts) and the plane and wall tables (track-planes.ts, track-walls.ts) are computed from these.
// research/SPEC.md "Track surfaces" explains each shape; tests/surface-tables.test.ts checks the values against the
// local copy of the original.

/**
 * Highway entry: a single 240-wide road widening into the divided highway. Along z (breakpoints), the road's half
 * width grows by 48 per sixth of the tile from 120 to 360, and the raised median (24 high) opens from nothing at
 * z = 168 to its full 120 half width at z = 334. 1000 is a sentinel past the tile edge.
 */
export const HIGHWAY_ENTRY = {
  z: [-512, -334, -168, 0, 168, 334, 1000],
  inner: [0, 0, 0, 0, 0, 120, 120],
  outer: [120, 168, 216, 264, 312, 360, 360],
} as const;

/** The divided highway's raised median. */
export const MEDIAN_HEIGHT = 24;

/**
 * The loop (1x2 tiles, centred on the shared edge). Its section along z is a polygon through these (z, y) points,
 * climbing on the far side (z > 0) and coming down on the near side (z < 0): 449 deep, 975 high. The 400-wide lane
 * starts at x = -400..0 and drifts sideways by laneX per segment until it is centred at -200 on top, so the car leaves
 * the loop at x = 0..400. `top` is the depth of the loop, `half` the height of its widest point.
 */
export const LOOP = {
  profileZ: [0, 224, 389, 449, 389, 224, 0],
  profileY: [0, 135, 299, 524, 749, 914, 975],
  /** The section as the faces are built (the vertex at y = 914 sits one unit deeper, at 225). */
  planeProfile: [[0, 0], [224, 135], [389, 299], [449, 524], [389, 749], [225, 914], [0, 975]] as const,
  laneX: [-400, -400, -352, -304, -270, -235, -200],
  top: 449,
  half: 524,
  /** The flat road on either side of the loop: bending from the loop's lane (0..400 at v = 0) back to the centre line. */
  approach: {
    at: [0, 178, 360, 536, 704, 868, 2000],
    left: [0, -20, -40, -60, -80, -100, -120],
    right: [400, 361, 320, 276, 226, 174, 120],
  },
} as const;

/**
 * The pipe: a 12-sided section, 230 wide and 235 high (inside), with a flat floor 62 wide. Faces are numbered
 * 0..11 going round from the floor centre towards -x, up the -x wall, over the roof and down the +x wall.
 * `bump`: the obstacle in the pipe-obstacle piece, a raised block in the floor.
 */
export const PIPE = {
  /** x of the section's corners on the floor/roof (|x| < 31 is the floor centre, 84 the next corner, 115 the wall). */
  x: [31, 84, 115],
  /** y of the section's corners: floor 0, 35, 88 (wall foot), 151 (wall top), 204, 235 (roof). */
  y: [0, 35, 88, 151, 204, 235],
  bumpHalfWidth: 84,
  bumpHalfLength: 75,
  bumpHeight: 35,
  /** The pipe entry's faces run from z = -517 (flat) to 517 (pipe section), a little past the tile edges. */
  entryHalfLength: 517,
} as const;

/**
 * The roll corkscrew (1x2 tiles, 2048 long) turns the pipe section once around the road's axis: pipe face k is
 * drivable from z = -1024 * k / 11 (rounded away from the middle) to z = 1024 - 1024 * (k - 1) / 11.
 */
export const ROLL = (() => {
  const from = [0];
  const to = [0];
  for (let k = 1; k <= 11; k++) {
    from.push(-Math.ceil((1024 * k) / 11));
    to.push(1024 - Math.floor((1024 * (k - 1)) / 11));
  }
  return { from, to } as const;
})();

/**
 * Bank entries: the road twists from flat to the bank over one tile, in four segments between z = -334 and 334
 * (flat before, banked after). Each segment is split into two triangles by a diagonal at angle split (1/1024 turn).
 */
export const BANK_ENTRY = {
  z: [-334, -168, 0, 168, 334],
  segmentCentres: [-251, -84, 84, 251],
  /** Height of the rising edge at each z: it reaches 123 at z = 334 and the full bank (130) at z = fullAt. */
  rise: [0, 40, 76, 105, 123],
  fullAt: 517,
  /** Diagonal angle for the bank rising to -x ("a") and to +x ("b"). */
  splitA: -672,
  splitB: 160,
} as const;
