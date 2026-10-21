// Grip: how much of the steering turns the car, sliding, spin and ground drag (research/SPEC.md "Car physics" §4).
import type { CarParams, CarState } from './car';
import { cos1024, fmul14, s16, sdivPow2, u16 } from './fixed';
import { SurfaceCode } from './surface';

/** Ground drag: speed loses speed / GROUND_DRAG[n] per frame with n wheels on plain ground (n = 0: none). */
const GROUND_DRAG = [0xffff, 256, 192, 128, 64];

export interface GripOptions {
  /** Opponents (computer cars) skip the slide model: they turn exactly as they steer. */
  opponent?: boolean;
}

/**
 * One frame of the grip model. `banked(tileX, tileZ)` says whether the tile under the car belongs to a banked wide
 * corner (rolling cars get extra turn there). Mutates `c`.
 */
export function updateGrip(
  c: CarState,
  p: CarParams,
  banked: (tileX: number, tileZ: number) => boolean,
  opt: GripOptions = {},
): void {
  if (c.surfAll === 0) {
    c.turn = 0;
    c.sliding = false;
    return;
  }
  let onGround = 0;
  for (const s of c.wheelSurface) if (s === SurfaceCode.Ground) onGround++;
  c.speed2 = u16(c.speed2 - Math.floor(c.speed2 / GROUND_DRAG[onGround]));
  c.speed = c.speed2;

  const steer = s16(c.steering + c.slideAngle);
  const mph = c.speed >> 8;
  const demanded = s16(u16(Math.abs(sdivPow2(steer, 3))) * (((mph * mph) & 0xffff) >> 6));
  let avail = 0;
  {
    const sum = s16(c.wheelSurface.reduce((a, s) => a + p.surfaceGrip[s], 0));
    avail = s16(Math.trunc((s16(p.grip * 2) * sum) / 1024));
  }
  c.demandedGrip = demanded;
  c.availableGrip = avail;

  let turn = steer;
  if (opt.opponent) {
    c.turn = s16(c.steering * 4);
    if (c.spin !== 0) c.spin = sdivPow2(s16(c.spin * 15), 4);
  } else {
    if (c.steering === 0) {
      // Driving straight: snap the heading onto the nearest multiple of 256 when within 8.
      let r = c.yaw & 0xff;
      if (r > 0x7f) r -= 0x100;
      if (r !== 0 && Math.abs(r) < 8) c.yaw = s16(c.yaw + (r > 0 ? -1 : 1));
    }
    if (demanded > avail) {
      c.sliding = true;
      // The turn the tyres can hold at this speed: avail * 256 / mph^2.
      let t = s16(Math.trunc((avail * 256) / (mph * mph)));
      if (steer < 0) t = s16(-t);
      t = sdivPow2(s16(t * 3 + steer), 2);
      turn = t;
      c.slip = s16(steer - t);
    } else {
      c.sliding = false;
      if (c.slip !== 0) {
        c.slip = s16(c.slip - sdivPow2(c.slip, 4));
        if (Math.abs(c.slip) < 16) c.slip = Math.trunc(c.slip / 2);
      }
    }
    c.turn = c.spin === 0 && c.crash !== 1 ? turn : 0;

    const ar = Math.abs(c.roll);
    if (c.roll !== 0 && ar > 4 && banked((c.pos[0] >> 16) & 0xff, (c.pos[2] >> 16) & 0xff)) {
      c.turn = s16(c.turn + Math.trunc(c.roll / 5));
    }

    if (s16(avail + 1000) < demanded) {
      c.spin = s16(c.spin + Math.trunc(s16(turn - steer) / 14));
      c.spin = Math.trunc(c.spin / 2);
    } else if (c.spin !== 0) {
      c.spin = s16(c.spin + Math.trunc(s16(turn - steer) / 14));
      c.spin = Math.trunc(c.spin / 2);
      if (c.spin === 0) {
        // The spin is over: keep only the part of the speed along the heading.
        const k = cos1024(c.slideAngle);
        c.speed2 = u16(fmul14(c.speed2, k));
        if (k < 0) c.speed2 = 0;
        c.slideAngle = 0;
      }
    }
  }

  if (c.slideAngle !== 0 && c.spin === 0) c.slideAngle = sdivPow2(s16(c.slideAngle * 15), 4);
  if (c.spin !== 0) c.slideAngle = s16(c.slideAngle - c.spin);

  if (c.sliding) {
    const loss = u16(Math.abs(s16(c.slip * 2)));
    if (c.speed > loss) {
      if (c.speed2 > loss) {
        c.speed = u16(c.speed - loss);
        c.speed2 = u16(c.speed2 - loss);
      } else {
        c.speed = 0;
        c.speed2 = 0;
      }
      c.soundFlags |= c.wheelSurface.includes(SurfaceCode.Paved) ? 2 : 4;
    } else {
      c.speed = 0;
      c.speed2 = 0;
    }
  }
  c.slip = 0;
}
