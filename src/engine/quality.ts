// Render quality: 'high' (full pixel ratio up to 2, antialiasing, soft shadows, every background prop) or 'low'
// (pixel ratio 1, no antialiasing, no shadows, a third of the background props) for phones and slow GPUs.
// The setting is 'auto' (low on a phone / tablet, high elsewhere), 'low' or 'high': localStorage `cs.quality`, the
// Options screen, or ?quality=low|high|auto. The renderer reads it at start; the props at each track build.
export type QualitySetting = 'auto' | 'low' | 'high';
export type Quality = 'low' | 'high';

const KEY = 'cs.quality';

function stored(): QualitySetting {
  try {
    const q = new URLSearchParams(location.search).get('quality') ?? localStorage.getItem(KEY);
    return q === 'low' || q === 'high' ? q : 'auto';
  } catch {
    return 'auto';
  }
}

let setting: QualitySetting = stored();

/** A phone or tablet: a coarse pointer and no fine one, or a small touch screen. */
export function isMobile(): boolean {
  if (typeof matchMedia !== 'function') return false;
  const coarse = matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
  const smallTouch = navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) <= 820;
  return coarse || smallTouch;
}

export const qualitySetting = () => setting;
export const quality = (): Quality => (setting === 'auto' ? (isMobile() ? 'low' : 'high') : setting);

const listeners = new Set<() => void>();
/** Called after the setting changes (the renderer updates its pixel ratio and shadows). */
export function onQuality(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setQualitySetting(q: QualitySetting) {
  setting = q;
  for (const fn of listeners) fn();
  try {
    localStorage.setItem(KEY, q);
  } catch {
    // Storage blocked: this page only.
  }
}

export function cycleQuality(): QualitySetting {
  setQualitySetting(setting === 'auto' ? 'low' : setting === 'low' ? 'high' : 'auto');
  return setting;
}

export const qualityLabel = () => (setting === 'auto' ? `AUTO (${quality().toUpperCase()})` : setting.toUpperCase());

/** Device pixel ratio for the renderer. */
export const pixelRatio = () => (quality() === 'low' ? 1 : Math.min(window.devicePixelRatio, 2));
/** Fraction of the background props a track gets. */
export const propScale = () => (quality() === 'low' ? 0.35 : 1);
