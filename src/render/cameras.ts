// Cameras for a car: chase (behind and above, lagging), in-car (the driver's eye, with our own dashboard overlay:
// CS-FB-005, the Synty cars have no dashboard part), and TV (fixed track-side cameras that cut from one to the next
// as the car passes, zooming to keep it framed). `next()` cycles them (the C key in the replay scene).
import * as THREE from 'three';
import type { CarView } from './car-view';
import { Dashboard } from './dashboard';
import { HILL_M, TILE_M, type TrackFile } from '../track/types';

export type CameraMode = 'chase' | 'cockpit' | 'tv' | 'orbit';
export const CAMERA_MODES: CameraMode[] = ['chase', 'cockpit', 'tv'];

export interface TvCam {
  position: THREE.Vector3;
}

/** Track-side camera spots: beside every few road pieces, up on a pole, alternating sides. */
export function tvCameras(t: TrackFile): TvCam[] {
  const cams: TvCam[] = [];
  const pieces = t.pieces.filter((p) => p.kind !== 'scenery');
  const taken = new Set<string>();
  for (const [i, p] of pieces.entries()) {
    if (i % 3 !== 0) continue;
    const key = `${Math.floor(p.x / 2)},${Math.floor(p.z / 2)}`;
    if (taken.has(key)) continue;
    taken.add(key);
    const side = i % 2 ? 1 : -1;
    // Off the road axis: road runs S→N at rot 0/2, E→W at rot 1/3; step across it by ~22 m.
    const across = p.rot % 2 ? new THREE.Vector3(0, 0, side) : new THREE.Vector3(side, 0, 0);
    const h = Math.max(...[t.heights[p.z][p.x], t.heights[p.z][p.x + 1], t.heights[p.z + 1][p.x], t.heights[p.z + 1][p.x + 1]]) * HILL_M;
    // Above any elevated deck nearby, so pillars and decks don't block the view.
    const near = t.pieces.some((q) => q.kind !== 'scenery' && Math.abs(q.x - p.x) <= 1 && Math.abs(q.z - p.z) <= 1 && /elevated|ramp|loop|corkscrew|helix|pipe/.test(q.kind));
    const y = Math.max(h, near ? HILL_M : 0) + (near ? 14 : 11);
    cams.push({ position: new THREE.Vector3((p.x + 0.5) * TILE_M, y, -(p.z + 0.5) * TILE_M).addScaledVector(across, 30) });
  }
  return cams;
}

/** How far the chase camera keeps off a wall it would otherwise go through (m). */
const CAMERA_CLEARANCE = 0.9;
/** Pieces the chase camera stays inside: their instanced meshes under the world's `pieces` group (track/build.ts). */
const ENCLOSED = /^tp-(loop|pipe|pipe-entry|corkscrew-roll|tunnel)$/;

