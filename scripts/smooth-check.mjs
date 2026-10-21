// Jank checks, frame-exact: the game's Loop is stopped and driven from here one animation frame at a time
// (window.__cs.loop: the same accumulator as Loop.frame, the 60 Hz steps and the 20 Hz race inside them), so the
// numbers are the same on SwiftShader as on a fast GPU. Per rendered frame it reads the race view's probe() (camera,
// car, body lean, wheel gaps) and measures:
//   - car and camera speed per frame (world m/s): a frame that moves much more or less than its neighbours is a
//     stutter (an interpolation alpha that sticks or jumps); a step backwards along the motion is a reversal
//   - the car's position on screen in the chase camera (px per frame and its change: the car must sit still, not shake)
//   - camera turn per frame (degrees) outside camera cuts
//   - wheels floating above / sinking into the road (ray from each wheel centre along the car's down axis), after the
//     drawn suspension (car-view.ts placeWheels) has moved each wheel to the road within its travel; the travel used is
//     reported, and a wheel the travel can't bring to the road still counts as off
//   - the body's suspension lean (it must never tip the body over)
// under several frame-time patterns: steady 60 Hz, 144 Hz, 60 Hz with timing jitter, and 60 Hz with a long hitch
// every two seconds. Then the menus in real time: no blank backdrop frames between screens.
// Fails when a limit below is exceeded. Report in test-results/smooth-check.json, screenshots smooth-*.png.
//   node scripts/smooth-check.mjs [http://localhost:5197] [--quick] [--no-eye-ease (comparison: in-car orientation not eased)]
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const args = process.argv.slice(2);
const quick = args.includes('--quick');
// Comparison only: the in-car view without its eased orientation (race-view.ts eyeEase).
const noEyeEase = args.includes('--no-eye-ease');
const base = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:5197';
fs.mkdirSync('test-results', { recursive: true });

/** Limits: what counts as a bad frame, and how many of them a run may have. */
const LIMIT = {
  /** A frame whose speed differs from the previous frame's by more than this fraction (and 3 m/s) is a stutter. */
  speedJump: 0.35,
  /** Stutter frames allowed per run (fraction of frames). */
  stutterFrac: 0.01,
  /** Reversals (moving backwards for one frame while driving) allowed per run. */
  reversals: 0,
  /** Chase camera: the car's screen position may move at most this many px between frames (1280×720)… */
  screenStep: 14,
  /** …and its frame-to-frame change (shake) at most this many px. */
  screenShake: 6,
  /** Camera turn per frame outside cuts (degrees at 60 Hz; scaled by dt). */
  camTurn: 6,
  /** In-car: camera turn per frame (degrees at 60 Hz; a loop at speed is ~3°/frame by itself)... */
  camTurnInCar: 4,
  /**
   * ...and how much that turn may change from one frame to the next: a jolt, the 20 Hz steps showing through
   * (Lagoon Leap's loop in-car: 3.98° with straight interpolation, 0.67° with the eased view, race-view.ts eyeEase).
   */
  camTurnJolt: 0.8,
  /** Wheel gap to the road (m) beyond which a grounded wheel is floating / sinking. */
  wheelGap: 0.3,
  /** Frames with a grounded wheel off the road allowed (fraction). */
  wheelFrac: 0.05,
  /** Body lean (rad) never exceeded. */
  lean: 0.25,
  /** Blank backdrop frames between screens. */
  blank: 0,
};
/**
 * Known open issues, reported as WARN instead of failing (docs/QA.md has each one, with its owner). Remove an entry
 * once it is fixed so it can't come back.
 */
const KNOWN_WHEELS_OFF = new Set([
  // Empty: QA-07 (loop deck) was fixed by computing the stunt piece specs from the simulation's geometry.
]);

