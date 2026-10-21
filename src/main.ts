// Boot: the renderer, the models, then the scene picked by ?scene=:
//   ?scene=game (default)             the game: title, menus, races, replays (src/game/flow.ts)
//   ?scene=race&track=<id>|custom     the game, straight into a race (custom: the editor's Test drive track)
//   ?scene=garage                     every car from ssg.models.json side by side on a slow turntable
//   ?scene=track&track=<id>           a bundled track (src/track/tracks/), seen from above (&view=top: straight down;
//                                     &shadow=<m>: the shadow box radius)
//   ?scene=track&local=<name>         a track from local-tracks/ (dev only: scripts/import-trk.mjs)
//   ?scene=audio                      the sound bench (src/audio/bench.ts)
//   ?scene=editor                     the track editor (src/editor/)
//   ?scene=replay&golden=<NAME>       dev only: the original's replay driving on its track (src/scenes/replay.ts)
//   ?scene=props[&set=<scenery>]      every scenery / background / track-side model of a set (dev aid; &lod=<n>: level n)
//   ?scene=capture (or ?capture)      frame-exact capture for videos: window.__cs.capture (src/scenes/capture.ts)
// window.__cs is the test/tool handle (scripts/load-check.mjs).
import * as THREE from 'three';
import { createStage } from './engine/renderer';
import { Loop } from './engine/loop';
import { hasModels, loadModel, modelIndex } from './models';
import { modelName } from './track/build';
import { GRID, TILE_M, type Scenery, type TrackFile } from './track/types';
import { loadTrack, setCustomTrack, TRACKS } from './track/tracks';
import { startGame } from './game/start';
// Registers the 3D race view with the game flow (src/game/integrations.ts).
import './render/race-view';
import { buildWorld, loadModels, perfInfo } from './render/world';
import { bootDone, bootMessage, bootProgress, hasWebGL2 } from './boot';
import { applyAtmosphere, groundMaterial, styleModels } from './render/scenery';
import { TRACKSIDE_MODELS } from './render/trackside';
import { lodStats, showLod, updateLods } from './render/instancing';
import type { Atmosphere } from './render/scenery';

const SCENES = ['game', 'race', 'garage', 'track', 'audio', 'editor', 'replay', 'props', 'capture'] as const;

declare global {
  interface Window {
    __cs: Record<string, unknown> & { ready: boolean };
  }
}

/** A box the size of a car, for when the game runs without generator models. */
function placeholderCar(colour: string): THREE.Object3D {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 4.4), new THREE.MeshStandardMaterial({ color: colour }));
  body.position.y = 0.75;
  body.castShadow = true;
  g.add(body);
  return g;
}

async function garage(scene: THREE.Scene) {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#56664a' }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const index = await modelIndex();
  const names = index ? Object.keys(index.models).filter((n) => n.startsWith('car-')) : ['a', 'b', 'c', 'd'];
  const cars: THREE.Object3D[] = [];
  for (const [i, name] of names.entries()) {
    const m = index ? await loadModel(name) : null;
    const car = m ? m.scene.clone(true) : placeholderCar(['#c62828', '#1e5aa8', '#f2b705', '#2e7d32'][i % 4]);
    car.position.set((i - (names.length - 1) / 2) * 3.4, m?.manifest.origin === 'axle-centre' ? (m.manifest.wheels?.fl?.radius ?? 0.35) : 0, 0);
    car.name = name;
    scene.add(car);
    cars.push(car);
  }
  return { cars, width: names.length * 3.4 };
}

/** A bundled track (?track=<id>, src/track/tracks/) or, in development, a local reference track (?local=<name>). */
async function fetchTrack(params: URLSearchParams): Promise<TrackFile> {
  const id = params.get('track') ?? (params.get('local') ? null : TRACKS[0].id);
  if (id) return loadTrack(id);
  const name = params.get('local')!;
  if (!import.meta.env.DEV) throw new Error('local tracks are a development aid');
  const res = await fetch(`${import.meta.env.BASE_URL}local-tracks/${encodeURIComponent(name)}.json`);
  if (!res.ok) throw new Error(`no local track "${name}" (run node scripts/import-trk.mjs)`);
  return (await res.json()) as TrackFile;
}

