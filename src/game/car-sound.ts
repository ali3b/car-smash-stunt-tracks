// What a simulated car sounds like at one 20 Hz step, read from the simulation's own state (src/sim/car.ts): engine
// speed and how hard it pulls, tyre slip per wheel (the grip the turn demands against the grip each wheel's surface
// gives; a spin; wheel-spin off the line), the surface under the wheels, wall contact, and one-off hits (landing after
// air, suspension knocks, wall and car-to-car impacts). The race session puts it in every snapshot (CarState.sound),
// so live races and replays sound the same; src/game/race-audio.ts turns it into audio events.
import type { Surface } from '../audio/sfx';
import type { CarParams, CarState as SimCar } from '../sim/car';
import { SurfaceCode } from '../sim/surface';

export type CarHitKind = 'land' | 'bump' | 'wall' | 'car';
export interface CarHit {
  kind: CarHitKind;
  /** 0..1. */
  strength: number;
}

export interface CarSound {
  /** Engine speed 0 (idle) .. 1 (rev limit). */
  rpm: number;
  /** Pedal 0..1. */
  throttle: number;
  /** How hard the engine pulls, 0..1 (≈0 with the driven wheels in the air or the clutch out). */
  load: number;
  /** Tyre slip 0..1 per wheel: front-left, front-right, rear-left, rear-right. */
  slip: [number, number, number, number];
  /** Surface under most of the wheels on the ground. */
  surface: Surface;
  /** At least one wheel on the ground. */
  grounded: boolean;
  /** Sliding along a wall, 0..1. */
  scrape: number;
  /** Hits during this step. */
  hits: CarHit[];
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** 0 below a, 1 above b, smooth in between. */
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

const SURFACE_NAME: Record<number, Surface> = {
  [SurfaceCode.Paved]: 'paved',
  [SurfaceCode.Dirt]: 'dirt',
  [SurfaceCode.Ice]: 'ice',
  [SurfaceCode.Ground]: 'grass',
  [SurfaceCode.Water]: 'grass',
};
/** Sim wheel order (fl, fr, rr, rl) → sound order (fl, fr, rl, rr). */
const TO_SOUND = [0, 1, 3, 2] as const;

/** Soundflag bits of the simulation (src/sim/car.ts soundFlags). */
const FLAG_WALL = 0x10;

/** wheelA (fall distance while airborne) at which the sim calls a landing hard / a crash. */
const LAND_HARD = 0xbe;
const LAND_CRASH = 0x3a3;

/**
 * Slip of one wheel from the grip the turn demands vs. what the wheel's surface gives (ratio 1 = at the sim's limit,
 * where the car starts to slide). Tyres start to sing a little before the limit; on a slippery surface (gripFrac =
 * the surface's grip / full grip) they let go earlier and more gradually.
 */
export function lateralSlip(ratio: number, gripFrac = 1) {
  const start = 0.32 + 0.18 * clamp01(gripFrac);
  return smooth(start, start + 0.6, ratio);
}

/** Follows one car from step to step (a new tracker per race and car). */
export class CarSoundTracker {
  private car: SimCar | null = null;
  private prevA = [0, 0, 0, 0];
  private prevB = [0, 0, 0, 0];
  private prevAll = 4;
  private prevFlags = 0;
  private prevContact = false;
  private prevSpeed = 0;
  private bumpCool = 0;

