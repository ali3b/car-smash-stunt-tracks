// The drivable surface of a track: which plane a wheel stands on, its surface type, the height the plane is lifted
// by, and the wall it may hit. Our own implementation of the behaviour described in research/SPEC.md ("Track
// surfaces"), integer-exact so the car step can match the original frame by frame.
//
// Every piece kind has a "surface model" (the original's physical model). A point is first located in its tile and
// in the piece's own frame (rotated back to rot 0, origin at the centre of the piece's footprint); the model then
// picks a plane (from src/sim/track-planes.ts), a wheel surface code and maybe a wall (src/sim/track-walls.ts) from
// that local position, the point's height above the tile and the wheel's previous position. Terrain (hill slopes,
// hill corners, plateaus, water) is applied afterwards.
import type { Piece, TrackFile } from '../track/types';
import { pieceDef, rotatedFootprint } from '../track/pieces';
import { cos16, ldiv, mulScale, polarAngle, polarRadius2D, sin16 } from './fixmath';
import type { SurfaceSample, SurfaceType, TrackSampler, WallContact } from './surface';
import { buildPlanes, type Plane } from './track-planes';
import { buildWalls, type Wall } from './track-walls';
import { HIGHWAY_ENTRY, LOOP, PIPE, BANK_ENTRY, ROLL } from './track-geometry';

const GRID = 30;
const HILL = 450;

/** Surface models (the original's physical-model numbers, kept so the SPEC and the code can be compared). */
export const enum Model {
  StartFinish = 0, Straight = 1, CornerSmall = 2, CornerLarge = 3, ChicaneA = 4, ChicaneB = 5, SplitSmallA = 6,
  SplitSmallB = 7, SplitLargeA = 8, SplitLargeB = 9, HighwayEntry = 10, Highway = 11, Crossroads = 12, Ramp = 16,
  RampSolid = 17, Elevated = 18, ElevatedSpan = 19, ElevatedSolid = 20, ElevatedCorner = 21, SpanOverRoad = 22,
  BankEntryB = 23, BankEntryA = 24, Banked = 25, BankedCorner = 26, Loop = 27, Tunnel = 28, PipeEntry = 29, Pipe = 30,
  PipeObstacle = 31, HelixLeft = 32, HelixRight = 33, Slalom = 34, Roll = 35, Barn = 65, GasStation = 66, Diner = 67,
  Office = 68, Windmill = 69, Boat = 70, None = 64,
}

const MODEL_BY_KIND: Record<string, Model> = {
  'start-finish': Model.StartFinish, straight: Model.Straight, 'corner-small': Model.CornerSmall,
  'corner-large': Model.CornerLarge, 'chicane:a': Model.ChicaneA, 'chicane:b': Model.ChicaneB,
  'split-small:a': Model.SplitSmallA, 'split-small:b': Model.SplitSmallB, 'split-large:a': Model.SplitLargeA,
  'split-large:b': Model.SplitLargeB, 'highway-entry': Model.HighwayEntry, highway: Model.Highway,
  crossroads: Model.Crossroads, ramp: Model.Ramp, 'ramp-bridge': Model.Ramp, 'ramp-solid': Model.RampSolid,
  elevated: Model.Elevated, 'elevated-span': Model.ElevatedSpan, 'elevated-solid': Model.ElevatedSolid,
  'elevated-corner': Model.ElevatedCorner, 'elevated-span-over-road': Model.SpanOverRoad,
  'bank-entry:a': Model.BankEntryA, 'bank-entry:b': Model.BankEntryB, banked: Model.Banked,
  'banked-corner': Model.BankedCorner, loop: Model.Loop, tunnel: Model.Tunnel, 'pipe-entry': Model.PipeEntry,
  pipe: Model.Pipe, 'pipe-obstacle': Model.PipeObstacle, 'corkscrew-helix:left': Model.HelixLeft,
  'corkscrew-helix:right': Model.HelixRight, slalom: Model.Slalom, 'corkscrew-roll': Model.Roll,
  'scenery:barn': Model.Barn, 'scenery:gas-station': Model.GasStation, 'scenery:diner': Model.Diner,
  'scenery:office': Model.Office, 'scenery:windmill': Model.Windmill, 'scenery:boat': Model.Boat,
};

