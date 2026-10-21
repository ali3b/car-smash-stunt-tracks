// The road's centre line, walked piece by piece from the start/finish line through the piece catalogue's road ends
// (src/track/pieces.ts): a polyline in world metres with its running length. The stub race session drives along it,
// the attract-mode camera and the track thumbnails use it too. Stunts (loops, rolls) are drawn flat: the stub
// doesn't fly. The real simulation (SIM lane) does not use this.
import { endFrame, pieceDef, placedEnd, type End, type Side } from '../track/pieces';
import { HILL_M, type Piece, type PieceKind, type TrackFile } from '../track/types';

export type V3 = [number, number, number];

export interface CentreLine {
  points: V3[];
  /** Running length (m) at each point. */
  cum: number[];
  length: number;
  /** The pieces in driving order. */
  pieces: Piece[];
  /** Index into `pieces` per point. */
  pieceOf: number[];
  /** Distances (m) where a ramp throws the car into the air. */
  jumps: number[];
  /** The walk came back to the start line. */
  closed: boolean;
}

const STEP: Record<Side, [number, number]> = { N: [0, 1], E: [1, 0], S: [0, -1], W: [-1, 0] };
const OPP: Record<Side, Side> = { N: 'S', S: 'N', E: 'W', W: 'E' };
const JUMP_KINDS: ReadonlySet<PieceKind> = new Set(['ramp', 'ramp-solid', 'ramp-bridge']);

function sideGroundY(t: TrackFile, x: number, z: number, side: Side): number {
  const h = (cx: number, cz: number) => (t.heights[cz]?.[cx] ?? 0) * HILL_M;
  const c = { S: [[x, z], [x + 1, z]], N: [[x, z + 1], [x + 1, z + 1]], W: [[x, z], [x, z + 1]], E: [[x + 1, z], [x + 1, z + 1]] }[side];
  return (h(c[0][0], c[0][1]) + h(c[1][0], c[1][1])) / 2;
}

type Placed = End & { x: number; z: number };

function frame(t: TrackFile, e: Placed) {
  return endFrame(e, sideGroundY(t, e.x, e.z, e.side));
}

/** Every placed road end of every piece: [piece index, path index, end index]. */
function endsIndex(t: TrackFile) {
  const map = new Map<string, [number, number, number][]>();
  t.pieces.forEach((p, pi) => {
    const def = pieceDef(p);
    def?.paths.forEach((path, ai) =>
      path.forEach((end, ei) => {
        const e = placedEnd(def, p, end);
        const k = `${e.x},${e.z},${e.side}`;
        const list = map.get(k) ?? [];
        list.push([pi, ai, ei]);
        map.set(k, list);
      }),
    );
  });
  return map;
}

function bezier(a: V3, h1: V3, h2: V3, b: V3, u: number): V3 {
  const v = 1 - u;
  const w = [v * v * v, 3 * v * v * u, 3 * v * u * u, u * u * u];
  return [0, 1, 2].map((i) => w[0] * a[i] + w[1] * h1[i] + w[2] * h2[i] + w[3] * b[i]) as V3;
}

