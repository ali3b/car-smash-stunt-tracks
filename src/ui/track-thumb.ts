// A track's map from above, drawn on a canvas: the terrain (hills lighter, water blue), every road tile, the driving
// line from the centre-line walk, the start line and the ramps.
import { centreLine } from '../game/centreline';
import { footprint } from '../track/build';
import { GRID, TILE_M, type TrackFile } from '../track/types';

const GROUND: Record<TrackFile['scenery'], string> = { desert: '#6b5a3c', tropical: '#2f5a33', alpine: '#5d6a74', city: '#3c4637', country: '#33522c' };

export function drawTrackThumb(canvas: HTMLCanvasElement, t: TrackFile, accent = '#ffd23f') {
  const size = canvas.width;
  const g = canvas.getContext('2d')!;
  const cell = size / GRID;
  g.clearRect(0, 0, size, size);
  // Terrain: north is up, so tile z grows upwards.
  for (let z = 0; z < GRID; z++)
    for (let x = 0; x < GRID; x++) {
      const h = (t.heights[z]?.[x] ?? 0) + (t.heights[z + 1]?.[x + 1] ?? 0);
      const w = t.water[z]?.[x];
      g.fillStyle = w ? '#1d4f82' : GROUND[t.scenery] ?? '#33522c';
      g.fillRect(x * cell, size - (z + 1) * cell, cell + 0.5, cell + 0.5);
      if (!w && h > 0) {
        g.fillStyle = `rgba(255,255,255,${0.07 * h})`;
        g.fillRect(x * cell, size - (z + 1) * cell, cell + 0.5, cell + 0.5);
      }
    }
  // Grid lines.
  g.strokeStyle = 'rgba(255,255,255,0.05)';
  g.lineWidth = 1;
  for (let i = 0; i <= GRID; i++) {
    g.beginPath();
    g.moveTo(i * cell, 0);
    g.lineTo(i * cell, size);
    g.moveTo(0, i * cell);
    g.lineTo(size, i * cell);
    g.stroke();
  }
  // Road tiles.
  for (const p of t.pieces) {
    if (p.kind === 'scenery') {
      g.fillStyle = 'rgba(120,200,90,0.5)';
      g.beginPath();
      g.arc((p.x + 0.5) * cell, size - (p.z + 0.5) * cell, cell * 0.22, 0, Math.PI * 2);
      g.fill();
      continue;
    }
    const [w, d] = footprint(p);
    g.fillStyle = 'rgba(10,12,24,0.45)';
    g.fillRect(p.x * cell, size - (p.z + d) * cell, w * cell, d * cell);
  }
  // The driving line.
  const line = centreLine(t);
  const px = (v: [number, number, number]) => [(v[0] / TILE_M) * cell, size - (-v[2] / TILE_M) * cell] as const;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  for (const [colour, width] of [['#0b0e1c', cell * 0.62], [accent, cell * 0.34]] as const) {
    g.strokeStyle = colour;
    g.lineWidth = width;
    g.beginPath();
    line.points.forEach((p, i) => {
      const [x, y] = px(p);
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    });
    if (line.closed) g.closePath();
    g.stroke();
  }
  // Jumps.
  for (const s of line.jumps) {
    const i = line.cum.findIndex((c) => c >= s);
    if (i < 0) continue;
    const [x, y] = px(line.points[i]);
    g.fillStyle = '#ff5a1f';
    g.beginPath();
    g.arc(x, y, cell * 0.32, 0, Math.PI * 2);
    g.fill();
  }
  // The start line: a chequered square.
  if (line.points.length) {
    const [x, y] = px(line.points[0]);
    const s = cell * 0.9;
    for (let i = 0; i < 2; i++)
      for (let j = 0; j < 2; j++) {
        g.fillStyle = (i + j) % 2 ? '#111' : '#fff';
        g.fillRect(x - s / 2 + (i * s) / 2, y - s / 2 + (j * s) / 2, s / 2, s / 2);
      }
  }
  return line;
}
