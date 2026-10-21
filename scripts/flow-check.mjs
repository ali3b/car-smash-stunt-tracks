// The game flow end to end, driven like a player through the menus (window.__cs.flow.press) with the race on
// autopilot: title → menu → car select → track select → race → results (initials) → high scores, then a race vs a
// rival → its replay in the VCR, and the options. Fails on page / console errors or a wrong screen; screenshots in
// test-results/flow-*.png.
//   node scripts/flow-check.mjs [http://localhost:5303]
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const [base = 'http://localhost:5303'] = process.argv.slice(2);
fs.mkdirSync('test-results', { recursive: true });
// Headless on SwiftShader, never on the desktop's display or GPU.
const env = { ...process.env };
delete env.DISPLAY;
delete env.WAYLAND_DISPLAY;
const browser = await chromium.launch({ env, args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
// A reload aborts GLB textures still decoding (blob: URLs revoked): not an error of the game.
page.on('console', (m) => m.type() === 'error' && !/Couldn't load texture blob:/.test(m.text()) && errors.push(`console: ${m.text()}`));

const flow = (fn, arg) => page.evaluate(([f, a]) => new Function('f', 'a', `return (${f})(f, a)`)(window.__cs.flow, a), [fn.toString(), arg]);
const state = () => flow((f) => f.state());
const press = async (...keys) => {
  for (const k of keys) {
    await flow((f, a) => f.press(a), k);
    await page.waitForTimeout(60);
  }
};
const shot = async (name, wait = 600) => {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `test-results/flow-${name}.png` });
  console.log(`  flow-${name}.png (${await state()})`);
};
const expectState = async (want, timeout = 60000) => {
  const t0 = Date.now();
  while ((await state()) !== want) {
    if (Date.now() - t0 > timeout) throw new Error(`expected state ${want}, got ${await state()}`);
    await page.waitForTimeout(100);
  }
};
/** Drive the race on autopilot until the results screen. */
const finishRace = async () => {
  await flow((f) => (f.skipCountdown(), f.autopilot(true)));
  for (let i = 0; i < 60 && (await state()) === 'race'; i++) await flow((f) => f.advance(10));
  await expectState('results', 5000);
  await flow((f) => f.autopilot(false));
};

try {
  await page.goto(`${base}/?scene=game`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.__cs?.ready, null, { timeout: 60000 });
  await expectState('title');
  await shot('01-title', 4000);

  await press('confirm');
  await expectState('menu');
  await shot('02-menu', 1500);

  await press('confirm'); // RACE
  await expectState('car');
  await shot('03-car', 3000);
  await press('right', 'right');
  await shot('03b-car-next', 2500);
  await press('left', 'left', 'confirm');

  await expectState('track');
  await press('up'); // the list wraps to the test oval (listed last)
  await shot('04-track', 800);
  await press('confirm');

  await expectState('race');
  await shot('05-countdown', 800);
  await flow((f) => (f.skipCountdown(), f.autopilot(true), f.advance(8)));
  await shot('06-race', 800);
  await flow((f) => f.nextCamera());
  await flow((f) => f.advance(0.5));
  await shot('06b-race-cockpit', 600);
  await finishRace();
  const result = await flow((f) => f.result());
  if (!result?.finished) throw new Error(`race did not finish: ${JSON.stringify(result)}`);
  console.log(`  result: ${result.totalSeconds.toFixed(2)} s, top ${result.topSpeedMph.toFixed(0)} mph, ${result.distanceM.toFixed(0)} m`);
  await shot('07-results', 1200);
  await press('Z', 'A', 'K', 'confirm');
  await shot('07b-results-entered', 400);
  await press('down', 'down', 'down', 'confirm'); // HIGH SCORES
  await expectState('scores');
  await shot('08-scores', 1500);

  // Versus: car → rival → track → race → replay.
  await press('confirm');
  await expectState('menu'); // back on HIGH SCORES
  await press('up', 'up', 'up', 'confirm'); // RACE VS OPPONENT
  await expectState('car');
  await press('confirm');
  await expectState('opponent');
  await shot('09-opponent', 4000);
  await press('right', 'confirm');
  await expectState('track');
  await press('confirm');
  await expectState('race');
  // The rival (the computer driver) on the grid beside the player, upright on the road.
  await flow((f) => (f.skipCountdown(), f.advance(0.5)));
  const grid = await flow((f) => f.snapshot());
  const up = (q) => 1 - 2 * (q[0] * q[0] + q[2] * q[2]);
  if (!grid.opponent) throw new Error('no rival in a race vs a rival');
  console.log(`  rival on the grid: up ${up(grid.opponent.quat).toFixed(3)}, y ${grid.opponent.pos[1].toFixed(2)} m (player ${grid.player.pos[1].toFixed(2)} m), ${Math.hypot(grid.opponent.pos[0] - grid.player.pos[0], grid.opponent.pos[2] - grid.player.pos[2]).toFixed(1)} m apart`);
  if (up(grid.opponent.quat) < 0.95 || Math.abs(grid.opponent.pos[1] - grid.player.pos[1]) > 0.3) throw new Error('the rival is not standing on the road');
  await shot('10a-race-vs-grid', 800);
  await flow((f) => (f.autopilot(true), f.advance(5)));
  await shot('10-race-vs', 800);
  await finishRace();
  const vs = await flow((f) => f.result());
  console.log(`  vs ${vs?.opponentId}: ${vs?.totalSeconds.toFixed(1)} s vs ${vs?.opponentTotalSeconds?.toFixed(1) ?? 'DNF'} s, ${vs?.won ? 'won' : 'lost'}`);
  if (!vs?.opponentId || typeof vs.won !== 'boolean') throw new Error(`no result against the rival: ${JSON.stringify(vs)}`);
  await shot('11-results-vs', 1200);
  if ((await page.$('.cs-res .slots')) !== null) await press('confirm');
  await press('down', 'confirm'); // WATCH REPLAY
  await expectState('replay');
  await page.waitForTimeout(1500);
  await press('right');
  await page.waitForTimeout(1500);
  const rp = await flow((f) => f.replay());
  if (!rp || rp.tick <= 0) throw new Error(`replay did not move: ${JSON.stringify(rp)}`);
  await shot('12-replay', 300);
  await press('back');
  await expectState('results');
  await press('down', 'down', 'confirm'); // SAVE REPLAY
  await press('down', 'down', 'confirm'); // MAIN MENU
  await expectState('menu');
  await press('down', 'down', 'down', 'confirm'); // REPLAYS
  await expectState('replays');
  await shot('13-replays', 1000);
  await press('back'); // menu, on REPLAYS
  await press('down', 'down', 'confirm'); // OPTIONS
  await expectState('options');
  await shot('14-options', 1000);
} catch (e) {
  errors.push(String(e));
  await page.screenshot({ path: 'test-results/flow-fail.png' });
}
await browser.close();
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('flow-check: ok');
