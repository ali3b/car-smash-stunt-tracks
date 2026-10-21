// A car on screen: a generator car model (ssg.models.json car-*) in a paint variant, posed from a state (position,
// orientation, speed, steering), with wheels that spin and steer and a body that leans on simple suspension.
//
// Size: the original's cars are 100 track units long (collision half-length 50 = 6.1 m) with a 58-unit wheelbase
// (3.5 m) on a 240-unit (14.6 m) road, i.e. the whole world is ~1.4× real size. The Synty cars are fitted to real
// lengths (4.1–4.8 m) in ssg.models.json, so CarView scales every car uniformly to CAR_LENGTH_M; the wheel radius,
// the cockpit eye point and the wheel positions scale with it.
//
// State convention (world metres; x east, y up, −z north): `position` is the axle centre (the model's origin,
// `origin: "axle-centre"`), `quaternion` turns the model's +Z (forward) / +Y (up) into the car's frame.
import * as THREE from 'three';
import { withVariant, type LoadedModel } from '../models';

export const CAR_LENGTH_M = 6.1;

export interface CarState {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  /** Forward speed, m/s (negative in reverse). */
  speed: number;
  /** Front-wheel steering angle, radians; positive turns left. */
  steer: number;
  /** Engine rpm (dashboard only). */
  rpm?: number;
}

interface Wheel {
  node: THREE.Object3D;
  base: THREE.Quaternion;
  basePos: THREE.Vector3;
  radius: number;
  steer: boolean;
  axle: THREE.Vector3;
  spin: number;
}

const UP = new THREE.Vector3(0, 1, 0);

export class CarView {
  /** Placed at the state (axle centre); holds the wheels and the body. */
  readonly object = new THREE.Group();
  /** The body: leans and bobs on the suspension. */
  readonly body = new THREE.Group();
  readonly scale: number;
  /** The driver's eye in the car's frame (metres, scaled). */
  readonly eye = new THREE.Vector3(0, 1.1, -0.2);
  readonly length: number;
  private wheels: Wheel[] = [];
  private steeringWheel: { node: THREE.Object3D; base: THREE.Quaternion } | null = null;
  private lastSpeed = 0;
  private lastYaw = 0;
  private pitch = 0;
  private roll = 0;
  private pitchV = 0;
  private rollV = 0;
  private first = true;

  private constructor(model: LoadedModel, readonly name: string) {
    const size = model.manifest.bounds.size;
    this.scale = CAR_LENGTH_M / size[2];
    this.length = CAR_LENGTH_M;
    const scene = model.scene;
    scene.scale.setScalar(this.scale);
    this.body.add(scene);
    this.object.add(this.body);
    this.object.name = `car:${name}`;
    scene.updateMatrixWorld(true);
    // Wheels leave the body (so it can lean over them) and hang off the car root, keeping their place.
    const w = model.manifest.wheels ?? {};
    for (const key of ['fl', 'fr', 'rl', 'rr'] as const) {
      const info = w[key];
      if (!info) continue;
      const node = scene.getObjectByName(info.node);
      if (!node) continue;
      this.object.attach(node);
      this.wheels.push({
        node,
        base: node.quaternion.clone(),
        basePos: node.position.clone(),
        radius: info.radius * this.scale,
        steer: info.steer,
        axle: new THREE.Vector3(...info.axle).normalize(),
        spin: 0,
      });
    }
    // CS-FB-009: steering wheels have role "wheel" on some cars, so find them by name.
    scene.traverse((o) => {
      if (!this.steeringWheel && /steer/i.test(o.name)) this.steeringWheel = { node: o, base: o.quaternion.clone() };
    });
    // Eye: above the seat, a little behind the steering wheel. No seat part → the middle of the cabin.
    let seat: THREE.Object3D | undefined;
    scene.traverse((o) => {
      if (!seat && /_seat/i.test(o.name)) seat = o;
    });
    const bb = new THREE.Box3().setFromObject(scene);
    if (seat) {
      const p = new THREE.Box3().setFromObject(seat).getCenter(new THREE.Vector3());
      this.eye.set(p.x, p.y + 0.55 * this.scale, p.z + 0.05 * this.scale);
    } else {
      this.eye.set(0, bb.min.y + (bb.max.y - bb.min.y) * 0.72, bb.min.z + (bb.max.z - bb.min.z) * 0.45);
    }
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  }

