# QA pass: jank, polish and feel

A full pass over every screen and a race on several tracks, cars and cameras (autopilot and scripted inputs), with
frame-exact stepping (the game's `Loop` stopped and driven one display frame at a time through `window.__cs.loop`
and `window.__cs.flow`, so the numbers are the same on SwiftShader as on a real GPU). Screenshots are in `docs/qa/`.

**The automated check:** `node scripts/smooth-check.mjs [url] [--quick]` drives races through four frame-time
patterns (steady 60 Hz, 144 Hz, 60 Hz with ±3 ms jitter, 60 Hz with a 150 ms hitch every 2 s) and measures per
rendered frame: car and camera speed jumps (stutter) and reversals, the car's movement and shake on screen in the
chase camera, camera turn per frame, each wheel's gap to the road (a ray from the wheel centre along the car's down
axis), and the body's suspension lean; then it walks the menus in real time and counts blank backdrop frames. It
fails on any limit (`LIMIT` at the top of the script); known open issues are listed in `KNOWN_WHEELS_OFF` and print
`WARN` until fixed. Report: `test-results/smooth-check.json`. A full run takes 8–17 minutes on SwiftShader (machine load)
(`--quick`: one race, 2 minutes).

| measured (Sunday Drive, rally car, chase cam, jittery 60 Hz) | before | after |
| --- | --- | --- |
| car stutter frames (speed jumps > 35 % between frames) | 19 / 240 (8 %) | 0 / 480 |
| worst frame-to-frame speed change | 100 % (car stood still for a frame) | 1.4 % |
| car shake on screen (px, 1280×720) | 6.4 | 0.2 |
| blank backdrop frames while walking the menus | 9 | 0 |
| body lean after a 150 ms frame (spring, rad) | diverges (1.3 at 100 ms, 10⁹ at 150 ms) | ≤ 0.13 |

All other runs after the fixes (144 Hz Lagoon Leap, hitch Lagoon Leap, in-car Palm Bay, Skyline Stunts): 0 stutter
frames, 0 reversals, camera turn ≤ 2.9°/frame, lean ≤ 0.13 rad; the only failures left are the loops (QA-07).

Owner lanes: **QA** (this lane, fixed here), **WORLD** (terrain, sky, `src/render/scenery.ts`, `cameras.ts`,
HUD/dashboard overlap), **OPP-RACE** (`src/sim/race.ts`, rivals), **TRACK-TUNE** (track designs, autopilot,
validators), **SHIP** (README, build, mobile touch overlay, loading screen), **ASSETS** (an `npm run assets` build,
for the orchestrator).

## P1: blocks or obvious jank

### QA-01 · Car and camera stutter: interpolation stuck to the 60 Hz loop · QA · fixed
- Repro: any race, chase cam, on a display that isn't exactly locked to 60 Hz (or a 120/144 Hz display). The race is
  20 Hz and drawn between two snapshots, but the flow's alpha only advanced in whole 1/60 s loop steps and ignored
  the loop's own fraction: when the browser's frame clock drifted against the loop, a frame got 0 steps (the car
  stood still) and the next got 2 (it jumped). On 144 Hz, 2 of every 3 frames repeated the same picture.
- Fix (`src/game/flow.ts` `frame()`): alpha = (race accumulator + loop fraction × 1/60) / (1/20); replays add the
  playback position the same way; alpha is held while paused (no jitter, no jump on pause). Evidence: table above.

### QA-02 · Car body stands on its nose after a long frame · QA · fixed
- Repro: a frame of ≥ 100 ms (tab switch, GC, a slow machine): the suspension spring in `CarView` was explicit Euler
  with the frame's dt and blew up: the title demo car stood on its nose, the results car lay on its side, the TV
  camera showed a car on its tail.
- Fix (`src/render/car-view.ts`): semi-implicit Euler in steps of ≤ 1/120 s, a frame counts for at most 0.1 s,
  lean clamped to ±0.14 rad. Screenshot after: `docs/qa/results-level-after.jpg`. The hitch run of
  `smooth-check` guards it (lean ≤ 0.25 rad).

### QA-03 · The game was silent · QA · fixed
- Repro: play anything. `src/audio` (engines, tyres, wind, impacts, countdown, songs) was complete but nothing in the
  game called it.
- Fix: `src/game/game-audio.ts` drives it through the audio event contract from the flow: menu music on the title
  and menus, silence while loading, countdown beeps and GO (race music starts on GO), each car's engine / tyres /
  wind per rendered frame (engine voice per car, rpm, throttle from the input byte, load, gear changes, squeal at
  hard lock, airborne), the rival panned and attenuated by its position to the camera, landings, crashes,
  checkpoints, the finish (fanfare for 1st), pause (car sounds fade, music stays), results music, replays (cars
  silent while the tape is paused), menu clicks (move / select / back). Options has MUSIC and SOUND EFFECTS volume
  (←/→ in tenths). M mutes, except while initials are being typed.
