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
import { withVariant, type DashboardGauge, type LoadedModel } from '../models';

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

/** What a needle of the car's own dashboard reads. */
export interface Instruments {
  speedMph: number;
  rpm: number;
  /** 0..1 (the boost gauge follows the throttle and the revs). */
  boost: number;
}

/**
 * The dials' scales (the manifest gives each needle's pivot, axis and rest direction but not what its dial prints:
 * calibrated by eye against the dial faces). `at`: [value, clockwise turn from the needle's rest direction (rad)]
 * pairs, in rising order; the needle stops at the ends.
 */
interface DialScale {
  reads: keyof Instruments;
  at: [number, number][];
}
const DIALS: { needle: RegExp; scale: DialScale }[] = [
  // Street Racer: two round dials whose needles rest at 9 o'clock, with a scale of six 45° steps from 7:30 round to
  // 4:30 (no figures printed): the outer one (Speedometer_02, its Needle_02) reads 0–180 mph, the inner one
  // (Speedometer_03, Needle_01) 0–8000 rpm. The boost gauge's needle rests at 12 and its red arc runs 8 to 4 o'clock.
  { needle: /Speedometer_Needle_02$/, scale: { reads: 'speedMph', at: [[0, -Math.PI / 4], [180, (5 * Math.PI) / 4]] } },
  { needle: /Speedometer_Needle_01$/, scale: { reads: 'rpm', at: [[0, -Math.PI / 4], [8000, (5 * Math.PI) / 4]] } },
  { needle: /BoostGauge_Needle$/, scale: { reads: 'boost', at: [[0, -2.1], [1, 2.1]] } },
];

interface Needle {
  node: THREE.Object3D;
  rest: THREE.Quaternion;
  /** The turn axis in the node's parent frame. */
  axis: THREE.Vector3;
  scale: DialScale;
  value: number;
  gauge: DashboardGauge;
}