export function surfaceModel(p: Pick<Piece, 'kind' | 'variant'>): Model {
  return MODEL_BY_KIND[`${p.kind}:${p.variant}`] ?? MODEL_BY_KIND[p.kind] ?? Model.None;
}

/**
 * Terrain classes per tile, numbered like the original's terrain ids: 0 flat, 1 water, 2..5 coast (dry corner NE,
 * NW, SW, SE), 6 plateau, 7..10 slope rising N, W, S, E, 11..14 one corner raised (NW, SW, SE, NE), 15..18 one
 * corner lowered (SE, NE, NW, SW).
 */
export function terrainClass(track: TrackFile, x: number, z: number): number {
  const w = track.water[z]?.[x];
  if (w === true) return 1;
  if (w) return ({ NE: 2, NW: 3, SW: 4, SE: 5 } as const)[w];
  const h = track.heights;
  const key = `${h[z + 1][x] ? 1 : 0}${h[z + 1][x + 1] ? 1 : 0}${h[z][x + 1] ? 1 : 0}${h[z][x] ? 1 : 0}`; // NW NE SE SW
  return TERRAIN_BY_CORNERS[key] ?? 0;
}

const TERRAIN_BY_CORNERS: Record<string, number> = {
  '0000': 0, '1111': 6, '1100': 7, '1001': 8, '0011': 9, '0110': 10, '1000': 11, '0001': 12, '0010': 13,
  '0100': 14, '1101': 15, '1011': 16, '0111': 17, '1110': 18,
};

interface Cell {
  model: Model;
  /** Quarter turns clockwise (the original's rotation / 256). */
  rot: number;
  /** Road surface code: 1 paved, 2 dirt, 3 ice. */
  code: number;
  cx: number;
  cz: number;
}

const ROAD_CODE = { paved: 1, dirt: 2, ice: 3 } as const;

/** Slope substitution: a straight along a hill slope, or a ramp running down it, keeps working; anything else on a slope is ignored. */
function onSlope(cell: Cell, piece: Piece, terrain: number): Cell | null {
  const axis = terrain === 7 || terrain === 9 ? 0 : 1; // 7/9: slope runs north-south
  if (piece.kind === 'straight' && piece.rot % 2 === axis) return { ...cell, model: Model.Straight, rot: [0, 3, 2, 1][terrain - 7] };
  if (piece.kind === 'ramp' || piece.kind === 'ramp-bridge' || piece.kind === 'ramp-solid') {
    // A ramp rising against the slope becomes a deck carried by the hill.
    const downhill = [2, 1, 0, 3][terrain - 7];
    if (piece.rot === downhill) return { ...cell, model: Model.ElevatedSpan, rot: (piece.rot + 2) % 4, code: 1 };
  }
  return null;
}

export interface Tables {
  planes: readonly Plane[];
  walls: readonly Wall[];
}

let defaultTables: Tables | null = null;
export function derivedTables(): Tables {
  return (defaultTables ??= { planes: buildPlanes(), walls: buildWalls() });
}

