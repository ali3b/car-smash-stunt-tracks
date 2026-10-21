// Our eight car tunings on flat ground: each accelerates, tops out, brakes and corners within sensible ranges, and
// no two drive alike.
import { describe, expect, it } from 'vitest';
import { createCarState, type CarParams } from '../src/sim/car';
import { INPUT_ACCEL, INPUT_BRAKE, INPUT_RIGHT } from '../src/sim/engine';
import { stepCar } from '../src/sim/step';
import { SurfaceCode, flatSurface } from '../src/sim/surface';
import { DEFAULT_RULES, TUNED_CARS, carParams } from '../src/sim/tunings';

interface Figures {
  zeroSixty: number;
  top: number;
  stop60: number;
  dirtTop: number;
  /** Heading change (1/1024 turn) in 3 s of full right lock at 50 mph. */
  turn: number;
}

function measure(p: CarParams): Figures {
  const ground = flatSurface(SurfaceCode.Paved);
  const c = createCarState(p, [0x100000, 0, 0x100000], 0, true);
  let zeroSixty = 0;
  for (let i = 1; i <= 20 * 90; i++) {
    stepCar(c, p, DEFAULT_RULES, INPUT_ACCEL, ground);
    if (!zeroSixty && c.speed2 >= 60 * 256) zeroSixty = i / 20;
  }
  const top = c.speed2 / 256;
  const b = createCarState(p, [0x100000, 0, 0x100000], 0, true);
  while (b.speed2 < 60 * 256) stepCar(b, p, DEFAULT_RULES, INPUT_ACCEL, ground);
  let stop60 = 0;
  while (b.speed2 > 0 && stop60 < 400) {
    stepCar(b, p, DEFAULT_RULES, INPUT_BRAKE, ground);
    stop60++;
  }
  const d = createCarState(p, [0x100000, 0, 0x100000], 0, true);
  const dirt = flatSurface(SurfaceCode.Dirt);
  for (let i = 0; i < 20 * 60; i++) stepCar(d, p, DEFAULT_RULES, INPUT_ACCEL, dirt);
  const t = createCarState(p, [0x100000, 0, 0x100000], 0, true);
  while (t.speed2 < 50 * 256) stepCar(t, p, DEFAULT_RULES, INPUT_ACCEL, ground);
  const yaw0 = t.yaw;
  for (let i = 0; i < 60; i++) stepCar(t, p, DEFAULT_RULES, t.speed2 > 50 * 256 ? INPUT_RIGHT : INPUT_RIGHT | INPUT_ACCEL, ground);
  return { zeroSixty, top, stop60: stop60 / 20, dirtTop: d.speed2 / 256, turn: (yaw0 - t.yaw) & 1023 };
}

describe('car tunings', () => {
  const figs = new Map(TUNED_CARS.map((id) => [id, measure(carParams(id))]));
  it('every car is drivable', () => {
    console.log([...figs].map(([id, f]) => `${id.padEnd(16)} 0-60 ${f.zeroSixty.toFixed(2)} s  top ${f.top.toFixed(0)} mph  60-0 ${f.stop60.toFixed(2)} s  dirt top ${f.dirtTop.toFixed(0)}  turn ${f.turn}`).join('\n'));
    expect(TUNED_CARS.length).toBe(8);
    for (const [, f] of figs) {
      expect(f.zeroSixty).toBeGreaterThan(1.5);
      expect(f.zeroSixty).toBeLessThan(12);
      expect(f.top).toBeGreaterThan(85);
      expect(f.top).toBeLessThan(240);
      expect(f.stop60).toBeGreaterThan(1);
      expect(f.stop60).toBeLessThan(6);
      expect(f.turn).toBeGreaterThan(20);
    }
  });
  it('the cars differ', () => {
    const keys = [...figs.values()].map((f) => `${f.zeroSixty}:${f.top.toFixed(0)}`);
    expect(new Set(keys).size).toBe(8);
    const f = (id: string) => figs.get(id)!;
    expect(f('car-openwheeler').top).toBeGreaterThan(f('car-vintage').top);
    expect(f('car-buggy').top).toBeLessThan(f('car-stock').top);
  });
  it('every car reaches jump speed on a long straight (a one-tile jump needs about 112 mph at the lip)', () => {
    for (const [id, fig] of figs) expect(fig.top, id).toBeGreaterThan(118);
  });
  it('the buggy turns tightest on dirt and on ice; the vintage car is slowest off the line and brakes softest', () => {
    const lock = (id: string, surface: SurfaceCode) => {
      const p = carParams(id);
      const ground = flatSurface(surface);
      const c = createCarState(p, [0x100000, 0, 0x100000], 0, true);
      while (c.speed2 < 40 * 256) stepCar(c, p, DEFAULT_RULES, INPUT_ACCEL, ground);
      const yaw0 = c.yaw;
      let turned = 0;
      let last = yaw0;
      for (let i = 0; i < 120; i++) {
        stepCar(c, p, DEFAULT_RULES, c.speed2 > 45 * 256 ? INPUT_RIGHT : INPUT_RIGHT | INPUT_ACCEL, ground);
        let d = (last - c.yaw) & 1023;
        if (d > 512) d -= 1024;
        turned += d;
        last = c.yaw;
      }
      return turned;
    };
    for (const surface of [SurfaceCode.Dirt, SurfaceCode.Ice]) {
      const best = TUNED_CARS.map((id) => [id, lock(id, surface)] as const).sort((a, b) => b[1] - a[1])[0];
      expect(best[0], `surface ${surface}`).toBe('car-buggy');
    }
    const slowest = [...figs].sort((a, b) => b[1].zeroSixty - a[1].zeroSixty)[0][0];
    expect(slowest).toBe('car-vintage');
    const softest = [...figs].sort((a, b) => b[1].stop60 - a[1].stop60)[0][0];
    expect(softest).toBe('car-vintage');
  });
});
