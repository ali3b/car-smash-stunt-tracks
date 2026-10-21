// Sanity checks of src/sim with our own tuning on flat ground (no original data needed).
import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, INPUT_ACCEL, INPUT_BRAKE, INPUT_LEFT, SPORTS_COUPE, createCarState, flatSurface, step, stepCar } from '../src/sim';

const start = () => createCarState(SPORTS_COUPE, [15 * 65536, 0, 2 * 65536], 0, true);

describe('sim on flat ground', () => {
  it('accelerates north, shifts up and stays on the ground', () => {
    const c = start();
    const g = flatSurface();
    for (let i = 0; i < 200; i++) stepCar(c, SPORTS_COUPE, DEFAULT_RULES, INPUT_ACCEL, g);
    expect(c.speed2 >> 8).toBeGreaterThan(60);
    expect(c.gear).toBeGreaterThan(2);
    expect(c.pos[2]).toBeGreaterThan(4 * 65536);
    expect(c.pos[0]).toBe(15 * 65536);
    expect(c.surfAll).toBe(4);
    expect(c.crash).toBe(0);
  });
  it('turns left with the left key and brakes to a stop', () => {
    const c = start();
    const g = flatSurface();
    for (let i = 0; i < 60; i++) stepCar(c, SPORTS_COUPE, DEFAULT_RULES, INPUT_ACCEL, g);
    for (let i = 0; i < 20; i++) stepCar(c, SPORTS_COUPE, DEFAULT_RULES, INPUT_ACCEL | INPUT_LEFT, g);
    expect(c.steering).toBeLessThan(0);
    expect(c.yaw).not.toBe(0);
    for (let i = 0; i < 200; i++) stepCar(c, SPORTS_COUPE, DEFAULT_RULES, INPUT_BRAKE, g);
    expect(c.speed2).toBe(0);
  });
  it('is deterministic and step() is pure', () => {
    const a = start();
    const b = step(a, SPORTS_COUPE, DEFAULT_RULES, INPUT_ACCEL, flatSurface());
    expect(a.speed2).toBe(0);
    expect(step(a, SPORTS_COUPE, DEFAULT_RULES, INPUT_ACCEL, flatSurface())).toEqual(b);
  });
});
