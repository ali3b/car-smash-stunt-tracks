// Track-side dressing from Pro Racer props: a start/finish gantry, the chequered line and a grandstand on the
// start-finish piece, and the slalom blocks. Positions follow the original's piece layout (research/SPEC.md §7):
//   start/finish arch 264 units wide (16.1 m), 121 high, across the road at the tile centre;
//   slalom: two 74×30-unit blocks, 25 high, the west one at z = +256 units (north), the east one at z = −256,
//   each centred 60 units off the centre line.
// Models: ts-gantry, start-line, grandstand, ts-slalom, ts-tyres, ts-billboard (ssg.models.json).
import * as THREE from 'three';
import type { LoadedModel } from '../models';
import { HILL_M, TILE_M, UNIT_M, type Piece, type TrackFile } from '../track/types';
import { InstanceBatch, placement } from './instancing';

export const TRACKSIDE_MODELS = ['ts-gantry', 'start-line', 'grandstand', 'ts-slalom', 'ts-tyres', 'ts-billboard'];

function tileY(t: TrackFile, x: number, z: number) {
  const h = t.heights;
  return Math.max(h[z][x], h[z][x + 1], h[z + 1][x], h[z + 1][x + 1]) * HILL_M;
}

/** A point in a piece's own frame (x east, z north at rot 0, metres from the tile centre) → world. */
function pieceFrame(p: Piece, y: number) {
  const yaw = -p.rot * (Math.PI / 2);
  const cx = (p.x + 0.5) * TILE_M;
  const cz = -(p.z + 0.5) * TILE_M;
  return (lx: number, lz: number, turn = 0) => {
    // North (+lz) is world −z; a clockwise quarter turn per rot.
    const v = new THREE.Vector3(lx, 0, -lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    return placement(cx + v.x, y, cz + v.z, yaw + turn, 1);
  };
}

export function trackside(t: TrackFile, models: Map<string, LoadedModel>): THREE.Group {
  const batch = new InstanceBatch();
  const scaled = (m: THREE.Matrix4, s: number) => m.multiply(new THREE.Matrix4().makeScale(s, s, s));
  for (const p of t.pieces) {
    if (p.kind === 'start-finish') {
      const at = pieceFrame(p, tileY(t, p.x, p.z));
      batch.add('ts-gantry', at(0, 0));
      // The line marking is 15.16 m wide; the road is 14.63 m.
      const line = models.get('start-line');
      const lw = line?.manifest.bounds.size[0] ?? 14.63;
      batch.add('start-line', scaled(at(0, 0).multiply(new THREE.Matrix4().makeTranslation(0, 0.03, 0)), 14.2 / lw));
      // A grandstand on the east side facing the road, tyre walls and a billboard on the west side.
      batch.add('grandstand', scaled(at(19, 0, -Math.PI / 2), 1.4));
      batch.add('ts-tyres', at(-10.5, 12, Math.PI / 2));
      batch.add('ts-tyres', at(-10.5, -12, Math.PI / 2));
      batch.add('ts-billboard', at(-17, 0, Math.PI / 2));
    } else if (p.kind === 'slalom') {
      const at = pieceFrame(p, tileY(t, p.x, p.z));
      const off = 60 * UNIT_M;
      const along = 256 * UNIT_M;
      batch.add('ts-slalom', at(-off, along));
      batch.add('ts-slalom', at(off, -along));
    }
  }
  return batch.build(models, { name: 'trackside' });
}
