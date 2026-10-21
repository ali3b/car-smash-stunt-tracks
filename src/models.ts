// Models from the generator: `public/models/models.json` is written by `ssg model apply` (npm run assets from
// ssg.models.json) and lists a GLB plus its manifest per model (format: the generator's docs/MODELS.md). When the
// folder is missing the game draws placeholders. __HAS_MODELS__ is decided at build/dev-server start
// (vite.config.ts), so a missing file never causes a 404 in the console.
// Exports are `compress: "meshopt"` (EXT_meshopt_compression), so the loader always carries the decoder. Cars carry
// paint variants (KHR_materials_variants): withVariant() clones a car in one of them.
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

declare const __HAS_MODELS__: boolean;

export interface WheelInfo {
  node: string;
  radius: number;
  axle: [number, number, number];
  steer: boolean;
  /** The wheel centre in the model's metres (the node sits there). */
  pos?: [number, number, number];
}

export interface ModelManifest {
  version: number;
  name: string;
  origin: string;
  bounds: { min: number[]; max: number[]; size: number[] };
  wheels?: Partial<Record<'fl' | 'fr' | 'rl' | 'rr', WheelInfo>>;
  collider?: { box: { center: number[]; size: number[] }; trimesh?: { node: string; triangles: number } };
  /**
   * Characters: the merged clips (loop = the clip is authored as a loop) and named attachment points. A clip asked
   * for with a qualifier keeps it in its name (`POLY_IDL_Base@Masculine`); `source` is the library clip.
   */
  clips?: { name: string; duration: number; loop: boolean; speedMps?: number; source?: { id: number; pack: string; name: string; variant?: string; set?: string } }[];
  /** Track pieces also say what the end is (`edge`: road, elevated, banked-left, pipe…) and its bank in degrees. */
  sockets?: { name: string; node: string; pos: [number, number, number]; rot: [number, number, number, number]; edge?: string; bank?: number }[];
  scale?: { modelScale: number; fit?: Record<string, number> };
  /** Paint variants in the GLB (KHR_materials_variants), in its order; the first is the default look. */
  variants?: { name: string; tint: string | null }[];
  /** Baked static poses (crowds): one child node per pose, holding its mesh. */
  poses?: { name: string; node: string; clip: string; time: number; bounds: { min: number[]; max: number[]; size: number[] } }[];
  compress?: string;
  warnings?: string[];
  /**
   * Levels of detail (spec `lods`): LOD1… are whole copies of the model at fewer triangles under root nodes `node`;
   * LOD0 (the model itself) is the root's `LOD0` node.
   */
  lods?: { level: number; node: string; ratio: number; triangles: number; source: string }[];
  /** The car's own instruments (Street Racer, CS-FB-023): dials in the model's frame and the needles that turn on them. */
  dashboard?: { gauges: DashboardGauge[] };
}

export interface DashboardGauge {
  /** The dial. */
  node: string;
  center: [number, number, number];
  /** Unit normal of the face, towards the driver. */
  normal: [number, number, number];
  radius: number;
  needle?: {
    node: string;
    /** Where the needle node sits (it turns about here). */
    pivot: [number, number, number];
    /** A positive turn about this axis is clockwise as the driver sees it. */
    axis: [number, number, number];
    /** The direction it points at rest (pivot → tip). */
    rest: [number, number, number];
    length: number;
  };
}

interface ModelIndex {
  models: Record<string, { glb: string; data: ModelManifest }>;
}

const BASE = `${import.meta.env.BASE_URL}models/`;
let indexP: Promise<ModelIndex | null> | null = null;
const glbs = new Map<string, Promise<LoadedModel | null>>();
let loader: GLTFLoader | null = null;
const gltfLoader = () => (loader ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder));

