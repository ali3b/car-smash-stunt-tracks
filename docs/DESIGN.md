# Design notes

How Car Smash Stunt Tracks is put together: the code layout, the track format, the race rules, the car tunings,
how it is tested, how its models are made, and how it is built and published.

## Architecture

One Vite + TypeScript page (`index.html` → `src/main.ts`). `main.ts` picks a scene from `?scene=` (the game by
default; `race`, `editor`, `audio`, `track`, `garage`, `props` and dev-only scenes), shows the boot screen
(`src/boot.ts`: model download progress, a readable message when WebGL 2 is missing or the boot fails) and loads the
editor and the sound bench as separate chunks only when they are opened. `window.__cs` is the handle the browser
checks drive.

| Folder | What lives there |
| --- | --- |
| `src/engine/` | The renderer and scene (`renderer.ts`), the fixed-step main loop (`loop.ts`: 60 Hz steps, render per frame), input (`input.ts`: keyboard, gamepads, the touch controls' input, menu events), the DOS-look post-process (`retro.ts`) and the render quality setting (`quality.ts`). |
| `src/sim/` | The car simulation: integer maths at 20 Hz (`step.ts`, `car.ts`, `engine.ts`, `motion.ts`, `grip.ts`), the track as the simulation sees it (`track-surface.ts`, `track-planes.ts`, `track-walls.ts`, `probe.ts`), the circuit and race rules (`track-path.ts`, `race.ts`), the built-in path follower (`autopilot.ts`), the rivals' driver (`opponent.ts`, `opponent-route.ts`, `opponents.ts`) and the eight car tunings (`tunings.ts`). No DOM, no three.js: it runs the same in vitest and in the page. |
| `src/track/` | The track format (`types.ts`), the piece catalogue (`pieces.ts`: footprints, road ends, levels), the validator (`validate.ts`), the authoring DSL our tracks are written in (`author.ts`, designs in `designs/`, built to `tracks/*.json` by `npm run tracks`) and the 3D build of a track (`build.ts`: terrain heightfield, water, pieces placed by their model sockets). |
| `src/render/` | The track world (`world.ts`: pieces, scenery set, props, track-side dressing, background ring, sky and fog), instancing, the car view (`car-view.ts`: wheels, suspension, paint variants), cameras (`cameras.ts`: chase, in-car with `dashboard.ts`, TV, orbit) and the race view the game flow draws (`race-view.ts`). |
| `src/game/` | The game flow (`flow.ts`: title and attract demo, menus, race, results, replays, options), the race session on the simulation (`sim-session.ts`), the car and rival catalogue, local storage (options, high scores, replays), and the seams other modules plug into (`integrations.ts`, with stubs for headless tests). |
| `src/ui/` | Every menu screen (`screens/`), the race HUD, toasts, track thumbnails and the on-screen touch controls (`touch-controls.ts`). DOM over the canvas, one pixel font. |
| `src/editor/` | The track editor: a document with undo (`doc.ts`), the 2D grid (`gridview.ts`, mouse and touch), the palette, the live 3D preview, the editor's terrain and circuit rules (`validate.ts`) and storage (save, export / import, the Test drive hand-over). |
| `src/audio/` | Synthesised sound: FM voices, engines, tyres and effects (`fm.ts`, `engine.ts`, `sfx.ts`), a small tracker-style sequencer and our songs (`sequencer.ts`, `songs/`), the event contract (`events.ts`) and the sound bench (`bench.ts`). |

**One race, frame by frame.** The `Loop` steps at 60 Hz; the flow accumulates real time and steps the
`RaceSession` at 20 Hz with one input byte per step (accelerate, brake, left, right, shift up, shift down: the same
byte from the keyboard, a pad, the touch controls or the autopilot). Each step returns a `RaceSnapshot`; the
`RaceView` draws between the last two snapshots (interpolated) and the HUD reads the newer one. A replay is the input
bytes plus the setup, played back through the same session.

**Input.** `readInput()` takes the first active gamepad, then the touch controls when they are showing and
touched, then the keyboard. Menus get edge-triggered events from keys, every pad (polled each frame) and taps on
`[data-act]` / `[data-menu]` elements, so every screen works with any of them.

**Phones and tablets.** On a touch device the race shows GAS / BRAKE pedals, steering buttons or tilt steering
(DeviceOrientation, calibrated; a partial tilt steers on that fraction of the 20 Hz steps, since the input byte is
digital), shift buttons with a manual gearbox, camera and pause. Fingers are tracked one by one, so pedals and
steering work together and a thumb can roll from one pedal to the other. Portrait shows a "turn your phone" card and
pauses a race. Quality `auto` picks low on phones: pixel ratio 1, no antialiasing or shadows, a third of the
background props.

## Track format

A track (`src/track/types.ts`, JSON in `src/track/tracks/`) is:

```ts
interface TrackFile {
  version: 1;
  name: string;
  scenery: 'desert' | 'tropical' | 'alpine' | 'city' | 'country';
  pieces: { x: number; z: number; kind: PieceKind; rot: 0 | 1 | 2 | 3; surface?: 'paved' | 'dirt' | 'ice'; variant?: string }[];
  heights: number[][]; // 31 × 31 corner heights: 0 ground, 1 hill top
  water: (boolean | 'NE' | 'SE' | 'SW' | 'NW')[][]; // per tile; a corner = a coast tile
}
```

- The grid is 30 × 30 tiles, x east, z north, tile (0, 0) in the south-west. A tile is 1024 track units (62.4 m);
  a track unit is 0.06096 m, so the simulation's speeds read directly in mph. Hill tops and elevated decks are 450
  units (27.4 m) up.
- A piece sits on its south-west anchor tile and covers its rotated footprint; `rot` is quarter turns clockwise.
  The catalogue (`pieces.ts`) gives each kind its footprint and road ends (tile, side, level: ground, elevated, bank,
  pipe, highway). The validator follows the road from the start-finish piece through matching ends; an elevated end
  facing empty tiles is a jump that must land on an elevated end further along the same line.
- Kinds: start-finish, straight, small and large corners, elevated roads, spans and corners, ramps, bank entries,
  banked roads and corners, chicane, loop, tunnel, pipe, pipe entry and obstacle, crossroads, small and large
  splits, corkscrew roll, corkscrew helix (up or down), highway and its entry, slalom, and scenery props (trees,
  buildings, a gas station…).
- Our tracks are written as code with `author.ts` (a "turtle" that lays pieces like driving directions) and built
  and validated by `npm run tracks`. The editor reads and writes the same JSON.


## Race rules

Our own rules, on top of the car simulation. Code: `src/sim/race.ts` (numbers in `RULES`), the circuit in
`src/sim/track-path.ts`, the game-side session in `src/game/sim-session.ts`. Everything runs in the 20 Hz
simulation step, so a race is fully determined by the track, the cars and the player's input bytes (replays are
just those bytes).

