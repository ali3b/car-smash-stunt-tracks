// Writes the track pieces whose drawn shape must follow the simulation's surface (src/sim/track-geometry.ts) into
// ssg.models.json (CS-FB-130): the loop (a 12-sided section whose lane drifts 400 units sideways) and the helix
// corkscrews (a constant climb of 19 units per 15° sector) as custom paths, the bank entries (the original's twist
// profile), the ramps (one grade, no eased ends) and the banked pieces (the road sheared, not turned: 240 units wide
// seen from above, the low edge on the ground), and the roll (a whole tube). The presets drew these as circles,
// eased climbs, turned decks and a twisting road, up to 5 m off the simulated surface. Each entry's `trackpiece` is
// replaced; everything else in the file is left as it is. `npm run assets` runs this after the terrain specs; scripts/piece-fit.ts measures the result against the
// simulation.
//   node_modules/.bin/vite-node scripts/build-piece-specs.ts [--check]
import fs from 'node:fs';
import path from 'node:path';
import { BANK_ENTRY, LOOP } from '../src/sim/track-geometry';
import { UNIT_M as U, HILL_UNITS, ROAD_UNITS } from '../src/track/types';

/** The generator's cell (ssg.models.json defaults.trackpiece.cell). */
const CELL = 62.42;

const r4 = (v: number) => Math.round(v * 10000) / 10000;
const deg = (rad: number) => (rad * 180) / Math.PI;
/** Corners of the simulation's polygons are drawn as arcs this tight (m): at most 0.06 m inside the corner. */
const CORNER = 1.5;
/** The banked road rises 130 over its 240-unit width (track-planes.ts BANK_RISE). */
const BANK_RISE = 130;
const bankAngle = (rise: number) => deg(Math.atan2(rise, ROAD_UNITS));
/** The drawn width that covers 240 units seen from above at a bank (the simulation shears the road). */
const bankWidth = (rise: number) => r4((ROAD_UNITS * U) / Math.cos(Math.atan2(rise, ROAD_UNITS)));

type Segment = Record<string, unknown>;

/**
 * The loop (CS-FB-130): the approach road, the section polygon (LOOP.planeProfile) up the far side and down the near
 * side with arcs of CORNER m at its corners, the lane drifting by laneX per face, and the exit road. The loop's lane
 * is 400 units wide; the approach and exit roads narrow back to the road's width.
 */
function loopPath(): Segment[] {
  const P = LOOP.planeProfile.map(([z, y]) => [z, y] as [number, number]);
  const LX = LOOP.laneX;
  const V: [number, number][] = [[-1024, 0], ...P, ...P.slice(0, 6).reverse().map(([z, y]): [number, number] => [-z, y]), [1024, 0]];
  // The lane's centre at each vertex, model x (+ left = -lx): up the far side u = lx, down the near side u = -lx.
  const centre = [...LX.map((l) => -(l + 200)), ...LX.slice(0, 6).reverse().map((l) => l + 200)];
  const xs = [0, ...centre.map((c) => c * U), 0];
  const head: number[] = [];
  for (let i = 0; i < V.length - 1; i++) head.push(Math.atan2(V[i + 1][1] - V[i][1], V[i + 1][0] - V[i][0]));
  for (let i = 1; i < head.length; i++) {
    while (head[i] - head[i - 1] < -Math.PI) head[i] += 2 * Math.PI;
    while (head[i] - head[i - 1] > Math.PI) head[i] -= 2 * Math.PI;
  }
  const turn = head.map((h, i) => (i ? h - head[i - 1] : 0));
  const cut = turn.map((t) => CORNER * Math.tan(Math.abs(t) / 2));
  const path: Segment[] = [];
  for (let i = 0; i < head.length; i++) {
    const len = Math.hypot(V[i + 1][1] - V[i][1], V[i + 1][0] - V[i][0]) * U - cut[i] - (cut[i + 1] ?? 0);
    const seg: Segment = { length: r4(len) };
    const shift = xs[i + 1] - xs[i];
    if (Math.abs(shift) > 1e-6) seg.shift = r4(shift);
    if (i === 0) Object.assign(seg, { profile: { width: r4(400 * U) }, blend: true });
    if (i === head.length - 1) Object.assign(seg, { profile: { width: r4(ROAD_UNITS * U) }, blend: true });
    path.push(seg);
    if (i + 1 < head.length) path.push({ length: r4(CORNER * Math.abs(turn[i + 1])), pitch: r4(deg(turn[i + 1])) });
  }
  return path;
}

/**
 * A helix corkscrew (CS-FB-130): a level tile, one turn round a 512-unit radius climbing 19 units per 15° sector
 * (the last sector 13, to 450), a level tile on top. Each climb is an exact helix (turn and roll at constant rates
 * from a pitched start), its grade set by short pitch arcs.
 */
