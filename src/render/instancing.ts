// Instancing: many copies of one generator model drawn as one InstancedMesh per (geometry, material) of the model.
// Used for repeated track pieces, scenery props and the background ring. A model's meshes keep their place inside
// the model (their matrix relative to the model root); every copy gets its own placement matrix.
import * as THREE from 'three';
import type { LoadedModel } from '../models';

export interface InstanceOptions {
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** Skip nodes by name (e.g. the track pieces' invisible `collider`). */
  skip?: (o: THREE.Object3D) => boolean;
}

/** One group holding an InstancedMesh per mesh of `model`, with one instance per matrix. */
export function instanced(model: LoadedModel | THREE.Object3D, matrices: THREE.Matrix4[], opts: InstanceOptions = {}): THREE.Group {
  const g = new THREE.Group();
  if (!matrices.length) return g;
  const scene = (model as unknown as THREE.Object3D).isObject3D ? (model as THREE.Object3D) : (model as LoadedModel).scene;
  scene.updateMatrixWorld(true);
  const rootInv = scene.matrixWorld.clone().invert();
  const skip = opts.skip ?? ((o: THREE.Object3D) => o.name === 'collider');
  const meshes: THREE.Mesh[] = [];
  scene.traverse((o) => {
    if (skip(o)) return;
    if ((o as THREE.Mesh).isMesh && !(o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.Mesh);
  });
  // A mesh under a skipped node is skipped too.
  const skipped = (o: THREE.Object3D): boolean => (o === scene ? false : skip(o) || (o.parent ? skipped(o.parent) : false));
  const local = new THREE.Matrix4();
  const m = new THREE.Matrix4();
  for (const mesh of meshes) {
    if (skipped(mesh) || !mesh.visible) continue;
    local.multiplyMatrices(rootInv, mesh.matrixWorld);
    const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, matrices.length);
    for (let i = 0; i < matrices.length; i++) im.setMatrixAt(i, m.multiplyMatrices(matrices[i], local));
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = opts.castShadow ?? true;
    im.receiveShadow = opts.receiveShadow ?? true;
    im.computeBoundingSphere();
    im.computeBoundingBox();
    im.name = mesh.name;
    g.add(im);
  }
  return g;
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
      const ig = instanced(m, mats, opts);
      ig.name = name;
      g.add(ig);
    }
    return g;
  }
}