// Loading progress (the boot screen and the race loading screen show it): GLBs asked for and GLBs arrived.
const progress = { total: 0, done: 0 };
const progressListeners = new Set<(done: number, total: number) => void>();
const notify = () => {
  for (const fn of progressListeners) fn(progress.done, progress.total);
};
/** Model downloads so far: done of total (both grow as scenes ask for models). */
export const modelProgress = () => ({ ...progress });
export function onModelProgress(fn: (done: number, total: number) => void): () => void {
  progressListeners.add(fn);
  return () => progressListeners.delete(fn);
}

/** True when the game was started with generator models (public/models/models.json existed). */
export const hasModels = () => typeof __HAS_MODELS__ !== 'undefined' && __HAS_MODELS__;

/** public/models/models.json, fetched once; null when the game was started without models. */
export function modelIndex(): Promise<ModelIndex | null> {
  if (typeof __HAS_MODELS__ === 'undefined' || !__HAS_MODELS__) return Promise.resolve(null);
  // One retry (a dropped connection must not leave the whole session without models); a failure is not cached.
  const get = () => fetch(`${BASE}models.json`).then((r) => (r.ok ? (r.json() as Promise<ModelIndex>) : Promise.reject(new Error(`HTTP ${r.status}`))));
  indexP ??= get()
    .catch(() => new Promise((ok) => setTimeout(ok, 500)).then(get))
    .catch(() => {
      indexP = null;
      return null;
    });
  return indexP;
}

/** One model from the index by name (loaded once, shared: clone the scene before adding it twice). */
export function loadModel(name: string): Promise<LoadedModel | null> {
  let p = glbs.get(name);
  if (!p) {
    p = modelIndex().then(async (index) => {
      const entry = index?.models[name];
      if (!entry) return null;
      progress.total++;
      notify();
      const gltf = await gltfLoader()
        .loadAsync(`${BASE}${entry.glb}`)
        .finally(() => {
          progress.done++;
          notify();
        });
      gltf.scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      return { scene: gltf.scene, clips: gltf.animations, manifest: entry.data, gltf };
    });
    glbs.set(name, p);
  }
  return p;
}

export interface LoadedModel {
  scene: THREE.Object3D;
  /** The GLB's animation clips (characters), by the names in manifest.clips. */
  clips: THREE.AnimationClip[];
  manifest: ModelManifest;
  /** The loaded glTF (its parser resolves paint variants). */
  gltf?: GLTF;
}

interface VariantsExt {
  KHR_materials_variants?: { variants?: { name: string }[]; mappings?: { material: number; variants: number[] }[] };
}

/**
 * A copy of `model` wearing paint variant `name` (KHR_materials_variants; three.js reads the extension but has no
 * switch, so this is the docs/MODELS.md parser.associations recipe). Meshes are matched to the clone by traversal
 * order; geometry is shared and the variant's materials are shared by every copy of that variant.
 */
export async function withVariant(model: LoadedModel, name: string): Promise<LoadedModel> {
  const gltf = model.gltf;
  const ext = gltf?.parser.json.extensions as VariantsExt | undefined;
  const index = ext?.KHR_materials_variants?.variants?.findIndex((v) => v.name === name) ?? -1;
  if (!gltf || index < 0) return model;
  const { parser } = gltf;
  const meshes: THREE.Mesh[] = [];
  model.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  const materials = await Promise.all(
    meshes.map((o) => {
      const a = parser.associations.get(o) as { meshes?: number; primitives?: number } | undefined;
      if (a?.meshes === undefined || a.primitives === undefined) return null;
      const prim = parser.json.meshes[a.meshes].primitives[a.primitives] as { extensions?: VariantsExt };
      const m = prim.extensions?.KHR_materials_variants?.mappings?.find((x) => x.variants.includes(index));
      return m ? (parser.getDependency('material', m.material) as Promise<THREE.Material>) : null;
    }),
  );
  const scene = model.scene.clone(true);
  let i = 0;
  scene.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    const mat = materials[i++];
    if (mat) (o as THREE.Mesh).material = mat;
  });
  return { ...model, scene };
}
