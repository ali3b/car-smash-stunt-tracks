// Dev-only scene: ?scene=replay&golden=<NAME> plays the original's own driving (the per-frame car state the
// emulator dumped into re/out/golden/<NAME>.json, re/tools/README-emu.md) on the replay's own track
// (local-tracks/rpl-<name>.json, written by scripts/import-trk.mjs), interpolated from the 20 Hz simulation to the
// display rate. It checks the renderer (track placement, car size, cameras) against real driving. Both inputs are
// git-ignored and fetched from the dev server only; a production build refuses the scene.
//
// Keys: C next camera (chase → in-car → TV), Space pause, R restart, ← / → seek 5 s, 1-3 pick a camera.
// Golden units: pos in 1/65536 tile (= 1/64 track unit), rot (yaw, pitch, roll) with 0x400 a full turn; yaw is
// counter-clockwise seen from above (heading east = 768), pitch nose-up positive; speed2 = 256 × mph.
import * as THREE from 'three';
import type { Stage } from '../engine/renderer';
import { CarView } from '../render/car-view';
import { CAMERA_MODES, CameraRig, tvCameras, type CameraMode } from '../render/cameras';
import { buildWorld, loadModels, perfInfo } from '../render/world';
import { updateLods } from '../render/instancing';
import { TILE_M, UNIT_M, type TrackFile } from '../track/types';

interface GoldenCar {
  pos: [number, number, number];
  rot: [number, number, number];
  speed2: number;
  steering: number;
  rpm: number;
  crash_flag: number;
}
interface GoldenFrame {
  i: number;
  player: GoldenCar;
  opponent?: GoldenCar;
}
interface Golden {
  replay: string;
  rpl_header: string;
  player_car: string;
  opponent_car: string;
  opponent_type: number;
  track_name: string;
  frames: GoldenFrame[];
}

/** The original's car ids → our generator cars (closest body style). */
const CAR_MODEL: Record<string, string> = {
  FGTO: 'car-super', ANSX: 'car-super', COUN: 'car-super', VETT: 'car-stock', AUDI: 'car-rally', LANC: 'car-rally',
  PMIN: 'car-openwheeler', PC04: 'car-super', P962: 'car-super', JAGU: 'car-super', LM02: 'car-touring',
};
const PAINTS = ['red', 'blue', 'yellow', 'green', 'white', 'black', 'orange', 'purple'];
const HZ = 20;
const TURN = (Math.PI * 2) / 1024;
const MPH = 0.44704;

function decode(c: GoldenCar, out: { p: THREE.Vector3; q: THREE.Quaternion }) {
  out.p.set((c.pos[0] / 65536) * TILE_M, (c.pos[1] / 64) * UNIT_M, -(c.pos[2] / 65536) * TILE_M);
  // Model +Z forward: yaw about Y (π + yaw: yaw 0 faces north = −z), then pitch about the car's X (nose up = −x
  // rotation for a +Z-forward model), then roll about its forward axis.
  const e = new THREE.Euler(-c.rot[1] * TURN, Math.PI + c.rot[0] * TURN, c.rot[2] * TURN, 'YXZ');
  out.q.setFromEuler(e);
}

