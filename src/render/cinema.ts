// The cinematic camera director for recorded footage (the capture scene, src/scenes/capture.ts; scripts/record.mjs).
// A take is a race that has already been simulated, so the director can look into the future: a track-side camera
// is put where the car *will* be (beside a jump's landing, under a loop) and waits for it, an aerial reveal flies a
// fixed path over the set, a chase camera lags behind and leans into loops. Every shot is a pure function of the take
// and the time, plus a little smoothing state that is reset whenever the shot changes.
import * as THREE from 'three';
import { HILL_M, TILE_M, type TrackFile } from '../track/types';

/** One car at one instant, as the director sees it. */
export interface CinemaCar {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  /** m/s. */
  speed: number;
  airborne: boolean;
  crashed: boolean;
  /** The driver's eye in the car's frame (CarView.eye). */
  eye?: THREE.Vector3;
}

/** Look-ups into the simulated take (time in sim seconds). */
export interface TakeTimeline {
  /** The car at time t (interpolated). */
  car(who: 'player' | 'rival', t: number): CinemaCar | null;
  readonly duration: number;
  readonly track: TrackFile;
}

export type Target = 'player' | 'rival' | 'both';
type V3 = [number, number, number];

/**
 * A shot. Distances in metres. `target` defaults to the player.
 *   chase     behind and above, lagging; leans with the car through loops (up vector follows it)
 *   cockpit   the driver's eye with the dashboard
 *   bumper    low on the nose, looking down the road (a racing-game hood cam)
 *   wheel     low on the car's flank by the rear wheel, looking forward along the body
 *   front     ahead of the car looking back at it (it chases the lens)
 *   side      tracking alongside at the car's speed
 *   heli      high and behind, following (a helicopter)
 *   trackside a fixed camera put where the car will be at time `at` (offset to the side / up / back along the road),
 *             panning with the car; `zoom` keeps it a constant size in frame; `ground` = s: the height is measured
 *             from the car's lowest point within ±s of `at` (under a loop, beside a jump) instead of from the car
 *   tv        the nearest track-side pole camera, cutting as the car passes (like the game's TV view)
 *   orbit     circles the car
 *   aerial    a straight flight from `from` to `to` (track-relative: x, z in tiles, y in metres) looking at `look`
 *             (or at the target car when `look` is absent)
 */
export type Shot =
  | { type: 'chase'; target?: Target; dist?: number; height?: number; fov?: number; lag?: number; side?: number }
  | { type: 'cockpit'; target?: Target; fov?: number }
  | { type: 'bumper'; target?: Target; fov?: number }
  | { type: 'wheel'; target?: Target; side?: number; fov?: number }
  | { type: 'front'; target?: Target; dist?: number; height?: number; fov?: number }
  | { type: 'side'; target?: Target; dist?: number; height?: number; fov?: number; lead?: number }
  | { type: 'heli'; target?: Target; dist?: number; height?: number; fov?: number }
  | { type: 'trackside'; target?: Target; at: number; side?: number; height?: number; back?: number; fov?: number; zoom?: number; ground?: number; span?: number }
  | { type: 'tv'; target?: Target }
  | { type: 'orbit'; target?: Target; radius?: number; height?: number; speed?: number; angle?: number; fov?: number }
  | { type: 'aerial'; from: V3; to: V3; look?: V3; target?: Target; fov?: number; ease?: boolean };

const UP = new THREE.Vector3(0, 1, 0);

/** Track-relative (x, z in tiles from the north-west corner, y in metres) to world metres. */
export function trackPoint(p: V3): THREE.Vector3 {
  return new THREE.Vector3(p[0] * TILE_M, p[1], -p[2] * TILE_M);
}