export function wallsOf(world: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  world.traverse((o) => {
    if (ENCLOSED.test(o.name) && o.parent?.name === 'pieces') out.push(o);
  });
  return out;
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'chase';
  readonly dashboard: Dashboard;
  private chasePos = new THREE.Vector3();
  private chaseLook = new THREE.Vector3();
  private chaseUp = new THREE.Vector3(0, 1, 0);
  private snap = true;
  private tv: TvCam | null = null;
  private tvSince = 0;
  private orbitT = 0;
  private walls: THREE.Object3D[] = [];
  private ray = new THREE.Raycaster();

  /**
   * The world's enclosed pieces (loops, pipes, corkscrews, tunnels: wallsOf). Behind the car on a curve the chase
   * camera would sit outside the tube; it pulls in towards the car instead of looking through the wall.
   */
  setWalls(world: THREE.Object3D) {
    this.walls = wallsOf(world);
  }

  constructor(
    private readonly tvCams: TvCam[],
    parent: HTMLElement,
  ) {
    this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.5, 20000);
    this.dashboard = new Dashboard(parent);
  }

  setMode(mode: CameraMode, car?: CarView) {
    this.mode = mode;
    this.snap = true;
    this.tv = null;
    car?.setInterior(mode === 'cockpit');
    this.dashboard.visible = mode === 'cockpit';
  }

  next(car?: CarView) {
    this.setMode(CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length], car);
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  update(car: CarView, dt: number, info: { speedMph: number; rpm: number; maxRpm?: number; gear?: number }) {
    const cam = this.camera;
    const obj = car.object;
    obj.updateMatrixWorld();
    const q = obj.quaternion;
    const pos = obj.position;
    if (this.mode === 'chase') {
      // Behind and above in the car's frame; the camera lags (exponential smoothing), the up vector follows the car
      // through loops but only slowly, so a crash tumble doesn't spin the view.
      const want = new THREE.Vector3(0, 3.6, -13).applyQuaternion(q).add(pos);
      const look = new THREE.Vector3(0, 1.4, 6).applyQuaternion(q).add(pos);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      const k = this.snap ? 1 : 1 - Math.exp(-dt * 6);
      this.chasePos.lerp(want, this.snap ? 1 : k);
      this.chaseLook.lerp(look, this.snap ? 1 : 1 - Math.exp(-dt * 12));
      this.chaseUp.lerp(up, this.snap ? 1 : 1 - Math.exp(-dt * 2.5)).normalize();
      this.snap = false;
      cam.position.copy(this.chasePos);
      this.keepInside(cam.position, new THREE.Vector3(0, 1.4, 0).applyQuaternion(q).add(pos));
      cam.up.copy(this.chaseUp);
      cam.lookAt(this.chaseLook);
      cam.fov = 60;
      cam.near = 0.5;
    } else if (this.mode === 'cockpit') {
      cam.position.copy(car.eye).applyQuaternion(q).add(pos);
      cam.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
      // Look a touch down the road.
      cam.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.04));
      cam.up.set(0, 1, 0).applyQuaternion(q);
      cam.fov = 68;
      cam.near = 0.08;
    } else if (this.mode === 'orbit') {
      // A slow circle round the car (menus, attract mode, the finish).
      this.orbitT += dt * 0.25;
      cam.position.set(pos.x + Math.cos(this.orbitT) * 14, pos.y + 4, pos.z + Math.sin(this.orbitT) * 14);
      cam.up.set(0, 1, 0);
      cam.lookAt(pos.x, pos.y + 0.8, pos.z);
      cam.fov = 45;
      cam.near = 0.5;
    } else {
      // TV: the nearest track-side camera; cut when another one is much closer (and this one has been on ≥ 2 s).
      this.tvSince += dt;
      let best: TvCam | null = null;
      let bestD = Infinity;
      for (const c of this.tvCams) {
        const d = c.position.distanceTo(pos);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      const cur = this.tv ? this.tv.position.distanceTo(pos) : Infinity;
      if (best && (!this.tv || (cur > bestD * 1.6 && this.tvSince > 2) || cur > 260)) {
        this.tv = best;
        this.tvSince = 0;
      }
      const at = this.tv?.position ?? new THREE.Vector3(0, 30, 0).add(pos);
      const d = at.distanceTo(pos);
      cam.position.copy(at);
      cam.up.set(0, 1, 0);
      cam.lookAt(pos.x, pos.y + 1, pos.z);
      // Zoom so the car fills about a fifth of the frame height, within a broadcast lens's range.
      cam.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(16 / Math.max(d, 1))), 8, 55);
      cam.near = 0.5;
    }
    cam.updateProjectionMatrix();
    this.dashboard.update(info.speedMph, info.rpm, info.maxRpm ?? 8000, info.gear);
  }

  /** Move `camPos` in along the line from `from` (on the car) when a loop / pipe wall is in between. */
  private keepInside(camPos: THREE.Vector3, from: THREE.Vector3) {
    if (!this.walls.length) return;
    const dir = camPos.clone().sub(from);
    const dist = dir.length();
    if (dist < 0.5) return;
    dir.divideScalar(dist);
    this.ray.set(from, dir);
    this.ray.far = dist + CAMERA_CLEARANCE;
    const hit = this.ray.intersectObjects(this.walls, true)[0];
    if (hit) camPos.copy(from).addScaledVector(dir, Math.max(hit.distance - CAMERA_CLEARANCE, 1.2));
  }

  /** Name of the current mode and, for TV, the camera index (HUD and tests). */
  describe() {
    return this.mode === 'tv' && this.tv ? `tv ${this.tvCams.indexOf(this.tv) + 1}/${this.tvCams.length}` : this.mode;
  }
}
