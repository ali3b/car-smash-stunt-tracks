// The car step's TrackSurface (src/sim/surface.ts) on top of the track lane's lookup (src/sim/track-surface.ts):
// one per track. Every field is the lookup's own integer answer, so a car on our surfaces steps exactly as it does
// on the original's recorded answers (tests/sim-full.test.ts).
import { pieceDef, rotatedFootprint } from '../track/pieces';
import type { TrackFile } from '../track/types';
import { s16 } from './fixed';
import { flatPlane, type Mat3i, type SurfacePlane, type SurfaceProbe, type SurfaceSample, type TrackSampler, type TrackSurface, type Vec3i } from './surface';
import { createTrackSurface, derivedTables, type Tables } from './track-surface';

const GRID = 30;

export interface TrackProbe extends TrackSurface {
  /** The lookup underneath (heights, surface names, walls): for the race logic, the camera and the editor. */
  readonly sampler: TrackSampler;
  /**
   * The game's lookup mode: 0 before the start (the grid's start platform), 1 racing (default), 2 everything is flat
   * paved ground (tests).
   */
  mode: number;
}

/** The car step's surface for a track. `tables` defaults to the planes and walls derived from our own geometry. */
export function createTrackProbe(track: TrackFile, tables: Tables = derivedTables()): TrackProbe {
  const sampler = createTrackSurface(track, tables);
  const { planes } = tables;
  // Plane records are shared: one object per (plane index, element centre, base height).
  const planeCache = new Map<string, SurfacePlane>();
  const banked = new Uint8Array(GRID * GRID);
  for (const p of track.pieces) {
    if (p.kind !== 'banked-corner') continue;
    const def = pieceDef(p);
    if (!def) continue;
    const [w, d] = rotatedFootprint(def, p.rot);
    for (let dz = 0; dz < d; dz++)
      for (let dx = 0; dx < w; dx++) {
        const x = p.x + dx;
        const z = p.z + dz;
        if (x >= 0 && z >= 0 && x < GRID && z < GRID) banked[z * GRID + x] = 1;
      }
  }

  function planeOf(s: SurfaceSample): SurfacePlane {
    const key = `${s.plane}:${s.centerX}:${s.centerZ}:${s.baseHeight}`;
    let pl = planeCache.get(key);
    if (pl) return pl;
    const t = planes[s.plane];
    if (s.plane < 4) pl = flatPlane(s16(t.origin[1] + s.baseHeight), s.plane);
    else {
      pl = {
        id: s.plane,
        flat: false,
        roll: t.rotZ,
        pitch: t.rotX,
        origin: [s16(t.origin[0] + s.centerX), s16(t.origin[1] + s.baseHeight), s16(t.origin[2] + s.centerZ)],
        normal: [t.normal[0], t.normal[1], t.normal[2]],
        matrix: t.matrix.slice(0, 9) as Mat3i,
      };
    }
    if (planeCache.size > 4096) planeCache.clear();
    planeCache.set(key, pl);
    return pl;
  }

  const probe: TrackProbe = {
    sampler,
    mode: 1,
    probe(x: number, y: number, z: number, prev: Vec3i): SurfaceProbe {
      const s = sampler.surfaceAt(x, y, z, prev, probe.mode);
      const w = s.walls?.[0];
      return {
        surface: s.code as SurfaceProbe['surface'],
        plane: planeOf(s),
        wall: w ? { id: w.index, angle: w.angle, x: s16(w.x), z: s16(w.z), bottom: w.low, top: w.high } : null,
        elevated: !s.solid,
        tileY: s.baseHeight,
      };
    },
    bankedCorner(tileX: number, tileZ: number): boolean {
      if (tileX < 0 || tileZ < 0 || tileX >= GRID || tileZ >= GRID) return false;
      return banked[tileZ * GRID + tileX] === 1;
    },
  };
  return probe;
}
