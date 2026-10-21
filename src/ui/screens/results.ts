// The results screen: the outcome, the race's numbers, the initials entry when the time makes the track's table,
// then what next (race again, watch / save the replay, high scores, menu).
import { addStyle, esc, fmtTime } from '../pixel';
import type { MenuEvent } from '../../engine/input';
import { C, header, keys, onTap, screenEl, type Screen } from './common';
import { carInfo, opponentInfo } from '../../game/catalog';
import type { RaceResult } from '../../game/types';

const CSS = `
.cs-res .hero { position: absolute; left: 48px; top: 120px; animation: cs-in .35s both; }
.cs-res .hero .big { display: inline-block; padding: 18px 34px; font-size: 40px; letter-spacing: 3px; transform: skewX(-12deg); color: ${C.ink};
  background: ${C.yellow}; box-shadow: 10px 10px 0 rgba(0,0,0,.45); }
.cs-res .hero .big span { display: inline-block; transform: skewX(12deg); }
.cs-res .hero .big.lose { background: ${C.pink}; color: #fff; }
.cs-res .hero .big.dnf { background: #4a5170; color: #fff; }
.cs-res .hero .sub { margin-top: 22px; font-size: 10px; color: ${C.text}; text-shadow: 2px 2px 0 #000; }
.cs-res .stats { position: absolute; left: 48px; top: 260px; width: 520px; padding: 22px 26px; animation: cs-in .35s .08s both; }
.cs-res .stats .ln { display: flex; justify-content: space-between; align-items: baseline; padding: 11px 0; font-size: 10px; color: ${C.muted};
  border-bottom: 1px dashed rgba(255,255,255,.1); }
.cs-res .stats .ln b { font-weight: normal; color: ${C.text}; font-size: 13px; }
.cs-res .stats .ln.total b { color: ${C.yellow}; font-size: 20px; }
.cs-res .stats .ln.pen b { color: ${C.pink}; }
.cs-res .right { position: absolute; right: 48px; top: 120px; width: 400px; }
.cs-res .hs { padding: 22px 24px; margin-bottom: 18px; border-color: ${C.yellow}; animation: cs-in .35s .16s both; }
.cs-res .hs h3 { margin: 0 0 8px; font-size: 13px; font-weight: normal; color: ${C.yellow}; }
.cs-res .hs p { margin: 0 0 18px; font-size: 8px; color: ${C.muted}; line-height: 1.8; }
.cs-res .slots { display: flex; gap: 12px; align-items: center; }
.cs-res .slots .col { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.cs-res .slots .col .cs-arrow { width: 54px; height: 30px; font-size: 11px; }
.cs-res .slots .slot { width: 54px; height: 64px; display: flex; align-items: center; justify-content: center; font-size: 28px; background: rgba(255,255,255,.06);
  border-bottom: 5px solid rgba(255,255,255,.25); }
.cs-res .slots .slot.cur { border-bottom-color: ${C.yellow}; color: ${C.yellow}; animation: cs-blink 1s steps(2) infinite; }
.cs-res .slots .ok { width: auto; padding: 0 16px; font-size: 10px; color: ${C.ink}; background: ${C.yellow}; border: 0; cursor: pointer; animation: none; }
.cs-res .cs-menu .it { font-size: 11px; padding: 13px 18px; }
@media (max-width: 980px), (max-height: 620px) { .cs-res .hero { top: 66px; left: 14px; } .cs-res .hero .big { font-size: 20px; }
  .cs-res .stats { top: 150px; left: 14px; width: 330px; padding: 10px 16px; } .cs-res .right { top: 66px; right: 14px; width: 300px; } }
@media (max-height: 460px) { .cs-res .hero { top: 54px; } .cs-res .hero .sub { margin-top: 10px; } .cs-res .stats { top: 120px; padding: 4px 14px; }
  .cs-res .stats .ln { padding: 5px 0; } .cs-res .stats .ln.total b { font-size: 14px; } .cs-res .right { top: 54px; }
  .cs-res .hs { padding: 12px 14px; } .cs-res .slots .slot { height: 44px; } }
`;

export type ResultsChoice = 'again' | 'watch' | 'save' | 'scores' | 'menu';
const CHOICES: { id: ResultsChoice; label: string }[] = [
  { id: 'again', label: 'RACE AGAIN' },
  { id: 'watch', label: 'WATCH REPLAY' },
  { id: 'save', label: 'SAVE REPLAY' },
  { id: 'scores', label: 'HIGH SCORES' },
  { id: 'menu', label: 'MAIN MENU' },
];

export interface ResultsOpts {
  result: RaceResult;
  trackName: string;
  /** Table place this time would take (0-based), or -1. */
  place: number;
  initials: string;
  /** The initials for this time were already taken (back from watching the replay). */
  entered?: boolean;
  onInitials(initials: string): void;
  onChoose(c: ResultsChoice): void;
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ';

export class ResultsScreen implements Screen {
  readonly el = screenEl('cs-res', 'dim');
  private sel = 0;
  private entering: boolean;
  private letters: string[];
  private slot = 0;
  private saved = false;
  private offTap: () => void;