export async function replayScene(stage: Stage, params: URLSearchParams) {
  if (!import.meta.env.DEV) throw new Error('the replay scene reads local reference data and runs on the dev server only');
  const name = params.get('golden') ?? 'DEFAULT';
  const gr = await fetch(`/re/out/golden/${encodeURIComponent(name)}.json`);
  if (!gr.ok) throw new Error(`no golden "${name}" (run re/tools/emu.py)`);
  const golden = (await gr.json()) as Golden;
  const tr = await fetch(`${import.meta.env.BASE_URL}local-tracks/${encodeURIComponent(`rpl-${name.toLowerCase()}`)}.json`);
  if (!tr.ok) throw new Error(`no local track rpl-${name.toLowerCase()} (run node scripts/import-trk.mjs)`);
  const track = (await tr.json()) as TrackFile;
  const world = await buildWorld(stage.scene, stage.sun, track);
  const header = golden.rpl_header.match(/../g)!.map((h) => parseInt(h, 16));
  const carModels = await loadModels([CAR_MODEL[golden.player_car] ?? 'car-rally', CAR_MODEL[golden.opponent_car] ?? 'car-rally']);
  const mk = async (id: string, paint: number) => {
    const m = carModels.get(CAR_MODEL[id] ?? 'car-rally') ?? [...carModels.values()][0];
    if (!m) throw new Error('no car models (npm run assets)');
    return CarView.create(m, PAINTS[paint % PAINTS.length]);
  };
  const player = await mk(golden.player_car, header[4]);
  stage.scene.add(player.object);
  const hasOpp = golden.opponent_type > 0 && golden.frames.some((f) => f.opponent);
  const opponent = hasOpp ? await mk(golden.opponent_car, header[11] ?? 1) : null;
  if (opponent) stage.scene.add(opponent.object);

  const rig = new CameraRig(tvCameras(track), document.body);
  rig.setWalls(world.root);
  const hud = document.createElement('div');
  Object.assign(hud.style, { position: 'fixed', left: '12px', top: '10px', color: '#fff', font: '13px ui-monospace, Menlo, monospace', textShadow: '0 1px 2px #000', pointerEvents: 'none' });
  document.body.appendChild(hud);

  const frames = golden.frames;
  // The rev counter's scale: the highest rpm this car reaches in the replay, rounded up to 1000.
  const maxRpm = Math.max(7000, Math.ceil(Math.max(...frames.map((f) => f.player.rpm)) / 1000) * 1000);
  const duration = frames.length / HZ;
  let t = Number(params.get('t') ?? 0);
  let paused = params.has('paused');
  const a = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  const b = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  const pose = (car: CarView, get: (f: GoldenFrame) => GoldenCar | undefined, dt: number) => {
    const f = Math.min(t * HZ, frames.length - 1);
    const k = Math.floor(f);
    const k1 = Math.min(k + 1, frames.length - 1);
    const fa = get(frames[k]);
    const fb = get(frames[k1]);
    if (!fa || !fb) return null;
    decode(fa, a);
    decode(fb, b);
    const u = f - k;
    const s = fa.speed2 + (fb.speed2 - fa.speed2) * u;
    const state = {
      position: a.p.clone().lerp(b.p, u),
      quaternion: a.q.clone().slerp(b.q, u),
      speed: (s / 256) * MPH,
      // steering: positive = right in the original; ours is positive left. ±~180 ≈ full lock (~32°).
      steer: (-(fa.steering + (fb.steering - fa.steering) * u) / 180) * 0.55,
      rpm: fa.rpm + (fb.rpm - fa.rpm) * u,
    };
    car.update(state, dt);
    return state;
  };
  const setMode = (m: CameraMode) => rig.setMode(m, player);
  rig.setMode((params.get('cam') as CameraMode) ?? 'chase', player);
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyC') rig.next(player);
    else if (e.code === 'Space') paused = !paused;
    else if (e.code === 'KeyR') t = 0;
    else if (e.code === 'ArrowRight') t = Math.min(duration, t + 5);
    else if (e.code === 'ArrowLeft') t = Math.max(0, t - 5);
    else if (/^Digit[1-3]$/.test(e.code)) setMode(CAMERA_MODES[Number(e.code.slice(5)) - 1]);
    else return;
    e.preventDefault();
  });

  let lastState: ReturnType<typeof pose> = null;
  const step = (dt: number) => {
    if (!paused) t += dt;
    if (t >= duration) t = 0;
    lastState = pose(player, (f) => f.player, paused ? 0 : dt);
    if (opponent) pose(opponent, (f) => f.opponent, paused ? 0 : dt);
  };
  const render = (_alpha: number, frameDt: number) => {
    if (!lastState) step(0);
    const st = lastState!;
    rig.update(player, frameDt, { speedMph: st.speed / MPH, rpm: st.rpm ?? 0, maxRpm }, opponent ? [opponent] : []);
    world.atmosphere.update(rig.camera, player.object.position, rig.mode === 'tv' ? 60 : 45);
    updateLods(world.root, rig.camera);
    stage.renderer.render(stage.scene, rig.camera);
    hud.textContent = `${golden.replay} · ${track.name} · ${golden.player_car} · ${(t).toFixed(2)} / ${duration.toFixed(2)} s · frame ${Math.floor(t * HZ)} · ${rig.describe()} · C camera, Space pause, ←/→ seek`;
  };
  window.__cs.replay = {
    name: golden.replay,
    frames: frames.length,
    duration,
    track: track.name,
    car: CAR_MODEL[golden.player_car],
    issues: world.issues.length,
    /** Jump to time `s` and settle the cameras (tests). */
    seek(s: number, mode?: CameraMode) {
      t = s;
      if (mode) setMode(mode);
      paused = true;
      // Run a few frames so the chase camera and the suspension settle.
      for (let i = 0; i < 30; i++) {
        lastState = pose(player, (f) => f.player, 1 / 60);
        if (opponent) pose(opponent, (f) => f.opponent, 1 / 60);
        rig.update(player, 1 / 60, { speedMph: (lastState?.speed ?? 0) / MPH, rpm: lastState?.rpm ?? 0, maxRpm });
      }
      render(0, 1 / 60);
      return rig.describe();
    },
    play() {
      paused = false;
    },
    perf: () => perfInfo(stage.renderer, stage.scene),
  };
  return { step, render, resize: (w: number, h: number) => rig.resize(w, h) };
}
