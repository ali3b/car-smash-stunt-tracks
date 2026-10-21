// Stand-in for the RENDER lane's race view until it registers its own (src/game/integrations.ts): the track built
// from the generator's pieces (src/track/build.ts), the cars, and four simple cameras. Draws through the DOS-look
// pass (src/engine/retro.ts) when that is on.
import * as THREE from 'three';
import { createScene } from '../engine/renderer';
import { retro } from '../engine/retro';
import { loadModel, modelIndex, type LoadedModel } from '../models';
import { buildTrack } from '../track/build';
import { carObject } from './car-models';
import { centreLine, sampleAt, type CentreLine } from './centreline';
import { carInfo, opponentInfo } from './catalog';
import type { CameraMode, CarState, RaceSetup, RaceSnapshot, RaceView } from './types';

const SKY: Record<string, string> = { desert: '#9cc6e8', tropical: '#7fc4ee', alpine: '#b9d3ea', city: '#a7bccf', country: '#8fbce6' };

/** Every tp-* model, loaded once and shared between races. */
let pieceModels: Promise<Map<string, LoadedModel>> | null = null;
export function trackPieceModels(): Promise<Map<string, LoadedModel>> {
  pieceModels ??= (async () => {
    const map = new Map<string, LoadedModel>();
    const index = await modelIndex();
    const names = Object.keys(index?.models ?? {}).filter((n) => n.startsWith('tp-'));
    await Promise.all(
      names.map(async (n) => {
        const m = await loadModel(n);
        if (m) map.set(n, m);
      }),
    );
    return map;
  })();
  return pieceModels;
}

function apply(obj: THREE.Object3D, a: CarState, b: CarState, alpha: number) {
  obj.position.set(a.pos[0] + (b.pos[0] - a.pos[0]) * alpha, a.pos[1] + (b.pos[1] - a.pos[1]) * alpha, a.pos[2] + (b.pos[2] - a.pos[2]) * alpha);
  const qa = new THREE.Quaternion(...a.quat);
  const qb = new THREE.Quaternion(...b.quat);
  obj.quaternion.copy(qa.slerp(qb, alpha));
}

export class StubRaceView implements RaceView {
  readonly cameras: readonly CameraMode[] = ['chase', 'cockpit', 'tv', 'orbit'];
  camera: CameraMode = 'chase';
  private scene!: THREE.Scene;
  private sun!: THREE.DirectionalLight;
  private cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.3, 4000);
  private player = new THREE.Group();
  private opponent: THREE.Group | null = null;
  private line!: CentreLine;
  private chasePos = new THREE.Vector3();
  private chaseInit = false;
  private orbitT = 0;
  private tvSpot = new THREE.Vector3();
  private tvAt = -1e9;

  async init(setup: RaceSetup) {
    const { scene, sun } = createScene();
    this.scene = scene;
    this.sun = sun;
    const sky = SKY[setup.track.scenery] ?? '#8fbce6';
    scene.background = new THREE.Color(sky);
    scene.fog = new THREE.Fog(sky, 300, 1700);
    sun.shadow.camera.far = 400;
    const models = await trackPieceModels();
    const { root } = buildTrack(setup.track, models);
    // Sink the terrain a little so ground-level road decks don't z-fight with it.
    const terrain = root.getObjectByName('terrain') as THREE.Mesh;
    terrain.position.y = -0.2;
    // A wide ground plane beyond the 30×30 grid.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), new THREE.MeshStandardMaterial({ color: (terrain.material as THREE.MeshStandardMaterial).color }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(930, -0.45, -930);
    ground.receiveShadow = true;
    scene.add(ground, root);
    this.line = centreLine(setup.track);
    this.player.add(await carObject(setup.carId, setup.paint));
    scene.add(this.player);
    const opp = opponentInfo(setup.opponentId);
    if (opp) {
      this.opponent = new THREE.Group();
      this.opponent.add(await carObject(opp.carId, null, carInfo(opp.carId).colour));
      scene.add(this.opponent);
    }
  }

  update(prev: RaceSnapshot, next: RaceSnapshot, alpha: number, dt: number) {
    apply(this.player, prev.player, next.player, alpha);
    if (this.opponent && prev.opponent && next.opponent) apply(this.opponent, prev.opponent, next.opponent, alpha);
    const car = this.player;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(car.quaternion);
    fwd.y = 0;
    fwd.normalize();
    const cam = this.cam;
    if (this.camera === 'chase') {
      const want = car.position.clone().addScaledVector(fwd, -9).add(new THREE.Vector3(0, 3.4, 0));
      if (!this.chaseInit) this.chasePos.copy(want);
      this.chaseInit = true;
      this.chasePos.lerp(want, 1 - Math.exp(-dt * 6));
      cam.position.copy(this.chasePos);
      cam.lookAt(car.position.clone().addScaledVector(fwd, 4).add(new THREE.Vector3(0, 1.2, 0)));
      cam.fov = 60;
    } else if (this.camera === 'cockpit') {
      cam.position.copy(car.position).add(new THREE.Vector3(0, 0.75, 0).applyQuaternion(car.quaternion)).addScaledVector(fwd, -0.2);
      cam.quaternion.copy(car.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
      cam.fov = 70;
    } else if (this.camera === 'tv') {
      // A trackside camera ahead of the car; it moves on when the car has gone well past.
      if (car.position.distanceTo(this.tvSpot) > 140 || this.tvAt < -1e8) {
        let nearest = 0;
        let best = Infinity;
        this.line.points.forEach((p, i) => {
          const d = (p[0] - car.position.x) ** 2 + (p[2] - car.position.z) ** 2;
          if (d < best) {
            best = d;
            nearest = i;
          }
        });
        const s = this.line.cum[nearest] + 90;
        const { pos, dir } = sampleAt(this.line, s);
        this.tvSpot.set(pos[0] - dir[2] * 22, pos[1] + 9, pos[2] + dir[0] * 22);
        this.tvAt = s;
      }
      cam.position.copy(this.tvSpot);
      cam.lookAt(car.position);
      cam.fov = Math.max(18, Math.min(55, 2400 / Math.max(10, cam.position.distanceTo(car.position))));
    } else {
      this.orbitT += dt * 0.25;
      const r = 11;
      cam.position.set(car.position.x + Math.cos(this.orbitT) * r, car.position.y + 3.2, car.position.z + Math.sin(this.orbitT) * r);
      cam.lookAt(car.position.x, car.position.y + 0.6, car.position.z);
      cam.fov = 45;
    }
    cam.updateProjectionMatrix();
    // The sun's shadow box follows the car.
    this.sun.position.set(car.position.x - 60, car.position.y + 80, car.position.z - 25);
    this.sun.target.position.copy(car.position);
  }

  render(renderer: THREE.WebGLRenderer) {
    retro.render(renderer, this.scene, this.cam);
  }

  resize(width: number, height: number) {
    this.cam.aspect = width / Math.max(1, height);
    this.cam.updateProjectionMatrix();
  }

  listener() {
    return this.cam;
  }

  dispose() {
    this.scene?.clear();
  }
}
