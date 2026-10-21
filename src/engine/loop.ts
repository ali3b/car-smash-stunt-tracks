// The main loop: physics at a fixed 60 Hz (accumulator), rendering once per animation frame.
// A slow frame runs at most MAX_STEPS steps, so a very slow machine (or SwiftShader) slows the game down instead of
// spiralling. Tests read the simulated time (window.__cs.simTime), never wall time.
export const STEP = 1 / 60;
const MAX_STEPS = 6;

export interface LoopHooks {
  step(dt: number): void;
  render(alpha: number, frameDt: number): void;
}

export class Loop {
  simTime = 0;
  steps = 0;
  fps = 0;
  private acc = 0;
  private last = 0;
  private running = false;
  private frames = 0;
  private fpsT = 0;

  constructor(private hooks: LoopHooks) {}

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  stop() {
    this.running = false;
  }

  /** Run n fixed steps right now (tests and tools). */
  advance(seconds: number) {
    const n = Math.round(seconds / STEP);
    for (let i = 0; i < n; i++) this.tick();
  }

  private tick() {
    this.hooks.step(STEP);
    this.simTime += STEP;
    this.steps++;
  }

  private frame = (now: number) => {
    if (!this.running) return;
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    this.acc += dt;
    let n = 0;
    while (this.acc >= STEP && n < MAX_STEPS) {
      this.tick();
      this.acc -= STEP;
      n++;
    }
    if (n === MAX_STEPS) this.acc = 0;
    this.frames++;
    this.fpsT += dt;
    if (this.fpsT >= 0.5) {
      this.fps = this.frames / this.fpsT;
      this.frames = 0;
      this.fpsT = 0;
    }
    this.hooks.render(this.acc / STEP, dt);
    requestAnimationFrame(this.frame);
  };
}
