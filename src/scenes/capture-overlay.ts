// Titles and graphics drawn over recorded footage (the capture scene), in the game's own style: the pixel font, the
// skewed yellow / white lettering with stacked orange and pink shadows, the cyan banner and the chequered strip of
// the title screen (src/ui/screens/title.ts), and the race HUD's speed box (src/ui/race-hud.ts).
import { PIXEL_FONT } from '../ui/pixel';
import { C } from '../ui/screens/common';

/** Something drawn over a frame. p = 0..1 through the overlay's life (for the in / out animation). */
export type Overlay =
  | { kind: 'title'; text: string; sub?: string; p: number; colour?: 'yellow' | 'white' | 'cyan'; y?: number; size?: number }
  | { kind: 'banner'; text: string; p: number; y?: number; colour?: 'cyan' | 'yellow' | 'pink' }
  | { kind: 'logo'; p: number; tagline?: string; y?: number }
  | { kind: 'caption'; kicker?: string; text: string; p: number; lines?: string[] }
  | { kind: 'tag'; text: string; p: number; colour?: 'pink' | 'cyan' | 'yellow' }
  | { kind: 'hud'; mph: number; gear: number; rpm: number }
  | { kind: 'letterbox'; amount: number }
  | { kind: 'fade'; amount: number; colour?: string }
  /** A white flash that dies away over its life (a hit, a cut on the beat). */
  | { kind: 'flash'; p: number; strength?: number }
  | { kind: 'credits'; lines: { text: string; colour?: 'yellow' | 'cyan' | 'muted' | 'text'; size?: number }[]; p: number; y?: number };

const ease = (x: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);

/** In over the first `inP`, out over the last `outP` of the life; returns 0..1 visibility and the phase. */
function life(p: number, inP = 0.12, outP = 0.1) {
  const a = ease(p / inP);
  const b = p > 1 - outP ? ease((1 - p) / outP) : 1;
  return { in: a, out: b, v: Math.min(a, b) };
}

function skewed(c: CanvasRenderingContext2D, x: number, y: number, skew: number, draw: () => void) {
  c.save();
  c.translate(x, y);
  c.transform(1, 0, Math.tan(skew), 1, 0, 0);
  draw();
  c.restore();
}

/** Text with the logo's stacked hard shadows. */
function stacked(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, fill: string, shadows: string[]) {
  c.font = `${size}px ${PIXEL_FONT}`;
  const step = Math.max(2, Math.round(size / 23));
  for (let i = shadows.length; i >= 1; i--) {
    c.fillStyle = shadows[i - 1];
    c.fillText(text, x + step * i, y + step * i);
  }
  c.fillStyle = fill;
  c.fillText(text, x, y);
}

function checker(c: CanvasRenderingContext2D, cx: number, y: number, w: number, h: number, alpha = 0.9) {
  c.save();
  c.globalAlpha *= alpha;
  const n = Math.round(w / h);
  skewed(c, cx - w / 2, y, -0.24, () => {
    for (let i = 0; i < n; i++)
      for (let j = 0; j < 2; j++) {
        c.fillStyle = (i + j) % 2 ? '#f4f1ea' : '#111';
        c.fillRect(i * (w / n), (j * h) / 2, w / n, h / 2);
      }
  });
  c.restore();
}

function banner(c: CanvasRenderingContext2D, text: string, cx: number, y: number, size: number, bg: string, fg: string, spacing = 0.35) {
  c.font = `${size}px ${PIXEL_FONT}`;
  const letters = [...text];
  const sp = size * spacing;
  const tw = letters.reduce((w, ch) => w + c.measureText(ch).width + sp, -sp);
  const padX = size * 1.2;
  const padY = size * 0.55;
  const w = tw + padX * 2;
  const h = size + padY * 2;
  skewed(c, cx - w / 2, y, -0.25, () => {
    c.fillStyle = 'rgba(0,0,0,.45)';
    c.fillRect(size * 0.3, size * 0.3, w, h);
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
  });
  c.fillStyle = fg;
  c.textBaseline = 'top';
  let x = cx - tw / 2;
  for (const ch of letters) {
    c.fillText(ch, x, y + padY + size * 0.05);
    x += c.measureText(ch).width + sp;
  }
  return { w, h };
}

const COLOURS = {
  yellow: { fill: C.yellow, shadows: [C.orange, '#b02d0a', 'rgba(0,0,0,.55)'] },
  white: { fill: '#ffffff', shadows: [C.pink, '#8e1446', 'rgba(0,0,0,.55)'] },
  cyan: { fill: C.cyan, shadows: ['#1b6f8a', '#0d3a4a', 'rgba(0,0,0,.55)'] },
};

