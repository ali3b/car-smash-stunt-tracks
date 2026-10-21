// Effects for recorded footage (the capture scene): what the race view leaves to the imagination when a car hits
// something. A crash throws sparks and body debris and leaves a column of smoke, a car landing in water throws up a
// spray, a heavy landing kicks up dust. Every particle is a closed-form function of the take time (launch speed,
// gravity, growth, fade), seeded by the event, so any frame can be rendered in any order, in slow motion, and
// twice the same. Nothing here runs in the game itself.
import * as THREE from 'three';

export type BurstKind = 'crash' | 'splash' | 'dust';

export interface Burst {
  kind: BurstKind;
  /** Take time of the event (s). */
  t: number;
  pos: THREE.Vector3;
  /** The car's velocity at the event (m/s), carried by the debris. */
  vel: THREE.Vector3;
  /** 0..1 */
  strength: number;
}

interface Kind {
  count: number;
  life: [number, number];
  speed: [number, number];
  /** Upward bias of the launch direction (0 = any direction, 1 = straight up). */
  up: number;
  /** Fraction of the car's velocity carried. */
  carry: number;
  gravity: number;
  /** Drag per second (velocity × e^-drag·t). */
  drag: number;
  size: [number, number];
  grow: number;
  rise: number;
}

const GEO = new THREE.IcosahedronGeometry(1, 0);
const BOX = new THREE.BoxGeometry(1, 1, 1);

/** Deterministic pseudo-random numbers from a seed. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

interface Layer {
  mesh: THREE.InstancedMesh;
  kind: Kind;
  colour: (r: () => number) => THREE.Color;
  /** Bursts it draws for (by burst kind). */
  from: BurstKind[];
  spin: boolean;
}

