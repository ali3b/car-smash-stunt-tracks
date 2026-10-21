// On-screen driving controls for phones and tablets, shown during a race on a touch device:
//   left thumb:  ◀ ▶ steering buttons, or TILT steering (DeviceOrientation, with a CALIBRATE button)
//   right thumb: GAS and BRAKE pedals; ▲ / ▼ gear shifts with a manual gearbox
//   top:         camera, pause, tilt on / off
// Multi-touch: every finger is tracked on its own and counts for the control under it (a thumb can roll from GAS to
// BRAKE). The result is a CarInput fed to the same input path as the keyboard and pads (engine/input.ts
// setTouchInput), so the simulation sees the same input byte. Tilt is analogue, the input byte is not: a partial
// tilt steers on that fraction of the 20 Hz steps. In portrait a card asks to turn the phone (and pauses a race).
// Pressing a key hides the controls until the next touch. window.__cs.touch is the test handle.
import { pressKey, setTouchInput } from '../engine/input';
import type { CarInput } from '../sim/input';
import { addStyle, PIXEL_FONT } from './pixel';
import { C } from './screens/common';

const CSS = `
.cs-touch { position: fixed; inset: 0; z-index: 15; display: none; pointer-events: none; font-family: ${PIXEL_FONT}; color: ${C.text};
  user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.cs-touch.on { display: block; }
.cs-touch .b { position: absolute; display: flex; align-items: center; justify-content: center; pointer-events: auto; touch-action: none;
  background: rgba(10,13,28,.48); border: 3px solid rgba(255,255,255,.35); border-radius: 18px; font-size: 12px; letter-spacing: 1px;
  text-shadow: 2px 2px 0 rgba(0,0,0,.6); box-sizing: border-box; }
.cs-touch .b.down { background: rgba(255,210,63,.55); border-color: ${C.yellow}; color: ${C.ink}; text-shadow: none; }
.cs-touch .b svg { width: 46%; height: 46%; fill: currentColor; pointer-events: none; }
.cs-touch [data-c="left"]  { left: max(14px, env(safe-area-inset-left)); bottom: 18px; width: 23vh; height: 23vh; min-width: 84px; min-height: 84px; }
.cs-touch [data-c="right"] { left: calc(max(14px, env(safe-area-inset-left)) + max(23vh, 84px) + 14px); bottom: 18px; width: 23vh; height: 23vh; min-width: 84px; min-height: 84px; }
.cs-touch [data-c="gas"]   { right: max(14px, env(safe-area-inset-right)); bottom: 18px; width: 22vh; height: 40vh; min-width: 84px; min-height: 150px; border-color: ${C.green}; }
.cs-touch [data-c="brake"] { right: calc(max(14px, env(safe-area-inset-right)) + max(22vh, 84px) + 14px); bottom: 18px; width: 22vh; height: 26vh; min-width: 84px; min-height: 96px; border-color: ${C.pink}; }
.cs-touch [data-c="up"], .cs-touch [data-c="down"] { right: calc(max(14px, env(safe-area-inset-right)) + max(22vh, 84px) + 14px); width: 22vh; min-width: 84px; height: 11vh; min-height: 40px; display: none; }
.cs-touch [data-c="up"] { bottom: calc(18px + max(26vh, 96px) + 10px + max(11vh, 40px) + 8px); }
.cs-touch [data-c="down"] { bottom: calc(18px + max(26vh, 96px) + 10px); }
.cs-touch.manual [data-c="up"], .cs-touch.manual [data-c="down"] { display: flex; }
.cs-touch .top { position: absolute; top: 10px; width: 64px; height: 44px; border-radius: 10px; font-size: 9px; }
.cs-touch [data-c="pause"] { left: 50%; margin-left: -118px; }
.cs-touch [data-c="cam"] { left: 50%; margin-left: -32px; }
.cs-touch [data-c="tilt"] { left: 50%; margin-left: 54px; width: 72px; }
.cs-touch [data-c="cal"] { left: max(14px, env(safe-area-inset-left)); bottom: calc(18px + max(23vh, 84px) + 12px); width: auto; padding: 0 12px; height: 44px; font-size: 9px; display: none; }
.cs-touch .tiltbar { position: absolute; left: max(14px, env(safe-area-inset-left)); bottom: 18px; width: calc(2 * max(23vh, 84px) + 14px); height: 23vh; min-height: 84px;
  display: none; align-items: center; justify-content: center; border-radius: 18px; background: rgba(10,13,28,.35); border: 3px dashed rgba(255,255,255,.3); box-sizing: border-box; }
.cs-touch .tiltbar i { position: absolute; top: 20%; bottom: 20%; width: 14px; margin-left: -7px; left: 50%; background: ${C.yellow}; border-radius: 4px; }
.cs-touch .tiltbar span { position: absolute; bottom: 6px; font-size: 8px; color: ${C.muted}; }
.cs-touch.tilt [data-c="left"], .cs-touch.tilt [data-c="right"] { display: none; }
.cs-touch.tilt .tiltbar, .cs-touch.tilt [data-c="cal"] { display: flex; }
.cs-touch [data-c="tilt"].on { background: rgba(53,214,255,.55); color: ${C.ink}; text-shadow: none; }
/* The race HUD makes room for the thumbs: speed at the top centre, no camera hint. */
body.cs-touch-on .cs-hud .speedo { right: auto; left: 50%; bottom: auto; top: 62px; width: 170px; padding: 8px 12px; transform: translateX(-50%); }
body.cs-touch-on .cs-hud .speedo .mph { font-size: 24px; } body.cs-touch-on .cs-hud .speedo .gear { width: 34px; height: 34px; font-size: 16px; }
body.cs-touch-on .cs-hud .speedo .revs, body.cs-touch-on .cs-hud .speedo .box2 { display: none; }
body.cs-touch-on .cs-hud .cam { display: none; }
.cs-rotate { position: fixed; inset: 0; z-index: 95; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 22px;
  padding: 16px; box-sizing: border-box; background: ${C.ink}; color: ${C.text}; font-family: ${PIXEL_FONT}; font-size: 12px; line-height: 2; text-align: center; }
.cs-rotate .ph { width: 54px; height: 90px; border: 4px solid ${C.yellow}; border-radius: 10px; animation: cs-rot 2s ease-in-out infinite; }
@keyframes cs-rot { 0%, 30% { transform: none; } 60%, 100% { transform: rotate(-90deg); } }
@media (orientation: portrait) { body.cs-touchdev .cs-rotate { display: flex; } }
`;

