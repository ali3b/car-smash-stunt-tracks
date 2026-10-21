// The "DOS look": an optional post-process for the race view. The scene is drawn into a ~200-line render target,
// then scaled up with nearest-neighbour sampling onto the screen, with an optional palette (VGA-style 256 colours
// as 3-3-2 bits, or the 16-colour EGA palette, both with 4×4 ordered dithering) and dark scanlines between the
// low-res rows. Saved in localStorage `cs.look` ({ dos, palette }); off by default. F2 cycles
// off → 256 colours → 16 colours → off, and the title menu has the same toggle.
import * as THREE from 'three';

export type Palette = 0 | 16 | 256;
export interface Settings {
  /** The DOS look on or off. */
  dos: boolean;
  /** Colours when it is on: 256 (3-3-2), 16 (EGA) or 0 (full colour, just pixels and scanlines). */
  palette: Palette;
}

const KEY = 'cs.look';
export const DEFAULT_SETTINGS: Settings = { dos: false, palette: 256 };
/** Rows of the low-res frame (the original's 320×200 mode); the width follows the window's aspect. */
export const RETRO_ROWS = 200;

export function loadSettings(): Settings {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Settings> | null;
    return {
      dos: v?.dos === true,
      palette: v?.palette === 16 || v?.palette === 0 ? v.palette : 256,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage blocked: the setting lasts for this page only.
  }
}

let settings = loadSettings();
const listeners = new Set<(s: Settings) => void>();

export const getSettings = () => settings;

export function setSettings(s: Settings) {
  settings = { ...s };
  saveSettings(settings);
  for (const fn of listeners) fn(settings);
}

/** off → 256 colours → 16 colours → off. */
export function cycleDosLook() {
  const s = settings;
  if (!s.dos) setSettings({ dos: true, palette: 256 });
  else if (s.palette === 256) setSettings({ dos: true, palette: 16 });
  else setSettings({ dos: false, palette: 256 });
  return settings;
}

export function onSettings(fn: (s: Settings) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function dosLabel(s = settings) {
  return !s.dos ? 'OFF' : s.palette === 16 ? '16 COLOURS' : s.palette === 256 ? '256 COLOURS' : 'ON';
}

// The 16-colour EGA palette.
const EGA = ['#000000', '#0000aa', '#00aa00', '#00aaaa', '#aa0000', '#aa00aa', '#aa5500', '#aaaaaa', '#555555', '#5555ff', '#55ff55', '#55ffff', '#ff5555', '#ff55ff', '#ffff55', '#ffffff'];

const FRAG = /* glsl */ `
uniform sampler2D tFrame;
uniform vec2 lowRes;
uniform vec2 outRes;
uniform int palette;
uniform vec3 ega[16];
varying vec2 vUv;

vec3 toSRGB(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

float bayer4(vec2 p) {
  int x = int(mod(p.x, 4.0));
  int y = int(mod(p.y, 4.0));
  int i = x + y * 4;
  // 4x4 Bayer matrix, row-major.
  float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (m[i] + 0.5) / 16.0 - 0.5;
}

void main() {
  vec2 px = floor(vUv * lowRes);
  vec3 c = toSRGB(texture2D(tFrame, (px + 0.5) / lowRes).rgb);
  float d = bayer4(px);
  if (palette == 256) {
    // 3-3-2 bits: 8 levels of red and green, 4 of blue.
    vec3 levels = vec3(7.0, 7.0, 3.0);
    c = floor(c * levels + 0.5 + d * 0.6) / levels;
  } else if (palette == 16) {
    vec3 q = c + d * 0.2;
    float best = 1e9;
    vec3 pick = vec3(0.0);
    for (int i = 0; i < 16; i++) {
      vec3 e = ega[i] - q;
      // Weight green like the eye does, so skin and dirt do not turn grey.
      float dist = dot(e * e, vec3(0.30, 0.59, 0.11));
      if (dist < best) { best = dist; pick = ega[i]; }
    }
    c = pick;
  }
  // Scanlines: the lower part of each low-res row is darker, like a CRT's gaps between lines.
  float row = fract(vUv.y * lowRes.y);
  float scan = outRes.y / lowRes.y >= 2.5 ? mix(0.62, 1.0, smoothstep(0.0, 0.35, row)) : 1.0;
  // A soft vignette.
  vec2 v = vUv - 0.5;
  float vig = 1.0 - dot(v, v) * 0.45;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0) * scan * vig, 1.0);
}`;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** Draws a scene either straight to the screen or through the DOS-look pass, per the saved setting. */
export class RetroPass {
  private target = new THREE.WebGLRenderTarget(320, 200, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    type: THREE.HalfFloatType,
    depthBuffer: true,
  });
  private material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      tFrame: { value: this.target.texture },
      lowRes: { value: new THREE.Vector2(320, 200) },
      outRes: { value: new THREE.Vector2(1280, 720) },
      palette: { value: 256 },
      ega: { value: EGA.map((h) => new THREE.Color(h)).map((c) => new THREE.Vector3(...c.convertLinearToSRGB().toArray())) },
    },
    depthTest: false,
    depthWrite: false,
  });
  private quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
  private quadScene = new THREE.Scene();
  private quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private size = new THREE.Vector2();

  constructor() {
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const s = settings;
    if (!s.dos) {
      renderer.render(scene, camera);
      return;
    }
    renderer.getDrawingBufferSize(this.size);
    const rows = RETRO_ROWS;
    const cols = Math.max(64, Math.round((rows * this.size.x) / Math.max(1, this.size.y)));
    if (this.target.width !== cols || this.target.height !== rows) this.target.setSize(cols, rows);
    const u = this.material.uniforms;
    u.lowRes.value.set(cols, rows);
    u.outRes.value.copy(this.size);
    u.palette.value = s.palette;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(prev);
    renderer.render(this.quadScene, this.quadCamera);
  }
}

/** The one pass the race scenes share (the renderer is shared too). */
export const retro = new RetroPass();
