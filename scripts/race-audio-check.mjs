// Race audio check: the game's sound wired into the flow, heard through the real mix in headless Chromium.
//   - the menu music on the title, M mutes and unmutes, the Options volume sliders are saved;
//   - a race on two tracks with the autopilot, in real time: no race music until the 3-2-1 beeps and GO, then the race
//     song; the engine's pitch and level follow the rpm; tyre squeal in corners, not on the straights; a landing
//     thump after a jump (low-frequency energy in the recorded mix); checkpoint chimes and the finish fanfare; the
//     rival quieter the further away it is; in-car view; pause ducks; the engine clearly above the (ducked) music;
//     no sample above -1 dBFS anywhere;
//   - the results music, the replay (its sound follows normal play, muted while winding), and no car sound left after
//     leaving the race; the editor's music;
//   - no console errors.
// A WAV of the first seconds of the first race's mix goes to test-results/race-audio.wav, checked with ffmpeg
// volumedetect (when ffmpeg is installed).
//   node scripts/race-audio-check.mjs [http://127.0.0.1:5314]
import { chromium } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const [base = 'http://127.0.0.1:5314'] = process.argv.slice(2);
fs.mkdirSync('test-results', { recursive: true });
const env = { ...process.env };
delete env.DISPLAY;
delete env.WAYLAND_DISPLAY;
const browser = await chromium.launch({ env, args: ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

let ok = true;
const fail = (msg) => {
  ok = false;
  console.log(`FAIL: ${msg}`);
};
const pass = (msg) => console.log(`ok    ${msg}`);
const expect = (cond, msg) => (cond ? pass(msg) : fail(msg));
const db = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);

const flow = (fn, arg) => page.evaluate(([f, a]) => new Function('f', 'a', `return (${f})(f, a)`)(window.__cs.flow, a), [fn.toString(), arg]);
const state = () => flow((f) => f.state());
const song = () => page.evaluate(() => window.__cs.audio.currentSong);
const waitState = async (want, timeout = 120000) => {
  const t0 = Date.now();
  while ((await state()) !== want) {
    if (Date.now() - t0 > timeout) throw new Error(`expected state ${want}, got ${await state()}`);
    await page.waitForTimeout(100);
  }
};

/**
 * In the page: a tap on the final mix (after the limiter) that tracks the peak, records PCM on demand and measures
 * the low end around each landing; analysers on the music and car buses; a log of every one-shot; and a sampler
 * that records, every 50 ms, the race state next to the audio graph's state.
 */
async function instrument() {
  await page.evaluate(() => {
    const audio = window.__cs.audio;
    const ctx = audio.ctx;
    const mix = audio.mixer;
    const tap = ctx.createScriptProcessor(4096, 2, 2);
    const sink = ctx.createGain();
    sink.gain.value = 0;
    mix.limiter.connect(tap);
    tap.connect(sink).connect(ctx.destination);
    const R = (window.__rec = { peak: 0, recording: false, left: [], right: [], frames: 0, ring: new Float32Array(ctx.sampleRate * 2), ringAt: 0, lands: [], sfx: [], samples: [] });
    // One-pole low-pass at ~150 Hz for the thump measure.
    const k = 1 - Math.exp((-2 * Math.PI * 150) / ctx.sampleRate);
    let lp = 0;
    tap.onaudioprocess = (e) => {
      const l = e.inputBuffer.getChannelData(0);
      const r = e.inputBuffer.getChannelData(1);
      for (let i = 0; i < l.length; i++) {
        const a = Math.max(Math.abs(l[i]), Math.abs(r[i]));
        if (a > R.peak) R.peak = a;
        lp += ((l[i] + r[i]) / 2 - lp) * k;
        R.ring[R.ringAt] = lp;
        R.ringAt = (R.ringAt + 1) % R.ring.length;
      }
      if (R.recording) {
        R.left.push(new Float32Array(l));
        R.right.push(new Float32Array(r));
        R.frames += l.length;
      }
    };
    const bus = (node) => {
      const a = ctx.createAnalyser();
      a.fftSize = 2048;
      node.connect(a);
      return () => {
        const b = new Float32Array(a.fftSize);
        a.getFloatTimeDomainData(b);
        let s = 0;
        for (const v of b) s += v * v;
        return Math.sqrt(s / b.length);
      };
    };
    const musicRms = bus(mix.music);
    const worldRms = bus(mix.world);
    /** Low-passed RMS of the last `ms` of the mix ending `endAgo` ms ago. */
    const lowRms = (ms, endAgo) => {
      const n = Math.round((ctx.sampleRate * ms) / 1000);
      const end = R.ringAt - Math.round((ctx.sampleRate * endAgo) / 1000);
      let s = 0;
      for (let i = 0; i < n; i++) {
        const v = R.ring[(((end - n + i) % R.ring.length) + R.ring.length) % R.ring.length];
        s += v * v;
      }
      return Math.sqrt(s / n);
    };
    const emit = audio.emit.bind(audio);
    audio.emit = (type, e) => {
      if (type === 'finish' || type === 'impact' || type === 'crash') R.sfx.push({ name: `emit:${type}`, place: e.place ?? null, kind: e.kind ?? null, t: ctx.currentTime, state: window.__cs.flow.state() });
      return emit(type, e);
    };
    const orig = audio.sfx.bind(audio);
    audio.sfx = (name, opts = {}) => {
      R.sfx.push({ name, strength: opts.strength ?? null, t: ctx.currentTime, state: window.__cs.flow.state() });
      if (name === 'land' && (opts.strength ?? 0) >= 0.3) {
        // The low end in the 300 ms before the landing vs. the 300 ms after it.
        const before = lowRms(300, 0);
        setTimeout(() => R.lands.push({ strength: opts.strength, before, after: lowRms(300, 0) }), 320);
      }
      return orig(name, opts);
    };
    setInterval(() => {
      const f = window.__cs.flow;
      const st = f.state();
      if (st !== 'race' && st !== 'replay') return;
      const snap = f.snapshot();
      const stats = f.session()?.stats?.() ?? null;
      const e0 = audio.engines.get(0)?.voice;
      const e1 = audio.engines.get(1)?.voice;
      const ty = audio.tyreVoices.get(0)?.voice;
      const p = snap?.player;
      const o = snap?.opponent;
      R.samples.push({
        t: ctx.currentTime,
        state: st,
        kind: stats?.kind ?? null,
        finished: !!snap?.finished,
        crashed: !!p?.crashed,
        rpm: p?.sound?.rpm ?? null,
        slip: p?.sound ? Math.max(...p.sound.slip) : null,
        surface: p?.sound?.surface ?? null,
        grounded: p?.sound?.grounded ?? null,
        engGain: e0 ? e0.amp.gain.value : null,
        engHz: e0 ? e0.main.frequency.value : null,
        rivalGain: e1 ? e1.amp.gain.value : null,
        dist: p && o ? Math.hypot(p.pos[0] - o.pos[0], p.pos[1] - o.pos[1], p.pos[2] - o.pos[2]) : null,
        squeal: ty ? ty.squealGain.gain.value : null,
        music: musicRms(),
        world: worldRms(),
        worldGain: mix.world.gain.value,
        musicGain: mix.music.gain.value,
        cabin: audio.inCabin,
        song: audio.currentSong,
      });
    }, 50);
  });
}

const rec = () => page.evaluate(() => ({ peak: window.__rec.peak, lands: window.__rec.lands, sfx: window.__rec.sfx, samples: window.__rec.samples }));
const clearRec = () => page.evaluate(() => Object.assign(window.__rec, { lands: [], sfx: [], samples: [] }));

function pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy || 1);
}

