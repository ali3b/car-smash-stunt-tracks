// The editor's document operations (src/editor/doc.ts): placing with overlap and terrain checks, moving, rotating,
// terrain and water painting, undo/redo, and reading track files.
import { describe, expect, test } from 'vitest';
import { EditorDoc, emptyTrack, parseTrack } from '../src/editor/doc';

describe('placing pieces', () => {
  test('place, then overlap is refused unless replacing', () => {
    const d = new EditorDoc();
    expect(d.place({ x: 3, z: 3, kind: 'corner-large', rot: 0 }).ok).toBe(true);
    expect(d.pieceAt(4, 4)).toBe(0);
    const r = d.place({ x: 4, z: 4, kind: 'straight', rot: 0 });
    expect(r).toMatchObject({ ok: false, reason: 'occupied' });
    expect(d.place({ x: 4, z: 4, kind: 'straight', rot: 0 }, true).ok).toBe(true);
    expect(d.track.pieces).toEqual([{ x: 4, z: 4, kind: 'straight', rot: 0 }]);
  });

  test('pieces must fit on the map', () => {
    const d = new EditorDoc();
    expect(d.place({ x: 29, z: 0, kind: 'loop', rot: 1 })).toMatchObject({ ok: false, reason: 'off the map' });
    expect(d.place({ x: 29, z: 28, kind: 'loop', rot: 0 }).ok).toBe(true);
  });

  test('surfaces stick only to kinds that have them; paved is the default and not stored', () => {
    const d = new EditorDoc();
    d.place({ x: 0, z: 0, kind: 'straight', rot: 0, surface: 'ice' });
    d.place({ x: 1, z: 0, kind: 'loop', rot: 0, surface: 'ice' });
    d.place({ x: 2, z: 0, kind: 'straight', rot: 0, surface: 'paved' });
    expect(d.track.pieces.map((p) => p.surface)).toEqual(['ice', undefined, undefined]);
  });

  test('rotating a multi-tile piece into another is refused; moving checks the new spot', () => {
    const d = new EditorDoc();
    d.place({ x: 5, z: 5, kind: 'loop', rot: 0 });
    d.place({ x: 6, z: 5, kind: 'straight', rot: 0 });
    expect(d.rotate(0)).toMatchObject({ ok: false, reason: 'occupied' });
    expect(d.update(0, { x: 7 })).toMatchObject({ ok: true });
    expect(d.update(0, { x: 6 })).toMatchObject({ ok: false });
    expect(d.rotate(0).ok).toBe(true);
    expect(d.track.pieces[0]).toMatchObject({ x: 7, rot: 1 });
  });

  test('terrain refuses a road in water', () => {
    const d = new EditorDoc();
    d.setWater(2, 2, true);
    expect(d.place({ x: 2, z: 2, kind: 'straight', rot: 0 })).toMatchObject({ ok: false, reason: 'roads can’t sit in water' });
    expect(d.place({ x: 2, z: 2, kind: 'elevated', rot: 0 }).ok).toBe(true);
  });
});

describe('terrain', () => {
  test('hill tool raises four corners; a corner next to water is refused', () => {
    const d = new EditorDoc();
    d.setTile(3, 3, 1);
    expect([d.track.heights[3][3], d.track.heights[4][4]]).toEqual([1, 1]);
    d.setWater(6, 6, true);
    expect(d.setCorner(7, 7, 1)).toMatchObject({ ok: false });
    expect(d.setWater(3, 3, true)).toMatchObject({ ok: false, reason: 'water needs flat ground: lower the hill first' });
  });

  test('water under a road is refused, under a deck allowed', () => {
    const d = new EditorDoc();
    d.place({ x: 1, z: 1, kind: 'straight', rot: 0 });
    d.place({ x: 2, z: 1, kind: 'elevated', rot: 0 });
    expect(d.setWater(1, 1, true).ok).toBe(false);
    expect(d.setWater(2, 1, true).ok).toBe(true);
  });
});

describe('undo and redo', () => {
  test('each edit is one step; a batch is one step; redo replays', () => {
    const d = new EditorDoc();
    d.place({ x: 0, z: 0, kind: 'straight', rot: 0 });
    d.beginBatch();
    d.setTile(5, 5, 1);
    d.setTile(6, 5, 1);
    d.endBatch();
    d.undo();
    expect(d.track.heights[5][5]).toBe(0);
    expect(d.track.pieces.length).toBe(1);
    d.undo();
    expect(d.track.pieces.length).toBe(0);
    expect(d.canUndo).toBe(false);
    d.redo();
    d.redo();
    expect(d.track.heights[5][7]).toBe(1);
  });

  test('a batch that changed nothing leaves no undo step', () => {
    const d = new EditorDoc();
    d.beginBatch();
    d.endBatch();
    expect(d.canUndo).toBe(false);
  });

  test('listeners hear every change', () => {
    const d = new EditorDoc();
    let n = 0;
    d.onChange(() => n++);
    d.place({ x: 0, z: 0, kind: 'straight', rot: 0 });
    d.undo();
    d.redo();
    expect(n).toBe(3);
  });
});

describe('track files', () => {
  test('round trip', () => {
    const t = emptyTrack('mine', 'desert');
    t.pieces.push({ x: 1, z: 2, kind: 'split-small', rot: 3, variant: 'b', surface: 'dirt' });
    t.water[4][4] = 'NW';
    expect(parseTrack(JSON.parse(JSON.stringify(t)))).toEqual(t);
  });

  test('rejects what is not a track', () => {
    expect(() => parseTrack({})).toThrow(/not a track file/);
    expect(() => parseTrack({ ...emptyTrack(), heights: [] })).toThrow(/heights/);
    expect(() => parseTrack({ ...emptyTrack(), pieces: [{ kind: 'straight' }] })).toThrow(/piece 0/);
  });

  test('cleans up odd values', () => {
    const t = parseTrack({ ...emptyTrack(), name: '  ', scenery: 'moon', pieces: [{ x: 1, z: 1, kind: 'straight', rot: 6 }] });
    expect(t.name).toBe('untitled');
    expect(t.scenery).toBe('country');
    expect(t.pieces[0].rot).toBe(2);
  });
});
