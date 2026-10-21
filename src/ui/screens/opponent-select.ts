// Opponent select: six rival drivers as portrait cards (3 × 2), the focused one's file on the right.
import { addStyle, esc } from '../pixel';
import type { MenuEvent } from '../../engine/input';
import { C, header, keys, onTap, pips, screenEl, type Screen } from './common';
import { OPPONENTS, carInfo } from '../../game/catalog';

const CSS = `
.cs-opp .grid { position: absolute; left: 48px; top: 130px; display: grid; grid-template-columns: repeat(3, 190px); gap: 18px; }
.cs-opp .card { position: relative; height: 236px; background: ${C.panel}; border: 3px solid rgba(255,255,255,.1); cursor: pointer; overflow: hidden;
  animation: cs-in .3s both; transition: transform .1s; }
.cs-opp .card .pic { position: absolute; inset: 0 0 52px 0; background: linear-gradient(160deg, var(--c), #0b0e1c 95%); }
.cs-opp .card .pic img { width: 100%; height: 100%; object-fit: cover; display: block; }
.cs-opp .card .pic .sil { position: absolute; left: 50%; bottom: 0; width: 90px; height: 120px; transform: translateX(-50%);
  background: rgba(0,0,0,.35); border-radius: 45px 45px 0 0; }
.cs-opp .card .nm { position: absolute; left: 0; right: 0; bottom: 0; height: 52px; padding: 10px 12px; font-size: 9px; line-height: 1.7;
  background: rgba(8,10,22,.95); border-top: 4px solid var(--c); }
.cs-opp .card .nm small { display: block; font-size: 7px; color: ${C.muted}; }
.cs-opp .card.sel { border-color: ${C.yellow}; transform: translateY(-6px); box-shadow: 0 0 0 3px ${C.ink}, 8px 10px 0 rgba(0,0,0,.4); }
.cs-opp .card.sel .nm { color: ${C.yellow}; }
.cs-opp .card .lv { position: absolute; top: 10px; right: 10px; padding: 5px 7px; font-size: 7px; background: rgba(8,10,22,.8); color: ${C.yellow}; }
.cs-opp .file { position: absolute; right: 48px; top: 130px; width: 400px; padding: 26px 28px; }
.cs-opp .file h2 { margin: 6px 0 16px; font-size: 18px; font-weight: normal; line-height: 1.4; }
.cs-opp .file .bio { font-size: 9px; line-height: 2; color: ${C.text}; }
.cs-opp .file .q { margin: 20px 0; padding: 14px 16px; font-size: 10px; line-height: 1.9; color: ${C.yellow}; border-left: 4px solid ${C.orange}; background: rgba(255,255,255,.04); }
.cs-opp .file .ln { display: flex; justify-content: space-between; align-items: center; font-size: 9px; color: ${C.muted}; margin: 12px 0; }
.cs-opp .file .ln b { font-weight: normal; color: ${C.text}; }
@media (max-width: 1180px) { .cs-opp .grid { grid-template-columns: repeat(3, 140px); } .cs-opp .card { height: 180px; } .cs-opp .file { width: 320px; } }
@media (max-width: 980px), (max-height: 620px) { .cs-opp .grid { top: 70px; left: 14px; grid-template-columns: repeat(3, 110px); gap: 8px; }
  .cs-opp .card { height: 140px; } .cs-opp .file { top: 70px; right: 14px; width: 280px; padding: 14px; } }
`;

export interface OpponentSelectOpts {
  opponentId: string;
  onDone(id: string): void;
  onBack(): void;
  step?: string;
}

export class OpponentSelectScreen implements Screen {
  readonly el = screenEl('cs-opp', 'dim');
  private i: number;
  private offTap: () => void;
  private portraits = new Map<string, string>();

  constructor(private o: OpponentSelectOpts) {
    addStyle('cs-opp-css', CSS);
    this.i = Math.max(0, OPPONENTS.findIndex((x) => x.id === o.opponentId));
    this.el.innerHTML = `${header('CHOOSE YOUR RIVAL', o.step)}<div class="grid"></div><div class="file cs-panel"></div>
      ${keys([['&larr;&rarr;&uarr;&darr;', 'CHOOSE'], ['ENTER', 'NEXT'], ['ESC', 'BACK']])}`;
    this.offTap = onTap(this.el, (a) => {
      const i = OPPONENTS.findIndex((x) => x.id === a);
      if (i < 0) return;
      if (i === this.i) this.o.onDone(OPPONENTS[i].id);
      this.i = i;
      this.draw();
    });
    this.draw();
  }

  setPortrait(id: string, url: string) {
    this.portraits.set(id, url);
    const img = this.el.querySelector<HTMLElement>(`.card[data-act="${id}"] .pic`);
    if (img) img.innerHTML = `<img src="${url}" alt="">`;
  }

  private draw() {
    this.el.querySelector('.grid')!.innerHTML = OPPONENTS.map((p, i) => {
      const url = this.portraits.get(p.id);
      return `<div class="card${i === this.i ? ' sel' : ''}" data-act="${p.id}" style="--c:${p.colour};animation-delay:${i * 40}ms">
        <div class="pic">${url ? `<img src="${url}" alt="">` : '<div class="sil"></div>'}</div>
        <div class="lv">LV ${p.skill}</div>
        <div class="nm">${esc(p.tag)}<small>${carInfo(p.carId).name}</small></div></div>`;
    }).join('');
    const p = OPPONENTS[this.i];
    this.el.querySelector('.file')!.innerHTML = `<div class="cap">RIVAL ${this.i + 1} / ${OPPONENTS.length}</div>
      <h2 style="color:${p.colour}">${esc(p.name)}</h2>
      <div class="bio">${esc(p.bio)}</div>
      <div class="q">&ldquo;${esc(p.quote)}&rdquo;</div>
      <div class="ln"><span>SPEED</span>${pips(p.skill)}</div>
      <div class="ln"><span>NERVE</span>${pips(p.nerve)}</div>
      <div class="ln"><span>DRIVES</span><b>${carInfo(p.carId).name}</b></div>`;
  }

  input(e: MenuEvent) {
    const n = OPPONENTS.length;
    if (e.key === 'left') this.i = (this.i + n - 1) % n;
    else if (e.key === 'right') this.i = (this.i + 1) % n;
    else if (e.key === 'up' || e.key === 'down') this.i = (this.i + 3) % n;
    else if (e.key === 'confirm') return this.o.onDone(OPPONENTS[this.i].id);
    else if (e.key === 'back') return this.o.onBack();
    else return;
    this.draw();
  }

  dispose() {
    this.offTap();
    this.el.remove();
  }
}
