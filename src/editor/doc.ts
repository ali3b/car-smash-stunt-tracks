// The editor's document: a TrackFile plus undo/redo and the editing operations, each checked against the rules in
// validate.ts. Free of DOM and three.js (tests/editor-doc.test.ts).
import { KINDS_WITH_SURFACES, pieceDef } from '../track/pieces';
import { GRID, type Piece, type Rot, type Scenery, type TrackFile } from '../track/types';
import { footprintTiles, inGrid, occupancy, terrainProblem } from '../track/validate';

export type WaterValue = TrackFile['water'][number][number];

export function emptyTrack(name = 'new track', scenery: Scenery = 'country'): TrackFile {
  return {
    version: 1,
    name,
    scenery,
    pieces: [],
    heights: Array.from({ length: GRID + 1 }, () => new Array(GRID + 1).fill(0)),
    water: Array.from({ length: GRID }, () => new Array(GRID).fill(false)),
  };
}

const SCENERIES: Scenery[] = ['desert', 'tropical', 'alpine', 'city', 'country'];

/** Parse and check a TrackFile from untrusted JSON (an imported file, localStorage); throws with a reason. */
export function parseTrack(json: unknown): TrackFile {
  const t = json as Partial<TrackFile>;
  if (!t || typeof t !== 'object' || t.version !== 1) throw new Error('not a track file (version 1)');
  if (!Array.isArray(t.pieces)) throw new Error('track has no pieces list');
  const grid = (a: unknown, n: number) => Array.isArray(a) && a.length === n && a.every((r) => Array.isArray(r) && r.length === n);
  if (!grid(t.heights, GRID + 1)) throw new Error(`heights must be ${GRID + 1}×${GRID + 1}`);
  if (!grid(t.water, GRID)) throw new Error(`water must be ${GRID}×${GRID}`);
  const pieces: Piece[] = t.pieces.map((p, i) => {
    if (typeof p?.x !== 'number' || typeof p.z !== 'number' || typeof p.kind !== 'string') throw new Error(`piece ${i} is malformed`);
    const q: Piece = { x: p.x | 0, z: p.z | 0, kind: p.kind, rot: ((p.rot ?? 0) & 3) as Rot };
    if (p.surface && p.surface !== 'paved') q.surface = p.surface;
    if (p.variant) q.variant = p.variant;
    return q;
  });
  return {
    version: 1,
    name: typeof t.name === 'string' && t.name.trim() ? t.name.trim().slice(0, 40) : 'untitled',
    scenery: SCENERIES.includes(t.scenery as Scenery) ? (t.scenery as Scenery) : 'country',
    pieces,
    heights: t.heights!.map((r) => r.map((h) => (h ? 1 : 0))),
    water: t.water!.map((r) => r.map((w) => (w === 'NE' || w === 'SE' || w === 'SW' || w === 'NW' ? w : w === true))),
  };
}

export const clone = (t: TrackFile): TrackFile => JSON.parse(JSON.stringify(t)) as TrackFile;

export type Result = { ok: true } | { ok: false; reason: string };
const fail = (reason: string): Result => ({ ok: false, reason });
const OK: Result = { ok: true };

export class EditorDoc {
  track: TrackFile;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  /** Bumped on every change (the views redraw when it moves). */
  revision = 0;
  private listeners: (() => void)[] = [];

  constructor(track: TrackFile = emptyTrack()) {
    this.track = track;
  }

  onChange(f: () => void) {
    this.listeners.push(f);
  }

  private changed() {
    this.revision++;
    for (const f of this.listeners) f();
  }