const env = { ...process.env };
delete env.DISPLAY;
delete env.WAYLAND_DISPLAY;
const browser = await chromium.launch({ env, args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
// A small viewport keeps SwiftShader fast; screen motion is measured in NDC and reported as 1280×720 pixels.
const t0 = Date.now();
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

const flow = (fn, arg) => page.evaluate(([f, a]) => new Function('f', 'a', `return (${f})(f, a)`)(window.__cs.flow, a), [fn.toString(), arg]);
const state = () => flow((f) => f.state());
const expectState = async (want, timeout = 60000) => {
  const t0 = Date.now();
  while ((await state()) !== want) {
    if (Date.now() - t0 > timeout) throw new Error(`expected state ${want}, got ${await state()}`);
    await page.waitForTimeout(50);
  }
};

/** Frame-time patterns (seconds per frame), deterministic. */
function pattern(name, n) {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const out = [];
  for (let i = 0; i < n; i++) {
    if (name === 'hz144') out.push(1 / 144);
    else if (name === 'jitter60') out.push(1 / 60 + (rnd() - 0.5) * 0.006);
    else if (name === 'hitch') out.push(i % 120 === 119 ? 0.15 : 1 / 60);
    else out.push(1 / 60);
  }
  return out;
}

/** Install the frame driver: stop the real loop and run its step/render hooks by hand. */
async function manual(on) {
  await page.evaluate((on) => {
    const loop = window.__cs.loop;
    if (!on) {
      loop.start();
      return;
    }
    loop.stop();
    const STEP = 1 / 60;
    let acc = 0;
    window.__qaFrames = (dts) => {
      const out = [];
      for (const dt of dts) {
        acc += dt;
        let n = 0;
        while (acc >= STEP && n < 6) {
          loop.hooks.step(STEP);
          loop.simTime += STEP;
          loop.steps++;
          acc -= STEP;
          n++;
        }
        if (n === 6) acc = 0;
        loop.hooks.render(acc / STEP, dt);
        const f = window.__cs.flow;
        const v = f.view();
        const s = f.snapshot();
        out.push(v && s ? { dt, ...v.probe(), airborne: s.player.airborne || s.player.crashed, mph: s.player.speedMph, tick: s.tick, kind: f.session()?.stats?.().kind ?? null } : { dt });
      }
      return out;
    };
  }, on);
}

const len = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const quatAngle = (a, b) => (2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]))) * 180) / Math.PI;

/** Stutters and reversals in a series of positions (one per frame). */
function motion(frames, key) {
  let stutters = 0;
  let reversals = 0;
  let worst = 0;
  let prevV = null;
  let prevD = null;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1][key];
    const b = frames[i][key];
    const d = sub(b, a);
    const dist = len(b, a);
    // A teleport (reset after a crash, a camera cut): start over.
    if (dist > 8 || frames[i].mode !== frames[i - 1].mode) {
      prevV = null;
      prevD = null;
      continue;
    }
    const v = dist / frames[i].dt;
    if (prevV !== null && Math.max(v, prevV) > 4) {
      const jump = Math.abs(v - prevV) / Math.max(v, prevV);
      worst = Math.max(worst, jump);
      if (jump > LIMIT.speedJump && Math.abs(v - prevV) > 3) stutters++;
    }
    if (prevD && len(d, [0, 0, 0]) > 0.02 && len(prevD, [0, 0, 0]) > 0.02 && dot(d, prevD) < 0) reversals++;
    prevV = v;
    prevD = d;
  }
  return { stutters, reversals, worst: +worst.toFixed(3) };
}

