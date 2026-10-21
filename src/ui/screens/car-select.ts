// Car select: the car turns on the showroom platform (the flow's 3D backdrop), its sheet sits on the right. Left /
// right picks the car (or the paint / gearbox when that row is focused), up / down moves between the rows.
import { addStyle, esc } from '../pixel';
import type { MenuEvent } from '../../engine/input';
import { C, header, keys, onTap, screenEl, statBar, type Screen } from './common';
import { CARS, type CarInfo } from '../../game/catalog';
import type { Gearbox } from '../../game/types';

const CSS = `
.cs-cars .sheet { position: absolute; right: 48px; top: 120px; width: 440px; padding: 26px 28px; animation: cs-in .3s both; }
.cs-cars .sheet .no { font-size: 9px; color: ${C.cyan}; letter-spacing: 2px; }
.cs-cars .sheet h2 { margin: 12px 0 10px; font-size: 22px; font-weight: normal; line-height: 1.3; }
.cs-cars .sheet .blurb { font-size: 9px; line-height: 1.9; color: ${C.muted}; margin-bottom: 18px; min-height: 34px; }
.cs-cars .sheet .facts { display: flex; gap: 10px; margin: 18px 0 6px; }
.cs-cars .sheet .facts div { flex: 1; padding: 10px 8px; background: rgba(255,255,255,.05); font-size: 8px; color: ${C.muted}; text-align: center; line-height: 1.9; }
.cs-cars .sheet .facts b { display: block; font-size: 12px; color: ${C.text}; font-weight: normal; }
.cs-cars .row { display: flex; align-items: center; gap: 14px; margin-top: 14px; padding: 10px 12px; border: 2px solid transparent; border-radius: 3px; }
.cs-cars .row.focus { border-color: ${C.yellow}; background: rgba(255,210,63,.07); }
.cs-cars .row .lbl { width: 92px; font-size: 9px; color: ${C.muted}; }
.cs-cars .row.focus .lbl { color: ${C.yellow}; }
.cs-cars .sw { width: 30px; height: 30px; border: 3px solid rgba(255,255,255,.2); transform: skewX(-12deg); cursor: pointer; }
.cs-cars .sw.on { border-color: #fff; box-shadow: 0 0 0 3px ${C.ink}, 0 0 0 5px ${C.yellow}; }
.cs-cars .seg { display: flex; gap: 6px; }
.cs-cars .seg span { padding: 9px 14px; font-size: 9px; color: ${C.muted}; background: rgba(255,255,255,.06); transform: skewX(-12deg); cursor: pointer; }
.cs-cars .seg span.on { background: ${C.cyan}; color: ${C.ink}; }
.cs-cars .picker { position: absolute; left: 48px; bottom: 76px; display: flex; align-items: center; gap: 18px; }
.cs-cars .picker .nm { min-width: 300px; text-align: center; font-size: 16px; padding: 14px 0; background: ${C.panel}; transform: skewX(-12deg);
  border-bottom: 4px solid var(--car); }
.cs-cars .picker .nm span { display: inline-block; transform: skewX(12deg); }
.cs-cars .dots { position: absolute; left: 48px; bottom: 60px; display: flex; gap: 6px; width: 412px; justify-content: center; }
.cs-cars .dots i { width: 18px; height: 5px; background: rgba(255,255,255,.2); }
.cs-cars .dots i.on { background: ${C.yellow}; }
.cs-cars .go { position: absolute; right: 48px; bottom: 70px; padding: 16px 30px; font-size: 14px; color: ${C.ink}; background: ${C.yellow};
  transform: skewX(-12deg); cursor: pointer; box-shadow: 6px 6px 0 rgba(0,0,0,.4); }
.cs-cars .go span { display: inline-block; transform: skewX(12deg); }
@media (max-width: 980px), (max-height: 620px) {
  .cs-cars .sheet { top: 70px; right: 14px; width: 330px; padding: 14px; } .cs-cars .sheet h2 { font-size: 14px; }
  .cs-cars .picker { left: 14px; bottom: 60px; } .cs-cars .picker .nm { min-width: 200px; font-size: 11px; }
  .cs-cars .go { right: 14px; bottom: 56px; }
}
/* A phone in landscape: the name, paint and gearbox only, clear of the NEXT button. */
@media (max-height: 460px) {
  .cs-cars .sheet { top: 60px; } .cs-cars .sheet .blurb, .cs-cars .sheet .facts, .cs-cars .sheet .cs-stat { display: none; }
  .cs-cars .row { margin-top: 6px; padding: 6px 8px; }
}
`;

export interface CarSelectOpts {
  carId: string;
  paint: string | null;
  gearbox: Gearbox;
  /** Paint variants per car (from the model manifests). */
  paints(carId: string): { name: string; tint: string | null }[];
  onChange(carId: string, paint: string | null): void;
  onDone(carId: string, paint: string | null, gearbox: Gearbox): void;
  onBack(): void;
  step?: string;
}

const MAX = { top: 210, zs: 10, hp: 750, weight: 3500 };

export class CarSelectScreen implements Screen {
  readonly el = screenEl('cs-cars', 'none');
  private i: number;
  private paint: string | null;
  private gearbox: Gearbox;
  private row = 0;
  private offTap: () => void;

