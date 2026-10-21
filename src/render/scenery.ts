// Scenery sets (a track's horizon byte: desert, tropical, alpine, city, country): the sky, fog and light, the ground
// texture, which generator models draw the track's scenery props, and the background around the 30×30 grid (a band
// of props just outside it, a far ring of mountains / skyline, clouds).
//
// World scale: everything is ~1.4× real size, because the track is (a 14.6 m road, 6.1 m cars: see car-view.ts).
// Props are fitted in ssg.models.json (sc-*); background models (bg-*) come at natural size and are scaled here.
import { propScale } from '../engine/quality';
import * as THREE from 'three';
import type { LoadedModel } from '../models';
import { GRID, HILL_M, TILE_M, type Piece, type Scenery, type TrackFile } from '../track/types';
import { InstanceBatch, placement } from './instancing';

export interface FarItem {
  /** Models to pick from. */
  models: string[];
  count: number;
  /** Distance from the grid centre, metres. */
  radius: [number, number];
  scale: [number, number];
  /** Sink into the ground by this share of the height (mountains whose base is not flat). */
  sink?: number;
  /** Face the grid centre (cards such as skyline segments and mountain silhouettes). */
  faceCentre?: boolean;
}

export interface NearItem {
  models: string[];
  count: number;
  scale: [number, number];
  /** Band outside the grid edge, metres [from, to]. */
  band: [number, number];
}

export interface SceneryStyle {
  skyTop: string;
  skyHorizon: string;
  skyGround: string;
  fog: string;
  fogNear: number;
  fogFar: number;
  sun: string;
  sunIntensity: number;
  /** Direction the sunlight comes from (unit-ish; y up). */
  sunFrom: [number, number, number];
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  ground: string;
  groundTint: string;
  /** Scenery prop variant → models (picked per tile). */
  props: Partial<Record<string, string[]>>;
  near: NearItem[];
  far: FarItem[];
  clouds: boolean;
}

const COMMON_PROPS: Record<string, string[]> = {
  palm: ['sc-palm', 'sc-palm-b'],
  cactus: ['sc-cactus', 'sc-cactus-b'],
  tree: ['sc-farm-tree', 'bg-tree'],
  'tennis-court': ['sc-tennis'],
  // A composite export: the canopy over two pumps.
  'gas-station': ['sc-gas-station'],
  barn: ['sc-barn'],
  office: ['sc-office', 'sc-office-b', 'sc-office-c'],
  windmill: ['sc-windmill'],
  boat: ['sc-boat'],
  diner: ['sc-diner'],
};

const RANGE = ['bg-range-a', 'bg-range-b', 'bg-range-c'];

