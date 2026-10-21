// The piece catalogue: for every piece kind (at rot 0) its footprint, its road ends and the generator track-piece
// model that draws it. A road end is a tile of the footprint (dx east, dz north from the south-west anchor), the side
// of that tile it leaves through, and its level: ground, elevated (on the hill/deck level), banked one way or the
// other, pipe or highway. The renderer places a model so that its `in` socket sits on the entry end, facing into the
// piece, and checks that its `out` socket lands on the exit end (scripts/track-check.mjs reports any mismatch).
import type { Piece, PieceKind, Rot } from './types';
import { HILL_M, TILE_M } from './types';

export type Side = 'N' | 'E' | 'S' | 'W';
export type Level = 'ground' | 'elevated' | 'bank-a' | 'bank-b' | 'pipe' | 'highway';

export interface End {
  dx: number;
  dz: number;
  side: Side;
  level: Level;
}

export interface PieceDef {
  footprint: [number, number];
  /** Road paths through the piece as [entry, exit] pairs; the first path is the main one. */
  paths: [End, End][];
}

const e = (dx: number, dz: number, side: Side, level: Level = 'ground'): End => ({ dx, dz, side, level });
const straightThrough = (from: Level, to: Level = from): PieceDef => ({ footprint: [1, 1], paths: [[e(0, 0, 'S', from), e(0, 0, 'N', to)]] });

/** rot 0 layouts; variants as the importer names them (a/b mirror images, left/right handedness). */
const CATALOGUE: Record<string, PieceDef> = {
  'start-finish': straightThrough('ground'),
  straight: straightThrough('ground'),
  tunnel: straightThrough('ground'),
  slalom: straightThrough('ground'),
  'corner-small': { footprint: [1, 1], paths: [[e(0, 0, 'S'), e(0, 0, 'W')]] },
  'corner-large': { footprint: [2, 2], paths: [[e(1, 0, 'S'), e(0, 1, 'W')]] },
  elevated: straightThrough('elevated'),
  'elevated-solid': straightThrough('elevated'),
  'elevated-span': straightThrough('elevated'),
  'elevated-span-over-road': { footprint: [1, 1], paths: [[e(0, 0, 'S', 'elevated'), e(0, 0, 'N', 'elevated')], [e(0, 0, 'E'), e(0, 0, 'W')]] },
  'elevated-corner': { footprint: [2, 2], paths: [[e(1, 0, 'S', 'elevated'), e(0, 1, 'W', 'elevated')]] },
  ramp: straightThrough('ground', 'elevated'),
  'ramp-solid': straightThrough('ground', 'elevated'),
  'ramp-bridge': straightThrough('ground', 'elevated'),
  'bank-entry:a': straightThrough('ground', 'bank-b'),
  'bank-entry:b': straightThrough('ground', 'bank-a'),
  banked: straightThrough('bank-a'),
  'banked-corner': { footprint: [2, 2], paths: [[e(1, 0, 'S', 'bank-a'), e(0, 1, 'W', 'bank-a')]] },
  'chicane:a': { footprint: [2, 2], paths: [[e(1, 0, 'S'), e(0, 1, 'N')]] },
  'chicane:b': { footprint: [2, 2], paths: [[e(0, 0, 'S'), e(1, 1, 'N')]] },
  loop: { footprint: [1, 2], paths: [[e(0, 0, 'S'), e(0, 1, 'N')]] },
  'corkscrew-roll': { footprint: [1, 2], paths: [[e(0, 0, 'S'), e(0, 1, 'N')]] },
  'corkscrew-helix:left': { footprint: [2, 2], paths: [[e(0, 0, 'S'), e(0, 1, 'N', 'elevated')]] },
  'corkscrew-helix:right': { footprint: [2, 2], paths: [[e(1, 0, 'S'), e(1, 1, 'N', 'elevated')]] },
  pipe: straightThrough('pipe'),
  'pipe-entry': straightThrough('ground', 'pipe'),
  'pipe-obstacle': straightThrough('pipe'),
  highway: straightThrough('highway'),
  'highway-entry': straightThrough('ground', 'highway'),
  crossroads: { footprint: [1, 1], paths: [[e(0, 0, 'S'), e(0, 0, 'N')], [e(0, 0, 'E'), e(0, 0, 'W')]] },
  'split-small:a': { footprint: [1, 1], paths: [[e(0, 0, 'S'), e(0, 0, 'N')], [e(0, 0, 'S'), e(0, 0, 'W')]] },
  'split-small:b': { footprint: [1, 1], paths: [[e(0, 0, 'S'), e(0, 0, 'N')], [e(0, 0, 'S'), e(0, 0, 'E')]] },
  'split-large:a': { footprint: [2, 2], paths: [[e(1, 0, 'S'), e(1, 1, 'N')], [e(1, 0, 'S'), e(0, 1, 'W')]] },
  'split-large:b': { footprint: [2, 2], paths: [[e(0, 0, 'S'), e(0, 1, 'N')], [e(0, 0, 'S'), e(1, 1, 'E')]] },
  scenery: { footprint: [1, 1], paths: [] },
};

