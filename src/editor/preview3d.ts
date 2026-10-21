// The editor's live 3D preview: the track built by src/track/build.ts (generator track-piece models placed by their
// sockets, placeholders where a kind has none), orbit camera. Only pieces that changed are rebuilt: each piece's
// object is cached under its fields plus the corner heights around it; the terrain is rebuilt when heights, water
// or scenery change.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createScene } from '../engine/renderer';
import { loadModel, modelIndex, type LoadedModel } from '../models';
import { buildGround, buildPiece } from '../track/build';
import { GRID, HILL_M, TILE_M, type Piece, type TrackFile } from '../track/types';
import { pieceSize } from '../track/validate';

const SKY: Record<TrackFile['scenery'], string> = {
  desert: '#e9c99a',
  tropical: '#86c5e8',
  alpine: '#b9cfe4',
  city: '#9fb3c8',
  country: '#8fb8de',
};

export class Preview3D {
  readonly renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private ground: THREE.Object3D | null = null;
  private groundKey = '';
  private pieces = new Map<string, THREE.Object3D>();
  private models = new Map<string, LoadedModel>();
  private highlight: THREE.Mesh;
  private dirty = true;
  private pending: TrackFile | null = null;
  private timer = 0;
  /** Pieces built in the last update (the check script reads it). */
  stats = { built: 0, reused: 0, models: 0 };

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    const { scene, sun } = createScene();
    sun.castShadow = false;
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(40, 1, 5, 12000);
    const half = (GRID * TILE_M) / 2;
    this.camera.position.set(half + half * 0.15, half * 1.25, half * 0.55);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(half, 0, -half);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.minDistance = 40;
    this.controls.maxDistance = half * 5;
    this.controls.addEventListener('change', () => (this.dirty = true));
    this.highlight = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.25, depthWrite: false }),
    );
    this.highlight.visible = false;
    this.scene.add(this.highlight);
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    const frame = () => {
      requestAnimationFrame(frame);
      if (this.controls.update()) this.dirty = true;
      if (!this.dirty) return;
      this.dirty = false;
      this.renderer.render(this.scene, this.camera);
    };
    requestAnimationFrame(frame);
  }

  /** Load every track-piece model; the preview draws placeholders until they arrive, then rebuilds. */
  async loadModels(): Promise<number> {
    const index = await modelIndex();
    const names = Object.keys(index?.models ?? {}).filter((n) => n.startsWith('tp-'));
    await Promise.all(
      names.map(async (n) => {
        const m = await loadModel(n);
        if (m) this.models.set(n, m);
      }),
    );
    this.stats.models = this.models.size;
    for (const o of this.pieces.values()) this.scene.remove(o);
    this.pieces.clear();
    if (this.pending) this.flush();
    return this.models.size;
  }

  private resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  /** Rebuild what changed, soon (edits arrive in bursts while dragging). */
  update(t: TrackFile, now = false) {
    this.pending = t;
    clearTimeout(this.timer);
    if (now) this.flush();
    else this.timer = window.setTimeout(() => this.flush(), 120);
  }

  private flush() {
    const t = this.pending;
    if (!t) return;
    const gk = JSON.stringify([t.heights, t.water, t.scenery]);
    if (gk !== this.groundKey) {
      if (this.ground) this.scene.remove(this.ground);
      this.ground = buildGround(t);
      this.scene.add(this.ground);
      this.groundKey = gk;
      (this.scene.background as THREE.Color).set(SKY[t.scenery]);
    }
    const keep = new Map<string, THREE.Object3D>();
    let built = 0;
    let reused = 0;
    for (const p of t.pieces) {
      const k = pieceKey(t, p);
      let o = this.pieces.get(k) ?? keep.get(k);
      if (o) reused++;
      else {
        o = buildPiece(t, p, this.models).obj;
        this.scene.add(o);
        built++;
      }
      keep.set(k, o);
    }
    for (const [k, o] of this.pieces) if (!keep.has(k)) this.scene.remove(o);
    this.pieces = keep;
    this.stats.built = built;
    this.stats.reused = reused;
    this.dirty = true;
  }

  /** Outline a footprint (the selection), or hide it. */
  setHighlight(p: Piece | null) {
    if (!p) {
      this.highlight.visible = false;
    } else {
      const [w, d] = pieceSize(p);
      this.highlight.visible = true;
      this.highlight.scale.set(w * TILE_M, HILL_M * 1.6, d * TILE_M);
      this.highlight.position.set((p.x + w / 2) * TILE_M, (HILL_M * 1.6) / 2, -(p.z + d / 2) * TILE_M);
    }
    this.dirty = true;
  }

  /** Swing the camera to look at a tile. */
  focus(x: number, z: number) {
    const target = new THREE.Vector3((x + 0.5) * TILE_M, 0, -(z + 0.5) * TILE_M);
    const offset = this.camera.position.clone().sub(this.controls.target).setLength(TILE_M * 6);
    this.controls.target.copy(target);
    this.camera.position.copy(target).add(offset);
    this.dirty = true;
  }

  /** Frame the pieces of a track (the whole map when it has none). */
  overview(t?: TrackFile) {
    let [x0, z0, x1, z1] = [0, 0, GRID, GRID];
    if (t?.pieces.length) {
      [x0, z0, x1, z1] = [GRID, GRID, 0, 0];
      for (const p of t.pieces) {
        const [w, d] = pieceSize(p);
        [x0, z0, x1, z1] = [Math.min(x0, p.x), Math.min(z0, p.z), Math.max(x1, p.x + w), Math.max(z1, p.z + d)];
      }
    }
    const span = Math.max(6, x1 - x0, z1 - z0) * TILE_M;
    const target = new THREE.Vector3(((x0 + x1) / 2) * TILE_M, 0, (-(z0 + z1) / 2) * TILE_M);
    this.controls.target.copy(target);
    this.camera.position.copy(target).add(new THREE.Vector3(0.12, 0.9, 0.75).setLength(span * 1.25));
    this.dirty = true;
  }
}

/** A piece's cache key: its fields and the corner heights under and around it (placement follows the terrain). */
function pieceKey(t: TrackFile, p: Piece): string {
  const [w, d] = pieceSize(p);
  const h: number[] = [];
  for (let z = p.z; z <= p.z + d; z++) for (let x = p.x; x <= p.x + w; x++) h.push(t.heights[z]?.[x] ?? 0);
  return `${p.kind}|${p.variant ?? ''}|${p.surface ?? ''}|${p.x},${p.z},${p.rot}|${h.join('')}`;
}
