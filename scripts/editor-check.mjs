// Drives the track editor like a player: builds a small closed circuit (with a loop) by clicking the palette and the
// grid, checks the validation (open while unfinished, closed when done), paints terrain and water, erases and
// undoes with the mouse and keyboard, imports a JSON file, and presses Test drive. Screenshots go to test-results/.
//   node scripts/editor-check.mjs http://localhost:5197
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5197';
fs.mkdirSync('test-results', { recursive: true });
const env = { ...process.env };
delete env.DISPLAY;
delete env.WAYLAND_DISPLAY;
const browser = await chromium.launch({ env, args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};

// A clean start: no work in progress from an earlier run.
await page.goto(`${base}/?scene=editor`);
await page.evaluate(() => localStorage.clear());
await page.goto(`${base}/?scene=editor`);
await page.waitForFunction(() => window.__cs?.ready || window.__cs?.error, null, { timeout: 60000 });
await page.waitForFunction(() => window.__cs.models !== undefined, null, { timeout: 120000 });
await page.click('#ed-new');

const at = (x, z) => page.evaluate(([x, z]) => window.__cs.editor.tileToClient(x, z), [x, z]);
const report = () => page.evaluate(() => {
  const r = window.__cs.editor.report();
  return { status: r.circuit.status, length: r.circuit.route.length, message: r.circuit.message, issues: r.issues.map((i) => i.message) };
});
let rot = 0;
async function place(kind, x, z, wantRot, variant) {
  await page.click(`.ed-item[data-kind="${kind}"]${variant ? `[data-variant="${variant}"]` : ''}`);
  for (; rot !== wantRot; rot = (rot + 1) % 4) await page.keyboard.press('r');
  const p = await at(x, z);
  await page.mouse.click(p.x, p.y);
}

// The circuit: start-finish heading north at (10,11), round a 3×4 rectangle, with a loop on the east side.
await place('start-finish', 10, 11, 0);
await place('straight', 10, 12, 0);
await place('corner-small', 10, 13, 3);
await place('straight', 11, 13, 1);
await place('corner-small', 12, 13, 0);
let r = await report();
check(r.status === 'open', `unfinished circuit is open: ${r.message}`);
await page.screenshot({ path: 'test-results/editor-open.png' });
await place('loop', 12, 11, 0);
await place('corner-small', 12, 10, 1);
await place('straight', 11, 10, 1);
await place('corner-small', 10, 10, 2);
r = await report();
check(r.status === 'closed' && r.length === 9, `circuit closed with 9 pieces (${r.status}, ${r.length}: ${r.message})`);
check(r.issues.length === 0, `no issues (${r.issues.join(' / ')})`);
const verdict = await page.textContent('#ed-verdict');
check(/CIRCUIT CLOSED/.test(verdict), `verdict panel says closed (“${verdict.trim()}”)`);

// Overlap: placing a straight on the loop is refused; Shift-click replaces, Ctrl+Z puts the loop back.
await place('straight', 12, 12, 0);
let n = await page.evaluate(() => window.__cs.editor.doc.track.pieces.length);
check(n === 9, 'placing onto the loop is refused');
await page.keyboard.down('Shift');
await page.mouse.click(...Object.values(await at(12, 12)));
await page.keyboard.up('Shift');
r = await report();
check(r.status !== 'closed', `shift-click replaced the loop: ${r.message}`);
await page.keyboard.press('Control+z');
r = await report();
check(r.status === 'closed', 'undo restores the loop');

// Right-click erases; the report finds the gap; undo.
const s = await at(11, 13);
await page.mouse.click(s.x, s.y, { button: 'right' });
r = await report();
check(r.status === 'open' && /11,13|10,13|12,13/.test(r.message), `erasing a straight opens the circuit: ${r.message}`);
await page.keyboard.press('Control+z');

// Select tool: click a piece, rotate it with R (breaks the circuit), rotate back.
await page.keyboard.press('1');
await page.mouse.click(...Object.values(await at(11, 10)));
await page.keyboard.press('r');
r = await report();
check(r.status !== 'closed', `rotating a straight across breaks the circuit: ${r.message}`);
await page.keyboard.press('Shift+R');
r = await report();
check(r.status === 'closed', 'rotating back closes it');
await page.keyboard.press('Escape');

// Terrain: a hill plateau, a corner slope, a lake with a coast; a straight can't go on the uneven corner.
await page.keyboard.press('4');
for (const [x, z] of [[18, 18], [19, 18], [20, 18], [18, 19], [19, 19], [20, 19]]) await page.mouse.click(...Object.values(await at(x, z)));
await page.keyboard.press('8');
const w0 = await at(4, 5);
const w1 = await at(7, 5);
await page.mouse.move(w0.x, w0.y);
await page.mouse.down();
await page.mouse.move(w1.x, w1.y, { steps: 6 });
await page.mouse.up();
await page.keyboard.press('9');
await page.mouse.click(w0.x + 20, w0.y);
const terrain = await page.evaluate(() => {
  const t = window.__cs.editor.doc.track;
  return { hill: t.heights[18][18] + t.heights[20][21], water: t.water[5].slice(4, 8), coast: t.water[5][5] };
});
check(terrain.hill === 2, 'hill tool raised the plateau corners');
check(terrain.water[0] === true && terrain.water[3] === true, `water painted by dragging (${JSON.stringify(terrain.water)})`);
await page.click('.ed-item[data-kind="straight"]');
await page.mouse.click(...Object.values(await at(4, 5)));
n = await page.evaluate(() => window.__cs.editor.doc.track.pieces.length);
check(n === 9, 'a road is refused in water');
const msg = await page.textContent('#ed-msg');
check(/water/.test(msg), `status explains why (“${msg}”)`);
// Scenery near the circuit.
await place('scenery', 14, 12, rot, 'tree');
await place('scenery', 8, 11, rot, 'barn');

await page.waitForTimeout(800);
await page.screenshot({ path: 'test-results/editor.png' });
// Zoom in on the circuit with the wheel (the tile under the cursor stays put), screenshot, then fit again.
const c0 = await at(11, 12);
await page.mouse.move(c0.x, c0.y);
for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -200);
const c1 = await at(11, 12);
check(Math.hypot(c1.x - c0.x, c1.y - c0.y) < 4, 'wheel zoom keeps the tile under the cursor');
await page.keyboard.press('1');
await page.mouse.click(...Object.values(await at(12, 11)));
await page.waitForTimeout(300);
await page.screenshot({ path: 'test-results/editor-zoom.png' });
await page.keyboard.press('Escape');
await page.keyboard.press('Home');
const stats = await page.evaluate(() => window.__cs.editor.preview());
check(stats.reused > 0, `3D preview rebuilds only changed pieces (last update: ${stats.built} built, ${stats.reused} reused)`);

