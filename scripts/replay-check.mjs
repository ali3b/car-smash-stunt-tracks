// Plays the original's replays in the replay scene (dev only: needs re/out/golden/ and local-tracks/rpl-*.json) and
// screenshots each camera at a few moments: test-results/replay-<NAME>-<t>s-<camera>.png. Fails on page errors.
// Also prints the renderer's draw calls / triangles and the frame rate on SwiftShader.
//   node scripts/replay-check.mjs http://localhost:5197 [NAME[@t1,t2,...] ...]     default: DEFAULT@12,40,70
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const [base = 'http://localhost:5197', ...args] = process.argv.slice(2);
if (!fs.existsSync('re/out/golden')) {
  console.log('replay-check: no re/out/golden (run re/tools/emu.py); skipped');
  process.exit(0);
}
const runs = (args.length ? args : ['DEFAULT@12,40,70']).map((a) => {
  const [name, ts] = a.split('@');
  return { name, times: (ts ?? '10,30').split(',').map(Number) };
});
const CAMS = (process.env.CAMS ?? 'chase,cockpit,tv').split(',');
fs.mkdirSync('test-results', { recursive: true });
const env = { ...process.env };
delete env.DISPLAY;
delete env.WAYLAND_DISPLAY;
const browser = await chromium.launch({ env, args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let bad = 0;
for (const { name, times } of runs) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  const t0 = Date.now();
  await page.goto(`${base}/?scene=replay&golden=${encodeURIComponent(name)}&paused`);
  await page.waitForFunction(() => window.__cs?.ready || window.__cs?.error, null, { timeout: 180000 });
  const err = await page.evaluate(() => window.__cs.error);
  if (err) errors.push(err);
  const info = err ? null : await page.evaluate(() => ({ ...window.__cs.replay, seek: undefined, play: undefined, perf: undefined }));
  console.log(`${name}: ${JSON.stringify(info)} (loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  if (!err) {
    // Stop the render loop while posing: SwiftShader frames are slow, seek() renders the frame itself.
    await page.evaluate(() => window.__cs.loop.stop());
    for (const t of times) {
      for (const cam of CAMS) {
        const d = await page.evaluate(([t, cam]) => window.__cs.replay.seek(t, cam), [t, cam]);
        await page.waitForTimeout(150);
        const file = `test-results/replay-${name.replace(/\W/g, '_')}-${t}s-${cam}.png`;
        await page.screenshot({ path: file, timeout: 180000 });
        console.log(`  ${t}s ${d} → ${file}`);
      }
    }
    // Frame rate while playing (SwiftShader: a CPU renderer, so only a relative number).
    await page.evaluate(() => window.__cs.replay.seek(20, 'chase'));
    await page.evaluate(() => {
      window.__cs.replay.play();
      window.__cs.loop.start();
    });
    await page.waitForTimeout(3000);
    const perf = await page.evaluate(() => ({ fps: +window.__cs.loop.fps.toFixed(1), ...window.__cs.replay.perf() }));
    console.log(`  perf ${JSON.stringify(perf)}`);
  }
  for (const e of errors.slice(0, 5)) console.log(`  error: ${e}`);
  if (errors.length) bad++;
  await page.close();
}
await browser.close();
console.log(bad ? `replay-check: ${bad} replays with errors` : `replay-check: ${runs.length} replays ok`);
process.exit(bad ? 1 : 0);
