// The generator terrain of a track (CS-FB-003): one `terrain` grid per bundled track in ssg.models.json
// (`terrain-<id>`), written from the track's corner heights and water by scripts/build-terrain-specs.ts, plus one flat
// apron per scenery set (`apron-<set>`) that carries the ground out to the horizon round the 30×30 grid.
// tests/terrain-spec.test.ts checks that ssg.models.json matches the bundled tracks.
//
// Frames. The generator's grid: tile (i, j) covers x ∈ [(i − ½)·cell, (i + ½)·cell], z ∈ [j·cell, (j + 1)·cell], N = +Z.
// Ours: tile (x, z) covers world x ∈ [x·cell, (x + 1)·cell], world z ∈ [−(z + 1)·cell, −z·cell] (north is −Z). So the
// heights go in as they are (row j = our z, column i = our x) and render/terrain.ts places the GLB with
// x + cell/2 and z mirrored (scale.z = −1).
import { pieceDef, rotatedFootprint } from './pieces';
import { GRID, HILL_M, TILE_M, type Scenery, type TrackFile } from './types';

export const TERRAIN_BIOME: Record<Scenery, string> = {
  desert: 'desert',
  tropical: 'tropical',
  alpine: 'alpine',
  city: 'meadow',
  country: 'meadow',
};

/** Swatch overrides on top of the biome: the alpine biome's snow reads as grey under our sun, so a brighter one. */
export const TERRAIN_MATERIALS: Partial<Record<Scenery, Record<string, string>>> = {
  alpine: { ground: '#f4f8fc' },
};

/** Shade variation (the generator's default 0.06 makes the apron's big faces blotchy next to the grid's). */
const SHADE = 0.04;
const materials = (set: Scenery) => (TERRAIN_MATERIALS[set] ? { materials: TERRAIN_MATERIALS[set] } : {});

/**
 * Generator scatter per set: low-poly rocks, grass, shrubs and flowers (Synty foliage with its own shader exports
 * white; ferns and big rocks cost 500+ triangles each). Densities are per tile, ~150 k triangles a track at most.
 */
const SMALL_ROCKS = 'POLYGON_Gang_Warfare/SM_Generic_Small_Rocks_03';
const SHRUB = 'POLYGON_Pro_Racer/SM_Gen_Env_Shrub_01';
export const TERRAIN_SCATTER: Record<Scenery, { asset: string; density: number; scale: [number, number] }[]> = {
  desert: [
    { asset: 'POLYGON_NatureBiomes_AridDesert/SM_Env_Grass_01', density: 1.5, scale: [1, 1.6] },
    { asset: SMALL_ROCKS, density: 1.5, scale: [2, 4] },
    { asset: 'POLYGON_NatureBiomes_AridDesert/SM_Env_Rock_02', density: 0.15, scale: [0.8, 1.5] },
  ],
  tropical: [
    { asset: SHRUB, density: 1.5, scale: [1.4, 2.2] },
    { asset: 'POLYGON_NatureBiomes_MeadowForest/SM_Env_Grass_Bush_01', density: 0.8, scale: [1, 1.6] },
    { asset: SMALL_ROCKS, density: 1, scale: [2, 4] },
  ],
  alpine: [
    { asset: 'POLYGON_NatureBiomes_AlpineMountain/SM_Env_Grass_01', density: 2, scale: [1, 1.6] },
    { asset: 'POLYGON_NatureBiomes_AlpineMountain/SM_Env_Flowers_01', density: 1, scale: [1.5, 2.2] },
    { asset: SMALL_ROCKS, density: 1, scale: [2, 4] },
    { asset: 'POLYGON_NatureBiomes_MeadowForest/SM_Env_Rock_01', density: 0.2, scale: [1, 2] },
  ],
  city: [
    { asset: SHRUB, density: 1.5, scale: [1.4, 2.2] },
    { asset: SMALL_ROCKS, density: 0.5, scale: [2, 4] },
  ],
  country: [
    { asset: SHRUB, density: 1.5, scale: [1.4, 2.2] },
    { asset: 'POLYGON_NatureBiomes_AlpineMountain/SM_Env_Flowers_01', density: 1.5, scale: [1.5, 2.2] },
    { asset: 'POLYGON_NatureBiomes_MeadowForest/SM_Env_Grass_Short_Clump_01', density: 3, scale: [2, 3] },
    { asset: SMALL_ROCKS, density: 0.5, scale: [2, 4] },
  ],
};

