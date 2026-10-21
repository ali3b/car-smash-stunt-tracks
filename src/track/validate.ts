// The track rules, in one place for the track designs (scripts/build-tracks.ts, author.ts), the race path
// (src/sim/track-path.ts) and the editor (src/editor/*). Free of DOM and three.js.
//
//   - footprints and occupancy: one piece per tile, a multi-tile piece covers its whole rotated footprint, nothing
//     leaves the 30×30 grid;
//   - road ends: every pair of touching ends agrees on its level (ground height on the terrain, the elevated deck, a
//     bank's high side, pipe, highway); a road end at the elevated level may face empty tiles: that is a jump, and it
//     flies straight on to an elevated end facing back (over empty ground, water, a road or scenery: a warning);
//   - the circuit: followed from the start-finish line through the catalogue's ends; at a fork every leg is tried and
//     the first that closes is the circuit (the race path, track-path.ts, takes each fork's main leg);
//   - terrain under each piece, as the car simulation sees it (src/sim/track-surface.ts):
//       1. water and coast tiles take elevated decks on pillars only;
//       2. a hill top (all four corners up) takes ground pieces; a piece with an elevated end there would stand a
//          second storey up, so it is refused;
//       3. a slope tile (one side up, the opposite side down) takes a plain straight running up or down it, or a ramp
//          laid down off the hill top (its ground end on the high side): the simulation turns that ramp into a deck
//          carried level from the hill top. Anything else on a slope is ignored by the physics, so it is refused;
//       4. any other uneven tile (one corner up or down) takes scenery only;
//   - jumps: an elevated end can fly up to MAX_JUMP_GAP tiles, but with our cars and ramps only a one-tile gap can
//     be cleared (at about 105 mph), so a longer gap is a warning.
//
// Road levels: a ground end is as high as the terrain at the middle of its tile side (0, ½ on a sloped side, 1 on a
// hill top); an elevated end is one hill step up. Ground and elevated ends meet when their heights match, so an
// elevated deck runs onto a road on a hill top. Banked, pipe and highway ends only meet their own kind.
import { pieceDef, placedEnd, rotatedFootprint, KINDS_WITH_SURFACES, type End, type Level, type Side } from './pieces';
import { GRID, type Piece, type TrackFile } from './types';

/** An end of a placed piece in world tiles, with which piece and path it belongs to. */
export interface WorldEnd {
  x: number;
  z: number;
  side: Side;
  level: Level;
  piece: number;
  path: number;
  /** 0 = the path's first end, 1 = its second. */
  which: 0 | 1;
}

/** A catalogue end placed in world tiles (no piece index). */
export type PlacedEnd = End & { x: number; z: number };

export interface Tile {
  x: number;
  z: number;
}

export interface Jump {
  from: Tile;
  to: Tile;
  /** Empty tiles flown over. */
  gap: number;
}

/** Longest gap (tiles) a jump may fly over. */
export const MAX_JUMP_GAP = 3;
/** Longest gap a car can actually clear (see the file comment). */
export const CLEARABLE_GAP = 1;

const SIDES: Side[] = ['N', 'E', 'S', 'W'];
export const SIDE_DIR: Record<Side, [number, number]> = { N: [0, 1], E: [1, 0], S: [0, -1], W: [-1, 0] };
export const OPPOSITE: Record<Side, Side> = { N: 'S', S: 'N', E: 'W', W: 'E' };
export const opposite = (s: Side): Side => OPPOSITE[s];
export const rightOf = (s: Side): Side => SIDES[(SIDES.indexOf(s) + 1) % 4];
export const leftOf = (s: Side): Side => SIDES[(SIDES.indexOf(s) + 3) % 4];

const fmt = (p: Piece) => `${p.kind}${p.variant ? `:${p.variant}` : ''}@${p.x},${p.z}r${p.rot}`;
const capital = (s: string) => s[0].toUpperCase() + s.slice(1);

// ---- footprints -------------------------------------------------------------------------------------------------

export const inGrid = (x: number, z: number) => x >= 0 && z >= 0 && x < GRID && z < GRID;

