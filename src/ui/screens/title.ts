// The title / attract screen and the main menu. The title is our logo over the demo race; left alone it shows the
// best times on a track for a while, then the logo again (an arcade attract loop). Any confirm opens the main menu.
import { addStyle, esc, fmtTime } from '../pixel';
import type { MenuEvent } from '../../engine/input';
import { C, header, keys, onTap, screenEl, type Screen } from './common';
import { carInfo } from '../../game/catalog';
import type { ScoreEntry } from '../../game/storage';

const CSS = `
.cs-title { display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer;
  background: linear-gradient(rgba(11,14,28,.0) 40%, rgba(11,14,28,.75)), radial-gradient(ellipse at 50% 40%, rgba(11,14,28,.15), rgba(11,14,28,.6)); }
.cs-logo { position: relative; text-align: center; animation: cs-in .6s ease-out both; margin-top: -40px; }
.cs-logo .l1 { font-size: 92px; line-height: 1; letter-spacing: 4px; color: ${C.yellow}; transform: skewX(-10deg);
  text-shadow: 4px 4px 0 ${C.orange}, 8px 8px 0 #b02d0a, 12px 12px 0 rgba(0,0,0,.55); }
.cs-logo .l1 span { display: inline-block; }
.cs-logo .l1 span.smash { color: #fff; text-shadow: 4px 4px 0 ${C.pink}, 8px 8px 0 #8e1446, 12px 12px 0 rgba(0,0,0,.55); }
.cs-logo .l2 { display: inline-block; margin-top: 34px; padding: 14px 34px; font-size: 28px; letter-spacing: 10px; color: ${C.ink};
  background: ${C.cyan}; transform: skewX(-14deg); box-shadow: 8px 8px 0 rgba(0,0,0,.45); }
.cs-logo .l2 span { display: inline-block; transform: skewX(14deg); }
.cs-logo .chq { position: absolute; left: 50%; top: -38px; width: 280px; height: 16px; transform: translateX(-50%) skewX(-14deg);
  background: repeating-conic-gradient(#111 0 25%, #f4f1ea 0 50%) 0 0 / 16px 16px; opacity: .9; }
.cs-title .press { margin-top: 70px; font-size: 16px; letter-spacing: 3px; color: #fff; text-shadow: 3px 3px 0 #000; }
.cs-title .credit { position: absolute; bottom: 20px; font-size: 8px; color: ${C.muted}; letter-spacing: 1px; text-align: center; line-height: 2; }
.cs-title .attract { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; background: rgba(11,14,28,.72); }
.cs-title.scores .attract { display: flex; animation: cs-in .4s both; }
.cs-title.scores .cs-logo, .cs-title.scores .press { visibility: hidden; }
.cs-title .attract .cs-panel { padding: 30px 40px; min-width: 560px; }
.cs-title .attract h2 { margin: 0 0 6px; font-size: 18px; font-weight: normal; color: ${C.yellow}; }
.cs-title .attract .tn { font-size: 10px; color: ${C.cyan}; margin-bottom: 22px; }
.cs-title .attract table { width: 100%; border-collapse: collapse; font-size: 12px; }
.cs-title .attract td { padding: 8px 6px; }
.cs-title .attract td.r { color: ${C.orange}; } .cs-title .attract td.t { text-align: right; color: ${C.yellow}; }
.cs-title .attract td.c { color: ${C.muted}; font-size: 9px; }
@media (max-width: 980px), (max-height: 620px) {
  .cs-logo .l1 { font-size: 46px; } .cs-logo .l2 { font-size: 15px; letter-spacing: 5px; margin-top: 20px; }
  .cs-title .press { margin-top: 36px; font-size: 11px; }
}

.cs-main .cs-menu { position: absolute; left: 48px; top: 140px; width: 440px; }
.cs-main .cs-menu .it { animation: cs-slide .3s both; }
.cs-main .info { position: absolute; right: 48px; bottom: 80px; width: 380px; padding: 24px; animation: cs-in .3s both; }
.cs-main .info h3 { margin: 0 0 14px; font-size: 13px; font-weight: normal; color: ${C.yellow}; }
.cs-main .info p { margin: 0; font-size: 9px; line-height: 2; color: ${C.text}; }
.cs-main .mini { position: absolute; right: 48px; top: 40px; font-size: 12px; color: ${C.yellow}; text-shadow: 3px 3px 0 #000; transform: skewX(-10deg); }
.cs-main .mini b { color: #fff; font-weight: normal; }
@media (max-width: 980px), (max-height: 620px) { .cs-main .cs-menu { top: 80px; left: 18px; width: 320px; } .cs-main .info { display: none; } }
`;

export interface TitleOpts {
  onStart(): void;
  /** One track's table for the attract loop (cycled). */
  attractTable(): { track: string; rows: ScoreEntry[] } | null;
}

const LOGO_SECONDS = 14;
const SCORES_SECONDS = 8;

export class TitleScreen implements Screen {
  readonly el = screenEl('cs-title', 'none');
  private t = 0;
  private offTap: () => void;

