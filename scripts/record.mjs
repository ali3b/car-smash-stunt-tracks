// Records gameplay clips frame by frame through the capture scene (?scene=capture, src/scenes/capture.ts): each
// frame is rendered on request at an exact take time, returned as a JPEG and piped into ffmpeg; the clip's own
// engine / tyre / impact sound is rendered offline from the same frames and muxed in. Frame-exact, so SwiftShader
// is fine (only slower); --gpu uses the GPU through EGL.
//
// Only our bundled tracks can be filmed (the capture scene refuses anything else): never the reference tracks or
// the replay viewer's footage of the original.
//
//   node scripts/record.mjs <clips.json | built-in set> [--base http://127.0.0.1:5308] [--size 1280x720] [--gpu] [--force]
//
// A clip:
//   { name, take: { track, car, rival?, pace?, flat?, seconds },
//     shots: [ { shot: <Shot, src/render/cinema.ts>, from: <take s>, dur: <video s>, rate?: <take s per video s>,
//                hud?: true, overlays?: [ { ...Overlay, at: <s into the shot>, dur: <s> } ] } ] }
// Output: test-results/video/clips/<name>[-<w>x<h>].mp4 (60 fps H.264 + AAC), skipped when it is up to date.
import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { M, TAKES } from './cinema-moments.mjs';

export const FPS = 60;
export const OUT = 'test-results/video';

/** A browser page on the capture scene at a given size. */
export async function openCapture({ base = 'http://127.0.0.1:5308', width = 1280, height = 720, gpu = false } = {}) {
  const env = { ...process.env };
  delete env.DISPLAY;
  delete env.WAYLAND_DISPLAY;
  const args = ['--headless=new', ...(gpu ? ['--use-angle=gl-egl', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])];
  const browser = await chromium.launch({ env, args });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  await page.goto(`${base}/?scene=capture`);
  await page.waitForFunction(() => window.__cs?.ready || window.__cs?.error, null, { timeout: 120000 });
  const err = await page.evaluate(() => window.__cs.error);
  if (err) throw new Error(err);
  return { browser, page, errors, width, height };
}

const cap = (page, fn, arg) => page.evaluate(([f, a]) => new Function('c', 'a', `return (${f})(c, a)`)(window.__cs.capture, a), [fn.toString(), arg]);

/** Simulate a take; returns its summary (sections, jumps, crashes, close racing). */
export const loadTake = (page, take) => cap(page, (c, t) => c.load(t), take);

/** The overlays live at video time v into a shot. */
function overlaysAt(shot, v) {
  return (shot.overlays ?? []).filter((o) => v >= o.at && v < o.at + o.dur).map(({ at, dur, ...o }) => ({ ...o, p: (v - at) / dur }));
}

function hashOf(x) {
  return crypto.createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 12);
}

/** Frames of a clip, as [take time, shot index, video time into the shot]. */
export function clipFrames(clip) {
  const frames = [];
  for (const [i, s] of clip.shots.entries()) {
    const n = Math.round(s.dur * FPS);
    for (let k = 0; k < n; k++) frames.push({ i, v: k / FPS, t: (s.from ?? 0) + (k / FPS) * (s.rate ?? 1), dt: (s.rate ?? 1) / FPS, u: n > 1 ? k / (n - 1) : 0 });
  }
  return frames;
}

/**
 * A clip may name a moment of scripts/cinema-moments.mjs instead of spelling out its take and shot:
 *   { name, moment: 'loopChase', dur, overlays? }   (one shot; the moment's own take, start, rate and blur)
 */
export function resolveClip(clip) {
  if (!clip.moment) return clip;
  const m = M[clip.moment];
  if (!m) throw new Error(`${clip.name}: no moment "${clip.moment}"`);
  const { take, ...shot } = m;
  const { moment, dur, overlays = [], name, ...extra } = clip;
  return { name, take: take ? TAKES[take] : null, shots: [{ ...shot, dur, overlays, ...extra }] };
}