/** Track-side pole cameras (as the game's TV view places them, src/render/cameras.ts tvCameras). */
function poles(t: TrackFile): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const pieces = t.pieces.filter((p) => p.kind !== 'scenery');
  const taken = new Set<string>();
  for (const [i, p] of pieces.entries()) {
    if (i % 3 !== 0) continue;
    const key = `${Math.floor(p.x / 2)},${Math.floor(p.z / 2)}`;
    if (taken.has(key)) continue;
    taken.add(key);
    const side = i % 2 ? 1 : -1;
    const across = p.rot % 2 ? new THREE.Vector3(0, 0, side) : new THREE.Vector3(side, 0, 0);
    const h = Math.max(t.heights[p.z][p.x], t.heights[p.z][p.x + 1], t.heights[p.z + 1][p.x], t.heights[p.z + 1][p.x + 1]) * HILL_M;
    const near = t.pieces.some((q) => q.kind !== 'scenery' && Math.abs(q.x - p.x) <= 1 && Math.abs(q.z - p.z) <= 1 && /elevated|ramp|loop|corkscrew|helix|pipe/.test(q.kind));
    const y = Math.max(h, near ? HILL_M : 0) + (near ? 14 : 11);
    out.push(new THREE.Vector3((p.x + 0.5) * TILE_M, y, -(p.z + 0.5) * TILE_M).addScaledVector(across, 30));
  }
  return out;
}

export class Director {
  readonly camera: THREE.PerspectiveCamera;
  private key = '';
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private fresh = true;
  private tvAt: THREE.Vector3 | null = null;
  private tvSince = 0;
  private readonly poles: THREE.Vector3[];

  /** Set by the scene: true when something solid is between two points (keeps track-side cameras in the clear). */
  occluded: ((a: THREE.Vector3, b: THREE.Vector3) => boolean) | null = null;

