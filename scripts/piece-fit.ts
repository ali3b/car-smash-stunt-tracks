// How well each drawn track piece (the generator's GLB, its collider and its visible mesh) follows the simulation's
// drivable surface (src/sim/track-surface.ts). For every piece the script shoots rays at the simulated surface along
// the car's path (down onto decks; outward from the centre in loops, pipes and the roll), finds where the ray meets
// the simulation's plane (without the road's +2 base: the wheels ride 0.12 m above the plane everywhere) and where
// it meets the model, and prints the gap in metres: positive = the drawn deck is beyond the simulated plane (the car
// floats above it), negative = the car sinks into it. MODELS=<dir> measures another export folder.
//
//   npx vite-node scripts/piece-fit.ts            every piece, a summary line each
//   npx vite-node scripts/piece-fit.ts -- loop -v the loop, with the gap at every sample
import { readFileSync, existsSync } from 'node:fs';
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { buildPiece } from '../src/track/build';
import { pieceDef, rotatedFootprint } from '../src/track/pieces';
import type { LoadedModel, ModelManifest } from '../src/models';
import type { Piece, TrackFile } from '../src/track/types';
import { UNIT_M } from '../src/track/types';
import { createTrackSurface } from '../src/sim/track-surface';
import { LOOP } from '../src/sim/track-geometry';

const U = UNIT_M;
const MODELS = process.env.MODELS ?? 'public/models';

// ---- GLB ---------------------------------------------------------------------------------------------------------

interface Gltf {
  nodes: { name?: string; children?: number[]; mesh?: number; translation?: number[]; rotation?: number[]; scale?: number[]; matrix?: number[] }[];
  meshes: { primitives: { attributes: Record<string, number>; indices?: number; mode?: number }[] }[];
  accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string; normalized?: boolean }[];
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number; extensions?: { EXT_meshopt_compression?: { buffer: number; byteOffset?: number; byteLength: number; byteStride: number; count: number; mode: string; filter?: string } } }[];
  scenes: { nodes: number[] }[];
  scene?: number;
}

async function loadGlb(file: string): Promise<{ visual: THREE.Mesh; collider: THREE.Mesh | null }> {
  await MeshoptDecoder.ready;
  const b = readFileSync(file);
  const jlen = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + jlen).toString('utf8')) as Gltf;
  const binStart = 20 + jlen + 8;
  const bin = b.subarray(binStart, binStart + b.readUInt32LE(20 + jlen));
  const views = new Map<number, Uint8Array>();
  const view = (i: number): Uint8Array => {
    const v = j.bufferViews[i];
    const ext = v.extensions?.EXT_meshopt_compression;
    if (!views.has(i)) {
      if (ext) {
        const out = new Uint8Array(ext.count * ext.byteStride);
        const src = bin.subarray(ext.byteOffset ?? 0, (ext.byteOffset ?? 0) + ext.byteLength);
        MeshoptDecoder.decodeGltfBuffer(out, ext.count, ext.byteStride, new Uint8Array(src), ext.mode, ext.filter ?? 'NONE');
        views.set(i, out);
      } else views.set(i, new Uint8Array(bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength)));
    }
    return views.get(i)!;
  };
  const SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const read = (ai: number): number[] => {
    const a = j.accessors[ai];
    const v = j.bufferViews[a.bufferView];
    const data = view(a.bufferView);
    const n = SIZE[a.type];
    const cs = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[a.componentType]!;
    const stride = v.extensions?.EXT_meshopt_compression?.byteStride ?? v.byteStride ?? n * cs;
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const out: number[] = [];
    for (let k = 0; k < a.count; k++)
      for (let c = 0; c < n; c++) {
        const o = (a.byteOffset ?? 0) + k * stride + c * cs;
        let x: number;
        switch (a.componentType) {
          case 5120: x = dv.getInt8(o); if (a.normalized) x = Math.max(x / 127, -1); break;
          case 5121: x = dv.getUint8(o); if (a.normalized) x /= 255; break;
          case 5122: x = dv.getInt16(o, true); if (a.normalized) x = Math.max(x / 32767, -1); break;
          case 5123: x = dv.getUint16(o, true); if (a.normalized) x /= 65535; break;
          case 5125: x = dv.getUint32(o, true); break;
          default: x = dv.getFloat32(o, true);
        }
        out.push(x);
      }
    return out;
  };
  const visual: number[] = [];
  const collider: number[] = [];
  const walk = (ni: number, parent: THREE.Matrix4, inCollider: boolean) => {
    const n = j.nodes[ni];
    const m = new THREE.Matrix4();
    if (n.matrix) m.fromArray(n.matrix);
    else m.compose(new THREE.Vector3(...((n.translation ?? [0, 0, 0]) as [number, number, number])), new THREE.Quaternion(...((n.rotation ?? [0, 0, 0, 1]) as [number, number, number, number])), new THREE.Vector3(...((n.scale ?? [1, 1, 1]) as [number, number, number])));
    const w = parent.clone().multiply(m);
    const col = inCollider || n.name === 'collider';
    if (n.mesh !== undefined)
      for (const p of j.meshes[n.mesh].primitives) {
        const pos = read(p.attributes.POSITION);
        const idx = p.indices !== undefined ? read(p.indices) : [...Array(pos.length / 3).keys()];
        const v = new THREE.Vector3();
        const out = col ? collider : visual;
        for (const i of idx) {
          v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(w);
          out.push(v.x, v.y, v.z);
        }
      }
    for (const c of n.children ?? []) walk(c, w, col);
  };
  for (const r of j.scenes[j.scene ?? 0].nodes) walk(r, new THREE.Matrix4(), false);
  const mesh = (a: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(a, 3));
    return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  };
  return { visual: mesh(visual), collider: collider.length ? mesh(collider) : null };
}