/** Draw the overlays onto a 2D context of size w × h (scaled from a 1280 × 720 design). */
export function drawOverlays(c: CanvasRenderingContext2D, w: number, h: number, overlays: Overlay[]) {
  const s = Math.min(w / 1280, h / 720);
  for (const o of overlays) {
    c.save();
    c.textBaseline = 'alphabetic';
    c.textAlign = 'left';
    switch (o.kind) {
      case 'letterbox': {
        const bar = h * 0.11 * o.amount;
        c.fillStyle = '#000';
        c.fillRect(0, 0, w, bar);
        c.fillRect(0, h - bar, w, bar);
        break;
      }
      case 'fade':
        c.fillStyle = o.colour ?? '#000';
        c.globalAlpha = Math.max(0, Math.min(1, o.amount));
        c.fillRect(0, 0, w, h);
        break;
      case 'flash':
        c.fillStyle = '#fff';
        c.globalAlpha = Math.max(0, (1 - o.p) ** 2 * (o.strength ?? 0.8));
        c.fillRect(0, 0, w, h);
        break;
      case 'title': {
        const L = life(o.p, 0.14, 0.12);
        const size = (o.size ?? 64) * s;
        const col = COLOURS[o.colour ?? 'yellow'];
        c.font = `${size}px ${PIXEL_FONT}`;
        const tw = c.measureText(o.text).width;
        const cy = (o.y ?? 0.45) * h;
        // Slams in from the left with a scale pop, leaves to the right.
        const dx = (1 - L.in) * -w * 0.6 + (1 - L.out) * w * 0.8;
        const pop = 1 + (1 - L.in) * 0.5;
        c.globalAlpha = Math.min(1, L.v * 1.5);
        c.translate(w / 2 + dx, cy);
        c.scale(pop, pop);
        skewed(c, 0, 0, -0.18, () => stacked(c, o.text, -tw / 2, 0, size, col.fill, col.shadows));
        c.setTransform(1, 0, 0, 1, 0, 0);
        if (o.sub) {
          const L2 = life(Math.max(0, (o.p - 0.08) / 0.92), 0.14, 0.12);
          c.globalAlpha = L2.v;
          const bx = w / 2 + (1 - L2.in) * w * 0.5 - (1 - L2.out) * w * 0.8;
          banner(c, o.sub, bx, cy + size * 0.55, 22 * s, C.cyan, C.ink);
        }
        break;
      }
      case 'banner': {
        const L = life(o.p, 0.15, 0.12);
        const bg = o.colour === 'yellow' ? C.yellow : o.colour === 'pink' ? C.pink : C.cyan;
        c.globalAlpha = L.v;
        const bx = w / 2 + (1 - L.in) * -w * 0.5 + (1 - L.out) * w * 0.6;
        banner(c, o.text, bx, (o.y ?? 0.78) * h, 26 * s, bg, o.colour === 'pink' ? '#fff' : C.ink);
        break;
      }
      case 'logo': {
        const L = life(o.p, 0.18, 0.08);
        const cy = (o.y ?? 0.42) * h;
        c.globalAlpha = L.v;
        const pop = 1 + (1 - L.in) * 0.8;
        c.translate(w / 2, cy);
        c.scale(pop, pop);
        c.translate(-w / 2, -cy);
        const size = 92 * s;
        c.font = `${size}px ${PIXEL_FONT}`;
        const a = 'CAR ';
        const b = 'SMASH';
        const wa = c.measureText(a).width;
        const wb = c.measureText(b).width;
        const x0 = w / 2 - (wa + wb) / 2;
        checker(c, w / 2, cy - size - 38 * s, 280 * s, 16 * s);
        skewed(c, x0, cy, -0.18, () => {
          stacked(c, a, 0, 0, size, C.yellow, COLOURS.yellow.shadows);
          stacked(c, b, wa, 0, size, '#ffffff', COLOURS.white.shadows);
        });
        banner(c, 'STUNT TRACKS', w / 2, cy + 34 * s, 28 * s, C.cyan, C.ink, 0.36);
        if (o.tagline) {
          const L2 = life(Math.max(0, (o.p - 0.25) / 0.75), 0.2, 0.1);
          c.globalAlpha = L2.v;
          c.font = `${14 * s}px ${PIXEL_FONT}`;
          c.textAlign = 'center';
          c.fillStyle = '#000';
          c.fillText(o.tagline, w / 2 + 3 * s, cy + 150 * s + 3 * s);
          c.fillStyle = '#fff';
          c.fillText(o.tagline, w / 2, cy + 150 * s);
        }
        break;
      }
      case 'caption': {
        // A lower third: a kicker on an orange bar, then the line types itself out.
        const L = life(o.p, 0.1, 0.08);
        const x = 64 * s;
        const y = h - 150 * s;
        c.globalAlpha = L.out;
        if (o.kicker) {
          c.font = `${12 * s}px ${PIXEL_FONT}`;
          const kw = c.measureText(o.kicker).width + 28 * s;
          const kx = x - (1 - L.in) * (kw + x);
          skewed(c, kx, y - 30 * s, -0.25, () => {
            c.fillStyle = C.orange;
            c.fillRect(0, 0, kw, 26 * s);
          });
          c.fillStyle = '#fff';
          c.fillText(o.kicker, kx + 14 * s, y - 11 * s);
        }
        const lines = [o.text, ...(o.lines ?? [])];
        const total = lines.reduce((n, l) => n + l.length, 0);
        let shown = Math.floor(ease(o.p / 0.3) * total);
        let yy = y + 20 * s;
        for (const [i, ln] of lines.entries()) {
          const size = (i === 0 ? 22 : 13) * s;
          c.font = `${size}px ${PIXEL_FONT}`;
          const part = ln.slice(0, Math.max(0, shown));
          shown -= ln.length;
          const tw = c.measureText(ln).width;
          c.fillStyle = 'rgba(10,13,28,.72)';
          c.fillRect(x - 12 * s, yy - size - 10 * s, tw + 24 * s, size + 20 * s);
          c.fillStyle = '#000';
          c.fillText(part, x + 2 * s, yy + 2 * s);
          c.fillStyle = i === 0 ? '#fff' : C.cyan;
          c.fillText(part, x, yy);
          yy += size + 22 * s;
        }
        break;
      }
      case 'tag': {
        const L = life(o.p, 0.1, 0.1);
        c.globalAlpha = L.v;
        c.font = `${13 * s}px ${PIXEL_FONT}`;
        const tw = c.measureText(o.text).width;
        const bg = o.colour === 'cyan' ? C.cyan : o.colour === 'yellow' ? C.yellow : C.pink;
        skewed(c, 40 * s, 36 * s, -0.25, () => {
          c.fillStyle = 'rgba(0,0,0,.4)';
          c.fillRect(5 * s, 5 * s, tw + 32 * s, 36 * s);
          c.fillStyle = bg;
          c.fillRect(0, 0, tw + 32 * s, 36 * s);
        });
        c.fillStyle = o.colour === 'pink' || !o.colour ? '#fff' : C.ink;
        c.fillText(o.text, 56 * s, 61 * s);
        break;
      }
      case 'hud': {
        // The race HUD's speed box, bottom right.
        const bw = 260 * s;
        const bh = 112 * s;
        const x = w - 28 * s - bw;
        const y = h - 28 * s - bh;
        c.fillStyle = 'rgba(10,13,28,.72)';
        c.fillRect(x, y, bw, bh);
        c.font = `${44 * s}px ${PIXEL_FONT}`;
        c.fillStyle = '#000';
        const mph = String(Math.round(Math.abs(o.mph)));
        c.fillText(mph, x + 22 * s, y + 66 * s);
        c.fillStyle = C.text;
        c.fillText(mph, x + 20 * s, y + 64 * s);
        c.font = `${9 * s}px ${PIXEL_FONT}`;
        c.fillStyle = C.muted;
        c.fillText('MPH', x + 20 * s + c.measureText(mph).width * (44 / 9) + 10 * s, y + 64 * s);
        skewed(c, x + bw - 80 * s, y + 16 * s, -0.17, () => {
          c.fillStyle = C.cyan;
          c.fillRect(0, 0, 56 * s, 56 * s);
        });
        c.font = `${24 * s}px ${PIXEL_FONT}`;
        c.fillStyle = C.ink;
        c.textAlign = 'center';
        c.fillText(o.gear <= 0 ? 'N' : String(o.gear), x + bw - 47 * s, y + 57 * s);
        c.textAlign = 'left';
        const n = 16;
        const on = Math.round(o.rpm * n);
        for (let i = 0; i < n; i++) {
          c.fillStyle = i < on ? (i >= n - 2 ? C.orange : i >= n - 5 ? C.yellow : C.green) : 'rgba(255,255,255,.1)';
          c.fillRect(x + 20 * s + i * ((bw - 40 * s) / n), y + 84 * s, (bw - 40 * s) / n - 3 * s, 12 * s);
        }
        break;
      }
      case 'credits': {
        const L = life(o.p, 0.12, 0.12);
        c.globalAlpha = L.v;
        c.textAlign = 'center';
        let y = h * (o.y ?? 0.5) - o.lines.reduce((n, l) => n + (l.size ?? 16) * s * 2.1, 0) / 2;
        for (const l of o.lines) {
          const size = (l.size ?? 16) * s;
          y += size * 2.1;
          c.font = `${size}px ${PIXEL_FONT}`;
          c.fillStyle = '#000';
          c.fillText(l.text, w / 2 + 3 * s, y + 3 * s);
          c.fillStyle = l.colour === 'cyan' ? C.cyan : l.colour === 'muted' ? C.muted : l.colour === 'text' ? C.text : C.yellow;
          c.fillText(l.text, w / 2, y);
        }
        break;
      }
    }
    c.restore();
  }
}
