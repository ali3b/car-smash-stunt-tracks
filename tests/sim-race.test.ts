// The race rules on the real simulation (src/sim/race.ts through src/game/sim-session.ts): the built-in path
// follower finishes bundled tracks, crashes are recovered, wrong-way driving and cutting the course cost time,
// and a replay of the input bytes gives the same race. Runs on our own tracks and cars only.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SimRaceSession } from '../src/game/sim-session';
import { StubReplayPlayer } from '../src/game/stub-session';
import type { RaceSetup } from '../src/game/types';
import { INPUT_ACCEL, INPUT_LEFT } from '../src/sim/engine';
import { pointAt } from '../src/sim/track-path';
import type { TrackFile } from '../src/track/types';

const track = (id: string): TrackFile => JSON.parse(fs.readFileSync(`src/track/tracks/${id}.json`, 'utf8'));
const setup = (id: string, extra: Partial<RaceSetup> = {}): RaceSetup => ({ trackId: id, track: track(id), carId: 'car-touring', paint: null, opponentId: null, gearbox: 'auto', ...extra });

function autoRace(s: SimRaceSession, max = 20 * 60 * 6) {
  for (let i = 0; i < max && !s.result(); i++) s.step(s.autopilotInput());
  return s.result();
}

describe('race on the simulation', () => {
  it('the path follower finishes Sunday Drive; the replay gives the same race', () => {
    const s = new SimRaceSession();
    s.start(setup('sunday-drive'));
    const r = autoRace(s)!;
    expect(r.finished).toBe(true);
    expect(r.timeSeconds).toBeGreaterThan(30);
    expect(r.topSpeedMph).toBeGreaterThan(60);
    expect(r.distanceM).toBeGreaterThan(1000);
    const rp = new StubReplayPlayer(() => new SimRaceSession());
    rp.load({ version: 1, trackId: 'sunday-drive', carId: 'car-touring', paint: null, opponentId: null, gearbox: 'auto', inputs: s.inputs() }, track('sunday-drive'));
    expect(rp.result()).toEqual(r);
  });

  it('a race against an opponent with a manual gearbox finishes; crashes are put right', () => {
    const s = new SimRaceSession();
    s.start(setup('lagoon-leap', { opponentId: 'lena', gearbox: 'manual', carId: 'car-rally' }));
    // A deliberate crash: the first leap's ramp taken at 60 mph (it needs about 112), so the car lands short.
    let slowed = false;
    for (let i = 0; i < 20 * 60 * 6 && !s.result(); i++) {
      const sec = s.sim.path.sections[Math.min(s.sim.player.section, s.sim.path.sections.length - 1)];
      if (!slowed && sec.jumpGap > 0) {
        slowed = true;
        s.sim.player.car.speed = s.sim.player.car.speed2 = 60 * 256;
      }
      s.step(s.autopilotInput());
    }
    const r = s.result()!;
    const p = s.sim.player;
    expect(slowed).toBe(true);
    expect(r.finished).toBe(true);
    expect(p.crashes).toBeGreaterThan(0);
    expect(r.penaltySeconds).toBeGreaterThanOrEqual(p.crashes * 3);
    expect(r.opponentTotalSeconds === null || r.opponentTotalSeconds > 0).toBe(true);
    expect(s.sim.player.car.gear).toBeGreaterThan(1);
  });

  it('driving against the course shows WRONG WAY and costs time', () => {
    const s = new SimRaceSession();
    s.start(setup('test-oval'));
    // Turn round, then drive.
    const car = () => s.sim.player.car;
    const yaw0 = car().yaw;
    let i = 0;
    while (i++ < 400 && Math.abs(((car().yaw - yaw0 + 1024) & 1023) - 512) > 40) s.step(INPUT_ACCEL | INPUT_LEFT);
    let wrong = false;
    for (let k = 0; k < 20 * 8; k++) if (s.step(INPUT_ACCEL).wrongWay) wrong = true;
    expect(wrong).toBe(true);
    expect(s.snapshot().penaltySeconds).toBeGreaterThanOrEqual(5);
  });

  it('cutting across the grass to rejoin further on costs time per piece skipped', () => {
    const s = new SimRaceSession();
    s.start(setup('test-oval'));
    for (let i = 0; i < 10; i++) s.step(INPUT_ACCEL);
    const race = s.sim;
    const p = race.player;
    // Off the road beside section 2, then back on the road at section 6.
    const at2 = pointAt(race.path, race.path.sections[2].start + 300)!;
    p.car.pos = [Math.round((at2.pos[0] + 600) * 64), p.car.pos[1], Math.round(at2.pos[2] * 64)];
    s.step(0);
    const at6 = pointAt(race.path, race.path.sections[6].start + 300)!;
    p.car.pos = [Math.round(at6.pos[0] * 64), p.car.pos[1], Math.round(at6.pos[2] * 64)];
    p.car.wheelSurface = [1, 1, 1, 1];
    const before = p.penalty;
    s.step(0);
    expect(p.section).toBe(6);
    expect(p.penalty - before).toBeGreaterThan(0);
  });
});
