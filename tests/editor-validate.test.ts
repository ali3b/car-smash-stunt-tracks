// Circuit following and track validation (src/track/validate.ts) on small hand-built tracks, and on the local
// reference tracks when they are present (dev only; skipped otherwise).
import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import { emptyTrack } from '../src/editor/doc';
import { followCircuit, terrainProblem, validateTrack } from '../src/track/validate';
import type { Piece, PieceKind, Rot, TrackFile } from '../src/track/types';

type Item = { kind: PieceKind; rot?: Rot; variant?: string } | 'gap';

/**
 * A rectangle circuit: the west side (x = 10) runs north from z = 11 through `column` (start-finish first; a loop
 * takes two tiles, 'gap' leaves a tile empty), then the top, the east side (x = 12) and the bottom back to the start.
 */
function rectangle(column: Item[]): TrackFile {
  const t = emptyTrack('test');
  const p = (x: number, z: number, kind: PieceKind, rot: Rot = 0, variant?: string): Piece => ({ x, z, kind, rot, ...(variant ? { variant } : {}) });
  let z = 11;
  for (const item of column) {
    if (item === 'gap') {
      z++;
      continue;
    }
    t.pieces.push(p(10, z, item.kind, item.rot ?? 0, item.variant));
    z += item.kind === 'loop' || item.kind === 'corkscrew-roll' ? 2 : 1;
  }
  const top = z;
  t.pieces.push(p(10, top, 'corner-small', 3), p(11, top, 'straight', 1), p(12, top, 'corner-small', 0));
  for (let e = top - 1; e > 10; e--) t.pieces.push(p(12, e, 'straight', 0));
  t.pieces.push(p(12, 10, 'corner-small', 1), p(11, 10, 'straight', 1), p(10, 10, 'corner-small', 2));
  return t;
}

const S = { kind: 'start-finish' } as const;
const road = { kind: 'straight' } as const;