// ---- The simulated surface ----------------------------------------------------------------------------------------

const PX = 10;
const PZ = 10;
function trackWith(p: Piece): TrackFile {
  return {
    version: 1, name: 'fit', scenery: 'desert', pieces: [p],
    heights: Array.from({ length: 31 }, () => new Array(31).fill(0)),
    water: Array.from({ length: 30 }, () => new Array(30).fill(false)),
  };
}

/** A ray in the piece's own frame (sim units: lx east, y up, lz towards the exit) and what it is for. */
interface Ray { o: [number, number, number]; d: [number, number, number]; label: string; s: number }

interface Fit {
  label: string;
  s: number;
  sim: number | null;
  col: number | null;
  vis: number | null;
}

async function fitPiece(name: string, piece: Piece, rays: Ray[]): Promise<Fit[] | null> {
  const glb = `${MODELS}/${name}.glb`;
  if (!existsSync(glb)) return null;
  const manifest = JSON.parse(readFileSync(`${MODELS}/${name}.model.json`, 'utf8')) as ModelManifest;
  const { visual, collider } = await loadGlb(glb);
  const scene = new THREE.Group();
  scene.add(visual);
  if (collider) scene.add(collider);
  const t = trackWith(piece);
  const model: LoadedModel = { scene, clips: [], manifest };
  const { obj } = buildPiece(t, piece, new Map([[name, model]]));
  obj.updateMatrixWorld(true);
  const placed = obj.children[0];
  const [vis, col] = placed.children as THREE.Mesh[];
  const sampler = createTrackSurface(t);
  // The piece centre in world sim units.
  const [w, d] = rotatedFootprint(pieceDef(piece)!, piece.rot);
  const cx = PX * 1024 + (w === 2 ? 1024 : 512);
  const cz = PZ * 1024 + (d === 2 ? 1024 : 512);
  const toWorld = (lx: number, lz: number): [number, number] => {
    switch (piece.rot) {
      case 1: return [lz, -lx];
      case 2: return [-lx, -lz];
      case 3: return [-lz, lx];
      default: return [lx, lz];
    }
  };
  const ray = new THREE.Raycaster();
  const out: Fit[] = [];
  for (const r of rays) {
    const len = Math.hypot(...r.d);
    const dir = r.d.map((v) => v / len) as [number, number, number];
    // Simulation: march until the point's distance to its plane drops to 0 on a road sample.
    let sim: number | null = null;
    let prevD: number | null = null;
    const at = (t: number) => {
      const [wx, wz] = toWorld(r.o[0] + dir[0] * t, r.o[2] + dir[2] * t);
      return [cx + wx, r.o[1] + dir[1] * t, cz + wz] as const;
    };
    for (let tt = 0; tt < 1400; tt += 1) {
      const [x, y, z] = at(tt);
      const s = sampler.surfaceAt(x, y, z);
      const dist = s.code <= 3 ? sampler.distance(s, x, y + s.baseHeight, z) : null;
      if (dist !== null && dist <= 0 && prevD !== null && prevD > 0) {
        sim = tt - 1 + prevD / (prevD - dist);
        break;
      }
      prevD = dist;
    }
    // The model: the same ray in metres (x east, y up, -z north).
    const [wx, wz] = toWorld(r.o[0], r.o[2]);
    const o = new THREE.Vector3((cx + wx) * U, r.o[1] * U, -(cz + wz) * U);
    const [dx, dz] = toWorld(dir[0], dir[2]);
    ray.set(o, new THREE.Vector3(dx, dir[1], -dz).normalize());
    ray.far = 1400 * U;
    const hit = (m: THREE.Mesh | undefined) => {
      if (!m) return null;
      const h = ray.intersectObject(m, false);
      return h.length ? h[0].distance / U : null;
    };
    out.push({ label: r.label, s: r.s, sim, col: hit(col), vis: hit(vis) });
  }
  return out;
}