/** Footprint [w, d] of a placed piece (an unknown kind counts as 1×1). */
export function pieceSize(p: Pick<Piece, 'kind' | 'variant' | 'rot'>): [number, number] {
  const def = pieceDef(p);
  return def ? rotatedFootprint(def, p.rot) : [1, 1];
}

export function footprintTiles(p: Piece): Tile[] {
  const [w, d] = pieceSize(p);
  const out: Tile[] = [];
  for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) out.push({ x: p.x + dx, z: p.z + dz });
  return out;
}

/** The ends of every path of a placed piece in world tiles: paths[i] = [entry, exit]. */
export function placedPaths(p: Piece): [PlacedEnd, PlacedEnd][] {
  const def = pieceDef(p);
  if (!def) return [];
  return def.paths.map(([a, b]) => [placedEnd(def, p, a), placedEnd(def, p, b)]);
}

/** All ends of a placed piece, in world tiles. */
export function worldEnds(p: Piece, index: number): WorldEnd[] {
  return placedPaths(p).flatMap((path, pi) => path.map((w, which) => ({ x: w.x, z: w.z, side: w.side, level: w.level, piece: index, path: pi, which: which as 0 | 1 })));
}

export interface Occupancy {
  /** Piece index per tile (z * GRID + x), -1 when empty. */
  tiles: Int32Array;
  /** Tiles claimed by more than one piece, with every claimant. */
  overlaps: { x: number; z: number; pieces: number[] }[];
}

export function occupancy(pieces: Piece[]): Occupancy {
  const tiles = new Int32Array(GRID * GRID).fill(-1);
  const extra = new Map<number, number[]>();
  pieces.forEach((p, i) => {
    for (const { x, z } of footprintTiles(p)) {
      if (!inGrid(x, z)) continue;
      const k = z * GRID + x;
      if (tiles[k] < 0) tiles[k] = i;
      else {
        const list = extra.get(k) ?? [tiles[k]];
        list.push(i);
        extra.set(k, list);
      }
    }
  });
  const overlaps = [...extra].map(([k, list]) => ({ x: k % GRID, z: Math.floor(k / GRID), pieces: list }));
  return { tiles, overlaps };
}

/** Index of the tiles: which piece covers each tile (−1 = none); the first piece wins an overlap. */
export function tileIndex(t: TrackFile): Int32Array {
  return occupancy(t.pieces).tiles;
}

// ---- levels -----------------------------------------------------------------------------------------------------

/** Ground height (hill steps) at the middle of a tile side. */
export function sideHeight(t: TrackFile, x: number, z: number, side: Side): number {
  const h = (cx: number, cz: number) => t.heights[cz]?.[cx] ?? 0;
  const c = { S: [[x, z], [x + 1, z]], N: [[x, z + 1], [x + 1, z + 1]], W: [[x, z], [x, z + 1]], E: [[x + 1, z], [x + 1, z + 1]] }[side];
  return (h(c[0][0], c[0][1]) + h(c[1][0], c[1][1])) / 2;
}

export type EndClass = 'road' | 'pipe' | 'highway' | 'bank';

/** What an end looks like from outside, in world terms: road class, height, and the bank's high side. */
export function endProfile(t: TrackFile, e: Pick<WorldEnd, 'x' | 'z' | 'side' | 'level' | 'which'>): { cls: EndClass; h: number; high?: Side } {
  const ground = sideHeight(t, e.x, e.z, e.side);
  switch (e.level) {
    case 'elevated':
      return { cls: 'road', h: 1 };
    case 'ground':
      return { cls: 'road', h: ground };
    case 'pipe':
    case 'highway':
      return { cls: e.level, h: ground };
    default: {
      // bank-a: high on the right in the path's direction; at the first end that direction points into the piece,
      // at the second end out of it. Seen looking outwards: first end → high on the left, second → on the right.
      const rightLooking = (e.level === 'bank-a') === (e.which === 1);
      return { cls: 'bank', h: ground, high: rightLooking ? rightOf(e.side) : leftOf(e.side) };
    }
  }
}

