// The race view (RaceView, src/game/types.ts): the full track world (render/world.ts: pieces, scenery set, track-side,
// background, sky), generator cars on CarView (wheels, suspension, paint) and the camera rig (chase, in-car with the
// dashboard, TV, orbit). Registered with the game flow on import (main.ts); without generator models the flow keeps
// the stub view (src/game/stub-view.ts).
import * as THREE from 'three';
import { createScene } from '../engine/renderer';
import { retro } from '../engine/retro';
import { hasModels, loadModel, modelIndex } from '../models';
import { registerView } from '../game/integrations';
import { opponentInfo } from '../game/catalog';
import { StubRaceView } from '../game/stub-view';
import type { CameraMode, CarState as SimCar, RaceSetup, RaceSnapshot, RaceView } from '../game/types';
import { CameraRig, tvCameras } from './cameras';
import { CarView, type CarState } from './car-view';
import { updateLods } from './instancing';
import { TurnEase } from './turn-ease';
import { buildWorld, type World } from './world';

const MPH = 0.44704;
/** Full lock of the front wheels (rad) for steer = ±1. */
const LOCK = 0.55;
const MAX_RPM = 8000;

/** Farther than this between two 20 Hz steps (≈ 650 mph) is a teleport (a reset after a crash), not motion. */
const TELEPORT_M = 15;

function interpolate(a: SimCar, b: SimCar, alpha: number): CarState & { mph: number } {
  // Never draw the car halfway between the wreck and where it is put back.
  if (Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2]) > TELEPORT_M) a = b;
  const mph = a.speedMph + (b.speedMph - a.speedMph) * alpha;
  return {
    position: new THREE.Vector3(...a.pos).lerp(new THREE.Vector3(...b.pos), alpha),
    quaternion: new THREE.Quaternion(...a.quat).slerp(new THREE.Quaternion(...b.quat), alpha),
    speed: mph * MPH,
    // The sim's steer is positive to the right (the original's convention); CarView's is positive to the left.
    steer: -(a.steer + (b.steer - a.steer) * alpha) * LOCK,
    rpm: (a.rpm + (b.rpm - a.rpm) * alpha) * MAX_RPM,
    mph,
  };
}

export class WorldRaceView implements RaceView {
  readonly cameras: readonly CameraMode[] = ['chase', 'cockpit', 'tv', 'orbit'];
  private mode: CameraMode = 'chase';
  private scene!: THREE.Scene;
  private world!: World;
  private rig!: CameraRig;
  private player!: CarView;
  private opponent: CarView | null = null;
  private info = { speedMph: 0, rpm: 0, maxRpm: MAX_RPM, gear: 1 };
  private lastPos: THREE.Vector3 | null = null;
  private lastOpp: THREE.Vector3 | null = null;
  /**
   * The in-car view's orientation, eased over the last steps (render/turn-ease.ts: the 20 Hz steps' uneven turns
   * showed as jolts through loops). `eyeEase.window = 0` turns it off (smooth-check --no-eye-ease).
   */
  readonly eyeEase = new TurnEase(2);

  /** Where the sound is heard from: the camera and its right-hand axis (the rival's engine pans). */
  get camera() {
    return this.mode;
  }
  set camera(m: CameraMode) {
    this.mode = m;
    this.rig?.setMode(m, this.player);
  }

  async init(setup: RaceSetup) {
    const { scene, sun } = createScene();
    this.scene = scene;
    this.world = await buildWorld(scene, sun, setup.track);
    const car = async (id: string, paint: string | null) => {
      // A car whose model hasn't been built yet (npm run assets) drives in another car's body.
      let m = await loadModel(id);
      if (!m) {
        const other = Object.keys((await modelIndex())?.models ?? {}).find((n) => n.startsWith('car-'));
        console.warn(`no model for ${id} (npm run assets); using ${other ?? 'nothing'}`);
        m = other ? await loadModel(other) : null;
      }
      if (!m) throw new Error(`no model for ${id} (npm run assets)`);
      return CarView.create(m, paint ?? undefined);
    };
    this.player = await car(setup.carId, setup.paint);
    scene.add(this.player.object);
    const opp = opponentInfo(setup.opponentId);
    if (opp) {
      // A paint that differs from the player's.
      this.opponent = await car(opp.carId, setup.paint === 'blue' ? 'red' : 'blue');
      scene.add(this.opponent.object);
    }
    this.rig = new CameraRig(tvCameras(setup.track), document.body);
    this.rig.setWalls(this.world.root);
    // The drawn wheels stand on the track pieces (car-view.ts placeWheels).
    const pieces = this.world.root.getObjectByName('pieces');
    const ground = pieces ? [...pieces.children] : [];
    this.player.setGround(ground);
    this.opponent?.setGround(ground);
    this.rig.setMode(this.mode, this.player);
  }

