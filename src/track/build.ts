// Builds a track's 3D scene: the terrain, and the pieces. The terrain of a bundled track is the generator's grid export
// (render/terrain.ts, CS-FB-003); a track without one (the editor's live preview, a custom or imported track) gets a
// heightfield built here from the corner heights, with water. Pieces are the generator's track-piece models
// (ssg.models.json `tp-*`), placed by their sockets (pieces.ts). A kind without a model is drawn as placeholder
// geometry (CS-FB-001): a flat road slab and a coloured marker.
import * as THREE from 'three';
import type { LoadedModel } from '../models';
import { InstanceBatch } from '../render/instancing';
import { endFrame, isVariant, pieceDef, placedEnd } from './pieces';
import { GRID, HILL_M, ROAD_M, TILE_M, type Piece, type PieceKind, type TrackFile } from './types';
import { rampDeckOnSlope } from './validate';

/** Footprint in tiles (w along x, d along z) before rotation. */
const FOOTPRINT: Partial<Record<PieceKind, [number, number]>> = {
  'corner-large': [2, 2],
  'banked-corner': [2, 2],
  'elevated-corner': [2, 2],
  chicane: [2, 2],
  'split-large': [2, 2],
  'corkscrew-helix': [2, 2],
  loop: [1, 2],
  'corkscrew-roll': [1, 2],
};

const ELEVATED: ReadonlySet<PieceKind> = new Set(['elevated', 'elevated-solid', 'elevated-span', 'elevated-span-over-road', 'elevated-corner']);
const STUNT_COLOUR: Partial<Record<PieceKind, string>> = {
  loop: '#e53935',
  'corkscrew-roll': '#8e24aa',
  'corkscrew-helix': '#8e24aa',
  pipe: '#1e88e5',
  'pipe-entry': '#42a5f5',
  'pipe-obstacle': '#90caf9',
  ramp: '#fb8c00',
  'ramp-solid': '#fb8c00',
  'ramp-bridge': '#ffa726',
  banked: '#43a047',
  'bank-entry': '#66bb6a',
  'banked-corner': '#43a047',
  tunnel: '#6d4c41',
  slalom: '#fdd835',
  chicane: '#00897b',
  highway: '#546e7a',
  'highway-entry': '#78909c',
  'start-finish': '#ffffff',
};

export function footprint(p: Piece): [number, number] {
  const [w, d] = FOOTPRINT[p.kind] ?? [1, 1];
  return p.rot % 2 ? [d, w] : [w, d];
}

/** Ground height in metres at a grid corner. */
const cornerY = (t: TrackFile, x: number, z: number) => t.heights[z][x] * HILL_M;

/**
 * The drawn terrain sits this far below the true ground, so road decks lying exactly on it (y = ground) never
 * z-fight with it (polygon offset alone loses on steep slopes and on SwiftShader).
 */
export const GROUND_DROP = 0.12;
/** Ground texture repeat: one texture tile per this many metres. */
const GROUND_UV_M = 24;

/**
 * CS-FB-003 (what is left): the generator exports terrain ahead of time, so a track that is edited live or was never
 * declared in ssg.models.json has no export, and gets this heightfield instead. `paletteUv`: draw it in one swatch
 * of a generator terrain's palette material (the scenery set's apron), instead of a tiled ground texture.
 */