async function trackScene(stage: ReturnType<typeof createStage>, params: URLSearchParams): Promise<Atmosphere> {
  const t = await fetchTrack(params);
  const world = await buildWorld(stage.scene, stage.sun, t);
  const tp = [...world.models.keys()].filter((n) => n.startsWith('tp-'));
  const missing = [...new Set(t.pieces.filter((p) => p.kind !== 'scenery' && !world.models.has(modelName(p))).map(modelName))];
  window.__cs.track = { name: t.name, scenery: t.scenery, pieces: t.pieces.length, models: tp.length, missing, issues: world.issues.map((i) => ({ ...i.piece, model: i.model, error: +i.error.toFixed(2) })) };
  window.__cs.perf = () => ({ ...perfInfo(stage.renderer, stage.scene), lods: lodStats(stage.scene) });
  return world.atmosphere;
}

/** Every model a scenery set uses, in rows (props, background, track-side), to judge sizes and looks. */
async function propsScene(stage: ReturnType<typeof createStage>, params: URLSearchParams) {
  const set = (params.get('set') ?? 'country') as Scenery;
  const names = [...styleModels(set), ...TRACKSIDE_MODELS];
  const models = await loadModels(names);
  const plane = new THREE.PlaneGeometry(4000, 4000);
  const uv = plane.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 160, uv.getY(i) * 160);
  const ground = new THREE.Mesh(plane, groundMaterial(set));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  stage.scene.add(ground);
  // A grid of 40 m cells, 6 per row (bigger models shrunk to fit), first model at the front left.
  const labels: { name: string; x: number; z: number; size: number[] }[] = [];
  let i = 0;
  for (const n of names) {
    const m = models.get(n);
    if (!m) continue;
    const o = m.scene.clone(true);
    showLod(o, m, Number(params.get('lod')) || 0);
    const size = m.manifest.bounds.size;
    const s = Math.min(1, 34 / Math.max(size[0], size[2], size[1] * 0.8));
    o.scale.setScalar(s);
    o.position.set((i % 6) * 40, 0, -Math.floor(i / 6) * 40);
    stage.scene.add(o);
    labels.push({ name: n, x: o.position.x, z: o.position.z, size });
    i++;
  }
  const x = 200;
  window.__cs.props = labels;
  return { atmosphere: applyAtmosphere(stage.scene, stage.sun, set), width: x };
}

