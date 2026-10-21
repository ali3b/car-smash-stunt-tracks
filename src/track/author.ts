// Track authoring: tracks are written as code. A TrackBuilder holds the grid (terrain first: hills, lakes), and a
// Turtle lays pieces one after another from where the last one ended: it finds the rotation, anchor and direction
// through each piece from the catalogue's road ends (pieces.ts), so a design reads like driving directions:
//
//   const b = new TrackBuilder('Sunny Loop', 'country');
//   b.hill(10, 10, 14, 13);
//   b.start(5, 5, 'N').straight(3).right('large').ramp('up').deck(2).ramp('down').loop().straight(2) … .close();
//
// Every lay checks that the piece fits (grid, overlaps, levels); validate.ts checks the finished track.
import { pieceDef, placedEnd, rotatedFootprint, variantsOf, type Level, type Side } from './pieces';
import { GRID, type Piece, type PieceKind, type Rot, type Scenery, type Surface, type TrackFile } from './types';
import { endProfile, endsMatch, leftOf, opposite, rightOf, SIDE_DIR, validateTrack, worldEnds, type WorldEnd } from './validate';

export type Turn = 'L' | 'R' | 'S';
export type Prop = 'palm' | 'cactus' | 'tree' | 'tennis-court' | 'gas-station' | 'barn' | 'office' | 'windmill' | 'boat' | 'diner';

export interface LayOpts {
  variant?: string;
  /** Which way the road leaves the piece relative to the way it came in. */
  turn?: Turn;
  /** Sideways offset of the exit (tiles to the right of the heading; negative = left), for chicanes. */
  shift?: number;
  /** The level the road leaves at (e.g. 'elevated' for a ramp up). */
  to?: Level;
  /** Which of the piece's paths to drive (forks, the span over a road). */
  path?: number;
  surface?: Surface;
}

export class TrackBuilder {
  readonly pieces: Piece[] = [];
  readonly heights: number[][] = Array.from({ length: GRID + 1 }, () => new Array(GRID + 1).fill(0));
  readonly water: TrackFile['water'] = Array.from({ length: GRID }, () => new Array(GRID).fill(false));
  private occupied = new Int32Array(GRID * GRID).fill(-1);
  private startTile?: { x: number; z: number; heading: Side };
  /** The builder made last (so a tool can show a design that failed half-way). */
  static last: TrackBuilder | undefined;

  constructor(
    readonly name: string,
    readonly scenery: Scenery,
  ) {
    TrackBuilder.last = this;
  }

  /** A flat hill top over tiles x0..x1, z0..z1 (inclusive); the tiles around it become slopes. */
  hill(x0: number, z0: number, x1: number, z1: number): this {
    for (let z = z0; z <= z1 + 1; z++) for (let x = x0; x <= x1 + 1; x++) this.heights[z][x] = 1;
    return this;
  }

  /** Water over tiles x0..x1, z0..z1; `round` cuts the four corner tiles diagonally (coast). */
  lake(x0: number, z0: number, x1: number, z1: number, round = true): this {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.water[z][x] = true;
    if (round && x1 > x0 && z1 > z0) {
      this.water[z0][x0] = 'SW';
      this.water[z0][x1] = 'SE';
      this.water[z1][x0] = 'NW';
      this.water[z1][x1] = 'NE';
    }
    return this;
  }

  /** Dry land over tiles x0..x1, z0..z1 (an island in a lake). */
  land(x0: number, z0: number, x1: number, z1: number): this {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.water[z][x] = false;
    return this;
  }

  /** The piece covering a tile, or −1. */
  at(x: number, z: number): number {
    return x < 0 || z < 0 || x >= GRID || z >= GRID ? -2 : this.occupied[z * GRID + x];
  }