export const STYLES: Record<Scenery, SceneryStyle> = {
  desert: {
    skyTop: '#3f86d8', skyHorizon: '#f4dcae', skyGround: '#d9b98a',
    fog: '#ecd7ae', fogNear: 1600, fogFar: 8700,
    sun: '#fff0d2', sunIntensity: 3.0, sunFrom: [-0.5, 0.75, 0.3],
    hemiSky: '#fff4dc', hemiGround: '#b48a52', hemiIntensity: 1.2,
    ground: 'ground-sand', groundTint: '#f0dcb4',
    props: { ...COMMON_PROPS, tree: ['sc-dead-tree'] },
    near: [
      { models: ['sc-cactus', 'sc-cactus-b'], count: 90, scale: [0.8, 1.3], band: [25, 420] },
      { models: ['sc-dead-tree'], count: 25, scale: [0.8, 1.2], band: [40, 420] },
      { models: ['bg-mesa-c'], count: 18, scale: [2, 4], band: [120, 600] },
    ],
    far: [
      { models: ['bg-mesa-a', 'bg-mesa-b'], count: 26, radius: [2300, 3000], scale: [12, 18], sink: 0.05 },
      { models: ['bg-mesa-c'], count: 14, radius: [1700, 2200], scale: [8, 12], sink: 0.05 },
    ],
    clouds: false,
  },
  tropical: {
    skyTop: '#1f7fe0', skyHorizon: '#bfe8ff', skyGround: '#8fbf8a',
    fog: '#cbe7f4', fogNear: 1600, fogFar: 8500,
    sun: '#fff3dc', sunIntensity: 2.9, sunFrom: [-0.4, 0.8, 0.35],
    hemiSky: '#e9f7ff', hemiGround: '#4f7a3a', hemiIntensity: 1.25,
    ground: 'ground-grass-lush', groundTint: '#ffffff',
    props: { ...COMMON_PROPS, tree: ['sc-jungle-tree', 'sc-palm'] },
    near: [
      { models: ['sc-palm', 'sc-palm-b'], count: 120, scale: [0.8, 1.25], band: [25, 380] },
      { models: ['sc-jungle-tree'], count: 70, scale: [0.9, 1.5], band: [60, 500] },
    ],
    far: [
      { models: ['bg-volcano'], count: 3, radius: [2600, 3000], scale: [28, 34], sink: 0.12 },
      { models: RANGE, count: 26, radius: [2800, 3300], scale: [5, 7], faceCentre: true },
      { models: ['bg-jungle'], count: 40, radius: [1600, 2100], scale: [4, 6] },
    ],
    clouds: true,
  },
  alpine: {
    skyTop: '#2f6fc0', skyHorizon: '#dbe8f4', skyGround: '#9fb39a',
    fog: '#d6e2ec', fogNear: 1500, fogFar: 8300,
    sun: '#fff6e8', sunIntensity: 2.8, sunFrom: [-0.55, 0.7, 0.35],
    hemiSky: '#eef5ff', hemiGround: '#55704a', hemiIntensity: 1.3,
    ground: 'ground-generic-grass', groundTint: '#e6f0dc',
    props: { ...COMMON_PROPS, tree: ['sc-pine', 'bg-pine'] },
    near: [
      { models: ['bg-pine'], count: 160, scale: [0.8, 1.4], band: [25, 500] },
      { models: ['bg-alpine-trees'], count: 30, scale: [2.5, 3.5], band: [250, 700] },
    ],
    far: [
      { models: ['bg-snow-a', 'bg-snow-b', 'bg-snow-c'], count: 34, radius: [2300, 3100], scale: [22, 34], sink: 0.03 },
    ],
    clouds: true,
  },
  city: {
    skyTop: '#5c93cf', skyHorizon: '#d9e2ea', skyGround: '#8f9a8a',
    fog: '#cdd6de', fogNear: 1400, fogFar: 7900,
    sun: '#fff4e2', sunIntensity: 2.7, sunFrom: [-0.45, 0.72, 0.4],
    hemiSky: '#eef3f8', hemiGround: '#5f6a52', hemiIntensity: 1.3,
    ground: 'ground-grass', groundTint: '#f2f2e6',
    props: { ...COMMON_PROPS },
    near: [
      { models: ['bg-office', 'bg-office-round', 'sc-office-b'], count: 60, scale: [0.9, 1.6], band: [60, 650] },
      { models: ['bg-containers'], count: 8, scale: [1.3, 1.5], band: [120, 500] },
      { models: ['bg-tree', 'sc-farm-tree'], count: 60, scale: [0.8, 1.2], band: [25, 300] },
    ],
    far: [
      { models: ['bg-skyline'], count: 9, radius: [2200, 2500], scale: [3.5, 4.5], faceCentre: true },
      { models: RANGE, count: 20, radius: [3200, 3600], scale: [5, 7], faceCentre: true },
    ],
    clouds: true,
  },
  country: {
    skyTop: '#3d88de', skyHorizon: '#d4ebff', skyGround: '#90b07a',
    fog: '#d3e6f2', fogNear: 1600, fogFar: 8500,
    sun: '#fff2d8', sunIntensity: 2.9, sunFrom: [-0.5, 0.75, 0.3],
    hemiSky: '#eef7ff', hemiGround: '#557a3a', hemiIntensity: 1.25,
    ground: 'ground-grass', groundTint: '#ffffff',
    props: { ...COMMON_PROPS, tree: ['sc-farm-tree', 'bg-tree'], windmill: ['sc-windpump'] },
    near: [
      { models: ['bg-tree', 'sc-farm-tree'], count: 110, scale: [0.8, 1.3], band: [25, 450] },
      { models: ['bg-treepatch'], count: 30, scale: [1.6, 2.4], band: [100, 600] },
      { models: ['sc-silo', 'sc-farmhouse', 'sc-barn', 'sc-windpump'], count: 14, scale: [1, 1.2], band: [60, 500] },
    ],
    far: [
      { models: ['bg-windfarm'], count: 9, radius: [1500, 2000], scale: [1.4, 1.7] },
      { models: ['bg-hill-a', 'bg-hill-b'], count: 30, radius: [2000, 2700], scale: [18, 26], sink: 0.05 },
      { models: RANGE, count: 26, radius: [2900, 3400], scale: [5, 7], faceCentre: true },
    ],
    clouds: true,
  },
};