/** True when two ends meeting across a tile edge agree (same road class, height and bank). */
export function endsMatch(t: TrackFile, a: WorldEnd, b: WorldEnd): boolean {
  const pa = endProfile(t, a);
  const pb = endProfile(t, b);
  return pa.cls === pb.cls && Math.abs(pa.h - pb.h) < 1e-6 && pa.high === pb.high;
}

/** An end's level in words (for messages). */
export function describeEnd(t: TrackFile, e: WorldEnd): string {
  const p = endProfile(t, e);
  if (p.cls === 'road') return p.h >= 1 && e.level === 'elevated' ? 'elevated' : p.h >= 1 ? 'hill top' : p.h > 0 ? 'a slope' : 'ground';
  if (p.cls === 'bank') return `banked (high ${p.high})`;
  return p.cls;
}

// ---- links ------------------------------------------------------------------------------------------------------

export type Link = { kind: 'road'; to: WorldEnd } | { kind: 'jump'; to: WorldEnd; gap: number } | { kind: 'open'; why: string; blocked?: boolean; mismatch?: boolean };

/** The ends on tile (x, z) facing `side`, one per path through them (main path first). */
function facingEnds(t: TrackFile, idx: Int32Array, ends: WorldEnd[][], x: number, z: number, side: Side): WorldEnd[] {
  if (!inGrid(x, z)) return [];
  const i = idx[z * GRID + x];
  if (i < 0) return [];
  return ends[i].filter((f) => f.x === x && f.z === z && f.side === side).sort((a, b) => a.path - b.path);
}

/**
 * Where a road end leads: every end facing it on the next tile (several at a fork's shared end, main path first), a
 * jump's landing, or nothing (with why).
 */
export function linksOf(t: TrackFile, idx: Int32Array, ends: WorldEnd[][], e: WorldEnd): { kind: 'road'; to: WorldEnd[] } | { kind: 'jump'; to: WorldEnd[]; gap: number } | { kind: 'open'; why: string; blocked?: boolean; mismatch?: boolean } {
  const [sx, sz] = SIDE_DIR[e.side];
  const back = opposite(e.side);
  const at = (x: number, z: number) => (inGrid(x, z) ? idx[z * GRID + x] : -2);
  const nx = e.x + sx;
  const nz = e.z + sz;
  const n = at(nx, nz);
  if (n === -2) return { kind: 'open', why: 'runs off the grid' };
  if (n >= 0 && t.pieces[n].kind !== 'scenery') {
    const f = facingEnds(t, idx, ends, nx, nz, back);
    if (f.length) {
      const ok = f.filter((g) => endsMatch(t, e, g));
      if (!ok.length) return { kind: 'open', mismatch: true, why: `level mismatch with ${fmt(t.pieces[n])}: ${describeEnd(t, e)} meets ${describeEnd(t, f[0])}` };
      return { kind: 'road', to: ok };
    }
    if (e.level !== 'elevated') return { kind: 'open', blocked: true, why: `meets the side of ${fmt(t.pieces[n])}` };
  }
  if (e.level !== 'elevated') return { kind: 'open', why: n >= 0 ? 'runs into scenery' : 'dead end' };
  // A jump: fly straight on over empty tiles (or roads and scenery below) to an elevated end facing back.
  for (let k = 1; k <= MAX_JUMP_GAP + 1; k++) {
    const x = e.x + sx * k;
    const z = e.z + sz * k;
    const m = at(x, z);
    if (m === -2) return { kind: 'open', why: 'jumps off the grid' };
    if (m < 0 || t.pieces[m].kind === 'scenery') continue;
    const f = facingEnds(t, idx, ends, x, z, back).filter((g) => g.level === 'elevated');
    if (f.length) return { kind: 'jump', to: f, gap: k - 1 };
  }
  return { kind: 'open', why: `jump gap longer than ${MAX_JUMP_GAP} tiles` };
}

/** What a road end leads to: the touching end of the neighbouring piece (its main path), a jump's landing, or nothing. */
export function linkOf(t: TrackFile, idx: Int32Array, ends: WorldEnd[][], e: WorldEnd): Link {
  const l = linksOf(t, idx, ends, e);
  return l.kind === 'open' ? l : l.kind === 'jump' ? { kind: 'jump', to: l.to[0], gap: l.gap } : { kind: 'road', to: l.to[0] };
}

