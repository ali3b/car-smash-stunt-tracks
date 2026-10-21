// Audio check: opens ?scene=audio, unlocks audio with a click, plays every song, one-shot, event, scene, engine
// profile and surface live (checking the live mix's analyser shows energy), then renders each song, one-shot, engine
// and tyre surface offline and checks it is audible and doesn't clip. Screenshot: test-results/audio.png.
//   node scripts/audio-check.mjs [url]
// Without a url it starts its own Vite dev server on port 5305 (cache dir node_modules/.vite-audio) and stops it after.
// Headless Chromium on SwiftShader: the shared GPU stays free.
import { chromium } from '@playwright/test';
import fs from 'node:fs';

let url = process.argv[2] ?? process.env.GAME_URL;
let server = null;
if (!url) {
  const { createServer } = await import('vite');
  server = await createServer({ server: { port: 5305, strictPort: true, host: '127.0.0.1' }, cacheDir: 'node_modules/.vite-audio', logLevel: 'warn' });
  await server.listen();
  url = 'http://127.0.0.1:5305';
}
url = url.replace(/\/$/, '');
fs.mkdirSync('test-results', { recursive: true });

const env = { ...process.env };
delete env.DISPLAY;
delete env.WAYLAND_DISPLAY;
const browser = await chromium.launch({ env, args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
let ok = true;
const fail = (msg) => {
  ok = false;
  console.log(`FAIL: ${msg}`);
};
/** Highest live-mix RMS seen over `ms`. */
const peakLevel = (ms) =>
  page.evaluate(
    (ms) =>
      new Promise((res) => {
        let best = 0;
        const t0 = performance.now();
        const id = setInterval(() => {
          best = Math.max(best, window.__csAudio.audio.level());
          if (performance.now() - t0 > ms) {
            clearInterval(id);
            res(best);
          }
        }, 20);
      }),
    ms,
  );

try {
  await page.goto(`${url}/?scene=audio`);
  await page.waitForFunction(() => window.__cs?.ready === true && window.__csAudio, null, { timeout: 60000 });
  await page.mouse.click(5, 5);
  await page.waitForFunction(() => window.__csAudio.audio.ctx?.state === 'running', null, { timeout: 10000 });
  console.log('audio context running after a click');

  // Music: every song button; the live analyser must see energy.
  for (const b of await page.locator('button[data-song]').all()) {
    await b.click();
    const name = await b.getAttribute('data-song');
    const lvl = await peakLevel(1200);
    const cur = await page.evaluate(() => window.__csAudio.audio.currentSong);
    console.log(`live  song ${name.padEnd(8)} level ${lvl.toFixed(4)}`);
    if (cur !== name) fail(`song button ${name}: currentSong is ${cur}`);
    if (!(lvl > 0.003)) fail(`song ${name}: live mix silent (${lvl})`);
  }
  await page.click('button[data-stop]');
  await page.waitForTimeout(400);

  // One-shots and events.
  for (const b of await page.locator('button[data-sfx]').all()) {
    await b.click();
    const lvl = await peakLevel(250);
    const name = await b.textContent();
    if (!(lvl > 0.001)) fail(`sfx ${name}: live mix silent (${lvl})`);
  }
  for (const b of await page.locator('button[data-event]').all()) {
    await b.click();
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(3200); // the countdown ends with GO
  // Scenes: race waits for GO, the others play at once.
  for (const b of await page.locator('button[data-scene]').all()) {
    await b.click();
    await page.waitForTimeout(300);
    const name = await b.getAttribute('data-scene');
    const cur = await page.evaluate(() => window.__csAudio.audio.currentSong);
    const want = { menu: 'menu', results: 'results', editor: 'editor', replay: 'race', race: null, silence: null }[name];
    if (cur !== want) fail(`scene ${name}: song ${cur}, want ${want}`);
  }
  await page.evaluate(() => window.__csAudio.audio.emit('scene', { name: 'race' }));
  await page.evaluate(() => window.__csAudio.audio.emit('countdown', { n: 0 }));
  if ((await page.evaluate(() => window.__csAudio.audio.currentSong)) !== 'race') fail('GO did not start the race music');
  await page.evaluate(() => window.__csAudio.audio.music(null));
  await page.waitForTimeout(400);

  // The car: each engine profile on auto drive (through the gears), with opponents, each surface with slip, scrape.
  await page.click('#run');
  await page.click('#auto');
  for (const p of await page.evaluate(() => window.__csAudio.profiles)) {
    await page.click(`button[data-profile="${p}"]`);
    const lvl = await peakLevel(2500);
    const gear = await page.evaluate(() => window.__csAudio.state.gear);
    console.log(`live  engine ${p.padEnd(7)} level ${lvl.toFixed(4)} (reached gear ${gear})`);
    if (!(lvl > 0.003)) fail(`engine ${p}: live mix silent (${lvl})`);
  }
  await page.click('#opponents');
  await page.waitForTimeout(1000);
  await page.click('#auto');
  await page.locator('input[data-key=speed]').fill('35');
  await page.locator('input[data-key=slipRear]').fill('0.8');
  for (const s of await page.evaluate(() => window.__csAudio.surfaces)) {
    await page.click(`button[data-surface="${s}"]`);
    await page.waitForTimeout(500);
  }
  await page.locator('input[data-key=scrape]').fill('0.7');
  await page.waitForTimeout(500);
  await page.click('#grounded');
  await page.waitForTimeout(300);
  await page.click('#pause');
  await page.waitForTimeout(300);
  await page.click('#pause');
  await page.screenshot({ path: 'test-results/audio.png', fullPage: true });
  await page.click('#run');
  await page.waitForTimeout(700);

  // Volume persists; M toggles mute.
  await page.locator('input[data-key=vol-music]').fill('0.5');
  const before = await page.evaluate(() => window.__csAudio.audio.settings.muted);
  await page.keyboard.press('m');
  const after = await page.evaluate(() => ({ muted: window.__csAudio.audio.settings.muted, saved: JSON.parse(localStorage.getItem('cs.audio')) }));
  if (after.muted === before) fail('M did not toggle mute');
  if (after.saved?.music !== 0.5 || after.saved?.muted !== after.muted) fail(`cs.audio not saved: ${JSON.stringify(after.saved)}`);
  await page.keyboard.press('m');
  console.log(`settings saved: ${JSON.stringify(after.saved)}`);

  // Offline renders.
  const { songs, sfx, profiles, surfaces } = await page.evaluate(() => ({ songs: window.__csAudio.songs, sfx: window.__csAudio.sfx, profiles: window.__csAudio.profiles, surfaces: window.__csAudio.surfaces }));
  const check = (kind, name, r, minRms) => {
    console.log(`${kind.padEnd(6)} ${name.padEnd(10)} rms ${r.rms.toFixed(4)} peak ${r.peak.toFixed(3)}`);
    if (!(r.rms > minRms)) fail(`${kind} ${name} is (nearly) silent: rms ${r.rms}`);
    if (!(r.peak < 1)) fail(`${kind} ${name} clips: peak ${r.peak}`);
  };
  for (const n of songs) check('song', n, await page.evaluate((n) => window.__csAudio.renderSong(n, 6), n), 0.01);
  // One-shots are short (UI ticks ~50 ms), so judge them by peak as well as a small RMS floor.
  for (const n of sfx) {
    const r = await page.evaluate((n) => window.__csAudio.renderSfx(n, 2.5, { strength: 1, n: 3 }), n);
    check('sfx', n, r, 0.0005);
    if (!(r.peak > 0.03)) fail(`sfx ${n} peak too low: ${r.peak}`);
  }
  for (const n of profiles) check('engine', n, await page.evaluate((n) => window.__csAudio.renderEngine(n, 3), n), 0.01);
  for (const n of surfaces) check('tyres', n, await page.evaluate((n) => window.__csAudio.renderTyres(n, 1.5), n), 0.003);
} catch (e) {
  fail(e.message);
}
for (const e of errors) fail(`page error: ${e}`);
await browser.close();
await server?.close();
console.log(ok ? 'audio-check OK' : 'audio-check FAILED');
process.exit(ok ? 0 : 1);