// ---- Rays per piece -----------------------------------------------------------------------------------------------

const down = (lx: number, lz: number, top: number, label: string, s: number): Ray => ({ o: [lx, top, lz], d: [0, -1, 0], label, s });

/** The loop: the approach, the 12 faces round the inside (from the loop's axis, at the lane's centre), the exit. */
function loopRays(): Ray[] {
  const rays: Ray[] = [];
  const { at: A, left: L, right: R } = LOOP.approach;
  const lerp = (t: readonly number[], v: number) => {
    let i = 0;
    while (A[i + 1] < v) i++;
    return t[i] + ((t[i + 1] - t[i]) * (v - A[i])) / (A[i + 1] - A[i]);
  };
  // Approach (south half, u = -lx): v = -lz from 1024 down to 0, the lane between L and R.
  for (let lz = -1000; lz <= -8; lz += 16) {
    const v = -lz;
    const u = (lerp(L, v) + lerp(R, v)) / 2;
    rays.push(down(-u, lz, 100, 'approach', lz));
  }
  // The loop: walk the section polygon, the lane's centre drifting with it.
  const P = LOOP.planeProfile;
  const C = LOOP.profileY[6] / 2;
  const LX = LOOP.laneX;
  let s = 0;
  for (const half of [1, -1]) {
    const order = half > 0 ? [0, 1, 2, 3, 4, 5] : [5, 4, 3, 2, 1, 0];
    for (const i of order) {
      const [z0, y0] = P[i];
      const [z1, y1] = P[i + 1];
      const segLen = Math.hypot(z1 - z0, y1 - y0);
      for (let k = 0; k < 8; k++) {
        const f = half > 0 ? (k + 0.5) / 8 : 1 - (k + 0.5) / 8;
        const z = (z0 + (z1 - z0) * f) * half;
        const y = y0 + (y1 - y0) * f;
        const edge = LX[i] + (LX[i + 1] - LX[i]) * f;
        const lx = half * (edge + 200);
        rays.push({ o: [lx, C, 0], d: [0, y - C, z], label: half > 0 ? 'up' : 'down', s: s + (k + 0.5) * segLen / 8 });
      }
      s += segLen;
    }
  }
  // Exit (north half, u = lx).
  for (let lz = 8; lz <= 1000; lz += 16) {
    const u = (lerp(L, lz) + lerp(R, lz)) / 2;
    rays.push(down(u, lz, 100, 'exit', lz));
  }
  return rays;
}

function straightRays(top: number, xs = [-100, 0, 100], half = 512): Ray[] {
  const out: Ray[] = [];
  for (const lx of xs) for (let lz = -half + 8; lz <= half - 8; lz += 16) out.push(down(lx, lz, top, `x${lx}`, lz));
  return out;
}

/** Outward from a pipe's axis (y = 117) at each depth, all round. */
function pipeRays(fromZ: number, toZ: number, step = 32): Ray[] {
  const out: Ray[] = [];
  for (let lz = fromZ; lz <= toZ; lz += step)
    for (let a = 0; a < 360; a += step < 64 ? 5 : 15) {
      const r = (a * Math.PI) / 180;
      out.push({ o: [0, 117, lz], d: [Math.sin(r), -Math.cos(r), 0], label: `a${a}`, s: lz });
    }
  return out;
}

function bankedCornerRays(): Ray[] {
  const out: Ray[] = [];
  for (const dr of [-90, 0, 90])
    for (let a = 2; a < 90; a += 2) {
      const r = (a * Math.PI) / 180;
      const R = 1536 + dr;
      out.push(down(-1024 + R * Math.cos(r), -1024 + R * Math.sin(r), 300, `r${dr}`, a));
    }
  return out;
}

