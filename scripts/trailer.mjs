// Cuts the trailer (~65 s), the short (~26 s) and a GIF from gameplay recorded frame by frame on our own tracks
// (scripts/record.mjs, the capture scene). Every cut lands on a bar of the race song "Redline Run" (150 bpm, a bar is
// 1.6 s): the song's intro / A / B sections set the pace, the titles are drawn in the game's own style and it ends
// on the logo. The engine, tyre and crash sound of every shot is the game's own, rendered with the frames.
//
//   node scripts/trailer.mjs [--base http://127.0.0.1:5308] [--gpu] [--only trailer|short] [--size 1920x1080] [--force]
// Output: test-results/video/trailer.mp4, short.mp4, trailer.gif; with --size: trailer-<w>x<h>.mp4 etc. (1080x1920 is
// the vertical short: every shot is re-rendered for the tall frame, not cropped).
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { M, TAKES, aerial, momentClip, still } from './cinema-moments.mjs';
import { OUT, duration, openCapture, recordClip } from './record.mjs';

const BAR = 1.6;
const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const base = opt('--base', 'http://127.0.0.1:5308');
const only = opt('--only', null);

const T = (text, sub, extra = {}) => ({ kind: 'title', text, sub, at: 0.05, dur: 1.5, ...extra });
const B = (text, colour = 'cyan', extra = {}) => ({ kind: 'banner', text, colour, at: 0.1, dur: 1.45, y: 0.8, ...extra });
const FLASH = { kind: 'flash', at: 0, dur: 0.18, strength: 0.7 };
const LB = (dur) => ({ kind: 'letterbox', amount: 1, at: 0, dur });

/** [moment, bars, overlays] — the trailer, bar by bar. */
const TRAILER = [
  // Intro (2 bars): the grid.
  ['launchCockpit', 1, [{ kind: 'fade', amount: 1, at: 0, dur: 0.12 }]],
  ['launchLow', 1, [FLASH]],
  // A: loops and rolls, riding with the car.
  ['loopChase', 1, [T('LOOPS')]],
  ['loopCockpit', 1, []],
  ['rollCockpit', 1, [T('BARREL ROLLS', null, { size: 48 })]],
  ['harvestLoopChase', 1, [FLASH]],
  // B: jumps, slow motion.
  ['bigAir', 2, [T('JUMPS', 'BIG AIR', { dur: 2.6, y: 0.26 }), LB(3.2)]],
  ['lagoonLeap', 1, [FLASH, B('OVER THE LAGOON', 'cyan', { y: 0.82 })]],
  ['cactusJump', 1, []],
  // A: racing the rivals.
  ['helixFront', 1, [T('RIVALS', 'WHEEL TO WHEEL')]],
  ['helixChase', 1, []],
  ['palmHighway', 1, [FLASH]],
  ['downtownDuel', 1, []],
  // B: pipes and crashes.
  ['skyPipeChase', 1, [T('PIPES')]],
  ['canalJump', 1, [FLASH]],
  ['leapFly', 1, [T('CRASHES', null, { colour: 'white' }), LB(1.6)]],
  ['leapSplash', 1, [LB(1.6)]],
  // Intro: breathe — the worlds.
  ['aerialTropical', 1, [B('TROPICAL')]],
  ['aerialDesert', 1, [B('DESERT', 'yellow')]],
  // A: the worlds, then speed.
  ['aerialCity', 1, [B('CITY')]],
  ['aerialAlpine', 1, [B('ALPINE', 'yellow')]],
  ['aerialCountry', 1, [B('COUNTRY')]],
  ['slalom', 1, [T('10 TRACKS', '5 WORLDS')]],
  // B: the big ones.
  ['plunge', 2, [LB(3.2), FLASH]],
  ['harvestSplash', 2, [LB(3.2)]],
  // A: build your own, the finale.
  ['tarnJump', 1, [FLASH]],
  ['palmBanked', 1, []],
  [still('editor/editor-harvest-havoc.png', 0.3), 1, [T('BUILD YOUR OWN', 'TRACK EDITOR', { size: 44 })]],
  ['harvestBig', 1, [FLASH]],
];
const ENDING = { moment: { take: 'glacier', shot: aerial(3.4, 120, 80), from: 25 }, bars: 4 };

const SHORT = [
  ['launchCockpit', 1, [{ kind: 'fade', amount: 1, at: 0, dur: 0.12 }]],
  ['launchLow', 1, [FLASH]],
  ['loopChase', 1, [T('LOOPS')]],
  ['rollCockpit', 1, []],
  ['bigAir', 2, [T('JUMPS', 'BIG AIR', { dur: 2.6, y: 0.26 }), LB(3.2)]],
  ['skyPipeChase', 1, [T('PIPES')]],
  ['helixFront', 1, [T('RIVALS')]],
  ['leapFly', 1, [T('CRASHES', null, { colour: 'white' }), LB(1.6)]],
  ['leapSplash', 1, [LB(1.6)]],
  ['plunge', 2, [LB(3.2), FLASH]],
];

