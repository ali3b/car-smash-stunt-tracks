// Builds our bundled tracks from their designs (src/track/designs/*.ts, written with src/track/author.ts), validates
// each one (src/track/validate.ts) and writes src/track/tracks/<id>.json. Prints a map of each track and which
// piece kinds and props the set uses.
//   node_modules/.bin/vite-node scripts/build-tracks.ts [--map] [id ...]
import fs from 'node:fs';
import path from 'node:path';
import { DESIGNS } from '../src/track/designs';
import { TRACKS } from '../src/track/tracks';
import { TrackBuilder } from '../src/track/author';
import { validateTrack } from '../src/track/validate';
import { pieceDef, rotatedFootprint } from '../src/track/pieces';
import type { PieceKind, TrackFile } from '../src/track/types';

const args = process.argv.slice(2);
const showMap = args.includes('--map');
const only = args.filter((a) => !a.startsWith('--'));
const out = path.resolve('src/track/tracks');

const ABBR: Partial<Record<PieceKind, string>> = {
  'start-finish': 'SF', straight: '──', 'corner-small': 'c ', 'corner-large': 'C ', elevated: 'E ', 'elevated-solid': 'Es',
  'elevated-span': 'Ep', 'elevated-span-over-road': 'Eo', 'elevated-corner': 'EC', ramp: 'R ', 'ramp-solid': 'Rs',
  'ramp-bridge': 'Rb', 'bank-entry': 'B>', banked: 'B ', 'banked-corner': 'BC', chicane: 'CH', loop: 'LP', tunnel: 'TU',
  pipe: 'P ', 'pipe-entry': 'P>', 'pipe-obstacle': 'Po', crossroads: '++', 'split-small': 'Y ', 'split-large': 'YY',
  'corkscrew-roll': 'CR', 'corkscrew-helix': 'HX', highway: 'H ', 'highway-entry': 'H>', slalom: 'SL', scenery: '* ',
};

function map(t: TrackFile): string {
  const g = Array.from({ length: 30 }, (_, z) => Array.from({ length: 30 }, (_, x) => (t.water[z][x] ? '~~' : t.heights[z][x] + t.heights[z][x + 1] + t.heights[z + 1][x] + t.heights[z + 1][x + 1] ? '^^' : ' .')));
  for (const p of t.pieces) {
    const [w, d] = rotatedFootprint(pieceDef(p)!, p.rot);
    for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) g[p.z + dz][p.x + dx] = dx || dz ? '::' : ABBR[p.kind] ?? '??';
  }
  const rows = g.map((r, z) => `${String(z).padStart(2)} ${r.join('')}`).reverse();
  rows.push(`   ${Array.from({ length: 30 }, (_, x) => String(x).padStart(2)).join('')}`);
  return rows.join('\n');
}

fs.mkdirSync(out, { recursive: true });
const kinds = new Set<string>();
const props = new Set<string>();
let bad = 0;
for (const meta of TRACKS) {
  if (only.length && !only.includes(meta.id)) continue;
  const design = DESIGNS[meta.id];
  if (!design) {
    console.log(`${meta.id}: no design`);
    bad++;
    continue;
  }
  let t: TrackFile;
  try {
    t = design();
  } catch (e) {
    if (TrackBuilder.last) console.log(map(TrackBuilder.last.track));
    console.log(`${meta.id}: ${(e as Error).message}`);
    bad++;
    continue;
  }
  const v = validateTrack(t);
  for (const p of t.pieces) (p.kind === 'scenery' ? props : kinds).add(p.kind === 'scenery' ? p.variant! : p.kind);
  if (showMap || !v.ok) console.log(map(t));
  console.log(`${meta.id} "${t.name}" (${t.scenery}): ${t.pieces.length} pieces, lap ${v.lap.pieces} pieces / ${v.lap.tiles} tiles, ${v.lap.jumps.length} jumps${v.ok ? ', ok' : ''}`);
  for (const e of v.errors) console.log(`  error: ${e}`);
  for (const w of v.warnings) console.log(`  warning: ${w}`);
  if (!v.ok) {
    bad++;
    continue;
  }
  fs.writeFileSync(path.join(out, `${meta.id}.json`), JSON.stringify(t) + '\n');
}
const ALL: PieceKind[] = ['start-finish', 'straight', 'corner-small', 'corner-large', 'elevated', 'elevated-solid', 'elevated-span', 'elevated-span-over-road', 'elevated-corner', 'ramp', 'ramp-solid', 'ramp-bridge', 'bank-entry', 'banked', 'banked-corner', 'chicane', 'loop', 'tunnel', 'pipe', 'pipe-entry', 'pipe-obstacle', 'crossroads', 'split-small', 'split-large', 'corkscrew-roll', 'corkscrew-helix', 'highway', 'highway-entry', 'slalom'];
const unused = ALL.filter((k) => !kinds.has(k));
const PROPS = ['palm', 'cactus', 'tree', 'tennis-court', 'gas-station', 'barn', 'office', 'windmill', 'boat', 'diner'];
const unusedProps = PROPS.filter((k) => !props.has(k));
if (!only.length) {
  console.log(unused.length ? `kinds not used: ${unused.join(', ')}` : 'every piece kind is used');
  console.log(unusedProps.length ? `props not used: ${unusedProps.join(', ')}` : 'every prop is used');
}
process.exit(bad ? 1 : 0);
