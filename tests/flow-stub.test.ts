import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { StubRaceSession } from '../src/game/stub-session';
import { encodeInputByte, INPUT_ACCEL, INPUT_LEFT, INPUT_SHIFT_UP } from '../src/sim/input';
import type { RaceSetup } from '../src/game/types';
import type { TrackFile } from '../src/track/types';

const track = JSON.parse(fs.readFileSync('src/track/tracks/test-oval.json', 'utf8')) as TrackFile;
const setup: RaceSetup = { trackId: 'test-oval', track, carId: 'car-rally', paint: null, opponentId: 'lena', gearbox: 'auto' };

describe('input byte', () => {
  it('encodes the original-style bits', () => {
    expect(encodeInputByte({ throttle: 1, brake: 0, steer: -1, shift: false })).toBe(INPUT_ACCEL | INPUT_LEFT);
    expect(encodeInputByte({ throttle: 1, brake: 0, steer: 0, shift: true })).toBe(INPUT_ACCEL | INPUT_SHIFT_UP);
    expect(encodeInputByte({ throttle: 0, brake: 1, steer: 0.7, shift: true })).toBe(0b100110);
  });
});

describe('stub race session', () => {
  it('finishes a lap of the test oval on full throttle and replays identically', () => {
    const a = new StubRaceSession();
    a.start(setup);
    for (let i = 0; i < 20 * 600 && !a.result(); i++) a.step(INPUT_ACCEL);
    const r = a.result()!;
    expect(r.finished).toBe(true);
    expect(r.won).not.toBeNull();
    const b = new StubRaceSession();
    b.start(setup);
    for (const byte of a.inputs()) b.step(byte);
    expect(b.result()).toEqual(r);
  });
});