async function boot() {
  const params = new URLSearchParams(location.search);
  const sceneName = params.get('scene') ?? (params.has('capture') ? 'capture' : 'game');
  window.__cs = { ready: false, scene: sceneName, models: hasModels() };
  if (!(SCENES as readonly string[]).includes(sceneName)) throw new Error(`unknown scene "${sceneName}" (have: ${SCENES.join(', ')})`);
  if (sceneName === 'audio') {
    // The sound bench (src/audio/bench.ts): every song, sound and engine voice.
    const { startAudioBench } = await import('./audio/bench');
    bootDone();
    startAudioBench(document.body);
    window.__cs.ready = true;
    return;
  }
  if (!hasWebGL2()) {
    bootMessage('NO 3D IN THIS BROWSER', 'Car Smash Stunt Tracks needs WebGL 2. Try an up-to-date Chrome, Edge, Firefox or Safari, and check that hardware acceleration is on.');
    window.__cs.error = 'no WebGL 2';
    return;
  }
  bootProgress();
  if (sceneName === 'editor') {
    await (await import('./editor/editor')).startEditor();
    return bootDone();
  }
  if (sceneName === 'game' || sceneName === 'race') {
    let race: string | undefined;
    if (sceneName === 'race') {
      race = params.get('track') ?? TRACKS[0]?.id;
      if (race === 'custom') {
        const { CUSTOM_TRACK_KEY } = await import('./editor/storage');
        const { parseTrack } = await import('./editor/doc');
        const raw = localStorage.getItem(CUSTOM_TRACK_KEY);
        if (!raw) throw new Error('no track from the editor to drive (press Test drive in the editor)');
        setCustomTrack(parseTrack(JSON.parse(raw)));
      }
    }
    await startGame({ race });
    bootDone();
    return;
  }
  if (sceneName === 'capture') {
    await (await import('./scenes/capture')).startCapture();
    return bootDone();
  }
  const stage = createStage(document.body);
  window.__cs.stage = stage;
  window.__cs.THREE = THREE;
  const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.5, 20000);
  let cars: THREE.Object3D[] = [];
  let atmosphere: Atmosphere | null = null;
  let focus = new THREE.Vector3();
  let custom: { step(dt: number): void; render(alpha: number, frameDt: number): void; resize(w: number, h: number): void } | null = null;
  if (sceneName === 'replay') {
    // Dev only: needs the local ground truth; never part of the production build.
    if (!import.meta.env.DEV) throw new Error('the replay scene is a development aid');
    custom = await (await import('./scenes/replay')).replayScene(stage, params);
  } else if (sceneName === 'track') {
    atmosphere = await trackScene(stage, params);
    const half = (GRID * TILE_M) / 2;
    if (params.get('view') === 'top') {
      // Straight down from far away (nearly orthographic), north up.
      camera.fov = 8;
      camera.near = 9000;
      camera.far = 20000;
      camera.updateProjectionMatrix();
      camera.up.set(0, 0, -1);
      camera.position.set(half, (half * 1.04) / Math.tan(THREE.MathUtils.degToRad(4)), -half);
      // 14 km up: past the fog's far end.
      stage.scene.fog = null;
    } else camera.position.set(half, half * 1.6, half * 0.9);
    camera.lookAt(half, 0, -half);
    focus = new THREE.Vector3(half, 0, -half);
    // ?cam=x,y,z,lookX,lookY,lookZ (metres): a close look at one spot (seams, slopes, water edges).
    const cam = params.get('cam')?.split(',').map(Number);
    if (cam?.length === 6 && cam.every(Number.isFinite)) {
      camera.position.set(cam[0], cam[1], cam[2]);
      camera.lookAt(cam[3], cam[4], cam[5]);
      focus = new THREE.Vector3(cam[3], cam[4], cam[5]);
    }
  } else if (sceneName === 'props') {
    const p = await propsScene(stage, params);
    atmosphere = p.atmosphere;
    camera.position.set(100, 110, 90);
    camera.lookAt(100, 0, -80);
    focus = new THREE.Vector3(100, 0, -80);
  } else {
    const g = await garage(stage.scene);
    cars = g.cars;
    const dist = Math.max(10, g.width * 0.9);
    camera.position.set(0, dist * 0.35, dist);
    camera.lookAt(0, 0.6, 0);
  }
  const loop = new Loop({
    step: (dt) => {
      if (custom) return custom.step(dt);
      for (const c of cars) c.rotation.y += dt * 0.4;
    },
    render: (alpha, frameDt) => {
      if (custom) return custom.render(alpha, frameDt);
      atmosphere?.update(camera, focus, Number(params.get('shadow')) || (sceneName === 'track' ? 1000 : 220));
      updateLods(stage.scene, camera);
      stage.renderer.render(stage.scene, camera);
    },
  });
  addEventListener('resize', () => {
    stage.renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    custom?.resize(innerWidth, innerHeight);
  });
  window.__cs.cars = cars.map((c) => c.name);
  // The shadow box's focus (checks move it to see that still shadows stay put: QA-21).
  window.__cs.focus = focus;
  window.__cs.loop = loop;
  loop.start();
  bootDone();
  window.__cs.ready = true;
}

boot().catch((e) => {
  console.error(e);
  if (window.__cs) window.__cs.error = String(e);
  bootMessage('SOMETHING WENT WRONG', String(e instanceof Error ? e.message : e));
});