function helixPath(left: boolean): Segment[] {
  const R = 512 * U;
  const sector = (2 * Math.PI * R) / 24;
  const sgn = left ? 1 : -1; // + turns left
  const parts: { sectors: number; rise: number }[] = [
    { sectors: 23, rise: 19 },
    { sectors: 1, rise: HILL_UNITS - 23 * 19 },
  ];
  const kink = 0.2; // m: the pitch arcs between grades (three of them, nearly straight: the level tiles give their length back)
  const path: Segment[] = [];
  let grade = 0;
  path.push({ length: r4(CELL - 1.5 * kink) });
  for (const p of parts) {
    const g = Math.atan2(p.rise * U, sector);
    path.push({ length: kink, pitch: r4(deg(g - grade)) });
    grade = g;
    const theta = 15 * p.sectors;
    // A vertical-axis helix in the path's frame: the turn shared between yaw (cos) and roll (sin) of the grade.
    const len = (sector * p.sectors) / Math.cos(g);
    path.push({ length: r4(len), turn: r4(sgn * theta * Math.cos(g)), roll: r4(-sgn * theta * Math.sin(g)) });
  }
  path.push({ length: kink, pitch: r4(deg(-grade)) });
  path.push({ length: r4(CELL - 1.5 * kink) });
  return path;
}

/**
 * A bank entry: level, then the original's twist (BANK_ENTRY.rise of the high edge at BANK_ENTRY.z), the low edge on
 * the ground; from z = 334 on the simulation is on the full bank's plane, so the bank snaps to it over a few cm.
 */
function bankEntryPath(sign: number): Segment[] {
  const snap = 0.1;
  const z = [-512, ...BANK_ENTRY.z, 512];
  const rise = [0, ...BANK_ENTRY.rise, BANK_RISE];
  const path: Segment[] = [];
  for (let i = 0; i + 1 < z.length; i++) {
    const last = i + 2 === z.length;
    const length = ((z[i + 1] - z[i]) * CELL) / 1024 - (last ? snap : 0);
    const bank = (r: number) => ({ bank: r4(sign * bankAngle(r)), profile: { width: bankWidth(r) }, blend: true });
    if (last) path.push({ length: snap, ...bank(BANK_RISE) }, { length: r4(length) });
    else path.push({ length: r4(length), ...(rise[i + 1] !== rise[i] ? bank(rise[i + 1]) : {}) });
  }
  return path;
}

const BANK = r4(bankAngle(BANK_RISE));
// CS-FB-130: data the presets should make from the simulation's shapes.
const PIECES: Record<string, Record<string, unknown>> = {
  'tp-loop': { footprint: [1, 2], path: loopPath() },
  // The simulation's left helix (entry on the west tile) turns right, and the other way round.
  'tp-corkscrew-helix-left': { footprint: [2, 2], path: helixPath(false) },
  'tp-corkscrew-helix-right': { footprint: [2, 2], path: helixPath(true) },
  'tp-bank-entry-a': { path: bankEntryPath(-1) },
  'tp-bank-entry-b': { path: bankEntryPath(1) },
  'tp-banked': { bank: BANK, width: bankWidth(BANK_RISE), path: [{ length: r4(CELL), bank: BANK }] },
  // Ramps: one constant grade, 450 over the tile (the simulation's ramp plane), kinked at its ends.
  // The roll: the simulation's roll is the pipe's twelve faces, each drivable over a stretch of the piece that moves
  // round from the right wall to the left (track-geometry.ts ROLL), so a car can take any line round the tube. A
  // twisting road (the barrel-roll preset) left the wheels up to 2.7 m off it on most frames of a run; a whole tube
  // has a deck wherever a face is.
  'tp-corkscrew-roll': { footprint: [1, 2], path: [{ length: r4(2 * CELL), profile: { shape: 'pipe', radius: r4(117.4 * U) } }] },
  'tp-ramp': { preset: 'slope-up', height: r4(HILL_UNITS * U), transition: 0 },
  'tp-ramp-solid': { preset: 'slope-up', height: r4(HILL_UNITS * U), transition: 0, supports: 'solid' },
  'tp-banked-corner': { preset: 'banked-curve-left', size: 2, bank: BANK, bankIn: BANK, bankOut: BANK, width: bankWidth(BANK_RISE) },
};

const file = path.resolve('ssg.models.json');
const spec = JSON.parse(fs.readFileSync(file, 'utf8')) as { models: { name: string; trackpiece?: unknown }[] };
for (const m of spec.models) if (PIECES[m.name]) m.trackpiece = PIECES[m.name];

/** The same layout as scripts/build-terrain-specs.ts: arrays of plain values kept on one line. */
function format(v: unknown): string {
  return JSON.stringify(v, null, 2).replace(/\[\s*([^[\]{}]*?)\s*\]/g, (_, inner: string) => `[${inner.split(/,\s*/).join(', ')}]`) + '\n';
}
const text = format(spec);
if (process.argv.includes('--check')) {
  const same = fs.readFileSync(file, 'utf8') === text;
  console.log(same ? 'piece specs: up to date' : 'piece specs: ssg.models.json is out of date (run vite-node scripts/build-piece-specs.ts)');
  process.exit(same ? 0 : 1);
}
fs.writeFileSync(file, text);
console.log(`piece specs: ${Object.keys(PIECES).join(', ')}`);
