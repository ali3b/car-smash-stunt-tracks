// A whole track world: the generator track pieces, the generator terrain (the track's grid and the set's apron;
// render/terrain.ts), the scenery props, track-side dressing, the background ring, and the set's skydome, fog and
// light.
import * as THREE from 'three';
import { loadModel, modelIndex, type LoadedModel } from '../models';
import { buildTrack, modelName, type PlacementIssue } from '../track/build';
import type { TrackFile } from '../track/types';
import { applyAtmosphere, background, groundMaterial, outerGround, sceneryProps, skyModelName, styleModels, type Atmosphere } from './scenery';
import { apronGround, apronModelName, placeApron, placeTerrain, terrainModelName } from './terrain';
import { trackside, TRACKSIDE_MODELS } from './trackside';

export interface World {
  root: THREE.Group;
  atmosphere: Atmosphere;
  models: Map<string, LoadedModel>;
  issues: PlacementIssue[];
}

/** Load a set of models by name (missing ones are left out). */
export async function loadModels(names: Iterable<string>): Promise<Map<string, LoadedModel>> {
  const out = new Map<string, LoadedModel>();
  await Promise.all(
    [...new Set(names)].map(async (n) => {
      const m = await loadModel(n);
      if (m) out.set(n, m);
    }),
  );
  return out;
}

export async function buildWorld(scene: THREE.Scene, sun: THREE.DirectionalLight, t: TrackFile): Promise<World> {
  const index = await modelIndex();
  const have = Object.keys(index?.models ?? {});
  // Only what this track draws: its pieces' models (plus the plain road and its slope, which build.ts puts under
  // spans and on hills), the scenery set's and track-side models, and the world: terrain, apron and sky.
  const pieces = t.pieces.filter((p) => p.kind !== 'scenery').map(modelName);
  const terrainName = terrainModelName(t);
  const world = [terrainName ?? '', apronModelName(t.scenery), skyModelName(t.scenery)];
  const models = await loadModels([...pieces, 'tp-straight', 'tp-straight-slope', ...styleModels(t.scenery), ...TRACKSIDE_MODELS, ...world].filter((n) => have.includes(n)));
  const terrainModel = terrainName ? models.get(terrainName) : undefined;
  const apronModel = models.get(apronModelName(t.scenery));
  // The game-side ground (heightfield, outer plane) only where there is no export: no models, or a track that is not
  // bundled (CS-FB-003, track/build.ts).
  // A track without its own export draws its heightfield in the apron's palette, so it matches the ground round it.
  const palette = !terrainModel && apronModel ? apronGround(apronModel) : null;
  const ground = palette?.material ?? (!terrainModel || !apronModel ? groundMaterial(t.scenery, have.length > 0) : undefined);
  const root = new THREE.Group();
  root.name = 'world';
  const terrain = terrainModel ? placeTerrain(terrainModel) : undefined;
  const { root: track, issues } = buildTrack(t, models, { terrain, ground, groundUv: palette?.uv, skipScenery: models.size > 0 });
  root.add(track);
  if (models.size) {
    root.add(sceneryProps(t, models));
    root.add(trackside(t, models));
    root.add(background(t.scenery, models, t.name.length + t.pieces.length));
  }
  root.add(apronModel ? placeApron(apronModel) : outerGround(ground!));
  scene.add(root);
  const atmosphere = applyAtmosphere(scene, sun, t.scenery, models.get(skyModelName(t.scenery)));
  return { root, atmosphere, models, issues };
}

/** Draw calls, triangles and instanced objects of the last frame (renderer.info), for the perf report. */
export function perfInfo(renderer: THREE.WebGLRenderer, root: THREE.Object3D) {
  let instances = 0;
  let meshes = 0;
  root.traverse((o) => {
    if ((o as THREE.InstancedMesh).isInstancedMesh) instances += (o as THREE.InstancedMesh).count;
    if ((o as THREE.Mesh).isMesh) meshes++;
  });
  return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, meshes, instances, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures };
}
