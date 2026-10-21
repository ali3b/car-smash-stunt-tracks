// Loads tracks in the track scene and checks the piece placement: every piece drawn by a generator model must have
// its `out` socket on the catalogue's exit end (within 0.5 m), and every piece kind should have a model.
// Writes test-results/track-<name>.png per track (with --bundled also a straight-down view, track-<id>-top.png).
//   node scripts/track-check.mjs http://localhost:5197 [name ...]          default: every track in local-tracks/
//   node scripts/track-check.mjs http://localhost:5197 --bundled [id ...]  our bundled tracks (src/track/tracks/)
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const args = process.argv.slice(2);
const bundled = args.includes('--bundled');
const [base = 'http://localhost:5197', ...only] = args.filter((a) => a !== '--bundled');
const listDir = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : []);
const names = only.length ? only : listDir(bundled ? 'src/track/tracks' : 'local-tracks');
if (!names.length) {
  console.log(bundled ? 'track-check: no bundled tracks (node_modules/.bin/vite-node scripts/build-tracks.ts)' : 'track-check: no tracks (run node scripts/import-trk.mjs)');
  process.exit(0);
}
fs.mkdirSync('test-results', { recursive: true });
const env = { ...process.env };
delete env.DISPLAY;
delete env.WAYLAND_DISPLAY;
const browser = await chromium.launch({ env, args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let bad = 0;
const missing = new Set();
const param = bundled ? 'track' : 'local';
for (const name of names) {
  const errors = [];
  let t;
  for (const view of bundled ? ['', 'top'] : ['']) {
    const page = await browser.newPage({ viewport: view === 'top' ? { width: 1200, height: 1200 } : { width: 1280, height: 720 } });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(`${base}/?scene=track&${param}=${encodeURIComponent(name)}${view ? `&view=${view}` : ''}`);
    await page.waitForFunction(() => window.__cs?.ready || window.__cs?.error, null, { timeout: 120000 });
    t = await page.evaluate(() => window.__cs.track ?? { pieces: 0, models: 0, missing: [], issues: [], error: window.__cs.error });
    if (t.error) errors.push(t.error);
    await page.screenshot({ path: `test-results/track-${name}${view ? `-${view}` : ''}.png`, timeout: 120000 });
    await page.close();
  }
  for (const m of t.missing) missing.add(m);
  const issues = t.issues ?? [];
  if (issues.length || errors.length) bad++;
  console.log(`${name}: ${t.pieces} pieces, ${t.models} models, ${issues.length} misplaced${errors.length ? `, ${errors.length} errors` : ''}`);
  for (const i of issues.slice(0, 5)) console.log(`  ${i.model} at ${i.x},${i.z} rot ${i.rot}: out socket ${i.error} m off`);
  for (const e of [...new Set(errors)].slice(0, 3)) console.log(`  error: ${e}`);
}
await browser.close();
if (missing.size) console.log(`kinds drawn as placeholders: ${[...missing].sort().join(', ')}`);
console.log(bad ? `track-check: ${bad} of ${names.length} tracks have problems` : `track-check: ${names.length} tracks ok`);
process.exit(bad ? 1 : 0);