  /** Snapshot for undo, before a change. */
  private save() {
    this.undoStack.push(JSON.stringify(this.track));
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Group several operations into one undo step (a drag that paints many tiles). */
  private batching = false;
  beginBatch() {
    this.save();
    this.batching = true;
  }
  endBatch() {
    this.batching = false;
    // A drag that changed nothing leaves no undo step.
    if (this.undoStack[this.undoStack.length - 1] === JSON.stringify(this.track)) this.undoStack.pop();
  }
  private edit(f: () => void) {
    if (!this.batching) this.save();
    f();
    this.changed();
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  undo() {
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(JSON.stringify(this.track));
    this.track = JSON.parse(s);
    this.changed();
  }
  redo() {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(JSON.stringify(this.track));
    this.track = JSON.parse(s);
    this.changed();
  }

  /** Replace the whole track (load, new, import): one undo step. */
  load(t: TrackFile) {
    this.edit(() => (this.track = t));
  }

  setMeta(meta: Partial<Pick<TrackFile, 'name' | 'scenery'>>) {
    this.edit(() => Object.assign(this.track, meta));
  }

  /** The piece covering a tile, or -1. */
  pieceAt(x: number, z: number): number {
    if (!inGrid(x, z)) return -1;
    return occupancy(this.track.pieces).tiles[z * GRID + x];
  }

  /** Can `p` go here? `ignore` = pieces that will be gone (the piece being moved, pieces being replaced). */
  canPlace(p: Piece, ignore: number[] = []): Result & { blockers: number[] } {
    const def = pieceDef(p);
    if (!def) return { ...fail(`unknown piece ${p.kind}`), blockers: [] };
    const tiles = footprintTiles(p);
    if (tiles.some((c) => !inGrid(c.x, c.z))) return { ...fail('off the map'), blockers: [] };
    const occ = occupancy(this.track.pieces).tiles;
    const blockers = [...new Set(tiles.map((c) => occ[c.z * GRID + c.x]).filter((i) => i >= 0 && !ignore.includes(i)))];
    if (blockers.length) return { ...fail('occupied'), blockers };
    const why = terrainProblem(this.track, p);
    return why ? { ...fail(why), blockers } : { ...OK, blockers };
  }

  /** Place a piece; with `replace`, pieces in the way are removed first. Returns the new piece's index. */
  place(p: Piece, replace = false): Result & { index?: number } {
    const piece = normalise(p);
    const first = this.canPlace(piece);
    const check = !first.ok && first.reason === 'occupied' && replace ? this.canPlace(piece, first.blockers) : first;
    if (!check.ok) return check;
    this.edit(() => {
      const drop = new Set(first.blockers);
      this.track.pieces = this.track.pieces.filter((_, i) => !drop.has(i));
      this.track.pieces.push(piece);
    });
    return { ok: true, index: this.track.pieces.length - 1 };
  }

  remove(index: number) {
    if (!this.track.pieces[index]) return;
    this.edit(() => this.track.pieces.splice(index, 1));
  }

  /** Change a piece in place (move, rotate, surface, variant) if the result still fits. */
  update(index: number, change: Partial<Piece>): Result {
    const old = this.track.pieces[index];
    if (!old) return fail('no piece');
    const p = normalise({ ...old, ...change });
    const check = this.canPlace(p, [index]);
    if (!check.ok) return check;
    this.edit(() => (this.track.pieces[index] = p));
    return OK;
  }

  rotate(index: number, dir: 1 | -1 = 1): Result {
    const p = this.track.pieces[index];
    if (!p) return fail('no piece');
    return this.update(index, { rot: ((p.rot + dir + 4) % 4) as Rot });
  }

  // ---- terrain ----

  /** Set one grid corner (hill steps 0/1). Refused next to water: drain it first. */
  setCorner(cx: number, cz: number, h: number): Result {
    if (cx < 0 || cz < 0 || cx > GRID || cz > GRID) return fail('off the map');
    if (this.track.heights[cz][cx] === h) return OK;
    for (const [x, z] of [[cx - 1, cz - 1], [cx, cz - 1], [cx - 1, cz], [cx, cz]])
      if (inGrid(x, z) && this.track.water[z][x]) return fail('water next to this corner: drain it first');
    this.edit(() => (this.track.heights[cz][cx] = h));
    return OK;
  }

  /** Raise or lower all four corners of a tile (a hill top or a dip back to the ground). */
  setTile(x: number, z: number, h: number): Result {
    if (!inGrid(x, z)) return fail('off the map');
    const corners = [[x, z], [x + 1, z], [x, z + 1], [x + 1, z + 1]];
    if (corners.every(([cx, cz]) => this.track.heights[cz][cx] === h)) return OK;
    for (const [cx, cz] of corners)
      for (const [tx, tz] of [[cx - 1, cz - 1], [cx, cz - 1], [cx - 1, cz], [cx, cz]])
        if (h > 0 && inGrid(tx, tz) && this.track.water[tz][tx]) return fail('water next to this tile: drain it first');
    this.edit(() => {
      for (const [cx, cz] of corners) this.track.heights[cz][cx] = h;
    });
    return OK;
  }

  /** Paint water: true (whole tile), a coast (the dry corner) or false (dry land). Water needs flat ground level. */
  setWater(x: number, z: number, w: WaterValue): Result {
    if (!inGrid(x, z)) return fail('off the map');
    if (this.track.water[z][x] === w) return OK;
    if (w) {
      const h = this.track.heights;
      if (h[z][x] || h[z][x + 1] || h[z + 1][x] || h[z + 1][x + 1]) return fail('water needs flat ground: lower the hill first');
      const i = this.pieceAt(x, z);
      if (i >= 0 && this.track.pieces[i].kind !== 'scenery') {
        const test = clone(this.track);
        test.water[z][x] = w;
        const why = terrainProblem(test, this.track.pieces[i]);
        if (why) return fail(why);
      }
    }
    this.edit(() => (this.track.water[z][x] = w));
    return OK;
  }
}

/** Drop fields that don't apply: surfaces only on kinds that have them, no "paved" (the default). */
export function normalise(p: Piece): Piece {
  const q: Piece = { x: p.x, z: p.z, kind: p.kind, rot: p.rot };
  if (p.surface && p.surface !== 'paved' && KINDS_WITH_SURFACES.has(p.kind)) q.surface = p.surface;
  if (p.variant) q.variant = p.variant;
  return q;
}
