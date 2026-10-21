// Builds every model declared in ssg.models.json through the Synty Sprite Generator CLI (never its code):
//   npm run assets
// runs `ssg model apply ssg.models.json --out public/models --json`, which exports each model as a GLB plus its
// .model.json manifest and writes public/models/models.json (incremental: only changed specs are downloaded).
// The CLI prints a line per model on stderr and, with --json, a summary on stdout:
//   { dir, index, models: [{ name, id, action: 'written'|'updated'|'unchanged', cached, glb, manifest }] }
// Without an `ssg model` command (an old generator) it prints a notice and exits 0; the game then draws placeholder
// cars and track pieces.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SSG = process.env.SSG_BIN ?? '/home/andrew/projects/synty-sprite-generator/apps/cli/bin/ssg.mjs';
const spec = path.join(root, 'ssg.models.json');
const out = path.join(root, 'public/models');

if (!fs.existsSync(SSG)) {
  console.log(`assets: the ssg CLI is not at ${SSG} (set SSG_BIN). Skipping; the game uses placeholders.`);
  process.exit(0);
}
// An unknown command makes the CLI print its top-level help, so look for `model` in the command list.
const help = spawnSync(process.execPath, [SSG, '--help'], { encoding: 'utf8' });
if (!/^\s+model\b/m.test(help.stdout ?? '')) {
  console.log('assets: this generator has no `ssg model` command yet (3D model export is being built).');
  console.log(`assets: ${JSON.parse(fs.readFileSync(spec, 'utf8')).models.length} models are declared in ssg.models.json; nothing was built.`);
  console.log('assets: the game runs on placeholder cars and track pieces until then (FEEDBACK.md CS-FB-001).');
  process.exit(0);
}
fs.mkdirSync(out, { recursive: true });
// The terrain grids follow the bundled tracks (CS-FB-003): rewrite their entries in ssg.models.json first.
const ts = spawnSync(path.join(root, 'node_modules/.bin/vite-node'), ['scripts/build-terrain-specs.ts'], { cwd: root, stdio: 'inherit' });
if (ts.status !== 0) process.exit(ts.status ?? 1);
// CS-FB-130: the stunt pieces that must follow the simulation's surface are computed from it.
const ps = spawnSync(path.join(root, 'node_modules/.bin/vite-node'), ['scripts/build-piece-specs.ts'], { cwd: root, stdio: 'inherit' });
if (ps.status !== 0) process.exit(ps.status ?? 1);
const r = spawnSync(process.execPath, [SSG, 'model', 'apply', spec, '--out', out, '--json'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
let json = null;
try {
  json = JSON.parse(r.stdout);
} catch {
  /* not JSON */
}
if (r.status !== 0) {
  console.error(`assets: ssg model apply failed (exit ${r.status})`);
  console.error(json ? JSON.stringify(json, null, 2) : r.stdout);
  process.exit(1);
}
if (!json?.models) {
  console.log(r.stdout);
} else {
  const by = {};
  for (const m of json.models) by[m.action] = (by[m.action] ?? 0) + 1;
  const kb = json.models.reduce((n, m) => n + (fs.existsSync(path.join(out, m.glb)) ? fs.statSync(path.join(out, m.glb)).size : 0), 0) / 1024;
  console.log(`assets: ${json.models.length} models (${Object.entries(by).map(([a, n]) => `${n} ${a}`).join(', ')}), ${(kb / 1024).toFixed(1)} MB of GLBs`);
}
console.log(`assets: built into ${path.relative(root, out)}/`);

// Ground textures (ssg.textures.json) → public/textures/<name>.png via `ssg texture apply` (incremental: only changed
// textures are downloaded, dropped ones removed, textures.json indexes them; size/format from the file's defaults).
const texSpec = path.join(root, 'ssg.textures.json');
if (fs.existsSync(texSpec)) {
  const texOut = path.join(root, 'public/textures');
  const tr = spawnSync(process.execPath, [SSG, 'texture', 'apply', texSpec, '--out', texOut, '--json'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
  if (tr.status !== 0) {
    console.error(`assets: ssg texture apply failed (exit ${tr.status}): ${tr.stdout}`);
    process.exit(1);
  }
  let summary = null;
  try {
    summary = JSON.parse(tr.stdout);
  } catch {
    /* not JSON */
  }
  const list = summary?.textures ?? [];
  const by = {};
  for (const t of list) by[t.action ?? 'done'] = (by[t.action ?? 'done'] ?? 0) + 1;
  console.log(`assets: textures: ${list.length} (${Object.entries(by).map(([a, n]) => `${n} ${a}`).join(', ') || 'none'}) in public/textures/`);
}
