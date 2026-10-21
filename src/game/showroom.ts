// The car-select backdrop: a dark studio with a lit turntable, the chosen car turning slowly on it. Also renders the
// opponents' portraits (driver characters, head and shoulders) into images with a small offscreen renderer.
import * as THREE from 'three';
import { retro } from '../engine/retro';
import { carObject, driverObject } from './car-models';
import type { Opponent } from './catalog';

function glowTexture(inner: string, outer: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Showroom {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.1, 200);
  private turntable = new THREE.Group();
  private car: THREE.Object3D | null = null;
  private key = '';
  private token = 0;
  private t = 0;
  /** Where on the screen the car stands (0..1 of the width). */
  private focusX = 0.33;
  private size = new THREE.Vector2(1280, 720);

  constructor() {
    const s = this.scene;
    s.background = new THREE.Color('#0b0e1c');
    s.fog = new THREE.Fog('#0b0e1c', 16, 40);
    s.add(new THREE.HemisphereLight('#9fb4ff', '#1a1020', 0.7));
    const key = new THREE.SpotLight('#fff3e0', 260, 30, Math.PI / 6, 0.5, 1.6);
    key.position.set(3, 10, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    s.add(key, key.target);
    const rimA = new THREE.DirectionalLight('#35d6ff', 0.9);
    rimA.position.set(-8, 3, -6);
    const rimB = new THREE.DirectionalLight('#ff5a1f', 0.9);
    rimB.position.set(8, 2.5, -5);
    s.add(rimA, rimB);
    // Floor with a soft pool of light, the platform with a glowing rim.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: '#141a30', roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    s.add(floor);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshBasicMaterial({ map: glowTexture('rgba(90,110,190,0.55)', 'rgba(90,110,190,0)'), transparent: true, depthWrite: false }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.01;
    s.add(pool);
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.45, 0.22, 64), new THREE.MeshStandardMaterial({ color: '#232a44', metalness: 0.6, roughness: 0.35 }));
    deck.position.y = 0.11;
    deck.receiveShadow = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.38, 0.035, 8, 96), new THREE.MeshBasicMaterial({ color: '#ff5a1f' }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.2;
    this.turntable.add(deck, ring);
    // Stripes on the deck so the turning reads.
    for (let i = 0; i < 12; i++) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.01, 0.7), new THREE.MeshBasicMaterial({ color: '#3a4470' }));
      const a = (i / 12) * Math.PI * 2;
      st.position.set(Math.sin(a) * 2.9, 0.225, Math.cos(a) * 2.9);
      st.rotation.y = a;
      this.turntable.add(st);
    }
    s.add(this.turntable);
    // Light strips on the back wall.
    for (let i = -4; i <= 4; i++) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 6, 0.12), new THREE.MeshBasicMaterial({ color: i % 2 ? '#35d6ff' : '#ff5a1f' }));
      strip.position.set(i * 3.2, 3, -14 - Math.abs(i) * 0.6);
      strip.rotation.z = -0.25;
      s.add(strip);
    }
    this.camera.position.set(7.6, 2.9, 9.2);
    this.camera.lookAt(0, 0.7, 0);
  }

  /** Show a car (loads it; a newer call wins). */
  async setCar(carId: string, paint: string | null) {
    const key = `${carId}|${paint}`;
    if (key === this.key) return;
    this.key = key;
    const token = ++this.token;
    const obj = await carObject(carId, paint);
    if (token !== this.token) return;
    if (this.car) this.turntable.remove(this.car);
    // The axle centre sits a wheel radius above the deck.
    const box = new THREE.Box3().setFromObject(obj);
    obj.position.y = 0.22 - box.min.y;
    obj.traverse((o) => {
      o.castShadow = true;
    });
    this.car = obj;
    this.turntable.add(obj);
  }

  /** Where the car stands across the screen (the panels sit beside it). */
  setFocus(x: number) {
    this.focusX = x;
    this.resize(this.size.x, this.size.y);
  }

  step(dt: number) {
    this.t += dt;
    this.turntable.rotation.y += dt * 0.35;
  }

  render(renderer: THREE.WebGLRenderer) {
    retro.render(renderer, this.scene, this.camera);
  }

  resize(w: number, h: number) {
    this.size.set(w, h);
    this.camera.aspect = w / h;
    // Shift the view so the car stands at focusX of the width.
    this.camera.setViewOffset(w, h, (0.5 - this.focusX) * w, 0, w, h);
    this.camera.updateProjectionMatrix();
  }
}

let portraitRenderer: THREE.WebGLRenderer | null = null;

/** Head-and-shoulders picture of an opponent's driver (a data URL), or null without models. */
export async function renderPortrait(o: Opponent, w = 320, h = 320): Promise<string | null> {
  const driver = await driverObject(o.model);
  if (!driver) return null;
  portraitRenderer ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  const r = portraitRenderer;
  r.setSize(w, h, false);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#30304a', 1.2));
  const key = new THREE.DirectionalLight('#fff1dd', 2.4);
  key.position.set(1.5, 2.5, 3);
  const rim = new THREE.DirectionalLight(o.colour, 3.2);
  rim.position.set(-2, 2, -2.5);
  scene.add(key, rim, driver);
  const box = new THREE.Box3().setFromObject(driver);
  const top = box.max.y;
  const cam = new THREE.PerspectiveCamera(28, w / h, 0.05, 20);
  // Three-quarter view: the whole head and the shoulders, like a trading card.
  cam.position.set(0.6, top - 0.24, 1.62);
  cam.lookAt(0, top - 0.34, 0);
  r.render(scene, cam);
  return r.domElement.toDataURL('image/png');
}
