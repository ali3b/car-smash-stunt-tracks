// Our six rivals' driving (ids match OPPONENTS in src/game/catalog.ts). Our own numbers, tuned on the bundled tracks
// (tests/opponent-race.test.ts prints the lap table) against the built-in driver's best laps in the fastest cars:
// Nova about 4% quicker than that (tough, beatable), Gus about level, Marco +8%, Lena +10%, Hank +15%, Pip +27%.
//
// speeds: target mph per slot — straight paved / dirt / ice, sharp corner p/d/i, wide corner p/d/i, ramp, slalom,
// helix, chicane, loop, pipe (SpeedClass in opponent.ts). skill: share of the engine's drive force (200 = all).
import { BASE_PROFILE, SPEED_SLOTS, type OpponentProfile } from './opponent';

function profile(id: string, speeds: number[], skill: number, extra: Partial<OpponentProfile> = {}): OpponentProfile {
  if (speeds.length !== SPEED_SLOTS) throw new Error(`${id}: ${speeds.length} speed slots`);
  return { id, speeds, skill, ...BASE_PROFILE, ...extra };
}

export const OPPONENT_PROFILES: Record<string, OpponentProfile> = {
  // Rookie mechanic: gentle on everything, brakes early, never fights for a lane.
  pip: profile('pip', [101, 80, 53, 26, 17, 12, 56, 43, 28, 89, 16, 25, 46, 112, 40], 128, {
    brakeMargin: 0x180,
    accelMargin: 0x300,
    steerRate: 6,
    overtakes: false,
  }),
  // Retired trucker: a heavy right foot but a lazy one (little drive), barely slows for corners, skids happily (no
  // brake on a slide).
  hank: profile('hank', [116, 86, 52, 40, 27, 16, 85, 61, 35, 109, 23, 33, 97, 158, 49], 95, {
    brakeMargin: 0x600,
    brakeOnSlide: false,
    steerRate: 7,
  }),
  // Former stunt double: fast on the stunts, careful in the corners, aggressive passer.
  lena: profile('lena', [127, 104, 64, 28, 22, 14, 68, 54, 32, 114, 21, 35, 87, 166, 44], 168, {
    reachRadius: 230,
    steerRate: 9,
  }),
  // Radio host: middle of the road in every way.
  marco: profile('marco', [143, 105, 67, 34, 23, 14, 79, 57, 32, 105, 20, 31, 100, 131, 46], 172),
  // Pit-crew chief: precise lines, early braking, tidy steering, rarely risks a pass.
  gus: profile('gus', [170, 130, 81, 39, 26, 16, 88, 68, 39, 111, 22, 32, 120, 141, 49], 186, {
    brakeMargin: 0x200,
    accelMargin: 0x80,
    steerRate: 10,
    steerLimit: 0x48,
    reachRadius: 180,
  }),
  // Champion: fast everywhere, quick hands, takes every gap.
  nova: profile('nova', [201, 150, 98, 42, 27, 18, 87, 69, 36, 101, 21, 30, 127, 152, 46], 175, {
    brakeMargin: 0x400,
    steerRate: 11,
    steerLimit: 0x50,
    reachRadius: 210,
  }),
};

/** Rival ids from cautious to reckless. */
export const RIVALS_BY_NERVE = ['pip', 'gus', 'marco', 'lena', 'nova', 'hank'];

export function opponentProfile(id: string): OpponentProfile {
  return OPPONENT_PROFILES[id] ?? OPPONENT_PROFILES.marco;
}
