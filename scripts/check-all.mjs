// Every check in one go, one after the other, with a pass/fail summary at the end:
//   typecheck, vitest, then the Playwright checks against a running dev server.
//   node scripts/check-all.mjs [http://127.0.0.1:5197]   (127.0.0.1: Chromium drops localhost requests with ERR_NETWORK_CHANGED when
//   this machine's virtual network interfaces change)
//   [--only name,name] [--skip name,name]
// Each check's output goes to test-results/check-all/<name>.log; the browser checks write their screenshots to
// test-results/ as usual. Exits 1 when any check failed.
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const args = process.argv.slice(2);
const url = args.find((a) => /^https?:\/\//.test(a)) ?? 'http://127.0.0.1:5197';
const list = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? new Set(args[i + 1].split(',')) : null;
};
const only = list('--only');
const skip = list('--skip') ?? new Set();

const CHECKS = [
  ['typecheck', 'npx', ['tsc', '--noEmit']],
  ['vitest', 'npx', ['vitest', 'run']],
  ['load-check', 'node', ['scripts/load-check.mjs', url, 'game']],
  ['flow-check', 'node', ['scripts/flow-check.mjs', url]],
  ['drive-check', 'node', ['scripts/drive-check.mjs', url]],
  ['track-check', 'node', ['scripts/track-check.mjs', url, '--bundled']],
  ['editor-check', 'node', ['scripts/editor-check.mjs', url]],
  ['audio-check', 'node', ['scripts/audio-check.mjs', url]],
  ['race-audio-check', 'node', ['scripts/race-audio-check.mjs', url]],
  ['ship-check', 'node', ['scripts/ship-check.mjs', url]],
  ['mobile-check', 'node', ['scripts/mobile-check.mjs', url]],
];

fs.mkdirSync('test-results/check-all', { recursive: true });
const browserCheck = (name) => name.endsWith('-check');
if (CHECKS.some(([n]) => browserCheck(n) && !skip.has(n) && (!only || only.has(n)))) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    console.error(`check-all: no dev server at ${url} (${e.message}); start one with npm run dev`);
    process.exit(1);
  }
}

function runOne(name, cmd, argv) {
  return new Promise((resolve) => {
    const log = fs.createWriteStream(`test-results/check-all/${name}.log`);
    const t0 = Date.now();
    const p = spawn(cmd, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    const onData = (d) => {
      log.write(d);
      tail = (tail + d.toString()).slice(-600);
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('close', (code) => {
      log.end();
      resolve({ name, ok: code === 0, seconds: (Date.now() - t0) / 1000, tail });
    });
  });
}

const results = [];
for (const [name, cmd, argv] of CHECKS) {
  if (skip.has(name) || (only && !only.has(name))) continue;
  process.stdout.write(`${name.padEnd(13)} … `);
  const r = await runOne(name, cmd, argv);
  console.log(`${r.ok ? 'pass' : 'FAIL'} (${r.seconds.toFixed(0)} s)`);
  if (!r.ok) console.log(r.tail.split('\n').slice(-6).map((l) => `    ${l}`).join('\n'));
  results.push(r);
}

console.log('\nsummary');
for (const r of results) console.log(`  ${r.ok ? 'pass' : 'FAIL'}  ${r.name.padEnd(13)} ${r.seconds.toFixed(0).padStart(4)} s   test-results/check-all/${r.name}.log`);
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length} of ${results.length} failed: ${failed.map((r) => r.name).join(', ')}` : `\nall ${results.length} passed`);
process.exit(failed.length ? 1 : 0);
