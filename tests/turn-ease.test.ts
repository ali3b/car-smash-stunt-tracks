// The in-car view's eased orientation (render/turn-ease.ts): uneven 20 Hz turns come out as a smooth turn rate.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TurnEase } from '../src/render/turn-ease';

const deg = (a: THREE.Quaternion, b: THREE.Quaternion) => THREE.MathUtils.radToDeg(a.angleTo(b));
/** Pitch per step (degrees): a loop entry as the simulation turns it. */
const STEPS = [0, 0, 0, 5, 2.6, 1.5, 0, 1.8, 13, 8, 4, 2, 1.5, 1.5, 1.5, 1.5];

function drive(ease: TurnEase) {
  const quats: [number, number, number, number][] = [];
  let pitch = 0;
  for (const d of STEPS) {
    pitch += d;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(pitch));
    quats.push([q.x, q.y, q.z, q.w]);
  }
  // Three 60 Hz frames per step.
  const turns: number[] = [];
  let last: THREE.Quaternion | null = null;
  for (let k = 1; k < quats.length; k++) {
    for (const alpha of [0, 1 / 3, 2 / 3]) {
      const q = ease.at(k - 1, quats[k - 1], k, quats[k], alpha) ?? new THREE.Quaternion(...quats[k - 1]).slerp(new THREE.Quaternion(...quats[k]), alpha);
      if (last) turns.push(deg(last, q));
      last = q;
    }
  }
  const jolts = turns.slice(1).map((t, i) => Math.abs(t - turns[i]));
  return { turn: Math.max(...turns), jolt: Math.max(...jolts), turns };
}

describe('in-car orientation easing', () => {
  it('turns every frame (not once a step) and without jolts', () => {
    const raw = drive(new TurnEase(0));
    const eased = drive(new TurnEase(2));
    expect(raw.jolt).toBeGreaterThan(2.5);
    expect(eased.jolt).toBeLessThan(0.8);
    expect(eased.turn).toBeLessThan(raw.turn * 0.8);
    // Moving on every frame once the car turns.
    expect(eased.turns.slice(12).every((t) => t > 0.05)).toBe(true);
  });
  it('a steady turn stays steady', () => {
    const e = new TurnEase(2);
    const q = (k: number) => {
      const r = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), k * 0.05);
      return [r.x, r.y, r.z, r.w] as [number, number, number, number];
    };
    const out: THREE.Quaternion[] = [];
    for (let k = 1; k < 10; k++) for (const a of [0, 1 / 3, 2 / 3]) out.push(e.at(k - 1, q(k - 1), k, q(k), a)!);
    const steps = out.slice(7).map((x, i) => deg(out[i + 6], x));
    for (const s of steps) expect(s).toBeCloseTo(THREE.MathUtils.radToDeg(0.05 / 3), 2);
  });
});
