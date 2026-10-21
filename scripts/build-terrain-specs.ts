// Writes the generator terrain of every bundled track into ssg.models.json (CS-FB-003): a `terrain-<id>` grid per
// track from its corner heights and water, and an `apron-<set>` per scenery set (src/track/terrain-spec.ts). Earlier
// terrain-*/apron-* entries are replaced; every other model is left as it is. `npm run assets` runs this first, so
// the terrain always follows the track files; tests/terrain-spec.test.ts fails when they drift apart.
//   node_modules/.bin/vite-node scripts/build-terrain-specs.ts [--check]
import fs from 'node:fs';
import path from 'node:path';
import { TRACKS } from '../src/track/tracks';
import { apronEntry, terrainEntry } from '../src/track/terrain-spec';
import type { Scenery } from '../src/track/types';

const file = path.resolve('ssg.models.json');
const spec = JSON.parse(fs.readFileSync(file, 'utf8')) as { models: { name: string }[] };
const generated = (n: string) => n.startsWith('terrain-') || n.startsWith('apron-');
const sets = [...new Set(TRACKS.map((t) => t.track.scenery))].sort() as Scenery[];
const entries = [...TRACKS.map((t) => terrainEntry(t.id, t.track)), ...sets.map(apronEntry)];
spec.models = [...spec.models.filter((m) => !generated(m.name)), ...entries];

/** Two-space JSON with arrays of plain values (heights rows, water rows, tile pairs) kept on one line. */
function format(v: unknown): string {
  return JSON.stringify(v, null, 2).replace(/\[\s*([^[\]{}]*?)\s*\]/g, (_, inner: string) => `[${inner.split(/,\s*/).join(', ')}]`) + '\n';
}

const text = format(spec);
if (process.argv.includes('--check')) {
  const same = fs.readFileSync(file, 'utf8') === text;
  console.log(same ? 'terrain specs: up to date' : 'terrain specs: ssg.models.json is out of date (run npm run terrain-specs)');
  process.exit(same ? 0 : 1);
}
fs.writeFileSync(file, text);
console.log(`terrain specs: ${entries.length} entries (${TRACKS.length} tracks, aprons: ${sets.join(', ')})`);
