// Saved replays: a list (newest first); Enter watches one, Delete / X removes it.
import { addStyle, esc, fmtTime } from '../pixel';
import type { MenuEvent } from '../../engine/input';
import { C, header, keys, onTap, screenEl, type Screen } from './common';
import { carInfo, opponentInfo } from '../../game/catalog';
import type { SavedReplay } from '../../game/storage';

const CSS = `
.cs-rpl .wrap { position: absolute; left: 50%; top: 130px; width: 860px; transform: translateX(-50%); }
.cs-rpl .cs-menu .it { font-size: 11px; padding: 14px 20px; }
.cs-rpl .cs-menu .it small { font-size: 8px; color: ${C.muted}; margin-left: 16px; }
.cs-rpl .cs-menu .it.sel small { color: ${C.ink}; }
.cs-rpl .empty { padding: 40px; text-align: center; font-size: 10px; line-height: 2.2; color: ${C.muted}; }
@media (max-width: 980px), (max-height: 620px) { .cs-rpl .wrap { top: 66px; width: 94vw; } }
`;

export interface ReplaysOpts {
  list(): SavedReplay[];
  trackName(id: string): string | null;
  onWatch(r: SavedReplay): void;
  onDelete(r: SavedReplay): void;
  onBack(): void;
}

export class ReplaysScreen implements Screen {
  readonly el = screenEl('cs-rpl', 'dim');
  private sel = 0;
  private offTap: () => void;

  constructor(private o: ReplaysOpts) {
    addStyle('cs-rpl-css', CSS);
    this.el.innerHTML = `${header('REPLAYS')}<div class="wrap"></div>
      ${keys([['&uarr;&darr;', 'CHOOSE'], ['ENTER', 'WATCH'], ['X', 'DELETE'], ['ESC', 'BACK']])}`;
    this.offTap = onTap(this.el, (a) => {
      const r = this.o.list().find((x) => x.id === a);
      if (r) this.o.onWatch(r);
    });
    this.draw();
  }

  private draw() {
    const list = this.o.list();
    this.sel = Math.min(this.sel, Math.max(0, list.length - 1));
    const wrap = this.el.querySelector('.wrap')!;
    if (!list.length) {
      wrap.innerHTML = `<div class="cs-panel empty">NO REPLAYS SAVED YET.<br>FINISH A RACE AND CHOOSE SAVE REPLAY.</div>`;
      return;
    }
    wrap.innerHTML = `<div class="cs-menu">${list
      .map((r, i) => {
        const track = this.o.trackName(r.data.trackId) ?? 'MISSING TRACK';
        const opp = opponentInfo(r.data.opponentId);
        return `<div class="it${i === this.sel ? ' sel' : ''}" data-act="${esc(r.id)}"><span>${esc(track.toUpperCase())}<small>${carInfo(r.data.carId).name}${opp ? ` VS ${esc(opp.tag)}` : ''} &middot; ${r.date.slice(0, 10)}</small></span><span class="val">${fmtTime(r.total)}</span></div>`;
      })
      .join('')}</div>`;
  }

  input(e: MenuEvent) {
    const list = this.o.list();
    if ((e.key === 'up' || e.key === 'down') && list.length) {
      this.sel = (this.sel + (e.key === 'up' ? -1 : 1) + list.length) % list.length;
      this.draw();
    } else if (e.key === 'confirm' && list[this.sel]) this.o.onWatch(list[this.sel]);
    else if (e.letter === 'X' && list[this.sel]) {
      this.o.onDelete(list[this.sel]);
      this.draw();
    } else if (e.key === 'back') this.o.onBack();
  }

  dispose() {
    this.offTap();
    this.el.remove();
  }
}