  constructor(private o: CarSelectOpts) {
    addStyle('cs-cars-css', CSS);
    this.i = Math.max(0, CARS.findIndex((c) => c.id === o.carId));
    this.paint = o.paint;
    this.gearbox = o.gearbox;
    this.el.innerHTML = `${header('CHOOSE YOUR CAR', o.step)}
      <div class="sheet cs-panel"></div>
      <div class="picker"><span class="cs-arrow" data-act="prev">&#9664;</span><div class="nm"><span></span></div><span class="cs-arrow" data-act="next">&#9654;</span></div>
      <div class="dots"></div>
      <div class="go" data-act="go"><span>NEXT &#9654;</span></div>
      ${keys([['&larr;&rarr;', 'CHANGE'], ['&uarr;&darr;', 'CAR / PAINT / GEARBOX'], ['ENTER', 'NEXT'], ['ESC', 'BACK']])}`;
    this.offTap = onTap(this.el, (a) => {
      if (a === 'prev' || a === 'next') {
        this.row = 0;
        this.change(a === 'prev' ? -1 : 1);
      } else if (a === 'go') this.done();
      else if (a.startsWith('paint:')) {
        this.paint = a.slice(6);
        this.row = 1;
        this.o.onChange(this.car.id, this.paint);
        this.draw();
      } else if (a.startsWith('gear:')) {
        this.gearbox = a.slice(5) as Gearbox;
        this.row = 2;
        this.draw();
      }
    });
    this.draw();
  }

  get car(): CarInfo {
    return CARS[this.i];
  }

  private paints() {
    return this.o.paints(this.car.id);
  }

  private change(d: number) {
    if (this.row === 0) {
      this.i = (this.i + d + CARS.length) % CARS.length;
      this.paint = null;
      this.o.onChange(this.car.id, this.paint);
    } else if (this.row === 1) {
      const p = this.paints();
      if (p.length > 1) {
        const cur = Math.max(0, p.findIndex((x) => x.name === this.paint));
        this.paint = p[(cur + d + p.length) % p.length].name;
        this.o.onChange(this.car.id, this.paint);
      }
    } else this.gearbox = this.gearbox === 'auto' ? 'manual' : 'auto';
    this.draw();
  }

  private done() {
    this.o.onDone(this.car.id, this.paint, this.gearbox);
  }

  draw() {
    const c = this.car;
    const p = this.paints();
    const paint = this.paint ?? p[0]?.name ?? null;
    const swatches = p.length
      ? p.map((v) => `<span class="sw${v.name === paint ? ' on' : ''}" data-act="paint:${esc(v.name)}" title="${esc(v.name)}" style="background:${v.tint ?? c.colour}"></span>`).join('')
      : `<span class="sw on" style="background:${c.colour}"></span><span style="font-size:8px;color:${C.muted}">FACTORY PAINT</span>`;
    this.el.querySelector('.sheet')!.innerHTML = `
      <div class="no">CAR ${String(this.i + 1).padStart(2, '0')} OF ${String(CARS.length).padStart(2, '0')}</div>
      <h2 style="color:${c.colour}">${c.name}</h2>
      <div class="blurb">${esc(c.blurb)}</div>
      ${statBar('TOP SPEED', c.topSpeedMph / MAX.top, `${c.topSpeedMph} MPH`)}
      ${statBar('0-60 MPH', (MAX.zs - c.zeroSixty) / (MAX.zs - 2), `${c.zeroSixty.toFixed(1)} S`)}
      ${statBar('POWER', c.hp / MAX.hp, `${c.hp} HP`)}
      ${statBar('GRIP', c.grip / 5, `${c.grip}/5`)}
      <div class="facts"><div><b>${c.gears}</b>GEARS</div><div><b>${c.weightLb.toLocaleString('en-US')}</b>POUNDS</div><div><b>${((c.hp / c.weightLb) * 1000).toFixed(0)}</b>HP / TON</div></div>
      <div class="row${this.row === 1 ? ' focus' : ''}"><span class="lbl">PAINT</span>${swatches}</div>
      <div class="row${this.row === 2 ? ' focus' : ''}"><span class="lbl">GEARBOX</span><span class="seg">
        <span class="${this.gearbox === 'auto' ? 'on' : ''}" data-act="gear:auto">AUTO</span><span class="${this.gearbox === 'manual' ? 'on' : ''}" data-act="gear:manual">MANUAL</span></span></div>`;
    const nm = this.el.querySelector<HTMLElement>('.picker .nm')!;
    nm.style.setProperty('--car', c.colour);
    nm.classList.toggle('focus', this.row === 0);
    nm.style.outline = this.row === 0 ? `2px solid ${C.yellow}` : 'none';
    nm.querySelector('span')!.textContent = c.name;
    this.el.querySelector('.dots')!.innerHTML = CARS.map((_, i) => `<i class="${i === this.i ? 'on' : ''}"></i>`).join('');
  }

  input(e: MenuEvent) {
    if (e.key === 'left' || e.key === 'right') this.change(e.key === 'left' ? -1 : 1);
    else if (e.key === 'up' || e.key === 'down') {
      this.row = (this.row + (e.key === 'up' ? -1 : 1) + 3) % 3;
      this.draw();
    } else if (e.key === 'confirm') this.done();
    else if (e.key === 'back') this.o.onBack();
  }

  dispose() {
    this.offTap();
    this.el.remove();
  }
}