export class CinemaFx {
  readonly root = new THREE.Group();
  private layers: Layer[] = [];
  private bursts: Burst[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor() {
    this.root.name = 'cinema-fx';
    const layer = (from: BurstKind[], kind: Kind, geo: THREE.BufferGeometry, mat: THREE.Material, colour: Layer['colour'], spin = false) => {
      const mesh = new THREE.InstancedMesh(geo, mat, kind.count * 6);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.castShadow = false;
      this.root.add(mesh);
      this.layers.push({ mesh, kind, colour, from, spin });
    };
    // Smoke: soft grey puffs that rise and swell.
    layer(['crash'], { count: 40, life: [1.6, 3.4], speed: [1, 5], up: 0.7, carry: 0.15, gravity: -1.5, drag: 1.2, size: [0.8, 1.6], grow: 2.2, rise: 1.5 }, GEO, new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.62, depthWrite: false, flatShading: true }), (r) => new THREE.Color().setHSL(0.08, 0.05, 0.18 + r() * 0.25));
    // Sparks: small, hot, fast, falling.
    layer(['crash'], { count: 70, life: [0.35, 0.9], speed: [8, 22], up: 0.35, carry: 0.35, gravity: 14, drag: 1.5, size: [0.06, 0.14], grow: -0.6, rise: 0 }, BOX, new THREE.MeshBasicMaterial({ toneMapped: false }), (r) => new THREE.Color().setHSL(0.08 + r() * 0.07, 1, 0.55 + r() * 0.3), true);
    // Debris: chunks of body and glass tumbling away.
    layer(['crash'], { count: 26, life: [1.4, 2.4], speed: [4, 12], up: 0.55, carry: 0.45, gravity: 16, drag: 0.4, size: [0.12, 0.4], grow: 0, rise: 0 }, BOX, new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.3, flatShading: true }), (r) => (r() < 0.6 ? new THREE.Color('#2a2c30') : new THREE.Color().setHSL(0.55, 0.3, 0.7)), true);
    // Spray: white water thrown up and falling back.
    layer(['splash'], { count: 110, life: [0.9, 2.0], speed: [9, 21], up: 0.93, carry: 0.08, gravity: 15, drag: 0.6, size: [0.25, 0.7], grow: 1.2, rise: 0 }, GEO, new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.85, depthWrite: false, flatShading: true }), (r) => new THREE.Color().setHSL(0.55, 0.35, 0.82 + r() * 0.15));
    // Mist after the spray.
    layer(['splash'], { count: 24, life: [1.5, 3], speed: [1, 4], up: 0.5, carry: 0.2, gravity: -0.5, drag: 1, size: [1, 2], grow: 1.6, rise: 0.6 }, GEO, new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.45, depthWrite: false, flatShading: true }), () => new THREE.Color('#e8f3f8'));
    // Dust from a hard landing.
    layer(['dust'], { count: 22, life: [0.8, 1.6], speed: [2, 7], up: 0.25, carry: 0.25, gravity: 0, drag: 2.2, size: [0.4, 0.9], grow: 2, rise: 0.4 }, GEO, new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.45, depthWrite: false, flatShading: true }), (r) => new THREE.Color().setHSL(0.09, 0.2, 0.55 + r() * 0.15));
  }

  setBursts(b: Burst[]) {
    this.bursts = b;
  }

  /** Pose every particle for take time t. */
  update(t: number) {
    for (const L of this.layers) {
      let n = 0;
      const k = L.kind;
      for (const [bi, b] of this.bursts.entries()) {
        if (!L.from.includes(b.kind)) continue;
        const age = t - b.t;
        if (age < 0 || age > k.life[1]) continue;
        const r = rng((bi + 1) * 7919 + this.layers.indexOf(L) * 104729 + Math.round(b.t * 1000));
        const count = Math.round(k.count * (0.4 + 0.6 * b.strength));
        for (let i = 0; i < count && n < L.mesh.instanceMatrix.count; i++) {
          const life = k.life[0] + r() * (k.life[1] - k.life[0]);
          const speed = (k.speed[0] + r() * (k.speed[1] - k.speed[0])) * (0.6 + 0.4 * b.strength);
          const az = r() * Math.PI * 2;
          const el = Math.asin(Math.min(1, k.up + (1 - k.up) * (r() * 2 - 1)));
          const size = k.size[0] + r() * (k.size[1] - k.size[0]);
          const colour = L.colour(r);
          const spin = [r() * 6, r() * 6, r() * 6];
          const delay = r() * (L.from.includes('crash') && k.gravity < 0 ? 1.2 : 0.08);
          const a = age - delay;
          if (a < 0 || a > life) continue;
          // Velocity with exponential drag: x = v (1 - e^-d t) / d.
          const dragged = k.drag > 0 ? (1 - Math.exp(-k.drag * a)) / k.drag : a;
          this.v.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).multiplyScalar(speed).addScaledVector(b.vel, k.carry);
          const p = this.s.copy(b.pos).addScaledVector(this.v, dragged);
          p.y += -0.5 * k.gravity * a * a + k.rise * a;
          // Never below the event's level (the ground or the water there), except smoke which rises anyway.
          p.y = Math.max(p.y, b.pos.y - 0.6);
          const u = a / life;
          const sc = Math.max(0.001, size * (1 + k.grow * u) * (u > 0.75 ? 1 - (u - 0.75) / 0.25 : 1) * (u < 0.08 ? u / 0.08 : 1));
          if (L.spin) this.q.setFromEuler(this.e.set(spin[0] * a, spin[1] * a, spin[2] * a));
          else this.q.identity();
          this.m.compose(p, this.q, this.v.set(sc, sc, sc));
          L.mesh.setMatrixAt(n, this.m);
          L.mesh.setColorAt(n, colour);
          n++;
        }
      }
      L.mesh.count = n;
      L.mesh.instanceMatrix.needsUpdate = true;
      if (L.mesh.instanceColor) L.mesh.instanceColor.needsUpdate = true;
    }
  }

  /** Camera shake (radians, metres) at take time t: hits close in time shake the frame, decaying fast. */
  shake(t: number, near: (b: Burst) => number): { yaw: number; pitch: number; lift: number } {
    let a = 0;
    for (const b of this.bursts) {
      const age = t - b.t;
      if (age < 0 || age > 0.9) continue;
      const k = (b.kind === 'dust' ? 0.35 : 1) * b.strength * near(b);
      a += k * Math.exp(-age * 6);
    }
    return { yaw: Math.sin(t * 71) * a * 0.018, pitch: Math.sin(t * 53 + 1.3) * a * 0.022, lift: Math.sin(t * 61 + 0.4) * a * 0.12 };
  }
}