/** Prepares a track for surface queries. `tables` defaults to the plane and wall tables derived from our geometry. */
export function createTrackSurface(track: TrackFile, tables: Tables = derivedTables()): TrackSampler {
  const cells: (Cell | null)[] = new Array(GRID * GRID).fill(null);
  const terrain = new Uint8Array(GRID * GRID);
  for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) terrain[z * GRID + x] = terrainClass(track, x, z);
  for (const p of track.pieces) {
    const def = pieceDef(p);
    if (!def) continue;
    const [w, d] = rotatedFootprint(def, p.rot);
    const base: Cell = {
      model: surfaceModel(p),
      rot: p.rot,
      code: ROAD_CODE[p.surface ?? 'paved'],
      cx: p.x * 1024 + (w === 2 ? 1024 : 512),
      cz: p.z * 1024 + (d === 2 ? 1024 : 512),
    };
    for (let dz = 0; dz < d; dz++)
      for (let dx = 0; dx < w; dx++) {
        const tx = p.x + dx;
        const tz = p.z + dz;
        if (tx < 0 || tz < 0 || tx >= GRID || tz >= GRID) continue;
        const t = terrain[tz * GRID + tx];
        const cell = t >= 7 && t <= 10 ? onSlope(base, p, t) ?? { ...base, model: Model.None } : base;
        cells[tz * GRID + tx] = cell;
      }
  }
  const { planes, walls } = tables;

  function surfaceAt(x: number, y: number, z: number, prev?: readonly [number, number, number], mode = 1): SurfaceSample {
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    const px = prev ? Math.floor(prev[0]) : x;
    const pz = prev ? Math.floor(prev[2]) : z;
    const r = locate(x, y, z, px, pz, mode);
    return finish(r, x, y, z);
  }


  function locate(x: number, y: number, z: number, px: number, pz: number, mode: number): Probe {
    const res: Probe = {
      plane: 0, base: 0, cx: 0, cz: 0, code: 4, wall: -1, wallRot: 0, rotQ: 0, high: -12, low: -1000,
      solid: true, corkscrew: false, inside: false,
    };
    const tx = x >> 10;
    const tz = z >> 10;
    if (tx < 0 || tx >= GRID || tz < 0 || tz >= GRID) return res;
    res.inside = true;
    if (mode === 2) {
      res.code = 1;
      return res;
    }
    res.cx = tx * 1024 + 512;
    res.cz = tz * 1024 + 512;
    const t = terrain[tz * GRID + tx];
    if (t === 1) res.code = 5;
    else if (t >= 2 && t <= 5) {
      const a = [128, -640, -384, -128][t - 2];
      const d = mulScale(z - res.cz, sin16(a)) + mulScale(x - res.cx, cos16(a));
      if (d < 0) res.code = 5;
    } else if (t === 6) res.base = HILL;

    const cell = cells[tz * GRID + tx];
    if (cell && cell.model !== Model.None) {
      res.cx = cell.cx;
      res.cz = cell.cz;
      res.rotQ = cell.rot;
      const [lx, lz] = toLocal(x - cell.cx, z - cell.cz, cell.rot);
      const [qx, qz] = toLocal(px - cell.cx, pz - cell.cz, cell.rot);
      model(res, cell, lx, lz, qx, qz, y - res.base, mode);
    }
    applyTerrain(res, t, x - (tx * 1024 + 512), z - (tz * 1024 + 512));
    return res;
  }

  function finish(r: Probe, x: number, _y: number, z: number): SurfaceSample {
    let plane = r.plane;
    if (plane > 0) plane = plane * 4 + ((4 - r.rotQ) & 3);
    let base = r.base;
    if (r.code === 4) base += ((z ^ x) >> 8) & 1;
    else base += 2;
    let wallsOut: WallContact[] | undefined;
    if (r.wall >= 0) {
      const w = walls[r.wall];
      const [wx, wz] = toWorld(w.x, w.z, r.rotQ);
      wallsOut = [{ index: r.wall, angle: (-w.angle + r.rotQ * 256 + r.wallRot) & 0x3ff, x: wx + r.cx, z: wz + r.cz, low: r.low, high: r.high }];
    }
    const pl = planes[plane];
    const normal: [number, number, number] = plane < 4 ? [0, 8192, 0] : [pl.normal[0], pl.normal[1], pl.normal[2]];
    const sample: SurfaceSample = {
      height: 0,
      normal,
      surface: SURFACE_NAMES[r.code],
      kind: !r.inside ? 'none' : r.code <= 3 ? 'road' : 'terrain',
      walls: wallsOut,
      plane,
      baseHeight: base,
      centerX: r.cx,
      centerZ: r.cz,
      code: r.code,
      solid: r.solid,
      corkscrew: r.corkscrew,
    };
    sample.height = planeHeight(sample, x, z);
    return sample;
  }

  function planeHeight(s: SurfaceSample, x: number, z: number): number {
    if (s.plane < 4) return s.baseHeight;
    const p = planes[s.plane];
    const [nx, ny, nz] = p.normal;
    if (ny === 0) return NaN;
    const ox = p.origin[0] + s.centerX;
    const oz = p.origin[2] + s.centerZ;
    return p.origin[1] + s.baseHeight - (nx * (x - ox) + nz * (z - oz)) / ny;
  }

  function distance(s: SurfaceSample, x: number, y: number, z: number): number {
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    const p = planes[s.plane];
    const dy = y - (p.origin[1] + s.baseHeight);
    if (s.plane < 4) return dy;
    const dx = x - (p.origin[0] + s.centerX);
    const dz = z - (p.origin[2] + s.centerZ);
    const [nx, ny, nz] = p.normal;
    return ldiv(nx * dx + nz * dz + ny * dy, 8192);
  }

  return { surfaceAt, distance };
}