**The circuit.** Traced from the start-finish piece through the pieces' road ends with the track validator's own
rules (`src/track/validate.ts`: `linkOf`, `pathThrough`): forks take their main path, a ramp facing empty tiles
flies to the landing ramp. Each traversal of a piece is a *section* (a crossroads driven twice is two sections),
with a centre line used for progress, resets and the built-in driver.

**Start.** In a time trial the player starts on the centre line of the start-finish piece, 220 units (13 m) behind
the finish line, which crosses the middle of that piece. Against a rival both cars take the two-car grid
(`gridStarts` in `src/sim/opponent-route.ts`): 210 units behind the line, 36 units either side of the centre line.
The 3-2-1 countdown is the game flow's (the race is not stepped while it runs); the race clock starts with the first
step.

**The rival.** A computer driver (`OpponentDriver`, `src/sim/opponent.ts`; a `RouteDriver` with the rival's profile
from `src/sim/opponents.ts` in the rival's car from the catalogue) follows a route cut from the same circuit
(`buildRoute`). Every step runs in a fixed order: the player's car (colliding with the rival), the player's
bookkeeping, then the rival's step (colliding with the player), then its bookkeeping. The rival finishes when its
route has done a lap and it crosses the finish line. It crashes, pays penalties and is put back like the player;
put back, it carries on from the nearest waypoint in front of it. The rival is deterministic, so a replay (the
player's input bytes) gives the same rival.

**Progress and checkpoints.** A car's section is found from the tile it is on: of the sections covering that tile,
the nearest one at or ahead of its progress (up to 8 ahead; stacked roads only count at the car's level). Progress
only moves forwards. The lap is cut into checkpoints (one per ~6 sections, 2..10); passing one flashes CHECKPOINT.

**Finish.** Crossing the finish line in the driving direction after every checkpoint. The car then coasts to a
stop. Against a rival the race ends when both have finished, or 30 s after the player finished. A race gives up
after 10 minutes (not finished).

**Missed sections.** A car that leaves the road (no wheel on the road: all on terrain or water) and
rejoins the circuit further on pays 2 s per section skipped. Driving another road (a fork's other branch) is not
leaving the road, so alternative routes are free. Jumps are not skips (the gap is no section).

**Wrong way.** Moving faster than 8 mph against the course (heading more than ~116 degrees off the centre line)
for 1 s shows WRONG WAY; every further 4 s of it costs 5 s. Not checked inside loops, rolls, the helix or pipes,
where the heading means nothing.

**Crashes.** A crash (hitting a wall too hard, landing too hard, all four wheels in water, the roof through the
road) costs 3 s. After 2 s the car is put back, standing, facing along the course, at the last place it was on the
road with all four wheels, upright, on a plain piece (not in a stunt or on a ramp). Two crashes in a row on the same
piece put the car back on the next plain piece after it instead (an impossible jump or obstacle does not trap a
car), and each further time from that piece one plain piece further on. A car that gets no further than 100 units
in 6 s (standing still, as there is no reverse gear, or wheels spinning against a wall, a block or the other car) is
put back the same way, without a penalty; stuck twice on the same piece with its wheels turning, it goes past it.
Places to be put back are only taken within 150 units of the centre line, and a car put back next to the other car
(within 160 units) stands 70 units to the side away from it.

**Counters.** Jumps: all four wheels off the ground for 0.5 s (flashes JUMP!). Top speed and distance (horizontal,
until the finish) for the results.

**Rival difficulty.** Our six rivals' profiles (`src/sim/opponents.ts`: target speeds per kind of piece, drive
force, steering, braking) are tuned on the bundled tracks against the built-in driver's best laps in the fastest
cars: Nova about 4% quicker (tough, beatable), Gus about level, Marco +8%, Lena +10%, Hank +15% and Pip +27%.
`tests/opponent-race.test.ts` prints the lap table and checks every rival finishes every bundled track.

## Car tunings

Eight cars (`src/sim/tunings.ts`), each built by `tune()` from plain numbers: gear speeds at the rev limit (first
and top, geometric in between), a torque hump, weight, drag, brakes, tyre grip and a grip factor per surface
(paved, dirt, ice, terrain). `tests/sim-tunings.test.ts` measures each on flat ground (0-60, top speed, 60-0,
turning) and checks they stay in sensible ranges and differ.

| car | character |
| --- | --- |
| car-rally | short quick gears, grippy on dirt, decent on ice |
| car-touring | balanced, a bit heavy |
| car-openwheeler | fastest, light, very grippy on tarmac, poor off it |
| car-stock | heavy, big torque, tall gears, high top speed |
| car-vintage | slow, soft, forgiving |
| car-super | fast and powerful, wide tarmac tyres |
| car-buggy | light, great on dirt and ice, low top speed |
| car-sr-muscle | huge torque off the line (wheelspin), so-so brakes |

## Tests

- **vitest** (`npm test`, `tests/`): the simulation's basics and stages, the race rules on our tracks (the path
  follower finishes them; a replay of the same inputs gives the same race), car tunings measured on flat ground,
  surfaces, the piece catalogue, the validators, the editor document and the flow on stubs. The fidelity tests that
  replay recorded reference runs through `src/sim` frame by frame need reference data kept only on the developer's
  machine (never in the repository or the build); without it they skip, so a fresh clone passes.
- **Playwright** (`scripts/*-check.mjs`, headless Chromium on SwiftShader, so they never use the desktop's GPU):
  `load-check` (a scene boots without errors), `flow-check` (title → menus → race → results → scores, a race
  against a rival, its replay, options), `drive-check` (two whole races on the real simulation: the loop, a jump, a
  crash and the recovery), `track-check --bundled` (every track's pieces land on their sockets), `editor-check`
  (build a circuit with the mouse, terrain, undo, import, Test drive), `audio-check` (every song and sound is
  audible and doesn't clip), `ship-check` (boot screen, a gamepad through every screen, the DOS look and options
  surviving a reload, resize, Test drive, the no-WebGL message) and `mobile-check` (a phone in landscape by touch
  alone: menus, a race driven on the overlay to a checkpoint, pause, tilt, the letter picker, the VCR, portrait, the
  editor's tap and pinch). Each saves screenshots in `test-results/`; looking at them is part of the check.
- `node scripts/check-all.mjs <dev url>` runs typecheck, vitest and every browser check in turn and prints a
  pass / fail summary (logs in `test-results/check-all/`).

## Asset pipeline

Every model is declared in `ssg.models.json` (and terrain textures in `ssg.textures.json`): a Synty asset with its
scale, origin, paint variants, simplification and colliders, or a procedural track piece (a cross-section swept
along straights, arcs, slopes, banks, loops, helices and rolls, with `in` / `out` sockets). `npm run assets`
(`scripts/build-assets.mjs`) runs the Synty Sprite Generator's CLI, `ssg model apply`, which exports a
meshopt-compressed GLB and a manifest per model into `public/models/` with an index (`models.json`). The game only
ever uses the generator through its CLI and MCP tools; anything it cannot get that way is written up in
`FEEDBACK.md` and the workaround in the game is tagged with the entry's number until the generator is fixed.

`public/models/` is never committed (Synty EULA). Without it the game runs on placeholder shapes. A race loads only
the models its track uses (its pieces, its scenery set, the track-side dressing and the cars), with a progress bar.

## Build and publishing

`npm run build` type-checks and builds `dist/` with a relative base (it runs from any sub-path). three.js is its
own chunk; the editor, the sound bench and the dev-only scenes are separate chunks or are left out of the
production build entirely.

`node scripts/deploy-pages.mjs --no-push` builds `dist/`, adds `.nojekyll`, the videos (trailer, short, GIF,
making-of) when they exist, and `gallery.html` (videos and screenshots). Before anything can be published a guard
scans every file in `dist/` and aborts the build if it finds a local-only folder, a data file in a foreign game
format, or a name that must never appear in public. Without `--no-push` it then force-pushes `dist/` to the
`gh-pages` branch of `origin`.
