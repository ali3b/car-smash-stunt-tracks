// Races on the real simulation, driven by the built-in path follower (the flow's autopilot): a full race on two
// bundled tracks to the finish, with screenshots at the moments that matter — on the loop, in the air on a jump, a
// crash and the recovery after it, the finish and the results; then a race against a rival (the computer driver on
// the real simulation): both cars on the grid, side by side, the rival ahead, its finish and the results. Fails on
// page / console errors, a race that does not finish, a stunt that was not driven through, or a rival that does not
// stand upright on the road at the start or does not finish its lap. Screenshots in test-results/drive-*.png.
//   node scripts/drive-check.mjs [http://localhost:5307]
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const [base = 'http://localhost:5307'] = process.argv.slice(2);
fs.mkdirSync('test-results', { recursive: true });
const env = { ...process.env };
delete env.DISPLAY;
delete env.WAYLAND_DISPLAY;
const browser = await chromium.launch({ env, args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

const flow = (fn, arg) => page.evaluate(([f, a]) => new Function('f', 'a', `return (${f})(f, a)`)(window.__cs.flow, a), [fn.toString(), arg]);
const state = () => flow((f) => f.state());
const stats = () => flow((f) => f.session()?.stats?.() ?? null);
const expectState = async (want, timeout = 60000) => {
  const t0 = Date.now();
  while ((await state()) !== want) {
    if (Date.now() - t0 > timeout) throw new Error(`expected state ${want}, got ${await state()}`);
    await page.waitForTimeout(100);
  }
};
const shot = async (name) => {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `test-results/drive-${name}.png` });
  console.log(`  drive-${name}.png`);
};

/**
 * One race on autopilot. `moments` are [name, test(stats, snapshot)] pairs: the first step a test holds, a screenshot
 * is taken. Returns the final stats and result.
 */
async function race(trackId, carId, camera, moments, opponentId = null, shortTakeOff = false) {
  let slowed = false;
  await flow((f, a) => f.go.race({ trackId: a.trackId, carId: a.carId, opponentId: a.opponentId, gearbox: 'auto' }), { trackId, carId, opponentId });
  await expectState('race');
  await flow((f, cam) => {
    f.skipCountdown();
    f.autopilot(true);
    for (let i = 0; i < 4 && f.camera() !== cam; i++) f.nextCamera();
  }, camera);
  const seen = new Set();
  let last = null;
  const samples = [];
  for (let i = 0; i < 20 * 60 * 8 && (await state()) === 'race'; i++) {
    await flow((f) => f.advance(0.1));
    const s = await stats();
    const snap = await flow((f) => f.snapshot());
    if (!s) break;
    // A deliberate crash: the first jump's ramp taken far too slowly (the car lands short, crashes and is put back).
    if (shortTakeOff && !slowed && s.kind === 'ramp') {
      slowed = true;
      await flow((f) => {
        const car = f.session().sim.player.car;
        car.speed = car.speed2 = 60 * 256;
      });
    }
    last = s;
    if (snap.opponent && samples.length < 40) samples.push({ tick: s.tick, player: snap.player, opponent: snap.opponent });
    for (const [name, test] of moments) {
      if (!seen.has(name) && test(s, snap)) {
        seen.add(name);
        await shot(`${trackId}-${name}`);
      }
    }
    if (s.finished && (!s.opponent || s.opponent.finished)) break;
  }
  await shot(`${opponentId ? `${trackId}-vs` : trackId}-finish`);
  // The results come after the finish hold (and, against a rival, once it is in too).
  for (let k = 0; k < 120 && (await state()) === 'race'; k++) await flow((f) => f.advance(0.5));
  console.log('  after the finish:', JSON.stringify(await stats()));
  await expectState('results', 15000);
  await shot(`${opponentId ? `${trackId}-vs` : trackId}-results`);
  const result = await flow((f) => f.result());
  await flow((f) => f.autopilot(false));
  return { stats: last, result, seen, samples };
}