  constructor(private take: TakeTimeline) {
    this.camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.3, 20000);
    this.poles = poles(take.track);
  }

  /**
   * Turn the camera's up vector part of the way (k) toward `to` by rotation, not by blending: after a barrel roll
   * the two can point opposite ways, and a blend would pass through zero and flip the horizon.
   */
  private turnUp(to: THREE.Vector3, k: number) {
    const q = new THREE.Quaternion().setFromUnitVectors(this.up.clone().normalize(), to.clone().normalize());
    this.up.applyQuaternion(new THREE.Quaternion().slerp(q, k)).normalize();
  }

  /** The point a shot looks at (the target car, or the middle of both). */
  private subject(target: Target | undefined, t: number): CinemaCar {
    const p = this.take.car('player', t)!;
    if (target === 'rival') return this.take.car('rival', t) ?? p;
    if (target === 'both') {
      const r = this.take.car('rival', t);
      if (!r) return p;
      return { ...p, pos: p.pos.clone().lerp(r.pos, 0.5) };
    }
    return p;
  }

  /**
   * Place the camera for `shot` at take time t; dt = take seconds since the last frame of this shot (for the lag).
   * u = 0..1 through the shot (aerial flights). `cockpit` in the result: the in-car view (body hidden, dashboard on).
   */
  frame(shot: Shot, t: number, dt: number, u = 0): { cockpit: boolean; focus: THREE.Vector3; wide: boolean; target: 'player' | 'rival' } {
    const key = JSON.stringify(shot);
    if (key !== this.key) {
      this.key = key;
      this.fresh = true;
      this.tvAt = null;
    }
    const cam = this.camera;
    const car = this.subject(shot.target, t);
    const q = car.quat;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const carUp = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    // The car's right in the world (the model's +X is its left).
    const right = new THREE.Vector3(-1, 0, 0).applyQuaternion(q);
    // A level heading for shots that should not roll with the car.
    const flatFwd = new THREE.Vector3(fwd.x, 0, fwd.z);
    if (flatFwd.lengthSq() < 1e-4) flatFwd.set(0, 0, 1);
    flatFwd.normalize();
    const flatRight = new THREE.Vector3().crossVectors(flatFwd, UP).normalize();
    const smooth = (rate: number) => (this.fresh ? 1 : 1 - Math.exp(-dt * rate));
    let cockpit = false;
    let wide = false;
    cam.near = 0.3;
    switch (shot.type) {
      case 'chase': {
        const want = car.pos.clone().addScaledVector(fwd, -(shot.dist ?? 11)).addScaledVector(carUp, shot.height ?? 3.2).addScaledVector(right, shot.side ?? 0);
        const look = car.pos.clone().addScaledVector(fwd, 6).addScaledVector(carUp, 1.2);
        const lag = shot.lag ?? 7;
        this.pos.lerp(want, smooth(lag));
        this.look.lerp(look, smooth(14));
        this.turnUp(car.crashed ? UP : carUp, smooth(3));
        cam.position.copy(this.pos);
        cam.up.copy(this.up);
        cam.lookAt(this.look);
        cam.fov = shot.fov ?? 62;
        break;
      }
      case 'cockpit':
        cockpit = true;
        cam.position.copy(car.eye ?? new THREE.Vector3(0, 1.05, -0.3)).applyQuaternion(q).add(car.pos);
        cam.up.copy(carUp);
        cam.lookAt(cam.position.clone().addScaledVector(fwd, 10).addScaledVector(carUp, -0.4));
        cam.fov = shot.fov ?? 70;
        cam.near = 0.08;
        break;
      case 'bumper':
        cam.position.copy(car.pos).addScaledVector(fwd, 2.4).addScaledVector(carUp, 0.55);
        cam.up.copy(carUp);
        cam.lookAt(cam.position.clone().addScaledVector(fwd, 10).addScaledVector(carUp, -0.2));
        cam.fov = shot.fov ?? 72;
        cam.near = 0.1;
        break;
      case 'wheel': {
        const s = shot.side ?? 1;
        cam.position.copy(car.pos).addScaledVector(right, 1.45 * s).addScaledVector(fwd, -2.2).addScaledVector(carUp, 0.45);
        cam.up.copy(carUp);
        cam.lookAt(car.pos.clone().addScaledVector(fwd, 14).addScaledVector(right, 0.9 * s).addScaledVector(carUp, 0.6));
        cam.fov = shot.fov ?? 64;
        cam.near = 0.1;
        break;
      }
      case 'front': {
        const want = car.pos.clone().addScaledVector(fwd, shot.dist ?? 9).addScaledVector(carUp, shot.height ?? 1.4);
        this.pos.lerp(want, smooth(10));
        this.turnUp(carUp, smooth(4));
        cam.position.copy(this.pos);
        cam.up.copy(this.up);
        cam.lookAt(car.pos.clone().addScaledVector(carUp, 0.9));
        cam.fov = shot.fov ?? 50;
        break;
      }
      case 'side': {
        const want = car.pos.clone().addScaledVector(flatRight, shot.dist ?? 7).addScaledVector(UP, shot.height ?? 1.2).addScaledVector(flatFwd, shot.lead ?? 1.5);
        this.pos.lerp(want, smooth(8));
        cam.position.copy(this.pos);
        cam.up.copy(UP);
        cam.lookAt(car.pos.clone().addScaledVector(UP, 0.8));
        cam.fov = shot.fov ?? 50;
        break;
      }
      case 'heli': {
        const want = car.pos.clone().addScaledVector(flatFwd, -(shot.dist ?? 40)).addScaledVector(UP, shot.height ?? 28);
        this.pos.lerp(want, smooth(2.5));
        this.look.lerp(car.pos, smooth(8));
        cam.position.copy(this.pos);
        cam.up.copy(UP);
        cam.lookAt(this.look);
        cam.fov = shot.fov ?? 45;
        wide = true;
        break;
      }
      case 'trackside': {
        if (this.fresh) {
          // Where the target will be at `at`, and the road's direction there.
          const there = this.subject(shot.target, shot.at);
          const f = new THREE.Vector3(0, 0, 1).applyQuaternion(there.quat);
          f.y = 0;
          if (f.lengthSq() < 1e-4) f.set(0, 0, 1);
          f.normalize();
          const r = new THREE.Vector3().crossVectors(f, UP).normalize();
          const side = shot.side ?? 9;
          const h = shot.height ?? 1.2;
          let low = Infinity;
          if (shot.ground !== undefined) for (let k = -1; k <= 1; k += 0.05) low = Math.min(low, this.subject(shot.target, shot.at + k * shot.ground).pos.y);
          const place = (sd: number, hh: number) => {
            const p = there.pos.clone().addScaledVector(r, sd).addScaledVector(UP, hh).addScaledVector(f, -(shot.back ?? 0));
            if (shot.ground !== undefined) p.y = low + hh;
            return p;
          };
          // The asked-for spot, or the nearest variation with a clear view of the car around `at` (not inside a
          // pier, under a deck or behind a loop's wall).
          const tries: [number, number][] = [[side, h], [side, h + 4], [-side, h], [-side, h + 4], [side * 1.4, h + 8], [-side * 1.4, h + 8], [side, h + 14], [-side, h + 14]];
          const span = shot.span ?? 1.2;
          let best = place(side, h);
          if (this.occluded)
            for (const [sd, hh] of tries) {
              const p = place(sd, hh);
              let ok = true;
              for (const k of [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1]) {
                const c = this.subject(shot.target, shot.at + k * span).pos.clone().add(new THREE.Vector3(0, 0.8, 0));
                if (this.occluded(p, c)) {
                  ok = false;
                  break;
                }
              }
              if (ok) {
                best = p;
                break;
              }
            }
          this.pos.copy(best);
        }
        cam.position.copy(this.pos);
        cam.up.copy(UP);
        const aim = car.pos.clone().addScaledVector(carUp, 0.8);
        this.look.lerp(aim, smooth(18));
        cam.lookAt(this.look);
        if (shot.zoom) {
          const d = cam.position.distanceTo(car.pos);
          cam.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(shot.zoom / Math.max(d, 1))), 6, shot.fov ?? 60);
        } else cam.fov = shot.fov ?? 55;
        break;
      }
      case 'tv': {
        this.tvSince += dt;
        let best: THREE.Vector3 | null = null;
        let bestD = Infinity;
        for (const c of this.poles) {
          const d = c.distanceTo(car.pos);
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
        const cur = this.tvAt ? this.tvAt.distanceTo(car.pos) : Infinity;
        if (best && (!this.tvAt || (cur > bestD * 1.6 && this.tvSince > 1.5) || cur > 220)) {
          this.tvAt = best;
          this.tvSince = 0;
        }
        const at = this.tvAt ?? car.pos.clone().add(new THREE.Vector3(0, 30, 0));
        cam.position.copy(at);
        cam.up.copy(UP);
        cam.lookAt(car.pos.x, car.pos.y + 1, car.pos.z);
        cam.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(9 / Math.max(at.distanceTo(car.pos), 1))), 6, 55);
        break;
      }
      case 'orbit': {
        const a = (shot.angle ?? 0) + t * (shot.speed ?? 0.35);
        const r = shot.radius ?? 12;
        cam.position.set(car.pos.x + Math.cos(a) * r, car.pos.y + (shot.height ?? 3), car.pos.z + Math.sin(a) * r);
        cam.up.copy(UP);
        cam.lookAt(car.pos.x, car.pos.y + 0.8, car.pos.z);
        cam.fov = shot.fov ?? 45;
        break;
      }
      case 'aerial': {
        const k = THREE.MathUtils.clamp(u, 0, 1);
        const e = shot.ease === false ? k : k * k * (3 - 2 * k);
        const a = trackPoint(shot.from);
        const b = trackPoint(shot.to);
        cam.position.copy(a).lerp(b, e);
        cam.up.copy(UP);
        cam.lookAt(shot.look ? trackPoint(shot.look) : car.pos);
        cam.fov = shot.fov ?? 50;
        wide = true;
        break;
      }
    }
    this.fresh = false;
    cam.updateProjectionMatrix();
    return { cockpit, focus: shot.type === 'aerial' && shot.look ? trackPoint(shot.look) : car.pos.clone(), wide, target: shot.target === 'rival' ? 'rival' : 'player' };
  }
}