const SURFACE_NAMES: SurfaceType[] = ['paved', 'paved', 'dirt', 'ice', 'grass', 'water'];

/** World offset from the piece centre → the piece's own (rot 0) frame. */
function toLocal(dx: number, dz: number, rot: number): [number, number] {
  switch (rot & 3) {
    case 1: return [-dz, dx];
    case 2: return [-dx, -dz];
    case 3: return [dz, -dx];
    default: return [dx, dz];
  }
}

/** The piece's own frame → world offset. */
function toWorld(lx: number, lz: number, rot: number): [number, number] {
  switch (rot & 3) {
    case 1: return [lz, -lx];
    case 2: return [-lx, -lz];
    case 3: return [-lz, lx];
    default: return [lx, lz];
  }
}

const abs = Math.abs;

/** The per-model rules. lx/lz: the point in the piece frame; qx/qz: the previous position; h: height above the tile. */
function model(r: Probe, cell: Cell, lx: number, lz: number, qx: number, qz: number, h: number, mode: number) {
  const road = () => { r.code = cell.code; };
  const corner = (a: number, b: number, radius: number) => {
    const d = polarRadius2D(a, b);
    if (d > radius - 120 && d < radius + 120) road();
  };
  switch (cell.model) {
    case Model.StartFinish:
      if (mode === 0 && lx > 0) {
        if (lz < -380) r.plane = 131;
        else if (lz < -300) r.plane = 132;
      }
      if (abs(lx) < 120) road();
      return;
    case Model.Straight:
      if (abs(lx) < 120) road();
      return;
    case Model.Crossroads:
      if (abs(lx) < 120 || abs(lz) < 120) road();
      return;
    case Model.ChicaneA:
    case Model.ChicaneB:
      // The whole footprint counts as road.
      road();
      return;
    case Model.CornerLarge:
      corner(lx + 1024, lz + 1024, 1536);
      return;
    case Model.CornerSmall:
      corner(lx + 512, lz + 512, 512);
      return;
    case Model.SplitSmallA:
      if (abs(lx) < 120) road();
      else corner(lx + 512, lz + 512, 512);
      return;
    case Model.SplitSmallB:
      if (abs(lx) < 120) road();
      else corner(512 - lx, lz + 512, 512);
      return;
    case Model.SplitLargeA:
      if (lx >= 392 && lx <= 632) road();
      else corner(lx + 1024, lz + 1024, 1536);
      return;
    case Model.SplitLargeB:
      if (lx >= -632 && lx <= -392) road();
      else corner(1024 - lx, lz + 1024, 1536);
      return;
    case Model.HighwayEntry:
      highwayEntry(r, cell, lx, lz, qx);
      return;
    case Model.Highway: {
      const a = abs(lx);
      if (a > 360) return;
      if (a > 120) { road(); return; }
      r.plane = 1;
      if (qx <= -120) r.wall = 0xbc;
      else if (qx >= 120) r.wall = 0xba;
      return;
    }
    case Model.Ramp:
      if (lz > 0) r.solid = false;
      else if (qz >= 0) r.wall = 0x66;
      ramp(r, cell, lx, lz, qx);
      return;
    case Model.RampSolid:
      if (qz >= 476) r.wall = 0x67;
      ramp(r, cell, lx, lz, qx);
      return;
    case Model.Elevated:
    case Model.ElevatedSpan:
      if (h <= 390) return;
      r.solid = false;
      deck(r, cell, lx, qx, qz);
      return;
    case Model.SpanOverRoad:
      if (h > 390) {
        r.solid = false;
        deck(r, cell, lx, qx, qz);
      } else if (abs(lz) <= 120) road();
      return;
    case Model.ElevatedSolid:
      deck(r, cell, lx, qx, qz);
      return;
    case Model.ElevatedCorner: {
      if (h <= 390) return;
      const d = polarRadius2D(lx + 1024, lz + 1024) - 1536;
      if (d <= -150 || d >= 150) return;
      road();
      r.plane = 2;
      r.solid = false;
      if (d >= -108 && d <= 108) return;
      const sector = 17 - (((polarAngle(lx + 1024, lz + 1024) & 0xff) * 18) >> 8);
      r.high = 42;
      r.low = -12;
      r.wall = sector + (d < 0 ? 0x69 : 0x7b);
      return;
    }
    case Model.BankEntryA:
    case Model.BankEntryB:
      bankEntry(r, cell, lx, lz, qx);
      return;
    case Model.Banked:
      if (abs(lx) > 120) return;
      road();
      r.plane = 6;
      if (qx >= 120) {
        r.wallRot = 0x200;
        r.wall = 0x65;
      }
      return;
    case Model.BankedCorner: {
      const d = polarRadius2D(lx + 1024, lz + 1024) - 1536;
      if (d <= -120 || d >= 126) return;
      const sector = 17 - (((polarAngle(lx + 1024, lz + 1024) & 0xff) * 18) >> 8);
      r.plane = sector + 7;
      road();
      if (d > 102) {
        r.wallRot = 0x200;
        r.wall = sector + 0x7b;
        r.solid = false;
      }
      return;
    }
    case Model.Loop:
      loop(r, cell, lx, lz, h);
      return;
    case Model.Tunnel:
      tunnel(r, cell, lx, qx, qz);
      return;
    case Model.PipeEntry:
      pipeEntry(r, cell, lx, lz, qx, h);
      return;
    case Model.Pipe:
    case Model.PipeObstacle:
      pipe(r, cell, lx, lz, qx, qz, h, cell.model === Model.PipeObstacle);
      return;
    case Model.Roll:
      roll(r, cell, lx, lz, h);
      return;
    case Model.HelixLeft:
    case Model.HelixRight:
      helix(r, cell, lx, lz, h);
      return;
    case Model.Slalom:
      slalom(r, cell, lx, lz, qx, qz);
      return;
    case Model.Barn: return box(r, lx, lz, qx, qz, -150, 150, 150, 425, [0xa1, 0xa2, 0xa4, 0xa3]);
    case Model.GasStation: return box(r, lx, lz, qx, qz, -200, 260, 80, 230, [0xa5, 0xa8, 0xa6, 0xa7]);
    case Model.Diner: return box(r, lx, lz, qx, qz, -180, 180, 100, 248, [0xa9, 0xac, 0xab, 0xaa]);
    case Model.Office: return box(r, lx, lz, qx, qz, -200, 200, 200, 550, [0xad, 0xae, 0xaf, 0xb0]);
    case Model.Windmill: return box(r, lx, lz, qx, qz, -114, 114, 114, 495, [0xb4, 0xb2, 0xb1, 0xb3]);
    case Model.Boat: return box(r, lx, lz, qx, qz, -170, 260, 110, 230, [0xb5, 0xb8, 0xb7, 0xb6]);
    default:
      return;
  }
}

