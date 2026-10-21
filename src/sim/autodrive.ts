// Headless autopilot laps on the real simulation (no browser): one car alone on a track, driven by the path
// follower (src/sim/autopilot.ts) under the race rules (src/sim/race.ts). Used by scripts/tracks-drive.ts and
// tests/tracks-drive.test.ts to prove every bundled track can be finished by every car.
import { Autopilot, type AutopilotOptions } from './autopilot';
import { Race, RACE_HZ } from './race';
import { carParams } from './tunings';
import type { TrackFile } from '../track/types';

export interface AutoLapResult {
  finished: boolean;
  /** Race time without penalties (s). */
  timeSeconds: number;
  penaltySeconds: number;
  crashes: number;
  jumps: number;
  topSpeedMph: number;
  /** Where the crashes happened: "section:kind". */
  crashAt: string[];
  /** Speed (mph) leaving the ground on each jump's ramp. */
  takeoffs: number[];
  /** Section reached when the race gave up (= sections when finished). */
  section: number;
  sections: number;
}

export interface AutoLapOptions extends AutopilotOptions {
  automatic?: boolean;
  /** Give up after this many steps (default 8 minutes). */
  maxSteps?: number;
}

/** Drive one lap of `track` with `carId` on autopilot. */
export function autoLap(track: TrackFile, carId: string, opts: AutoLapOptions = {}): AutoLapResult {
  const race = new Race({ track, player: carParams(carId), automatic: opts.automatic ?? true });
  const pilot = new Autopilot(race.path, race.player.params, { pace: opts.pace ?? 0.8, lane: opts.lane ?? 0, sim: { surface: race.surface, rules: race.rules } });
  race.onAnyReset((r, s) => {
    if (r === race.player) pilot.resync(s);
  });
  const p = race.player;
  const crashAt: string[] = [];
  const max = opts.maxSteps ?? 8 * 60 * RACE_HZ;
  const takeoffs: number[] = [];
  let wasOn = true;
  for (let i = 0; i < max && !race.over && !p.finished; i++) {
    const mph = p.car.speed2 / 256;
    race.step(pilot.input(p.car));
    // Leaving the ground on a jump's ramp: the take-off speed.
    const on = p.car.surfAll !== 0;
    const sec = race.path.sections[Math.min(p.section, race.path.sections.length - 1)];
    if (wasOn && !on && sec && sec.jumpGap > 0) takeoffs.push(Math.round(mph));
    wasOn = on;
    if (p.events.some((e) => e.kind === 'crash')) {
      const sec = race.path.sections[Math.min(p.section, race.path.sections.length - 1)];
      crashAt.push(`${p.section}:${sec?.kind}`);
    }
  }
  const t = p.finishedTick ?? race.tick;
  return {
    finished: p.finished,
    timeSeconds: t / RACE_HZ,
    penaltySeconds: p.penalty,
    crashes: p.crashes,
    jumps: p.jumps,
    topSpeedMph: Math.round(p.topSpeed),
    crashAt,
    takeoffs,
    section: p.section,
    sections: race.path.sections.length,
  };
}