const ARROW_L = '<svg viewBox="0 0 10 10"><polygon points="1,5 8,1 8,9"/></svg>';
const ARROW_R = '<svg viewBox="0 0 10 10"><polygon points="9,5 2,1 2,9"/></svg>';
const HELD = ['left', 'right', 'gas', 'brake', 'up', 'down'] as const;
type Held = (typeof HELD)[number];
const KEY = 'cs.touch';
/** Degrees of tilt for full lock. */
const TILT_FULL = 22;
const TILT_DEAD = 0.12;

export interface TouchHost {
  /** A race is being driven right now (not paused, not a replay or the demo). */
  racing(): boolean;
  /** The race uses a manual gearbox (show the shift buttons). */
  manual(): boolean;
}

export class TouchControls {
  readonly el = document.createElement('div');
  private rotateEl = document.createElement('div');
  private fingers = new Map<number, string>();
  private held = new Set<Held>();
  private tilt = false;
  private tiltRaw = 0;
  private calib = 0;
  private pwm = 0;
  /** Touch was the last input used (keys hide the controls). */
  private touchMode: boolean;
  private shown = false;
  private wasRacing = false;

  constructor(private host: TouchHost) {
    addStyle('cs-touch-css', CSS);
    try {
      const s = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { tilt?: boolean; calib?: number };
      this.tilt = s.tilt === true;
      this.calib = typeof s.calib === 'number' ? s.calib : 0;
    } catch {
      // Defaults.
    }
    this.touchMode = matchMedia('(pointer: coarse)').matches;
    document.body.classList.add('cs-touchdev');
    this.el.className = 'cs-touch';
    this.el.innerHTML = `
      <div class="b" data-c="left">${ARROW_L}</div><div class="b" data-c="right">${ARROW_R}</div>
      <div class="tiltbar"><i></i><span>TILT TO STEER</span></div><div class="b" data-c="cal">CALIBRATE</div>
      <div class="b" data-c="brake">BRAKE</div><div class="b" data-c="gas">GAS</div>
      <div class="b" data-c="up">&#9650; UP</div><div class="b" data-c="down">&#9660; DOWN</div>
      <div class="b top" data-c="pause">II</div><div class="b top" data-c="cam">CAM</div><div class="b top" data-c="tilt">TILT</div>`;
    this.rotateEl.className = 'cs-rotate';
    this.rotateEl.innerHTML = '<div class="ph"></div><div>TURN YOUR PHONE SIDEWAYS<br />TO RACE</div>';
    document.body.append(this.el, this.rotateEl);
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const) this.el.addEventListener(t, (e) => this.pointer(e), { passive: false });
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') this.touchMode = true;
    });
    addEventListener('keydown', () => (this.touchMode = false));
    addEventListener('deviceorientation', (e) => this.orient(e));
    setTouchInput(() => this.input());
    this.syncTilt();
    const tick = () => {
      this.frame();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ tilt: this.tilt, calib: this.calib }));
    } catch {
      // This page only.
    }
  }

  private syncTilt() {
    this.el.classList.toggle('tilt', this.tilt);
    this.el.querySelector('[data-c="tilt"]')!.classList.toggle('on', this.tilt);
  }

  private orient(e: DeviceOrientationEvent) {
    const angle = screen.orientation?.angle ?? 0;
    // Held sideways, the phone turns like a steering wheel: in landscape that is beta (the device's long axis now
    // runs left-right), its sign set by which way the phone was turned.
    if (angle === 90) this.tiltRaw = e.beta ?? 0;
    else if (angle === 270 || angle === -90) this.tiltRaw = -(e.beta ?? 0);
    else this.tiltRaw = e.gamma ?? 0;
  }

  private tiltSteer(): number {
    const s = Math.max(-1, Math.min(1, (this.tiltRaw - this.calib) / TILT_FULL));
    return Math.abs(s) < TILT_DEAD ? 0 : s;
  }

  private pointer(e: PointerEvent) {
    e.preventDefault();
    const hit = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('.cs-touch [data-c]');
    const c = hit?.dataset.c ?? '';
    if (e.type === 'pointerdown') {
      this.touchMode = true;
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
      if (c === 'pause') pressKey('Escape');
      else if (c === 'cam') pressKey('KeyC');
      else if (c === 'tilt') void this.toggleTilt();
      else if (c === 'cal') {
        this.calib = this.tiltRaw;
        this.save();
      }
    }
    if (e.type === 'pointerup' || e.type === 'pointercancel') this.fingers.delete(e.pointerId);
    else if (e.type === 'pointerdown' || this.fingers.has(e.pointerId)) this.fingers.set(e.pointerId, c);
    this.held = new Set([...this.fingers.values()].filter((v): v is Held => (HELD as readonly string[]).includes(v)));
    for (const b of this.el.querySelectorAll<HTMLElement>('[data-c]')) b.classList.toggle('down', this.held.has(b.dataset.c as Held));
  }

  private async toggleTilt() {
    if (!this.tilt) {
      // iOS asks for permission, from a tap.
      const D = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
      if (typeof D.requestPermission === 'function') {
        const ok = await D.requestPermission().catch(() => 'denied');
        if (ok !== 'granted') return;
      }
      this.calib = this.tiltRaw;
    }
    this.tilt = !this.tilt;
    this.syncTilt();
    this.save();
  }

  /** The driving input from the touch controls (null while they are hidden). */
  input(): CarInput | null {
    if (!this.shown) return null;
    const h = this.held;
    let steer = (h.has('right') ? 1 : 0) - (h.has('left') ? 1 : 0);
    if (this.tilt) {
      const s = this.tiltSteer();
      this.pwm += Math.abs(s);
      steer = 0;
      if (this.pwm >= 1) {
        this.pwm -= 1;
        steer = Math.sign(s);
      }
    }
    return {
      throttle: h.has('gas') || h.has('up') ? 1 : 0,
      brake: h.has('brake') || h.has('down') ? 1 : 0,
      steer,
      shift: h.has('up') || h.has('down'),
    };
  }

  private frame() {
    const racing = this.host.racing();
    const portrait = innerHeight > innerWidth;
    // Turning the phone upright mid-race pauses it.
    if (racing && portrait) pressKey('Escape');
    const show = racing && this.touchMode && !portrait;
    if (show !== this.shown) {
      this.shown = show;
      this.el.classList.toggle('on', show);
      document.body.classList.toggle('cs-touch-on', show);
      if (!show) {
        this.fingers.clear();
        this.held.clear();
        for (const b of this.el.querySelectorAll('.down')) b.classList.remove('down');
      }
    }
    if (racing !== this.wasRacing) {
      this.wasRacing = racing;
      this.el.classList.toggle('manual', this.host.manual());
    }
    if (show && this.tilt) this.el.querySelector<HTMLElement>('.tiltbar i')!.style.left = `${50 + this.tiltSteer() * 45}%`;
  }

  /** Test handle. */
  handle() {
    return {
      shown: () => this.shown,
      held: () => [...this.held],
      /** One step's input, as the race would read it (advances the tilt duty cycle). */
      input: () => this.input(),
      tilt: () => this.tilt,
      /** Simulate the phone's tilt (degrees, after the orientation mapping). */
      setTilt: (deg: number) => (this.tiltRaw = deg),
    };
  }
}
