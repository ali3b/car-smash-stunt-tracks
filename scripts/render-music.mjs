// Renders one of the game's songs (src/audio/songs) offline in headless Chromium and writes it as a 16-bit WAV, for
// the trailer and the documentary.
//   node scripts/render-music.mjs <url> <song> <seconds> <out.wav>     e.g. http://localhost:5197 menu 240 x.wav
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const [base = 'http://localhost:5197', song = 'menu', seconds = '60', out = `test-results/music-${song}.wav`] = process.argv.slice(2);
const env = { ...process.env };
delete env.DISPLAY;
delete env.WAYLAND_DISPLAY;
const browser = await chromium.launch({ env, args: ['--headless=new'] });
const page = await browser.newPage();
await page.goto(`${base}/?scene=audio`);
// Vite serves the source modules, so the page can import the audio module directly.
const b64 = await page.evaluate(async ({ song, seconds }) => {
  const audio = await import('/src/audio/index.ts');
  const { rate, left, right } = await audio.renderSongPcm(song, seconds);
  const n = left.length;
  const pcm = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) {
    pcm[2 * i] = Math.max(-1, Math.min(1, left[i])) * 32767;
    pcm[2 * i + 1] = Math.max(-1, Math.min(1, right[i])) * 32767;
  }
  const bytes = new Uint8Array(pcm.buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { rate, data: btoa(s) };
}, { song, seconds: Number(seconds) });
await browser.close();
const data = Buffer.from(b64.data, 'base64');
const h = Buffer.alloc(44);
h.write('RIFF', 0);
h.writeUInt32LE(36 + data.length, 4);
h.write('WAVEfmt ', 8);
h.writeUInt32LE(16, 16);
h.writeUInt16LE(1, 20);
h.writeUInt16LE(2, 22);
h.writeUInt32LE(b64.rate, 24);
h.writeUInt32LE(b64.rate * 4, 28);
h.writeUInt16LE(4, 32);
h.writeUInt16LE(16, 34);
h.write('data', 36);
h.writeUInt32LE(data.length, 40);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([h, data]));
console.log(`render-music: ${song} ${seconds}s → ${out}`);
