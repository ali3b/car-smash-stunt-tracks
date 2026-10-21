// Engine, gearbox, speed and steering: the first part of a car's 20 Hz step (research/SPEC.md "Car physics" §2-3).
import type { CarParams, CarState, SimRules } from './car';
import { abs16, s16, u16 } from './fixed';

/** Input byte bits (one byte per frame, as replays store it). */
export const INPUT_ACCEL = 0x01;
export const INPUT_BRAKE = 0x02;
export const INPUT_RIGHT = 0x04;
export const INPUT_LEFT = 0x08;
export const INPUT_SHIFT_UP = 0x10;
export const INPUT_SHIFT_DOWN = 0x20;

/** Top speed: 0xF500 = 245 mph. */
export const MAX_SPEED = 0xf500;
const KNOB_STEP = 6;

/** Aerodynamic drag table, 64 entries indexed by speed >> 10: aero * i^2 / 512 (truncated). */
export function aeroTable(aero: number): Int16Array {
  const t = new Int16Array(64);
  for (let i = 0; i < 64; i++) t[i] = Math.trunc((aero * i * i) / 0x200);
  return t;
}

const aeroCache = new Map<number, Int16Array>();
function aeroAt(aero: number, speed: number): number {
  let t = aeroCache.get(aero);
  if (!t) aeroCache.set(aero, (t = aeroTable(aero)));
  return t[speed >> 10];
}

/** Engine rpm for a wheel speed: speed * ratio >> 16, never below idle; frozen while the clutch is out. */
export function rpmFromSpeed(rpm: number, speed: number, ratio: number, shifting: boolean, idle: number): number {
  let r = shifting ? u16(rpm) : Math.floor((speed * ratio) / 0x10000);
  if (r < u16(idle)) r = u16(idle);
  return s16(r);
}

export interface SpeedOptions {
  /** Opponent cars brake twice as hard and scale their drive force by their skill. */
  opponent?: boolean;
  /** Opponent skill byte (0..200): drive force is reduced by (200 - skill) / 2 / 200. */
  opponentSkill?: number;
}

/**
 * Start of a player frame: the engine-sound flags restart at "running" (bit 0); a crashed car that has stopped goes
 * silent. Returns the input actually used: a crashed car only brakes.
 */
export function beginFrame(c: CarState, input = 0): number {
  c.soundFlags = 1;
  if (c.crash !== 0) {
    if (c.speed2 === 0) c.soundFlags = 0;
    return INPUT_BRAKE;
  }
  return input;
}