  /** Add a piece as is (checks the grid and overlaps). */
  add(p: Piece): number {
    const def = pieceDef(p);
    if (!def) throw new Error(`${this.name}: unknown piece ${p.kind}:${p.variant}`);
    const [w, d] = rotatedFootprint(def, p.rot);
    for (let dz = 0; dz < d; dz++)
      for (let dx = 0; dx < w; dx++) {
        const o = this.at(p.x + dx, p.z + dz);
        if (o === -2) throw new Error(`${this.name}: ${p.kind} at ${p.x},${p.z} leaves the grid`);
        if (o >= 0) {
          const q = this.pieces[o];
          throw new Error(`${this.name}: ${p.kind} at ${p.x},${p.z} overlaps ${q.kind} at ${q.x},${q.z}`);
        }
      }
    const i = this.pieces.length;
    this.pieces.push(p);
    for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) this.occupied[(p.z + dz) * GRID + p.x + dx] = i;
    return i;
  }

  prop(variant: Prop, x: number, z: number, rot: Rot = 0): this {
    this.add({ x, z, kind: 'scenery', rot, variant });
    return this;
  }

  props(variant: Prop, tiles: [number, number, Rot?][]): this {
    for (const [x, z, rot] of tiles) this.prop(variant, x, z, rot ?? 0);
    return this;
  }

  /**
   * Scatter `count` props over free tiles inside x0..x1, z0..z1 (deterministic for a seed), keeping a tile clear of
   * the road on every side; boats go on open water, everything else on dry, flat ground.
   */
  scatter(variant: Prop, count: number, area: [number, number, number, number] = [0, 0, GRID - 1, GRID - 1], seed = 1): this {
    let s = seed * 9301 + 49297;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    const [x0, z0, x1, z1] = area;
    const free: [number, number][] = [];
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        if (this.at(x, z) !== -1) continue;
        const wet = this.water[z][x] === true;
        if ((variant === 'boat') !== wet) continue;
        if (variant !== 'boat' && this.water[z][x]) continue;
        const cs = [this.heights[z][x], this.heights[z][x + 1], this.heights[z + 1][x], this.heights[z + 1][x + 1]];
        if (cs.some((h) => h !== cs[0])) continue;
        let near = false;
        for (let dz = -1; dz <= 1 && !near; dz++)
          for (let dx = -1; dx <= 1; dx++) {
            const o = this.at(x + dx, z + dz);
            if (o >= 0 && this.pieces[o].kind !== 'scenery') near = true;
          }
        if (!near) free.push([x, z]);
      }
    for (let n = 0; n < count && free.length; n++) {
      const [x, z] = free.splice(Math.floor(rnd() * free.length), 1)[0];
      this.prop(variant, x, z, Math.floor(rnd() * 4) as Rot);
    }
    return this;
  }

  /** Place the start line at (x, z), driven towards `heading`, and return a turtle just past it. */
  start(x: number, z: number, heading: Side): Turtle {
    this.startTile = { x, z, heading };
    return new Turtle(this, x, z, heading).lay('start-finish');
  }

  /** A turtle at (x, z) heading `heading` with no road behind it (for a branch or a second route). */
  turtle(x: number, z: number, heading: Side, prev: WorldEnd | null = null): Turtle {
    return new Turtle(this, x, z, heading, prev);
  }

  /** The start line's tile and heading (for Turtle.close). */
  get startAt() {
    return this.startTile;
  }

  get track(): TrackFile {
    return { version: 1, name: this.name, scenery: this.scenery, pieces: this.pieces, heights: this.heights, water: this.water };
  }

  /** The finished track; throws with the validator's errors unless it is clean. */
  build(): TrackFile {
    const t = this.track;
    const v = validateTrack(t);
    if (!v.ok) throw new Error(`${this.name}: ${v.errors.join('; ')}`);
    return t;
  }
}

const turnOf = (heading: Side, exit: Side): Turn | 'back' => (exit === heading ? 'S' : exit === leftOf(heading) ? 'L' : exit === rightOf(heading) ? 'R' : 'back');

export class Turtle {
  /** Road tiles skipped since the last piece (a jump in progress). */
  private gap = 0;