function terrainMesh(t: TrackFile, material: THREE.Material, paletteUv?: [number, number]): THREE.Mesh {
  // One quad per tile; x east, z north → three.js -Z is north, so world z = -tile z.
  const pos: number[] = [];
  for (let z = 0; z < GRID; z++)
    for (let x = 0; x < GRID; x++) {
      const v = (cx: number, cz: number) => [cx * TILE_M, cornerY(t, cx, cz) - GROUND_DROP, -cz * TILE_M];
      const a = v(x, z), b = v(x + 1, z), c = v(x + 1, z + 1), d = v(x, z + 1);
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const uv: number[] = [];
  for (let i = 0; i < pos.length; i += 3) uv.push(...(paletteUv ?? [pos[i] / GROUND_UV_M, -pos[i + 2] / GROUND_UV_M]));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.name = 'terrain';
  m.receiveShadow = true;
  return m;
}

/** CS-FB-003: the water of the game-side heightfield. */
function waterMesh(t: TrackFile): THREE.Mesh | null {
  const pos: number[] = [];
  const y = 0.3;
  for (let z = 0; z < GRID; z++)
    for (let x = 0; x < GRID; x++) {
      const w = t.water[z][x];
      if (!w) continue;
      const c = { SW: [x, z], SE: [x + 1, z], NE: [x + 1, z + 1], NW: [x, z + 1] } as const;
      const p = (k: keyof typeof c) => [c[k][0] * TILE_M, y, -c[k][1] * TILE_M];
      if (w === true) pos.push(...p('SW'), ...p('SE'), ...p('NE'), ...p('SW'), ...p('NE'), ...p('NW'));
      else {
        // Coast: water fills the triangle opposite the dry corner.
        const order = ['SW', 'SE', 'NE', 'NW'] as const;
        const tri = order.filter((k) => k !== w);
        pos.push(...p(tri[0]), ...p(tri[1]), ...p(tri[2]));
      }
    }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#2f6fa8', side: THREE.DoubleSide }));
}

/** CS-FB-001: placeholder geometry for one piece until the generator exports track pieces. */
function placeholderPiece(t: TrackFile, p: Piece): THREE.Object3D {
  const [w, d] = footprint(p);
  const g = new THREE.Group();
  const cx = (p.x + w / 2) * TILE_M;
  const cz = -(p.z + d / 2) * TILE_M;
  const ground = Math.max(cornerY(t, p.x, p.z), cornerY(t, p.x + w, p.z), cornerY(t, p.x, p.z + d), cornerY(t, p.x + w, p.z + d));
  const y = ELEVATED.has(p.kind) ? HILL_M : ground;
  if (p.kind === 'scenery') {
    const m = new THREE.Mesh(new THREE.BoxGeometry(8, 12, 8), new THREE.MeshStandardMaterial({ color: '#7cb342' }));
    m.position.set(cx, y + 6, cz);
    g.add(m);
    return g;
  }
  // The road runs along the piece's natural axis (south↔north), rotated by rot quarter turns.
  const along = p.rot % 2 ? w : d;
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(ROAD_M, 0.6, along * TILE_M),
    new THREE.MeshStandardMaterial({ color: p.surface === 'dirt' ? '#8d6e4a' : p.surface === 'ice' ? '#dfefff' : '#3a3a3e' }),
  );
  deck.rotation.y = -p.rot * (Math.PI / 2);
  deck.position.set(cx, y + 0.3, cz);
  deck.receiveShadow = true;
  g.add(deck);
  const colour = STUNT_COLOUR[p.kind];
  if (colour) {
    const marker = new THREE.Mesh(new THREE.BoxGeometry(ROAD_M * 0.8, 6, ROAD_M * 0.8), new THREE.MeshStandardMaterial({ color: colour }));
    marker.position.set(cx, y + 3.3, cz);
    marker.castShadow = true;
    g.add(marker);
  }
  if (ELEVATED.has(p.kind) && ground < y) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(3, y - ground, 3), new THREE.MeshStandardMaterial({ color: '#9e9e9e' }));
    pillar.position.set(cx, ground + (y - ground) / 2, cz);
    g.add(pillar);
  }
  g.userData.piece = p;
  return g;
}

const GROUND: Record<TrackFile['scenery'], string> = {
  desert: '#c8a46a',
  tropical: '#5c9e4a',
  alpine: '#e8eef2',
  city: '#6f7f5a',
  country: '#6a9a45',
};

/** The ssg.models.json name drawing a piece; kinds that share a model map to it. */
export function modelName(p: Piece): string {
  const SHARED: Partial<Record<PieceKind, string>> = {
    'start-finish': 'straight',
    slalom: 'straight',
    'ramp-bridge': 'ramp',
    'elevated-solid': 'elevated',
    'elevated-span': 'elevated',
    'elevated-span-over-road': 'elevated',
    'pipe-obstacle': 'pipe',
  };
  const base = SHARED[p.kind] ?? p.kind;
  const v = isVariant(p) && !SHARED[p.kind] ? `-${p.variant}` : '';
  return `tp-${base}${v}`;
}