/** Write the recorded PCM as a 16-bit stereo WAV. */
async function saveWav(path) {
  const { rate, b64 } = await page.evaluate(() => {
    const R = window.__rec;
    const n = R.frames;
    const pcm = new Int16Array(n * 2);
    let o = 0;
    for (let c = 0; c < R.left.length; c++) {
      const l = R.left[c];
      const r = R.right[c];
      for (let i = 0; i < l.length; i++) {
        pcm[o++] = Math.max(-32768, Math.min(32767, Math.round(l[i] * 32767)));
        pcm[o++] = Math.max(-32768, Math.min(32767, Math.round(r[i] * 32767)));
      }
    }
    const bytes = new Uint8Array(pcm.buffer);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    R.left = [];
    R.right = [];
    R.frames = 0;
    return { rate: window.__cs.audio.ctx.sampleRate, b64: btoa(s) };
  });
  const data = Buffer.from(b64, 'base64');
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(2, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 4, 28);
  h.writeUInt16LE(4, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(path, Buffer.concat([h, data]));
  return data.length / 4 / rate;
}

/** One race on autopilot in real time; returns the samples, one-shots and landings it produced. */
async function race(trackId, carId, opponentId, opts = {}) {
  console.log(`\n== ${trackId} (${carId}${opponentId ? ` vs ${opponentId}` : ''})`);
  await clearRec();
  await flow((f, a) => f.go.race({ trackId: a.trackId, carId: a.carId, opponentId: a.opponentId, gearbox: 'auto' }), { trackId, carId, opponentId });
  await waitState('race');
  expect((await song()) === null, 'no music on the grid before GO');
  await flow((f) => f.autopilot(true));
  if (opts.record) await page.evaluate(() => (window.__rec.recording = true));
  // The countdown runs in real time: 3, 2, 1, GO.
  await page.waitForFunction(() => window.__rec.sfx.some((s) => s.name === 'go'), null, { timeout: 15000 });
  await page.waitForTimeout(300);
  expect((await song()) === 'race', 'race music starts at GO');
  let paused = false;
  let cabin = false;
  const t0 = Date.now();
  while ((await state()) === 'race') {
    if (Date.now() - t0 > 6 * 60 * 1000) throw new Error('race took too long');
    const el = (Date.now() - t0) / 1000;
    if (opts.record && el > 14) {
      await page.evaluate(() => (window.__rec.recording = false));
      opts.record = false;
    }
    // Pause for a moment: the cars go quiet, the music ducks; then carry on.
    if (opts.pause && !paused && el > 18) {
      paused = true;
      const before = await page.evaluate(() => window.__cs.audio.mixer.music.gain.value);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(700);
      const g = await page.evaluate(() => ({ world: window.__cs.audio.mixer.world.gain.value, music: window.__cs.audio.mixer.music.gain.value }));
      expect(g.world < 0.02 && g.music < before * 0.8, `pause: car sounds off (world gain ${g.world.toFixed(3)}), music ducked (${before.toFixed(3)} → ${g.music.toFixed(3)})`);
      await flow((f) => f.press('back'));
      await page.waitForTimeout(500);
      const w = await page.evaluate(() => window.__cs.audio.mixer.world.gain.value);
      expect(w > 0.9, `resume: car sounds back (world gain ${w.toFixed(3)})`);
    }
    // A stretch in the car.
    if (opts.cabin && !cabin && el > 24) {
      cabin = true;
      await flow((f) => {
        for (let i = 0; i < 4 && f.camera() !== 'cockpit'; i++) f.nextCamera();
      });
      await page.waitForTimeout(3000);
      expect(await page.evaluate(() => window.__cs.audio.inCabin), 'in-car camera: the audio is in the cabin');
      await flow((f) => {
        for (let i = 0; i < 4 && f.camera() !== 'chase'; i++) f.nextCamera();
      });
    }
    await page.waitForTimeout(500);
  }
  await waitState('results');
  await page.waitForTimeout(1500);
  return rec();
}

function analyseRace(r, label, { landing = false, rival = false } = {}) {
  const racing = r.samples.filter((s) => s.state === 'race' && !s.finished && !s.crashed && s.rpm !== null && s.engGain !== null);
  console.log(`  ${racing.length} samples while racing`);
  const names = r.sfx.map((s) => s.name);
  const count = (n) => names.filter((x) => x === n).length;
  expect(count('beep') === 3 && count('go') === 1, `${label}: 3 countdown beeps and GO (${count('beep')} / ${count('go')})`);
  expect(count('checkpoint') >= 1, `${label}: checkpoint chimes (${count('checkpoint')})`);
  const fin = r.sfx.find((s) => s.name === 'emit:finish');
  if (rival) expect(!!fin && (fin.place === 1 ? count('finish') === 1 : true), `${label}: the finish sounds (place ${fin?.place}: the fanfare for a win, the chime when the rival was first)`);
  else expect(count('finish') === 1, `${label}: the finish fanfare`);
  // Engine: pitch locked to the rpm, level rising with it.
  const rpm = racing.map((s) => s.rpm);
  // Mean pitch and level per tenth of the rev range (the sampler and the 20 Hz steps are not in phase, so single
  // samples lag a little; the means must climb with the revs).
  const bins = Array.from({ length: 10 }, () => ({ n: 0, hz: 0, g: 0 }));
  for (const s of racing) {
    const b = bins[Math.min(9, Math.floor(s.rpm * 10))];
    b.n++;
    b.hz += s.engHz;
    b.g += s.engGain;
  }
  const used = bins.map((b, i) => ({ i, n: b.n, hz: b.hz / b.n, g: b.g / b.n })).filter((b) => b.n >= 8);
  console.log(`  engine per rpm tenth: ${used.map((b) => `${b.i}:${b.hz.toFixed(0)}Hz/${b.g.toFixed(3)}`).join(' ')}`);
  const cHz = pearson(used.map((b) => b.i), used.map((b) => b.hz));
  const cGain = pearson(used.map((b) => b.i), used.map((b) => b.g));
  const cRaw = pearson(rpm, racing.map((s) => s.engHz));
  expect(cHz > 0.97, `${label}: engine pitch follows the rpm (binned r = ${cHz.toFixed(3)}, per sample ${cRaw.toFixed(3)})`);
  expect(cGain > 0.8, `${label}: engine level follows the rpm (binned r = ${cGain.toFixed(3)})`);
  // Tyres: squeal in corners (and on ice / in loops), quiet on paved straights.
  const SQ = 0.006;
  const straight = racing.filter((s) => s.kind === 'straight' && s.surface === 'paved' && s.grounded);
  const corners = racing.filter((s) => /corner|chicane|bank/.test(s.kind ?? ''));
  const sqStraight = straight.filter((s) => s.squeal > SQ).length / Math.max(1, straight.length);
  const sqCorner = corners.filter((s) => s.squeal > SQ).length / Math.max(1, corners.length);
  const maxCorner = Math.max(0, ...corners.map((s) => s.squeal));
  console.log(`  squeal > ${SQ}: ${(sqStraight * 100).toFixed(1)}% of ${straight.length} straight samples, ${(sqCorner * 100).toFixed(1)}% of ${corners.length} corner samples (max ${maxCorner.toFixed(3)})`);
  expect(sqStraight < 0.03, `${label}: tyres quiet on the straights`);
  // Mix: the cars clearly above the (ducked) race music.
  const busy = racing.filter((s) => s.song === 'race' && s.music > 0.002 && s.worldGain > 0.9);
  const music = Math.sqrt(busy.reduce((a, s) => a + s.music ** 2, 0) / Math.max(1, busy.length));
  const world = Math.sqrt(busy.reduce((a, s) => a + s.world ** 2, 0) / Math.max(1, busy.length));
  const ratio = db(world / music);
  console.log(`  mean RMS: cars ${db(world).toFixed(1)} dBFS, music ${db(music).toFixed(1)} dBFS (cars − music ${ratio.toFixed(1)} dB)`);
  expect(ratio > 3, `${label}: the cars are clearly above the music (${ratio.toFixed(1)} dB)`);
  if (landing) {
    const hits = {};
  for (const s of r.sfx.filter((s) => s.name === 'emit:impact')) hits[s.kind] = (hits[s.kind] ?? 0) + 1;
  console.log(`  impacts: ${JSON.stringify(hits)}, crashes ${r.sfx.filter((s) => s.name === 'emit:crash').length}`);
  const lands = r.lands.filter((l) => l.strength >= 0.3);
    for (const l of lands) console.log(`  landing ${l.strength.toFixed(2)}: low end ${db(l.before).toFixed(1)} → ${db(l.after).toFixed(1)} dBFS`);
    expect(lands.some((l) => l.after > l.before * 1.25), `${label}: a landing thump after a jump (${lands.length} landings)`);
  }
  if (rival) {
    const rs = racing.filter((s) => s.rivalGain !== null && s.dist !== null && s.dist > 2);
    const near = rs.filter((s) => s.dist < 25);
    const far = rs.filter((s) => s.dist > 60);
    const mean = (a) => a.reduce((x, s) => x + s.rivalGain, 0) / Math.max(1, a.length);
    console.log(`  rival engine gain: ${near.length} near samples ${mean(near).toFixed(4)}, ${far.length} far samples ${mean(far).toFixed(4)}`);
    expect(near.length && far.length ? mean(far) < mean(near) * 0.5 : mean(rs) > 0, 'the rival is quieter far away');
  }
  return { racing, sqCorner, maxCorner };
}

try {
  await page.goto(`${base}/?scene=game`);
  await page.waitForFunction(() => window.__cs?.ready === true && window.__cs.audio, null, { timeout: 120000 });
  await page.evaluate(() => localStorage.removeItem('cs.audio'));
  await page.mouse.click(400, 10);
  await page.waitForFunction(() => window.__cs.audio.ctx?.state === 'running', null, { timeout: 10000 });
  await instrument();
  // Software GL can't draw the race in real time; the sound needs real time. Everything but the drawing runs.
  await flow((f) => f.drawing(false));
  // (The unlocking click may have gone on from the title to the main menu.)
  await page.waitForFunction(() => ['title', 'menu'].includes(window.__cs.flow.state()), null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  expect((await song()) === 'menu', `title / menu: menu music (${await song()})`);
  const lvl = await page.evaluate(() => window.__cs.audio.level());
  expect(lvl > 0.003, `title: the music is heard (RMS ${db(lvl).toFixed(1)} dBFS)`);

  // M mutes and unmutes.
  await page.keyboard.press('m');
  await page.waitForTimeout(300);
  const muted = await page.evaluate(() => ({ m: window.__cs.audio.settings.muted, g: window.__cs.audio.mixer.master.gain.value }));
  await page.keyboard.press('m');
  await page.waitForTimeout(300);
  const unmuted = await page.evaluate(() => window.__cs.audio.settings.muted);
  expect(muted.m && muted.g < 0.05 && !unmuted, 'M mutes and unmutes');

  // Options: the music volume slider, saved.
  await flow((f) => f.go.options());
  await waitState('options');
  for (let i = 0; i < 5; i++) await flow((f) => f.press('down'));
  await flow((f) => f.press('left'));
  await flow((f) => f.press('left'));
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('cs.audio') ?? '{}'));
  expect(Math.abs(saved.music - 0.4) < 0.01, `Options: MUSIC down two notches is saved (music ${saved.music})`);
  await flow((f) => f.press('right'));
  await flow((f) => f.press('right'));
  const sfxCount = await page.evaluate(() => window.__rec.sfx.filter((s) => ['click', 'select', 'back'].includes(s.name)).length);
  expect(sfxCount >= 8, `menu navigation sounds (${sfxCount})`);
  await flow((f) => f.go.menu());
  await waitState('menu');
  expect((await song()) === 'menu', 'menu music on the main menu');

  // Race 1: a gentle lap with a rival, recorded; pause and in-car view on the way.
  const r1 = await race('sunday-drive', 'car-sr-muscle', 'gus', { record: true, pause: true, cabin: true });
  const secs = await saveWav('test-results/race-audio.wav');
  console.log(`  test-results/race-audio.wav: ${secs.toFixed(1)} s`);
  const a1 = analyseRace(r1, 'sunday-drive', { rival: true });
  expect((await song()) === 'results', `results music (${await song()})`);
  const quiet = await page.evaluate(() => [...window.__cs.audio.engines.values()].filter((h) => h.voice).length);
  expect(quiet === 0, `no engine running under the results (${quiet})`);

  // The replay: race music, the cars heard; muted while winding; back to the results.
  const ini = await page.evaluate(() => !!document.querySelector('.cs-res .slots'));
  if (ini) await flow((f) => f.press('confirm'));
  await page.click('.cs-res [data-act="watch"]');
  await waitState('replay');
  await page.waitForTimeout(2500);
  const rp = await page.evaluate(() => ({ song: window.__cs.audio.currentSong, eng: window.__cs.audio.engines.get(0)?.voice?.amp.gain.value ?? 0, world: window.__cs.audio.mixer.world.gain.value }));
  expect(rp.song === 'race' && rp.eng > 0.05 && rp.world > 0.9, `replay: race music and the car's engine (gain ${rp.eng.toFixed(3)})`);
  await flow((f) => f.press('right'));
  await page.waitForTimeout(600);
  const ff = await page.evaluate(() => window.__cs.audio.mixer.world.gain.value);
  expect(ff < 0.02, `replay fast-forward: car sounds muted (world gain ${ff.toFixed(3)})`);
  await flow((f) => f.press('back'));
  await waitState('results');

  // Race 2: jumps (a landing thump), solo.
  await flow((f) => f.go.menu());
  const r2 = await race('cactus-canyon', 'car-rally', null);
  const a2 = analyseRace(r2, 'cactus-canyon', { landing: true });
  // The autopilot is a tidy driver: its hardest corners are where the tyres sing (not every track has them).
  expect(Math.max(a1.maxCorner, a2.maxCorner) > 0.006 && Math.max(a1.sqCorner, a2.sqCorner) > 0.02, 'tyres squeal in the hard corners');

  // Leaving the race: nothing keeps playing once the music stops.
  await flow((f) => f.go.menu());
  await waitState('menu');
  await page.waitForTimeout(800);
  expect((await song()) === 'menu', 'back on the menu: menu music');
  await page.evaluate(() => window.__cs.audio.music(null));
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => ({ rms: window.__cs.audio.level(), voices: [...window.__cs.audio.engines.values()].filter((h) => h.voice).length }));
  expect(after.rms < 0.0005 && after.voices === 0, `after the race: silence without the music (RMS ${db(after.rms).toFixed(1)} dBFS, ${after.voices} engines)`);

  const peak = (await rec()).peak;
  expect(peak < 0.891, `no clipping: peak ${db(peak).toFixed(2)} dBFS (< -1 dBFS)`);

  // The editor's music.
  await page.goto(`${base}/?scene=editor`);
  await page.waitForFunction(() => document.body.classList.contains('editor'), null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.mouse.click(5, 300);
  await page.waitForTimeout(800);
  const ed = await page.evaluate(() => window.__cs.audio?.currentSong ?? `none (ctx ${window.__cs.audio?.ctx?.state})`);
  expect(ed === 'editor', `editor music (${ed})`);
} catch (e) {
  fail(String(e?.stack ?? e));
}

// ffmpeg's view of the WAV.
if (fs.existsSync('test-results/race-audio.wav')) {
  try {
    // volumedetect reports on stderr.
    const p = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', 'test-results/race-audio.wav', '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
    if (p.error) throw p.error;
    const res = p.stderr;
    const mean = Number(/mean_volume: (-?[\d.]+) dB/.exec(res)?.[1]);
    const max = Number(/max_volume: (-?[\d.]+) dB/.exec(res)?.[1]);
    console.log(`\nffmpeg volumedetect on the race mix: mean ${mean} dB, max ${max} dB`);
    expect(max < -1, `WAV peak below -1 dBFS (${max} dB)`);
    expect(mean > -35 && mean < -8, `WAV loud enough and not crushed (mean ${mean} dB)`);
  } catch (e) {
    console.log(`(ffmpeg not available: ${e.message.split('\n')[0]})`);
  }
}

const real = errors.filter((e) => !/favicon/.test(e));
expect(real.length === 0, `no console errors${real.length ? `: ${real.slice(0, 5).join(' | ')}` : ''}`);
await browser.close();
console.log(ok ? '\nRACE AUDIO CHECK PASSED' : '\nRACE AUDIO CHECK FAILED');
process.exit(ok ? 0 : 1);
