# Feedback for Synty Sprite Generator

Every gap Car Smash Stunt Tracks hits in the generator's CLI or MCP. The orchestrator triages entries into the
generator's `TODO.md` ("Inbox: from Car Smash"). Number the entries in order and never reuse a number; the `CS-`
prefix keeps them apart from Off Road's OR-FB-NNN, Solitary Strike's FB-NNN and Sidefighter's SF-FB-NNN.

Status: `open` → `triaged (TODO: …)` → `fixed (<commit>)` → `verified` (the game's workaround was removed).

<!-- Template

## CS-FB-001 · <title>
- Severity: blocks | workaround | polish        Milestone: CS4
- Tried: `ssg model …` / MCP tool …
- Wanted: …
- Got: …
- Workaround: <file in this repo, tagged // CS-FB-NNN, or none>
- Suggested change: …
- Status: open
-->

## CS-FB-001 · No way to make track pieces (loops, banked corners, pipes, corkscrews, elevated roads)
- Severity: blocks        Milestone: CS4
- Tried: `search_assets` for loop/banked/pipe/corkscrew/half-pipe/road straight across all 23 model packs.
- Wanted: a `trackpiece` model kind in `ssg.models.json`. The generator sweeps a cross-section (road deck, kerb,
  rail or wall, optional pillars) along a parametric path: straight, arc (radius in tiles), slope, bank, loop,
  corkscrew, pipe, half-pipe, bridge deck, tunnel. It applies Synty atlas materials picked by name (e.g. Pro Racer
  road/kerb, City concrete) and exports a GLB snapped to a grid cell size, with end sockets (position + frame) in the
  manifest so pieces join without gaps.
- Got: only loose props: Pro Racer `SM_Env_Road_Ramp_01`, tunnels, gravel road bits; Palm City skate ramps and
  highway; Apocalypse motorway. They come at different scales (2.5 m, 5 m, 20 m) and none forms a stunt kit.
- Workaround: none yet (planned: `src/track/kit-fallback.ts`, tagged // CS-FB-001).
- Suggested change: new spec kind + exporter path (`packages/shared/src/model3d`, `apps/server/src/modelBuild.ts`),
  `preview_model` support, docs in `docs/MODELS.md`.
- Status: triaged (generator TODO "Inbox: from Car Smash", 2026-10-21)

## CS-FB-002 · Only a box collider; Synty collision meshes are skipped
- Severity: blocks        Milestone: CS4
- Tried: the manifest `collider` field (a box); Pro Racer ships `*_Collision` meshes for its ramps.
- Wanted: `collider: "box" | "convex" | "trimesh"` in the spec, and the pack's own collision mesh when there is one.
  Drivable ramps, loops and bridges need the real surface.
- Got: a single box.
- Workaround: none yet (planned: a trimesh built from the visual mesh in the game, tagged // CS-FB-002).
- Suggested change: export the collision mesh as a separate node or a second GLB; import `*_Collision` files.
- Status: fixed (wave-17 3746c34): trimesh (eabca61) and now `convex` plus `colliderExclude` (moving parts left out by default); the Synty `*_Collision` import is still open

## CS-FB-003 · No terrain tiles (hill slopes, corners, water and coast)
- Severity: workaround        Milestone: CS4
- Tried: `search_assets` category ground; tilesets are 2D only.
- Wanted: 3D terrain tiles on the track grid: flat, slope, outer/inner corner, plateau edge, water, coast, in a
  chosen Synty material, with optional scatter (grass tufts, rocks).
- Got: only large one-off ground chunks (Pro Racer RoadEdge, Arid Desert mounds).
- Workaround: none yet.
- Suggested change: a `terraintile` kind sharing the track-piece grid and materials.
- Status: verified (2026-10-21, wave-17 9e65f48): every bundled track draws its generator terrain grid (`terrain-<id>` in ssg.models.json, `shape: "track"`, `transition: 0`, biome swatches, water and coasts, instanced scatter, written from the track files by `scripts/build-terrain-specs.ts`; `tests/terrain-spec.test.ts` keeps them in sync); render/terrain.ts places it, 4 cm under the road decks. Left (game side, not a generator gap): a track without an export (the editor's live preview, custom / imported tracks) still gets the heightfield in track/build.ts (tagged // CS-FB-003), drawn in the apron's palette swatch; it could be assembled from single-tile exports later

## CS-FB-004 · No skydome or horizon panorama export
- Severity: polish        Milestone: CS5
- Wanted: a skydome or panorama per scenery set (desert, tropical, alpine, city, country), e.g. Arid Desert's
  skydome plus distant mountains baked into a cubemap.
- Got: individual background props only.
- Status: verified (2026-10-21, wave-17 9e65f48): `sky-<set>` skydomes (dome + silhouette ring) follow the camera in every scenery set, the panorama is the scene background and the fog takes the dome's horizon colour; the hand-made gradient sphere is only drawn in placeholder mode (no models built)

## CS-FB-005 · Cars have no dashboard or instrument cluster for an in-car view
- Severity: workaround        Milestone: CS5
- Tried: `model_info` on Pro Racer `SM_Veh_Rally_01` (seat, steering wheel, gearstick, roll cage; no dash).
- Wanted: a dashboard part (or a generic Pro Racer cockpit prop) with sockets for a speedometer and a rev counter.
- Status: verified (2026-10-22, polish lane) for cars that carry instruments (CS-FB-023): the Street Racer muscle car
  drives its own needles in the in-car view. Pro Racer / Palm City cars still have no dashboard part, so they keep the
  drawn dashboard (src/render/dashboard.ts, // CS-FB-005).

## CS-FB-006 · Restyle one body into several distinct cars
- Severity: polish        Milestone: CS5
- Wanted: confirm that `attach` + `variants` can swap Pro Racer bumpers, spoilers, skirts and wheel sets so one
  body becomes several cars with distinct looks.
- Status: triaged (generator TODO "Inbox: from Car Smash", 2026-10-21; to verify)

## CS-FB-007 · A pack installed twice under a different name is not detected
- Severity: polish        Milestone: CS0
- Tried: `list_packs` after the user added the new packs.
- Wanted: installing a second copy of an installed pack (same asset set, a zip named e.g. `…_SourceFiles_v3 (1)`)
  warns or merges, so search results aren't doubled.
- Got: `POLYGON_NatureBiomes_AridDesert_SourceFiles_v3 (1)` (id 32, 149 items) next to
  `POLYGON_NatureBiomes_AridDesert` (id 28, 149 items); every Arid Desert search can now return both.
- Workaround: none; ssg.models.json names `POLYGON_NatureBiomes_AridDesert/…` explicitly.
- Suggested change: at install, compare the asset-name set with installed packs; ≥ 90 % overlap → refuse or offer
  to replace. Normalise pack names (strip `_SourceFiles_vN`, ` (1)`).
- Status: triaged (generator TODO "Inbox: from Car Smash", 2026-10-21)

## CS-FB-008 · Vehicles whose body is a separate piece export as a bare chassis, with no hint
- Severity: workaround        Milestone: CS5
- Tried: `ssg model export POLYGON_Pro_Racer/SM_Veh_Stock_Car_01`, then `ssg model info` on it.
- Wanted: the export or `model info` to say that the body comes as companion pieces
  (`SM_Veh_Stock_Car_01_Body_01..03`), e.g. `suggestedAttach: [...]`, or a warning "no body mesh; attach one of …".
- Got: a roll cage, seat and engine on four wheels; nothing in `info` points at the body pieces.
- Workaround: `ssg.models.json` car-stock `attach: ["SM_Veh_Stock_Car_01_Body_01"]` (data, not code).
- Suggested change: in `info`/`search_assets`, list same-pack assets named `<asset>_Body_NN` / `_Attach_` as
  `companions`; warn at export when a vehicle has wheels but no body-sized mesh.
- Status: verified (2026-10-21, wave-17 3746c34): `ssg model info SM_Veh_Stock_Car_01` lists `companions` Body_01..03 and export warns without one; the `attach` in ssg.models.json is now normal configuration, not a workaround

## CS-FB-009 · The stock car's steering wheel gets role `wheel`
- Severity: polish        Milestone: CS5
- Tried: `ssg model info POLYGON_Pro_Racer/SM_Veh_Stock_Car_01 --json`.
- Wanted: `SM_Veh_Stock_Car_01_Steering_Wheel_01` gets role `steering` (as on other Pro Racer cars), so a game that
  spins every `wheel` part doesn't spin it like a road wheel.
- Got: `role: "wheel"`, radius 0.229, spinAxis [0,0,1]. The manifest `wheels` block is still correct (fl/fr/rl/rr).
- Workaround: none needed yet (the game drives wheels from the `wheels` block).
- Suggested change: match `Steering_Wheel` before the generic `Wheel` rule in the role naming.
- Status: verified (2026-10-21, wave-17 3746c34): the steering wheel is role `steering`; gear stick and e-brake are `lever`

## CS-FB-010 · `apply` fails entirely while one pack re-ingests, even for unchanged, cached exports
- Severity: workaround        Milestone: CS5
- Tried: `npm run assets` (`ssg model apply ssg.models.json`) while POLYGON_Pro_Racer was being re-ingested by
  another project.
- Wanted: unchanged models keep their cached export (the spec hash didn't change), and only models that need a new
  export from that pack wait or are reported; the rest of the file still applies.
- Got: `model car-touring: SM_Veh_Touring_01 is not ready (pending) (the folder was not changed)`; nothing applied.
- Workaround: wait for the ingest and run it again.
- Suggested change: in apply, use the cached export when the spec hash is cached; otherwise mark that model
  `skipped: pack ingesting` and continue (non-zero exit only with `--strict`).
- Status: fixed (wave-17 3746c34): apply serves the cached export (`stale`) or lists the model as `skipped` and continues; `--strict` fails. Not yet seen live (needs an ingest in progress)

## CS-FB-011 · Presets can't make an offset chicane, a forward-travelling helix or an in-line roll
- Severity: workaround        Milestone: CS4
- Tried: `chicane-left` with `length`/`shift`, `helix-right`, `corkscrew-left` with `side: 0`.
- Wanted: a chicane whose exit is offset by `shift` (a lane change over `length` cells); a helix that advances
  `travel` cells while it turns 360° and climbs (entry and exit in one column of a 2×2 block); a roll corkscrew with
  `side: 0` (in line over 1×2).
- Got: the chicane always ends in line, the helix returns over its entry, `side` must be ≥ 0.1.
- Workaround: custom `path` specs in `ssg.models.json` (tp-chicane-*, tp-corkscrew-*), data only.
- Suggested change: `chicane` `offset: true`, helix `travel`, allow `side: 0`.
- Status: verified (2026-10-21, wave-17 9e65f48): tp-chicane-a/-b are `chicane-left/-right` `{ length: 2, shift: 62.42, offset: true }`, tp-corkscrew-helix-left/-right are `helix-right/-left` `{ radius: 31.2, height: 27.43, travel: 2 }`; the custom paths are gone and track-check places all of them with 0 misplaced

## CS-FB-012 · No width transition (single road widening into a divided highway)
- Severity: workaround        Milestone: CS4
- Wanted: a preset that blends the profile from `width` to a wider (divided) profile over a cell, e.g.
  `{ preset: "widen", to: { width: 43.9, edge: "highway", median: 3 } }`.
- Got: profiles blend shape (road/pipe/half-pipe) but not width or a median.
- Workaround: `src/track/build.ts` draws the highway entry as a placeholder slab (// CS-FB-001 placeholder path).
- Status: verified (2026-10-21, wave-17 9e65f48): tp-highway-entry is `widen` to `{ width: 43.9, median: 14.63, medianHeight: 1.46, edge: highway }` and tp-highway the matching straight with that profile (the sim's median: 240 units wide, 24 high); the placeholder slab is gone, track-check reports no placeholder kinds

## CS-FB-013 · The shared API isn't restarted by "touch a server file"; the shared checkout can be left unbuildable
- Severity: polish        Milestone: CS4
- Tried: after merging the track kit into wave-17, `touch apps/server/src/models.ts` (GAME-LOOP step 3).
- Got: the API on 5181 runs `tsx src/main.ts` (no watch), so it kept serving the old code. A later commit on wave-17
  (915b1aa, another lane's merge) left conflict markers in `apps/cli/src/modelCommands.ts`, so every game's
  `ssg` CLI failed to start until fixed.
- Workaround: this game ran its own API (`SSG_PORT=5263`, `SSG_RESUME_INGEST=off`) and the CLI from its generator
  worktree (`SSG_BIN`, `SSG_URL`).
- Suggested change: run the API with `tsx watch` (or document a restart command); a pre-commit check for conflict
  markers in the generator repo.
- Status: fixed (wave-17 3746c34): `npm run check:markers` runs first in `npm test`; `npm run dev:api` (tsx watch) and a restart section in GAME-LOOP.md

## CS-FB-014 · No "span over a road" track piece (a deck with a ground road crossing under it)
- Severity: workaround        Milestone: CS4
- Wanted: a track-piece preset for an elevated span whose cell also carries a ground road at right angles beneath
  it (two paths through one cell at two levels), as the crossroads does for two ground roads.
- Got: only single-path decks; `tp-elevated` draws the deck and the road under it is missing.
- Workaround: `src/track/build.ts` also places `tp-straight` along the piece's second (ground) path.
- Status: open

## CS-FB-020 · `slope-up` stays eased with `transition: 0`; the deck dips under a straight hill slope
- Severity: workaround        Milestone: CS5
- Tried: `tp-straight-slope` `{ "preset": "slope-up", "height": 27.43, "transition": 0 }`; raycast the deck against the
  straight (linear) ground slope of a hill tile, which is also what the original's car follows (replay goldens: the
  car's height is linear over the tile, pitch a constant 23.9°).
- Wanted: `transition: 0` gives a constant grade end to end.
- Got: at 10 % / 25 % of the tile the deck is 0.62 m / 0.40 m under the linear slope, at 75 % / 95 % 0.37 m / 0.67 m
  above it, so the ground covers the lower half of the road.
- Workaround: `src/track/build.ts` sinks the terrain corners of sloped road tiles by 0.75 m (`SLOPE_DROP`,
  // CS-FB-020).
- Suggested change: honour `transition: 0` (no curved ends), or document the minimum.
- Status: verified (2026-10-21, wave-17 cs-w3-geometry): tp-straight-slope is `slope-up` `transition: 0` (one constant grade, as the simulation drives it) and the terrain grid uses `shape: "track"`, `transition: 0`, so the deck lies on the hill; SLOPE_DROP and the corner sinking in track/build.ts are gone

## CS-FB-021 · Textures: no apply, no size or format for `texture export`
- Severity: polish        Milestone: CS5
- Tried: `ssg texture export <path> --out public/textures --name ground-grass` for the ground of each scenery set.
- Wanted: a textures section in `ssg.models.json` (or `ssg texture apply`) that is incremental like `model apply`, with
  `size` and `format` (webp) per texture, as model exports have.
- Got: one 2048 px PNG per call (150–790 KB each); no manifest, no cache check.
- Workaround: `ssg.textures.json` + a loop in `scripts/build-assets.mjs` that skips files that exist.
- Status: verified (2026-10-21, wave-17 ddb3a3b): scripts/build-assets.mjs uses `ssg texture apply` (incremental, removes dropped textures, textures.json index, size 512); the keep-if-present export loop is gone

## CS-FB-022 · `ssg model preview` fails against a private API port
- Severity: polish        Milestone: CS5
- Tried: `ssg --server http://127.0.0.1:5263 model preview POLYGON_Pro_Racer/SM_Prop_Gantry_01 --out g.png`.
- Got: "the model preview page did not load from http://127.0.0.1:5263/model-preview.html (is the web app built?)":
  an API started from a worktree whose web app isn't built cannot preview.
- Workaround: none needed: the game's `?scene=props&set=<set>` shows every model of a scenery set.
- Suggested change: serve the preview page from the CLI package, or say which build to run in the error.
- Status: fixed (wave-17 ddb3a3b): the API bundles its own preview page from the web source, so previews work from an unbuilt checkout

## CS-FB-023 · Street Racer speedometer parts have no role or pivot (in-car dashboard)
- Severity: polish        Milestone: CS5
- Update to CS-FB-005: POLYGON_Street_Racer cars carry `…_Speedometer_0N` and `…_Speedometer_Needle_0N` parts (and
  `SK_Veh_Attach_Speedometer_01` + needle as attachments), but `model info` gives them `role: null` and no axis.
- Wanted: role `gauge` / `needle` with the needle's pivot and rotation axis (and the dial's angle range if known), so
  the in-car view can drive real needles.
- Workaround: `src/render/dashboard.ts` draws its own speedometer and rev counter (CS-FB-005).
- Status: verified (2026-10-22, polish lane): src/render/car-view.ts turns `car-sr-muscle`'s speedometer, rev counter
  and boost needles about the manifest axis from the sim (dial sweeps calibrated by eye: the dials print no figures,
  needles rest at 9 o'clock, scale 7:30 → 4:30); the in-car view keeps the whole cabin and shows a compact digital
  speed + gear from the same smoothed value (one consistent readout, QA-13).

## CS-FB-024 · No composite / prefab spec (props made of several models)
- Severity: polish        Milestone: CS5
- Wanted: one model from several assets of different files at offsets, e.g. a gas station = Town
  `SM_Prop_Gaspump_Cover_01` + two `SM_Prop_Gaspump_01`; City `SM_Bld_OfficeSquare_01` + `SM_Bld_OfficeSquare_Roof_01`.
  `attach` only takes pieces of the same file.
- Workaround: `src/render/scenery.ts` places the pumps under the canopy in code (scene assembly, no tag needed);
  roofless offices are only used in the distant band.
- Status: verified (2026-10-21, wave-17 cs-w3-geometry): `sc-gas-station` is a composite (Town canopy + two pumps at ±4.5 m, scaled as the old fits); the pump placement in render/scenery.ts and the sc-gas-pump model are gone. (The roofless office blocks are still only used in the distant band.)

## CS-FB-025 · `simplify` hardly reduces some trees; no LOD export
- Severity: polish        Milestone: CS5
- Tried: MeadowForest `SM_Env_Tree_Meadow_02` with `simplify: 0.35` and `0.1`: 16 k triangles either way;
  TropicalJungle `SM_Env_Tree_Forest_02` at 0.25: 19 k. Palm City `SM_Env_Tree_Palm_02` at 0.5 lost trunk segments
  (gaps in the trunk).
- Wanted: simplify that reaches its target on foliage (merging leaf cards), keeps thin trunks closed, and an `lods`
  option (several triangle budgets in one GLB) for props seen at many distances.
- Workaround: lighter assets for the background band (Pro Racer `SM_Env_Tree_03`, `bg-pine` at 0.2); no simplify on
  palms.
- Status: verified (2026-10-22, polish lane) for models whose levels come from the file's own LODs: sc-palm, sc-palm-b,
  sc-cactus, sc-cactus-b, sc-pine, sc-jungle-tree, bg-pine take `lods: [0.5, 0.15, 0.02]`, drawn by
  src/render/instancing.ts (LodInstances: copies dealt out between the levels by screen size each frame). Glacier Pass:
  0.91 M → 0.53 M triangles a frame (overview), 0.80 M → 0.46 M (from the forest edge), 0.5 % of pixels changed. Levels
  that have to be simplified come out broken: CS-FB-140.

## CS-FB-026 · Tinted variants on the open-wheeler recolour the whole car
- Severity: polish        Milestone: CS5
- Tried: `car-openwheeler` with `variants` (8 tints).
- Got: warning "no paint colour found in a texture; each variant's tint multiplies the model's own opaque materials":
  tyres and suspension take the tint too (dark red / dark green tyres).
- Wanted: paint found on this model, or a way to name the paint material/swatch in the spec.
- Status: verified (2026-10-22, polish lane): all six car-openwheeler paints checked side by side, tyres and suspension
  stay black (no game workaround existed).

## CS-FB-027 · Corkscrew roll about an axis above the deck needs a hand-solved helix
- Severity: workaround        Milestone: CS5
- Tried: `tp-corkscrew-roll` `{ "length": 124.84, "roll": 360 }` against the original's replay (DEFAULT 43–45 s): the
  car's floor turns once round an axis 7.16 m (the pipe radius) above the road, so the deck centre goes up the right
  wall, over the top 14.3 m up and down the left. A `roll` segment twists the deck about its own centre line (the
  car flew beside it, upside down, at the top).
- Wanted: a roll about an offset axis: `{ "roll": 360, "rollRadius": 7.16 }` (or a `barrel-roll` preset with
  `radius`), level in and out, entry and exit on the same line.
- Workaround: ssg.models.json `tp-corkscrew-roll` is a helix solved by hand (data only): a 20.7° turn to the right
  over 3 m, `pitch` 127.45° + `roll` 336.68° over 127.07 m (one helix turn round a forward axis, radius 7.16 m),
  the turn back with a 1.17 m `shift`; out socket within 0.07 m of (0, 0, 124.84).
- Status: verified (2026-10-21, wave-17 cs-w3-geometry): tp-corkscrew-roll is `{ "preset": "barrel-roll", "radius": 7.16, "length": 2 }` (out socket exactly at (0, 0, 124.84)); the hand-solved helix path is gone

## CS-FB-028 · Street Racer sports / exotic: a beige decal patch shows through the paint tint
- Severity: polish        Milestone: CS5
- Tried: `POLYGON_Street_Racer/SK_Veh_Preset_Sports_01` and `SK_Veh_Preset_Exotic_01` with `variants` (8 tints).
- Got: every variant keeps a large beige patch on the doors and flanks (a livery/decal island in the paint region
  that the tint leaves alone); the muscle car is clean.
- Wanted: decal islands on these bodies recoloured with the paint (as Palm City's lettering is), or a
  `decals: false` option that also works on Street Racer presets (drop or repaint decal islands).
- Workaround: the car line-up uses only `car-sr-muscle`; the other two were removed.
- Status: verified (2026-10-22, polish lane): car-sr-muscle has `decals: false`; its eight paints are clean and the
  in-car needles still work. (Sports / exotic are still out of the line-up: adding cars is a separate decision.)

## CS-FB-100 · Terrain scatter: no triangle count or budget; some small props cost 500+ triangles each
- Severity: polish        Milestone: CS5
- Tried: terrain `scatter` with POLYGON_Town `SM_Prop_Flowers_01`, Pro Racer `SM_Gen_Env_Shrub_02`, TropicalJungle
  `SM_Env_Fern_02` at 3–4 per tile on a 30×30 grid.
- Got: 1.85 M scatter triangles on one track (flowers 506 each, ferns 550, shrubs 238, Arid/Alpine `SM_Env_Rock_02` 596);
  the track scene took 25 s per SwiftShader frame and track-check timed out. `ssg model info` shows no triangle count,
  so the only way to find cheap props was a probe export (counting accessors in the GLB).
- Wanted: triangles in `model info` / `search_assets`; a scatter entry `simplify` (or a per-grid triangle budget that
  warns), and the scatter's triangle total in the terrain manifest.
- Workaround: hand-picked low-poly scatter (Gang Warfare small rocks 36, Meadow grass 10–18, Pro Racer shrub 64, Alpine
  flowers 52) at ≤ 3 per tile, src/track/terrain-spec.ts (data, no code).
- Status: open

## CS-FB-101 · Terrain grid has no margin / outer ground
- Severity: workaround        Milestone: CS5
- Tried: a track's 30×30 terrain grid; the background props stand 25 m–3.6 km outside it.
- Wanted: ground out to the horizon round a grid in the same biome, e.g. `margin: { cells: 60, cell: 124.84 }` (flat,
  coarse cells, edges matching the grid's, no scatter), or a `hole` option for a separate apron.
- Workaround: `apron-<set>` per scenery set: a second 125×125 planar grid of 2-tile cells whose middle 15×15 cells sink
  40 m so the track's grid covers them (src/track/terrain-spec.ts apronEntry, // CS-FB-101).
- Status: open

## CS-FB-130 · Stunt pieces can't take the simulation's shapes: polygon loop with a lane drift, linear helix climb, sheared bank
- Severity: workaround        Milestone: CS5 (QA-07)
- Tried: `{ "preset": "loop", "radius": 29.7, "align": "inline" }`, `helix-left/-right` (`radius` 31.2, `height`
  27.43, `travel` 2), `bank-transition` / `banked-curve-left` (`bank` 28.4), `slope-up` (`height` 27.43), measured
  against the simulation's surface with `scripts/piece-fit.ts` (rays along the car's path, gap in metres).
- Got: the loop is a circle; the original's loop is a 12-sided polygon 975 units high but only 449 deep (section
  points (z, y): (0,0) (224,135) (389,299) (449,524) (389,749) (225,914) (0,975), mirrored for the way down), whose
  400-wide lane drifts sideways by 0, 48, 48, 34, 35, 35 units per face on the way up and back down by the same:
  the drawn deck was up to 5.0 m outside the simulated one (the car floated inside the loop, QA-07). The helix
  eases its climb (2.8 m off the original's straight 19 units per 15° sector). Banked decks are turned about the
  low edge with the centre kept on the path, so the low edge moves in 0.9 m and the deck sits 0.5 m under the
  simulation's sheared road (240 units wide seen from above); `banked-curve` has level ends where the original's
  is banked throughout. Ramps (`slope-up`) ease their ends (2.8 m off the planar ramp).
- Workaround: `scripts/build-piece-specs.ts` (// CS-FB-130, run by `npm run assets`) writes these from
  `src/sim/track-geometry.ts` as data: the loop as a custom `path` (straight faces, 1.5 m pitch arcs at the
  corners, a `shift` per face for the drift, `profile.width` 24.38 m with `blend` on the approach and exit); each
  helix as one turn+roll helix segment per grade between short pitch arcs; bank entries as five `bank` segments
  with the width 14.63 / cos(bank); banked pieces with `width` 16.64 and `bankIn`/`bankOut`; ramps `transition: 0`.
  Max gaps now (m): loop 0.14, ramps 0.07, banked 0.06, banked corner 0.10, helix right 0.14 / left 0.42 (the
  original's own per-sector steps), bank entries 0.61 (see below). `src/track/build.ts` keeps a banked `in`
  socket's lift when placing a piece (the socket is the deck's middle, the model's origin is on the ground).
- Wanted: (1) a `loop` with a polygon `section` (list of (along, up) points) and a per-point `drift`, or a `path`
  segment `{ "to": [along, up] }` that goes straight to a point with a sharp corner (no hand-solved pitch arcs);
  (2) `helix` with `climb: "linear"` (a constant grade, kinks at the ends); (3) `bankPivot: "low-edge"` that keeps
  the low edge where it is across (or `bankMode: "shear"`: the road keeps its width seen from above, as a 1990s
  track's banking is a sheared plane), and banked ends by default on `banked-curve` when `bank` is given;
  (4) `blend: "linear"` for profile and bank changes (the original's pipe entry and bank entries are flat
  triangles: the pipe entry's eased blend is 0.89 m off its walls, the bank entries' smooth twist 0.6 m off the
  creased one — a `triangulate: true` per segment that splits each quad along a chosen diagonal would match them
  exactly); (5) a `pipe` profile with a polygon section (the original's pipe and roll are 12-sided: corners at
  x 31 / 84 / 115, y 0 / 35 / 88 / 151 / 204 / 235 units; the round tube is up to 0.25 m off its corners), and a way to
  give each face of a section its own stretch of the path (the original's roll opens its faces one by one, from the
  right wall at the entry round to the left at the exit; drawn as a whole tube meanwhile, 2026-10-22: the
  barrel-roll ribbon left a car's wheels up to 2.7 m off it on 70 % of the frames, because the simulation lets a car
  take any line round the tube).
- Also found (2026-10-22, all four wheels in the game, `scripts/smooth-check.mjs`): with the deck on the simulated
  planes, the drawn wheels still float up to 0.63 m or sink 0.56 m at the loop's 30° corners for a step or two (the
  20 Hz simulation turns the car as a rigid box: front wheels past a corner are under the next face while the rear
  ones are lifted off the last), and the car squats on its springs over the top. No deck shape is under both, so the
  game's drawn suspension now drops or lifts each wheel to the deck (`src/render/car-view.ts` placeWheels, travel
  0.7 m down / 0.6 m up); not a generator gap.
- Status: open

## CS-FB-140 · `lods`: every simplified level (and LOD0) is the last level's mesh
- Severity: workaround        Milestone: CS5
- Tried: `lods: [0.5, 0.15, 0.02]` on POLYGON_City `SM_Bld_OfficeOld_Large_01` / `_Small_01` / `_Large_02`,
  `SM_Bld_OfficeSquare_01`, `SM_Bld_OfficeRound_01`, Farm `SM_Env_Tree_Large_01`, Pro Racer `SM_Env_Tree_03`,
  `SM_Env_Tree_Group_01/03`, Farm `SM_Generic_Tree_Patch_02`, Arid `SM_Env_Tree_Dead_01`, Alpine
  `SM_Env_Background_Trees_01`, Street Racer `SM_Prop_Container_Stack_07` (`ssg model apply`).
- Got: the manifest lists LOD1–3 with falling triangle counts (`source: simplified`), but in the GLB all four
  meshes (LOD0's too) point at the same accessors, which hold the last level: `sc-office-c` has 4 meshes on one
  POSITION accessor of 25 788 vertices (8 596 triangles, LOD3) where LOD0 should be 17 856 triangles. The model's own
  look is lost (LOD0 is the simplified mesh). Levels taken from the file's own LODs (`source: synty`: pines, palms,
  cacti, jungle tree) are fine. Also: buildings hardly simplify (offices keep 50 % at every level; OfficeRound 94 %).
- Wanted: each level its own mesh; LOD0 untouched.
- Workaround: no `lods` on those models; a lighter twin exported with `simplify: 0.5` (`sc-office-lod1`,
  `sc-office-b-lod1`, `sc-office-c-lod1`, `sc-farm-tree-lod1`, `bg-tree-lod1` in ssg.models.json) is used as LOD1
  (src/render/instancing.ts InstanceBatch.build, src/render/world.ts loads them, // CS-FB-140). Downtown Rush:
  2.12 M → 1.40 M triangles a frame (overview), 2.10 M → 1.39 M (start), 0.06–0.5 % of pixels changed.
- Status: open
