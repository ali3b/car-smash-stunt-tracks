// The high-score table: seven places per track, left / right flips between tracks; a freshly set time glows.
import { addStyle, esc, fmtTime } from '../pixel';
import type { MenuEvent } from '../../engine/input';
import { C, header, keys, onTap, screenEl, type Screen } from './common';
import { carInfo } from '../../game/catalog';
import { TABLE_SIZE, type ScoreEntry } from '../../game/storage';
import type { TrackEntry } from '../../track/tracks';

const CSS = `
.cs-hs .wrap { position: absolute; left: 50%; top: 120px; width: 820px; transform: translateX(-50%); }
.cs-hs .pick { display: flex; align-items: center; justify-content: center; gap: 22px; margin-bottom: 22px; }
.cs-hs .pick .nm { min-width: 420px; padding: 16px; text-align: center; font-size: 16px; color: ${C.yellow}; background: ${C.panel}; transform: skewX(-12deg); }
.cs-hs .pick .nm span { display: inline-block; transform: skewX(12deg); }
.cs-hs .pick .nm small { display: block; margin-top: 8px; font-size: 8px; color: ${C.muted}; }
.cs-hs table { width: 100%; border-collapse: separate; border-spacing: 0 6px; padding: 18px 24px; }
.cs-hs th { font-size: 8px; font-weight: normal; color: ${C.muted}; text-align: left; padding: 0 14px 6px; letter-spacing: 1px; }
.cs-hs td { padding: 14px; font-size: 13px; background: rgba(255,255,255,.04); }
.cs-hs td.rk { width: 64px; color: ${C.orange}; font-size: 16px; }
.cs-hs td.car { font-size: 9px; color: ${C.muted}; }
.cs-hs td.dt { font-size: 8px; color: ${C.muted}; }
.cs-hs td.tm { text-align: right; color: ${C.yellow}; }
.cs-hs th.tm { text-align: right; }
.cs-hs tr.empty td { color: rgba(255,255,255,.18); }
.cs-hs tr.new td { background: rgba(255,210,63,.18); animation: cs-glow 1s ease-in-out infinite alternate; }
.cs-hs tr:first-child td.rk { color: ${C.yellow}; }
@keyframes cs-glow { to { background: rgba(255,210,63,.32); } }
@media (max-width: 980px), (max-height: 620px) { .cs-hs .wrap { top: 64px; width: 94vw; } .cs-hs .pick .nm { min-width: 240px; font-size: 11px; } .cs-hs td { padding: 7px; font-size: 10px; } }
`;

export interface ScoresOpts {
  tracks: TrackEntry[];
  trackId: string;
  scores(trackId: string): ScoreEntry[];
  /** Highlight this place on trackId (a time just set). */
  highlight?: number;
  onBack(): void;
}

export class ScoresScreen implements Screen {
  readonly el = screenEl('cs-hs', 'dim');
  private i: number;
  private offTap: () => void;

  constructor(private o: ScoresOpts) {
    addStyle('cs-hs-css', CSS);
    this.i = Math.max(0, o.tracks.findIndex((t) => t.id === o.trackId));
    this.el.innerHTML = `${header('HIGH SCORES')}<div class="wrap"><div class="pick"><span class="cs-arrow" data-act="prev">&#9664;</span><div class="nm"></div>
      <span class="cs-arrow" data-act="next">&#9654;</span></div><div class="cs-panel"><table></table></div></div>
      ${keys([['&larr;&rarr;', 'TRACK'], ['ENTER', 'DONE'], ['ESC', 'BACK']])}`;
    this.offTap = onTap(this.el, (a) => this.move(a === 'prev' ? -1 : 1));
    this.draw();
  }

  get trackId() {
    return this.o.tracks[this.i]?.id ?? '';
  }

  private move(d: number) {
    const n = this.o.tracks.length;
    this.i = (this.i + d + n) % n;
    this.draw();
  }

  private draw() {
    const t = this.o.tracks[this.i];
    if (!t) return;
    this.el.querySelector('.nm')!.innerHTML = `<span>${esc(t.name.toUpperCase())}<small>TRACK ${this.i + 1} OF ${this.o.tracks.length}</small></span>`;
    const rows = this.o.scores(t.id);
    const hl = t.id === this.o.trackId ? this.o.highlight : undefined;
    this.el.querySelector('table')!.innerHTML =
      `<tr><th>#</th><th>NAME</th><th>CAR</th><th>DATE</th><th class="tm">TIME</th></tr>` +
      Array.from({ length: TABLE_SIZE }, (_, k) => {
        const r = rows[k];
        if (!r) return `<tr class="empty"><td class="rk">${k + 1}</td><td>---</td><td class="car"></td><td class="dt"></td><td class="tm">-:--.--</td></tr>`;
        return `<tr class="${k === hl ? 'new' : ''}"><td class="rk">${k + 1}</td><td>${esc(r.initials)}</td><td class="car">${carInfo(r.carId).name}</td>
          <td class="dt">${r.date.slice(0, 10)}</td><td class="tm">${fmtTime(r.total)}${r.penalty ? `<small style="color:${C.pink};font-size:8px"> +${r.penalty}</small>` : ''}</td></tr>`;
      }).join('');
  }

  input(e: MenuEvent) {
    if (e.key === 'left' || e.key === 'right') this.move(e.key === 'left' ? -1 : 1);
    else if (e.key === 'confirm' || e.key === 'back') this.o.onBack();
  }

  dispose() {
    this.offTap();
    this.el.remove();
  }
}
