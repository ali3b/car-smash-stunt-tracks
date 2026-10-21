// The editor's top-down grid: draws the track, the traced circuit, issues, the selection and the brush ghost, and
// turns mouse input into edits on the EditorDoc. Left button uses the current tool (drag paints for 1×1 pieces and
// terrain); right button erases; Shift places over whatever is in the way; Alt-click picks a piece into the brush.
import { GRID, type Piece, type TrackFile } from '../track/types';
import type { EditorDoc, WaterValue } from './doc';
import { getAudio } from '../audio';

/** Editor feedback sounds, at most one per 45 ms (a drag paints many tiles). */
let lastSound = 0;
function sound(kind: 'place' | 'erase' | 'click' | 'back') {
  const now = performance.now();
  if (now - lastSound < 45) return;
  lastSound = now;
  getAudio().emit('ui', { kind });
}
import { drawGridLines, drawPiece, drawTerrain, bezierAt, pathCurve, px, type View } from './draw';
import { footprintTiles, pieceSize, type Report } from '../track/validate';

export type Tool = 'select' | 'place' | 'erase' | 'hill' | 'dig' | 'corner-up' | 'corner-down' | 'water' | 'coast' | 'dry';

export const TERRAIN_TOOLS: ReadonlySet<Tool> = new Set(['hill', 'dig', 'corner-up', 'corner-down', 'water', 'coast', 'dry']);

export interface GridHost {
  doc: EditorDoc;
  tool: Tool;
  /** The piece the place tool puts down (anchor ignored). */
  brush(): Piece | null;
  selected: number;
  report: Report;
  select(i: number): void;
  status(text: string, tone?: 'info' | 'error' | 'ok'): void;
  /** Alt-click: copy a placed piece into the brush. */
  pick(p: Piece): void;
}

interface Hover {
  fx: number;
  fz: number;
  x: number;
  z: number;
  /** Nearest grid corner. */
  cx: number;
  cz: number;
}

const MARGIN = 22;

export class GridView {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private view: View = { ox: 0, oy: 0, cell: 20, rows: GRID };
  private hover: Hover | null = null;
  private drag: { button: number; lastKey: string; move?: { index: number; gx: number; gz: number; x: number; z: number } } | null = null;
  private raf = 0;
  /** Called with the hovered tile (or null) for the status bar. */
  onHover: (h: { x: number; z: number; cx: number; cz: number } | null) => void = () => {};

  constructor(private host: HTMLElement, private state: GridHost) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'ed-grid-canvas';
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(host);
    this.canvas.addEventListener('pointermove', (e) => (e.pointerType === 'touch' ? this.touchMove(e) : this.onMove(e)));
    this.canvas.addEventListener('pointerdown', (e) => (e.pointerType === 'touch' ? this.touchDown(e) : this.onDown(e)));
    addEventListener('pointerup', (e) => (e.pointerType === 'touch' ? this.touchUp(e) : this.onUp(e)));
    addEventListener('pointercancel', (e) => e.pointerType === 'touch' && this.touchUp(e));
    this.canvas.addEventListener('pointerleave', () => {
      this.hover = null;
      this.onHover(null);
      this.redraw();
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.resize();
  }

  /** The canvas pixel (CSS px, relative to the canvas) at the middle of a tile: for tests and tools. */
  tileCentre(x: number, z: number): [number, number] {
    return px(this.view, x + 0.5, z + 0.5);
  }

  private resize() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const dpr = Math.min(devicePixelRatio, 2);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.layout();
  }

  /** Zoom (1 = the whole grid fits) and pan (CSS px) of the view; the wheel zooms about the cursor, the middle
   * button (or Space + drag) pans, Home fits the grid again. */
  private zoom = 1;
  private pan = { x: 0, y: 0 };

