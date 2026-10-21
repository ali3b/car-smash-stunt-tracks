// Instancing: many copies of one generator model drawn as one InstancedMesh per (geometry, material) of the model.
// Used for repeated track pieces, scenery props and the background ring. A model's meshes keep their place inside
// the model (their matrix relative to the model root); every copy gets its own placement matrix.
//
// Levels of detail (CS-FB-025): a model exported with `lods` (ssg.models.json) holds its levels as root nodes LOD0,
// LOD1, … (manifest.lods). Its copies are then drawn as one set of InstancedMeshes per level, and updateLods() deals
// the copies out between the levels by how big each one is on screen (distance, its size, the camera's lens).
import * as THREE from 'three';
import type { LoadedModel, ModelManifest } from '../models';

export interface InstanceOptions {
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** Skip nodes by name (e.g. the track pieces' invisible `collider`). */
  skip?: (o: THREE.Object3D) => boolean;
}

interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  /** The mesh's matrix relative to the model root. */
  local: THREE.Matrix4;
  name: string;
}

/** The drawable meshes under `from` (default: the whole model), with their matrices relative to the model root. */
function partsOf(scene: THREE.Object3D, skip: (o: THREE.Object3D) => boolean, from: THREE.Object3D = scene): Part[] {
  scene.updateMatrixWorld(true);
  const rootInv = scene.matrixWorld.clone().invert();
  const out: Part[] = [];
  // A mesh under a skipped node is skipped too.
  const skipped = (o: THREE.Object3D): boolean => (o === scene ? false : skip(o) || (o.parent ? skipped(o.parent) : false));
  from.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (o as THREE.SkinnedMesh).isSkinnedMesh || skipped(mesh) || !mesh.visible) return;
    out.push({ geometry: mesh.geometry, material: mesh.material, local: new THREE.Matrix4().multiplyMatrices(rootInv, mesh.matrixWorld), name: mesh.name });
  });
  return out;
}

function instancedMesh(p: Part, n: number, opts: InstanceOptions): THREE.InstancedMesh {
  const im = new THREE.InstancedMesh(p.geometry, p.material, n);
  im.castShadow = opts.castShadow ?? true;
  im.receiveShadow = opts.receiveShadow ?? true;
  im.name = p.name;
  return im;
}

/**
 * One group holding an InstancedMesh per mesh of `model`, with one instance per matrix. With levels of detail (the
 * model's own `lods`, or `lower`: lighter exports of the same model, LOD1 first) the copies share out between them.
 */
export function instanced(model: LoadedModel | THREE.Object3D, matrices: THREE.Matrix4[], opts: InstanceOptions = {}, lower: LoadedModel[] = []): THREE.Group {
  if (!matrices.length) return new THREE.Group();
  const isObject = (model as unknown as THREE.Object3D).isObject3D;
  const scene = isObject ? (model as THREE.Object3D) : (model as LoadedModel).scene;
  const skip = opts.skip ?? ((o: THREE.Object3D) => o.name === 'collider');
  const lods = isObject ? undefined : (model as LoadedModel).manifest.lods;
  const nodes = lodNodes(lods).map((n) => scene.getObjectByName(n));
  const levels: LodLevel[] = nodes.length > 1 && nodes.every((l) => l) ? nodes.map((node) => ({ scene, node: node! })) : [{ scene, node: scene }];
  for (const m of lower) levels.push({ scene: m.scene, node: m.scene });
  if (levels.length > 1) return new LodInstances(levels, matrices, skip, opts);
  const g = new THREE.Group();
  const m = new THREE.Matrix4();
  for (const p of partsOf(scene, skip)) {
    const im = instancedMesh(p, matrices.length, opts);
    for (let i = 0; i < matrices.length; i++) im.setMatrixAt(i, m.multiplyMatrices(matrices[i], p.local));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.computeBoundingBox();
    g.add(im);
  }
  return g;
}

/**
 * Switch distances, as the copy's distance over its radius with a 60° lens (a longer lens, e.g. a TV camera's,
 * scales them up): LOD1 from 9 radii (the copy is under ~70 px tall at 720 p), LOD2 from 30, LOD3 from 110.
 */
export const LOD_SWITCH = [9, 30, 110];
/** A copy changes level only once it is this much (share) past the switch distance, so it doesn't flicker. */
const LOD_HYSTERESIS = 0.08;
const TAN30 = Math.tan(Math.PI / 6);

interface LodLevel {
  /** The model the level is part of (its root: the frame the copies are placed in)... */
  scene: THREE.Object3D;
  /** ...and the node holding the level (the root itself for a whole model). */
  node: THREE.Object3D;
}

/** The copies of a model with levels of detail: an InstancedMesh per (level, mesh), refilled when copies change level. */
export class LodInstances extends THREE.Group {
  readonly isLodInstances = true;
  private levels: { meshes: { im: THREE.InstancedMesh; local: THREE.Matrix4 }[] }[];
  private centres: THREE.Vector3[];
  private radii: Float32Array;
  private level: Int8Array;
  /** Triangles of one copy per level (for the perf report). */
  readonly triangles: number[];

