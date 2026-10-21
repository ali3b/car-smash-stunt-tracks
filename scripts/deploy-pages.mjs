// Builds the game for GitHub Pages and (without --no-push) publishes dist/ to the gh-pages branch of `origin`.
//   node scripts/deploy-pages.mjs --no-push  build dist/ only (check it: npx vite preview, or any static server)
//   node scripts/deploy-pages.mjs            build, then force-push gh-pages (only once publishing is approved)
// dist/ holds:
//   - the game (vite build; base './' so it runs from a Pages sub-path), with public/models copied in by vite. The
//     models are generated locally by `npm run assets` and are git-ignored in the source branch (Synty EULA: no
//     source assets); the Pages build carries only the game-ready GLBs the game loads.
//   - videos/: the trailer, the short, the GIF (test-results/video, from the trailer script) and the documentary
//     (test-results/documentary/documentary.mp4), when they exist
//   - gallery.html: the videos and the screenshots (docs/screenshots, as JPEGs)
// A guard scans everything in dist/ before anything is published and aborts the build if it finds material that must
// stay local: the reverse-engineering folders, the local reference tracks, data files in the original's formats, or
// names that must never appear in public.
import { execFileSync, execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const push = !process.argv.includes('--no-push');
const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: 'inherit' });
/** The Pages branch should stay well under GitHub's soft limits. */
const MAX_MB = 200;

const hasModels = existsSync(path.join(root, 'public/models/models.json'));
if (!hasModels) {
  if (push) {
    console.error('deploy: no public/models/models.json; run `npm run assets` first (the Pages build needs the real models)');
    process.exit(1);
  }
  console.warn('deploy: no public/models/models.json: this build runs on placeholders (npm run assets)');
}
rmSync(dist, { recursive: true, force: true });
run('npm run build');
writeFileSync(path.join(dist, '.nojekyll'), '');
if (hasModels && !existsSync(path.join(dist, 'models/models.json'))) throw new Error('deploy: vite did not copy public/models into dist/models');

// ---- videos (git-ignored; made by the trailer and documentary scripts) ---------------------------------------------
const VIDEOS = [
  ['test-results/video/trailer.mp4', 'trailer.mp4'],
  ['test-results/video/short.mp4', 'short.mp4'],
  ['test-results/video/trailer.gif', 'car-smash.gif'],
  ['test-results/documentary/documentary.mp4', 'documentary.mp4'],
];
mkdirSync(path.join(dist, 'videos'), { recursive: true });
const haveVideo = new Set();
for (const [src, name] of VIDEOS) {
  const f = path.join(root, src);
  if (existsSync(f)) {
    copyFileSync(f, path.join(dist, 'videos', name));
    haveVideo.add(name);
  } else console.warn(`deploy: no ${src}; the gallery leaves it out`);
}

// ---- the gallery ----------------------------------------------------------------------------------------------------
const SCREENS = [
  ['title', 'The title screen over the demo race'],
  ['race-chase', '<b>Skyline Stunts</b> against a rival, from the chase cam'],
  ['race-incar', 'The in-car view with our own dashboard'],
  ['loop', 'Upside down on the loop at <b>Lagoon Leap</b>'],
  ['track-select', 'Choosing a track: map, stunts and best times'],
  ['editor', 'The track editor: a 30 × 30 grid, live 3D preview and a circuit check'],
  ['dos-look', 'F2: the DOS look, 256 colours'],
  ['mobile-race', 'On a phone: pedals, steering (or tilt), camera and pause on screen'],
];
const shotDir = path.join(dist, 'screenshots');
mkdirSync(shotDir, { recursive: true });
const shot = (name) => {
  const src = path.join(root, 'docs/screenshots', `${name}.png`);
  if (!existsSync(src)) return null;
  const out = path.join(shotDir, `${name}.jpg`);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', src, '-q:v', '3', out]);
  return `screenshots/${name}.jpg`;
};
const figure = (img, alt, caption) => `<figure><a href="${img}"><img src="${img}" alt="${alt}" loading="lazy" width="1280" height="720" /></a><figcaption>${caption}</figcaption></figure>`;
const screens = SCREENS.map(([n, c]) => [shot(n), c])
  .filter(([img]) => img)
  .map(([img, c]) => figure(img, c.replace(/<[^>]+>/g, ''), c))
  .join('\n          ');
const video = (file, title, poster) =>
  haveVideo.has(file)
    ? `<section class="panel"><h2>${title}</h2><video controls preload="metadata" playsinline${poster ? ` poster="${poster}"` : ''}><source src="videos/${file}" type="video/mp4" /></video></section>`
    : '';
