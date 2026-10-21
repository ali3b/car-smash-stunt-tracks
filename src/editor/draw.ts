// 2D drawing for the editor's top-down grid and the palette icons: terrain, water and every piece kind as a road
// ribbon following its catalogue paths (Bézier curves between its ends), with a mark for stunts.
import { pieceDef } from '../track/pieces';
import { GRID, type Piece, type PieceKind, type TrackFile } from '../track/types';
import { propMark, entryFor } from './palette';
import { SIDE_DIR, pieceSize, placedPaths, type PlacedEnd } from '../track/validate';

/** Where an end is: its tile and the side it leaves through. */
type WorldEnd = Pick<PlacedEnd, 'x' | 'z' | 'side'>;

/** Maps tile coordinates (x east, z north; fractional) to canvas pixels. */
export interface View {
  ox: number;
  oy: number;
  cell: number;
  /** Rows of tiles above z = 0 in this view (GRID for the grid; the piece's depth for an icon). */
  rows: number;
}

export const px = (v: View, x: number, z: number): [number, number] => [v.ox + x * v.cell, v.oy + (v.rows - z) * v.cell];

const SCENERY_GROUND: Record<TrackFile['scenery'], [string, string]> = {
  desert: ['#b99560', '#d9bd85'],
  tropical: ['#3f7d3a', '#6aa955'],
  alpine: ['#9fb3bd', '#e6eef2'],
  city: ['#56664a', '#7d8f68'],
  country: ['#4f7d36', '#7fae58'],
};

export const groundColour = (s: TrackFile['scenery']) => SCENERY_GROUND[s][0];

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const c = [16, 8, 0].map((sh) => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t));
  return `#${((c[0] << 16) | (c[1] << 8) | c[2]).toString(16).padStart(6, '0')}`;
}

