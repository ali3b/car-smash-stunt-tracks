// The car sound read from the simulation (src/game/car-sound.ts) through the race session: the engine's rpm and
// throttle, tyre slip in corners but not on straights, the surface under the wheels, landings after jumps, and a
// sliding car on ice slipping earlier than on tarmac. Our own tracks and cars only.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lateralSlip } from '../src/game/car-sound';
import { CARS } from '../src/game/catalog';
import { SimRaceSession } from '../src/game/sim-session';
import { ENGINE_PROFILES } from '../src/audio/engine';
import type { TrackFile } from '../src/track/types';

const track = (id: string): TrackFile => JSON.parse(fs.readFileSync(`src/track/tracks/${id}.json`, 'utf8'));

function drive(trackId: string, carId: string) {
  const s = new SimRaceSession();
  s.start({ trackId, track: track(trackId), carId, paint: null, opponentId: null, gearbox: 'auto' });
  const steps: { kind: string | null; slip: number; rpm: number; throttle: number; surface: string; hits: { kind: string; strength: number }[] }[] = [];
  for (let i = 0; i < 20 * 400 && !s.result(); i++) {
    const snap = s.step(s.autopilotInput());
    const so = snap.player.sound!;
    steps.push({ kind: s.stats().kind, slip: Math.max(...so.slip), rpm: so.rpm, throttle: so.throttle, surface: so.surface, hits: so.hits });
  }
  return { steps, result: s.result()! };
}

describe('car sound from the simulation', () => {
  it('every car has an engine voice', () => {
    for (const c of CARS) expect(ENGINE_PROFILES).toContain(c.engine);
    expect(CARS.find((c) => c.id === 'car-sr-muscle')!.engine).toBe('v8');
    expect(CARS.find((c) => c.id === 'car-openwheeler')!.engine).toBe('f1');
  });

  it('slip starts near the grip limit, earlier on a slippery surface', () => {
    expect(lateralSlip(0.3)).toBe(0);
    expect(lateralSlip(1.2)).toBe(1);
    expect(lateralSlip(0.6, 0.25)).toBeGreaterThan(lateralSlip(0.6, 1));
  });

  it('a lap of Lagoon Leap: engine in range, squeal in corners only, landings after the jumps', () => {
    const { steps, result } = drive('lagoon-leap', 'car-rally');
    expect(result.finished).toBe(true);
    expect(steps.every((s) => s.rpm >= 0 && s.rpm <= 1)).toBe(true);
    expect(steps.some((s) => s.rpm > 0.7 && s.throttle === 1)).toBe(true);
    const straight = steps.filter((s) => s.kind === 'straight' && s.surface === 'paved');
    const corners = steps.filter((s) => /corner|chicane/.test(s.kind ?? ''));
    const share = (a: typeof steps, t: number) => a.filter((s) => s.slip > t).length / a.length;
    expect(share(straight, 0.15)).toBeLessThan(0.02);
    expect(share(corners, 0.15)).toBeGreaterThan(share(straight, 0.15) * 3);
    const lands = steps.flatMap((s) => s.hits).filter((h) => h.kind === 'land');
    expect(lands.length).toBeGreaterThanOrEqual(result.jumps);
    expect(Math.max(...lands.map((h) => h.strength))).toBeGreaterThan(0.5);
  });
});