describe('circuit following', () => {
  test('no start line', () => {
    expect(followCircuit(emptyTrack()).status).toBe('no-start');
  });

  test('a plain rectangle is closed and visits every piece once', () => {
    const t = rectangle([S, road, road]);
    const c = followCircuit(t);
    expect(c.status).toBe('closed');
    expect(c.route.length).toBe(t.pieces.length);
    expect(new Set(c.route.map((s) => s.piece)).size).toBe(t.pieces.length);
  });

  test('a loop in the line (a 1×2 piece) keeps it closed', () => {
    expect(followCircuit(rectangle([S, { kind: 'loop' }, road])).status).toBe('closed');
  });

  test('a missing piece is an open end at the last tile, facing the gap', () => {
    const t = rectangle([S, road, road]);
    t.pieces = t.pieces.filter((p) => !(p.x === 11 && p.z === 14));
    const c = followCircuit(t);
    expect(c.status).toBe('open');
    expect(c.at).toEqual({ x: 10, z: 14 });
    expect(c.message).toBe('open end at 10,14 (facing E)');
  });

  test('a road running into the side of a piece is blocked', () => {
    const t = rectangle([S, road, road]);
    t.pieces.find((p) => p.x === 10 && p.z === 12)!.rot = 1;
    const c = followCircuit(t);
    expect(c.status).toBe('blocked');
    expect(c.message).toMatch(/runs into the side of the straight at 10,12/);
  });

  test('ground meeting an elevated deck is a level mismatch', () => {
    const c = followCircuit(rectangle([S, road, { kind: 'elevated' }, road]));
    expect(c.status).toBe('mismatch');
    expect(c.message).toBe('level mismatch at 10,13: ground meets elevated');
  });

  test('ramp up, deck, ramp down is closed', () => {
    expect(followCircuit(rectangle([S, { kind: 'ramp' }, { kind: 'elevated' }, { kind: 'ramp', rot: 2 }, road])).status).toBe('closed');
  });

  test('a jump: ramp up, two empty tiles, a ramp facing back is a flying gap', () => {
    const c = followCircuit(rectangle([S, { kind: 'ramp' }, 'gap', 'gap', { kind: 'ramp', rot: 2 }, road]));
    expect(c.status).toBe('closed');
    expect(c.jumps).toEqual([{ from: { x: 10, z: 12 }, to: { x: 10, z: 15 }, gap: 2 }]);
    expect(c.route.find((s) => s.jump)?.piece).toBeDefined();
  });

  test('a gap longer than a jump is an open end', () => {
    const c = followCircuit(rectangle([S, { kind: 'ramp' }, 'gap', 'gap', 'gap', 'gap', { kind: 'ramp', rot: 2 }, road]));
    expect(c.status).toBe('open');
    expect(c.at).toEqual({ x: 10, z: 12 });
  });

  test('a ground road ending in a gap does not fly', () => {
    expect(followCircuit(rectangle([S, road, 'gap', road])).status).toBe('open');
  });

  test('banking: a bank laid the other way round meets the entry; laid the same way it does not', () => {
    const out = { kind: 'bank-entry', variant: 'b', rot: 2 } as const;
    expect(followCircuit(rectangle([S, { kind: 'bank-entry', variant: 'a' }, { kind: 'banked', rot: 2 }, out, road])).status).toBe('closed');
    const c = followCircuit(rectangle([S, { kind: 'bank-entry', variant: 'a' }, { kind: 'banked' }, out, road]));
    expect(c.status).toBe('mismatch');
    expect(c.message).toMatch(/banked .* meets banked/);
  });

  test('pipe meets pipe, not ground', () => {
    expect(followCircuit(rectangle([S, { kind: 'pipe-entry' }, { kind: 'pipe' }, { kind: 'pipe-entry', rot: 2 }, road])).status).toBe('closed');
    expect(followCircuit(rectangle([S, { kind: 'pipe-entry' }, road])).status).toBe('mismatch');
  });

  test('a crossroads is driven straight through', () => {
    expect(followCircuit(rectangle([S, { kind: 'crossroads' }, road])).status).toBe('closed');
  });

  test('at a fork the leg that closes the circuit is taken', () => {
    // Start heading north at (10,11); the fork's straight leg (north) leads nowhere, its west leg loops back.
    const t = emptyTrack();
    t.pieces = [
      { x: 10, z: 11, kind: 'start-finish', rot: 0 },
      { x: 10, z: 12, kind: 'split-small', variant: 'a', rot: 0 },
      { x: 9, z: 12, kind: 'corner-small', rot: 3 },
      { x: 9, z: 11, kind: 'straight', rot: 0 },
      { x: 9, z: 10, kind: 'corner-small', rot: 2 },
      { x: 10, z: 10, kind: 'corner-small', rot: 1 },
    ];
    const c = followCircuit(t);
    expect(c.status).toBe('closed');
    expect(c.route.length).toBe(6);
  });

  test('a start line laid the other way round drives the circuit the other way', () => {
    const t = rectangle([S, road, road]);
    t.pieces.find((p) => p.kind === 'start-finish')!.rot = 2;
    const c = followCircuit(t);
    expect(c.status).toBe('closed');
    expect(c.route[1].piece).toBe(t.pieces.findIndex((p) => p.x === 10 && p.z === 10));
  });
});

describe('validation report', () => {
  test('a good track has no issues', () => {
    const r = validateTrack(rectangle([S, road, road]));
    expect(r.issues).toEqual([]);
    expect(r.circuit.status).toBe('closed');
  });

  test('exactly one start-finish line', () => {
    const t = rectangle([S, road, road]);
    expect(validateTrack({ ...t, pieces: t.pieces.filter((p) => p.kind !== 'start-finish') }).issues[0].message).toMatch(/No start-finish/);
    t.pieces.find((p) => p.x === 12 && p.z === 12)!.kind = 'start-finish';
    const r = validateTrack(t);
    expect(r.issues.some((i) => i.severity === 'error' && /Extra start-finish line at 12,12/.test(i.message))).toBe(true);
  });

  test('overlapping pieces are errors', () => {
    const t = rectangle([S, road, road]);
    t.pieces.push({ x: 11, z: 11, kind: 'corner-large', rot: 0 });
    const r = validateTrack(t);
    expect(r.issues.filter((i) => /overlap/.test(i.message)).map((i) => i.at)).toEqual([
      { x: 12, z: 11 },
      { x: 12, z: 12 },
    ]);
  });

  test('loose road pieces are a warning; scenery is not', () => {
    const t = rectangle([S, road, road]);
    t.pieces.push({ x: 20, z: 20, kind: 'straight', rot: 0 }, { x: 21, z: 20, kind: 'scenery', rot: 0, variant: 'tree' });
    const r = validateTrack(t);
    expect(r.issues.map((i) => i.message)).toEqual(['1 road piece isn’t connected to the circuit.']);
    expect(r.issues[0].severity).toBe('warning');
  });
});

