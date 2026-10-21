import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TrackBuilder, type Turtle } from '../src/track/author';
import { DESIGNS } from '../src/track/designs';
import { TRACKS } from '../src/track/tracks';
import { validateTrack } from '../src/track/validate';
import type { TrackFile } from '../src/track/types';

/** A rectangle: start at (5,5) heading east, `east` tiles of road along the bottom, `north` up the sides. */
function oval(b: TrackBuilder, bottom: (t: Turtle) => Turtle = (t) => t.straight(6), north = 4): Turtle {
  const t = bottom(b.start(5, 5, 'E')).left('large').straight(north).left('large');
  return t;
}

/** Close an oval: back along the top as far as the bottom leg went, and down to the start line. */
function closeOval(t: Turtle, north = 4) {
  t.straight(t.x - t.b.startAt!.x + 1).left('large').straight(north).left('large').close();
}

describe('validateTrack', () => {
  it('accepts a closed circuit and measures the lap', () => {
    const b = new TrackBuilder('oval', 'country');
    closeOval(oval(b));
    const v = validateTrack(b.track);
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.lap.closed).toBe(true);
    expect(v.lap.pieces).toBe(b.pieces.length);
    expect(v.lap.jumps).toEqual([]);
  });

  it('reports a gap in the road and a circuit that does not close', () => {
    const b = new TrackBuilder('broken', 'country');
    closeOval(oval(b));
    const t: TrackFile = { ...b.track, pieces: b.pieces.filter((p, i) => i !== 3) };
    const v = validateTrack(t);
    expect(v.ok).toBe(false);
    expect(v.lap.closed).toBe(false);
    expect(v.errors.some((e) => /^open end/i.test(e))).toBe(true);
  });

  it('reports overlapping pieces and pieces off the grid', () => {
    const b = new TrackBuilder('overlap', 'country');
    closeOval(oval(b));
    const t = b.track;
    expect(validateTrack({ ...t, pieces: [...t.pieces, { x: 7, z: 5, kind: 'scenery', rot: 0, variant: 'tree' }] }).errors.some((e) => e.includes('overlaps'))).toBe(true);
    expect(validateTrack({ ...t, pieces: [...t.pieces, { x: 29, z: 29, kind: 'corner-large', rot: 0 }] }).errors.some((e) => e.includes('leaves the grid'))).toBe(true);
  });

  it('reports a level mismatch (a ramp up straight onto a ground road)', () => {
    const b = new TrackBuilder('mismatch', 'country');
    closeOval(oval(b));
    const t = b.track;
    const i = t.pieces.findIndex((p) => p.kind === 'straight' && p.z === 5 && p.x === 7);
    const pieces = t.pieces.map((p, j) => (j === i ? { ...p, kind: 'ramp' as const, rot: 1 as const } : p));
    const v = validateTrack({ ...t, pieces });
    expect(v.errors.some((e) => e.includes('level mismatch'))).toBe(true);
  });

  it('follows a jump from an elevated end over empty tiles to a landing ramp', () => {
    const b = new TrackBuilder('jump', 'desert');
    b.lake(9, 0, 10, 4, false);
    const t = oval(b, (t) => t.straight(2).jump(2).straight(1));
    closeOval(t);
    const v = validateTrack(b.track);
    expect(v.errors).toEqual([]);
    expect(v.lap.jumps).toEqual([{ from: { x: 8, z: 5 }, to: { x: 11, z: 5 }, gap: 2 }]);
    expect(v.warnings.some((w) => w.includes('flies over 2 tiles'))).toBe(true);
  });

  it('rejects a jump that is too long or has no landing; warns about one over scenery or too long to clear', () => {
    const long = new TrackBuilder('long', 'desert');
    closeOval(oval(long, (t) => t.straight(1).ramp('up').skip(5).ramp('down')));
    expect(validateTrack(long.track).errors.some((e) => e.includes('longer than'))).toBe(true);

    const blocked = new TrackBuilder('blocked', 'desert');
    closeOval(oval(blocked, (t) => t.straight(1).jump(2).straight(1)));
    blocked.prop('cactus', 8, 5);
    expect(validateTrack(blocked.track).warnings.some((e) => e.includes('flies over scenery'))).toBe(true);

    // A ground road has no jump: an open end in front of an empty tile is a dead end.
    const dead = new TrackBuilder('dead', 'desert');
    closeOval(oval(dead));
    const gap = { ...dead.track, pieces: dead.pieces.filter((p) => !(p.z === 5 && (p.x === 8 || p.x === 9))) };
    expect(validateTrack(gap).errors.some((e) => e.includes('dead end'))).toBe(true);
  });

  it('checks which way a banked section leans', () => {
    const b = new TrackBuilder('bank', 'country');
    const t = b.start(5, 5, 'E').straight(1).bank('L').banked(1).bankedTurn('L').banked(1).unbank().straight(2).left('large');
    closeOval(t);
    expect(validateTrack(b.track).errors).toEqual([]);
    // Swap the first bank entry for its mirror image: it now leans the wrong way into the banked road.
    const pieces = b.pieces.map((p) => (p.kind === 'bank-entry' && p.x === 7 ? { ...p, variant: p.variant === 'a' ? 'b' : 'a' } : p));
    expect(validateTrack({ ...b.track, pieces }).errors.some((e) => e.includes('level mismatch'))).toBe(true);
  });

  it('accepts a fork whose branch rejoins, and rejects one whose branch ends nowhere', () => {
    const make = (rejoin: boolean) => {
      const b = new TrackBuilder('fork', 'city');
      const main = b.start(5, 5, 'E').straight(1);
      const branch = main.fork('L');
      main.straight(5).merge('L').left('large').straight(4).left('large');
      closeOval(main);
      branch.straight(1).right('small').straight(5).right('small');
      if (rejoin) branch.straight(1).join();
      return b.track;
    };
    const ok = validateTrack(make(true));
    expect(ok.errors).toEqual([]);
    const bad = validateTrack(make(false));
    expect(bad.errors.some((e) => /^open end/i.test(e))).toBe(true);
  });

  it('lets a road climb a hill and an elevated deck leave the hill top', () => {
    const b = new TrackBuilder('hill', 'alpine');
    b.hill(9, 3, 12, 8);
    // East along z=5 over the hill: slope at x=8, top 9..12, then off the east edge: a ramp laid down the slope (a
    // level deck carried from the hill top), a deck and a ramp down.
    const t = b.start(5, 5, 'E').straight(2).straight(1).straight(4).ramp('up').deck(1).ramp('down').left('large').straight(4).left('large');
    closeOval(t);
    expect(validateTrack(b.track).errors).toEqual([]);
    // A plain deck on the slope instead: the physics would ignore it.
    const deck = b.pieces.findIndex((p) => p.kind === 'ramp' && p.x === 13);
    const pieces = b.pieces.map((p, i) => (i === deck ? { ...p, kind: 'elevated' as const } : p));
    expect(validateTrack({ ...b.track, pieces }).errors.some((e) => e.includes('sloping ground'))).toBe(true);
    // A ramp climbing the slope the other way is refused too.
    const up = b.pieces.map((p, i) => (i === deck ? { ...p, rot: ((p.rot + 2) % 4) as 0 | 1 | 2 | 3 } : p));
    expect(validateTrack({ ...b.track, pieces: up }).errors.some((e) => e.includes('off the hill top'))).toBe(true);
  });

  it('rejects pieces that do not suit the ground under them', () => {
    const b = new TrackBuilder('ground', 'alpine');
    closeOval(oval(b));
    // A corner on a slope.
    const slope = { ...b.track, heights: b.track.heights.map((r, z) => r.map((h, x) => (z >= 6 && x >= 12 ? 1 : h))) };
    expect(validateTrack(slope).errors.some((e) => e.includes('sloping ground'))).toBe(true);
    // A road in a lake, and a diagonal hill tile.
    const wet = { ...b.track, water: b.track.water.map((r, z) => r.map((w, x) => (z === 5 && x === 8 ? true : w))) };
    expect(validateTrack(wet).errors.some((e) => e.includes('sit in water'))).toBe(true);
    const diag = { ...b.track, heights: b.track.heights.map((r, z) => r.map((h, x) => ((x === 20 && z === 20) || (x === 21 && z === 21) ? 1 : h))) };
    expect(validateTrack(diag).errors.some((e) => e.includes('diagonal'))).toBe(true);
  });

  it('needs exactly one start line', () => {
    const b = new TrackBuilder('none', 'country');
    closeOval(oval(b));
    const pieces = b.pieces.map((p) => (p.kind === 'start-finish' ? { ...p, kind: 'straight' as const } : p));
    expect(validateTrack({ ...b.track, pieces }).errors.some((e) => /no start-finish/i.test(e))).toBe(true);
  });
});

describe('bundled tracks', () => {
  it('every designed track builds to the committed JSON and validates; other bundled tracks validate', () => {
    for (const info of TRACKS) {
      const design = DESIGNS[info.id];
      if (!design) {
        // A hand-made check track (e.g. test-oval): no design file, but it must still be a closed circuit.
        const v = validateTrack(info.track);
        expect(v.errors, info.id).toEqual([]);
        expect(v.lap.closed, info.id).toBe(true);
        continue;
      }
      const t = design();
      const v = validateTrack(t);
      expect(v.errors, info.id).toEqual([]);
      expect(v.lap.closed).toBe(true);
      expect(t.name).toBe(info.name);
      expect(t.scenery).toBe(info.scenery);
      const file = path.resolve('src/track/tracks', `${info.id}.json`);
      expect(JSON.parse(fs.readFileSync(file, 'utf8')), `${info.id}.json is stale: run scripts/build-tracks.ts`).toEqual(JSON.parse(JSON.stringify(t)));
    }
  });
});
