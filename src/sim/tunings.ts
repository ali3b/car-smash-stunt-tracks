// Our own car tunings and simulation rules (not taken from the original's files). Every car of the line-up
// (ssg.models.json car-*) is built by `tune` from a handful of plain numbers: gear speeds, torque, weight, drag,
// grip per surface. tests/sim-tunings.test.ts drives each on flat ground and checks it stays in sensible ranges and
// that the cars differ.
import type { CarParams, SimRules } from './car';

/** Steering rate per speed band: 8 at a standstill, decaying by ~14% per 16 mph band, at least 1. */
export const DEFAULT_RULES: SimRules = {
  steerRate: Array.from({ length: 16 }, (_, band) => Math.max(1, Math.round(8 * Math.pow(0.86, band)))),
};

/** A torque curve with a broad mid-range hump, one value per 128 rpm, zero past the rev limit. */
function torqueCurve(peak: number, peakRpm: number, maxRpm: number, flat = 0.55): number[] {
  return Array.from({ length: 104 }, (_, i) => {
    const rpm = i * 128;
    if (rpm > maxRpm) return 0;
    const x = (rpm - peakRpm) / peakRpm;
    return Math.max(10, Math.min(255, Math.round(peak * (1 - flat * x * x))));
  });
}

/** Gear-stick gates of an H pattern: odd gears up, even gears down, a column per pair (6-pixel grid). */
function hPattern(gears: number): [number, number][] {
  const out: [number, number][] = [[10, 30]];
  for (let g = 1; g <= gears; g++) out.push([10 + 12 * Math.floor(g / 2), g % 2 ? 12 : 48]);
  out.push([0, 0]);
  return out;
}

export interface TuningSpec {
  gears: number;
  /** Road speed at the rev limit in first and in top gear (mph); the gears in between are spaced geometrically. */
  firstMph: number;
  topMph: number;
  idleRpm: number;
  maxRpm: number;
  peakTorque: number;
  peakRpm: number;
  /** 0..1: how peaky the torque curve is (larger = narrower hump). */
  peakiness?: number;
  /** Torque off the line in first gear (wheelspin when high). */
  launchTorque: number;
  mass: number;
  /** Speed lost per braking frame (256 = 1 mph). */
  braking: number;
  aero: number;
  grip: number;
  /** Grip factor per surface: paved, dirt, ice, ground (plain terrain). 256 = full. */
  surfaces: [number, number, number, number];
  /** Body half width, height, half length (track units); wheel track and base follow. */
  body: [number, number, number];
}

/** CarParams from a spec. */
export function tune(s: TuningSpec): CarParams {
  const ratios = [0];
  for (let g = 1; g <= s.gears; g++) {
    const mph = s.gears === 1 ? s.topMph : s.firstMph * Math.pow(s.topMph / s.firstMph, (g - 1) / (s.gears - 1));
    // rpm = speed * ratio >> 16 with speed in 1/256 mph: ratio = rpm * 256 / mph.
    ratios.push(Math.min(0xffff, Math.round((s.maxRpm * 256) / mph)));
  }
  ratios.push(0);
  const [hw, h, hl] = s.body;
  const wx = (hw - 3) * 64;
  const wz = Math.round(hl * 0.58) * 64;
  return {
    gears: s.gears,
    mass: s.mass,
    braking: s.braking,
    idleRpm: s.idleRpm,
    downshiftRpm: Math.round(s.maxRpm * 0.5),
    upshiftRpm: Math.round(s.maxRpm * 0.95),
    maxRpm: s.maxRpm,
    gearRatios: ratios,
    knobPoints: hPattern(s.gears),
    aero: s.aero,
    launchTorque: s.launchTorque,
    torque: torqueCurve(s.peakTorque, s.peakRpm, s.maxRpm, s.peakiness),
    grip: s.grip,
    surfaceGrip: [0, ...s.surfaces, 0],
    box: [hw, h, hl, Math.ceil(Math.hypot(hw, hl)) + 4],
    wheels: [
      [-wx, 0, wz],
      [wx, 0, wz],
      [wx, 0, -wz],
      [-wx, 0, -wz],
    ],
  };
}

