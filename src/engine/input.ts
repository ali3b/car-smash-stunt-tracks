// Keyboard + Gamepad API → CarInput, per player. Tests can override with window.__cs.setInput().
//
// One human: readInput() — arrows or WASD, Space / Shift = shift, and any gamepad (KEY_SCHEMES.solo).
// Two or three humans (local multiplayer) split the keyboard: the WASD player (Left Shift = shift), the arrows player
// (Right Ctrl or Enter = shift); a third player drives with a gamepad. Every human can also use a pad: a player who
// joined with a pad keeps that pad, the other pads go to the other players in join order (padsFor()).
import type { CarInput } from '../sim/input';

const held = new Set<string>();
const pressed = new Set<string>();
/**
 * Keys pressed since the driving input was last read: a tap shorter than one 20 Hz race step (down and up between
 * two reads) still reaches the car for one step instead of being lost.
 */
const tapped = new Set<string>();
/** Menu presses in order (a Set would merge two presses of the same key within one frame). */
const menuQueue: string[] = [];

export function initKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'F2', 'F3', 'Backspace', 'ControlRight'].includes(e.code)) e.preventDefault();
    if (!held.has(e.code)) {
      pressed.add(e.code);
      tapped.add(e.code);
      menuQueue.push(e.code);
      // Standalone scenes never drain the menu queue: keep it short.
      if (menuQueue.length > 32) menuQueue.shift();
    }
    held.add(e.code);
  });
  window.addEventListener('keyup', (e) => held.delete(e.code));
  window.addEventListener('blur', () => {
    held.clear();
    tapped.clear();
  });
}

/** A key press made by something other than the keyboard (the touch controls' camera and pause buttons). */
export function pressKey(code: string) {
  pressed.add(code);
  menuQueue.push(code);
}

/** The on-screen touch controls (src/ui/touch-controls.ts): null while they are hidden. */
let touchInput: (() => CarInput | null) | null = null;
export function setTouchInput(fn: (() => CarInput | null) | null) {
  touchInput = fn;
}

/** True once per key press (consumed). */
export function wasPressed(code: string) {
  const p = pressed.has(code);
  pressed.delete(code);
  return p;
}

const any = (...codes: string[]) => codes.some((c) => held.has(c) || tapped.has(c));
const DEAD = 0.18;

// ---- Driving bindings ---------------------------------------------------------------------------------------------

/** A keyboard layout for one driver. 'solo' is the single-player layout (both key sets). */
export type KeyScheme = 'solo' | 'wasd' | 'arrows';

export interface KeyBinding {
  up: string[];
  down: string[];
  left: string[];
  right: string[];
  shift: string[];
  /** Short label for the sign-up panel. */
  label: string;
}

/** The keyboard split (edit here to rebind). */
export const KEY_SCHEMES: Record<KeyScheme, KeyBinding> = {
  solo: {
    up: ['ArrowUp', 'KeyW'],
    down: ['ArrowDown', 'KeyS'],
    left: ['ArrowLeft', 'KeyA'],
    right: ['ArrowRight', 'KeyD'],
    shift: ['Space', 'ShiftLeft', 'ShiftRight'],
    label: 'KEYS OR PAD',
  },
  wasd: { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], shift: ['ShiftLeft'], label: 'WASD + L.SHIFT' },
  arrows: { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], shift: ['ControlRight', 'Enter', 'NumpadEnter'], label: 'ARROWS + R.CTRL' },
};

/** One human's controls: a keyboard layout (or none: pad only) and the pad they joined with (else one is lent in join order). */
export interface Control {
  keys: KeyScheme | null;
  pad: number | null;
}

/** The driving input of one keyboard layout. */
export function readKeys(scheme: KeyScheme): CarInput {
  const k = KEY_SCHEMES[scheme];
  return {
    throttle: any(...k.up) ? 1 : 0,
    brake: any(...k.down) ? 1 : 0,
    steer: (any(...k.right) ? 1 : 0) - (any(...k.left) ? 1 : 0),
    shift: any(...k.shift),
  };
}

function padInput(p: Gamepad): CarInput {
  const b = (i: number) => p.buttons[i]?.value ?? 0;
  const sx = p.axes[0] ?? 0;
  const steer = Math.abs(sx) < DEAD ? 0 : (sx - Math.sign(sx) * DEAD) / (1 - DEAD);
  const dpad = (b(15) > 0.5 ? 1 : 0) - (b(14) > 0.5 ? 1 : 0);
  // RT or A for gas, LT or X for brake/reverse, B / Y / RB for shift.
  return {
    throttle: Math.max(b(7), b(0)),
    brake: Math.max(b(6), b(2)),
    steer: Math.max(-1, Math.min(1, steer + dpad)),
    shift: b(1) > 0.5 || b(3) > 0.5 || b(5) > 0.5,
  };
}

const active = (i: CarInput) => !!(i.throttle || i.brake || i.steer || i.shift);
const IDLE: CarInput = { throttle: 0, brake: 0, steer: 0, shift: false };

function connectedPads(): Gamepad[] {
  return [...(navigator.getGamepads?.() ?? [])].filter((p): p is Gamepad => !!p && p.connected);
}

/** One pad's driving input (null when that pad isn't connected). */
export function readPad(index: number): CarInput | null {
  const p = connectedPads().find((x) => x.index === index);
  return p ? padInput(p) : null;
}

/**
 * Which pad each human drives with: a pad they joined with stays theirs; the other connected pads go to the players
 * without one, in join order (pad index order). null = no pad for that player right now.
 */
