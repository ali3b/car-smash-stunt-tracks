// The boot screen in index.html (#boot): its progress bar follows the model downloads, it turns into a message when
// the browser can't run the game (no WebGL 2) or the boot fails, and it goes away when the scene is ready.
import { onModelProgress } from './models';

const el = () => document.getElementById('boot');
let offProgress: (() => void) | null = null;

export function bootProgress() {
  const fill = el()?.querySelector<HTMLElement>('.bar i');
  const msg = el()?.querySelector<HTMLElement>('.msg');
  offProgress = onModelProgress((done, total) => {
    if (fill) fill.style.width = `${Math.max(4, Math.round((done / Math.max(1, total)) * 100))}%`;
    if (msg) msg.textContent = `Loading models ${done} / ${total}`;
  });
}

export function bootDone() {
  offProgress?.();
  offProgress = null;
  el()?.remove();
}

/** Replace the boot screen with a message (it stays up). */
export function bootMessage(title: string, text: string) {
  offProgress?.();
  let b = el();
  if (!b) {
    b = document.createElement('div');
    b.id = 'boot';
    document.body.appendChild(b);
  }
  b.className = 'error';
  b.innerHTML = '<h1></h1><div class="msg"></div>';
  b.querySelector('h1')!.textContent = title;
  b.querySelector('.msg')!.textContent = text;
}

/** three.js needs WebGL 2. */
export function hasWebGL2(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}
