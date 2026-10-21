// Our computer drivers on our own tracks (no original data needed): the route walk, the grid, and the six rivals
// driving laps of the test oval on flat ground.
import { describe, expect, it } from 'vitest';
import { createCarState } from '../src/sim/car';
import { RouteDriver } from '../src/sim/opponent';
import { buildRoute, gridStarts } from '../src/sim/opponent-route';
import { OPPONENT_PROFILES, RIVALS_BY_NERVE } from '../src/sim/opponents';
import { SurfaceCode, flatSurface } from '../src/sim/surface';
import { SPORTS_COUPE } from '../src/sim/tunings';
import type { TrackFile } from '../src/track/types';
import oval from '../src/track/tracks/test-oval.json';
import sunday from '../src/track/tracks/sunday-drive.json';

const OVAL = oval as unknown as TrackFile;

/** Frames for `laps` laps (or null if not done within the limit). */
function lapTime(id: string, laps = 1, limit = 20 * 400): number | null {
  const route = buildRoute(OVAL)!;
  const grid = gridStarts(OVAL, route);
  const d = new RouteDriver(OPPONENT_PROFILES[id], SPORTS_COUPE);
  d.init(route, grid.opponent);
  const surface = flatSurface(SurfaceCode.Paved, 0);
  for (let f = 1; f <= limit; f++) {
    d.step(surface);
    if (d.car.crash === 3 || d.laps >= laps + 1) return f;
    if (d.car.crash !== 0) return null;
  }
  return null;
}

describe('opponent route on our tracks', () => {
  it('walks the test oval from the start line round to it', () => {
    const r = buildRoute(OVAL)!;
    expect(r).not.toBeNull();
    expect(r.steps).toBeGreaterThan(8);
    const w = r.waypoint(0, 0);
    expect(w.centre[1]).toBe(-1);
    // lane points either side, 2 × 120 apart
    expect(Math.round(Math.hypot(w.left[0] - w.right[0], w.left[2] - w.right[2]))).toBe(240);
    for (let s = 0; s < r.steps; s++) {
      let k = 0;
      while (!r.waypoint(s, k).last) k++;
      expect(k).toBeGreaterThanOrEqual(1);
    }
  });

  it('every shipped track has a route that closes', () => {
    for (const t of [OVAL, sunday as unknown as TrackFile]) {
      const r = buildRoute(t)!;
      expect(r.steps).toBeGreaterThan(8);
    }
  });

  it('grid slots: both cars beside the start tile, facing the way the road runs', () => {
    const r = buildRoute(OVAL)!;
    const g = gridStarts(OVAL, r);
    const [tx, tz] = r.startTile;
    for (const s of [g.player, g.opponent]) {
      expect(s.pos[0] >> 16).toBe(tx);
      expect(s.pos[2] >> 16).toBe(tz);
      expect(s.yaw).toBe((-r.startAngle << 16) >> 16);
    }
    expect(g.player.pos).not.toEqual(g.opponent.pos);
  });
});

describe('the six rivals', () => {
  it('have distinct profiles (our own tables)', () => {
    const ids = Object.keys(OPPONENT_PROFILES);
    expect(ids.sort()).toEqual(['gus', 'hank', 'lena', 'marco', 'nova', 'pip']);
    const keys = new Set(ids.map((id) => JSON.stringify(OPPONENT_PROFILES[id])));
    expect(keys.size).toBe(6);
    for (const id of ids) {
      const p = OPPONENT_PROFILES[id];
      expect(p.speeds).toHaveLength(15);
      expect(p.skill).toBeGreaterThan(0);
      expect(p.skill).toBeLessThanOrEqual(200);
    }
    expect(RIVALS_BY_NERVE).toHaveLength(6);
  });

  it('each drives a lap of the test oval; the champion is quicker than the rookie', () => {
    const times: Record<string, number | null> = {};
    for (const id of Object.keys(OPPONENT_PROFILES)) times[id] = lapTime(id);
    console.log('test-oval lap (frames, flat ground):', JSON.stringify(times));
    for (const id of Object.keys(times)) expect(times[id], id).not.toBeNull();
    expect(times.nova!).toBeLessThan(times.pip!);
  });

  it('is deterministic', () => {
    expect(lapTime('lena')).toBe(lapTime('lena'));
  });

  it('a driver steps a car made by createCarState without a route doing nothing', () => {
    const d = new RouteDriver(OPPONENT_PROFILES.pip, SPORTS_COUPE);
    const before = JSON.stringify(createCarState(SPORTS_COUPE, [0, 0, 0], 0, true));
    d.step(flatSurface(SurfaceCode.Paved, 0));
    expect(JSON.stringify(d.car)).toBe(before);
  });
});