/** Every model a scenery set can use (to load before building). */
export function styleModels(set: Scenery): string[] {
  const s = STYLES[set];
  const names = new Set<string>(['bg-clouds']);
  for (const l of Object.values(s.props)) for (const n of l ?? []) names.add(n);
  for (const i of [...s.near, ...s.far]) for (const n of i.models) names.add(n);
  return [...names];
}

/** A small deterministic random generator (mulberry32) so a track always looks the same. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash = (x: number, z: number) => ((x * 73856093) ^ (z * 19349663)) >>> 0;

const texLoader = new THREE.TextureLoader();
/** Each ground texture's average colour: the ground's colour until (or unless) the texture loads. */
const GROUND_AVERAGE: Record<string, string> = {
  'ground-arid': '#998670',
  'ground-generic-grass': '#526535',
  'ground-grass-lush': '#8a923f',
  'ground-grass': '#6e6f2c',
  'ground-sand': '#56544f',
  'ground-snow': '#e4ecf2',
};
/**
 * Put the set's ground texture on `mat` once it has loaded. Until then, and for good when the file is missing
 * (public/textures not built), the ground keeps its plain tint: a texture that never loads would draw black.
 */
function groundTexture(name: string, mat: THREE.MeshStandardMaterial, tint: string) {
  const plain = GROUND_AVERAGE[name];
  if (plain) mat.color.set(plain).multiply(new THREE.Color(tint));
  texLoader.load(
    `${import.meta.env.BASE_URL}textures/${name}.png`,
    (tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      mat.map = tex;
      mat.color.set(tint);
      mat.needsUpdate = true;
    },
    undefined,
    () => console.warn(`ground texture ${name}.png missing: plain ground`),
  );
}

/** The terrain material for a set (textured with the set's ground texture). */
export function groundMaterial(set: Scenery, textured = true): THREE.MeshStandardMaterial {
  const s = STYLES[set];
  const mat = new THREE.MeshStandardMaterial({
    color: s.groundTint,
    roughness: 0.95,
    metalness: 0,
    // Track decks lie exactly on the ground: push the ground back in depth so the road always wins.
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  });
  if (textured) groundTexture(s.ground, mat, s.groundTint);
  return mat;
}

/** The scenery set's skydome export (ssg.models.json `sky-<set>`: dome, silhouette ring and an equirect panorama). */
export const skyModelName = (set: Scenery) => `sky-${set}`;

/**
 * Without generator models (placeholder mode) the sky is a plain gradient sphere in the set's colours; with them it
 * is the set's skydome export (generatorSky).
 */
function gradientSky(s: SceneryStyle, radius: number): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color(s.skyTop) },
      horizon: { value: new THREE.Color(s.skyHorizon) },
      bottom: { value: new THREE.Color(s.skyGround) },
    },
    vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 c = h > 0.0 ? mix(horizon, top, pow(clamp(h * 2.2, 0.0, 1.0), 0.7)) : mix(horizon, bottom, clamp(-h * 6.0, 0.0, 1.0));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), mat);
  m.name = 'sky';
  m.frustumCulled = false;
  m.renderOrder = -1;
  return m;
}

interface SkydomeManifest {
  radius: number;
  colors: { zenith: string; horizon: string; ground: string; ring?: string };
  panorama: { file: string; width: number; height: number } | null;
}

/**
 * The skydome export, kept on the camera: the dome and its ring of silhouettes are unlit and carry their own haze,
 * so the scene's fog leaves them alone. Its panorama becomes the scene background (seen only where the dome is
 * clipped, e.g. by the top-down view's far-off near plane).
 */
function generatorSky(scene: THREE.Scene, m: LoadedModel): { sky: THREE.Object3D; horizon: THREE.Color } {
  const info = (m.manifest as unknown as { skydome: SkydomeManifest }).skydome;
  const sky = m.scene.clone(true);
  sky.name = 'sky';
  sky.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((mat) => {
      const c = mat.clone() as THREE.MeshBasicMaterial;
      c.fog = false;
      return c;
    });
    mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
  });
  if (info.panorama) {
    texLoader.load(`${import.meta.env.BASE_URL}models/${info.panorama.file}`, (tex) => {
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      scene.background = tex;
    });
  }
  return { sky, horizon: new THREE.Color(info.colors.horizon) };
}