- Mix (measured in the page, RMS of the master output): race with music 0.13, engine alone 0.18, music alone 0.05
  (music sits ~10 dB under the engine), paused 0.06 (music only), menu music 0.03.

### QA-04 · Missing car model hung a race / threw on the title · fixed (SHIP + ASSETS)
- Repro (before): `public/models` without `car-sr-muscle`: the title demo threw `no model for car-sr-muscle` and
  picking that car or its rival left the loading screen up for ever.
- Fixed: all 114 models are now built (incl. `car-sr-muscle`, drivers `driver-b..f`), and SHIP's race view drives a
  missing car in another car's body. The flow keeps a last guard: a race or replay whose view fails to build says
  COULD NOT LOAD THE RACE and goes back to the menu / replays instead of hanging.

## P2: noticeable

### QA-05 · Blank backdrop between screens, and the demo rebuilt every time · QA · fixed
- Repro: car select → track select: the 3D backdrop went plain navy for a second or more while a new demo race
  built (a new random track each time, a hitch on the way back too).
- Fix (flow): the demo race stays alive (not stepped, not drawn) behind the car-select showroom, so the menus come
  back to it instantly; and whenever no backdrop is ready the last drawn frame stays up instead of a clear.
  `docs/qa/track-select-after.jpg`; smooth-check: 9 → 0 blank frames.

### QA-06 · Crash resets and replay seeks swing the camera across the map · QA · fixed
- Repro: a crash and reset, or a click on the VCR timeline: the car was drawn half way between the wreck and the
  reset point for a frame, the suspension kicked, and the chase camera flew (exponential lag) through the scenery
  to catch up.
- Fix (`src/render/race-view.ts`): a move of more than 15 m between two 20 Hz steps is a teleport: no
  interpolation across it, the suspension and the camera rig start over there. Measured: camera-to-car distance
  14.6 m before a seek, 13.5 m on the first frame after it.

### QA-07 · Loops: the car floats up to 3.6 m off the rendered deck · TRACK-TUNE / WORLD
- Repro: `node scripts/smooth-check.mjs` (WARN lines) or Lagoon Leap / Skyline Stunts, any car, side view of the
  loop entry: the simulation pitches the car up before the rendered `tp-loop` deck rises, and through the lower
  half of the loop the wheels are 2–3.6 m above the mesh (inside the loop). Every wheels-off frame in all runs was
  on a `loop` section; flat, banked, ramps, the pipe and the in-car run on Palm Bay stay within 0.03–0.18 m.
  `docs/qa/loop-float.jpg`.
- Fixed (2026-10-22, LOOP-FIT): the simulation's loop is a 12-sided polygon (59.4 m high, 27.4 m deep each side) with
  a 24.4 m lane drifting sideways, not a 29.7 m circle; scripts/build-piece-specs.ts now computes tp-loop (and the
  helixes, bank entries, banked pieces and ramps) from src/sim/track-geometry.ts. Loop gap 4.95 m → 0.14 m
  (`npx vite-node scripts/piece-fit.ts`); `loop` is no longer a known issue in smooth-check.
- Wanted: the loop model's profile (ssg.models.json `tp-loop`) matched to the simulation's loop surface
  (`src/sim/track-surface.ts`), or the reverse; then delete `'loop'` from `KNOWN_WHEELS_OFF`.