export function padsFor(controls: Control[], connected = connectedPads().map((p) => p.index)): (number | null)[] {
  const fixed = new Set(controls.map((c) => c.pad).filter((p): p is number => p !== null));
  const free = connected.filter((i) => !fixed.has(i)).sort((a, b) => a - b);
  return controls.map((c) => (c.pad !== null ? c.pad : (free.shift() ?? null)));
}

/** Every human's driving input (index = player). A single 'solo' player reads like readInput(). */
export function readPlayers(controls: Control[]): CarInput[] {
  if (controls.length === 1 && controls[0].keys === 'solo' && controls[0].pad === null) return [readInput()];
  const pads = padsFor(controls);
  return controls.map((c, i) => {
    const pad = pads[i] !== null ? readPad(pads[i]!) : null;
    if (pad && active(pad)) return pad;
    return c.keys ? readKeys(c.keys) : IDLE;
  });
}

/** One human: the first active pad, else the touch controls when touched, else arrows or WASD. */
export function readInput(): CarInput {
  // Keys first, so this read consumes the taps (see `tapped`) whichever device drives.
  const keys = readKeys('solo');
  tapped.clear();
  for (const p of connectedPads()) {
    const input = padInput(p);
    if (active(input)) return input;
  }
  const touch = touchInput?.();
  if (touch && active(touch)) return touch;
  return keys;
}

/** Gamepad Back/Select resets the truck (keyboard: R). */
let padResetHeld = false;
export function resetRequested() {
  const now = connectedPads().some((p) => p.buttons[8]?.pressed ?? false);
  const edge = now && !padResetHeld;
  padResetHeld = now;
  return wasPressed('KeyR') || edge;
}

/** Enter / Space on the keyboard or A / Start on a pad (menus: "race again"). Edge-triggered. */
let padConfirmHeld = false;
export function confirmPressed() {
  const now = connectedPads().some((p) => (p.buttons[0]?.pressed ?? false) || (p.buttons[9]?.pressed ?? false));
  const edge = now && !padConfirmHeld;
  padConfirmHeld = now;
  const key = wasPressed('Enter') || wasPressed('NumpadEnter');
  return key || edge;
}

// ---- Menus ------------------------------------------------------------------------------------------------------

export type MenuKey = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back';
/**
 * Where a menu press came from: the WASD side of the keyboard ('wasd': W A S D, Left Shift, Space), the arrows side
 * ('arrows': arrows, Enter, Right Ctrl), the rest of the keyboard ('kb': Esc, Backspace, other letters), or a pad
 * ('pad0', 'pad1', …). Tests leave it out.
 */
export type MenuSrc = 'wasd' | 'arrows' | 'kb' | `pad${number}`;

/** One menu press: a navigation key and/or a typed letter (A–Z, for the initials). */
export interface MenuEvent {
  key?: MenuKey;
  letter?: string;
  src?: MenuSrc;
  /** The human this press belongs to (the flow fills it in; tests may set it). undefined = anyone. */
  player?: number;
}

const MENU_CODES: Record<string, [MenuKey, MenuSrc]> = {
  KeyW: ['up', 'wasd'],
  KeyS: ['down', 'wasd'],
  KeyA: ['left', 'wasd'],
  KeyD: ['right', 'wasd'],
  ShiftLeft: ['confirm', 'wasd'],
  Space: ['confirm', 'wasd'],
  ArrowUp: ['up', 'arrows'],
  ArrowDown: ['down', 'arrows'],
  ArrowLeft: ['left', 'arrows'],
  ArrowRight: ['right', 'arrows'],
  Enter: ['confirm', 'arrows'],
  NumpadEnter: ['confirm', 'arrows'],
  ControlRight: ['confirm', 'arrows'],
  Escape: ['back', 'kb'],
  Backspace: ['back', 'kb'],
};

/** Forget key presses that happened before now (a screen change must not act on keys pressed during the race). */
export function clearPressed() {
  pressed.clear();
  tapped.clear();
  menuQueue.length = 0;
  padMenuHeld.clear();
  for (const p of connectedPads()) for (const [k, held] of padMenuState(p)) if (held) padMenuHeld.add(`${p.index}:${k}`);
}

const padMenuHeld = new Set<string>();
function padMenuState(p: Gamepad): [string, boolean][] {
  const b = (i: number) => p.buttons[i]?.pressed ?? false;
  const ax = p.axes[0] ?? 0;
  const ay = p.axes[1] ?? 0;
  return [
    ['up', b(12) || ay < -0.6],
    ['down', b(13) || ay > 0.6],
    ['left', b(14) || ax < -0.6],
    ['right', b(15) || ax > 0.6],
    // A or Start confirm, B or Back goes back.
    ['confirm', b(0) || b(9)],
    ['back', b(1) || b(8)],
  ];
}

/** Menu presses since the last call (keyboard + every pad, edge-triggered, with their source). Consumes the keyboard presses. */
export function drainMenu(): MenuEvent[] {
  const out: MenuEvent[] = [];
  for (const code of menuQueue) {
    const m = MENU_CODES[code];
    const letter = /^Key[A-Z]$/.test(code) ? code.slice(3) : undefined;
    if (m || letter) out.push({ key: m?.[0], letter, src: m?.[1] ?? 'kb' });
  }
  menuQueue.length = 0;
  pressed.clear();
  for (const p of connectedPads()) {
    for (const [k, held] of padMenuState(p)) {
      const id = `${p.index}:${k}`;
      if (held && !padMenuHeld.has(id)) out.push({ key: k as MenuKey, src: `pad${p.index}` });
      if (held) padMenuHeld.add(id);
      else padMenuHeld.delete(id);
    }
  }
  return out;
}