/** Terrain: each tile as four triangles about its centre, shaded by height and lit from the north-west. */
export function drawTerrain(ctx: CanvasRenderingContext2D, v: View, t: TrackFile) {
  const [lo, hi] = SCENERY_GROUND[t.scenery];
  for (let z = 0; z < GRID; z++)
    for (let x = 0; x < GRID; x++) {
      const h = t.heights;
      const c = { sw: h[z][x], se: h[z][x + 1], nw: h[z + 1][x], ne: h[z + 1][x + 1] };
      const mid = (c.sw + c.se + c.nw + c.ne) / 4;
      const flat = c.sw === c.se && c.se === c.nw && c.nw === c.ne;
      if (flat) {
        ctx.fillStyle = mix(lo, hi, c.sw);
        const [x0, y0] = px(v, x, z + 1);
        ctx.fillRect(x0, y0, v.cell + 0.5, v.cell + 0.5);
        continue;
      }
      // Each triangle: the tile side's two corners and the centre. Light falls on north- and west-facing slopes.
      // [corner a x, z, corner b x, z, height of that side, how much higher that side is than the opposite one]
      // A slope rising to the south or east faces north-west, into the light.
      const tris: [number, number, number, number, number, number][] = [
        [x, z, x + 1, z, (c.sw + c.se) / 2, c.sw + c.se - c.nw - c.ne],
        [x + 1, z, x + 1, z + 1, (c.se + c.ne) / 2, c.se + c.ne - c.sw - c.nw],
        [x + 1, z + 1, x, z + 1, (c.ne + c.nw) / 2, c.nw + c.ne - c.sw - c.se],
        [x, z + 1, x, z, (c.nw + c.sw) / 2, c.sw + c.nw - c.se - c.ne],
      ];
      // The tile's overall tilt: positive when it rises towards the south-east (lit), negative towards the north-west.
      const tilt = c.sw + c.se - c.nw - c.ne + (c.se + c.ne - c.sw - c.nw);
      for (const [ax, az, bx, bz, hs] of tris) {
        const height = (hs + mid) / 2;
        ctx.fillStyle = mix(mix(lo, hi, height), tilt > 0 ? '#ffffff' : '#000000', tilt === 0 ? 0 : 0.14);
        ctx.beginPath();
        ctx.moveTo(...px(v, ax, az));
        ctx.lineTo(...px(v, bx, bz));
        ctx.lineTo(...px(v, x + 0.5, z + 0.5));
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
    }
  // Water and coasts.
  ctx.fillStyle = '#2f6fa8';
  for (let z = 0; z < GRID; z++)
    for (let x = 0; x < GRID; x++) {
      const w = t.water[z][x];
      if (!w) continue;
      const corner = { SW: [x, z], SE: [x + 1, z], NE: [x + 1, z + 1], NW: [x, z + 1] } as const;
      const order = ['SW', 'SE', 'NE', 'NW'] as const;
      const pts = w === true ? order : order.filter((k) => k !== w);
      ctx.beginPath();
      pts.forEach((k, i) => (i ? ctx.lineTo(...px(v, corner[k][0], corner[k][1])) : ctx.moveTo(...px(v, corner[k][0], corner[k][1]))));
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#2f6fa8';
      ctx.lineWidth = 0.6;
      ctx.stroke();
      // Ripples.
      const [cx, cy] = px(v, x + 0.5, z + 0.5);
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.moveTo(cx - v.cell * 0.2, cy);
      ctx.quadraticCurveTo(cx - v.cell * 0.1, cy - v.cell * 0.08, cx, cy);
      ctx.quadraticCurveTo(cx + v.cell * 0.1, cy + v.cell * 0.08, cx + v.cell * 0.2, cy);
      ctx.stroke();
    }
}

export function drawGridLines(ctx: CanvasRenderingContext2D, v: View) {
  for (let i = 0; i <= GRID; i++) {
    ctx.strokeStyle = i % 5 === 0 ? 'rgba(0,0,0,0.32)' : 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    const [x0, y0] = px(v, i, 0);
    const [x1, y1] = px(v, i, GRID);
    ctx.beginPath();
    ctx.moveTo(Math.round(x0) + 0.5, y0);
    ctx.lineTo(Math.round(x1) + 0.5, y1);
    const [a0, b0] = px(v, 0, i);
    const [a1, b1] = px(v, GRID, i);
    ctx.moveTo(a0, Math.round(b0) + 0.5);
    ctx.lineTo(a1, Math.round(b1) + 0.5);
    ctx.stroke();
  }
}

// ---- pieces ---------------------------------------------------------------------------------------------------

const SURFACE: Record<string, [string, string]> = {
  paved: ['#43464e', '#d8d8d8'],
  dirt: ['#8f6a40', '#c9a777'],
  ice: ['#bcdcef', '#ffffff'],
};

interface Style {
  width: number;
  fill: string;
  edge: string;
  centre?: string;
}

function style(p: Piece, level: string): Style {
  const [fill, edge] = SURFACE[p.surface ?? 'paved'];
  if (level === 'pipe') return { width: 0.46, fill: '#2d6fb5', edge: '#9cc8f2' };
  if (level === 'highway') return { width: 0.66, fill: '#3c4048', edge: '#d8d8d8', centre: '#e8c14a' };
  if (level === 'elevated') return { width: 0.42, fill: '#5d6f94', edge: '#f0f3f8' };
  if (level.startsWith('bank')) return { width: 0.42, fill, edge: '#e04848' };
  return { width: 0.4, fill, edge, centre: p.surface ? undefined : 'rgba(255,255,255,0.55)' };
}

const MARK_COLOUR: Partial<Record<PieceKind, string>> = {
  loop: '#e53935',
  'corkscrew-roll': '#9c3ad0',
  'corkscrew-helix': '#9c3ad0',
  tunnel: '#7a5236',
  slalom: '#f2b705',
  'pipe-obstacle': '#f2b705',
};

const PROP_COLOUR: Record<string, string> = {
  tree: '#2e6b2a',
  palm: '#3a8a2c',
  cactus: '#5f8f3a',
  barn: '#a33b2b',
  windmill: '#d8d2c4',
  office: '#7a8aa0',
  'gas-station': '#d84b2a',
  diner: '#e0a020',
  'tennis-court': '#3f8f6a',
  boat: '#f0f0f0',
};

/** The point at the middle of an end's tile side and the direction into the piece, in tile units. */
function endPoint(e: WorldEnd): { p: [number, number]; d: [number, number] } {
  const [sx, sz] = SIDE_DIR[e.side];
  return { p: [e.x + 0.5 + sx * 0.5, e.z + 0.5 + sz * 0.5], d: [-sx, -sz] };
}

/** The road's centre line from one end to the other as a cubic Bézier in tile units. */
export function pathCurve(a: WorldEnd, b: WorldEnd): [number, number][] {
  const A = endPoint(a);
  const B = endPoint(b);
  const dist = Math.hypot(A.p[0] - B.p[0], A.p[1] - B.p[1]);
  const perpendicular = A.d[0] * B.d[0] + A.d[1] * B.d[1] === 0;
  const k = perpendicular ? (0.5523 * dist) / Math.SQRT2 : dist * 0.42;
  return [A.p, [A.p[0] + A.d[0] * k, A.p[1] + A.d[1] * k], [B.p[0] + B.d[0] * k, B.p[1] + B.d[1] * k], B.p];
}

/** A point and tangent along a Bézier, t in 0..1. */
export function bezierAt(c: [number, number][], t: number): { p: [number, number]; d: [number, number] } {
  const u = 1 - t;
  const p: [number, number] = [0, 1].map((i) => u * u * u * c[0][i] + 3 * u * u * t * c[1][i] + 3 * u * t * t * c[2][i] + t * t * t * c[3][i]) as [number, number];
  const d: [number, number] = [0, 1].map((i) => 3 * u * u * (c[1][i] - c[0][i]) + 6 * u * t * (c[2][i] - c[1][i]) + 3 * t * t * (c[3][i] - c[2][i])) as [number, number];
  const n = Math.hypot(d[0], d[1]) || 1;
  return { p, d: [d[0] / n, d[1] / n] };
}

function strokeCurve(ctx: CanvasRenderingContext2D, v: View, c: [number, number][], width: number, colour: string, dash?: number[]) {
  ctx.beginPath();
  ctx.moveTo(...px(v, ...c[0]));
  ctx.bezierCurveTo(...px(v, ...c[1]), ...px(v, ...c[2]), ...px(v, ...c[3]));
  ctx.strokeStyle = colour;
  ctx.lineWidth = width * v.cell;
  ctx.setLineDash(dash ? dash.map((d) => d * v.cell) : []);
  ctx.stroke();
  ctx.setLineDash([]);
}

function badge(ctx: CanvasRenderingContext2D, v: View, x: number, z: number, text: string, bg: string, r = 0.24) {
  const [cx, cy] = px(v, x, z);
  // Badges stop growing when the grid is zoomed in.
  r = Math.min(r, 16 / v.cell);
  ctx.beginPath();
  ctx.arc(cx, cy, r * v.cell, 0, Math.PI * 2);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.lineWidth = Math.max(1, v.cell * 0.04);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.stroke();
  ctx.fillStyle = bg === '#f0f0f0' || bg === '#d8d2c4' || bg === '#f2b705' ? '#1a1a1a' : '#ffffff';
  ctx.font = `bold ${Math.round(r * v.cell * 1.15)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy + r * v.cell * 0.06);
}

/** Draw one placed piece. */
export function drawPiece(ctx: CanvasRenderingContext2D, v: View, p: Piece) {
  const [w, d] = pieceSize(p);
  if (p.kind === 'scenery') {
    badge(ctx, v, p.x + 0.5, p.z + 0.5, propMark(p.variant), PROP_COLOUR[p.variant ?? ''] ?? '#6a6a6a', 0.3);
    return;
  }
  const paths = placedPaths(p);
  if (!pieceDef(p)) {
    const [x0, y0] = px(v, p.x, p.z + d);
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(x0 + 2, y0 + 2, w * v.cell - 4, d * v.cell - 4);
    return;
  }
  const curves = paths.map(([a, b]) => ({ c: pathCurve(a, b), a, b }));
  // Shadows of raised decks first.
  for (const { c, a, b } of curves) {
    if (a.level !== 'elevated' && b.level !== 'elevated') continue;
    const off = a.level === b.level ? 0.16 : 0.08;
    const sh = c.map(([x, z]) => [x + off, z - off] as [number, number]);
    strokeCurve(ctx, v, sh, 0.44, 'rgba(0,0,0,0.35)');
  }
  for (const { c, a, b } of curves) {
    const level = a.level === 'ground' ? b.level : a.level;
    const s = style(p, level === 'ground' && b.level !== 'ground' ? b.level : level);
    strokeCurve(ctx, v, c, s.width + 0.08, s.edge);
    strokeCurve(ctx, v, c, s.width, s.fill);
    if (s.centre) strokeCurve(ctx, v, c, 0.03, s.centre, [0.1, 0.1]);
    // Level changes (ramps, entries): chevrons pointing to the higher / special end.
    if (a.level !== b.level) {
      const up = a.level === 'ground';
      for (const t of [0.3, 0.55, 0.8]) {
        const { p: q, d: dir } = bezierAt(c, up ? t : 1 - t);
        const sgn = up ? 1 : -1;
        const tip = [q[0] + dir[0] * 0.09 * sgn, q[1] + dir[1] * 0.09 * sgn];
        const n = [-dir[1], dir[0]];
        ctx.beginPath();
        ctx.moveTo(...px(v, q[0] - dir[0] * 0.05 * sgn + n[0] * 0.12, q[1] - dir[1] * 0.05 * sgn + n[1] * 0.12));
        ctx.lineTo(...px(v, tip[0], tip[1]));
        ctx.lineTo(...px(v, q[0] - dir[0] * 0.05 * sgn - n[0] * 0.12, q[1] - dir[1] * 0.05 * sgn - n[1] * 0.12));
        ctx.strokeStyle = 'rgba(255,214,64,0.9)';
        ctx.lineWidth = Math.max(1, v.cell * 0.045);
        ctx.stroke();
      }
    }
  }
  const [cx, cz] = [p.x + w / 2, p.z + d / 2];
  if (p.kind === 'start-finish') {
    // Chequered band across the road.
    const { c } = curves[0];
    const { p: q, d: dir } = bezierAt(c, 0.5);
    const n = [-dir[1], dir[0]];
    const cells = 6;
    for (let i = 0; i < cells; i++)
      for (let j = 0; j < 2; j++) {
        const s0 = -0.2 + (0.4 * i) / cells;
        const t0 = -0.07 + 0.07 * j;
        const corner = (s: number, t: number) => px(v, q[0] + n[0] * s + dir[0] * t, q[1] + n[1] * s + dir[1] * t);
        ctx.beginPath();
        ctx.moveTo(...corner(s0, t0));
        ctx.lineTo(...corner(s0 + 0.4 / cells, t0));
        ctx.lineTo(...corner(s0 + 0.4 / cells, t0 + 0.07));
        ctx.lineTo(...corner(s0, t0 + 0.07));
        ctx.closePath();
        ctx.fillStyle = (i + j) % 2 ? '#111' : '#fff';
        ctx.fill();
      }
  }
  if (p.kind === 'loop' || p.kind === 'corkscrew-helix') {
    const [x0, y0] = px(v, cx, cz);
    ctx.beginPath();
    ctx.ellipse(x0, y0, w * v.cell * 0.36, d * v.cell * 0.36, 0, 0, Math.PI * 2);
    ctx.strokeStyle = MARK_COLOUR[p.kind]!;
    ctx.lineWidth = Math.max(2, v.cell * 0.09);
    ctx.stroke();
  }
  if (p.kind === 'tunnel') {
    const { c } = curves[0];
    strokeCurve(ctx, v, [bezierAt(c, 0.25).p, bezierAt(c, 0.4).p, bezierAt(c, 0.6).p, bezierAt(c, 0.75).p], 0.62, '#6b4a30');
  }
  if (p.kind === 'slalom' || p.kind === 'pipe-obstacle') {
    const { c } = curves[0];
    for (const [i, t] of [0.25, 0.5, 0.75].entries()) {
      const { p: q, d: dir } = bezierAt(c, t);
      const side = i % 2 ? 0.09 : -0.09;
      const [x0, y0] = px(v, q[0] - dir[1] * side, q[1] + dir[0] * side);
      ctx.beginPath();
      ctx.arc(x0, y0, v.cell * 0.05, 0, Math.PI * 2);
      ctx.fillStyle = p.kind === 'slalom' ? '#ff8a1e' : '#f2b705';
      ctx.fill();
    }
  }
  const mark = entryFor(p.kind, p.variant)?.mark;
  if (mark && p.kind !== 'tunnel' && p.kind !== 'slalom') badge(ctx, v, cx, cz, mark, MARK_COLOUR[p.kind] ?? '#333', Math.min(0.26, 0.2 * Math.min(w, d) + 0.06));
}

/** A whole piece kind drawn into a small square canvas (palette icons), centred, at rot 0. */
export function drawIcon(canvas: HTMLCanvasElement, p: Piece, scenery: TrackFile['scenery']) {
  const ctx = canvas.getContext('2d')!;
  const size = canvas.width;
  const [w, d] = pieceSize(p);
  const n = Math.max(w, d);
  const cell = size / (n + 0.25);
  const v: View = { ox: (size - w * cell) / 2, oy: (size - d * cell) / 2, cell, rows: d };
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = SCENERY_GROUND[scenery][0];
  ctx.globalAlpha = 0.55;
  ctx.fillRect(v.ox, v.oy, w * cell, d * cell);
  ctx.globalAlpha = 1;
  drawPiece(ctx, v, { ...p, x: 0, z: 0 });
}