  constructor(private o: TitleOpts) {
    addStyle('cs-title-css', CSS);
    this.el.innerHTML = `
      <div class="cs-logo"><div class="chq"></div>
        <div class="l1"><span>CAR</span> <span class="smash">SMASH</span></div>
        <div class="l2"><span>STUNT TRACKS</span></div></div>
      <div class="press blink">PRESS ENTER</div>
      <div class="credit">LOOPS &middot; RAMPS &middot; CORKSCREWS &middot; PIPES &middot; BUILD YOUR OWN TRACKS<br>&copy; 2026 CAR SMASH STUNT TRACKS CONTRIBUTORS</div>
      <div class="attract"></div>`;
    this.offTap = onTap(this.el, () => this.o.onStart());
    this.el.dataset.act = 'start';
  }

  input(e: MenuEvent) {
    if (this.el.classList.contains('scores')) {
      this.t = 0;
      this.el.classList.remove('scores');
      return;
    }
    if (e.key === 'confirm') this.o.onStart();
  }

  tick(dt: number) {
    this.t += dt;
    if (!this.el.classList.contains('scores') && this.t > LOGO_SECONDS) {
      const tab = this.o.attractTable();
      this.t = 0;
      if (!tab) return;
      const rows = tab.rows.length
        ? tab.rows.map((r, i) => `<tr><td class="r">${i + 1}</td><td>${esc(r.initials)}</td><td class="c">${carInfo(r.carId).name}</td><td class="t">${fmtTime(r.total)}</td></tr>`).join('')
        : `<tr><td class="c">NO TIMES YET. BE THE FIRST.</td></tr>`;
      this.el.querySelector('.attract')!.innerHTML = `<div class="cs-panel"><h2>BEST TIMES</h2><div class="tn">${esc(tab.track.toUpperCase())}</div><table>${rows}</table></div>`;
      this.el.classList.add('scores');
    } else if (this.el.classList.contains('scores') && this.t > SCORES_SECONDS) {
      this.t = 0;
      this.el.classList.remove('scores');
    }
  }

  dispose() {
    this.offTap();
    this.el.remove();
  }
}

export type MainItem = 'race' | 'versus' | 'editor' | 'replays' | 'scores' | 'options';

const ITEMS: { id: MainItem; label: string; info: string }[] = [
  { id: 'race', label: 'RACE', info: 'Just you and the clock. Pick a car and a track and set the best time.' },
  { id: 'versus', label: 'RACE VS OPPONENT', info: 'Pick a rival from six drivers and race them side by side.' },
  { id: 'editor', label: 'TRACK EDITOR', info: 'Build your own course on a 30 by 30 grid: loops, jumps, bridges and all.' },
  { id: 'replays', label: 'REPLAYS', info: 'Watch your saved races again from any camera, slow, fast or backwards.' },
  { id: 'scores', label: 'HIGH SCORES', info: 'The seven best times on every track.' },
  { id: 'options', label: 'OPTIONS', info: 'Controls, gearbox, the DOS look and more.' },
];

export class MainMenuScreen implements Screen {
  readonly el = screenEl('cs-main', 'dim');
  private sel = 0;
  private offTap: () => void;

  constructor(private o: { onPick(id: MainItem): void; onBack(): void; initial?: MainItem }) {
    addStyle('cs-title-css', CSS);
    this.sel = Math.max(0, ITEMS.findIndex((i) => i.id === o.initial));
    this.el.innerHTML = `${header('MAIN MENU')}<div class="cs-menu"></div><div class="info cs-panel"></div>
      ${keys([['&uarr;&darr;', 'CHOOSE'], ['ENTER', 'SELECT'], ['ESC', 'TITLE']])}`;
    this.offTap = onTap(this.el, (act) => {
      const i = ITEMS.findIndex((x) => x.id === act);
      if (i < 0) return;
      this.sel = i;
      this.o.onPick(ITEMS[i].id);
    });
    this.draw();
  }

  get selected() {
    return ITEMS[this.sel].id;
  }

  private draw() {
    this.el.querySelector('.cs-menu')!.innerHTML = ITEMS.map(
      (it, i) => `<div class="it${i === this.sel ? ' sel' : ''}" data-act="${it.id}" style="animation-delay:${i * 40}ms"><span>${it.label}</span></div>`,
    ).join('');
    const it = ITEMS[this.sel];
    this.el.querySelector('.info')!.innerHTML = `<div class="cap">${String(this.sel + 1).padStart(2, '0')} / ${String(ITEMS.length).padStart(2, '0')}</div><h3>${it.label}</h3><p>${it.info}</p>`;
  }

  input(e: MenuEvent) {
    if (e.key === 'up' || e.key === 'down') {
      this.sel = (this.sel + (e.key === 'up' ? -1 : 1) + ITEMS.length) % ITEMS.length;
      this.draw();
    } else if (e.key === 'confirm') this.o.onPick(this.selected);
    else if (e.key === 'back') this.o.onBack();
  }

  dispose() {
    this.offTap();
    this.el.remove();
  }
}