/** What the lookup has found so far (the original keeps these in globals while it decides). */
interface Probe {
  plane: number;
  base: number;
  cx: number;
  cz: number;
  code: number;
  wall: number;
  wallRot: number;
  rotQ: number;
  high: number;
  low: number;
  solid: boolean;
  corkscrew: boolean;
  inside: boolean;
}

/** Ramps (open and solid): the slope plane, the side rails and the underside. */
function ramp(r: Probe, cell: Cell, lx: number, lz: number, qx: number) {
  if (abs(qx) < 120) {
    r.plane = 3;
    r.code = cell.code;
    if (r.wall !== -1 || lz < 0 || abs(lx) < 120) return;
    r.high = 42;
    r.low = -12;
    r.wall = lx >= 0 ? 0x65 : 0x64;
    return;
  }
  if (!r.solid || abs(lx) > 120) return;
  r.plane = 3;
  if (r.wall !== -1) return;
  r.wallRot = 0x200;
  r.wall = lx >= 0 ? 0x65 : 0x64;
}

/** Elevated decks: on the deck only when the wheel came from the deck; edge rails; solid blocks have end faces. */
function deck(r: Probe, cell: Cell, lx: number, qx: number, qz: number) {
  if (abs(qx) <= 120) {
    r.plane = 2;
    r.code = cell.code;
    if (r.solid) {
      if (qz >= 476) r.wall = 0x67;
      else if (qz <= -476) r.wall = 0x68;
    }
    if (abs(lx) < 120) return;
    r.high = 42;
    r.wall = lx >= 0 ? 0x65 : 0x64;
    return;
  }
  if (!r.solid || abs(lx) > 120) return;
  r.plane = 2;
  r.high = 42;
  r.wallRot = 0x200;
  r.wall = qx >= 0 ? 0x65 : 0x64;
}