  constructor(
    levelNodes: LodLevel[],
    private readonly matrices: THREE.Matrix4[],
    skip: (o: THREE.Object3D) => boolean,
    opts: InstanceOptions,
  ) {
    super();
    const n = matrices.length;
    this.levels = levelNodes.map(({ scene, node }) => ({ meshes: partsOf(scene, skip, node).map((p) => ({ im: instancedMesh(p, n, opts), local: p.local })) }));
    this.triangles = this.levels.map((l) => l.meshes.reduce((t, { im }) => t + (im.geometry.index ? im.geometry.index.count : im.geometry.attributes.position.count) / 3, 0));
    for (const l of this.levels) for (const { im } of l.meshes) this.add(im);
    // Each copy's bounding sphere (LOD0's box, placed).
    const box = new THREE.Box3().setFromObject(levelNodes[0].node);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const s = new THREE.Vector3();
    this.centres = matrices.map((m) => sphere.center.clone().applyMatrix4(m));
    this.radii = Float32Array.from(matrices, (m) => sphere.radius * s.setFromMatrixScale(m).x);
    this.level = new Int8Array(n);
    this.refill();
  }

  /** Pick each copy's level for a camera; refill the instance buffers when any copy changed level. */
  update(camera: THREE.PerspectiveCamera) {
    const lens = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / TAN30;
    const at = camera.position;
    const top = this.levels.length - 1;
    let changed = false;
    for (let i = 0; i < this.centres.length; i++) {
      const d = (at.distanceTo(this.centres[i]) * lens) / Math.max(this.radii[i], 1e-3);
      let l = this.level[i];
      while (l < top && d > LOD_SWITCH[l] * (1 + LOD_HYSTERESIS)) l++;
      while (l > 0 && d < LOD_SWITCH[l - 1] * (1 - LOD_HYSTERESIS)) l--;
      if (l !== this.level[i]) {
        this.level[i] = l;
        changed = true;
      }
    }
    if (changed) this.refill();
  }

  /** Copies per level right now. */
  counts(): number[] {
    const c = this.levels.map(() => 0);
    for (const l of this.level) c[l]++;
    return c;
  }

  private refill() {
    const m = new THREE.Matrix4();
    for (const [li, level] of this.levels.entries()) {
      for (const { im, local } of level.meshes) {
        let k = 0;
        for (let i = 0; i < this.matrices.length; i++) if (this.level[i] === li) im.setMatrixAt(k++, m.multiplyMatrices(this.matrices[i], local));
        im.count = k;
        im.visible = k > 0;
        im.instanceMatrix.needsUpdate = true;
        if (k) {
          im.computeBoundingSphere();
          im.computeBoundingBox();
        }
      }
    }
  }
}

/** Every LodInstances under `root` (found once, then kept on the root). */
function lodsUnder(root: THREE.Object3D): LodInstances[] {
  const cached = root.userData.lodInstances as LodInstances[] | undefined;
  if (cached) return cached;
  const out: LodInstances[] = [];
  root.traverse((o) => {
    if ((o as LodInstances).isLodInstances) out.push(o as LodInstances);
  });
  root.userData.lodInstances = out;
  return out;
}

/** Levels of detail for everything under `root` as seen from `camera` (call once a frame, after the camera moved). */
export function updateLods(root: THREE.Object3D, camera: THREE.PerspectiveCamera) {
  for (const l of lodsUnder(root)) l.update(camera);
}

/** Copies per level and the triangles they draw, over every model with levels under `root` (perf reports). */
export function lodStats(root: THREE.Object3D): { copies: number[]; triangles: number; trianglesAtLod0: number } {
  const copies = [0, 0, 0, 0, 0];
  let triangles = 0;
  let trianglesAtLod0 = 0;
  for (const l of lodsUnder(root)) {
    const c = l.counts();
    c.forEach((n, i) => {
      copies[i] += n;
      triangles += n * l.triangles[i];
      trianglesAtLod0 += n * l.triangles[0];
    });
  }
  return { copies, triangles, trianglesAtLod0 };
}

/** The level nodes of a model with levels of detail, LOD0 first ([] without levels). */
function lodNodes(lods: ModelManifest['lods']): string[] {
  if (!lods?.length) return [];
  const byLevel = new Map<number, string>([[0, 'LOD0'], ...lods.map((l) => [l.level, l.node] as [number, string])]);
  return [...byLevel].sort((a, b) => a[0] - b[0]).map(([, n]) => n);
}

/** Show only level `level` of a copy of a model with levels of detail (the levels are stacked in the export). */
export function showLod(copy: THREE.Object3D, model: LoadedModel, level = 0) {
  lodNodes(model.manifest.lods).forEach((n, i) => {
    const node = copy.getObjectByName(n);
    if (node) node.visible = i === level;
  });
}

/** A placement matrix from position, yaw (radians about +Y) and uniform scale. */
export function placement(x: number, y: number, z: number, yaw = 0, scale = 1): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(scale, scale, scale));
}

/** Collects placements per model name, then builds the instanced groups. */
export class InstanceBatch {
  readonly byModel = new Map<string, THREE.Matrix4[]>();
  add(model: string, matrix: THREE.Matrix4) {
    let l = this.byModel.get(model);
    if (!l) this.byModel.set(model, (l = []));
    l.push(matrix);
  }
  build(models: Map<string, LoadedModel>, opts?: InstanceOptions & { name?: string }): THREE.Group {
    const g = new THREE.Group();
    g.name = opts?.name ?? 'instances';
    for (const [name, mats] of this.byModel) {
      const m = models.get(name);
      if (!m) continue;
      // CS-FB-140: lighter exports of the same model (`<name>-lod1`, `simplify`) stand in for `lods`, whose
      // simplified levels come out as one shared mesh.
      const lower = [models.get(`${name}-lod1`), models.get(`${name}-lod2`)].filter((x): x is LoadedModel => !!x);
      const ig = instanced(m, mats, opts, lower);
      ig.name = name;
      g.add(ig);
    }
    return g;
  }
}