const videos = [video('trailer.mp4', 'THE TRAILER', 'screenshots/title.jpg'), video('short.mp4', 'THE 30-SECOND SHORT'), video('documentary.mp4', 'THE MAKING OF')].filter(Boolean).join('\n      ');
mkdirSync(path.join(dist, 'fonts'), { recursive: true });
copyFileSync(path.join(root, 'node_modules/@fontsource/press-start-2p/files/press-start-2p-latin-400-normal.woff2'), path.join(dist, 'fonts/press-start-2p-latin-400-normal.woff2'));
const page = readFileSync(path.join(root, 'scripts/pages/gallery.html'), 'utf8').replace('<!--VIDEOS-->', videos).replace('<!--SCREENS-->', screens);
writeFileSync(path.join(dist, 'gallery.html'), page);

// ---- the guard: nothing from the original in dist/ ----------------------------------------------------------------
const files = [];
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else files.push(p);
  }
};
walk(dist);
/** Folders that hold the original or what was derived from it (git-ignored, local only). */
const BAD_DIRS = new Set(['local-tracks', 'spec', 're', 'research', 'original-game', 'golden']);
/** File types of the original's data (tracks, replays, shapes, bitmaps, sound, code). */
const BAD_EXT = /\.(trk|rpl|pvs|pes|p3s|vsh|esh|3sh|kms|hdr|cod|dif|cmn|ovl|drv|exe|com|vce|sfx)$/i;
/** Text that must never be in the public build: names of the original and its makers, and local-only paths. */
const BAD_TEXT = [
  /4D[\s-]*Sports/i,
  /Br[øo]derbund/i,
  /Distinctive\s+Software/i,
  /\bStunt\s+Driver\b/i,
  /4dstunts/i,
  /\bremake\b/i,
  /local-tracks/,
  /\bre\/out\b/,
  /\bspec\/data\b/,
  /original-game/,
  /research\/SPEC/,
];
const TEXT_EXT = /\.(html|js|mjs|css|json|txt|svg|md|map|xml|webmanifest)$/i;
const problems = [];
for (const f of files) {
  const rel = path.relative(dist, f);
  const dirs = rel.split(path.sep).slice(0, -1);
  if (dirs.some((d) => BAD_DIRS.has(d))) problems.push(`${rel}: in a local-only folder`);
  if (BAD_EXT.test(rel)) problems.push(`${rel}: a data file in the original's formats`);
  if (TEXT_EXT.test(rel)) {
    const text = readFileSync(f, 'utf8');
    for (const re of BAD_TEXT) {
      const m = text.match(re);
      if (m) problems.push(`${rel}: contains "${m[0]}"`);
    }
  }
}
if (problems.length) {
  console.error(`deploy: ABORTED: dist/ has material that must stay local:\n  ${problems.join('\n  ')}`);
  rmSync(dist, { recursive: true, force: true });
  process.exit(1);
}
console.log(`deploy: guard ok (${files.length} files scanned)`);

// ---- size report ----------------------------------------------------------------------------------------------------
const du = (d) => (existsSync(d) ? readdirSync(d, { withFileTypes: true }).reduce((a, e) => a + (e.isDirectory() ? du(path.join(d, e.name)) : statSync(path.join(d, e.name)).size), 0) : 0);
const mb = (b) => (b / 1e6).toFixed(1);
console.log(`deploy: dist ${mb(du(dist))} MB (code ${mb(du(path.join(dist, 'assets')))} MB, models ${mb(du(path.join(dist, 'models')))} MB, videos ${mb(du(path.join(dist, 'videos')))} MB, screenshots ${mb(du(shotDir))} MB)`);
if (du(dist) > MAX_MB * 1e6) throw new Error(`deploy: dist is over ${MAX_MB} MB`);

if (!push) {
  console.log('deploy: --no-push: dist/ is built; nothing was published');
  process.exit(0);
}
let remote = '';
try {
  remote = execSync('git remote get-url origin', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
} catch {
  /* no origin */
}
if (!remote) {
  console.log('deploy: no `origin` remote; dist/ is built but nothing was pushed. Add the GitHub remote and run again.');
  process.exit(0);
}
const sha = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
rmSync(path.join(dist, '.git'), { recursive: true, force: true });
run('git init -q -b gh-pages', dist);
run('git add -A', dist);
run(`git commit -q -m "Pages build from ${sha}"`, dist);
run(`git push -q -f ${remote} gh-pages`, dist);
rmSync(path.join(dist, '.git'), { recursive: true, force: true });
console.log(`deploy: pushed gh-pages to ${remote}`);