export function pieceDef(p: Pick<Piece, 'kind' | 'variant'>): PieceDef | undefined {
  return CATALOGUE[`${p.kind}:${p.variant}`] ?? CATALOGUE[p.kind];
}

/** The variants a kind comes in ([undefined] for a kind without variants). */
export function variantsOf(kind: PieceKind): (string | undefined)[] {
  const vs = Object.keys(CATALOGUE).filter((k) => k.startsWith(`${kind}:`)).map((k) => k.slice(kind.length + 1));
  return vs.length ? vs : [undefined];
}

/** True when the kind comes in variants (mirror images, handedness) and `variant` names one of them. */
export const isVariant = (p: Pick<Piece, 'kind' | 'variant'>) => `${p.kind}:${p.variant}` in CATALOGUE;

export const KINDS_WITH_SURFACES: ReadonlySet<PieceKind> = new Set(['start-finish', 'straight', 'corner-small', 'corner-large', 'crossroads', 'split-small']);

const SIDES: Side[] = ['N', 'E', 'S', 'W'];
const rotSide = (s: Side, rot: Rot): Side => SIDES[(SIDES.indexOf(s) + rot) % 4];

/** The footprint after rotation, in tiles [w (x), d (z)]. */
export function rotatedFootprint(def: PieceDef, rot: Rot): [number, number] {
  const [w, d] = def.footprint;
  return rot % 2 ? [d, w] : [w, d];
}

/** An end of a placed piece in world tile coordinates: rotate the rot-0 layout clockwise (seen from above). */
export function placedEnd(def: PieceDef, piece: Pick<Piece, 'x' | 'z' | 'rot'>, end: End): End & { x: number; z: number } {
  const [w, d] = def.footprint;
  let dx = end.dx;
  let dz = end.dz;
  // One clockwise quarter turn of the footprint (seen from above, north up): (dx, dz) → (dz, w-1-dx), w/d swap.
  let cw = w;
  let cd = d;
  for (let i = 0; i < piece.rot; i++) {
    [dx, dz] = [dz, cw - 1 - dx];
    [cw, cd] = [cd, cw];
  }
  return { ...end, dx, dz, side: rotSide(end.side, piece.rot), x: piece.x + dx, z: piece.z + dz };
}

const SIDE_DIR: Record<Side, [number, number]> = { N: [0, 1], E: [1, 0], S: [0, -1], W: [-1, 0] };

/**
 * The world point (metres; x east, y up, -z north) at the middle of an end's tile side, and the unit direction
 * pointing INTO the piece there.
 */
export function endFrame(end: { x: number; z: number; side: Side; level: Level }, groundY: number) {
  const [sx, sz] = SIDE_DIR[end.side];
  const cx = (end.x + 0.5 + sx * 0.5) * TILE_M;
  const cz = (end.z + 0.5 + sz * 0.5) * TILE_M;
  const y = end.level === 'elevated' ? HILL_M : groundY;
  return { pos: [cx, y, -cz] as [number, number, number], inward: [-sx, 0, sz] as [number, number, number] };
}
