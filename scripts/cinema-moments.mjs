// The gameplay moments the trailer and the documentary are cut from: races on our own bundled tracks (never the
// reference tracks), simulated by the capture scene, and the shots that film them. Times are take seconds; the
// takes are deterministic, so a moment always shows the same thing (test with scripts/cinema-survey.ts, or the
// capture scene's summary(): stunt sections, jumps, crashes, close racing). When the tracks, the cars or the
// built-in driver change, the times move: re-survey and re-time.
//
// A moment: { take, shot, from, rate?, blur?, hud? } (record.mjs clip shot, without the duration).
// Loops and rolls are filmed riding with the car (chase, in-car), not from track-side.

export const TAKES = {
  sunday: { track: 'sunday-drive', car: 'car-super', rival: 'nova', seconds: 60 },
  palm: { track: 'palm-bay', car: 'car-super', rival: 'lena', seconds: 75 },
  cactus: { track: 'cactus-canyon', car: 'car-openwheeler', seconds: 70 },
  downtown: { track: 'downtown-rush', car: 'car-super', rival: 'nova', seconds: 125 },
  glacier: { track: 'glacier-pass', car: 'car-super', rival: 'nova', seconds: 60 },
  lagoon: { track: 'lagoon-leap', car: 'car-super', seconds: 80 },
  mesa: { track: 'mesa-madness', car: 'car-super', seconds: 40 },
  skyline: { track: 'skyline-stunts', car: 'car-super', seconds: 85 },
  avalanche: { track: 'avalanche-run', car: 'car-super', seconds: 135 },
  harvest: { track: 'harvest-havoc', car: 'car-openwheeler', seconds: 175 },
  // Staged crashes: braking before the take-off, so the leap falls short (the built-in driver clears every jump).
  lagoonShort: { track: 'lagoon-leap', car: 'car-super', seconds: 60, override: [{ from: 49.5, to: 53.3, mode: 'brake' }] },
  harvestShort: { track: 'harvest-havoc', car: 'car-openwheeler', seconds: 52, override: [{ from: 43, to: 45.8, mode: 'brake' }] },
  mesaShort: { track: 'mesa-madness', car: 'car-super', seconds: 127, override: [{ from: 119, to: 120.6, mode: 'brake' }] },
};

/** Aerial over a whole track (x, z in tiles, y in metres), slowly descending; `turn` picks the side it flies on. */
export function aerial(turn = 0, high = 70, low = 34) {
  const a = (turn * Math.PI) / 2;
  const at = (r, da) => [15 + Math.cos(a + da) * r, 0, 15 + Math.sin(a + da) * r];
  const p0 = at(14, -0.45);
  const p1 = at(8.5, 0.1);
  return { type: 'aerial', from: [p0[0], high, p0[2]], to: [p1[0], low, p1[2]], look: [15, 0, 15], fov: 52 };
}

/** A jump seen from beside its middle (the camera finds a clear view), in slow motion. */
const jump = (take, at, from, rate = 0.75, side = 36, extra = {}) => ({ take, shot: { type: 'trackside', at, side, height: 4, zoom: 11, ...extra }, from, rate, blur: 3 });

