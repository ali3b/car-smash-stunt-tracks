// The generator terrain (CS-FB-003): a bundled track's ground is its `terrain-<id>` grid export (heights, water,
// scatter; ssg.models.json, written by scripts/build-terrain-specs.ts from the track file), and round it the scenery
// set's `apron-<set>` carries the ground out to the horizon. src/track/terrain-spec.ts explains the two grid frames;
// here the GLBs are placed into ours (x + cell/2, z mirrored).
//
// A track whose ground differs from a bundled one (an imported original, an edited copy) has no export: buildTrack()
// then draws the game-side heightfield (track/build.ts buildGround).
import * as THREE from 'three';
import type { LoadedModel } from '../models';
import { APRON_AT, APRON_CELL_TILES } from '../track/terrain-spec';
import { TRACKS } from '../track/tracks';
import { TILE_M, type Scenery, type TrackFile } from '../track/types';

/**
 * The terrain sits this far under the true ground, so road decks lying on it (and on the `track`-shaped slopes,
 * which the slope road matches exactly) never z-fight with it: the generator's note says to raise roads a couple of
 * cm; lowering the ground keeps the roads where the simulation drives.
 */
export const TERRAIN_DROP = 0.04;

const sameGround = (a: TrackFile, b: TrackFile) => JSON.stringify(a.heights) === JSON.stringify(b.heights) && JSON.stringify(a.water) === JSON.stringify(b.water);

/** The terrain model of a track: `terrain-<id>` of the bundled track with this name and ground, else null. */
export function terrainModelName(t: TrackFile): string | null {
  const e = TRACKS.find((e) => e.track === t) ?? TRACKS.find((e) => e.track.name === t.name && sameGround(e.track, t));
  return e ? `terrain-${e.id}` : null;
}

export const apronModelName = (set: Scenery) => `apron-${set}`;

/** Copy of a terrain/apron export, collider hidden, the ground pushed back in depth under the road decks. */
function prepare(m: LoadedModel, name: string): THREE.Object3D {
  const o = m.scene.clone(true);
  o.name = name;
  o.traverse((c) => {
    if (c.name === 'collider') c.visible = false;
    const mesh = c as THREE.Mesh;
    if (!mesh.isMesh) return;
    const isScatter = (mesh as THREE.InstancedMesh).isInstancedMesh;
    // Hills and scatter cast no shadow: the shadow box is ~90 m round the car, and the scatter spans the whole grid
    // (one instanced draw), so it would be drawn twice for nothing.
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    if (!isScatter) {
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        mat.polygonOffset = true;
        mat.polygonOffsetFactor = 1;
        mat.polygonOffsetUnits = 2;
      }
    }
  });
  return o;
}

/** A track's terrain grid placed on our grid: the generator's corner (i, j) lands on our corner (x = i, z = j). */
export function placeTerrain(m: LoadedModel): THREE.Object3D {
  const o = prepare(m, 'terrain');
  o.position.set(TILE_M / 2, -TERRAIN_DROP, 0);
  o.scale.set(1, 1, -1);
  return o;
}

/**
 * The apron's palette material and the UV of its ground swatch (its flat outer corner), for the game-side heightfield
 * of a track without its own export (CS-FB-003), so it matches the ground round it.
 */
export function apronGround(m: LoadedModel): { material: THREE.Material; uv: [number, number] } | null {
  let found: { material: THREE.Material; uv: [number, number] } | null = null;
  m.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (found || !mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || !/^terrain/.test(mesh.name)) return;
    const uv = mesh.geometry.attributes.uv as THREE.BufferAttribute | undefined;
    if (!uv) return;
    const material = (mesh.material as THREE.Material).clone();
    material.polygonOffset = true;
    material.polygonOffsetFactor = 1;
    material.polygonOffsetUnits = 2;
    found = { material, uv: [uv.getX(0), uv.getY(0)] };
  });
  return found;
}

/** The apron, its corner (APRON_AT, APRON_AT) on our corner (0, 0); a hair under the track's terrain. */
export function placeApron(m: LoadedModel): THREE.Object3D {
  const o = prepare(m, 'apron');
  const c = TILE_M * APRON_CELL_TILES;
  o.position.set(-(APRON_AT - 0.5) * c, -TERRAIN_DROP - 0.01, APRON_AT * c);
  o.scale.set(1, 1, -1);
  return o;
}
