// QA-21: the sun's shadow box follows the car in whole shadow-map texels of the shadow camera's own axes, so a
// still object's shadow lands on the same texel fraction in every frame (its edges don't crawl while driving).
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { snapToShadowTexels } from '../src/render/scenery';

const RADIUS = 45;
const MAP = 2048;
const TEXEL = (2 * RADIUS) / MAP;

/** Where world point `p` lands in the shadow map (texels) with the shadow camera set up as three does it. */
function texelOf(p: THREE.Vector3, focus: THREE.Vector3, sunDir: THREE.Vector3): [number, number] {
  const cam = new THREE.OrthographicCamera(-RADIUS, RADIUS, RADIUS, -RADIUS, 1, 600);
  cam.position.copy(focus).addScaledVector(sunDir, 300);
  cam.lookAt(focus);
  cam.updateMatrixWorld();
  const v = p.clone().applyMatrix4(cam.matrixWorldInverse);
  return [(v.x + RADIUS) / TEXEL, (v.y + RADIUS) / TEXEL];
}

const frac = (v: number) => v - Math.floor(v);
/** How far the texel fractions of `p` wander over a drive (0 = the shadow grid never slides). */
function crawl(snap: (f: THREE.Vector3) => THREE.Vector3, sunDir: THREE.Vector3): number {
  const p = new THREE.Vector3(12.3, 0.7, -40.1);
  const ref = texelOf(p, snap(new THREE.Vector3(0, 0, 0)), sunDir);
  let worst = 0;
  // A car driving a curve over a hill, one 60 Hz frame at a time.
  for (let i = 0; i < 600; i++) {
    const t = i / 60;
    const focus = new THREE.Vector3(Math.sin(t * 0.4) * 60, Math.max(0, Math.sin(t) * 6), -t * 25);
    const [u, v] = texelOf(p, snap(focus), sunDir);
    for (const [a, b] of [
      [u, ref[0]],
      [v, ref[1]],
    ]) {
      const d = Math.abs(frac(a) - frac(b));
      worst = Math.max(worst, Math.min(d, 1 - d));
    }
  }
  return worst;
}

describe('shadow box snapping (QA-21)', () => {
  for (const sunFrom of [
    [-0.5, 0.75, 0.3],
    [-0.45, 0.72, 0.4],
    [-0.55, 0.7, 0.35],
  ] as const) {
    const sunDir = new THREE.Vector3(...sunFrom).normalize();
    it(`sun from ${sunFrom.join(', ')}: a still point keeps its texel fraction`, () => {
      expect(crawl((f) => snapToShadowTexels(f, sunDir, TEXEL), sunDir)).toBeLessThan(1e-3);
    });
    it(`sun from ${sunFrom.join(', ')}: snapping in world axes did not`, () => {
      const world = (f: THREE.Vector3) => new THREE.Vector3(...f.toArray().map((v) => Math.round(v / TEXEL) * TEXEL));
      expect(crawl(world, sunDir)).toBeGreaterThan(0.2);
    });
  }
});