  constructor(
    readonly b: TrackBuilder,
    /** The tile the next piece's entry lies on. */
    public x: number,
    public z: number,
    public heading: Side,
    /** The end the road arrives through (null at the start of a route). */
    public prev: WorldEnd | null = null,
  ) {}

  get where() {
    return `${this.x},${this.z} heading ${this.heading}`;
  }

  private track(): TrackFile {
    return this.b.track;
  }

  /** Every way `kind` fits here (best first): the piece, and the ends the road enters and leaves through. */
  candidates(kind: PieceKind, o: LayOpts = {}): { piece: Piece; entry: WorldEnd; exit: WorldEnd }[] {
    const t = this.track();
    const variants = o.variant !== undefined ? [o.variant] : variantsOf(kind);
    const want = opposite(this.heading);
    const cands: { piece: Piece; entry: WorldEnd; exit: WorldEnd; score: number }[] = [];
    for (const variant of variants)
      for (const rot of [0, 1, 2, 3] as Rot[]) {
        const probe: Piece = { x: 0, z: 0, kind, rot, ...(variant ? { variant } : {}) };
        const def = pieceDef(probe);
        if (!def) throw new Error(`unknown piece ${kind}:${variant}`);
        def.paths.forEach((path, pi) => {
          if (o.path !== undefined && pi !== o.path) return;
          for (const which of [0, 1] as const) {
            const e = placedEnd(def, probe, path[which]);
            if (e.side !== want) continue;
            const piece: Piece = { ...probe, x: this.x - e.dx, z: this.z - e.dz };
            if (o.surface && o.surface !== 'paved') piece.surface = o.surface;
            const ends = worldEnds(piece, -1);
            const entry = ends.find((w) => w.path === pi && w.which === which)!;
            const exit = ends.find((w) => w.path === pi && w.which !== which)!;
            const turn = turnOf(this.heading, exit.side);
            if (turn === 'back') continue;
            if (o.turn && turn !== o.turn) continue;
            if (o.to && exit.level !== o.to) continue;
            if (o.shift !== undefined) {
              const [rx, rz] = SIDE_DIR[rightOf(this.heading)];
              if ((exit.x - entry.x) * rx + (exit.z - entry.z) * rz !== o.shift) continue;
            }
            if (this.gap > 0 ? entry.level !== 'elevated' : this.prev && !endsMatch(t, this.prev, entry)) continue;
            cands.push({ piece, entry, exit, score: which * 10 + pi * 100 + rot });
          }
        });
      }
    return cands.sort((a, b) => a.score - b.score);
  }

  /** Lay one piece of `kind` so that its road continues from here; see LayOpts for choosing among the ways it fits. */
  lay(kind: PieceKind, o: LayOpts = {}): this {
    const c = this.candidates(kind, o)[0];
    if (!c) throw new Error(`${this.b.name}: no way to lay ${kind}${o.variant ? `:${o.variant}` : ''} ${JSON.stringify(o)} at ${this.where}`);
    return this.put(c);
  }

  /** Lay a candidate from `candidates`. */
  put(c: { piece: Piece; exit: WorldEnd }): this {
    const index = this.b.add(c.piece);
    this.leave({ ...c.exit, piece: index });
    return this;
  }

  private leave(exit: WorldEnd) {
    const [sx, sz] = SIDE_DIR[exit.side];
    this.prev = exit;
    this.heading = exit.side;
    this.x = exit.x + sx;
    this.z = exit.z + sz;
    this.gap = 0;
  }