/** Engine, gearbox and longitudinal speed for one frame. Mutates `c`. */
export function updateSpeed(c: CarState, p: CarParams, input: number, opt: SpeedOptions = {}): void {
  if (c.limiterTimer > 0) c.limiterTimer--;
  c.speedDelta = s16(c.speed2 - c.lastSpeed);
  c.lastSpeed = c.speed2;
  c.lastRpm = c.rpm;

  // Gear changes: manual on the shift buttons, automatic on rpm while the rear wheels are on the ground.
  let shift = 0;
  if (!c.automatic && !c.shifting) {
    if (input & INPUT_SHIFT_UP) shift = 1;
    else if (input & INPUT_SHIFT_DOWN) shift = -1;
  } else if (c.gear !== 0 && !c.shifting && c.surfRear !== 0) {
    if (u16(c.rpm) > p.upshiftRpm) shift = 1;
    else if (u16(c.rpm) < p.downshiftRpm) shift = -1;
  }
  if (shift > 0 && c.gear !== p.gears) {
    c.gear++;
    startShift(c, p);
  } else if (shift < 0 && c.gear > 1) {
    c.gear--;
    startShift(c, p);
  }

  // The gear-stick knob travels to the new gate at 6 px per frame; the clutch engages when it arrives.
  if (c.shifting) {
    if (c.knobX === c.knobTargetX) {
      if (c.knobY < c.knobTargetY) c.knobY += KNOB_STEP;
      else if (c.knobY > c.knobTargetY) c.knobY -= KNOB_STEP;
      else {
        c.shifting = false;
        c.gearRatio = p.gearRatios[c.gear];
      }
    } else {
      const neutralY = p.knobPoints[0][1];
      if (neutralY === c.knobY) c.knobX += c.knobX < c.knobTargetX ? KNOB_STEP : -KNOB_STEP;
      else if (neutralY > c.knobY) c.knobY += KNOB_STEP;
      else c.knobY -= KNOB_STEP;
    }
  } else if (c.shiftTimer > 0) {
    c.shiftTimer--;
  }

  c.rpm = rpmFromSpeed(c.rpm, c.speed, c.gearRatio, c.shifting, c.idleRpm);

  let spd = c.speed;
  let d = s16(c.slopeForce - aeroAt(p.aero, spd));
  if (u16(c.rpm) > p.maxRpm) {
    d = s16(d - p.braking);
  } else {
    switch (input & 3) {
      case INPUT_ACCEL:
        c.braking = false;
        c.accelerating = true;
        if (c.shifting) {
          c.limiterTimer = 0;
          c.rpm = s16(c.rpm - 50);
        } else if (c.surfRear === 0) {
          // In the air the throttle only spins the wheels up.
          if (u16(c.rpm) < p.maxRpm && spd < 0xfa00) d = s16(d + 0x300);
        } else {
          let t: number;
          if (c.gear <= 1 && c.rpm < 2600) t = p.launchTorque;
          else t = p.torque[u16(c.rpm) >> 7] ?? 0;
          if (c.limiterTimer !== 0 && c.rpm < 5000) t = (p.launchTorque + t) >> 1;
          d = s16(d + ((((c.gearRatio >> 8) * t) & 0xffff) >> 4));
          // d * 25 / mass as unsigned 32-bit, then halved toward zero.
          const q = s16(Math.floor(((d * 25) >>> 0) / p.mass));
          d = q < 0 ? -(-q >> 1) : q >> 1;
          if (opt.opponent) {
            const f = ((200 - (opt.opponentSkill ?? 0)) & 0xffff) >> 1;
            if ((f & 0xff) !== 0) d = s16(d - Math.trunc((d * (f & 0xff)) / 200));
          }
          if (d > 0x128) c.limiterTimer = 5;
        }
        break;
      case INPUT_BRAKE:
        c.accelerating = false;
        c.limiterTimer = 0;
        c.braking = true;
        d = s16(d - (opt.opponent ? p.braking * 2 : p.braking));
        break;
      default:
        c.accelerating = false;
        c.braking = false;
    }
  }

  if (d >= 0) {
    spd = u16(spd + d);
    if (spd > MAX_SPEED) spd = MAX_SPEED;
  } else if (-d > spd) {
    spd = 0;
  } else {
    spd = u16(spd + d);
  }

  if (c.surfRear !== 0) {
    if (abs16(c.speed2 - spd) > 0x1400) {
      // Wheel spin / lock: wheel speed and ground speed meet halfway.
      c.speed = (c.speed + c.speed2) >>> 1;
      c.speed2 = c.speed;
      c.limiterTimer = 5;
    } else {
      c.speed = spd;
      c.speed2 = spd;
    }
  } else {
    c.speed = spd;
  }

  c.rpm = rpmFromSpeed(c.rpm, c.speed, c.gearRatio, c.shifting, c.idleRpm);
  if (c.surfAll !== 0 && c.lastRpm > c.rpm && s16(c.lastRpm - c.rpm) > 2000) {
    if (s16(((c.gearRatio >> 8) * p.launchTorque) & 0xffff) > 0x2ee0) c.limiterTimer = 30;
  }
}

function startShift(c: CarState, p: CarParams): void {
  c.shifting = true;
  c.shiftTimer = 30;
  c.knobTargetX = p.knobPoints[c.gear][0];
  c.knobTargetY = p.knobPoints[c.gear][1];
}

/** Steering for one frame from input bits 2/3. Uses speed2 for the speed band. Mutates `c`. */
export function updateSteering(c: CarState, rules: SimRules, input: number): void {
  const keys = (input >> 2) & 3; // 1 right, 2 left, 3 both
  const band = c.speed2 >> 12;
  const rate = rules.steerRate[band];
  const rateFor = (k: number) => (k === 1 ? rate : k === 2 ? -rate : 0);
  let di = c.steering;
  let si = rateFor(keys);
  // Counter-steering is four times as fast.
  if (si > 0) {
    if (di < -1) si <<= 2;
  } else if (si < 0) {
    if (di > 1) si <<= 2;
  }
  if (si === 0 && c.speed2 !== 0 && di !== 0) {
    // No key: return towards the centre at twice the band's rate.
    const r = rate * 2;
    const a = di < 0 ? -di : di;
    if (a <= r) si = -di;
    else si = di > 0 ? -r : r;
  }
  if (si > 0x50) si = 0x50;
  if (si < -0x50) si = -0x50;
  di += si;
  if (di > 0xf0) di = 0xf0;
  if (di < -0xf0) di = -0xf0;
  if (rateFor(keys) === 0 && Math.abs(di) < 8) di = 0;
  c.steering = di;
}
