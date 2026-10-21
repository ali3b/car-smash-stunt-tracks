// three.js renderer, scene and lights. One canvas filling the window; the HUD is a DOM overlay on top.
import * as THREE from 'three';
import { onQuality, pixelRatio, quality } from './quality';

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
}

export function createStage(parent: HTMLElement): Stage {
  // Quality (src/engine/quality.ts): low = pixel ratio 1, no antialiasing, no shadows.
  const renderer = new THREE.WebGLRenderer({ antialias: quality() === 'high', preserveDrawingBuffer: true });
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = quality() === 'high';
  onQuality(() => {
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(window.innerWidth, window.innerHeight);
    // Takes effect on the next race (its scene compiles its materials then).
    renderer.shadowMap.enabled = quality() === 'high';
  });
  renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoftShadowMap is gone in three r18x (it warned and fell back to this)
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  parent.appendChild(renderer.domElement);
  const { scene, sun } = createScene();
  return { renderer, scene, sun };
}

/** A fresh scene with the background and lights (one per race; the renderer is shared). */
export function createScene(): { scene: THREE.Scene; sun: THREE.DirectionalLight } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#8fb8de');

  scene.add(new THREE.HemisphereLight('#eef6ff', '#4a5a3a', 1.4));
  // Midday sun from the south-west.
  const sun = new THREE.DirectionalLight('#fff0d0', 2.6);
  sun.position.set(-60, 42, -25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  s.left = -70;
  s.right = 70;
  s.top = 50;
  s.bottom = -50;
  s.near = 10;
  s.far = 200;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  return { scene, sun };
}