describe('terrain rules', () => {
  const slopeNS = () => {
    const t = emptyTrack();
    t.heights[6][5] = t.heights[6][6] = 1; // tile (5,5) rises to the north
    return t;
  };

  test('a straight climbs a slope along it, not across it', () => {
    expect(terrainProblem(slopeNS(), { x: 5, z: 5, kind: 'straight', rot: 0 })).toBeNull();
    expect(terrainProblem(slopeNS(), { x: 5, z: 5, kind: 'straight', rot: 1 })).toMatch(/not across/);
    expect(terrainProblem(slopeNS(), { x: 5, z: 5, kind: 'corner-small', rot: 0 })).toMatch(/only a plain straight/);
    expect(terrainProblem(slopeNS(), { x: 5, z: 5, kind: 'elevated', rot: 0 })).toMatch(/only a plain straight/);
  });

  test('a ramp on a slope runs down off the hill top (the simulation makes it a level deck)', () => {
    // Tile (5,5) rises to the north: a ramp's ground end must be on the north (high) side.
    expect(terrainProblem(slopeNS(), { x: 5, z: 5, kind: 'ramp', rot: 2 })).toBeNull();
    expect(terrainProblem(slopeNS(), { x: 5, z: 5, kind: 'ramp', rot: 0 })).toMatch(/off the hill top/);
    expect(terrainProblem(slopeNS(), { x: 5, z: 5, kind: 'ramp', rot: 1 })).toMatch(/off the hill top/);
  });

  test('uneven tiles take scenery only', () => {
    const t = emptyTrack();
    t.heights[6][6] = 1;
    expect(terrainProblem(t, { x: 5, z: 5, kind: 'straight', rot: 0 })).toMatch(/uneven/);
    expect(terrainProblem(t, { x: 5, z: 5, kind: 'scenery', rot: 0, variant: 'tree' })).toBeNull();
  });

  test('elevated pieces need ground level beneath; roads on a hill top are fine', () => {
    const t = emptyTrack();
    for (const [x, z] of [[5, 5], [6, 5], [5, 6], [6, 6]]) t.heights[z][x] = 1;
    expect(terrainProblem(t, { x: 5, z: 5, kind: 'straight', rot: 0 })).toBeNull();
    expect(terrainProblem(t, { x: 5, z: 5, kind: 'elevated', rot: 0 })).toMatch(/clearance/);
    expect(terrainProblem(t, { x: 5, z: 5, kind: 'ramp', rot: 0 })).toMatch(/clearance/);
  });

  test('water: roads no, elevated decks yes', () => {
    const t = emptyTrack();
    t.water[5][5] = true;
    t.water[5][6] = 'NE';
    expect(terrainProblem(t, { x: 5, z: 5, kind: 'straight', rot: 0 })).toMatch(/water/);
    expect(terrainProblem(t, { x: 6, z: 5, kind: 'straight', rot: 0 })).toMatch(/coast/);
    expect(terrainProblem(t, { x: 5, z: 5, kind: 'elevated', rot: 0 })).toBeNull();
    expect(terrainProblem(t, { x: 5, z: 5, kind: 'ramp', rot: 0 })).toMatch(/water/);
  });
});

// The 1990 original's tracks, converted locally (scripts/import-trk.mjs; git-ignored). These are known to be closed
// circuits in the original, so they check the follower's reading of the catalogue (forks, jumps, banking).
const LOCAL = 'local-tracks';
const CLOSED = ['bigoval', 'default', 'dirt', 'ice', 'lost', 'oval', 'roadrace', 'slalom', 'slalom2', 'the_city', 'viol8', 'violator', 'denizzz'];
describe.skipIf(!fs.existsSync(LOCAL))('reference tracks', () => {
  for (const name of CLOSED)
    test.skipIf(!fs.existsSync(`${LOCAL}/${name}.json`))(`${name} is a closed circuit`, () => {
      const t = JSON.parse(fs.readFileSync(`${LOCAL}/${name}.json`, 'utf8')) as TrackFile;
      const c = followCircuit(t);
      expect(c.message).toMatch(/^closed circuit/);
    });
});