function analyse(frames) {
  const f = frames.filter((x) => x.car);
  const car = motion(f, 'car');
  const cam = motion(f, 'camera');
  let screenStep = 0;
  let screenShake = 0;
  let camTurn = 0;
  let camJolt = 0;
  let joltAt = null;
  let prevTurn = null;
  let prevStep = null;
  for (let i = 1; i < f.length; i++) {
    // Camera cuts, teleports, and the frames right after a hitch (the chase camera catches up on purpose).
    const hitch = [0, 1, 2, 3].some((k) => i - k >= 0 && f[i - k].dt > 0.05);
    if (f[i].mode !== f[i - 1].mode || len(f[i].car, f[i - 1].car) > 8 || hitch) {
      prevStep = null;
      prevTurn = null;
      continue;
    }
    const scale = (1 / 60) / f[i].dt;
    if (f[i].mode === 'chase') {
      const st = [((f[i].screen[0] - f[i - 1].screen[0]) * 1280) / 2, ((f[i].screen[1] - f[i - 1].screen[1]) * 720) / 2];
      const m = Math.hypot(st[0], st[1]) * scale;
      screenStep = Math.max(screenStep, m);
      if (prevStep) screenShake = Math.max(screenShake, Math.hypot(st[0] - prevStep[0], st[1] - prevStep[1]) * scale);
      prevStep = st;
    }
    if (f[i].mode !== 'tv') {
      const turn = quatAngle(f[i].cameraQuat, f[i - 1].cameraQuat) * scale;
      camTurn = Math.max(camTurn, turn);
      if (prevTurn !== null && Math.abs(turn - prevTurn) > camJolt) {
        camJolt = Math.abs(turn - prevTurn);
        joltAt = { frame: i, tick: f[i].tick, kind: f[i].kind, turns: [+prevTurn.toFixed(2), +turn.toFixed(2)] };
      }
      prevTurn = turn;
    }
  }
  let grounded = 0;
  let off = 0;
  const known = {};
  let maxGap = -Infinity;
  let minGap = Infinity;
  let lean = 0;
  let travelUp = 0;
  let travelDown = 0;
  for (const x of f) {
    lean = Math.max(lean, Math.abs(x.body[0]), Math.abs(x.body[1]));
    if (x.airborne) continue;
    const gaps = x.wheels.filter((g) => g !== null);
    if (!gaps.length) continue;
    grounded++;
    maxGap = Math.max(maxGap, ...gaps);
    for (const t of x.travel ?? []) {
      travelDown = Math.max(travelDown, t);
      travelUp = Math.min(travelUp, t);
    }
    minGap = Math.min(minGap, ...gaps);
    if (gaps.some((g) => Math.abs(g) > LIMIT.wheelGap)) {
      if (KNOWN_WHEELS_OFF.has(x.kind)) known[x.kind] = (known[x.kind] ?? 0) + 1;
      else off++;
    }
  }
  return {
    frames: f.length,
    car,
    camera: cam,
    screenStep: +screenStep.toFixed(2),
    screenShake: +screenShake.toFixed(2),
    camTurn: +camTurn.toFixed(2),
    camJolt: +camJolt.toFixed(2),
    joltAt,
    kinds: [...new Set(f.map((x) => x.kind))],
    wheels: { grounded, off, known, maxGap: grounded ? +maxGap.toFixed(3) : 0, minGap: grounded ? +minGap.toFixed(3) : 0, travel: [+travelUp.toFixed(3), +travelDown.toFixed(3)] },
    lean: +lean.toFixed(3),
  };
}

const report = { runs: [], transitions: null, limits: LIMIT };
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

/** Race time (s, autopilot) at which the player's car first reaches a section of `kind` (e.g. 'loop'). */
async function timeTo(trackId, carId, kind) {
  await flow((f, a) => f.go.race({ trackId: a.trackId, carId: a.carId, opponentId: null, gearbox: 'auto' }), { trackId, carId });
  await expectState('race');
  return flow(
    (f, kind) => {
      f.skipCountdown();
      f.autopilot(true);
      for (let t = 0; t < 120; t += 0.1) {
        f.advance(0.1);
        if (f.session()?.stats?.().kind === kind) return t;
      }
      return null;
    },
    kind,
  );
}