  update(prev: RaceSnapshot, next: RaceSnapshot, alpha: number, dt: number) {
    const s = interpolate(prev.player, next.player, alpha);
    // A jump (crash reset, replay seek): the suspension and the chase camera start over there instead of swinging
    // across the map.
    if (this.lastPos && this.lastPos.distanceTo(s.position) > TELEPORT_M) {
      this.player.reset();
      this.rig.setMode(this.mode, this.player);
      this.eyeEase.reset();
    }
    (this.lastPos ??= new THREE.Vector3()).copy(s.position);
    const eye = this.eyeEase.at(prev.tick, prev.player.quat, next.tick, next.player.quat, alpha);
    this.player.update(s, dt);
    if (this.opponent && prev.opponent && next.opponent) {
      const o = interpolate(prev.opponent, next.opponent, alpha);
      if (this.lastOpp && this.lastOpp.distanceTo(o.position) > TELEPORT_M) this.opponent.reset();
      (this.lastOpp ??= new THREE.Vector3()).copy(o.position);
      this.opponent.update(o, dt);
    }
    this.info.speedMph = Math.abs(s.mph);
    this.info.rpm = s.rpm ?? 0;
    this.info.gear = next.player.gear;
    // The car's own needles (Street Racer cars): the same speed and revs as our dashboard would show.
    if (this.mode === 'cockpit') this.player.setInstruments({ speedMph: this.info.speedMph, rpm: this.info.rpm, boost: THREE.MathUtils.clamp((this.info.rpm / MAX_RPM - 0.3) / 0.7, 0, 1) }, dt);
    this.rig.update(this.player, dt, this.info, this.opponent ? [this.opponent] : [], eye);
    this.world.atmosphere.update(this.rig.camera, this.player.object.position, this.mode === 'tv' ? 60 : 45);
    updateLods(this.world.root, this.rig.camera);
  }

  render(renderer: THREE.WebGLRenderer) {
    retro.render(renderer, this.scene, this.rig.camera);
  }

  resize(width: number, height: number) {
    this.rig?.resize(width, Math.max(1, height));
  }

  listener() {
    return this.rig?.camera ?? null;
  }

  /**
   * Checks (scripts/smooth-check.mjs): the camera, the player car and each wheel's gap to the surface under it
   * (a ray along the car's down axis from the wheel centre; gap = hit distance − wheel radius, null = nothing within 4 m).
   */
  probe() {
    const cam = this.rig.camera;
    const car = this.player.object;
    car.updateMatrixWorld(true);
    const down = new THREE.Vector3(0, -1, 0).applyQuaternion(car.quaternion);
    const ray = new THREE.Raycaster();
    ray.far = 4;
    const wheels = this.player.wheelCentres().map(({ centre, radius }) => {
      ray.set(centre, down);
      const hit = ray.intersectObject(this.world.root, true)[0];
      return hit ? +(hit.distance - radius).toFixed(3) : null;
    });
    const ndc = car.position.clone().project(cam);
    return {
      camera: cam.position.toArray(),
      cameraQuat: cam.quaternion.toArray(),
      fov: cam.fov,
      car: car.position.toArray(),
      carQuat: car.quaternion.toArray(),
      body: [this.player.body.rotation.x, this.player.body.rotation.z],
      screen: [ndc.x, ndc.y],
      wheels,
      /** How far the drawn suspension moved each wheel to the road (car-view.ts placeWheels). */
      travel: this.player.wheelTravel().map((t) => +t.toFixed(3)),
      mode: this.mode,
    };
  }

  dispose() {
    this.rig?.dashboard.canvas.remove();
    this.scene?.clear();
  }
}

registerView(() => (hasModels() ? new WorldRaceView() : new StubRaceView()));