  // ── Roads ──
  straight(n = 1, surface?: Surface): this {
    for (let i = 0; i < n; i++) this.lay('straight', { surface });
    return this;
  }
  dirt(n = 1): this {
    return this.straight(n, 'dirt');
  }
  ice(n = 1): this {
    return this.straight(n, 'ice');
  }
  tunnel(n = 1): this {
    for (let i = 0; i < n; i++) this.lay('tunnel');
    return this;
  }
  slalom(n = 1): this {
    for (let i = 0; i < n; i++) this.lay('slalom');
    return this;
  }
  left(size: 'small' | 'large' = 'large', surface?: Surface): this {
    return this.lay(size === 'small' ? 'corner-small' : 'corner-large', { turn: 'L', surface });
  }
  right(size: 'small' | 'large' = 'large', surface?: Surface): this {
    return this.lay(size === 'small' ? 'corner-small' : 'corner-large', { turn: 'R', surface });
  }
  chicane(towards: 'L' | 'R'): this {
    return this.lay('chicane', { shift: towards === 'L' ? -1 : 1 });
  }

  // ── Up in the air ──
  ramp(dir: 'up' | 'down', style: 'ramp' | 'ramp-solid' | 'ramp-bridge' = 'ramp'): this {
    return this.lay(style, { to: dir === 'up' ? 'elevated' : 'ground' });
  }
  deck(n = 1, style: 'elevated' | 'elevated-solid' | 'elevated-span' = 'elevated'): this {
    for (let i = 0; i < n; i++) this.lay(style);
    return this;
  }
  deckLeft(): this {
    return this.lay('elevated-corner', { turn: 'L' });
  }
  deckRight(): this {
    return this.lay('elevated-corner', { turn: 'R' });
  }
  /** An elevated span with a ground road crossing under it (path 0), or the road under it (path 1). */
  span(over = true): this {
    return this.lay('elevated-span-over-road', { path: over ? 0 : 1 });
  }
  /** Fly over `n` empty tiles (after an elevated end); the next piece must take off… land at the elevated level. */
  skip(n: number): this {
    const [sx, sz] = SIDE_DIR[this.heading];
    for (let i = 0; i < n; i++) {
      if (this.b.at(this.x, this.z) !== -1) throw new Error(`${this.b.name}: jump gap at ${this.x},${this.z} is not empty`);
      this.x += sx;
      this.z += sz;
    }
    this.gap += n;
    return this;
  }
  /** Ramp up, fly over `gap` empty tiles, ramp down. */
  jump(gap: number, up: 'ramp' | 'ramp-solid' | 'ramp-bridge' = 'ramp', down: 'ramp' | 'ramp-solid' | 'ramp-bridge' = up): this {
    return this.ramp('up', up).skip(gap).ramp('down', down);
  }

  // ── Stunts ──
  loop(): this {
    return this.lay('loop');
  }
  roll(): this {
    return this.lay('corkscrew-roll');
  }
  /** A 360° climbing helix that leaves on the elevated level (or, driven backwards, comes down from it). */
  helix(hand: 'left' | 'right', dir: 'up' | 'down' = 'up'): this {
    return this.lay('corkscrew-helix', { variant: hand, to: dir === 'up' ? 'elevated' : 'ground' });
  }
  /** Into a pipe, `n` pipe tiles (obstacle at the listed positions), and out. */
  pipe(n: number, obstacles: number[] = []): this {
    this.lay('pipe-entry', { to: 'pipe' });
    for (let i = 0; i < n; i++) this.lay(obstacles.includes(i) ? 'pipe-obstacle' : 'pipe');
    return this.lay('pipe-entry', { to: 'ground' });
  }
  highway(n: number): this {
    this.lay('highway-entry', { to: 'highway' });
    for (let i = 0; i < n; i++) this.lay('highway');
    return this.lay('highway-entry', { to: 'ground' });
  }
  /** Onto a banked section leaning into a turn to the `turn` side (the high side is the outside). */
  bank(turn: 'L' | 'R'): this {
    const high = turn === 'L' ? rightOf(this.heading) : leftOf(this.heading);
    const c = this.candidates('bank-entry', { turn: 'S' }).find((c) => endProfile(this.track(), c.exit).high === high);
    if (!c) throw new Error(`${this.b.name}: no bank entry leaning ${turn} at ${this.where}`);
    return this.put(c);
  }
  banked(n = 1): this {
    for (let i = 0; i < n; i++) this.lay('banked');
    return this;
  }
  bankedTurn(turn: 'L' | 'R'): this {
    return this.lay('banked-corner', { turn });
  }
  unbank(): this {
    return this.lay('bank-entry', { to: 'ground' });
  }

