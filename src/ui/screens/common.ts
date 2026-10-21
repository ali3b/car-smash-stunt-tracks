// The look shared by every menu screen: a clean arcade style over the 3D backdrop. Ink-navy glass panels, a hot
// orange / signal yellow / cyan accent set, skewed tabs and stripes, the pixel font for everything, and a key-hint bar.
import { addStyle, PIXEL_FONT } from '../pixel';
import type { MenuEvent } from '../../engine/input';

export interface Screen {
  readonly el: HTMLElement;
  /** A menu press (keyboard / pad, a click, or a test via window.__cs.flow.press). */
  input(e: MenuEvent): void;
  /** Real seconds since the last frame (blinks, countdowns). */
  tick?(dt: number): void;
  dispose(): void;
}

export const C = {
  ink: '#0b0e1c',
  panel: 'rgba(12, 16, 34, 0.86)',
  line: 'rgba(255, 255, 255, 0.14)',
  text: '#f4f1ea',
  muted: '#8f98bf',
  orange: '#ff5a1f',
  yellow: '#ffd23f',
  cyan: '#35d6ff',
  pink: '#ff3d8b',
  green: '#4be37a',
};

const CSS = `
.cs-scr { position: fixed; inset: 0; z-index: 20; font-family: ${PIXEL_FONT}; color: ${C.text}; user-select: none;
  box-sizing: border-box; -webkit-font-smoothing: none; }
.cs-scr *, .cs-scr *::before, .cs-scr *::after { box-sizing: border-box; }
.cs-scr.dim { background: radial-gradient(ellipse at 30% 40%, rgba(11,14,28,.35), rgba(11,14,28,.82)); }
.cs-scr.solid { background: ${C.ink}; }
.cs-scr .blink { animation: cs-blink 1.1s steps(2) infinite; }
@keyframes cs-blink { 50% { opacity: 0; } }
@keyframes cs-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@keyframes cs-slide { from { opacity: 0; transform: translateX(-24px); } to { opacity: 1; transform: none; } }

/* Header: a skewed title tab with a step counter, and a chequer strip. */
.cs-head { position: absolute; top: 28px; left: 0; right: 0; height: 64px; display: flex; align-items: center; gap: 18px; padding-left: 48px;
  pointer-events: none; }
.cs-head .tab { position: relative; padding: 16px 30px 16px 26px; background: ${C.orange}; transform: skewX(-14deg);
  box-shadow: 6px 6px 0 rgba(0,0,0,.45); }
.cs-head .tab h1 { margin: 0; font-size: 22px; font-weight: normal; letter-spacing: 2px; color: #fff; transform: skewX(14deg);
  text-shadow: 3px 3px 0 rgba(0,0,0,.35); }
.cs-head .step { font-size: 10px; color: ${C.yellow}; letter-spacing: 2px; padding: 9px 12px; background: ${C.panel}; transform: skewX(-14deg);
  border-left: 4px solid ${C.yellow}; }
.cs-head .step span { display: inline-block; transform: skewX(14deg); }
.cs-head .stripes { flex: 1; height: 10px; margin-right: 48px; opacity: .55;
  background: repeating-linear-gradient(-60deg, ${C.orange} 0 10px, transparent 10px 20px); }

/* Footer: key hints. */
.cs-keys { position: absolute; left: 0; right: 0; bottom: 0; height: 46px; display: flex; align-items: center; justify-content: center; gap: 26px;
  background: linear-gradient(90deg, transparent, rgba(8,10,22,.92) 12%, rgba(8,10,22,.92) 88%, transparent); font-size: 9px; color: ${C.muted}; }
.cs-scr .cs-ar { width: 8px; height: 8px; margin: 0 1px; fill: currentColor; vertical-align: -1px; }
.cs-keys [data-menu] { cursor: pointer; padding: 8px 4px; }
.cs-keys b { display: inline-block; min-width: 22px; padding: 5px 6px; margin-right: 8px; font-weight: normal; text-align: center; color: ${C.ink};
  background: ${C.text}; border-radius: 3px; box-shadow: 0 3px 0 #6a7091; }

/* Glass panel. */
.cs-panel { background: ${C.panel}; border: 2px solid ${C.line}; border-radius: 4px; box-shadow: 8px 8px 0 rgba(0,0,0,.35);
  backdrop-filter: blur(6px); }
.cs-panel .cap { font-size: 9px; letter-spacing: 2px; color: ${C.cyan}; margin-bottom: 14px; }

/* A vertical menu of skewed bars. */
.cs-menu { display: flex; flex-direction: column; gap: 10px; }
.cs-menu .it { position: relative; display: flex; align-items: center; gap: 14px; padding: 15px 22px; font-size: 14px; color: ${C.muted};
  background: rgba(12,16,34,.72); transform: skewX(-12deg); border-left: 6px solid transparent; cursor: pointer;
  transition: color .08s, background .08s, padding .12s; }
.cs-menu .it > * { transform: skewX(12deg); }
.cs-menu .it:hover { color: ${C.text}; }
.cs-menu .it.sel { color: ${C.ink}; background: ${C.yellow}; border-left-color: ${C.orange}; padding-left: 34px; box-shadow: 6px 6px 0 rgba(0,0,0,.4); }
.cs-menu .it .val { margin-left: auto; color: ${C.cyan}; }
.cs-menu .it.sel .val { color: ${C.ink}; }
.cs-menu .it.off { opacity: .45; }

/* Bars (stats). */
.cs-stat { display: grid; grid-template-columns: 120px 1fr 64px; align-items: center; gap: 12px; font-size: 9px; margin: 10px 0; color: ${C.muted}; }
.cs-stat .bar { height: 12px; background: rgba(255,255,255,.08); transform: skewX(-20deg); overflow: hidden; }
.cs-stat .bar i { display: block; height: 100%; background: linear-gradient(90deg, ${C.orange}, ${C.yellow}); transition: width .25s; }
.cs-stat .num { color: ${C.text}; text-align: right; }
.cs-pips { display: inline-flex; gap: 4px; }
.cs-pips i { width: 10px; height: 10px; background: rgba(255,255,255,.12); transform: skewX(-20deg); }
.cs-pips i.on { background: ${C.yellow}; }

/* Arrows either side of a picker. */
.cs-arrow { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; font-size: 16px; color: ${C.ink};
  background: ${C.cyan}; transform: skewX(-12deg); cursor: pointer; box-shadow: 4px 4px 0 rgba(0,0,0,.4); }
.cs-arrow:active { transform: skewX(-12deg) translateY(2px); }

@media (max-width: 980px), (max-height: 620px) {
  .cs-head { top: 12px; padding-left: 18px; height: 48px; }
  .cs-head .tab { padding: 10px 18px; } .cs-head .tab h1 { font-size: 14px; }
  .cs-menu .it { font-size: 11px; padding: 11px 16px; }
}
`;

