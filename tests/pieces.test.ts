// The piece catalogue's footprints and rotation: every end of every kind lands on its rotated footprint's edge.
import { describe, expect, test } from 'vitest';
import { pieceDef, placedEnd, rotatedFootprint } from '../src/track/pieces';
import type { Rot } from '../src/track/types';
import { footprintTiles, pieceSize, SIDE_DIR } from '../src/track/validate';
import { ALL_ENTRIES } from '../src/editor/palette';

const ROTS: Rot[] = [0, 1, 2, 3];
const kinds = ALL_ENTRIES.flatMap((e) => (e.variants ? e.variants.map(([v]) => ({ kind: e.kind, variant: v })) : [{ kind: e.kind, variant: e.variant }]));

describe('footprints', () => {
  test('every palette entry is in the catalogue', () => {
    for (const k of kinds) expect(pieceDef(k), `${k.kind}:${k.variant}`).toBeDefined();
  });

  test('rotation swaps width and depth on odd quarter turns', () => {
    const loop = pieceDef({ kind: 'loop' })!;
    expect(rotatedFootprint(loop, 0)).toEqual([1, 2]);
    expect(rotatedFootprint(loop, 1)).toEqual([2, 1]);
    expect(rotatedFootprint(loop, 2)).toEqual([1, 2]);
    expect(pieceSize({ kind: 'corner-large', rot: 3 })).toEqual([2, 2]);
  });

  test('footprint tiles cover w×d from the south-west anchor', () => {
    const tiles = footprintTiles({ x: 5, z: 7, kind: 'loop', rot: 1 });
    expect(tiles).toEqual([
      { x: 5, z: 7 },
      { x: 6, z: 7 },
    ]);
  });
});

describe('rotation', () => {
  test('a wide corner turned once: south-east entry becomes south-west facing west, exit north-east facing north', () => {
    const def = pieceDef({ kind: 'corner-large' })!;
    const [a, b] = def.paths[0].map((e) => placedEnd(def, { x: 10, z: 20, rot: 1 }, e));
    expect([a.x, a.z, a.side]).toEqual([10, 20, 'W']);
    expect([b.x, b.z, b.side]).toEqual([11, 21, 'N']);
  });

  test('a loop turned once runs west to east over two tiles', () => {
    const def = pieceDef({ kind: 'loop' })!;
    const [a, b] = def.paths[0].map((e) => placedEnd(def, { x: 0, z: 0, rot: 1 }, e));
    expect([a.x, a.z, a.side, b.x, b.z, b.side]).toEqual([0, 0, 'W', 1, 0, 'E']);
  });

  test('a small corner at each rotation', () => {
    const def = pieceDef({ kind: 'corner-small' })!;
    const sides = ROTS.map((rot) => def.paths[0].map((e) => placedEnd(def, { x: 0, z: 0, rot }, e).side).join(''));
    expect(sides).toEqual(['SW', 'WN', 'NE', 'ES']);
  });

  test.each(kinds)('$kind $variant: every end, at every rotation, sits on the footprint edge facing out', (k) => {
    const def = pieceDef(k)!;
    for (const rot of ROTS) {
      const [w, d] = rotatedFootprint(def, rot);
      for (const path of def.paths)
        for (const end of path) {
          const e = placedEnd(def, { x: 0, z: 0, rot }, end);
          expect(e.x >= 0 && e.x < w && e.z >= 0 && e.z < d, `${k.kind} rot ${rot} end inside`).toBe(true);
          const [dx, dz] = SIDE_DIR[e.side];
          const nx = e.x + dx;
          const nz = e.z + dz;
          expect(nx < 0 || nx >= w || nz < 0 || nz >= d, `${k.kind} rot ${rot} end ${e.side} faces out of the footprint`).toBe(true);
          expect(e.level).toBe(end.level);
        }
    }
  });

  test('four quarter turns of the ends come back round (rot 0 and rot 2 mirror each other through the centre)', () => {
    const def = pieceDef({ kind: 'chicane', variant: 'a' })!;
    const [w, d] = def.footprint;
    for (const end of def.paths[0]) {
      const e0 = placedEnd(def, { x: 0, z: 0, rot: 0 }, end);
      const e2 = placedEnd(def, { x: 0, z: 0, rot: 2 }, end);
      expect([e2.x, e2.z]).toEqual([w - 1 - e0.x, d - 1 - e0.z]);
    }
  });
});