// Save, reload: the work in progress survives; the saved track is in the Open menu.
await page.fill('#ed-name', 'check circuit');
await page.press('#ed-name', 'Enter');
await page.keyboard.press('Control+s');
await page.reload();
await page.waitForFunction(() => window.__cs?.ready);
r = await report();
check(r.status === 'closed', 'work in progress survives a reload');
const listed = await page.waitForSelector('#ed-open option[value="saved:check circuit"]', { state: 'attached', timeout: 5000 }).catch(() => null);
check(!!listed, 'saved track listed under Open');

// Import a JSON file (an open track) and back.
const json = await page.evaluate(() => JSON.stringify({ ...window.__cs.editor.doc.track, name: 'imported', pieces: window.__cs.editor.doc.track.pieces.slice(0, 3) }));
fs.writeFileSync('test-results/editor-import.json', json);
await page.setInputFiles('#ed-file', 'test-results/editor-import.json');
await page.waitForFunction(() => window.__cs.editor.doc.track.name === 'imported');
r = await report();
check(r.status === 'open', `imported track loaded (${r.message})`);
await page.selectOption('#ed-open', 'saved:check circuit');
await page.waitForFunction(() => window.__cs.editor.doc.track.name === 'check circuit');

// Test drive hands the track to the race scene.
await page.click('#ed-drive');
await page.waitForURL(/scene=race&track=custom/);
const custom = await page.evaluate(() => JSON.parse(localStorage.getItem('cs.customTrack') ?? 'null'));
check(custom?.name === 'check circuit' && custom.pieces.length >= 9, 'test drive stored cs.customTrack and opened the race scene');

// The reference tracks open from the menu in dev (when local-tracks/ exists).
await page.goto(`${base}/?scene=editor`);
await page.waitForFunction(() => window.__cs?.ready);
await page.waitForTimeout(1000); // the Open menu lists the reference tracks once the dev server answers
const local = await page.$$eval('#ed-open option', (o) => o.map((x) => x.value).filter((v) => v.startsWith('local:')));
if (local.length) {
  const name = local.includes('local:default') ? 'local:default' : local[0];
  await page.selectOption('#ed-open', name);
  await page.waitForFunction((n) => window.__cs.editor.doc.track.name === n, name.slice(6));
  await page.waitForTimeout(1500);
  r = await report();
  check(r.status === 'closed', `reference track ${name.slice(6)}: ${r.message}`);
  await page.screenshot({ path: 'test-results/editor-reference.png' });
}

const real = errors.filter((e) => !/unknown scene "race"/.test(e));
check(real.length === 0, `no page errors${real.length ? `: ${real.slice(0, 3).join(' | ')}` : ''}`);
await browser.close();
console.log(failures ? `editor-check: ${failures} failed` : 'editor-check: ok');
process.exit(failures ? 1 : 0);