/** `warmup`: seconds into the race before measuring, or { before: kind, by: s }: that long before reaching a kind. */
async function run(trackId, carId, camera, pat, seconds, warmup) {
  if (typeof warmup === 'object') {
    const t = await timeTo(trackId, carId, warmup.before);
    if (t === null) throw new Error(`${trackId}: the car never reached a ${warmup.before}`);
    warmup = Math.max(0.5, t - warmup.by);
  }
  await flow((f, a) => f.go.race({ trackId: a.trackId, carId: a.carId, opponentId: null, gearbox: 'auto' }), { trackId, carId });
  await expectState('race');
  if (noEyeEase) await flow((f) => (f.view().eyeEase.window = 0));
  await manual(true);
  await flow((f, cam) => {
    f.skipCountdown();
    f.autopilot(true);
    for (let i = 0; i < 4 && f.camera() !== cam; i++) f.nextCamera();
  }, camera);
  // Into the race without drawing, then half a second of frames for the camera to settle.
  await flow((f, s) => f.advance(s), warmup);
  await page.evaluate(() => window.__qaFrames(new Array(30).fill(1 / 60)).length);
  const dts = pattern(pat, Math.round(seconds * (pat === 'hz144' ? 144 : 60)));
  const frames = [];
  for (let i = 0; i < dts.length; i += 120) frames.push(...(await page.evaluate((d) => window.__qaFrames(d), dts.slice(i, i + 120))));
  await manual(false);
  await page.screenshot({ path: `test-results/smooth-${trackId}-${camera}-${pat}.png`, timeout: 120000 }).catch(() => {});
  await flow((f) => f.autopilot(false));
  const a = analyse(frames);
  const name = `${trackId} ${carId} ${camera} ${pat}`;
  report.runs.push({ name, ...a, ...(process.env.SMOOTH_DEBUG ? { frames: frames.map((x) => ({ tick: x.tick, kind: x.kind, airborne: x.airborne, mph: x.mph, q: x.cameraQuat, car: x.carQuat, pos: x.car, wheels: x.wheels })) } : {}) });
  console.log(`  ${name} (${((Date.now() - t0) / 1000).toFixed(0)} s): ${JSON.stringify(a)}`);
  const n = a.frames || 1;
  check(a.car.stutters / n <= LIMIT.stutterFrac, `${name}: car stutter frames ${a.car.stutters}/${n}`);
  check(a.car.reversals <= LIMIT.reversals, `${name}: car reversals ${a.car.reversals}`);
  check(a.camera.stutters / n <= LIMIT.stutterFrac, `${name}: camera stutter frames ${a.camera.stutters}/${n}`);
  check(a.camera.reversals <= LIMIT.reversals, `${name}: camera reversals ${a.camera.reversals}`);
  if (camera === 'chase') {
    check(a.screenStep <= LIMIT.screenStep, `${name}: car on screen moves ≤ ${LIMIT.screenStep} px/frame (${a.screenStep})`);
    check(a.screenShake <= LIMIT.screenShake, `${name}: car on screen shake ≤ ${LIMIT.screenShake} px (${a.screenShake})`);
  }
  if (camera === 'chase') check(a.camTurn <= LIMIT.camTurn, `${name}: camera turn ≤ ${LIMIT.camTurn}°/frame (${a.camTurn})`);
  if (camera === 'cockpit') {
    check(a.camTurn <= LIMIT.camTurnInCar, `${name}: in-car camera turn ≤ ${LIMIT.camTurnInCar}°/frame (${a.camTurn})`);
    check(a.camJolt <= LIMIT.camTurnJolt, `${name}: in-car camera turn changes ≤ ${LIMIT.camTurnJolt}°/frame between frames (${a.camJolt})`);
  }
  check(a.wheels.off / Math.max(1, a.wheels.grounded) <= LIMIT.wheelFrac, `${name}: wheels on the road (${a.wheels.off}/${a.wheels.grounded} frames off, gap ${a.wheels.minGap}..${a.wheels.maxGap} m, drawn suspension ${a.wheels.travel[0]}..${a.wheels.travel[1]} m)`);
  for (const [kind, n] of Object.entries(a.wheels.known)) console.log(`WARN ${name}: wheels off the road on ${kind} in ${n} frames (known issue, docs/QA.md)`);
  check(a.lean <= LIMIT.lean, `${name}: body lean ≤ ${LIMIT.lean} rad (${a.lean})`);
}