### QA-08 · Rival starts inside the chase camera · OPP-RACE
- Repro: race vs DIAL on the test oval / Palm Bay (flow-check's versus race): at the start the rival sits right
  behind-right of the player, so the chase camera is inside the rival's body (`docs/qa/versus-grid-clip.jpg`).
- Wanted: grid the rival beside or ahead, or keep the chase camera out of other cars.

### QA-09 · The ground was black when the ground textures were missing · QA · fixed
- Repro (before): a checkout without `public/textures/`: terrain drawn with `groundMaterial` rendered black (the
  texture 404s and the material kept an empty map) (`docs/qa/ground-black.jpg`).
- Fix (`src/render/scenery.ts`): the ground starts as the texture's average colour × the set's tint and takes the
  texture only once it has loaded; a missing file logs one warning and the ground stays plain (also no black flash
  while the texture loads). Tracks with generator terrain (WORLD) carry their own palette.

### QA-10 · VCR deck covered the car on narrower screens · QA · fixed
- Repro: replay at ≤ 1080 px wide: the deck was raised 150 px into the middle of the picture and over the
  speedometer (`docs/qa/vcr-before.jpg`).
- Fix (`src/ui/screens/vcr.ts`, `race-hud.ts`): the deck spans the bottom edge, the speedometer moves above it, the
  REPLAY tag drops below the top panels; on phones the deck wraps to two rows (`docs/qa/vcr-after.jpg`).

### QA-11 · HUD boxes overlapped on narrow windows · QA · fixed
- Repro: a race at 400 px wide: TIME and CHECKPOINT on top of each other, the camera hint over the speedometer
  (`docs/qa/hud-phone-before.jpg`). Fix: a ≤ 600 px layout (`docs/qa/hud-phone-after.jpg`). On phones held upright
  SHIP's turn-your-phone card covers the race anyway.

### QA-12 · Results screen on small screens · SHIP · fixed
- Phones in portrait get SHIP's turn-your-phone card; landscape phones use SHIP's ≤ 460 px-high results layout and
  tap letter picker. (This lane's own portrait column was dropped in the merge in favour of SHIP's.)

### QA-13 · In-car: two speed readouts that disagreed · WORLD · fixed upstream
- Repro (before): in-car the HUD said 80 MPH while the dashboard said 57 (`docs/qa/cockpit-two-speeds.jpg`). WORLD's
  merge made the cockpit dashboard replace the HUD speed. Still worth a look: `Dashboard.update` smoothing is a
  fixed fraction per frame (frame-rate dependent).

## P3: polish

### QA-14 · WRONG WAY never blinked; HUD rewrote the DOM every frame · QA · fixed
- The HUD replaced the WRONG WAY element every frame, restarting its blink animation, so it never blinked; every
  text and class was rewritten 60 times a second. Now only changes are written (`src/ui/race-hud.ts`).

### QA-15 · Track list hid two tracks without saying so · QA · fixed
- 11 tracks, a 9-row window: ▲ MORE / ▼ MORE hints now show when the list scrolls.

### QA-16 · SAVE REPLAY twice saved two copies · QA · fixed
- A second press says REPLAY ALREADY SAVED (also after watching the replay and coming back).

### QA-17 · Long replays could fail to save · QA · fixed
- `toB64` spread the whole input stream into one `String.fromCharCode` call (argument limit on long races); now
  in chunks. (A full localStorage still fails silently with a REPLAY SAVED toast: P3, open.)

### QA-18 · Console warning on every page · QA · fixed
- `THREE.WebGLShadowMap: PCFSoftShadowMap has been removed`: the renderer now asks for `PCFShadowMap` (what it got
  anyway).

### QA-19 · Title could draw in a fallback font first · QA · fixed
- The flow waits (≤ 2.5 s) for the pixel font before the first screen, so the logo and menus don't reflow.

### QA-20 · Portrait phones · SHIP · fixed
- SHIP's turn-your-phone card (and race pause) covers portrait on touch devices; the menus are landscape layouts
  (`docs/qa/portrait-menus.jpg` shows them in a narrow desktop window).

### QA-21 · Shadow box snapped in world axes, not light space · WORLD
- `applyAtmosphere().update` snaps the shadow target to texels along world x/y/z; the sun's shadow camera is
  rotated, so its texel grid isn't aligned with those steps and shadow edges can still crawl while driving. Snap in
  the light's view space.

### QA-22 · Taps shorter than one race step were lost · QA · fixed
- Repro (before): the race read held keys once per 20 Hz step, so a key pressed and released within 50 ms between
  two steps never reached the car.
- Fix (`src/engine/input.ts`): keys pressed since the last driving read count as held for that read (`tapped`,
  cleared on every read, screen change and window blur). Checked: a ←-tap between two steps gives exactly one step
  with LEFT (input bytes 0, 0, 8, then 0).

### Checked, no issue found
Pause / resume (the clock and the countdown stop, the car holds its exact pose, ESC toggles), restart from pause,
quit from pause, results for a win / loss / DNF, initials entry (keys typed during the race don't leak into it: the
menu queue is cleared on every screen change), high-score places and the 7-row table, replay play / pause / rewind
(4×, 8×, 16×) / fast-forward / start / end / seek, exit from the replay back to the results, camera cycling (chase,
in-car, TV, orbit), window resizes during a race and in the menus, wheels on flat, banked, ramps, pipe and
elevated sections (0.03–0.18 m), no z-fighting or prop pop-in seen in the stills, audio voices fade (no clicks) on
pause, crash, scene changes and leaving a race.
