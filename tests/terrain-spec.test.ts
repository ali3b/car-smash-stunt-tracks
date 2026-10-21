// The generator terrain in ssg.models.json follows the bundled tracks (CS-FB-003): run `npm run terrain-specs` (or
// `npm run assets`) after changing a track's heights, water or pieces.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { TRACKS } from '../src/track/tracks';
import { apronEntry, clearTiles, terrainEntry, waterRows } from '../src/track/terrain-spec';
import type { TrackFile } from '../src/track/types';

const spec = JSON.parse(fs.readFileSync('ssg.models.json', 'utf8')) as { models: { name: string }[] };
const byName = new Map(spec.models.map((m) => [m.name, m]));

describe('terrain specs', () => {
  it('declares one terrain grid per bundled track, matching the track file', () => {
    for (const t of TRACKS) expect(byName.get(`terrain-${t.id}`), t.id).toEqual(terrainEntry(t.id, t.track));
  });

  it('declares an apron and a skydome per scenery set in use', () => {
    for (const set of new Set(TRACKS.map((t) => t.track.scenery))) {
      expect(byName.get(`apron-${set}`)).toEqual(apronEntry(set));
      expect(byName.has(`sky-${set}`), `sky-${set}`).toBe(true);
    }
  });

  it('turns our coast (the dry corner) into the generator coast (the water corner)', () => {
    const water: TrackFile['water'] = Array.from({ length: 30 }, () => Array.from({ length: 30 }, () => false));
    water[0][0] = true;
    water[0][1] = 'NE';
    water[1][0] = 'SW';
    const rows = waterRows({ water } as TrackFile);
    expect(rows[0]).toEqual(['w', 'SW', ...Array(28).fill('.')]);
    expect(rows[1]).toEqual(['NE', ...Array(29).fill('.')]);
    expect(rows[2]).toBe('.'.repeat(30));
  });

  it('keeps scatter off every tile a piece covers', () => {
    const t = TRACKS[0].track;
    const clear = new Set(clearTiles(t).map(([x, z]) => `${x},${z}`));
    for (const p of t.pieces) expect(clear.has(`${p.x},${p.z}`)).toBe(true);
  });
});