  // ── Forks and crossings ──
  /** A fork: the turtle carries on along the main road; returns a turtle on the branch going `side`. */
  fork(side: 'L' | 'R', size: 'small' | 'large' = 'small'): Turtle {
    const kind = size === 'small' ? 'split-small' : 'split-large';
    for (const c of this.candidates(kind, { path: 0, turn: 'S' })) {
      const index = this.b.pieces.length;
      const branch = worldEnds(c.piece, index).find((e) => e.path === 1 && e.which === 1)!;
      if (c.entry.which !== 0 || turnOf(this.heading, branch.side) !== side) continue;
      this.put(c);
      const tb = new Turtle(this.b, 0, 0, branch.side);
      tb.leave(branch);
      return tb;
    }
    throw new Error(`${this.b.name}: no ${kind} branching ${side} at ${this.where}`);
  }
  /** Where a branch joins again: a fork driven backwards along its main road, the branch coming in from `side`. */
  merge(side: 'L' | 'R', size: 'small' | 'large' = 'small'): this {
    const kind = size === 'small' ? 'split-small' : 'split-large';
    for (const c of this.candidates(kind, { path: 0, turn: 'S' })) {
      if (c.entry.which !== 1) continue;
      const branch = worldEnds(c.piece, -1).find((e) => e.path === 1 && e.which === 1)!;
      if (branch.side !== (side === 'L' ? leftOf(this.heading) : rightOf(this.heading))) continue;
      return this.put(c);
    }
    throw new Error(`${this.b.name}: no ${kind} merging from the ${side} at ${this.where}`);
  }
  /** Drive through a piece already laid on the tile ahead (a crossroads, a span over the road, a merge). */
  cross(): this {
    const i = this.b.at(this.x, this.z);
    if (i < 0) throw new Error(`${this.b.name}: nothing to cross at ${this.where}`);
    const ends = worldEnds(this.b.pieces[i], i);
    const entry = ends.find((e) => e.x === this.x && e.z === this.z && e.side === opposite(this.heading));
    if (!entry) throw new Error(`${this.b.name}: ${this.b.pieces[i].kind} at ${this.where} has no road end facing us`);
    if (this.prev && !endsMatch(this.track(), this.prev, entry)) throw new Error(`${this.b.name}: level mismatch crossing at ${this.where}`);
    const same = ends.filter((e) => e.path === entry.path);
    this.leave(same.find((e) => e.which !== entry.which)!);
    return this;
  }
  /** End this route on the piece ahead (a merge or the start line), checking the ends meet. */
  join(): void {
    const i = this.b.at(this.x, this.z);
    if (i < 0) throw new Error(`${this.b.name}: route ends in the open at ${this.where}`);
    const entry = worldEnds(this.b.pieces[i], i).find((e) => e.x === this.x && e.z === this.z && e.side === opposite(this.heading));
    if (!entry) throw new Error(`${this.b.name}: route meets the side of ${this.b.pieces[i].kind} at ${this.where}`);
    if (this.prev && this.gap === 0 && !endsMatch(this.track(), this.prev, entry)) throw new Error(`${this.b.name}: level mismatch joining at ${this.where}`);
  }
  /** Finish the lap back on the start line. */
  close(): void {
    const s = this.b.startAt;
    if (!s) throw new Error(`${this.b.name}: no start line`);
    if (this.x !== s.x || this.z !== s.z || this.heading !== s.heading) throw new Error(`${this.b.name}: lap ends at ${this.where}, start is at ${s.x},${s.z} heading ${s.heading}`);
    this.join();
  }
}