  private layout() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const fit = Math.max(6, Math.floor((Math.min(w, h) - MARGIN * 2) / GRID));
    const cell = this.zoom === 1 ? fit : fit * this.zoom;
    this.view = {
      cell,
      rows: GRID,
      ox: Math.round((w - cell * GRID) / 2 + MARGIN * 0.4 + this.pan.x),
      oy: Math.round((h - cell * GRID) / 2 - MARGIN * 0.4 + this.pan.y),
    };
    this.draw();
  }

  /** Back to the whole grid. */
  fit() {
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.layout();
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    this.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
  }

  /** Zoom by `factor` keeping the tile point under (mx, my) (canvas CSS px) where it is. */
  private zoomAt(mx: number, my: number, factor: number) {
    const fx = (mx - this.view.ox) / this.view.cell;
    const fy = (my - this.view.oy) / this.view.cell;
    const zoom = Math.min(4, Math.max(1, this.zoom * factor));
    if (zoom === this.zoom) return;
    this.zoom = zoom;
    if (zoom === 1) this.pan = { x: 0, y: 0 };
    this.layout();
    this.pan.x += mx - (this.view.ox + fx * this.view.cell);
    this.pan.y += my - (this.view.oy + fy * this.view.cell);
    this.layout();
  }

  private panning: { x: number; y: number } | null = null;
  /** Space held: left drag pans. */
  spaceHeld = false;

  redraw() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  // ---- touch: one finger works like the left mouse button (tap to place, drag to paint), two fingers pan and
  // pinch-zoom. A finger's action waits a moment (or until it moves) so that a second finger can still turn it
  // into a gesture; after a gesture nothing happens until every finger is lifted.
  private touches = new Map<number, { x: number; y: number }>();
  private pending: { e: PointerEvent; timer: number } | null = null;
  private gesture: { dist: number; mid: { x: number; y: number } } | null = null;
  private gestureLock = false;

  private flushPending() {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    clearTimeout(p.timer);
    this.onDown(p.e);
  }

  private twoFingers() {
    const [a, b] = [...this.touches.values()];
    const r = this.canvas.getBoundingClientRect();
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top } };
  }

  private touchDown(e: PointerEvent) {
    e.preventDefault();
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.touches.size >= 2) {
      // A second finger: a gesture, not an edit (a first finger that already started editing ends its stroke).
      if (this.pending) {
        clearTimeout(this.pending.timer);
        this.pending = null;
      } else if (this.drag) this.onUp(e);
      this.gesture = this.twoFingers();
      this.gestureLock = true;
      return;
    }
    if (this.gestureLock) return;
    this.pending = { e, timer: window.setTimeout(() => this.flushPending(), 110) };
  }

  private touchMove(e: PointerEvent) {
    if (!this.touches.has(e.pointerId)) return;
    const start = this.touches.get(e.pointerId)!;
    if (this.gesture && this.touches.size >= 2) {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = this.twoFingers();
      this.pan.x += g.mid.x - this.gesture.mid.x;
      this.pan.y += g.mid.y - this.gesture.mid.y;
      if (this.zoom === 1) this.zoom = 1.0001;
      this.layout();
      if (this.gesture.dist > 0) this.zoomAt(g.mid.x, g.mid.y, g.dist / this.gesture.dist);
      this.gesture = g;
      return;
    }
    if (this.gestureLock) return;
    if (this.pending && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) this.flushPending();
    if (!this.pending) this.onMove(e);
  }

  private touchUp(e: PointerEvent) {
    if (!this.touches.delete(e.pointerId)) return;
    if (this.touches.size < 2) this.gesture = null;
    if (this.touches.size === 0) {
      if (this.gestureLock) {
        this.gestureLock = false;
        return;
      }
      this.flushPending();
      this.onUp(e);
    }
  }

  // ---- input ----

  private hoverAt(e: PointerEvent): Hover {
    const r = this.canvas.getBoundingClientRect();
    const fx = (e.clientX - r.left - this.view.ox) / this.view.cell;
    const fz = GRID - (e.clientY - r.top - this.view.oy) / this.view.cell;
    return { fx, fz, x: Math.floor(fx), z: Math.floor(fz), cx: Math.round(fx), cz: Math.round(fz) };
  }

  private onMove(e: PointerEvent) {
    if (this.panning) {
      this.pan.x += e.clientX - this.panning.x;
      this.pan.y += e.clientY - this.panning.y;
      this.panning = { x: e.clientX, y: e.clientY };
      if (this.zoom === 1) this.zoom = 1.0001; // a panned view is no longer "fit"
      this.layout();
      return;
    }
    const h = this.hoverAt(e);
    const changed = !this.hover || h.x !== this.hover.x || h.z !== this.hover.z || h.cx !== this.hover.cx || h.cz !== this.hover.cz;
    this.hover = h;
    if (changed) {
      const inside = h.fx >= 0 && h.fz >= 0 && h.fx < GRID && h.fz < GRID;
      this.onHover(inside ? h : null);
      if (this.drag) this.dragTo(h);
      this.redraw();
    }
  }

  private onDown(e: PointerEvent) {
    const h = this.hoverAt(e);
    this.hover = h;
    const s = this.state;
    if (e.button === 1 || (e.button === 0 && this.spaceHeld)) {
      this.panning = { x: e.clientX, y: e.clientY };
      e.preventDefault();
      return;
    }
    const i = s.doc.pieceAt(h.x, h.z);
    if (e.button === 0 && e.altKey) {
      if (i >= 0) s.pick(s.doc.track.pieces[i]);
      return;
    }
    if (e.button === 2) {
      // Right button: erase pieces (drag to keep erasing).
      this.drag = { button: 2, lastKey: '' };
      s.doc.beginBatch();
      this.dragTo(h);
      return;
    }
    if (s.tool === 'select') {
      if (i < 0) {
        s.select(-1);
        return;
      }
      s.select(i);
      const p = s.doc.track.pieces[i];
      this.drag = { button: 0, lastKey: '', move: { index: i, gx: h.x - p.x, gz: h.z - p.z, x: p.x, z: p.z } };
      return;
    }
    this.drag = { button: 0, lastKey: '' };
    this.shift = e.shiftKey;
    this.placedThisDrag = false;
    s.doc.beginBatch();
    this.dragTo(h);
  }

  private shift = false;

  private onUp(_e: PointerEvent) {
    this.panning = null;
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.move) {
      const p = this.state.doc.track.pieces[d.move.index];
      if (p && (p.x !== d.move.x || p.z !== d.move.z)) {
        const r = this.state.doc.update(d.move.index, { x: d.move.x, z: d.move.z });
        if (!r.ok) this.state.status(`Can’t move there: ${r.reason}.`, 'error');
        else this.state.status(`Moved the ${p.kind} to ${d.move.x},${d.move.z}.`);
      }
    } else this.state.doc.endBatch();
    this.redraw();
  }

  /** Apply the current tool at a tile while the button is held (once per tile, or per corner for corner tools). */
  private dragTo(h: Hover) {
    const d = this.drag!;
    const s = this.state;
    const doc = s.doc;
    if (d.move) {
      d.move.x = h.x - d.move.gx;
      d.move.z = h.z - d.move.gz;
      return;
    }
    const corner = s.tool === 'corner-up' || s.tool === 'corner-down';
    const quadrant = s.tool === 'coast' ? coastCorner(h) : '';
    const key = corner ? `${h.cx},${h.cz}` : `${h.x},${h.z},${quadrant}`;
    if (key === d.lastKey) return;
    d.lastKey = key;
    if (d.button === 2 || s.tool === 'erase') {
      const i = doc.pieceAt(h.x, h.z);
      if (i >= 0) {
        const p = doc.track.pieces[i];
        doc.remove(i);
        sound('erase');
        if (s.selected === i) s.select(-1);
        s.status(`Removed the ${p.kind} at ${p.x},${p.z}.`);
      }
      return;
    }
    let r: { ok: boolean; reason?: string } = { ok: true };
    switch (s.tool) {
      case 'place': {
        const b = s.brush();
        if (!b) return;
        const [w, dd] = pieceSize(b);
        // Multi-tile pieces are placed once per press; 1×1 pieces paint along the drag.
        if ((w > 1 || dd > 1) && this.placedThisDrag) return;
        const res = doc.place({ ...b, x: h.x, z: h.z }, this.shift);
        if (res.ok) {
          sound('place');
          this.placedThisDrag = w > 1 || dd > 1;
          s.select(-1);
          s.status(`Placed ${b.kind}${b.variant ? ` (${b.variant})` : ''} at ${h.x},${h.z}.`, 'ok');
        } else {
          sound('back');
          s.status(`Can’t place here: ${res.reason}${res.reason === 'occupied' ? ' (hold Shift to replace, right-click to erase)' : ''}.`, 'error');
        }
        return;
      }
      case 'hill':
        r = doc.setTile(h.x, h.z, 1);
        break;
      case 'dig':
        r = doc.setTile(h.x, h.z, 0);
        break;
      case 'corner-up':
        r = doc.setCorner(h.cx, h.cz, 1);
        break;
      case 'corner-down':
        r = doc.setCorner(h.cx, h.cz, 0);
        break;
      case 'water':
        r = doc.setWater(h.x, h.z, true);
        break;
      case 'coast':
        r = doc.setWater(h.x, h.z, quadrant as WaterValue);
        break;
      case 'dry':
        r = doc.setWater(h.x, h.z, false);
        break;
    }
    if (r.ok) sound('click');
    if (!r.ok) s.status(`${r.reason![0].toUpperCase()}${r.reason!.slice(1)}.`, 'error');
  }
  /** A multi-tile piece went down during this press (they are placed once per press). */
  private placedThisDrag = false;

  // ---- drawing ----

  draw() {
    const { ctx, view: v, state: s } = this;
    const t = s.doc.track;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    // Frame and coordinates.
    ctx.fillStyle = '#0b0f15';
    ctx.fillRect(v.ox - 4, v.oy - 4, v.cell * GRID + 8, v.cell * GRID + 8);
    ctx.fillStyle = '#7d8aa0';
    ctx.font = '10px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i < GRID; i += 5) {
      const [lx, ly] = px(v, i + 0.5, 0);
      ctx.fillText(String(i), lx, ly + 8);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const [zx, zy] = px(v, 0, i + 0.5);
      ctx.fillText(String(i), zx - 8, zy);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const [nx, ny] = px(v, 0, GRID - 0.5);
    ctx.fillStyle = '#ffd23f';
    ctx.fillText('N', nx - 8, ny);

    drawTerrain(ctx, v, t);
    drawGridLines(ctx, v);
    if (TERRAIN_TOOLS.has(s.tool)) this.drawCorners(t);

    const moving = this.drag?.move;
    t.pieces.forEach((p, i) => {
      if (moving && moving.index === i) return;
      drawPiece(ctx, v, p);
    });
    this.drawRoute();
    this.drawIssues();

    // Selection.
    const sel = t.pieces[s.selected];
    if (sel && !moving) this.outline(sel, '#ffd23f', true);

    // Ghosts: a piece being moved, or the brush under the cursor.
    const hv = this.hover;
    if (moving) {
      const p = { ...t.pieces[moving.index], x: moving.x, z: moving.z };
      this.ghost(p, s.doc.canPlace(p, [moving.index]).ok);
    } else if (hv && s.tool === 'place' && !this.drag) {
      const b = s.brush();
      if (b) {
        const p = { ...b, x: hv.x, z: hv.z };
        const c = s.doc.canPlace(p);
        this.ghost(p, c.ok || (c.reason === 'occupied' && this.shiftHeld));
      }
    } else if (hv && inside(hv)) {
      if (s.tool === 'corner-up' || s.tool === 'corner-down') {
        const [cx, cy] = px(v, hv.cx, hv.cz);
        ctx.beginPath();
        ctx.arc(cx, cy, v.cell * 0.28, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (s.tool === 'coast') {
        const dry = coastCorner(hv);
        const corner = { SW: [hv.x, hv.z], SE: [hv.x + 1, hv.z], NE: [hv.x + 1, hv.z + 1], NW: [hv.x, hv.z + 1] } as const;
        ctx.beginPath();
        (['SW', 'SE', 'NE', 'NW'] as const).filter((k) => k !== dry).forEach((k, i) => (i ? ctx.lineTo(...px(v, corner[k][0], corner[k][1])) : ctx.moveTo(...px(v, corner[k][0], corner[k][1]))));
        ctx.closePath();
        ctx.fillStyle = 'rgba(80,160,240,0.55)';
        ctx.fill();
        this.tileOutline(hv.x, hv.z, '#ffffff');
      } else if (s.tool !== 'select' || s.doc.pieceAt(hv.x, hv.z) < 0) this.tileOutline(hv.x, hv.z, s.tool === 'erase' ? '#ff6b6b' : '#ffffff');
      else {
        const i = s.doc.pieceAt(hv.x, hv.z);
        if (i !== s.selected) this.outline(t.pieces[i], 'rgba(255,255,255,0.8)', false);
      }
    }
  }

  /** Shift held right now (the ghost shows "replace" as allowed). */
  shiftHeld = false;

  private drawCorners(t: TrackFile) {
    const { ctx, view: v } = this;
    for (let z = 0; z <= GRID; z++)
      for (let x = 0; x <= GRID; x++) {
        if (!t.heights[z][x]) continue;
        const [cx, cy] = px(v, x, z);
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fillRect(cx - 1.5, cy - 1.5, 3, 3);
      }
  }

  private drawRoute() {
    const { ctx, view: v } = this;
    const { circuit } = this.state.report;
    const closed = circuit.status === 'closed';
    const colour = closed ? '#3fe08a' : '#ffb02e';
    for (const [n, step] of circuit.route.entries()) {
      const c = pathCurve(step.from, step.to);
      const { p, d } = bezierAt(c, 0.5);
      const nrm = [-d[1], d[0]];
      const a = 0.11;
      ctx.beginPath();
      ctx.moveTo(...px(v, p[0] + d[0] * a, p[1] + d[1] * a));
      ctx.lineTo(...px(v, p[0] - d[0] * a + nrm[0] * a, p[1] - d[1] * a + nrm[1] * a));
      ctx.lineTo(...px(v, p[0] - d[0] * a - nrm[0] * a, p[1] - d[1] * a - nrm[1] * a));
      ctx.closePath();
      ctx.fillStyle = n === 0 ? '#ffffff' : colour;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // Jumps: a dashed arc from take-off to landing.
    for (const j of circuit.jumps) {
      const [x0, y0] = px(v, j.from.x + 0.5, j.from.z + 0.5);
      const [x1, y1] = px(v, j.to.x + 0.5, j.to.z + 0.5);
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      const len = Math.hypot(x1 - x0, y1 - y0);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(mx - ((y1 - y0) / len) * len * 0.25, my + ((x1 - x0) / len) * len * 0.25, x1, y1);
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private drawIssues() {
    const { ctx, view: v } = this;
    for (const issue of this.state.report.issues) {
      if (!issue.at) continue;
      const p = issue.piece !== undefined ? this.state.doc.track.pieces[issue.piece] : undefined;
      const [w, d] = p ? pieceSize(p) : [1, 1];
      const x = p ? p.x : issue.at.x;
      const z = p ? p.z : issue.at.z;
      const [x0, y0] = px(v, x, z + d);
      const err = issue.severity === 'error';
      ctx.strokeStyle = err ? '#ff3b3b' : '#ffb02e';
      ctx.lineWidth = 2.5;
      ctx.setLineDash(err ? [] : [4, 3]);
      ctx.strokeRect(x0 + 1.5, y0 + 1.5, w * v.cell - 3, d * v.cell - 3);
      ctx.setLineDash([]);
      if (err) {
        const [bx, by] = [x0 + w * v.cell - 2, y0 + 2];
        ctx.beginPath();
        ctx.arc(bx, by, Math.max(6, v.cell * 0.22), 0, Math.PI * 2);
        ctx.fillStyle = '#ff3b3b';
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${Math.max(9, Math.round(v.cell * 0.32))}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('!', bx, by + 0.5);
      }
    }
  }

  private tileOutline(x: number, z: number, colour: string) {
    const [x0, y0] = px(this.view, x, z + 1);
    this.ctx.strokeStyle = colour;
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(x0 + 1, y0 + 1, this.view.cell - 2, this.view.cell - 2);
  }

  private outline(p: Piece, colour: string, dashed: boolean) {
    const [w, d] = pieceSize(p);
    const [x0, y0] = px(this.view, p.x, p.z + d);
    this.ctx.strokeStyle = colour;
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash(dashed ? [6, 3] : []);
    this.ctx.strokeRect(x0 + 1, y0 + 1, w * this.view.cell - 2, d * this.view.cell - 2);
    this.ctx.setLineDash([]);
  }

  private ghost(p: Piece, ok: boolean) {
    const { ctx, view: v } = this;
    for (const c of footprintTiles(p)) {
      if (c.x < 0 || c.z < 0 || c.x >= GRID || c.z >= GRID) continue;
      const [x0, y0] = px(v, c.x, c.z + 1);
      ctx.fillStyle = ok ? 'rgba(63,224,138,0.28)' : 'rgba(255,59,59,0.35)';
      ctx.fillRect(x0, y0, v.cell, v.cell);
    }
    ctx.globalAlpha = 0.75;
    drawPiece(ctx, v, p);
    ctx.globalAlpha = 1;
    this.outline(p, ok ? '#3fe08a' : '#ff3b3b', false);
  }
}

const inside = (h: Hover) => h.x >= 0 && h.z >= 0 && h.x < GRID && h.z < GRID;

/** The coast tool fills the half of the tile under the cursor with water; the dry corner is the opposite one. */
function coastCorner(h: Hover): 'NE' | 'SE' | 'SW' | 'NW' {
  const north = h.fz - h.z >= 0.5;
  const east = h.fx - h.x >= 0.5;
  // Water towards the cursor's quadrant, so the dry corner is diagonally opposite.
  return north ? (east ? 'SW' : 'SE') : east ? 'NW' : 'NE';
}

