// Every bundled track driven headless on the real simulation by the autopilot (src/sim/autodrive.ts): every car
// finishes every track with at most one crash (the jumps, loops, rolls and pipes are all clearable by all eight cars),
// and the two slow cars (vintage, buggy) are the slowest two round the all-tarmac tracks. The full table:
// npm run tracks:drive.
import { describe, expect, it } from 'vitest';
import { autoLap } from '../src/sim/autodrive';
import { TUNED_CARS } from '../src/sim/tunings';
import { TRACKS } from '../src/track/tracks';

const PAVED = ['palm-bay', 'downtown-rush', 'skyline-stunts'];

describe('autopilot laps of the bundled tracks', () => {
  for (const t of TRACKS)
    it(`${t.id}: every car finishes with at most one crash`, () => {
      const times: Record<string, number> = {};
      for (const car of TUNED_CARS) {
        const r = autoLap(t.track, car);
        const what = `${t.id} ${car} (reached ${r.section}/${r.sections}, crashes at ${r.crashAt.join(' ') || '-'})`;
        expect(r.finished, what).toBe(true);
        expect(r.crashes, what).toBeLessThanOrEqual(1);
        times[car] = r.timeSeconds + r.penaltySeconds;
      }
      if (PAVED.includes(t.id)) {
        const slowest = Object.keys(times).sort((a, b) => times[b] - times[a]).slice(0, 2).sort();
        expect(slowest, `${t.id} lap times ${JSON.stringify(times)}`).toEqual(['car-buggy', 'car-vintage']);
      }
    });
});
