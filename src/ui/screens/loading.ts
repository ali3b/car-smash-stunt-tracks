// Shown while a race builds: the track and car names, a bar that fills as the track's models arrive (a moving
// stripe while nothing is downloading, e.g. when everything is cached already).
import { addStyle, esc } from '../pixel';
import { C, screenEl, type Screen } from './common';
import { modelProgress, onModelProgress } from '../../models';

const CSS = `
.cs-load { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 26px; }
.cs-load .k { font-size: 10px; color: ${C.cyan}; letter-spacing: 3px; }
.cs-load h2 { margin: 0; font-size: 30px; font-weight: normal; color: ${C.yellow}; text-shadow: 4px 4px 0 ${C.orange}; text-align: center; }
.cs-load .car { font-size: 11px; color: ${C.muted}; }
.cs-load .bar { position: relative; width: min(360px, 80vw); height: 14px; background: repeating-linear-gradient(-60deg, ${C.orange} 0 12px, transparent 12px 24px);
  background-size: 28px 14px; animation: cs-load-run .6s linear infinite; opacity: .8; }
.cs-load .bar.pct { animation: none; background: rgba(255,255,255,.08); opacity: 1; }
.cs-load .bar i { position: absolute; left: 0; top: 0; bottom: 0; width: 0; background: ${C.orange}; transition: width .15s; }
.cs-load .n { font-size: 8px; color: ${C.muted}; min-height: 1em; }
@keyframes cs-load-run { to { background-position: 28px 0; } }
`;

export class LoadingScreen implements Screen {
  readonly el = screenEl('cs-load', 'solid');
  private off: () => void;
  constructor(track: string, sub: string) {
    addStyle('cs-load-css', CSS);
    this.el.innerHTML = `<div class="k">GET READY</div><h2>${esc(track.toUpperCase())}</h2><div class="car">${esc(sub)}</div><div class="bar"><i></i></div><div class="n"></div>`;
    const start = modelProgress().done;
    const bar = this.el.querySelector<HTMLElement>('.bar')!;
    const fill = bar.querySelector<HTMLElement>('i')!;
    const n = this.el.querySelector<HTMLElement>('.n')!;
    this.off = onModelProgress((done, total) => {
      const want = total - start;
      if (want <= 0) return;
      bar.classList.add('pct');
      fill.style.width = `${Math.round(((done - start) / want) * 100)}%`;
      n.textContent = `MODELS ${done - start} / ${want}`;
    });
  }
  input() {}
  dispose() {
    this.off();
    this.el.remove();
  }
}