/** The other end of the path a car takes after entering a piece through `e` (that path, else the main one). */
export function pathThrough(ends: WorldEnd[], e: WorldEnd): WorldEnd | undefined {
  const same = (a: WorldEnd) => a.x === e.x && a.z === e.z && a.side === e.side;
  const inPaths = [e.path, ...ends.filter(same).map((a) => a.path).sort((a, b) => a - b)];
  for (const path of inPaths) {
    const entry = ends.find((a) => a.path === path && same(a));
    if (!entry) continue;
    const exit = ends.find((a) => a.path === path && a.which !== entry.which);
    if (exit) return exit;
  }
  return undefined;
}

// ---- terrain ----------------------------------------------------------------------------------------------------

export type TileShape = { kind: 'flat'; h: number } | { kind: 'slope'; axis: 'NS' | 'EW'; up: Side } | { kind: 'irregular' };

export function tileShape(t: TrackFile, x: number, z: number): TileShape {
  const sw = t.heights[z][x], se = t.heights[z][x + 1], nw = t.heights[z + 1][x], ne = t.heights[z + 1][x + 1];
  if (sw === se && se === nw && nw === ne) return { kind: 'flat', h: sw };
  if (sw === se && nw === ne) return { kind: 'slope', axis: 'NS', up: nw > sw ? 'N' : 'S' };
  if (sw === nw && se === ne) return { kind: 'slope', axis: 'EW', up: se > sw ? 'E' : 'W' };
  return { kind: 'irregular' };
}

const endsOf = (p: Piece) => (pieceDef(p)?.paths ?? []).flat();
const hasElevatedEnd = (p: Piece) => endsOf(p).some((e) => e.level === 'elevated');
const allElevated = (p: Piece) => {
  const ends = endsOf(p);
  return ends.length > 0 && ends.every((e) => e.level === 'elevated');
};
const isRamp = (p: Piece) => p.kind === 'ramp' || p.kind === 'ramp-solid' || p.kind === 'ramp-bridge';

/**
 * A ramp on a slope tile laid down off the hill top (its ground end on the slope's high side): the simulation
 * treats it as a level deck carried from the hill top, and the renderer draws a deck.
 */
export function rampDeckOnSlope(t: TrackFile, p: Piece): boolean {
  if (!isRamp(p) || !inGrid(p.x, p.z)) return false;
  const shape = tileShape(t, p.x, p.z);
  if (shape.kind !== 'slope') return false;
  const ground = placedPaths(p)[0]?.find((e) => e.level === 'ground');
  return !!ground && ground.side === shape.up;
}

/** Why a piece can't stand on its tiles' terrain (rules at the top of this file), or null when it can. */
export function terrainProblem(t: TrackFile, p: Piece): string | null {
  if (p.kind === 'scenery') return null;
  const elevated = hasElevatedEnd(p);
  const deck = allElevated(p);
  for (const { x, z } of footprintTiles(p)) {
    if (!inGrid(x, z)) return 'off the map';
    const shape = tileShape(t, x, z);
    const wet = t.water[z][x];
    if (wet && !deck) return wet === true ? 'roads can’t sit in water' : 'roads can’t sit on the coast';
    if (shape.kind === 'irregular') return 'uneven ground: only scenery fits here';
    if (shape.kind === 'slope') {
      const [w, d] = pieceSize(p);
      if (isRamp(p)) {
        if (!rampDeckOnSlope(t, p)) return 'a ramp on a slope must run down off the hill top (it becomes a level deck)';
        continue;
      }
      if (p.kind !== 'straight' || w !== 1 || d !== 1) return 'sloping ground: only a plain straight, or a ramp off the hill top, fits on a slope';
      const axis = p.rot % 2 ? 'EW' : 'NS';
      if (shape.axis !== axis) return 'a road climbs a slope straight up or down, not across it';
      continue;
    }
    if (elevated && shape.h > 0) return 'no clearance: elevated pieces need ground level beneath';
  }
  return null;
}

// ---- the circuit ------------------------------------------------------------------------------------------------

