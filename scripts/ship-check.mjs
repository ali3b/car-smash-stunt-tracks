// Production polish checks: the boot screen goes away, a gamepad drives every game screen (menus, the race, pause),
// the DOS look in the race view (F2) and that it and the options persist over a reload, window resizes, the editor's
// Test drive (?scene=race&track=custom), the no-WebGL message and the touch-only notice. Screenshots in
// test-results/ship-*.png. Fails on page / console errors or a failed expectation.
//   node scripts/ship-check.mjs [http://localhost:5197]
// Headless on SwiftShader, never on the desktop's display or GPU.
import { chromium, devices } from '@playwright/test';
import fs from 'node:fs';

const [base = 'http://localhost:5197'] = process.argv.slice(2);
fs.mkdirSync('test-results', { recursive: true });
const env = { ...process.env };
delete env.DISPLAY;
delete env.WAYLAND_DISPLAY;
const browser = await chromium.launch({ env, args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

// A fake standard-mapping gamepad the page sees through navigator.getGamepads(); window.__pad holds its state.
const FAKE_PAD = () => {
  const pad = { index: 0, id: 'ship-check pad', connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  window.__pad = pad;
  navigator.getGamepads = () => [pad, null, null, null];
};

async function newPage(opts = {}, init) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, ...opts });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  // A reload aborts the GLB textures still decoding (blob: URLs revoked): not an error of the game.
  page.on('console', (m) => m.type() === 'error' && !/Couldn't load texture blob:/.test(m.text()) && errors.push(`console: ${m.text()}`));
  return { ctx, page, errors };
}

const flowState = (page) => page.evaluate(() => window.__cs.flow.state());
async function waitState(page, want, timeout = 60000) {
  const t0 = Date.now();
  while ((await flowState(page)) !== want) {
    if (Date.now() - t0 > timeout) return false;
    await page.waitForTimeout(100);
  }
  return true;
}
/** Press and release a pad button, held over several frames (pads are polled once per frame; SwiftShader is slow). */
async function padPress(page, button) {
  await page.evaluate(async (b) => {
    const frames = (n) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
    Object.assign(window.__pad.buttons[b], { pressed: true, value: 1 });
    await frames(4);
    Object.assign(window.__pad.buttons[b], { pressed: false, value: 0 });
    await frames(3);
  }, button);
  await page.waitForTimeout(200);
}

try {
  // ---- boot, gamepad through the menus, the race, pause --------------------------------------------------------
  {
    const { ctx, page, errors } = await newPage({}, FAKE_PAD);
    await page.goto(`${base}/?scene=game`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => window.__cs?.ready, null, { timeout: 60000 });
    check((await page.locator('#boot').count()) === 0, 'boot screen removed when ready');
    check(await waitState(page, 'title'), 'title');
    await padPress(page, 0); // A
    check(await waitState(page, 'menu', 3000), 'pad A: title → menu');
    await padPress(page, 0); // RACE
    check(await waitState(page, 'car', 3000), 'pad A: menu → car select');
    await padPress(page, 1); // B
    check(await waitState(page, 'menu', 3000), 'pad B: car select → menu');
    await padPress(page, 13); // d-pad down → VERSUS
    await padPress(page, 12); // d-pad up → RACE
    await padPress(page, 0);
    check(await waitState(page, 'car', 3000), 'pad d-pad + A: back to car select');
    await padPress(page, 0);
    check(await waitState(page, 'track', 3000), 'pad A: car → track select');
    await padPress(page, 0);
    check(await waitState(page, 'race', 60000), 'pad A: track select → race');
    await page.evaluate(() => window.__cs.flow.skipCountdown());
    await page.evaluate(() => Object.assign(window.__pad.buttons[7], { pressed: true, value: 1 })); // RT
    await page.waitForTimeout(2500);
    const mph = await page.evaluate(() => window.__cs.flow.snapshot()?.player.speedMph ?? 0);
    check(mph > 5, `pad RT drives the car (${mph.toFixed(1)} mph)`);
    await page.evaluate(() => Object.assign(window.__pad.buttons[7], { pressed: false, value: 0 }));
    // DOS look in the race view.
    await page.screenshot({ path: 'test-results/ship-race.png' });
    await page.keyboard.press('F2');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/ship-race-dos.png' });
    const look = await page.evaluate(() => JSON.parse(localStorage.getItem('cs.look') ?? 'null'));
    check(look?.dos === true, 'F2 turns the DOS look on in the race and saves it');
    const a = fs.readFileSync('test-results/ship-race.png');
    const b = fs.readFileSync('test-results/ship-race-dos.png');
    check(a.length !== b.length, 'the race view looks different with the DOS look');
    // Resize mid-race.
    await page.setViewportSize({ width: 900, height: 600 });
    await page.waitForTimeout(500);
    const canvas = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      return { w: c.clientWidth, h: c.clientHeight };
    });
    check(canvas.w === 900 && canvas.h === 600, `canvas follows a window resize (${canvas.w}×${canvas.h})`);
    await page.screenshot({ path: 'test-results/ship-race-resized.png' });
    await page.setViewportSize({ width: 1280, height: 720 });
    await padPress(page, 9); // Start
    check(await page.evaluate(() => !!document.querySelector('.cs-pause')), 'pad Start pauses the race');
    await page.keyboard.press('F2'); // 16 colours
    await page.keyboard.press('F2'); // off
    // Options persist over a reload.
    await page.evaluate(() => window.__cs.flow.go.options());
    await waitState(page, 'options', 3000);
    await padPress(page, 0); // gearbox → manual
    await padPress(page, 13);
    await padPress(page, 13);
    await padPress(page, 0); // DOS look → 256
    await page.reload();
    await page.waitForFunction(() => window.__cs?.ready, null, { timeout: 60000 });
    const saved = await page.evaluate(() => ({ o: JSON.parse(localStorage.getItem('cs.options') ?? '{}'), l: JSON.parse(localStorage.getItem('cs.look') ?? '{}') }));
    check(saved.o.gearbox === 'manual' && saved.l.dos === true, `options persist over a reload (gearbox ${saved.o.gearbox}, DOS look ${saved.l.dos})`);
    await page.evaluate(() => localStorage.removeItem('cs.look'));
    check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    await ctx.close();
  }

  // ---- the editor's Test drive ----------------------------------------------------------------------------------
  {
    const { ctx, page, errors } = await newPage();
    // Open a bundled track in the editor and press Test drive (the editor check builds one by hand).
    await page.goto(`${base}/?scene=editor`);
    await page.waitForFunction(() => window.__cs?.ready, null, { timeout: 60000 });
    const v = await page.evaluate(() => [...document.querySelectorAll('#ed-open option')].map((o) => o.value).find((x) => x.startsWith('bundled:')));
    if (v) await page.selectOption('#ed-open', v);
    await page.waitForTimeout(500);
    await Promise.all([page.waitForURL(/scene=race/), page.click('#ed-drive')]);
    await page.waitForFunction(() => window.__cs?.ready || window.__cs?.error, null, { timeout: 60000 });
    check((await flowState(page)) === 'race', 'editor Test drive (?scene=race&track=custom) races the editor track');
    await page.waitForTimeout(800);
    await page.screenshot({ path: 'test-results/ship-custom.png' });
    check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    await ctx.close();
  }

  // ---- no WebGL 2 ---------------------------------------------------------------------------------------------------
  {
    const { ctx, page } = await newPage({}, () => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        return type === 'webgl2' || type === 'webgl' ? null : orig.call(this, type, ...rest);
      };
    });
    await page.goto(`${base}/?scene=game`);
    await page.waitForFunction(() => window.__cs?.error, null, { timeout: 30000 });
    const text = await page.locator('#boot').innerText();
    check(/WebGL/.test(text), 'no WebGL: a readable message instead of a crash');
    await page.screenshot({ path: 'test-results/ship-no-webgl.png' });
    await ctx.close();
  }

  // ---- a phone: touch controls are set up (scripts/mobile-check.mjs drives them) -------------------------------
  {
    const { ctx, page } = await newPage({ ...devices['Pixel 7'], viewport: { width: 915, height: 412 } });
    await page.goto(`${base}/?scene=game`);
    await page.waitForFunction(() => window.__cs?.ready, null, { timeout: 60000 });
    check((await page.locator('.cs-touch [data-c="gas"]').count()) === 1 && !!(await page.evaluate(() => window.__cs.touch)), 'touch device: the on-screen driving controls are ready');
    await page.screenshot({ path: 'test-results/ship-touch.png' });
    await ctx.close();
  }
} catch (e) {
  failures.push(String(e));
  console.error(e);
}
await browser.close();
if (failures.length) {
  console.error(`ship-check: ${failures.length} failed`);
  process.exit(1);
}
console.log('ship-check: ok');