function highwayEntry(r: Probe, cell: Cell, lx: number, lz: number, qx: number) {
  const a = abs(lx);
  const { z: Z, inner, outer } = HIGHWAY_ENTRY;
  let i = 0;
  while (Z[i + 1] < lz) i++;
  const lerp = (t: readonly number[]) => (t[i] === t[i + 1] ? t[i] : t[i] + ldiv((t[i + 1] - t[i]) * (lz - Z[i]), Z[i + 1] - Z[i]));
  const lo = lerp(inner);
  const hi = lerp(outer);
  if (a > lo && a < hi) {
    r.code = cell.code;
    return;
  }
  if (lz < 0 || a > 120) return;
  r.plane = 1;
  if (lz >= 334) {
    if (qx <= -120) r.wall = 0xbc;
    else if (qx >= 120) r.wall = 0xba;
  } else r.wall = qx >= 0 ? 0xbb : 0xbd;
}

function bankEntry(r: Probe, cell: Cell, lx: number, lz: number, qx: number) {
  const a = cell.model === Model.BankEntryA;
  const base = a ? 35 : 25;
  if (abs(lx) > 120) return;
  if (a && qx <= -120) {
    r.wallRot = 0x200;
    r.wall = 0x64;
  } else if (!a && qx >= 120) {
    r.wallRot = 0x200;
    r.wall = 0x65;
  }
  r.code = cell.code;
  if (lz < -334) { r.plane = base; return; }
  if (lz >= 334) { r.plane = base + 9; return; }
  const seg = lz < -168 ? 0 : lz < 0 ? 1 : lz < 168 ? 2 : 3;
  r.plane = base + 1 + seg * 2;
  const ang = a ? BANK_ENTRY.splitA : BANK_ENTRY.splitB;
  const d = mulScale(lz - BANK_ENTRY.segmentCentres[seg], sin16(ang)) + mulScale(lx, cos16(ang));
  if (d > 0) r.plane++;
}

