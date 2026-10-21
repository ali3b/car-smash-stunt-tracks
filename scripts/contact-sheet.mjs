// A contact sheet of a video for review: frames at evenly spaced times (or the given ones), tiled with ffmpeg.
//   node scripts/contact-sheet.mjs <video> <out.png> [count=12 | t1,t2,...] [columns=3] [width=480]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [video, out, which = '12', cols = '3', width = '480'] = process.argv.slice(2);
if (!video || !out) {
  console.error('usage: node scripts/contact-sheet.mjs <video> <out.png> [count | t1,t2,...] [columns] [width]');
  process.exit(2);
}
const dur = Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video], { encoding: 'utf8' }).stdout.trim());
const times = which.includes(',') || which.includes('.') ? which.split(',').map(Number) : Array.from({ length: Number(which) }, (_, i) => ((i + 0.5) * dur) / Number(which));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'contact-'));
const files = [];
for (const [i, t] of times.entries()) {
  const f = path.join(tmp, `${String(i).padStart(3, '0')}.png`);
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', video, '-frames:v', '1', '-vf', `scale=${width}:-2,drawtext=text='${t.toFixed(2)}s':x=6:y=6:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.6`, f]);
  if (fs.existsSync(f)) files.push(f);
}
const rows = Math.ceil(files.length / Number(cols));
const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-framerate', '1', '-i', path.join(tmp, '%03d.png'), '-vf', `tile=${cols}x${rows}:padding=4`, '-frames:v', '1', out], { stdio: 'inherit' });
fs.rmSync(tmp, { recursive: true });
process.exit(r.status ?? 1);
