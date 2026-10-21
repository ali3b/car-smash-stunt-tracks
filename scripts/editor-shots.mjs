// Screenshots of the track editor with our own bundled tracks open (never a reference track), for the trailer and
// the documentary: test-results/documentary/material/editor/editor-<track>.png
//   node scripts/editor-shots.mjs [http://127.0.0.1:5308] [track name ...]
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const [base = 'http://127.0.0.1:5308', ...names] = process.argv.slice(2);
const want = names.length ? names : ['harvest-havoc', 'lagoon-leap', 'skyline-stunts'];
const out = 'test-results/documentary/material/editor';
fs.mkdirSync(out, { recursive: true });
const env = { ...process.env };
delete env.DISPLAY;
delete env.WAYLAND_DISPLAY;
const browser = await chromium.launch({ env, args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${base}/?scene=editor`);
await page.waitForFunction(() => window.__cs?.ready, null, { timeout: 60000 });
await page.waitForFunction(() => [...document.querySelectorAll('#ed-open option')].some((o) => o.value.startsWith('bundled:')), null, { timeout: 30000 });
const options = await page.$$eval('#ed-open option', (o) => o.map((x) => x.value));
for (const name of want) {
  const v = options.find((o) => o.startsWith('bundled:') && o.slice(8).toLowerCase() === name.toLowerCase());
  if (!v) {
    console.error(`no bundled track "${name}" (have ${options.filter((o) => o.startsWith('bundled:')).join(', ')})`);
    continue;
  }
  await page.selectOption('#ed-open', v);
  await page.waitForTimeout(2500);
  const file = `${out}/editor-${name}.png`;
  await page.screenshot({ path: file });
  console.log(file);
}
await browser.close();