/** Render one clip to MP4 (video + its own sound). */
export async function recordClip(ctx, clip, { force = false } = {}) {
  clip = resolveClip(clip);
  const { page, width, height } = ctx;
  const suffix = width === 1280 && height === 720 ? '' : `-${width}x${height}`;
  const dir = path.join(OUT, 'clips');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${clip.name}${suffix}.mp4`);
  const stamp = `${file}.json`;
  const hash = hashOf({ clip, width, height, v: 7 });
  if (!force && fs.existsSync(file) && fs.existsSync(stamp) && JSON.parse(fs.readFileSync(stamp, 'utf8')).hash === hash) {
    console.log(`  ${clip.name}: up to date`);
    return file;
  }
  const t0 = Date.now();
  if (clip.take) await loadTake(page, clip.take);
  if (!clip.take && clip.shots.some((s) => !s.card)) throw new Error(`${clip.name}: a shot without a take`);
  const frames = clipFrames(clip);
  await cap(page, (c) => c.clipStart(60));
  const silent = `${file}.video.mp4`;
  const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(FPS), silent], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', (code) => (code === 0 ? res() : rej(new Error(`ffmpeg ${code}`)))));
  for (const [n, f] of frames.entries()) {
    const s = clip.shots[f.i];
    const req = { t: f.t, shot: s.shot, dt: n > 0 && frames[n - 1].i === f.i ? f.dt : 0, u: f.u, hud: !!s.hud, slow: s.rate ?? 1, blur: s.blur ?? clip.blur ?? 1, overlays: overlaysAt(s, f.v) };
    const b64 = s.card ? await cap(page, (c, r) => c.card(r.overlays, r.opts), { overlays: req.overlays, opts: { ...s.card, p: f.u } }) : await cap(page, (c, r) => c.frame(r), req);
    const buf = Buffer.from(b64, 'base64');
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (n % 120 === 0) process.stdout.write(`\r  ${clip.name}: ${n}/${frames.length} frames`);
  }
  ff.stdin.end();
  await done;
  const wav = Buffer.from(await cap(page, (c) => c.clipSound()), 'base64');
  const wavFile = `${file}.wav`;
  fs.writeFileSync(wavFile, wav);
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', silent, '-i', wavFile, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', String(frames.length / FPS), file], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('mux failed');
  fs.rmSync(silent);
  fs.writeFileSync(stamp, JSON.stringify({ hash, seconds: frames.length / FPS }));
  console.log(`\r  ${clip.name}: ${frames.length} frames (${(frames.length / FPS).toFixed(1)} s) in ${((Date.now() - t0) / 1000).toFixed(0)} s → ${file}`);
  return file;
}

/** Single frames of the loaded take (scouting shots): [{ t, shot, file }]; a short run-up settles smoothed cameras. */
export async function stills(ctx, list) {
  for (const s of list) {
    let b64 = null;
    for (let k = 12; k >= 0; k--) b64 = await cap(ctx.page, (c, r) => c.frame(r), { t: s.t - k / 30, shot: s.shot, dt: k === 12 ? 0 : 1 / 30, u: s.u ?? 0, hud: !!s.hud, overlays: s.overlays ?? [] });
    fs.mkdirSync(path.dirname(s.file), { recursive: true });
    fs.writeFileSync(s.file, Buffer.from(b64, 'base64'));
  }
}

/** Duration of a media file in seconds. */
export function duration(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return Number(r.stdout.trim());
}

// ---- CLI ---------------------------------------------------------------------------------------------------------

if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  const args = process.argv.slice(2);
  const flag = (k) => {
    const i = args.indexOf(k);
    return i >= 0 ? (args.splice(i, 1), true) : false;
  };
  const opt = (k, d) => {
    const i = args.indexOf(k);
    return i >= 0 ? args.splice(i, 2)[1] : d;
  };
  const gpu = flag('--gpu');
  const force = flag('--force');
  const base = opt('--base', 'http://127.0.0.1:5308');
  const [width, height] = opt('--size', '1280x720').split('x').map(Number);
  const only = opt('--only', null);
  const src = args[0];
  if (!src) {
    console.error('usage: node scripts/record.mjs <clips.json|clips.mjs> [--only name] [--size WxH] [--gpu] [--force]');
    process.exit(2);
  }
  const clips = src.endsWith('.json') ? JSON.parse(fs.readFileSync(src, 'utf8')) : (await import(path.resolve(src))).CLIPS;
  const ctx = await openCapture({ base, width, height, gpu });
  try {
    for (const clip of clips) if (!only || only.split(',').includes(clip.name)) await recordClip(ctx, clip, { force });
  } finally {
    if (ctx.errors.length) console.error(ctx.errors.join('\n'));
    await ctx.browser.close();
  }
}