let fail = false;
try {
  await page.goto(`${base}/?scene=game`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.__cs?.ready, null, { timeout: 60000 });
  const integ = await flow((f) => f.integrations());
  console.log('integrations', JSON.stringify(integ));
  if (!integ.session) throw new Error('the simulation session is not registered');

  // Lagoon Leap: the loop by the beach bar, the reef pipe, and a leap taken far too slowly on purpose: a crash and the
  // recovery.
  const a = await race('lagoon-leap', 'car-rally', 'chase', [
    ['start', (s) => s.tick > 20],
    ['loop', (s, snap) => s.kind === 'loop' && snap.player.pos[1] > 30],
    ['pipe', (s) => s.kind === 'pipe'],
    ['crash', (s) => s.crashed],
    ['recovered', (s) => s.resets > 0 && !s.crashed],
    ['jump', (s, snap) => snap.player.airborne && s.jumps > 0],
  ], null, true);
  console.log('lagoon-leap', JSON.stringify(a.stats), JSON.stringify(a.result));
  // Palm Bay: the seafront highway, banked hairpin, the causeway and a ramp jump.
  const b = await race('palm-bay', 'car-super', 'chase', [
    ['highway', (s) => s.kind === 'highway'],
    ['banked', (s) => s.kind === 'banked-corner'],
    ['jump', (s, snap) => snap.player.airborne && s.jumps > 0],
  ]);
  console.log('palm-bay', JSON.stringify(b.stats), JSON.stringify(b.result));
  // Against a rival: Lagoon Leap with Lena Voss (the loop, the reef pipe, the leaps), the TV camera for the start.
  const dist = (snap) => Math.hypot(snap.player.pos[0] - snap.opponent.pos[0], snap.player.pos[2] - snap.opponent.pos[2]);
  const c = await race(
    'lagoon-leap',
    'car-rally',
    'chase',
    [
      ['vs-grid', (s) => s.tick > 10],
      ['vs-side', (s, snap) => s.tick > 60 && dist(snap) < 12],
      ['vs-rival-ahead', (s, snap) => s.tick > 200 && dist(snap) > 20 && dist(snap) < 60],
      ['vs-rival-loop', (s, snap) => s.opponent?.kind === 'loop' && snap.opponent.pos[1] > 8 && dist(snap) < 80],
      ['vs-rival-finished', (s) => s.opponent?.finished],
    ],
    'lena',
  );
  console.log('lagoon-leap vs lena', JSON.stringify(c.stats), JSON.stringify(c.result));

  const check = (ok, what) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) fail = true;
  };
  check(a.result?.finished === true, 'Lagoon Leap: finished');
  check(b.result?.finished === true, 'Palm Bay: finished');
  check(a.stats.passed.includes('loop'), 'Lagoon Leap: the loop driven through');
  check(a.stats.crashes > 0 && a.stats.resets > 0 && a.seen.has('recovered'), 'Lagoon Leap: a crash and the recovery');
  check(b.stats.jumps > 0 && b.stats.passed.includes('ramp-bridge'), 'Palm Bay: a jump');
  // The rival on the grid: upright (its up axis within ~25 degrees of vertical) and at the player's height.
  const up = (q) => 1 - 2 * (q[0] * q[0] + q[2] * q[2]);
  const grid = c.samples.slice(0, 20);
  check(grid.length > 0 && grid.every((g) => up(g.opponent.quat) > 0.9 && Math.abs(g.opponent.pos[1] - g.player.pos[1]) < 0.5), `vs Lena: the rival stands on the road at the start (up ${grid.map((g) => up(g.opponent.quat).toFixed(2)).slice(0, 3)}, y ${grid[0]?.opponent.pos[1].toFixed(2)} vs ${grid[0]?.player.pos[1].toFixed(2)})`);
  check(c.result?.finished === true && c.result.opponentId === 'lena', 'vs Lena: finished');
  check(c.stats.opponent?.finished === true && c.result.opponentTotalSeconds > 0, `vs Lena: the rival finished its lap (${c.result?.opponentTotalSeconds?.toFixed(1)} s, ${c.stats.opponent?.crashes} crashes)`);
  check(typeof c.result?.won === 'boolean', `vs Lena: ${c.result?.won ? 'won' : 'lost'} (${c.result?.totalSeconds.toFixed(1)} s)`);
} catch (e) {
  console.error(e);
  fail = true;
}
if (errors.length) {
  console.error(errors.join('\n'));
  fail = true;
}
await browser.close();
process.exit(fail ? 1 : 0);