export interface Atmosphere {
  sky: THREE.Object3D;
  sun: THREE.DirectionalLight;
  sunDir: THREE.Vector3;
  /** Keep the sky centred on the camera and the shadow box on `focus` (the car). */
  update(camera: THREE.Camera, focus: THREE.Vector3, shadowRadius?: number): void;
}

/**
 * Sky, fog and lights of a set, applied to the scene (whose lights createScene() made). With the set's skydome
 * export (`sky-<set>`) the fog takes the dome's horizon colour, so the ground fades into the sky.
 */
export function applyAtmosphere(scene: THREE.Scene, sun: THREE.DirectionalLight, set: Scenery, skyModel?: LoadedModel): Atmosphere {
  const s = STYLES[set];
  const gen = skyModel ? generatorSky(scene, skyModel) : null;
  scene.background = new THREE.Color(gen ? gen.horizon : s.skyHorizon);
  scene.fog = new THREE.Fog(gen ? gen.horizon : s.fog, s.fogNear, s.fogFar);
  const hemi = scene.children.find((c) => (c as THREE.HemisphereLight).isHemisphereLight) as THREE.HemisphereLight | undefined;
  if (hemi) {
    hemi.color.set(s.hemiSky);
    hemi.groundColor.set(s.hemiGround);
    hemi.intensity = s.hemiIntensity;
  }
  sun.color.set(s.sun);
  sun.intensity = s.sunIntensity;
  const sunDir = new THREE.Vector3(...s.sunFrom).normalize();
  const sky = gen ? gen.sky : gradientSky(s, 9000);
  scene.add(sky);
  let lastRadius = 0;
  return {
    sky,
    sun,
    sunDir,
    update(camera, focus, shadowRadius = 45) {
      sky.position.copy(camera.position);
      // The shadow box follows the focus, snapped to whole shadow-map texels so shadows don't shimmer.
      if (shadowRadius !== lastRadius) {
        const c = sun.shadow.camera;
        c.left = c.bottom = -shadowRadius;
        c.right = c.top = shadowRadius;
        c.near = 1;
        c.far = 600;
        c.updateProjectionMatrix();
        lastRadius = shadowRadius;
      }
      const texel = (2 * shadowRadius) / sun.shadow.mapSize.x;
      const snap = (v: number) => Math.round(v / texel) * texel;
      const f = new THREE.Vector3(snap(focus.x), snap(focus.y), snap(focus.z));
      sun.target.position.copy(f);
      sun.position.copy(f).addScaledVector(sunDir, 300);
      sun.target.updateMatrixWorld();
    },
  };
}

/** Ground height (m) at a tile's middle (mean of its corners). */
function tileGroundY(t: TrackFile, x: number, z: number) {
  const h = t.heights;
  return ((h[z][x] + h[z][x + 1] + h[z + 1][x] + h[z + 1][x + 1]) / 4) * HILL_M;
}

/** The track's scenery pieces as generator props, instanced per model. */
export function sceneryProps(t: TrackFile, models: Map<string, LoadedModel>): THREE.Group {
  const s = STYLES[t.scenery];
  const batch = new InstanceBatch();
  for (const p of t.pieces) {
    if (p.kind !== 'scenery') continue;
    placeProp(t, p, s, batch);
  }
  return batch.build(models, { name: 'scenery' });
}

function placeProp(t: TrackFile, p: Piece, s: SceneryStyle, batch: InstanceBatch) {
  const list = s.props[p.variant ?? ''] ?? s.props.tree!;
  const r = rng(hash(p.x, p.z));
  const name = list[Math.floor(r() * list.length)];
  const cx = (p.x + 0.5) * TILE_M;
  const cz = -(p.z + 0.5) * TILE_M;
  const y = tileGroundY(t, p.x, p.z);
  const natural = /tree|palm|pine|cactus/.test(name);
  // Buildings face the piece's rotation; plants get a random turn and size.
  const yaw = natural ? r() * Math.PI * 2 : -p.rot * (Math.PI / 2);
  const scale = natural ? 0.85 + r() * 0.35 : 1;
  batch.add(name, placement(cx, y, cz, yaw, scale));
}

const SIZE = GRID * TILE_M;
const CENTRE = new THREE.Vector2(SIZE / 2, -SIZE / 2);