  measure(c: SimCar, p: CarParams): CarSound {
    const fresh = c !== this.car;
    if (fresh) this.baseline(c);
    const mph = c.speed2 / 256;
    const grounded = c.surfAll !== 0;
    const driving = c.crash === 0;
    const throttle = driving && c.accelerating ? 1 : 0;
    const rpm = clamp01((c.rpm - p.idleRpm) / Math.max(1, p.maxRpm - p.idleRpm));

    // Load: pulling on the ground (more while accelerating hard or climbing), little with the clutch out or the
    // driven wheels in the air.
    const accel = Math.max(-0.3, Math.min(0.3, c.speedDelta / 900));
    const climb = Math.max(-0.25, Math.min(0.25, -c.slopeForce / 400));
    let load = throttle * clamp01(0.55 + accel + climb);
    if (c.surfRear === 0) load *= 0.15;
    if (c.shifting) load *= 0.2;

    // Slip per wheel.
    const slip: [number, number, number, number] = [0, 0, 0, 0];
    let surface: Surface = 'paved';
    if (grounded && driving) {
      const demand = Math.max(0, c.demandedGrip);
      const spin = c.spin !== 0 ? 0.95 : 0;
      const slide = smooth(24, 160, Math.abs(c.slideAngle));
      // Turning right (steering > 0) loads the left-hand (outer) wheels.
      const outerLeft = c.steering >= 0;
      // Wheel-spin off the line: a short chirp from the driven wheels.
      const wheelspin = throttle && c.limiterTimer > 0 && c.gear <= 1 && mph < 25 ? 0.3 : 0;
      const counts = new Map<Surface, number>();
      // Upside down or on its side the car is on a stunt's road, whatever the probe says about the ground there.
      const steep = Math.abs(c.pitch) > 128 || Math.abs(c.roll) > 128;
      for (let i = 0; i < 4; i++) {
        let s = c.wheelSurface[i];
        if (s === SurfaceCode.None) continue;
        if (steep && s === SurfaceCode.Ground) s = SurfaceCode.Paved;
        const name = SURFACE_NAME[s] ?? 'paved';
        counts.set(name, (counts.get(name) ?? 0) + 1);
        // The whole car's grip if every wheel stood on this wheel's surface.
        const sg = p.surfaceGrip[s] ?? 256;
        const avail = (p.grip * 2 * 4 * sg) / 1024;
        const lat = lateralSlip(demand / Math.max(1, avail), sg / 256);
        const left = i === 0 || i === 3;
        const rear = i >= 2;
        const side = left === outerLeft ? 1 : 0.75;
        const axle = rear ? 1 : 0.85;
        let v = Math.max(lat * side * axle, spin, slide * (rear ? 1 : 0.7), rear ? wheelspin : 0);
        // Very slow: no screech.
        v *= smooth(3, 12, mph);
        slip[TO_SOUND[i]] = clamp01(v);
      }
      // The road wins over the verge (a wheel on the grass beside a loop or a bridge edge).
      let best = 0;
      const road = ['paved', 'dirt', 'ice'].some((k) => counts.has(k as Surface));
      for (const [k, n] of counts) if ((!road || k !== 'grass') && (n > best || (n === best && k === 'paved'))) [best, surface] = [n, k];
    } else if (grounded) {
      for (const s of c.wheelSurface) if (s !== SurfaceCode.None) surface = SURFACE_NAME[s] ?? 'paved';
    }

    const wall = (c.soundFlags & FLAG_WALL) !== 0;
    const scrape = wall && mph > 2 ? clamp01(0.3 + mph / 90) : 0;

    // Hits.
    const hits: CarHit[] = [];
    if (!fresh) {
      if (grounded && this.prevAll === 0) {
        // Touchdown: how far the wheels fell (the sim's own landing measure).
        let fall = 0;
        for (let i = 0; i < 4; i++) if (c.wheelSurface[i] !== SurfaceCode.None) fall = Math.max(fall, this.prevA[i]);
        if (fall >= LAND_HARD * 0.55) hits.push({ kind: 'land', strength: clamp01(0.3 + (0.7 * (fall - LAND_HARD * 0.55)) / (LAND_CRASH - LAND_HARD * 0.55)) });
        else if (fall > 20) hits.push({ kind: 'bump', strength: clamp01(0.15 + fall / (LAND_HARD * 0.55)) * 0.6 });
        this.bumpCool = 4;
      } else if (grounded && this.bumpCool <= 0 && mph > 10) {
        // Suspension knock: a wheel's spring jumping (kerb, piece seam, a kink in the road).
        let jolt = 0;
        for (let i = 0; i < 4; i++) if (c.wheelSurface[i] !== SurfaceCode.None) jolt = Math.max(jolt, Math.abs(c.wheelB[i] - this.prevB[i]));
        if (jolt >= 0x70) {
          hits.push({ kind: 'bump', strength: Math.min(0.9, 0.2 + (jolt - 0x70) / 0x100) });
          this.bumpCool = 5;
        }
      }
      if (wall && !(this.prevFlags & FLAG_WALL)) {
        const lost = Math.max(0, (this.prevSpeed - c.speed2) / 256);
        hits.push({ kind: 'wall', strength: clamp01(0.2 + lost / 25 + mph / 160) });
      }
      const contact = c.fieldAE === 1;
      if (contact && !this.prevContact) {
        const lost = Math.abs(this.prevSpeed - c.speed2) / 256;
        hits.push({ kind: 'car', strength: clamp01(0.3 + lost / 20) });
      }
      this.prevContact = contact;
    }
    this.bumpCool--;
    this.prevA = [...c.wheelA];
    this.prevB = [...c.wheelB];
    this.prevAll = c.surfAll;
    this.prevFlags = c.soundFlags;
    this.prevSpeed = c.speed2;
    return { rpm, throttle, load, slip, surface, grounded, scrape, hits };
  }

  private baseline(c: SimCar) {
    this.car = c;
    this.prevA = [...c.wheelA];
    this.prevB = [...c.wheelB];
    this.prevAll = c.surfAll;
    this.prevFlags = c.soundFlags;
    this.prevContact = c.fieldAE === 1;
    this.prevSpeed = c.speed2;
    this.bumpCool = 4;
  }
}
