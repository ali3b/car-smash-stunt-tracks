// The pause menu over a race: continue, restart, quit to the menu.
import { addStyle } from '../pixel';
import type { MenuEvent } from '../../engine/input';
import { C, onTap, screenEl, type Screen } from './common';

const CSS = `
.cs-pause { display: flex; align-items: center; justify-content: center; background: rgba(8,10,22,.6); z-index: 30; }
.cs-pause .box { width: 420px; padding: 30px; animation: cs-in .2s both; }
.cs-pause h2 { margin: 0 0 24px; font-size: 22px; font-weight: normal; color: ${C.yellow}; text-align: center; letter-spacing: 4px; }
`;

export type PauseChoice = 'continue' | 'restart' | 'quit';
const ITEMS: [PauseChoice, string][] = [
  ['continue', 'CONTINUE'],
  ['restart', 'RESTART RACE'],
  ['quit', 'QUIT TO MENU'],
];

export class PauseScreen implements Screen {
  readonly el = screenEl('cs-pause', 'none');
  private sel = 0;
  private offTap: () => void;

  constructor(private onChoose: (c: PauseChoice) => void) {
    addStyle('cs-pause-css', CSS);
    this.el.innerHTML = `<div class="box cs-panel"><h2>PAUSED</h2><div class="cs-menu"></div></div>`;
    this.offTap = onTap(this.el, (a) => this.onChoose(a as PauseChoice));
    this.draw();
  }

  private draw() {
    this.el.querySelector('.cs-menu')!.innerHTML = ITEMS.map(([id, l], i) => `<div class="it${i === this.sel ? ' sel' : ''}" data-act="${id}"><span>${l}</span></div>`).join('');
  }

  input(e: MenuEvent) {
    if (e.key === 'up' || e.key === 'down') {
      this.sel = (this.sel + (e.key === 'up' ? -1 : 1) + ITEMS.length) % ITEMS.length;
      this.draw();
    } else if (e.key === 'confirm') this.onChoose(ITEMS[this.sel][0]);
    else if (e.key === 'back') this.onChoose('continue');
  }

  dispose() {
    this.offTap();
    this.el.remove();
  }
}
