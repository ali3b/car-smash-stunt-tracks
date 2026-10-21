// The in-car view's eased orientation. The simulation turns the car in uneven 20 Hz steps (a loop entry: 5°, 2.6°,
// 1.5°, 0°, 1.8° of pitch per step), and straight interpolation between two steps shows each change of rate as a
// jolt (up to 5.7° of camera turn in one frame). TurnEase keeps the car's orientation at the last few steps and gives
// the mean over the last `window` steps up to now (a box filter), which ramps the turn rate across the steps. Only
// the view's orientation eases (it lags the car by half the window, 50 ms by default), never where the car or the
// eye is: like a driver's head, it trails the car a little through a loop.
import * as THREE from 'three';

type Quat = readonly [number, number, number, number];

export class TurnEase {
  private steps: { tick: number; quat: THREE.Quaternion }[] = [];

  /** `window`: steps averaged over (0: no easing). */
  constructor(public window = 2) {}

  /** Forget the history (the car was put somewhere else). */
  reset() {
    this.steps = [];
  }

  /**
   * The eased orientation between steps `prev` and `next` (ticks, orientations) at `alpha` (0..1) of the way, or null
   * with easing off.
   */
  at(prevTick: number, prevQuat: Quat, nextTick: number, nextQuat: Quat, alpha: number): THREE.Quaternion | null {
    const last = this.steps[this.steps.length - 1];
    // Time went back (a replay seek or rewind) or skipped steps (a seek forward): start the history over.
    if (last && (prevTick < last.tick - 1 || prevTick > last.tick)) this.reset();
    this.keep(prevTick, prevQuat);
    this.keep(nextTick, nextQuat);
    if (!this.window) return null;
    const t = prevTick + alpha * (nextTick - prevTick);
    const h = this.steps;
    const q = new THREE.Quaternion();
    const sample = (x: number) => {
      if (x <= h[0].tick) return q.copy(h[0].quat);
      for (let i = 1; i < h.length; i++) {
        if (x <= h[i].tick) return q.slerpQuaternions(h[i - 1].quat, h[i].quat, (x - h[i - 1].tick) / (h[i].tick - h[i - 1].tick));
      }
      return q.copy(h[h.length - 1].quat);
    };
    // The mean of samples across the window (in the first sample's hemisphere, so opposite signs don't cancel out).
    const n = 24;
    const sum = new THREE.Vector4(0, 0, 0, 0);
    let first: THREE.Quaternion | null = null;
    for (let i = 0; i < n; i++) {
      // Midpoints of n equal slices of the window.
      sample(t - this.window + (this.window * (i + 0.5)) / n);
      first ??= q.clone();
      const s = q.dot(first) < 0 ? -1 : 1;
      sum.x += q.x * s;
      sum.y += q.y * s;
      sum.z += q.z * s;
      sum.w += q.w * s;
    }
    return new THREE.Quaternion(sum.x, sum.y, sum.z, sum.w).normalize();
  }

  private keep(tick: number, q: Quat) {
    const last = this.steps[this.steps.length - 1];
    if (last && tick <= last.tick) {
      // The same step again: its latest orientation (a step is final once the next one exists).
      if (tick === last.tick) last.quat.set(q[0], q[1], q[2], q[3]);
      return;
    }
    this.steps.push({ tick, quat: new THREE.Quaternion(q[0], q[1], q[2], q[3]) });
    if (this.steps.length > 8) this.steps.shift();
  }
}
