// The replay controls: a tape-deck bar at the bottom (to start, rewind, play / pause, fast forward, to end, camera,
// exit) with a scrubbable timeline. It drives a ReplayPlayer (src/game/types.ts); the flow draws the race behind it.
import { addStyle, fmtTime } from '../pixel';
import type { MenuEvent } from '../../engine/input';
import { C, onTap, screenEl, type Screen } from './common';
import { SIM_HZ, type CameraMode, type ReplayPlayer } from '../../game/types';

const CSS = `
.cs-vcr { top: auto; height: 150px; pointer-events: none; }
.cs-vcr .tag { position: fixed; left: 50%; top: 24px; margin-left: -70px; padding: 10px 16px; font-size: 12px; color: #fff; background: #d01f2a; letter-spacing: 2px;
  transform: skewX(-12deg); }
.cs-vcr .tag span { display: inline-block; transform: skewX(12deg); }
.cs-vcr .tag i { display: inline-block; width: 10px; height: 10px; margin-right: 10px; border-radius: 50%; background: #fff; animation: cs-blink 1s steps(2) infinite; }
.cs-vcr .deck { position: absolute; left: 28px; bottom: 28px; width: 700px; padding: 14px 18px 16px; pointer-events: auto; }
.cs-vcr .tl { position: relative; height: 10px; background: rgba(255,255,255,.1); cursor: pointer; }
.cs-vcr .tl i { position: absolute; left: 0; top: 0; bottom: 0; background: linear-gradient(90deg, ${C.orange}, ${C.yellow}); }
.cs-vcr .tl b { position: absolute; top: -5px; width: 6px; height: 20px; margin-left: -3px; background: #fff; }
.cs-vcr .row { display: flex; align-items: center; gap: 8px; margin-top: 14px; }
.cs-vcr .btn { width: 46px; height: 38px; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,.08); cursor: pointer;
  transform: skewX(-10deg); }
.cs-vcr .btn svg { width: 18px; height: 18px; fill: ${C.text}; transform: skewX(10deg); }
.cs-vcr .btn.on { background: ${C.yellow}; } .cs-vcr .btn.on svg { fill: ${C.ink}; }
.cs-vcr .btn.play { width: 62px; background: ${C.cyan}; } .cs-vcr .btn.play svg { fill: ${C.ink}; }
.cs-vcr .btn.txt { width: auto; padding: 0 12px; font-size: 8px; color: ${C.text}; white-space: nowrap; }
.cs-vcr .btn.txt span { transform: skewX(10deg); display: inline-block; }
.cs-vcr .tm { margin-left: auto; font-size: 9px; color: ${C.muted}; white-space: nowrap; }
.cs-vcr .tm b { color: ${C.text}; font-weight: normal; }
.cs-vcr .sp { min-width: 44px; font-size: 9px; color: ${C.yellow}; text-align: center; }
/* Narrow screens: the deck spans the bottom edge (below the car, never across it); the HUD's speedometer moves up
   above it (.cs-hud.replay in race-hud.ts) and the REPLAY tag drops under the top panels. */
@media (max-width: 1080px) { .cs-vcr .deck { left: 12px; right: 12px; width: auto; bottom: 12px; padding: 10px 12px 12px; }
  .cs-vcr .row { gap: 6px; } .cs-vcr .btn { width: 40px; } .cs-vcr .btn.play { width: 52px; } }
@media (max-width: 900px) { .cs-vcr .tag { top: 120px; } }
@media (max-width: 600px) { .cs-vcr .row { flex-wrap: wrap; row-gap: 8px; } .cs-vcr .tm { margin-left: 0; width: 100%; text-align: right; } }
`;

const ICON = {
  start: '<svg viewBox="0 0 16 16"><rect x="2" y="2" width="2" height="12"/><polygon points="14,2 14,14 5,8"/></svg>',
  rew: '<svg viewBox="0 0 16 16"><polygon points="8,2 8,14 1,8"/><polygon points="15,2 15,14 8,8"/></svg>',
  play: '<svg viewBox="0 0 16 16"><polygon points="3,2 14,8 3,14"/></svg>',
  pause: '<svg viewBox="0 0 16 16"><rect x="3" y="2" width="4" height="12"/><rect x="9" y="2" width="4" height="12"/></svg>',
  ff: '<svg viewBox="0 0 16 16"><polygon points="1,2 8,8 1,14"/><polygon points="8,2 15,8 8,14"/></svg>',
  end: '<svg viewBox="0 0 16 16"><polygon points="2,2 11,8 2,14"/><rect x="12" y="2" width="2" height="12"/></svg>',
};

