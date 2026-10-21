// The track surface on small hand-made tracks (runs without the original).
import { describe, expect, it } from 'vitest';
import { createTrackSurface } from '../src/sim/track-surface';
import { polarAngle, polarRadius2D, mulScale } from '../src/sim/fixmath';
import type { Piece, TrackFile } from '../src/track/types';

function track(pieces: Piece[], hill: [number, number][] = [], water: [number, number][] = []): TrackFile {
  const heights = Array.from({ length: 31 }, () => new Array(31).fill(0));
  for (const [x, z] of hill) heights[z][x] = 1;
  const w: TrackFile['water'] = Array.from({ length: 30 }, () => new Array(30).fill(false));
  for (const [x, z] of water) w[z][x] = true;
  return { version: 1, name: 't', scenery: 'country', pieces, heights, water: w };
}
const centre = (t: number) => t * 1024 + 512;

describe('fixed-point helpers', () => {
  it('angles and radii', () => {
    expect(polarAngle(0, 100)).toBe(0);
    expect(polarAngle(100, 0)).toBe(256);
    expect(polarAngle(100, 100)).toBe(128);
    expect(polarAngle(0, -100)).toBe(512);
    expect(polarAngle(-100, 0)).toBe(-256);
    expect(polarRadius2D(300, 400)).toBeGreaterThanOrEqual(499);
    expect(polarRadius2D(300, 400)).toBeLessThanOrEqual(501);
    expect(mulScale(16384, 123)).toBe(123);
  });
});

describe('track surface', () => {
  it('straight road: paved on the road, bumpy grass beside it, nothing outside the grid', () => {
    const s = createTrackSurface(track([{ x: 5, z: 5, kind: 'straight', rot: 0 }]));
    const on = s.surfaceAt(centre(5), 0, centre(5));
    expect(on.kind).toBe('road');
    expect(on.surface).toBe('paved');
    expect(on.height).toBe(2);
    expect(s.distance(on, centre(5), 10, centre(5))).toBe(8);
    const off = s.surfaceAt(centre(5) + 200, 0, centre(5));
    expect(off.surface).toBe('grass');
    expect([0, 1]).toContain(off.height);
    expect(s.surfaceAt(-10, 0, 100).kind).toBe('none');
  });

  it('ramp rises 450 over the tile; elevated deck at 450 only when coming along the deck', () => {
    const s = createTrackSurface(track([{ x: 5, z: 5, kind: 'ramp', rot: 0 }, { x: 5, z: 6, kind: 'elevated', rot: 0 }]));
    const mid = s.surfaceAt(centre(5), 0, centre(5));
    expect(mid.normal[1]).toBe(7499);
    expect(Math.round(mid.height)).toBe(225 + 2);
    const deck = s.surfaceAt(centre(5), 452, centre(6), [centre(5), 452, centre(6) - 30]);
    expect(deck.height).toBe(452);
    const fromSide = s.surfaceAt(centre(5), 452, centre(6), [centre(5) + 200, 452, centre(6)]);
    expect(fromSide.height).toBe(0); // fell off: the deck is only solid along it
    const below = s.surfaceAt(centre(5), 10, centre(6));
    expect(below.height).toBeLessThan(5);
  });

  it('hill tops lift everything by 450; water is water', () => {
    const hill: [number, number][] = [[5, 5], [6, 5], [5, 6], [6, 6]];
    const s = createTrackSurface(track([], hill, [[10, 10]]));
    expect(s.surfaceAt(centre(5), 500, centre(5)).height).toBeGreaterThanOrEqual(450);
    expect(s.surfaceAt(centre(10), 0, centre(10)).surface).toBe('water');
  });

  it('a slope tile carries a straight along it', () => {
    // Tile (5, 5) rises to the north: its north corners are hill tops.
    const s = createTrackSurface(track([{ x: 5, z: 5, kind: 'straight', rot: 0 }], [[5, 6], [6, 6]]));
    const p = s.surfaceAt(centre(5), 0, centre(5));
    expect(p.kind).toBe('road');
    expect(Math.round(p.height)).toBe(227);
  });
});
