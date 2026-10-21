// Track format. A track is a 30×30 grid of tiles (x = east, z = north, tile (0,0) in the south-west corner), each tile
// holding at most one piece (multi-tile pieces sit on their south-west anchor tile and cover the rest), a height for
// every grid corner (31×31: ground or hill top), water per tile, and a scenery set for the horizon and props.
// Distances: the simulation works in track units (1 unit = 0.06096 m, so mph carries over); the renderer in metres.

export const GRID = 30;
/** Metres per track unit. */
export const UNIT_M = 0.06096;
/** A tile is 1024 units (62.42 m). */
export const TILE_UNITS = 1024;
export const TILE_M = TILE_UNITS * UNIT_M;
/** Hill tops and elevated decks are 450 units (27.43 m) up. */
export const HILL_UNITS = 450;
export const HILL_M = HILL_UNITS * UNIT_M;
/** A ground road deck is 240 units (14.63 m) wide. */
export const ROAD_UNITS = 240;
export const ROAD_M = ROAD_UNITS * UNIT_M;

export type Surface = 'paved' | 'dirt' | 'ice';
export type Scenery = 'desert' | 'tropical' | 'alpine' | 'city' | 'country';
/** Quarter turns clockwise seen from above; 0 = the piece's natural heading (roads run south↔north). */
export type Rot = 0 | 1 | 2 | 3;

export type PieceKind =
  | 'start-finish'
  | 'straight'
  | 'corner-small'
  | 'corner-large'
  | 'elevated'
  | 'elevated-solid'
  | 'elevated-span'
  | 'elevated-span-over-road'
  | 'elevated-corner'
  | 'ramp'
  | 'ramp-solid'
  | 'ramp-bridge'
  | 'bank-entry'
  | 'banked'
  | 'banked-corner'
  | 'chicane'
  | 'loop'
  | 'tunnel'
  | 'pipe'
  | 'pipe-entry'
  | 'pipe-obstacle'
  | 'crossroads'
  | 'split-small'
  | 'split-large'
  | 'corkscrew-roll'
  | 'corkscrew-helix'
  | 'highway'
  | 'highway-entry'
  | 'slalom'
  | 'scenery';

export interface Piece {
  x: number;
  z: number;
  kind: PieceKind;
  rot: Rot;
  surface?: Surface;
  /** Which of a kind's mirror/handedness variants (e.g. a split to the left or right, a helix up or down). */
  variant?: string;
}

export interface TrackFile {
  version: 1;
  name: string;
  scenery: Scenery;
  pieces: Piece[];
  /** 31×31 corner heights in hill steps (0 = ground, 1 = hill top), heights[z][x]. */
  heights: number[][];
  /** Water per tile, water[z][x]: false, true (whole tile) or the corner the dry triangle points at (coast). */
  water: (boolean | 'NE' | 'SE' | 'SW' | 'NW')[][];
}