/** The tuning specs of the eight cars, by car id. */
export const CAR_SPECS: Record<string, TuningSpec> = {
  // Stubby rally hatch: short quick gears, grippy on dirt and decent on ice.
  'car-rally': {
    gears: 5, firstMph: 36, topMph: 130, idleRpm: 900, maxRpm: 7500, peakTorque: 40, peakRpm: 5000, launchTorque: 34,
    mass: 26, braking: 240, aero: 30, grip: 225, surfaces: [250, 212, 110, 170], body: [16, 17, 44],
  },
  // Touring saloon: balanced, a little heavy.
  'car-touring': {
    gears: 6, firstMph: 40, topMph: 145, idleRpm: 850, maxRpm: 7200, peakTorque: 42, peakRpm: 4800, launchTorque: 34,
    mass: 30, braking: 250, aero: 27, grip: 225, surfaces: [256, 190, 80, 140], body: [18, 18, 52],
  },
  // Open-wheeler: the fastest, very light and grippy on tarmac, hopeless off it, twitchy at the limit.
  'car-openwheeler': {
    gears: 6, firstMph: 52, topMph: 205, idleRpm: 1500, maxRpm: 11500, peakTorque: 36, peakRpm: 9500, peakiness: 0.8,
    launchTorque: 26, mass: 19, braking: 300, aero: 17, grip: 265, surfaces: [256, 130, 45, 80], body: [17, 12, 54],
  },
  // Stock car: heavy, big V8, tall gears, high top speed, slides on anything loose.
  'car-stock': {
    gears: 4, firstMph: 62, topMph: 185, idleRpm: 800, maxRpm: 7000, peakTorque: 60, peakRpm: 4400, launchTorque: 46,
    mass: 38, braking: 220, aero: 20, grip: 210, surfaces: [256, 170, 60, 120], body: [20, 19, 58],
  },
  // Pre-war roadster: tall gears and a lazy start, but it runs on to jump speed given a long straight; soft brakes and
  // thin tyres make it the slowest round a lap.
  'car-vintage': {
    gears: 4, firstMph: 44, topMph: 126, idleRpm: 600, maxRpm: 5200, peakTorque: 50, peakRpm: 4200, peakiness: 0.5,
    launchTorque: 18, mass: 28, braking: 160, aero: 24, grip: 185, surfaces: [256, 210, 100, 170], body: [17, 20, 48],
  },
  // Supercar: fast and powerful, wide tyres for tarmac.
  'car-super': {
    gears: 7, firstMph: 46, topMph: 200, idleRpm: 1000, maxRpm: 8500, peakTorque: 50, peakRpm: 6200, launchTorque: 38,
    mass: 30, braking: 290, aero: 18, grip: 250, surfaces: [256, 160, 60, 110], body: [20, 15, 54],
  },
  // Dune buggy: tiny and light, the best on dirt and ice; on tarmac it slides and its short-shifting engine pulls
  // hard only near the top of its range (enough for the jumps on a long straight).
  'car-buggy': {
    gears: 4, firstMph: 44, topMph: 124, idleRpm: 1000, maxRpm: 7000, peakTorque: 28, peakRpm: 5800, peakiness: 0.6,
    launchTorque: 16, mass: 17, braking: 230, aero: 26, grip: 194, surfaces: [180, 256, 175, 220], body: [15, 18, 46],
  },
  // Street muscle: huge torque off the line (wheelspin), so-so brakes, wallows in corners.
  'car-sr-muscle': {
    gears: 4, firstMph: 48, topMph: 165, idleRpm: 700, maxRpm: 6400, peakTorque: 66, peakRpm: 3600, launchTorque: 64,
    mass: 36, braking: 175, aero: 25, grip: 205, surfaces: [256, 165, 55, 120], body: [19, 18, 56],
  },
};

const built = new Map<string, CarParams>();

/** The tuning of a car (by its model id); unknown ids get the touring car. */
export function carParams(carId: string): CarParams {
  let p = built.get(carId);
  if (!p) {
    p = tune(CAR_SPECS[carId] ?? CAR_SPECS['car-touring']);
    built.set(carId, p);
  }
  return p;
}

/** The car ids that have a tuning. */
export const TUNED_CARS = Object.keys(CAR_SPECS);

/** A mid-engined sports coupe: the sim's own test car (tests/sim-basic.test.ts). */
export const SPORTS_COUPE: CarParams = {
  gears: 5,
  mass: 30,
  braking: 256,
  idleRpm: 900,
  downshiftRpm: 4000,
  upshiftRpm: 7600,
  maxRpm: 8000,
  gearRatios: [0, 42000, 25000, 17500, 13500, 10800, 0],
  knobPoints: [
    [10, 30],
    [10, 48],
    [22, 12],
    [22, 48],
    [40, 12],
    [40, 48],
    [0, 0],
  ],
  aero: 26,
  launchTorque: 40,
  torque: torqueCurve(44, 5600, 8000),
  grip: 230,
  surfaceGrip: [0, 256, 192, 64, 128, 0],
  box: [18, 18, 52, 58],
  wheels: [
    [-960, 0, 1920],
    [960, 0, 1920],
    [960, 0, -1920],
    [-960, 0, -1920],
  ],
};