function hash(x) {
  return crypto.createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 8);
}

/** The clips of a cut, each one shot lasting whole bars. */
function clipsOf(list, ending) {
  const clips = list.map(([name, bars, overlays]) => {
    const c = momentClip(name, name, bars * BAR, overlays);
    c.name = `tr-${typeof name === 'string' ? name : 'card'}-${hash(c)}`;
    return c;
  });
  if (ending) {
    const dur = ending.bars * BAR;
    const c = momentClip('end', ending.moment, dur, [
      { kind: 'logo', at: 0.3, dur: dur - 0.3, tagline: 'LOOPS · JUMPS · PIPES · RIVALS · BUILD YOUR OWN' },
      { kind: 'fade', amount: 0.35, at: 0, dur },
      { kind: 'fade', amount: 1, at: dur - 0.25, dur: 0.25 },
    ]);
    c.name = `tr-end-${hash(c)}`;
    clips.push(c);
  }
  return clips;
}

function ff(argv) {
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', ...argv], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${argv.join(' ')}`);
}

/** The race song from the game, rendered offline (cached). */
function music(song, seconds) {
  const file = path.join(OUT, `music-${song}-${seconds}.wav`);
  if (!fs.existsSync(file)) {
    const r = spawnSync('node', ['scripts/render-music.mjs', base, song, String(seconds), file], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('render-music failed');
  }
  return file;
}

/** Join clips (video + their own sound) and lay the song under them, beat 1 on frame 1. */
function edit(files, out, { song = 'race', sfx = 0.55, musicLevel = 0.9, scale = null } = {}) {
  const total = files.reduce((s, f) => s + duration(f), 0);
  const wav = music(song, Math.ceil(total + 4));
  const inputs = files.flatMap((f) => ['-i', f]);
  const n = files.length;
  const cat = files.map((_, i) => `[${i}:v][${i}:a]`).join('') + `concat=n=${n}:v=1:a=1[v0][a0]`;
  const v = scale ? `[v0]${scale}[v]` : '[v0]null[v]';
  const mix = `[${n}:a]atrim=start=0.05,asetpts=PTS-STARTPTS,volume=${musicLevel},afade=t=out:st=${(total - 3).toFixed(2)}:d=3[m];[a0]volume=${sfx}[s];[m][s]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.95[a]`;
  ff([...inputs, '-i', wav, '-filter_complex', `${cat};${v};${mix}`, '-map', '[v]', '-map', '[a]', '-t', total.toFixed(3), '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '60', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out]);
  console.log(`${out}: ${total.toFixed(1)} s`);
  return out;
}

const cuts = [];
if (!only || only === 'trailer') cuts.push(['trailer', clipsOf(TRAILER, ENDING)]);
if (!only || only === 'short') cuts.push(['short', clipsOf(SHORT, { ...ENDING, bars: 3 })]);

const [W, H] = opt('--size', '1280x720').split('x').map(Number);
const suffix = W === 1280 && H === 720 ? '' : `-${W}x${H}`;
const ctx = await openCapture({ base, width: W, height: H, gpu: flag('--gpu') });
const files = new Map();
try {
  // Record grouped by track (one world build per track), each clip once.
  const all = [...new Map(cuts.flatMap(([, c]) => c).map((c) => [c.name, c])).values()].sort((a, b) => (a.take?.track ?? '').localeCompare(b.take?.track ?? ''));
  for (const c of all) files.set(c.name, await recordClip(ctx, c, { force: flag('--force') }));
} finally {
  if (ctx.errors.length) console.error(ctx.errors.join('\n'));
  await ctx.browser.close();
}
for (const [name, clips] of cuts) {
  const out = edit(
    clips.map((c) => files.get(c.name)),
    path.join(OUT, `${name}${suffix}.mp4`),
  );
  if (name === 'short' && !suffix) {
    // The GIF: the side-by-side jump in slow motion, small and looping.
    const at = clips.slice(0, 4).reduce((s, c) => s + c.shots[0].dur, 0);
    ff(['-ss', String(at + 0.2), '-t', '2.9', '-i', out, '-vf', 'fps=15,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4', '-loop', '0', path.join(OUT, 'trailer.gif')]);
    console.log(`${path.join(OUT, 'trailer.gif')}`);
  }
}