/** The needle's clockwise turn (rad) for `v` on its dial. */
function dialAngle(s: DialScale, v: number): number {
  const at = s.at;
  if (v <= at[0][0]) return at[0][1];
  for (let i = 1; i < at.length; i++) {
    if (v <= at[i][0]) return at[i - 1][1] + ((v - at[i - 1][0]) / (at[i][0] - at[i - 1][0])) * (at[i][1] - at[i - 1][1]);
  }
  return at[at.length - 1][1];
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

/**
 * Wheel travel (m) of the drawn suspension: how far a wheel may drop below its rest place to reach the road, or rise
 * into the body. The simulation steps at 20 Hz and moves the car as a rigid box: over the loop's 30° corners a
 * rest-placed wheel would float up to 0.63 m above the deck or sink 0.56 m into it for a step or two (no deck shape
 * can be under both the front and the rear wheel there, QA-07), and it squats the car on its springs over the top of
 * the loop. A wheel farther from the road than this (the car hopping, e.g. into a bank entry's twist) stays at rest.
 */
const TRAVEL_DOWN = 0.7;
const TRAVEL_UP = 0.6;

export class CarView {
  /** Placed at the state (axle centre); holds the wheels and the body. */
  readonly object = new THREE.Group();
  /** The body: leans and bobs on the suspension. */
  readonly body = new THREE.Group();
  readonly scale: number;
  /** The driver's eye in the car's frame (metres, scaled). */
  readonly eye = new THREE.Vector3(0, 1.1, -0.2);
  readonly length: number;
  /** The car's box in its own frame (metres, scaled; at rest): the chase camera keeps out of other cars. */
  readonly bounds: THREE.Box3;
  private wheels: Wheel[] = [];
  /** The road the wheels reach for (the track pieces), or none: wheels stay at rest. */
  private ground: THREE.Object3D[] = [];
  private readonly ray = new THREE.Raycaster();
  private steeringWheel: { node: THREE.Object3D; base: THREE.Quaternion } | null = null;
  private needles: Needle[] = [];
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
    // The car's own instruments (CS-FB-023): needles turned about their manifest axis, which is in the model's frame.
    for (const gauge of model.manifest.dashboard?.gauges ?? []) {
      const n = gauge.needle;
      const node = n && scene.getObjectByName(n.node);
      const dial = n && DIALS.find((d) => d.needle.test(n.node));
      if (!n || !node || !dial) continue;
      const toParent = node.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(scene.getWorldQuaternion(new THREE.Quaternion()));
      this.needles.push({ node, rest: node.quaternion.clone(), axis: new THREE.Vector3(...n.axis).applyQuaternion(toParent).normalize(), scale: dial.scale, value: 0, gauge });
    }
    this.setInstruments({ speedMph: 0, rpm: 0, boost: 0 }, 0);
    // Eye: above the seat, a little behind the steering wheel. No seat part → the middle of the cabin.
    let seat: THREE.Object3D | undefined;
    scene.traverse((o) => {
      if (!seat && /_seat/i.test(o.name)) seat = o;
    });
    const bb = new THREE.Box3().setFromObject(scene);
    this.bounds = bb.clone();
    if (seat) {
      const box = new THREE.Box3().setFromObject(seat);
      const p = box.getCenter(new THREE.Vector3());
      this.eye.set(p.x, p.y + 0.55 * this.scale, p.z + 0.05 * this.scale);
      // Both front seats in one part (Street Racer): sit on the steering wheel's side, not in the middle.
      if (this.steeringWheel && box.max.x - box.min.x > 0.9 * this.scale) {
        this.eye.x = new THREE.Box3().setFromObject(this.steeringWheel.node).getCenter(new THREE.Vector3()).x;
        // A little higher (still under the roof lining), so more of the dials shows over the rim of the wheel.
        this.eye.y += 0.03 * this.scale;
      }
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

  /** True when the car has its own speedometer needle (the in-car view then drives it instead of our overlay). */
  get hasGauges(): boolean {
    return this.needles.some((n) => n.scale.reads === 'speedMph');
  }

  /** World position of the speedometer's dial (checks: a close-up of the instruments). */
  gaugeCentre(): THREE.Vector3 | null {
    const g = this.needles.find((n) => n.scale.reads === 'speedMph')?.gauge;
    if (!g) return null;
    this.object.updateMatrixWorld(true);
    const scene = this.body.children[0];
    return scene.localToWorld(new THREE.Vector3(...g.center));
  }

  /** Turn the car's own needles to these readings; they follow with a little inertia (frame-rate independent). */
  setInstruments(v: Instruments, dt: number) {
    const k = 1 - Math.exp(-dt * 18);
    const q = new THREE.Quaternion();
    for (const n of this.needles) {
      n.value += (v[n.scale.reads] - n.value) * k;
      n.node.quaternion.copy(n.rest).premultiply(q.setFromAxisAngle(n.axis, dialAngle(n.scale, n.value)));
    }
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

  private fade = 1;
  private fadeMats: THREE.Material[] | null = null;

  /**
   * Opacity of the whole car (1 = solid): a car the camera is inside fades out instead of showing its insides
   * (cameras.ts). The materials are made this car's own the first time.
   */
  setFade(a: number) {
    if (Math.abs(a - this.fade) < 0.01 && (a === 1) === (this.fade === 1)) return;
    this.fade = a;
    if (!this.fadeMats) {
      if (a >= 1) return;
      const own = new Map<THREE.Material, THREE.Material>();
      const mine = (m: THREE.Material) => own.get(m) ?? own.set(m, m.clone()).get(m)!;
      this.object.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.material = Array.isArray(mesh.material) ? mesh.material.map(mine) : mine(mesh.material);
      });
      this.fadeMats = [...own.values()];
      for (const m of this.fadeMats) m.userData.base = { transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite };
    }
    for (const m of this.fadeMats) {
      const base = m.userData.base as { transparent: boolean; opacity: number; depthWrite: boolean };
      const transparent = a < 1 || base.transparent;
      if (transparent !== m.transparent) m.needsUpdate = true;
      m.transparent = transparent;
      m.opacity = base.opacity * a;
      m.depthWrite = a >= 1 && base.depthWrite;
    }
    this.object.visible = a > 0.02;
  }

  /** Hide the body for the in-car view (wheels stay visible); the steering wheel and seat stay too. */
  setInterior(on: boolean) {
    // A car with its own instruments has a modelled cabin round them (dash, pillars, roof lining): it stays whole.
    const cabin = this.hasGauges;
    this.body.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      // (Its tinted glass goes, though: from inside it greys the whole view.)
      const keep = (cabin && !/glass/i.test(o.name + (o.parent?.name ?? ''))) || /steer|seat|dash|gear|cage|rollcage|ebrake/i.test(o.name) || /steer|seat|cage/i.test(o.parent?.name ?? '');
      o.visible = !on || keep;
    });
  }

  /** How far each wheel has moved from its rest place to reach the road (m, + down; checks). */
  wheelTravel(): number[] {
    return this.wheels.map((w) => w.basePos.y - w.node.position.y);
  }

  /** The objects the drawn wheels stand on (race-view: the track pieces). */
  setGround(objects: THREE.Object3D[]) {
    this.ground = objects;
  }

  /** Each wheel drops or rises (within its travel) to the road under it, along the car's down axis. */
  private placeWheels() {
    if (!this.ground.length) return;
    this.object.updateMatrixWorld(true);
    const down = new THREE.Vector3(0, -1, 0).applyQuaternion(this.object.quaternion);
    const from = new THREE.Vector3();
    for (const w of this.wheels) {
      from.copy(w.basePos).applyMatrix4(this.object.matrixWorld).addScaledVector(down, -TRAVEL_UP);
      this.ray.set(from, down);
      this.ray.far = TRAVEL_UP + w.radius + TRAVEL_DOWN;
      const hit = this.ray.intersectObjects(this.ground, true)[0];
      // How far the wheel sits above the road at rest (negative: into it); the wheel moves by that much.
      const gap = hit ? hit.distance - TRAVEL_UP - w.radius : 0;
      w.node.position.copy(w.basePos);
      w.node.position.y -= THREE.MathUtils.clamp(gap, -TRAVEL_UP, TRAVEL_DOWN);
    }
  }

  update(s: CarState, dt: number) {
    this.object.position.copy(s.position);
    this.object.quaternion.copy(s.quaternion);
    this.placeWheels();
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