export interface VcrOpts {
  player: ReplayPlayer;
  camera(): CameraMode;
  nextCamera(): void;
  onExit(): void;
}

export class VcrScreen implements Screen {
  readonly el = screenEl('cs-vcr', 'none');
  private offTap: () => void;
  private key = '';

  constructor(private o: VcrOpts) {
    addStyle('cs-vcr-css', CSS);
    this.el.innerHTML = `<div class="tag"><span><i></i>REPLAY</span></div>
      <div class="deck cs-panel"><div class="tl" data-act="seek"><i></i><b></b></div><div class="row">
        <span class="btn" data-act="start">${ICON.start}</span><span class="btn rew" data-act="rew">${ICON.rew}</span>
        <span class="btn play" data-act="play"></span><span class="btn ff" data-act="ff">${ICON.ff}</span><span class="btn" data-act="end">${ICON.end}</span>
        <span class="sp"></span>
        <span class="btn txt" data-act="cam"><span class="cn"></span></span><span class="btn txt" data-act="exit"><span>EXIT</span></span>
        <span class="tm"><b class="now"></b> / <span class="len"></span></span></div></div>`;
    this.offTap = onTap(this.el, (a) => this.act(a));
    this.el.querySelector('.tl')!.addEventListener('click', (e) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const f = ((e as MouseEvent).clientX - r.left) / r.width;
      this.o.player.seek(Math.round(f * this.o.player.length));
    });
    this.tick();
  }

  /** start | rew | play | ff | end | cam | exit */
  act(a: string) {
    const p = this.o.player;
    if (a === 'start') p.seek(0);
    else if (a === 'end') p.seek(p.length);
    else if (a === 'play') {
      if (p.playing && p.speed === 1) p.pause();
      else {
        p.speed = 1;
        p.play();
      }
    } else if (a === 'rew' || a === 'ff') {
      const dir = a === 'rew' ? -1 : 1;
      // Again while already winding that way: twice as fast (4×, 8×, 16×).
      const winding = p.playing && Math.sign(p.speed) === dir && Math.abs(p.speed) >= 4;
      p.speed = dir * (winding ? Math.min(16, Math.abs(p.speed) * 2) : 4);
      if (dir < 0 ? p.tick > 0 : p.tick < p.length) p.play();
    } else if (a === 'cam') this.o.nextCamera();
    else if (a === 'exit') this.o.onExit();
    this.tick();
  }

  input(e: MenuEvent) {
    if (e.key === 'confirm') this.act('play');
    else if (e.key === 'left') this.act('rew');
    else if (e.key === 'right') this.act('ff');
    else if (e.key === 'up' || e.letter === 'C') this.act('cam');
    else if (e.key === 'down') this.act('start');
    else if (e.key === 'back') this.act('exit');
  }

  tick() {
    const p = this.o.player;
    const f = p.length ? p.tick / p.length : 0;
    (this.el.querySelector('.tl i') as HTMLElement).style.width = `${f * 100}%`;
    (this.el.querySelector('.tl b') as HTMLElement).style.left = `${f * 100}%`;
    const playingNormal = p.playing && p.speed === 1;
    const key = `${playingNormal}|${p.playing}|${p.speed}|${this.o.camera()}|${p.length}`;
    this.el.querySelector('.now')!.textContent = fmtTime(p.tick / SIM_HZ);
    if (key === this.key) return;
    this.key = key;
    this.el.querySelector('.play')!.innerHTML = playingNormal ? ICON.pause : ICON.play;
    this.el.querySelector('.rew')!.classList.toggle('on', p.playing && p.speed < 0);
    this.el.querySelector('.ff')!.classList.toggle('on', p.playing && p.speed > 1);
    this.el.querySelector('.sp')!.textContent = !p.playing ? 'PAUSE' : p.speed === 1 ? 'PLAY' : `${p.speed > 0 ? '' : '-'}${Math.abs(p.speed)}X`;
    this.el.querySelector('.cn')!.textContent = `CAM: ${this.o.camera().toUpperCase()}`;
    this.el.querySelector('.len')!.textContent = fmtTime(p.length / SIM_HZ);
  }

  dispose() {
    this.offTap();
    this.el.remove();
  }
}