function loop(r: Probe, cell: Cell, lx: number, lz: number, h: number) {
  const north = lz >= 0;
  const base = north ? 45 : 51;
  const u = north ? lx : -lx;
  const v = north ? lz : -lz;
  const { profileZ: PZ, laneX: LX, top } = LOOP;
  const onLoop = (si: number) => {
    r.plane = base + si;
    r.code = cell.code;
    r.solid = false;
  };
  // The lane's left edge at depth w in segment si (the lane shifts sideways over the loop), and the 400-wide lane.
  const edge = (si: number, w: number) => LX[si] + ldiv((LX[si] - LX[si + 1]) * (PZ[si] - w), PZ[si + 1] - PZ[si]);
  approach: {
    let w = v;
    if (v > top - 1) {
      if (v > top + 100) break approach;
      w = top - 1;
    }
    let si = 0;
    while (PZ[si + 1] < w) si++;
    if (h > LOOP.half) {
      si = 5 - si;
      if (LX[si] > u || LX[si + 1] + 400 < u) return;
      if (LX[si + 1] < u && LX[si] + 400 > u) return onLoop(si);
      const e = edge(si, w);
      if (e >= u || e + 400 <= u) return;
      return onLoop(si);
    }
    if (si > 1 && h < 100) break approach;
    if (LX[si] > u || LX[si + 1] + 400 < u) break approach;
    if (LX[si + 1] < u && LX[si] + 400 > u) return onLoop(si);
    if (LX[si] === LX[si + 1]) break approach;
    const e = edge(si, w);
    if (e < u && e + 400 > u) return onLoop(si);
  }
  // The flat approach road, bending from the loop's lane back to the tile centre line.
  const { at: A, left: L, right: R } = LOOP.approach;
  let si = 0;
  while (A[si + 1] < v) si++;
  const lerp = (t: readonly number[]) => t[si] + ldiv((t[si + 1] - t[si]) * (v - A[si]), A[si + 1] - A[si]);
  if (u >= lerp(L) && u <= lerp(R)) r.code = cell.code;
}

function tunnel(r: Probe, cell: Cell, lx: number, qx: number, qz: number) {
  if (abs(lx) < 120) r.code = cell.code;
  if (lx >= 120 && lx <= 270) {
    r.high = 144;
    if (qz <= -512) r.wall = 0x9a;
    else if (qz >= 512) r.wall = 0x99;
    else if (qx <= 120) r.wall = 0x98;
    else if (qx >= 270) r.wall = 0x96;
  } else if (lx <= -120 && lx >= -270) {
    r.high = 144;
    if (qz <= -512) r.wall = 0x9a;
    else if (qz >= 512) r.wall = 0x99;
    else if (qx >= -120) r.wall = 0x97;
    else if (qx <= -270) r.wall = 0x95;
  }
}

function pipeEntry(r: Probe, cell: Cell, lx: number, lz: number, qx: number, h: number) {
  if (abs(qx) >= 115 && abs(lx) <= 164) {
    r.high = 151;
    r.wall = qx > 0 ? 0x9f : 0xa0;
    return;
  }
  if (abs(lx) >= 115 || h >= 171) return;
  r.code = cell.code;
  if (abs(lx) < 31) { r.plane = 70; return; }
  const [plane, e, ang] = lx < -84 ? [73, -100, -5] : lx < 0 ? [71, -57, -8] : lx > 84 ? [77, 100, 5] : [75, 57, 8];
  r.plane = plane;
  if (mulScale(lz, sin16(ang)) + mulScale(lx - e, cos16(ang)) < 0) r.plane++;
}

/** Which of the twelve faces of the pipe section a point is on (index into the pipe planes 57..68, -57 = none). */
function pipeFace(lx: number, h: number): number {
  const up = h > 151;
  if (h > 88 && !up) return lx < 0 ? 3 : 9;
  if (abs(lx) < 31) return up ? 6 : 0;
  if (lx < -84) return up ? 4 : 2;
  if (lx < 0) return up ? 5 : 1;
  if (lx > 84) return up ? 8 : 10;
  return up ? 7 : 11;
}

function pipe(r: Probe, cell: Cell, lx: number, lz: number, qx: number, qz: number, h: number, obstacle: boolean) {
  if (abs(qx) >= 164 && abs(lx) <= 164) {
    r.high = 151;
    r.wall = qx > 0 ? 0x9b : 0x9c;
    return;
  }
  if (abs(lx) >= 164 || h >= 265) return;
  if (abs(lx) < 130) r.code = cell.code;
  const up = h > 151;
  if (obstacle && !up && abs(lx) <= PIPE.bumpHalfWidth && abs(lz) <= PIPE.bumpHalfLength) {
    r.plane = 69;
    if (qz <= -PIPE.bumpHalfLength) r.wall = 0x9d;
    else if (qz >= PIPE.bumpHalfLength) r.wall = 0x9e;
    return;
  }
  r.plane = 57 + pipeFace(lx, h);
}