export function centreLine(t: TrackFile): CentreLine {
  const index = endsIndex(t);
  const startIdx = Math.max(0, t.pieces.findIndex((p) => p.kind === 'start-finish'));
  const out: CentreLine = { points: [], cum: [], length: 0, pieces: [], pieceOf: [], jumps: [], closed: false };
  const start = t.pieces[startIdx];
  const startDef = start && pieceDef(start);
  if (!startDef?.paths.length) return out;
  let pi = startIdx;
  let entry = placedEnd(startDef, start, startDef.paths[0][0]);
  let exit = placedEnd(startDef, start, startDef.paths[0][1]);
  const push = (p: V3, piece: number) => {
    const last = out.points[out.points.length - 1];
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) < 0.01) return;
    out.length += last ? Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) : 0;
    out.points.push(p);
    out.cum.push(out.length);
    out.pieceOf.push(piece);
  };
  const seen = new Set<string>();
  for (let guard = 0; guard < 2000; guard++) {
    const piece = t.pieces[pi];
    // A side loop that never returns to the start line: stop rather than go round it forever.
    const visit = `${pi}:${entry.x},${entry.z},${entry.side}`;
    if (seen.has(visit)) break;
    seen.add(visit);
    const order = out.pieces.length;
    out.pieces.push(piece);
    const a = frame(t, entry);
    const b = frame(t, exit);
    const dirIn = a.inward;
    const dirOut: V3 = [-b.inward[0], 0, -b.inward[2]];
    const chord = Math.hypot(b.pos[0] - a.pos[0], b.pos[2] - a.pos[2]);
    if (JUMP_KINDS.has(piece.kind) && b.pos[1] > a.pos[1] + 1) out.jumps.push(out.length + chord);
    const straight = dirIn[0] * dirOut[0] + dirIn[2] * dirOut[2] > 0.999 && Math.abs((b.pos[0] - a.pos[0]) * dirIn[2] - (b.pos[2] - a.pos[2]) * dirIn[0]) < 0.5;
    const n = straight ? Math.max(1, Math.round(chord / 20)) : 14;
    const k = 0.39 * chord;
    const h1: V3 = [a.pos[0] + dirIn[0] * k, a.pos[1], a.pos[2] + dirIn[2] * k];
    const h2: V3 = [b.pos[0] - dirOut[0] * k, b.pos[1], b.pos[2] - dirOut[2] * k];
    for (let i = 0; i < n; i++) {
      const u = i / n;
      push(straight ? [a.pos[0] + (b.pos[0] - a.pos[0]) * u, a.pos[1] + (b.pos[1] - a.pos[1]) * u, a.pos[2] + (b.pos[2] - a.pos[2]) * u] : bezier(a.pos, h1, h2, b.pos, u), order);
    }
    // The next piece: the tile across the exit side, entered through the opposite side.
    const [sx, sz] = STEP[exit.side];
    // A ramp may fly over a gap of a tile or two to the landing ramp.
    let next: [number, number, number] | undefined;
    for (let gap = 1; gap <= 3 && !next; gap++) {
      const key = `${exit.x + sx * gap},${exit.z + sz * gap},${OPP[exit.side]}`;
      next = index.get(key)?.find(([npi]) => npi !== pi || t.pieces[npi].kind === 'crossroads');
      if (gap > 1 && next) out.jumps.push(out.length + chord);
      if (!JUMP_KINDS.has(piece.kind)) break;
    }
    if (!next) {
      push(b.pos, order);
      break;
    }
    const [npi, ai, ei] = next;
    if (npi === startIdx && ai === 0 && ei === 0) {
      push(b.pos, order);
      out.closed = true;
      break;
    }
    const np = t.pieces[npi];
    const def = pieceDef(np)!;
    pi = npi;
    entry = placedEnd(def, np, def.paths[ai][ei]);
    exit = placedEnd(def, np, def.paths[ai][1 - ei]);
  }
  return out;
}

/** Position, heading (unit, horizontal) and point index at distance s (wraps on a closed line). */
export function sampleAt(c: CentreLine, s: number): { pos: V3; dir: V3; seg: number } {
  const n = c.points.length;
  if (n < 2) return { pos: c.points[0] ?? [0, 0, 0], dir: [0, 0, -1], seg: 0 };
  if (c.closed) s = ((s % c.length) + c.length) % c.length;
  else s = Math.max(0, Math.min(c.length, s));
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (c.cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const a = c.points[lo];
  const b = c.points[hi];
  const len = c.cum[hi] - c.cum[lo] || 1;
  const u = (s - c.cum[lo]) / len;
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const dl = Math.hypot(d[0], d[2]) || 1;
  return { pos: [a[0] + d[0] * u, a[1] + d[1] * u, a[2] + d[2] * u], dir: [d[0] / dl, d[1] / dl, d[2] / dl], seg: lo };
}