export const M = {
  // The start: in the car on the grid, then both cars past a camera on the tarmac.
  launchCockpit: { take: 'sunday', shot: { type: 'cockpit' }, from: 0 },
  launchLow: { take: 'sunday', shot: { type: 'trackside', at: 2.2, side: -6, height: 0.5, fov: 50, target: 'both', span: 0.4 }, from: 0.6, blur: 3 },
  sundayDuel: { take: 'sunday', shot: { type: 'chase', dist: 13, height: 3.4 }, from: 4 },
  sundaySide: { take: 'sunday', shot: { type: 'side', dist: 8, height: 1.4, lead: 2 }, from: 6 },
  // Sunday Drive: over Windmill Hill at 138 mph.
  bigAir: jump('sunday', 44.1, 43.0, 0.7, -36),
  // Lagoon Leap: the loop by the beach bar, the leaps over the lagoon, and one that falls short.
  loopChase: { take: 'lagoon', shot: { type: 'chase', dist: 12, height: 3.5 }, from: 7.4 },
  loopCockpit: { take: 'lagoon', shot: { type: 'cockpit' }, from: 8.6 },
  lagoonLeap: jump('lagoon', 54.1, 52.7, 0.8, 38),
  lagoonLeap2: jump('lagoon', 76.3, 74.9, 0.8, -38),
  lagoonPipe: { take: 'lagoon', shot: { type: 'chase', dist: 10, height: 2.5 }, from: 25.6 },
  leapFly: jump('lagoonShort', 57.2, 55.9, 0.85, 34),
  leapSplash: { take: 'lagoonShort', shot: { type: 'trackside', at: 57.6, side: 24, height: 3, back: -6, ground: 1.5, zoom: 10 }, from: 57.85, rate: 0.45, blur: 2 },
  // Mesa Madness: the barrel roll in the car, and a skyway jump gone wrong.
  rollCockpit: { take: 'mesa', shot: { type: 'cockpit' }, from: 9.4 },
  rollChase: { take: 'mesa', shot: { type: 'chase', dist: 12, height: 3.5 }, from: 9.6 },
  plunge: jump('mesaShort', 122.9, 121.9, 0.55, -34, { zoom: 14 }),
  plungeTumble: { take: 'mesaShort', shot: { type: 'heli', dist: 34, height: 16, fov: 55 }, from: 123.2, rate: 0.7, blur: 2 },
  mesaRun: { take: 'mesa', shot: { type: 'wheel', side: 1 }, from: 2 },
  // Glacier Pass: wheel to wheel up the helix.
  helixFront: { take: 'glacier', shot: { type: 'front', dist: 10, height: 1.6 }, from: 18 },
  helixChase: { take: 'glacier', shot: { type: 'chase', dist: 12, height: 4 }, from: 21 },
  helixSide: { take: 'glacier', shot: { type: 'side', dist: 7, height: 1.2, target: 'rival' }, from: 24 },
  // Downtown Rush: the duel through the blocks and over the flyover.
  downtownDuel: { take: 'downtown', shot: { type: 'chase', dist: 12, height: 3 }, from: 5 },
  downtownBumper: { take: 'downtown', shot: { type: 'bumper' }, from: 52 },
  flyoverJump: jump('downtown', 93.9, 92.6, 0.8, 38),
  downtownTunnel: { take: 'downtown', shot: { type: 'chase', dist: 10, height: 2.6 }, from: 118.2 },
  // Palm Bay: side by side on the seafront highway, the banked hairpin, the causeway.
  palmBumper: { take: 'palm', shot: { type: 'bumper' }, from: 7 },
  palmHighway: { take: 'palm', shot: { type: 'side', dist: 9, height: 1.5, lead: 3, target: 'both' }, from: 9.4 },
  palmBanked: { take: 'palm', shot: { type: 'trackside', at: 40.2, side: -16, height: 1.2, fov: 55 }, from: 38.8, blur: 2 },
  palmCauseway: jump('palm', 59.7, 58.7, 0.7, 30),
  // Cactus Canyon: the slalom by the gas station and the jump over the creek.
  slalom: { take: 'cactus', shot: { type: 'chase', dist: 11, height: 3 }, from: 4 },
  cactusJump: jump('cactus', 32.6, 31.3, 0.8, 34),
  cactusJump2: jump('cactus', 64.1, 63.0, 0.7, -32),
  // Skyline Stunts: the pipe, the roll, the canal jump.
  skyLoopChase: { take: 'skyline', shot: { type: 'chase', dist: 12, height: 3.5 }, from: 9.3 },
  skyPipe: { take: 'skyline', shot: { type: 'cockpit' }, from: 30.4 },
  skyPipeChase: { take: 'skyline', shot: { type: 'chase', dist: 9, height: 2.2 }, from: 30.0 },
  skyRollCockpit: { take: 'skyline', shot: { type: 'cockpit' }, from: 79.0 },
  canalJump: jump('skyline', 71.9, 70.6, 0.8, 36),
  // Avalanche Run: the double jump over the tarn and the frozen loop.
  tarnJump: jump('avalanche', 25.3, 23.9, 0.75, 38),
  tarnJump2: jump('avalanche', 29.8, 28.8, 0.75, -36),
  avaLoopCockpit: { take: 'avalanche', shot: { type: 'cockpit' }, from: 35 },
  avaSlalom: { take: 'avalanche', shot: { type: 'chase', dist: 11, height: 3 }, from: 106 },
  // Harvest Havoc: the open-wheeler through the loop, over the river, and one that lands in it.
  harvestLoopCockpit: { take: 'harvest', shot: { type: 'cockpit' }, from: 8.6 },
  harvestLoopChase: { take: 'harvest', shot: { type: 'chase', dist: 11, height: 3.2 }, from: 8.2 },
  harvestRiver: jump('harvest', 47.0, 45.6, 0.75, 36),
  harvestJump: jump('harvest', 70.6, 69.6, 0.7, -32),
  harvestBig: jump('harvest', 171.6, 170.1, 0.75, 38),
  harvestSplash: jump('harvestShort', 49.0, 47.5, 0.55, 30),
  harvestBanked: { take: 'harvest', shot: { type: 'chase', dist: 12, height: 3 }, from: 81 },
  // Aerial reveals of the five scenery sets.
  aerialTropical: { take: 'palm', shot: aerial(0), from: 30 },
  aerialDesert: { take: 'cactus', shot: { type: 'heli', dist: 34, height: 24, fov: 55 }, from: 5 },
  aerialCity: { take: 'skyline', shot: aerial(2), from: 40 },
  aerialAlpine: { take: 'glacier', shot: aerial(3), from: 20 },
  aerialCountry: { take: 'harvest', shot: aerial(1.5), from: 30 },
};

/** A still of our own (test-results/documentary/material, allowlisted) as a moment: a card with a push-in. */
export const still = (file, dim = 0) => ({ card: { image: `/test-results/documentary/material/${file}`, dim } });

/** A record.mjs clip for one moment lasting `dur` video seconds, with overlays. */
export function momentClip(name, moment, dur, overlays = [], extra = {}) {
  const m = typeof moment === 'string' ? M[moment] : moment;
  if (!m) throw new Error(`no moment ${moment}`);
  const { take, ...shot } = m;
  return { name, take: take ? TAKES[take] : null, shots: [{ ...shot, dur, overlays, ...extra }] };
}
