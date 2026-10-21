// Smoke test of one scene: no page or console errors, window.__cs.ready within 60 s; writes test-results/<scene>.png.
//   node scripts/load-check.mjs http://localhost:5197 [scene] [extra=query]
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const [base = 'http://localhost:5197', scene = 'garage', ...extra] = process.argv.slice(2);
const url = `${base}/?scene=${scene}${extra.map((e) => `&${e}`).join('')}`;
fs.mkdirSync('test-results', { recursive: true });
// Headless on SwiftShader, never on the desktop's display or GPU.
const env = { ...process.env };
delete env.DISPLAY;
delete env.WAYLAND_DISPLAY;
const browser = await chromium.launch({ env, args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
await page.goto(url);
await page.waitForFunction(() => window.__cs?.ready, null, { timeout: 60000 });
await page.waitForTimeout(1500);
const info = await page.evaluate(() => ({ scene: window.__cs.scene, models: window.__cs.models, cars: window.__cs.cars }));
await page.screenshot({ path: `test-results/${scene}.png` });
await browser.close();
console.log(JSON.stringify(info));
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`load-check ${scene}: ok → test-results/${scene}.png`);
