// The game on a phone, by touch alone (Playwright's Pixel 7 in landscape: touch, mobile viewport): the menus by
// taps, a race driven by holding the on-screen GAS / BRAKE / steering buttons (real touch events) until it passes a
// checkpoint, pause and camera buttons, tilt steering, the results' letter picker, the VCR bar, the rotate card in
// portrait, the automatic low quality, and the track editor (tap to place, two-finger pinch zoom).
// Screenshots: test-results/mobile-*.png. Fails on page errors or a failed expectation.
//   node scripts/mobile-check.mjs [http://localhost:5197]
// The race is steered by the built-in path follower's choice each step, pressed on the overlay as a finger would.
// Headless on SwiftShader, never on the desktop's display or GPU.
import { chromium, devices } from '@playwright/test';
import fs from 'node:fs';

const [base = 'http://localhost:5197'] = process.argv.slice(2);
fs.mkdirSync('test-results', { recursive: true });
const env = { ...process.env };
delete env.DISPLAY;
delete env.WAYLAND_DISPLAY;
const browser = await chromium.launch({ env, args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ ...devices['Pixel 7 landscape'], viewport: { width: 915, height: 412 } });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const errors = [];
const failures = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && !/Couldn't load texture blob:/.test(m.text()) && errors.push(`console: ${m.text()}`));
const check = (ok, what) => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}`);
  if (!ok) failures.push(what);
};
const shot = async (name, wait = 300) => {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `test-results/mobile-${name}.png` });
  console.log(`  test-results/mobile-${name}.png`);
};
const flow = (fn, arg) => page.evaluate(([f, a]) => new Function('f', 'a', `return (${f})(f, a)`)(window.__cs.flow, a), [fn.toString(), arg]);
const state = () => flow((f) => f.state());
const waitState = async (want, timeout = 60000) => {
  const t0 = Date.now();
  while ((await state()) !== want) {
    if (Date.now() - t0 > timeout) return false;
    await page.waitForTimeout(100);
  }
  return true;
};
const tap = async (selector) => {
  await page.locator(selector).first().tap();
  await page.waitForTimeout(250);
};
/** Centre of an element (CSS px). */
const centre = async (selector) => {
  const b = await page.locator(selector).first().boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

// Fingers on the screen: a set of points, sent as real touch events (CDP). Changing the set lifts every finger and
// puts the new set down.
let fingersDown = '';
async function fingers(points) {
  const key = JSON.stringify(points);
  if (key === fingersDown) return;
  if (fingersDown !== '[]' && fingersDown !== '') await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  if (points.length) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: i + 1 })) });
  fingersDown = key;
}

try {
  await page.goto(`${base}/?scene=game`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.__cs?.ready, null, { timeout: 60000 });
  check(await waitState('title'), 'title');
  const q = await page.evaluate(() => ({ pr: window.__cs.renderer.getPixelRatio(), shadows: window.__cs.renderer.shadowMap.enabled }));
  check(q.pr === 1 && !q.shadows, `automatic low quality on a phone (pixel ratio ${q.pr}, shadows ${q.shadows ? 'on' : 'off'})`);
  await shot('01-title', 3000);

  // ---- menus by taps ----
  await page.locator('.cs-title').tap();
  check(await waitState('menu', 5000), 'tap: title → menu');
  await shot('02-menu', 800);
  await tap('.cs-main [data-act="race"]');
  check(await waitState('car', 5000), 'tap: RACE → car select');
  await shot('03-car', 2500);
  await tap('.cs-keys [data-menu="back"]');
  check(await waitState('menu', 5000), 'tap: the ESC hint goes back');
  await tap('.cs-main [data-act="race"]');
  await waitState('car', 5000);
  await tap('[data-act="go"]');
  check(await waitState('track', 5000), 'tap: NEXT → track select');
  // A tap selects a track, a tap on the selected one races it.
  await tap('[data-act="palm-bay"]');
  await shot('04-track', 800);
  await tap('[data-act="sunday-drive"]');
  if ((await state()) === 'track') await tap('[data-act="sunday-drive"]');
  check(await waitState('race', 60000), 'tap: the track again → race');

  // ---- the race by touch ----
  await flow((f) => f.skipCountdown());
  await page.waitForTimeout(500);
  check(await page.evaluate(() => window.__cs.touch?.shown() === true), 'the touch controls show in the race');
  await shot('05-race-controls', 300);
  const pos = {
    gas: await centre('.cs-touch [data-c="gas"]'),
    brake: await centre('.cs-touch [data-c="brake"]'),
    left: await centre('.cs-touch [data-c="left"]'),
    right: await centre('.cs-touch [data-c="right"]'),
  };
  // Hold GAS for a second, through the page's own loop.
  await fingers([pos.gas]);
  await page.waitForTimeout(400);
  check((await page.evaluate(() => window.__cs.touch.held())).includes('gas'), 'holding GAS lights it up');
  await flow((f) => f.advance(1.5));
  const mph = await flow((f) => f.snapshot().player.speedMph);
  check(mph > 10, `GAS drives the car (${mph.toFixed(0)} mph)`);
  // Drive to the first checkpoint: each step, the fingers press what the path follower would.
  let cp = 0;
  for (let i = 0; i < 20 * 120 && cp < 1; i++) {
    const b = await flow((f) => f.session().autopilotInput());
    const want = [];
    if (b & 1) want.push(pos.gas);
    if (b & 2) want.push(pos.brake);
    if (b & 4) want.push(pos.right);
    if (b & 8) want.push(pos.left);
    await fingers(want);
    const s = await flow((f) => (f.advance(0.05), f.snapshot()));
    cp = s.progress.checkpoint;
    if (i % 200 === 0) console.log(`    t ${s.time.toFixed(1)} s, ${s.player.speedMph.toFixed(0)} mph, checkpoint ${cp}`);
  }
  await fingers([]);
  check(cp >= 1, 'a race driven by taps on the overlay reaches a checkpoint');
  await shot('06-race-checkpoint', 200);

  // Camera and pause buttons.
  const cam0 = await flow((f) => f.camera());
  await tap('.cs-touch [data-c="cam"]');
  check((await flow((f) => f.camera())) !== cam0, 'the CAM button changes the camera');
  await shot('07-race-cam', 300);
  await tap('.cs-touch [data-c="pause"]');
  // The press is read on the next animation frame, which can take a while on a loaded SwiftShader.
  check(await page.locator('.cs-pause').waitFor({ timeout: 5000 }).then(() => true, () => false), 'the II button pauses');
  await shot('08-pause', 300);
  await tap('.cs-pause [data-act="continue"]');
  check((await page.locator('.cs-pause').count()) === 0, 'tap: CONTINUE');

  // Tilt steering.
  await tap('.cs-touch [data-c="tilt"]');
  check(await page.evaluate(() => window.__cs.touch.tilt()), 'the TILT button turns tilt steering on');
  // Half lock to the right: about every other step steers right, none left.
  await page.evaluate(() => window.__cs.touch.setTilt(11));
  const steers = await page.evaluate(() => Array.from({ length: 20 }, () => window.__cs.touch.input().steer));
  const right = steers.filter((s) => s > 0).length;
  check(right >= 6 && right <= 14 && !steers.some((s) => s < 0), `half tilt steers right on part of the steps (${right} / 20)`);
  await shot('09-tilt', 300);
  await page.evaluate(() => window.__cs.touch.setTilt(0));
  await tap('.cs-touch [data-c="tilt"]');

  // Finish on autopilot, then the letter picker.
  await flow((f) => f.autopilot(true));
  for (let i = 0; i < 80 && (await state()) === 'race'; i++) await flow((f) => f.advance(10));
  check(await waitState('results', 15000), 'results');
  await flow((f) => f.autopilot(false));
  if (await page.locator('.cs-res [data-act="up:0"]').count()) {
    await page.waitForTimeout(500);
    await shot('10-initials', 200);
    await tap('.cs-res [data-act="up:0"]');
    await tap('.cs-res [data-act="down:1"]');
    await tap('.cs-res [data-act="ok"]');
    const ini = await page.evaluate(() => JSON.parse(localStorage.getItem('cs.options')).initials);
    check(ini !== 'YOU' && ini.length === 3, `the letter picker sets the initials (${ini})`);
  } else check(false, 'the results offer the initials entry');
  await shot('11-results', 300);
  await tap('.cs-res [data-act="watch"]');
  check(await waitState('replay', 30000), 'tap: WATCH REPLAY');
  await page.waitForTimeout(500);
  await tap('.cs-vcr [data-act="play"]');
  const playing = await flow((f) => f.replay().playing);
  await tap('.cs-vcr [data-act="play"]');
  check(playing !== (await flow((f) => f.replay().playing)), 'the VCR play button works by tap');
  await shot('12-vcr', 300);
  await tap('.cs-vcr [data-act="exit"]');
  check(await waitState('results', 10000), 'tap: VCR EXIT');

  // ---- portrait ----
  await flow((f) => f.go.race({ trackId: 'palm-bay', opponentId: null }));
  await waitState('race', 60000);
  await flow((f) => f.skipCountdown());
  await page.setViewportSize({ width: 412, height: 915 });
  await page.waitForTimeout(600);
  check(await page.locator('.cs-rotate').isVisible(), 'portrait: the turn-your-phone card');
  check(await page.locator('.cs-pause').count() > 0, 'portrait pauses the race');
  await shot('13-portrait', 200);
  await page.setViewportSize({ width: 915, height: 412 });
  await page.waitForTimeout(400);

  // ---- the editor by touch ----
  await page.goto(`${base}/?scene=editor`);
  await page.waitForFunction(() => window.__cs?.ready, null, { timeout: 60000 });
  await shot('14-editor', 1500);
  const count0 = await page.evaluate(() => window.__cs.editor.doc.track.pieces.length);
  await tap('#ed-palette .ed-item[data-kind="straight"]');
  const grid = await page.locator('.ed-grid-canvas').boundingBox();
  // Empty tiles away from the track (the editor may open on a full track), until one takes the piece.
  const empty = await page.evaluate(() => {
    const d = window.__cs.editor.doc;
    const out = [];
    for (let z = 24; z >= 4 && out.length < 6; z -= 4) for (let x = 20; x >= 6 && out.length < 6; x -= 7) if (d.pieceAt(x, z) < 0) out.push([x, z]);
    return out;
  });
  let count1 = count0;
  for (const [x, z] of empty) {
    const cell = await page.evaluate(([x, z]) => window.__cs.editor.tileToClient(x, z), [x, z]);
    await page.touchscreen.tap(cell.x, cell.y);
    await page.waitForTimeout(400);
    count1 = await page.evaluate(() => window.__cs.editor.doc.track.pieces.length);
    if (count1 > count0) break;
  }
  check(count1 > count0, `tap places a piece (${count0} → ${count1})`);
  await tap('#ed-rot-r');
  check(true, 'rotate button tappable');
  // Pinch: two fingers apart.
  const a = await page.evaluate(() => Object.values(window.__cs.editor.tileToClient(10, 10)));
  const b = await page.evaluate(() => Object.values(window.__cs.editor.tileToClient(11, 10)));
  const cx = grid.x + grid.width / 2;
  const cy = grid.y + grid.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx - 30, y: cy, id: 1 }, { x: cx + 30, y: cy, id: 2 }] });
  for (let s = 1; s <= 6; s++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx - 30 - s * 15, y: cy, id: 1 }, { x: cx + 30 + s * 15, y: cy, id: 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(300);
  const a2 = await page.evaluate(() => Object.values(window.__cs.editor.tileToClient(10, 10)));
  const b2 = await page.evaluate(() => Object.values(window.__cs.editor.tileToClient(11, 10)));
  check(b2[0] - a2[0] > (b[0] - a[0]) * 1.3, `pinch zooms the grid (cell ${(b[0] - a[0]).toFixed(1)} → ${(b2[0] - a2[0]).toFixed(1)} px)`);
  const count2 = await page.evaluate(() => window.__cs.editor.doc.track.pieces.length);
  check(count2 === count1, 'a pinch places nothing');
  await shot('15-editor-zoomed', 400);
} catch (e) {
  failures.push(String(e));
  console.error(e);
}
check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 4).join(' | ')}` : ''}`);
await browser.close();
if (failures.length) {
  console.error(`mobile-check: ${failures.length} failed`);
  process.exit(1);
}
console.log('mobile-check: ok');