/** Ground height (m) at the middle of a tile side. */
function sideGroundY(t: TrackFile, x: number, z: number, side: 'N' | 'E' | 'S' | 'W'): number {
  const c = { S: [[x, z], [x + 1, z]], N: [[x, z + 1], [x + 1, z + 1]], W: [[x, z], [x, z + 1]], E: [[x + 1, z], [x + 1, z + 1]] }[side];
  return (cornerY(t, c[0][0], c[0][1]) + cornerY(t, c[1][0], c[1][1])) / 2;
}

export interface PlacementIssue {
  piece: Piece;
  model: string;
  /** Distance (m) between the model's out socket and the catalogue's exit point. */
  error: number;
}

/**
 * Place a track-piece model: its `in` socket on the entry end, facing into the piece; returns the distance between
 * its `out` socket and the catalogue's exit end (0 when the catalogue and the model agree).
 */
function placeModel(t: TrackFile, p: Piece, m: LoadedModel, path = 0): { obj: THREE.Object3D; error: number; reversed: boolean } {
  const def = pieceDef(p)!;
  let [entry, exit] = def.paths[path].map((e) => placedEnd(def, p, e));
  let a = endFrame(entry, sideGroundY(t, entry.x, entry.z, entry.side));
  let b = endFrame(exit, sideGroundY(t, exit.x, exit.z, exit.side));
  // A plain road on a hill slope climbs with the terrain: drive it uphill so the slope model fits.
  const reversed = b.pos[1] < a.pos[1] - 1;
  if (reversed) {
    [entry, exit] = [exit, entry];
    [a, b] = [b, a];
  }
  // Only the transform is needed: buildTrack draws every copy of a model as one instanced mesh.
  const obj = new THREE.Object3D();
  // The model's +Z (forward at its `in` socket) turns onto the inward direction at the entry, and the `in` socket
  // (not the model origin: an elevated piece's socket is up on the deck) lands on the entry point.
  obj.rotation.y = Math.atan2(a.inward[0], a.inward[2]);
  obj.updateMatrixWorld(true);
  const sock = (name: string) => m.manifest.sockets?.find((s) => s.name === name);
  const inS = sock('in');
  const inW = inS ? new THREE.Vector3(...inS.pos).applyMatrix4(obj.matrixWorld) : new THREE.Vector3();
  // A banked end's socket is the middle of the tilted deck, lifted above the ground by the bank (the low edge stays
  // on the ground, as in the simulation): keep that lift instead of putting the socket on the ground.
  const lift = inS && inS.edge?.startsWith('banked') ? inS.pos[1] : 0; // CS-FB-130
  obj.position.set(a.pos[0] - inW.x, a.pos[1] - inW.y + lift, a.pos[2] - inW.z);
  obj.updateMatrixWorld(true);
  const out = sock('out');
  let error = 0;
  if (out) {
    // Horizontal distance: a banked deck's centre sits above the catalogue's ground point by design.
    const w = new THREE.Vector3(...out.pos).applyMatrix4(obj.matrixWorld);
    error = Math.hypot(w.x - b.pos[0], w.z - b.pos[2]);
  }
  obj.userData.piece = p;
  return { obj, error, reversed };
}

/** Pieces whose entry and exit are both ground level but whose tile climbs a hill slope use a slope model. */
function slopeModel(t: TrackFile, p: Piece): string | null {
  const def = pieceDef(p);
  if (!def?.paths.length || p.kind !== 'straight') return null;
  const [entry, exit] = def.paths[0].map((e) => placedEnd(def, p, e));
  const ya = sideGroundY(t, entry.x, entry.z, entry.side);
  const yb = sideGroundY(t, exit.x, exit.z, exit.side);
  return Math.abs(ya - yb) > 1 ? 'tp-straight-slope' : null;
}

