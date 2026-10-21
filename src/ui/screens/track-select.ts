// Track select: the bundled tracks in a list, the focused track's map, its length and stunts, and its best times.
import { addStyle, esc, fmtTime } from '../pixel';
import type { MenuEvent } from '../../engine/input';
import { C, header, keys, onTap, screenEl, type Screen } from './common';
import { drawTrackThumb } from '../track-thumb';
import type { TrackEntry } from '../../track/tracks';
import type { ScoreEntry } from '../../game/storage';
import type { PieceKind } from '../../track/types';

const CSS = `
.cs-tracks .list { position: absolute; left: 48px; top: 108px; width: 380px; bottom: 80px; overflow: hidden; }
.cs-tracks .list .cs-menu .it { font-size: 11px; padding: 13px 18px; }
.cs-tracks .list .cs-menu .it .val { font-size: 8px; }
.cs-tracks .list .more { height: 14px; font-size: 8px; color: ${C.muted}; text-align: center; letter-spacing: 2px; margin: 4px 0; visibility: hidden; }
.cs-tracks .list .more.on { visibility: visible; }
.cs-tracks .map { position: absolute; left: 460px; top: 130px; padding: 16px; }
.cs-tracks .map canvas { display: block; width: 420px; height: 420px; image-rendering: pixelated; }
.cs-tracks .side { position: absolute; right: 48px; top: 130px; width: 300px; padding: 22px; }
.cs-tracks .side h2 { margin: 0 0 18px; font-size: 14px; line-height: 1.5; font-weight: normal; color: ${C.yellow}; }
.cs-tracks .side .kv { display: flex; justify-content: space-between; font-size: 9px; color: ${C.muted}; margin: 10px 0; }
.cs-tracks .side .kv b { font-weight: normal; color: ${C.text}; }
.cs-tracks .side .best { margin-top: 22px; border-top: 2px solid ${C.line}; padding-top: 16px; }
.cs-tracks .side .best div { display: flex; gap: 10px; font-size: 9px; margin: 9px 0; }
.cs-tracks .side .best div i { font-style: normal; color: ${C.orange}; width: 16px; }
.cs-tracks .side .best div span { flex: 1; }
.cs-tracks .side .best div b { font-weight: normal; color: ${C.yellow}; }
.cs-tracks .tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; }
.cs-tracks .tags span { font-size: 7px; padding: 6px 8px; background: rgba(53,214,255,.14); color: ${C.cyan}; }
@media (max-width: 1280px) { .cs-tracks .map canvas { width: 330px; height: 330px; } .cs-tracks .side { width: 250px; } .cs-tracks .list { width: 340px; } .cs-tracks .map { left: 410px; } }
@media (max-width: 980px), (max-height: 620px) { .cs-tracks .list { top: 70px; left: 14px; width: 260px; } .cs-tracks .map { top: 70px; left: 290px; }
  .cs-tracks .map canvas { width: 240px; height: 240px; } .cs-tracks .side { display: none; } }
`;

const STUNTS: [string, PieceKind[]][] = [
  ['LOOP', ['loop']],
  ['CORKSCREW', ['corkscrew-roll', 'corkscrew-helix']],
  ['JUMP', ['ramp', 'ramp-solid', 'ramp-bridge']],
  ['PIPE', ['pipe', 'pipe-entry', 'pipe-obstacle']],
  ['BANKED', ['banked', 'banked-corner']],
  ['BRIDGE', ['elevated', 'elevated-span', 'elevated-corner', 'elevated-solid', 'elevated-span-over-road']],
  ['TUNNEL', ['tunnel']],
  ['HIGHWAY', ['highway']],
];

export interface TrackSelectOpts {
  tracks: TrackEntry[];
  trackId: string;
  scores(trackId: string): ScoreEntry[];
  onDone(id: string): void;
  onBack(): void;
  step?: string;
}