  constructor(private o: ResultsOpts) {
    addStyle('cs-res-css', CSS);
    this.entering = !o.entered && o.place >= 0 && o.result.finished;
    this.letters = (o.initials + '   ').slice(0, 3).split('');
    const r = o.result;
    const opp = opponentInfo(r.opponentId);
    const [cls, title] = !r.finished ? ['dnf', r.crashed ? 'WRECKED' : 'DID NOT FINISH'] : r.won === false ? ['lose', `${opp?.tag ?? 'RIVAL'} WINS`] : r.won ? ['', 'YOU WIN!'] : ['', 'FINISHED!'];
    this.el.innerHTML = `${header('RESULTS')}
      <div class="hero"><div class="big ${cls}"><span>${title}</span></div><div class="sub">${esc(o.trackName.toUpperCase())} &middot; ${carInfo(r.carId).name}${opp ? ` &middot; VS ${esc(opp.name)}` : ''}</div></div>
      <div class="stats cs-panel">
        <div class="ln"><span>TIME</span><b>${fmtTime(r.timeSeconds)}</b></div>
        <div class="ln pen"><span>PENALTIES</span><b>+${r.penaltySeconds.toFixed(0)} S</b></div>
        <div class="ln total"><span>TOTAL</span><b>${r.finished ? fmtTime(r.totalSeconds) : '--'}</b></div>
        ${opp ? `<div class="ln"><span>${esc(opp.tag)}</span><b>${r.opponentTotalSeconds === null ? 'DID NOT FINISH' : fmtTime(r.opponentTotalSeconds)}</b></div>` : ''}
        <div class="ln"><span>TOP SPEED</span><b>${Math.round(r.topSpeedMph)} MPH</b></div>
        <div class="ln"><span>JUMPS</span><b>${r.jumps}</b></div>
        <div class="ln"><span>DISTANCE</span><b>${(r.distanceM / 1609.34).toFixed(2)} MI</b></div>
      </div>
      <div class="right"><div class="hs cs-panel"></div><div class="cs-menu"></div></div>
      ${keys(this.entering ? [['A-Z', 'TYPE'], ['&larr;&rarr;', 'MOVE'], ['&uarr;&darr;', 'LETTER'], ['ENTER', 'KEEP']] : [['&uarr;&darr;', 'CHOOSE'], ['ENTER', 'SELECT'], ['ESC', 'MENU']])}`;
    this.offTap = onTap(this.el, (a) => {
      if (a === 'ok') return this.commit();
      // The on-screen letter picker: ▲ / ▼ by each initial, a tap on a slot selects it.
      const m = /^(up|down|slot):(\d)$/.exec(a);
      if (m && this.entering) {
        this.slot = Number(m[2]);
        if (m[1] === 'slot') this.draw();
        else this.input({ key: m[1] as 'up' | 'down' });
        return;
      }
      const i = CHOICES.findIndex((c) => c.id === a);
      if (i < 0 || this.entering) return;
      this.sel = i;
      this.choose();
    });
    this.draw();
  }

  get isEntering() {
    return this.entering;
  }

  private draw() {
    const hs = this.el.querySelector<HTMLElement>('.hs')!;
    if (this.o.place >= 0 && this.o.result.finished) {
      hs.style.display = '';
      hs.innerHTML = this.entering
        ? `<h3>NEW HIGH SCORE &middot; #${this.o.place + 1}</h3><p>TYPE YOUR INITIALS (OR TAP &#9650; &#9660;), ENTER TO KEEP THEM.</p><div class="slots">${this.letters
            .map(
              (l, i) =>
                `<div class="col"><span class="cs-arrow" data-act="up:${i}">&#9650;</span><span class="slot${i === this.slot ? ' cur' : ''}" data-act="slot:${i}">${l === ' ' ? '_' : esc(l)}</span><span class="cs-arrow" data-act="down:${i}">&#9660;</span></div>`,
            )
            .join('')}<span class="ok slot" data-act="ok">OK</span></div>`
        : `<h3>#${this.o.place + 1} ON THE TABLE</h3><p>${esc(this.letters.join('').trim())} &middot; ${fmtTime(this.o.result.totalSeconds)}</p>`;
    } else hs.style.display = 'none';
    this.el.querySelector('.cs-menu')!.innerHTML = this.entering
      ? ''
      : CHOICES.map((c, i) => `<div class="it${i === this.sel ? ' sel' : ''}" data-act="${c.id}"><span>${c.id === 'save' && this.saved ? 'REPLAY SAVED' : c.label}</span></div>`).join('');
  }

  markSaved() {
    this.saved = true;
    this.draw();
  }

  private commit() {
    if (!this.entering) return;
    this.entering = false;
    const ini = this.letters.join('').trim() || '???';
    this.letters = (ini + '   ').slice(0, 3).split('');
    this.o.onInitials(ini);
    this.el.querySelector('.cs-keys')!.outerHTML = keys([['&uarr;&darr;', 'CHOOSE'], ['ENTER', 'SELECT'], ['ESC', 'MENU']]);
    this.draw();
  }

  private choose() {
    this.o.onChoose(CHOICES[this.sel].id);
  }

  input(e: MenuEvent) {
    if (this.entering) {
      if (e.letter) {
        this.letters[this.slot] = e.letter;
        this.slot = Math.min(2, this.slot + 1);
      } else if (e.key === 'up' || e.key === 'down') {
        const i = LETTERS.indexOf(this.letters[this.slot]);
        this.letters[this.slot] = LETTERS[(i + (e.key === 'up' ? 1 : -1) + LETTERS.length) % LETTERS.length];
      } else if (e.key === 'left') this.slot = Math.max(0, this.slot - 1);
      else if (e.key === 'right') this.slot = Math.min(2, this.slot + 1);
      else if (e.key === 'back') {
        this.letters[this.slot] = ' ';
        this.slot = Math.max(0, this.slot - 1);
      } else if (e.key === 'confirm') return this.commit();
      this.draw();
      return;
    }
    if (e.key === 'up' || e.key === 'down') {
      this.sel = (this.sel + (e.key === 'up' ? -1 : 1) + CHOICES.length) % CHOICES.length;
      this.draw();
    } else if (e.key === 'confirm') this.choose();
    else if (e.key === 'back') this.o.onChoose('menu');
  }

  dispose() {
    this.offTap();
    this.el.remove();
  }
}