export interface RouteStep {
  piece: number;
  /** Where the car enters and leaves the piece. */
  from: WorldEnd;
  to: WorldEnd;
  /** The car flew in over a gap of this many tiles. */
  jump?: number;
}

export type CircuitStatus = 'closed' | 'no-start' | 'open' | 'off-map' | 'blocked' | 'mismatch' | 'stray';

export interface Circuit {
  status: CircuitStatus;
  route: RouteStep[];
  jumps: Jump[];
  /** Where the trouble is, when not closed. */
  at?: Tile;
  message: string;
}

/** Drive from the (first) start-finish line along the road until it comes back to the start or stops. */
export function followCircuit(t: TrackFile, idx: Int32Array = tileIndex(t), ends: WorldEnd[][] = t.pieces.map(worldEnds)): Circuit {
  const start = t.pieces.findIndex((p) => p.kind === 'start-finish');
  if (start < 0) return { status: 'no-start', route: [], jumps: [], message: 'no start-finish line' };
  const entry = ends[start].find((e) => e.path === 0 && e.which === 0)!;
  const exit = ends[start].find((e) => e.path === 0 && e.which === 1)!;
  let budget = GRID * GRID * 16;

  /** Drive on from `cur`; at a fork try every leg (main first) and keep the first that closes, else the first failure. */
  const drive = (cur: WorldEnd, route: RouteStep[], jumps: Jump[], seen: Set<string>): Circuit => {
    for (;;) {
      if (--budget < 0) return { status: 'stray', route, jumps, at: { x: cur.x, z: cur.z }, message: 'the road never comes back to the start' };
      const here = { x: cur.x, z: cur.z };
      const l = linksOf(t, idx, ends, cur);
      if (l.kind === 'open') {
        const [dx, dz] = SIDE_DIR[cur.side];
        if (!inGrid(cur.x + dx, cur.z + dz)) return { status: 'off-map', route, jumps, at: here, message: `the road leaves the map at ${cur.x},${cur.z}` };
        if (l.mismatch) return { status: 'mismatch', route, jumps, at: { x: cur.x + dx, z: cur.z + dz }, message: `level mismatch at ${cur.x + dx},${cur.z + dz}: ${l.why.replace(/^.*?: /, '')}` };
        if (l.blocked) {
          const other = t.pieces[idx[(cur.z + dz) * GRID + cur.x + dx]];
          return { status: 'blocked', route, jumps, at: here, message: `the road at ${cur.x},${cur.z} runs into the side of the ${other.kind} at ${cur.x + dx},${cur.z + dz}` };
        }
        return { status: 'open', route, jumps, at: here, message: `open end at ${cur.x},${cur.z} (facing ${cur.side})${/dead end|runs into/.test(l.why) ? '' : `: ${l.why}`}` };
      }
      const gap = l.kind === 'jump' ? l.gap : undefined;
      const fork = l.to.length > 1;
      const tries: Circuit[] = [];
      let single: WorldEnd | null = null;
      for (const inEnd of l.to) {
        const r = fork ? [...route] : route;
        const j = fork ? [...jumps] : jumps;
        const s = fork ? new Set(seen) : seen;
        const at = { x: inEnd.x, z: inEnd.z };
        if (gap !== undefined) j.push({ from: here, to: at, gap });
        if (inEnd.piece === start) {
          if (inEnd.path === 0 && inEnd.which === 0 && inEnd.side === entry.side) return { status: 'closed', route: r, jumps: j, message: `closed circuit, ${r.length} pieces` };
          tries.push({ status: 'stray', route: r, jumps: j, at, message: `the road comes back to the start the wrong way at ${at.x},${at.z}` });
          continue;
        }
        const key = `${inEnd.piece}:${inEnd.path}:${inEnd.which}`;
        if (s.has(key)) {
          tries.push({ status: 'stray', route: r, jumps: j, at, message: `the road loops back on itself at ${at.x},${at.z} without reaching the start` });
          continue;
        }
        s.add(key);
        const out = ends[inEnd.piece].find((e) => e.path === inEnd.path && e.which !== inEnd.which)!;
        r.push({ piece: inEnd.piece, from: inEnd, to: out, ...(gap !== undefined ? { jump: gap } : {}) });
        if (!fork) single = out;
        else {
          const c = drive(out, r, j, s);
          if (c.status === 'closed') return c;
          tries.push(c);
        }
      }
      if (!single) return tries[0];
      cur = single;
    }
  };
  return drive(exit, [{ piece: start, from: entry, to: exit }], [], new Set([`${start}:0:0`]));
}