export class TrackSelectScreen implements Screen {
  readonly el = screenEl('cs-tracks', 'dim');
  private i: number;
  private offTap: () => void;
  private canvas = document.createElement('canvas');

  constructor(private o: TrackSelectOpts) {
    addStyle('cs-tracks-css', CSS);
    this.i = Math.max(0, o.tracks.findIndex((t) => t.id === o.trackId));
    this.canvas.width = this.canvas.height = 600;
    this.el.innerHTML = `${header('CHOOSE A TRACK', o.step)}<div class="list"><div class="more up">&#9650; MORE</div><div class="cs-menu"></div><div class="more down">&#9660; MORE</div></div>
      <div class="map cs-panel"></div><div class="side cs-panel"></div>
      ${keys([['&uarr;&darr;', 'CHOOSE'], ['ENTER', 'RACE'], ['ESC', 'BACK']])}`;
    this.el.querySelector('.map')!.appendChild(this.canvas);
    this.offTap = onTap(this.el, (a) => {
      const i = this.o.tracks.findIndex((t) => t.id === a);
      if (i < 0) return;
      if (i === this.i) this.o.onDone(a);
      this.i = i;
      this.draw();
    });
    this.draw();
  }

  private draw() {
    const { tracks } = this.o;
    // Show a window of the list around the selection.
    const per = 9;
    const first = Math.max(0, Math.min(tracks.length - per, this.i - Math.floor(per / 2)));
    this.el.querySelector('.list .cs-menu')!.innerHTML = tracks
      .slice(first, first + per)
      .map((t, k) => {
        const i = first + k;
        const best = this.o.scores(t.id)[0];
        return `<div class="it${i === this.i ? ' sel' : ''}" data-act="${esc(t.id)}"><span>${esc(t.name.toUpperCase())}</span><span class="val">${best ? fmtTime(best.total) : ''}</span></div>`;
      })
      .join('');
    // The list scrolls: say when there are more tracks above or below the window.
    this.el.querySelector('.list .up')!.classList.toggle('on', first > 0);
    this.el.querySelector('.list .down')!.classList.toggle('on', first + per < tracks.length);
    const t = tracks[this.i];
    if (!t) return;
    const line = drawTrackThumb(this.canvas, t.track);
    const kinds = new Set(t.track.pieces.map((p) => p.kind));
    const tags = STUNTS.filter(([, ks]) => ks.some((k) => kinds.has(k))).map(([n]) => `<span>${n}</span>`).join('');
    const best = this.o.scores(t.id).slice(0, 3);
    this.el.querySelector('.side')!.innerHTML = `<div class="cap">TRACK ${this.i + 1} / ${tracks.length}</div><h2>${esc(t.name.toUpperCase())}</h2>
      <div class="kv"><span>LENGTH</span><b>${(line.length / 1609.34).toFixed(2)} MI</b></div>
      <div class="kv"><span>PIECES</span><b>${line.pieces.length}</b></div>
      <div class="kv"><span>SCENERY</span><b>${t.track.scenery.toUpperCase()}</b></div>
      <div class="tags">${tags || '<span>FLAT OUT</span>'}</div>
      <div class="best"><div class="cap">BEST TIMES</div>${
        best.length ? best.map((b, i) => `<div><i>${i + 1}</i><span>${esc(b.initials)}</span><b>${fmtTime(b.total)}</b></div>`).join('') : `<div style="color:${C.muted}">NO TIMES YET</div>`
      }</div>`;
  }

  input(e: MenuEvent) {
    const n = this.o.tracks.length;
    if (e.key === 'up' || e.key === 'left') this.i = (this.i + n - 1) % n;
    else if (e.key === 'down' || e.key === 'right') this.i = (this.i + 1) % n;
    else if (e.key === 'confirm') return this.o.onDone(this.o.tracks[this.i].id);
    else if (e.key === 'back') return this.o.onBack();
    else return;
    this.draw();
  }

  dispose() {
    this.offTap();
    this.el.remove();
  }
}