/**
 * The slope shape matches the road model on hill slopes: `tp-straight-slope` is a `slope-up` with `transition: 0`
 * (one constant grade, as the simulation drives it), and the terrain's `track` shape with the same
 * transition lies exactly on it.
 */
export const TERRAIN_TRANSITION = 0;
/** Vertices per tile side: the slopes are planar, so only the sunken water beds need more than one. */
export const TERRAIN_SUBDIV = 2;

type WaterCode = '.' | 'w' | 'NE' | 'NW' | 'SE' | 'SW';
/** Ours: the corner the DRY triangle points at; the generator's coast: the WATER's corner (the opposite one). */
const OPPOSITE = { NE: 'SW', SW: 'NE', NW: 'SE', SE: 'NW' } as const;

export function waterRows(t: TrackFile): (string | WaterCode[])[] {
  return t.water.map((row) => {
    const codes: WaterCode[] = row.map((w) => (w === true ? 'w' : w ? OPPOSITE[w] : '.'));
    return codes.every((c) => c.length === 1) ? codes.join('') : codes;
  });
}

/** Tiles under any piece (road or prop), kept free of scatter. */
export function clearTiles(t: TrackFile): [number, number][] {
  const out = new Set<string>();
  for (const p of t.pieces) {
    const def = pieceDef(p);
    const [w, d] = def ? rotatedFootprint(def, p.rot) : [1, 1];
    for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) if (p.x + dx < GRID && p.z + dz < GRID) out.add(`${p.x + dx},${p.z + dz}`);
  }
  return [...out].map((k) => k.split(',').map(Number) as [number, number]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

const round = (v: number) => Math.round(v * 1e4) / 1e4;

/** The ssg.models.json entry for a track's terrain. */
export function terrainEntry(id: string, t: TrackFile) {
  return {
    name: `terrain-${id}`,
    terrain: {
      cell: round(TILE_M),
      height: round(HILL_M),
      shape: 'track',
      subdiv: TERRAIN_SUBDIV,
      transition: TERRAIN_TRANSITION,
      biome: TERRAIN_BIOME[t.scenery],
      ...materials(t.scenery),
      shade: SHADE,
      heights: t.heights.map((r) => [...r]),
      water: waterRows(t),
      scatter: TERRAIN_SCATTER[t.scenery],
      clear: clearTiles(t),
    },
  };
}

/**
 * CS-FB-101: a terrain grid has no margin / outer ground option, so the apron is a second, coarse grid whose middle
 * sinks out of sight under the track's grid.
 *
 * The apron round the grid: a flat planar terrain of 2×2-tile cells, APRON × APRON of them, with the track's 15×15
 * cells in the middle. The corners inside that square sink (APRON_SINK steps down), so the apron's middle slopes away
 * under the track's own terrain and never shows through; its corners on the grid's edge stay at 0, level with it.
 */
export const APRON = 125;
export const APRON_CELL_TILES = 2;
/** The track grid's first apron cell (as many cells on each side). */
export const APRON_AT = (APRON - GRID / APRON_CELL_TILES) / 2;
const APRON_STEP = 10;
const APRON_SINK = -4;

export function apronEntry(set: Scenery) {
  const n = GRID / APRON_CELL_TILES;
  const heights = Array.from({ length: APRON + 1 }, (_, j) =>
    Array.from({ length: APRON + 1 }, (_, i) => (i > APRON_AT && i < APRON_AT + n && j > APRON_AT && j < APRON_AT + n ? APRON_SINK : 0)),
  );
  return {
    name: `apron-${set}`,
    terrain: {
      cell: round(TILE_M * APRON_CELL_TILES),
      height: APRON_STEP,
      shape: 'planar',
      biome: TERRAIN_BIOME[set],
      ...materials(set),
      shade: SHADE / 2,
      chunk: 25,
      heights,
    },
  };
}