// ---- the whole report -------------------------------------------------------------------------------------------

export interface Issue {
  /** Errors stop the track from being a raceable circuit; warnings are worth a look. */
  severity: 'error' | 'warning';
  /** Tile to mark on the grid (absent for track-wide issues). */
  at?: Tile;
  piece?: number;
  message: string;
}

export interface Validation {
  /** No errors. */
  ok: boolean;
  /** The issues' messages by severity. */
  errors: string[];
  warnings: string[];
  issues: Issue[];
  circuit: Circuit;
  /** The circuit from the start line: pieces driven (a piece driven twice counts twice), tiles, jumps. */
  lap: { pieces: number; tiles: number; jumps: Jump[]; closed: boolean };
  /** Pieces the circuit drives through. */
  onCircuit: Set<number>;
  /** Road pieces connected to the circuit by road (the circuit itself, the other legs of splits, crossing roads). */
  connected: Set<number>;
}

/** The editor's name for a validation. */
export type Report = Validation;

/** Validate a track: see the file comment. */
export function validateTrack(t: TrackFile): Validation {
  const issues: Issue[] = [];
  const err = (message: string, at?: Tile, piece?: number) => issues.push({ severity: 'error', message, ...(at ? { at } : {}), ...(piece !== undefined ? { piece } : {}) });
  const warn = (message: string, at?: Tile, piece?: number) => issues.push({ severity: 'warning', message, ...(at ? { at } : {}), ...(piece !== undefined ? { piece } : {}) });
  const empty: Circuit = { status: 'no-start', route: [], jumps: [], message: 'not followed' };
  const done = (circuit = empty, onCircuit = new Set<number>(), connected = new Set<number>()): Validation => {
    const errors = issues.filter((i) => i.severity === 'error').map((i) => i.message);
    const warnings = issues.filter((i) => i.severity === 'warning').map((i) => i.message);
    let tiles = 0;
    for (const s of circuit.route) tiles += Math.max(...pieceSize(t.pieces[s.piece])) + (s.jump ?? 0);
    const lap = { pieces: circuit.route.length, tiles, jumps: circuit.jumps, closed: circuit.status === 'closed' };
    return { ok: errors.length === 0, errors, warnings, issues, circuit, lap, onCircuit, connected };
  };

  if (t.version !== 1) err(`Unknown track version ${t.version}.`);
  if (t.heights.length !== GRID + 1 || t.heights.some((r) => r.length !== GRID + 1)) err('Heights must be 31×31.');
  if (t.water.length !== GRID || t.water.some((r) => r.length !== GRID)) err('Water must be 30×30.');
  if (issues.length) return done();

  t.pieces.forEach((p, i) => {
    const at = { x: p.x, z: p.z };
    if (!pieceDef(p)) err(`Unknown piece ${p.kind}${p.variant ? `:${p.variant}` : ''} at ${p.x},${p.z}.`, at, i);
    else if (![0, 1, 2, 3].includes(p.rot)) err(`${fmt(p)}: bad rotation.`, at, i);
    else if (p.surface && p.surface !== 'paved' && !KINDS_WITH_SURFACES.has(p.kind)) err(`${fmt(p)}: ${p.kind} has no ${p.surface} surface.`, at, i);
  });
  if (issues.length) return done();

  // Start line.
  const starts = t.pieces.flatMap((p, i) => (p.kind === 'start-finish' ? [i] : []));
  if (!starts.length) err('No start-finish line: place exactly one.');
  for (const i of starts.slice(1)) err(`Extra start-finish line at ${t.pieces[i].x},${t.pieces[i].z}: a track has exactly one.`, { x: t.pieces[i].x, z: t.pieces[i].z }, i);

  // Footprints.
  const occ = occupancy(t.pieces);
  for (const o of occ.overlaps) err(`${fmt(t.pieces[o.pieces[1]])} overlaps ${fmt(t.pieces[o.pieces[0]])} at ${o.x},${o.z}.`, { x: o.x, z: o.z }, o.pieces[1]);
  t.pieces.forEach((p, i) => {
    if (footprintTiles(p).some((c) => !inGrid(c.x, c.z))) err(`${fmt(p)} leaves the grid.`, { x: p.x, z: p.z }, i);
  });

  // Terrain.
  for (let z = 0; z < GRID; z++)
    for (let x = 0; x < GRID; x++) {
      const [sw, se, ne, nw] = [t.heights[z][x], t.heights[z][x + 1], t.heights[z + 1][x + 1], t.heights[z + 1][x]];
      if (sw === ne && se === nw && sw !== se) err(`Terrain at ${x},${z} rises on a diagonal (not a valid hill tile).`, { x, z });
      if (t.water[z][x] && sw + se + ne + nw > 0) err(`Water on a hill at ${x},${z}.`, { x, z });
    }
  if (t.heights.some((row) => row.some((h) => h !== 0 && h !== 1))) warn('Corner heights other than 0 and 1.');
  t.pieces.forEach((p, i) => {
    if (footprintTiles(p).some((c) => !inGrid(c.x, c.z))) return;
    const why = terrainProblem(t, p);
    if (why) err(`${fmt(p)}: ${why}.`, { x: p.x, z: p.z }, i);
  });

  // The circuit.
  const idx = occ.tiles;
  const ends = t.pieces.map(worldEnds);
  const circuit = followCircuit(t, idx, ends);
  if (circuit.status !== 'closed' && circuit.status !== 'no-start') err(capital(circuit.message) + '.', circuit.at);
  for (const j of circuit.jumps) {
    if (j.gap > CLEARABLE_GAP) warn(`The jump at ${j.from.x},${j.from.z} flies over ${j.gap} tiles: no car clears more than ${CLEARABLE_GAP}.`, j.from);
    const [dx, dz] = [Math.sign(j.to.x - j.from.x), Math.sign(j.to.z - j.from.z)];
    for (let k = 1; k <= j.gap; k++) {
      const m = idx[(j.from.z + dz * k) * GRID + j.from.x + dx * k];
      if (m >= 0 && t.pieces[m].kind === 'scenery') warn(`The jump at ${j.from.x},${j.from.z} flies over scenery at ${j.from.x + dx * k},${j.from.z + dz * k}.`, j.from);
    }
  }
  const onCircuit = new Set(circuit.route.map((s) => s.piece));
  const connected = roadNetwork(t, idx, ends, onCircuit);

  // Every road end of the circuit's road network must lead somewhere.
  for (const i of connected)
    for (const e of ends[i]) {
      const l = linksOf(t, idx, ends, e);
      if (l.kind === 'open') {
        const msg = `Open end ${e.side} of ${fmt(t.pieces[i])}: ${l.why}.`;
        if (!issues.some((x) => x.message === msg)) err(msg, { x: e.x, z: e.z }, i);
      }
    }
  if (circuit.status === 'closed') {
    const loose = t.pieces.filter((p, i) => p.kind !== 'scenery' && !connected.has(i)).length;
    if (loose) warn(`${loose} road piece${loose > 1 ? 's aren’t' : ' isn’t'} connected to the circuit.`);
  }
  return done(circuit, onCircuit, connected);
}

/** Every piece reachable by road (or jump) from `from`. */
function roadNetwork(t: TrackFile, idx: Int32Array, ends: WorldEnd[][], from: Set<number>): Set<number> {
  const seen = new Set(from);
  const queue = [...from];
  while (queue.length) {
    const i = queue.pop()!;
    for (const e of ends[i]) {
      const l = linksOf(t, idx, ends, e);
      if (l.kind === 'open') continue;
      for (const f of l.to)
        if (!seen.has(f.piece)) {
          seen.add(f.piece);
          queue.push(f.piece);
        }
    }
  }
  return seen;
}