function helixRays(left: boolean): Ray[] {
  const out: Ray[] = [];
  const sx = left ? -1 : 1;
  for (let lz = -1000; lz < 0; lz += 24) out.push(down(sx * 512, lz, 60, 'in', lz));
  // The turn: the circle of radius 512 round the block centre, from (u 512, lz 0) towards +lz and round, 5° steps,
  // each ray from just above the expected height (19 per 15° sector).
  for (let deg = 2.5; deg < 360; deg += 5) {
    const th = (deg * Math.PI) / 180;
    const u = 512 * Math.cos(th);
    const lz = 512 * Math.sin(th);
    const y = Math.min(450, (19 * deg) / 15);
    out.push(down(sx * u, lz, y + 60, 'turn', deg));
  }
  for (let lz = 8; lz < 1000; lz += 24) out.push(down(sx * 512, lz, 520, 'out', lz));
  return out;
}

/**
 * `nearest`: of the rays at one depth keep only the one where the model is nearest the axis (the drawn road's middle:
 * the roll's road is a flat strip turning round the axis while the simulation's faces are all round it).
 */
interface Case { name: string; piece: Omit<Piece, 'x' | 'z'>; rays: Ray[]; nearest?: boolean }

const CASES: Case[] = [
  { name: 'tp-straight', piece: { kind: 'straight', rot: 0 }, rays: straightRays(60) },
  { name: 'tp-loop', piece: { kind: 'loop', rot: 0 }, rays: loopRays() },
  { name: 'tp-ramp', piece: { kind: 'ramp', rot: 0 }, rays: straightRays(520) },
  { name: 'tp-ramp-solid', piece: { kind: 'ramp-solid', rot: 0 }, rays: straightRays(520) },
  { name: 'tp-bank-entry-a', piece: { kind: 'bank-entry', variant: 'a', rot: 0 }, rays: straightRays(200) },
  { name: 'tp-bank-entry-b', piece: { kind: 'bank-entry', variant: 'b', rot: 0 }, rays: straightRays(200) },
  { name: 'tp-banked', piece: { kind: 'banked', rot: 0 }, rays: straightRays(200) },
  { name: 'tp-banked-corner', piece: { kind: 'banked-corner', rot: 0 }, rays: bankedCornerRays() },
  { name: 'tp-pipe', piece: { kind: 'pipe', rot: 0 }, rays: pipeRays(-496, 496, 64) },
  { name: 'tp-pipe-entry', piece: { kind: 'pipe-entry', rot: 0 }, rays: [...straightRays(160, [-90, -60, -30, 0, 30, 60, 90])] },
  { name: 'tp-corkscrew-roll', piece: { kind: 'corkscrew-roll', rot: 0 }, rays: pipeRays(-1000, 1000, 40), nearest: true },
  { name: 'tp-corkscrew-helix-left', piece: { kind: 'corkscrew-helix', variant: 'left', rot: 0 }, rays: helixRays(true) },
  { name: 'tp-corkscrew-helix-right', piece: { kind: 'corkscrew-helix', variant: 'right', rot: 0 }, rays: helixRays(false) },
];

const args = process.argv.slice(2).filter((a) => a !== '--');
const verbose = args.includes('-v');
const only = args.filter((a) => !a.startsWith('-'));
const m = (v: number | null) => (v === null ? '   —  ' : (v * U).toFixed(2).padStart(6));
for (const c of CASES) {
  if (only.length && !only.some((o) => c.name.includes(o))) continue;
  let fits = await fitPiece(c.name, { ...c.piece, x: PX, z: PZ } as Piece, c.rays);
  if (!fits) {
    console.log(`${c.name}: no model`);
    continue;
  }
  if (c.nearest) {
    const best = new Map<number, Fit>();
    for (const f of fits) {
      const b = best.get(f.s);
      if (f.vis !== null && (!b || b.vis === null || f.vis < b.vis)) best.set(f.s, f);
    }
    fits = [...best.values()];
  }
  let maxC = 0;
  let maxV = 0;
  let where = '';
  let missing = 0;
  let both = 0;
  for (const f of fits) {
    if (f.sim === null) continue;
    if (f.vis === null) missing++;
    const gc = f.col !== null ? f.col - f.sim : null;
    const gv = f.vis !== null ? f.vis - f.sim : null;
    if (gv !== null) both++;
    if (gc !== null && Math.abs(gc) > Math.abs(maxC)) maxC = gc;
    if (gv !== null && Math.abs(gv) > Math.abs(maxV)) { maxV = gv; where = `${f.label} ${f.s.toFixed(0)}`; }
    if (verbose) console.log(`  ${f.label.padEnd(8)} ${f.s.toFixed(0).padStart(6)}  sim ${m(f.sim)}  collider ${m(gc)}  mesh ${m(gv)}`);
  }
  console.log(`${c.name.padEnd(26)} max gap: collider ${m(maxC)} m, mesh ${m(maxV)} m (at ${where}); ${both} rays fit, ${missing} with no mesh`);
}