export function screenEl(cls: string, bg: 'none' | 'dim' | 'solid' = 'dim') {
  addStyle('cs-scr-css', CSS);
  const el = document.createElement('div');
  el.className = `cs-scr ${cls}${bg === 'none' ? '' : ` ${bg}`}`;
  return el;
}

/** The header tab: a title and an optional "STEP 1 / 3". */
export function header(title: string, step?: string) {
  return `<div class="cs-head"><div class="tab"><h1>${title}</h1></div>${step ? `<div class="step"><span>${step}</span></div>` : ''}<div class="stripes"></div></div>`;
}

const tri = (pts: string) => `<svg class="cs-ar" viewBox="0 0 8 8"><polygon points="${pts}"/></svg>`;
const ARROWS: Record<string, string> = {
  '&uarr;': tri('4,1 7,6 1,6'),
  '&darr;': tri('1,2 7,2 4,7'),
  '&larr;': tri('1,4 6,1 6,7'),
  '&rarr;': tri('2,1 7,4 2,7'),
};
/** Arrow entities (the pixel font has no arrows) → small inline triangles. */
export const arrows = (s: string) => s.replace(/&[udlr]arr;/g, (m) => ARROWS[m] ?? m);

/** The key-hint bar: [[key, what], …]. */
export function keys(list: [string, string][]) {
  // ESC and ENTER hints are buttons too (touch screens): the flow turns a tap on [data-menu] into that menu key.
  const menu = (k: string) => (/^ESC/.test(k) ? ' data-menu="back"' : /^ENTER$/.test(k) ? ' data-menu="confirm"' : '');
  return `<div class="cs-keys">${list.map(([k, w]) => `<span${menu(k)}><b>${arrows(k)}</b>${w}</span>`).join('')}</div>`;
}

export function statBar(label: string, frac: number, num: string) {
  return `<div class="cs-stat"><span>${label}</span><span class="bar"><i style="width:${Math.round(Math.max(0.04, Math.min(1, frac)) * 100)}%"></i></span><span class="num">${num}</span></div>`;
}

export function pips(n: number, max = 5) {
  return `<span class="cs-pips">${Array.from({ length: max }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
}

/**
 * Clicks on [data-act] elements become menu events: `data-act="pick:3"` → { tap: 'pick:3' } handled by the screen.
 * Returns the remover.
 */
export function onTap(el: HTMLElement, fn: (act: string) => void) {
  const h = (e: Event) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (t && el.contains(t)) fn(t.dataset.act!);
  };
  el.addEventListener('click', h);
  return () => el.removeEventListener('click', h);
}