/** The background: a band of props just outside the grid, a far ring, clouds. */
export function background(set: Scenery, models: Map<string, LoadedModel>, seed = 1): THREE.Group {
  const s = STYLES[set];
  const batch = new InstanceBatch();
  const r = rng(seed * 7919 + set.length);
  // Fewer props at low quality (src/engine/quality.ts).
  const keep = propScale();
  for (const item of s.near) {
    for (let i = 0; i < Math.round(item.count * keep); i++) {
      // A point in the band: pick a side, a position along it, and a distance out from the edge.
      const d = item.band[0] + r() * (item.band[1] - item.band[0]);
      const along = -item.band[1] + r() * (SIZE + 2 * item.band[1]);
      const side = Math.floor(r() * 4);
      const [x, z] = side === 0 ? [along, d + 0] : side === 1 ? [along, -SIZE - d] : side === 2 ? [-d, -along] : [SIZE + d, -along];
      const name = item.models[Math.floor(r() * item.models.length)];
      batch.add(name, placement(x, 0, z, r() * Math.PI * 2, item.scale[0] + r() * (item.scale[1] - item.scale[0])));
    }
  }
  for (const item of s.far) {
    const count = Math.max(1, Math.round(item.count * Math.sqrt(keep)));
    for (let i = 0; i < count; i++) {
      const a = ((i + r() * 0.6) / count) * Math.PI * 2;
      const rad = item.radius[0] + r() * (item.radius[1] - item.radius[0]);
      const x = CENTRE.x + Math.cos(a) * rad;
      const z = CENTRE.y + Math.sin(a) * rad;
      const name = item.models[Math.floor(r() * item.models.length)];
      const scale = item.scale[0] + r() * (item.scale[1] - item.scale[0]);
      const h = models.get(name)?.manifest.bounds.size[1] ?? 0;
      // Facing the centre: the model's +Z turns toward the grid.
      const yaw = item.faceCentre ? Math.atan2(CENTRE.x - x, CENTRE.y - z) : r() * Math.PI * 2;
      batch.add(name, placement(x, -(item.sink ?? 0) * h * scale, z, yaw, scale));
    }
  }
  const g = batch.build(models, { name: 'background', castShadow: false, receiveShadow: false });
  // Aerial perspective: the far ring takes on some of the haze colour (fog alone is too thin at 3 km).
  const farNames = new Set(s.far.flatMap((f) => f.models));
  const haze = new THREE.Color(s.fog);
  const hazed = new Map<THREE.Material, THREE.Material>();
  for (const child of g.children) {
    if (!farNames.has(child.name)) continue;
    child.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const src = mesh.material as THREE.MeshStandardMaterial;
      let m = hazed.get(src) as THREE.MeshStandardMaterial | undefined;
      if (!m) {
        m = src.clone();
        m.color = m.color.clone().lerp(haze, 0.35);
        m.emissive = haze.clone().multiplyScalar(0.25);
        hazed.set(src, m);
      }
      mesh.material = m;
    });
  }
  if (s.clouds && models.has('bg-clouds')) {
    const c = new InstanceBatch();
    c.add('bg-clouds', placement(CENTRE.x, 420, CENTRE.y, 0.7, 13));
    const cg = c.build(models, { castShadow: false, receiveShadow: false });
    cg.traverse((o) => {
      // Lit clouds go grey-green underneath (the hemisphere's ground colour): make them glow white.
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.material = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#b9c6d4', fog: false });
    });
    g.add(cg);
  }
  return g;
}

/** A ground plane around the grid (a square with the grid cut out), in the set's ground material. */
export function outerGround(material: THREE.Material, extent = 9000): THREE.Mesh {
  // Drawn in the xy plane with y = -world z, then laid flat (rotateX(-90°) maps y to -z, facing up).
  const shape = new THREE.Shape();
  const cx = CENTRE.x;
  const cy = -CENTRE.y;
  shape.moveTo(cx - extent, cy - extent);
  shape.lineTo(cx + extent, cy - extent);
  shape.lineTo(cx + extent, cy + extent);
  shape.lineTo(cx - extent, cy + extent);
  const hole = new THREE.Path();
  hole.moveTo(0, 0);
  hole.lineTo(0, SIZE);
  hole.lineTo(SIZE, SIZE);
  hole.lineTo(SIZE, 0);
  shape.holes.push(hole);
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / 24;
    uv[i * 2 + 1] = -pos.getZ(i) / 24;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, material);
  m.position.y = -0.14;
  m.name = 'outer-ground';
  m.receiveShadow = true;
  return m;
}