export interface BuildOptions {
  /** The generator terrain, placed (render/terrain.ts); without it the game-side heightfield (buildGround). */
  terrain?: THREE.Object3D;
  /** The game-side heightfield's material (render/scenery.ts gives a textured one per scenery set). */
  ground?: THREE.Material;
  /** With `ground` a generator palette material: the swatch to draw the heightfield in (render/terrain.ts). */
  groundUv?: [number, number];
  /** Leave scenery pieces out (render/scenery.ts draws them as props). */
  skipScenery?: boolean;
}

/** The default terrain material: a flat colour per scenery set, pushed back in depth under the road decks. */
function flatGround(t: TrackFile): THREE.Material {
  return new THREE.MeshStandardMaterial({ color: GROUND[t.scenery], flatShading: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 4 });
}

/**
 * The game-side terrain and water of a track (CS-FB-003: tracks without a generator export; the editor's preview
 * rebuilds these apart from the pieces).
 */
export function buildGround(t: TrackFile, material: THREE.Material = flatGround(t), paletteUv?: [number, number]): THREE.Group {
  const g = new THREE.Group();
  g.name = 'ground';
  g.add(terrainMesh(t, material, paletteUv));
  const w = waterMesh(t);
  if (w) g.add(w);
  return g;
}

/** Where a piece's generator models go: model name + placement matrix (null: no model, draw a placeholder). */
function piecePlacements(t: TrackFile, p: Piece, models: Map<string, LoadedModel>): { parts: { name: string; matrix: THREE.Matrix4 }[]; issue?: PlacementIssue } | null {
  // A ramp laid down a hill slope from the top is a level deck carried from the hill top (as the simulation has it).
  const name = slopeModel(t, p) ?? (rampDeckOnSlope(t, p) ? 'tp-elevated' : modelName(p));
  const m = models.get(name);
  if (!m || !pieceDef(p)?.paths.length) return null;
  const { obj, error } = placeModel(t, p, m);
  const parts = [{ name, matrix: obj.matrixWorld.clone() }];
  // CS-FB-014: the span model draws only the deck, so lay a straight along the road under it too.
  const under = models.get('tp-straight');
  if (p.kind === 'elevated-span-over-road' && under) parts.push({ name: 'tp-straight', matrix: placeModel(t, p, under, 1).obj.matrixWorld.clone() });
  return { parts, issue: error > 0.5 ? { piece: p, model: name, error } : undefined };
}

/** One piece, as a generator model placed by its sockets or as placeholder geometry (the editor's preview). */
export function buildPiece(t: TrackFile, p: Piece, models: Map<string, LoadedModel> = new Map()): { obj: THREE.Object3D; issue?: PlacementIssue } {
  const placed = piecePlacements(t, p, models);
  if (!placed) return { obj: placeholderPiece(t, p) };
  const g = new THREE.Group();
  for (const { name, matrix } of placed.parts) {
    const obj = models.get(name)!.scene.clone(true);
    matrix.decompose(obj.position, obj.quaternion, obj.scale);
    obj.traverse((o) => {
      if (o.name === 'collider') o.visible = false;
    });
    g.add(obj);
  }
  g.userData.piece = p;
  return { obj: g, issue: placed.issue };
}

/** The whole track: ground, and every piece (copies of one model drawn as one instanced mesh). */
export function buildTrack(t: TrackFile, models: Map<string, LoadedModel> = new Map(), opts: BuildOptions = {}): { root: THREE.Group; issues: PlacementIssue[] } {
  const root = new THREE.Group();
  root.name = `track:${t.name}`;
  root.add(opts.terrain ?? buildGround(t, opts.ground, opts.groundUv));
  const issues: PlacementIssue[] = [];
  const batch = new InstanceBatch();
  for (const p of t.pieces) {
    if (p.kind === 'scenery' && opts.skipScenery) continue;
    const placed = piecePlacements(t, p, models);
    if (!placed) {
      root.add(placeholderPiece(t, p));
      continue;
    }
    if (placed.issue) issues.push(placed.issue);
    for (const { name, matrix } of placed.parts) batch.add(name, matrix);
  }
  root.add(batch.build(models, { name: 'pieces' }));
  return { root, issues };
}