/** Real-time menu walk: sample the canvas every animation frame; a blank frame is a plain-colour canvas under a see-through screen. */
async function transitions() {
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const probe = document.createElement('canvas');
    probe.width = 16;
    probe.height = 9;
    const g = probe.getContext('2d', { willReadFrequently: true });
    const log = (window.__qaBlank = { frames: 0, blank: 0, where: [] });
    const tick = () => {
      if (!window.__qaBlankOn) return;
      requestAnimationFrame(tick);
      g.drawImage(canvas, 0, 0, 16, 9);
      const d = g.getImageData(0, 0, 16, 9).data;
      let min = 255;
      let max = 0;
      for (let i = 0; i < d.length; i += 4) {
        const l = d[i] + d[i + 1] + d[i + 2];
        min = Math.min(min, l);
        max = Math.max(max, l);
      }
      const top = [...document.querySelectorAll('.cs-scr')].pop();
      const covered = top && top.classList.contains('solid');
      log.frames++;
      if (max - min < 6 && !covered) {
        log.blank++;
        if (log.where.length < 20) log.where.push(window.__cs.flow.state());
      }
    };
    window.__qaBlankOn = true;
    requestAnimationFrame(tick);
  });
  const press = async (k, wait = 400) => {
    await flow((f, a) => f.press(a), k);
    await page.waitForTimeout(wait);
  };
  await flow((f) => f.go.title());
  await page.waitForTimeout(1500);
  await press('confirm', 1500); // menu
  await press('confirm', 2500); // car select
  await press('confirm', 3000); // track select (the demo builds behind it)
  await press('back', 2500); // car select again
  await press('back', 2500); // menu
  await press('down', 300);
  await press('down', 300);
  await press('down', 300);
  await press('down', 300);
  await press('confirm', 2000); // high scores
  await press('back', 1500);
  const r = await page.evaluate(() => {
    window.__qaBlankOn = false;
    return window.__qaBlank;
  });
  report.transitions = r;
  console.log(`  transitions: ${JSON.stringify(r)}`);
  check(r.blank <= LIMIT.blank, `menus: no blank backdrop frames (${r.blank}/${r.frames}${r.where.length ? ` in ${[...new Set(r.where)].join(', ')}` : ''})`);
}

try {
  // Fresh storage without a reload (a reload mid-load logs the old page's aborted texture loads as errors).
  await page.addInitScript(() => localStorage.clear());
  await page.goto(`${base}/?scene=game`);
  await page.waitForFunction(() => window.__cs?.ready, null, { timeout: 90000 });
  await run('sunday-drive', 'car-rally', 'chase', 'jitter60', quick ? 4 : 8, 4);
  // In-car through a loop: the 20 Hz steps' uneven turns must not show as jolts (race-view.ts eyeEase).
  await run('lagoon-leap', 'car-super', 'cockpit', 'steady60', 4, { before: 'loop', by: 1 });
  if (!quick) {
    await run('sunday-drive', 'car-rally', 'chase', 'steady60', 6, 2);
    await run('lagoon-leap', 'car-super', 'chase', 'hz144', 6, 6);
    await run('lagoon-leap', 'car-buggy', 'chase', 'hitch', 8, 4);
    await run('palm-bay', 'car-touring', 'cockpit', 'jitter60', 6, 6);
    await run('skyline-stunts', 'car-stock', 'chase', 'jitter60', 8, 8);
  }
  await transitions();
} catch (e) {
  failures.push(String(e));
  console.error(e);
  await page.screenshot({ path: 'test-results/smooth-fail.png' });
}
if (errors.length) failures.push(...errors);
await browser.close();
fs.writeFileSync('test-results/smooth-check.json', JSON.stringify({ ...report, failures }, null, 1));
if (failures.length) {
  console.error(`smooth-check: ${failures.length} failure(s)\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('smooth-check: ok');
