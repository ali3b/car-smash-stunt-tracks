// Autopilot laps on every bundled track with every car, on the real simulation, headless (no browser). Prints a
// table (finish time + penalties, crashes) and fails if a track cannot be finished, or a car crashes more than once on
// a track.
//   npm run tracks:drive [-- --car car-touring] [--track mesa-madness] [--manual] [--lane 27] [--pace 0.6] [--verbose]
import fs from 'node:fs';
import path from 'node:path';
import { autoLap } from '../src/sim/autodrive';
import { TUNED_CARS } from '../src/sim/tunings';
import type { TrackFile } from '../src/track/types';
import { DESIGNS } from '../src/track/designs';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const verbose = args.includes('--verbose');
const lapOpts = { automatic: !args.includes('--manual'), lane: Number(opt('--lane') ?? 0), pace: Number(opt('--pace') ?? 0.8) };
const cars = opt('--car') ? [opt('--car')!] : TUNED_CARS;
const tracks = opt('--track') ? [opt('--track')!] : Object.keys(DESIGNS);
const load = (id: string): TrackFile => JSON.parse(fs.readFileSync(path.resolve('src/track/tracks', `${id}.json`), 'utf8'));

const short = (c: string) => c.replace(/^car-/, '');
const rows: string[] = [];
rows.push(['track'.padEnd(15), ...cars.map((c) => short(c).padStart(16))].join(' '));
let fail = false;
const notes: string[] = [];
for (const id of tracks) {
  const track = load(id);
  const cells: string[] = [];
  for (const car of cars) {
    const r = autoLap(track, car, lapOpts);
    const total = r.timeSeconds + r.penaltySeconds;
    const cell = r.finished ? `${total.toFixed(1)}s ${r.crashes}x` : `DNF ${r.section}/${r.sections}`;
    cells.push(cell.padStart(16));
    if (!r.finished) {
      fail = true;
      notes.push(`FAIL ${id} ${car}: did not finish (section ${r.section}/${r.sections}) crashes at ${r.crashAt.join(' ')}`);
    } else if (r.crashes > 1) {
      fail = true;
      notes.push(`FAIL ${id} ${car}: ${r.crashes} crashes (at ${r.crashAt.join(' ')})`);
    }
    if (verbose && (r.crashes || r.takeoffs.length)) notes.push(`  ${id} ${car}: take-offs ${r.takeoffs.join(' ')} mph; crashes at ${r.crashAt.join(' ') || '-'}`);
  }
  rows.push([id.padEnd(15), ...cells].join(' '));
  console.log(rows[rows.length - 1]);
}
console.log('\n' + rows.join('\n'));
if (notes.length) console.log('\n' + notes.join('\n'));
process.exit(fail ? 1 : 0);
