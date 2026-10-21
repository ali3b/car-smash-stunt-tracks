// The README / gallery screenshots, taken from the running game on our own bundled tracks only:
// docs/screenshots/{title,track-select,race-chase,race-incar,loop,dos-look,editor}.png (1280×720).
//   node scripts/screenshots.mjs [http://localhost:5197]
// Headless on SwiftShader, never on the desktop's display or GPU.
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const [base = 'http://localhost:5197'] = process.argv.slice(2);
const out = 'docs/screenshots';
fs.mkdirSync(out, { recursive: true });
const env = { ...process.env };
delete env.DISPLAY;
delete env.WAYLAND_DISPLAY;
const browser = await chromium.launch({ env, args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const flow = (fn, arg) => page.evaluate(([f, a]) => new Function('f', 'a', `return (${f})(f, a)`)(window.__cs.flow, a), [fn.toString(), arg]);
const state = () => flow((f) => f.state());
const waitState = async (want, timeout = 60000) => {
  const t0 = Date.now();
  while ((await state()) !== want) {
    if (Date.now() - t0 > timeout) throw new Error(`expected state ${want}, got ${await state()}`);
    await page.waitForTimeout(100);
  }
};
const shot = async (name, wait = 400) => {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`  ${out}/${name}.png`);
};
/** Race on autopilot until test(stats, snapshot) holds (or the race ends). */
const driveUntil = async (test, maxSeconds = 300) => {
  for (let t = 0; t < maxSeconds && (await state()) === 'race'; t += 0.1) {
    await flow((f) => f.advance(0.1));
    const s = await flow((f) => f.session()?.stats?.() ?? null);
    const snap = await flow((f) => f.snapshot());
    if (s && snap && test(s, snap)) return true;
  }
  return false;
};
const camera = (cam) => flow((f, c) => { for (let i = 0; i < 4 && f.camera() !== c; i++) f.nextCamera(); }, cam);

try {
  await page.goto(`${base}/?scene=game`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.__cs?.ready, null, { timeout: 60000 });
  await waitState('title');
  await shot('title', 9000);

  await flow((f) => f.go.car('race'));
  await waitState('car');
  await flow((f) => f.press('confirm'));
  await waitState('track');
  await flow((f) => f.press('down'));
  await flow((f) => f.press('down'));
  await flow((f) => f.press('down'));
  await flow((f) => f.press('down'));
  await flow((f) => f.press('down'));
  await shot('track-select', 2500);

  // Skyline Stunts against a rival, chase cam then in-car.
  await flow((f) => f.go.race({ trackId: 'skyline-stunts', carId: 'car-super', opponentId: 'nova', gearbox: 'auto' }));
  await waitState('race');
  await flow((f) => (f.skipCountdown(), f.autopilot(true)));
  await camera('chase');
  await flow((f) => f.advance(5));
  await shot('race-chase');
  await camera('cockpit');
  await flow((f) => f.advance(3));
  await shot('race-incar');

  // Lagoon Leap: the loop, from the track-side (TV) cameras, near its top.
  await flow((f) => f.go.race({ trackId: 'lagoon-leap', carId: 'car-rally', opponentId: null, gearbox: 'auto' }));
  await waitState('race');
  await flow((f) => (f.skipCountdown(), f.autopilot(true)));
  await camera('tv');
  if (await driveUntil((s, snap) => s.kind === 'loop' && snap.player.pos[1] > 25)) await shot('loop');
  else console.warn('  no loop moment found');

  // The DOS look (F2), on the next stretch.
  await camera('chase');
  await flow((f) => f.advance(4));
  await page.keyboard.press('F2');
  await shot('dos-look', 800);
  await page.keyboard.press('F2');
  await page.keyboard.press('F2');
  await flow((f) => f.autopilot(false));

  // The editor with a bundled track open.
  await page.goto(`${base}/?scene=editor`);
  await page.waitForFunction(() => window.__cs?.ready, null, { timeout: 60000 });
  const v = await page.evaluate(() => [...document.querySelectorAll('#ed-open option')].map((o) => o.value).find((x) => /^bundled:.*harvest/i.test(x)));
  if (v) await page.selectOption('#ed-open', v);
  await shot('editor', 3000);
} catch (e) {
  errors.push(String(e));
}
await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('screenshots: ok');