  /** A car from a loaded model in paint `variant` (KHR_materials_variants; ignored when the car has none). */
  static async create(model: LoadedModel, variant?: string): Promise<CarView> {
    const m = variant ? await withVariant(model, variant) : model;
    const copy = m === model ? { ...model, scene: model.scene.clone(true) } : m;
    return new CarView(copy, model.manifest.name);
  }

  /** The wheel radius after scaling (m). */
  get wheelRadius() {
    return this.wheels[0]?.radius ?? 0.45;
  }

  /** Each wheel's centre in world space and its radius (checks: wheels touching the road). */
  wheelCentres() {
    this.object.updateMatrixWorld(true);
    return this.wheels.map((w) => ({ centre: new THREE.Box3().setFromObject(w.node).getCenter(new THREE.Vector3()), radius: w.radius }));
  }

  /** Forget the motion history (the car was put somewhere else: a reset after a crash, a replay seek). */
  reset() {
    this.first = true;
    this.pitch = this.roll = this.pitchV = this.rollV = 0;
    this.body.rotation.set(0, 0, 0);
  }

  /** Hide the body for the in-car view (wheels stay visible); the steering wheel and seat stay too. */
  setInterior(on: boolean) {
    this.body.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      const keep = /steer|seat|dash|gear|cage|rollcage|ebrake/i.test(o.name) || /steer|seat|cage/i.test(o.parent?.name ?? '');
      o.visible = !on || keep;
    });
  }

  update(s: CarState, dt: number) {
    this.object.position.copy(s.position);
    this.object.quaternion.copy(s.quaternion);
    // Wheels: spin by the distance rolled, front ones steer about the car's up axis.
    const q = new THREE.Quaternion();
    const qs = new THREE.Quaternion();
    for (const w of this.wheels) {
      w.spin = (w.spin + (s.speed * dt) / w.radius) % (Math.PI * 2);
      q.setFromAxisAngle(UP, w.steer ? s.steer : 0);
      qs.setFromAxisAngle(w.axle, w.spin);
      // Both turns are about car-frame axes (the manifest's axle is in the model's frame), applied over the rest pose.
      w.node.quaternion.copy(q).multiply(qs).multiply(w.base);
    }
    if (this.steeringWheel) {
      // Turn the rim about its own forward axis (CS-FB-009: the part's axis isn't in the manifest), ×6 for the ratio.
      const sw = this.steeringWheel;
      sw.node.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -s.steer * 6).multiply(sw.base);
    }
    // Suspension: the body pitches with longitudinal and rolls with lateral acceleration (damped springs).
    if (dt > 0) {
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(s.quaternion);
      const yaw = Math.atan2(fwd.x, fwd.z);
      if (this.first) {
        this.lastSpeed = s.speed;
        this.lastYaw = yaw;
        this.first = false;
      }
      const accel = THREE.MathUtils.clamp((s.speed - this.lastSpeed) / dt, -30, 30);
      let dyaw = yaw - this.lastYaw;
      if (dyaw > Math.PI) dyaw -= Math.PI * 2;
      if (dyaw < -Math.PI) dyaw += Math.PI * 2;
      const lateral = THREE.MathUtils.clamp((dyaw / dt) * s.speed, -40, 40);
      this.lastSpeed = s.speed;
      this.lastYaw = yaw;
      const targetPitch = -accel * 0.004;
      const targetRoll = lateral * 0.0035;
      const k = 120;
      const c = 2 * Math.sqrt(k) * 0.7;
      // Semi-implicit Euler in steps of at most 1/120 s: one long frame (a hitch, a slow machine) used to make the
      // spring blow up and stand the body on its nose. A frame longer than 0.1 s only advances 0.1 s.
      const n = Math.ceil(Math.min(dt, 0.1) * 120);
      const h = Math.min(dt, 0.1) / n;
      for (let i = 0; i < n; i++) {
        this.pitchV += (k * (targetPitch - this.pitch) - c * this.pitchV) * h;
        this.pitch += this.pitchV * h;
        this.rollV += (k * (targetRoll - this.roll) - c * this.rollV) * h;
        this.roll += this.rollV * h;
      }
      const lim = 0.14;
      this.pitch = THREE.MathUtils.clamp(this.pitch, -lim, lim);
      this.roll = THREE.MathUtils.clamp(this.roll, -lim, lim);
      this.body.rotation.set(this.pitch, 0, this.roll);
    }
  }
}
