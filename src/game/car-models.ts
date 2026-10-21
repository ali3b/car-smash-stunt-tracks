// Cars and drivers from the generator for the menus and the stub view: a car in a paint variant (or a placeholder
// box in the car's colour when the game runs without models), and a driver character for the portraits.
import * as THREE from 'three';
import { loadModel, withVariant, type LoadedModel } from '../models';
import { carInfo } from './catalog';

export function placeholderCar(colour: string): THREE.Object3D {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.55, 4.3), mat);
  body.position.y = 0.2;
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.45, 2), new THREE.MeshStandardMaterial({ color: '#1d2633' }));
  cab.position.set(0, 0.7, -0.2);
  g.add(body, cab);
  const tyre = new THREE.MeshStandardMaterial({ color: '#111' });
  for (const [x, z] of [[-0.85, 1.35], [0.85, 1.35], [-0.85, -1.35], [0.85, -1.35]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.3, 14), tyre);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0, z);
    g.add(w);
  }
  g.traverse((o) => (o.castShadow = true));
  return g;
}

/** The paint variants a car's model carries (empty without models or variants). */
export async function carPaints(carId: string): Promise<{ name: string; tint: string | null }[]> {
  const m = await loadModel(carId);
  return m?.manifest.variants ?? [];
}

/**
 * A new object for a car, origin at its axle centre, nose +Z. `paint` picks a variant; without models it is a
 * placeholder in `colour` (or the car's showroom colour).
 */
export async function carObject(carId: string, paint: string | null, colour?: string): Promise<THREE.Object3D> {
  const m = await loadModel(carId);
  if (!m) return placeholderCar(colour ?? carInfo(carId).colour);
  const painted: LoadedModel = paint ? await withVariant(m, paint) : m;
  const obj = painted === m ? m.scene.clone(true) : painted.scene;
  obj.traverse((o) => {
    if (o.name === 'collider') o.visible = false;
  });
  return obj;
}

/** A driver character (falls back to driver-a, then null). */
export async function driverObject(model: string): Promise<THREE.Object3D | null> {
  const m = (await loadModel(model)) ?? (await loadModel('driver-a'));
  return m ? m.scene.clone(true) : null;
}