function roll(r: Probe, cell: Cell, lx: number, lz: number, h: number) {
  if (abs(lx) >= 130 || h >= 265) return;
  r.code = cell.code;
  const k = pipeFace(lx, h);
  if (k !== 0 && ROLL.from[k] < lz && ROLL.to[k] > lz) r.plane = k + 57;
  if (r.plane !== 0) return;
  if (abs(lz) >= 512) return;
  r.wall = 0xb9;
  r.corkscrew = true;
  r.high = 117;
}

function helix(r: Probe, cell: Cell, lx: number, lz: number, h: number) {
  const left = cell.model === Model.HelixLeft;
  const u = left ? -lx : lx;
  const base = left ? 79 : 105;
  const [wOut, wIn] = left ? [50, 75] : [0, 25];
  r.corkscrew = true;
  if (lz < 0 && h < 100 && u > 0) {
    if (u >= 632 || u <= 392) return;
    r.code = cell.code;
    r.plane = base;
    return;
  }
  if (lz > 0 && h > 350 && u > 332 && u < 692) {
    r.high = 42;
    r.low = -12;
    r.wall = (u > 512 ? wOut : wIn) + 24;
    r.code = cell.code;
    r.plane = base + 25;
    r.solid = false;
    return;
  }
  const d = polarRadius2D(u, lz);
  if (d <= 332 || d >= 692) return;
  const s = (((256 - polarAngle(u, lz)) & 0x3ff) * 24) >> 10;
  r.plane = base + s + 1;
  r.code = cell.code;
  r.solid = false;
  r.high = 42;
  r.low = -12;
  if (d - 512 > 90) r.wall = wOut + s;
  else if (d - 512 < -90) r.wall = wIn + s;
}

function slalom(r: Probe, cell: Cell, lx: number, lz: number, qx: number, qz: number) {
  if (abs(lx) < 120) r.code = cell.code;
  if (lx >= 23 && lx <= 97 && lz > -271 && lz < -241) {
    r.high = 42;
    if (qz < -271) r.wall = 0x91;
    else if (qz > -241) r.wall = 0x92;
    else if (qx < 23) r.wall = 0x94;
    else if (qx > 97) r.wall = 0x93;
  } else if (lx <= -23 && lx >= -97 && lz < 271 && lz > 241) {
    r.high = 42;
    if (qz > 271) r.wall = 0x8d;
    else if (qz < 241) r.wall = 0x8e;
    else if (qx > -23) r.wall = 0x8f;
    else if (qx < -97) r.wall = 0x90;
  }
}

/** A building: four walls around a box x0..x1 by -zh..zh; walls = [south, north, west, east]. */
function box(r: Probe, lx: number, lz: number, qx: number, qz: number, x0: number, x1: number, zh: number, high: number, w: number[]) {
  if (lx < x0 || lx > x1 || abs(lz) > zh) return;
  r.high = high;
  if (qz <= -zh) r.wall = w[0];
  else if (qz >= zh) r.wall = w[1];
  else if (qx <= x0) r.wall = w[2];
  else if (qx >= x1) r.wall = w[3];
}

/** Terrain after the piece: slopes and hill corners pick their plane (unless the piece already did), lowered corners lift the flat part. */
function applyTerrain(r: Probe, t: number, dx: number, dz: number) {
  if (t < 7) return;
  const rq = (t - 7) & 3; // terrain rotation in quarter turns: 7/11/15 → 0, 8/12/16 → 3, 9/13/17 → 2, 10/14/18 → 1
  const q = [0, 3, 2, 1][rq];
  r.rotQ = q;
  const [lx, lz] = toLocal(dx, dz, q);
  if (t <= 10) {
    if (r.plane === 0) r.plane = 3;
    return;
  }
  const d = mulScale(lz, sin16(-128)) + mulScale(lx, cos16(-128));
  if (t <= 14) {
    if (d < 0) r.plane = 4;
  } else if (d > 0) r.plane = 5;
  else r.base = HILL;
}
