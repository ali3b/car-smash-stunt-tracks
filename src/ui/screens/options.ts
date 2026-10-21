// Options: gearbox, starting camera, the DOS look (src/engine/retro.ts), quality, the volumes (saved by the audio system,
// src/audio/settings.ts; M mutes anywhere), the controls card, clearing the scores.
import { addStyle } from '../pixel';
import type { MenuEvent } from '../../engine/input';
import { arrows, C, header, keys, onTap, screenEl, type Screen } from './common';
import { cycleDosLook, dosLabel } from '../../engine/retro';
import { clearScores, getOptions, setOptions } from '../../game/storage';
import { cycleQuality, qualityLabel } from '../../engine/quality';
import { getAudio } from '../../audio';

const CSS = `
.cs-opts .cs-menu { position: absolute; left: 48px; top: 130px; width: 520px; }
.cs-opts .ctl { position: absolute; right: 48px; top: 130px; width: 470px; padding: 24px 26px; }
.cs-opts .ctl table { width: 100%; border-collapse: collapse; font-size: 9px; }
.cs-opts .ctl td { padding: 9px 4px; border-bottom: 1px dashed rgba(255,255,255,.08); }
.cs-opts .ctl td:first-child { color: ${C.muted}; white-space: nowrap; padding-right: 14px; }
.cs-opts .ctl td b { display: inline-block; padding: 4px 6px; margin: 2px 2px; font-weight: normal; color: ${C.ink}; background: ${C.text}; border-radius: 3px; font-size: 8px; }
.cs-opts .vol { display: inline-flex; gap: 3px; margin-left: auto; }
.cs-opts .vol i { width: 8px; height: 12px; background: rgba(255,255,255,.14); transform: skewX(-20deg); }
.cs-opts .vol i.on { background: ${C.cyan}; }
.cs-opts .it.sel .vol i.on { background: ${C.ink}; }
.cs-opts .ctl .note { margin-top: 16px; font-size: 8px; line-height: 2; color: ${C.muted}; }
@media (max-width: 1180px) { .cs-opts .cs-menu { width: 400px; } .cs-opts .ctl { width: 400px; } }
@media (max-width: 980px), (max-height: 620px) { .cs-opts .cs-menu { top: 70px; left: 14px; width: 300px; } .cs-opts .ctl { display: none; } }
`;

type Item = 'gearbox' | 'camera' | 'dos' | 'quality' | Volume | 'clear' | 'back';
type Volume = 'master' | 'music' | 'sfx';
const VOLUMES: Volume[] = ['master', 'music', 'sfx'];
const isVolume = (it: Item): it is Volume => (VOLUMES as Item[]).includes(it);

const CONTROLS: [string, string[]][] = [
  ['ACCELERATE', ['&uarr;', 'W', 'PAD RT / A']],
  ['BRAKE, REVERSE', ['&darr;', 'S', 'PAD LT / X']],
  ['STEER', ['&larr; &rarr;', 'A D', 'PAD STICK']],
  ['SHIFT (MANUAL)', ['SPACE / SHIFT', '+ &uarr; UP', '+ &darr; DOWN']],
  ['CAMERA', ['C']],
  ['MUTE SOUND', ['M']],
  ['PAUSE', ['ESC', 'PAD START']],
  ['DOS LOOK', ['F2']],
];

export class OptionsScreen implements Screen {
  readonly el = screenEl('cs-opts', 'dim');
  private sel = 0;
  private items: Item[] = ['gearbox', 'camera', 'dos', 'quality', 'master', 'music', 'sfx', 'clear', 'back'];
  private confirmClear = false;
  private offTap: () => void;
  private offAudio: () => void;

  constructor(private o: { onBack(): void }) {
    addStyle('cs-opts-css', CSS);
    this.el.innerHTML = `${header('OPTIONS')}<div class="cs-menu"></div>
      <div class="ctl cs-panel"><div class="cap">CONTROLS</div><table>${CONTROLS.map(([a, ks]) => `<tr><td>${a}</td><td>${ks.map((k) => `<b>${arrows(k)}</b>`).join('')}</td></tr>`).join('')}</table>
      <div class="note">A GAMEPAD WORKS EVERYWHERE: D-PAD TO MOVE, A TO SELECT, B TO GO BACK. ON A TOUCH SCREEN: TAP THE MENUS; THE RACE SHOWS PEDALS, STEERING (OR TILT) AND PAUSE.</div></div>
      ${keys([['&uarr;&darr;', 'CHOOSE'], ['ENTER / &larr;&rarr;', 'CHANGE'], ['ESC', 'BACK']])}`;
    this.offTap = onTap(this.el, (a) => {
      const i = this.items.indexOf(a as Item);
      if (i < 0) return;
      this.sel = i;
      this.activate();
    });
    // M (mute) pressed while the options are up.
    this.offAudio = getAudio().onChange(() => this.draw());
    this.draw();
  }

  private draw() {
    const op = getOptions();
    const au = getAudio().settings;
    const vol = (v: Volume) => {
      const n = Math.round(au[v] * 10);
      if (v === 'master' && au.muted) return '<span class="val">MUTED (M)</span>';
      return `<span class="vol">${Array.from({ length: 10 }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
    };
    const label: Record<Item, string> = {
      gearbox: `<span>GEARBOX</span><span class="val">${op.gearbox === 'auto' ? 'AUTOMATIC' : 'MANUAL'}</span>`,
      camera: `<span>START CAMERA</span><span class="val">${op.camera === 'chase' ? 'CHASE' : 'IN CAR'}</span>`,
      dos: `<span>DOS LOOK</span><span class="val">${dosLabel()}</span>`,
      quality: `<span>QUALITY</span><span class="val">${qualityLabel()}</span>`,
      master: `<span>VOLUME</span>${vol('master')}`,
      music: `<span>MUSIC</span>${vol('music')}`,
      sfx: `<span>EFFECTS</span>${vol('sfx')}`,
      clear: `<span>${this.confirmClear ? 'REALLY CLEAR ALL TIMES?' : 'CLEAR HIGH SCORES'}</span><span class="val">${this.confirmClear ? 'ENTER = YES' : ''}</span>`,
      back: '<span>BACK</span>',
    };
    this.el.querySelector('.cs-menu')!.innerHTML = this.items.map((it, i) => `<div class="it${i === this.sel ? ' sel' : ''}" data-act="${it}">${label[it]}</div>`).join('');
  }

  /** Volume up (dir 1) or down (-1) a tenth; ENTER / a tap steps up and wraps round to silent. */
  private volume(v: Volume, dir: number) {
    const a = getAudio();
    if (v === 'master' && a.settings.muted) a.setMuted(false);
    let n = Math.round(a.settings[v] * 10) + dir;
    if (dir > 0 && n > 10) n = 0;
    a.setVolume(v, Math.max(0, Math.min(10, n)) / 10);
    // Hear the new level.
    a.emit('ui', { kind: 'click' });
  }

  private activate(dir = 1) {
    const it = this.items[this.sel];
    if (isVolume(it)) {
      this.confirmClear = false;
      this.volume(it, dir);
      return this.draw();
    }
    const op = getOptions();
    if (it === 'gearbox') setOptions({ gearbox: op.gearbox === 'auto' ? 'manual' : 'auto' });
    else if (it === 'camera') setOptions({ camera: op.camera === 'chase' ? 'cockpit' : 'chase' });
    else if (it === 'dos') cycleDosLook();
    else if (it === 'quality') cycleQuality();
    else if (it === 'clear') {
      if (this.confirmClear) {
        clearScores();
        this.confirmClear = false;
      } else this.confirmClear = true;
    } else return this.o.onBack();
    if (it !== 'clear') this.confirmClear = false;
    this.draw();
  }

  input(e: MenuEvent) {
    if (e.key === 'up' || e.key === 'down') {
      this.sel = (this.sel + (e.key === 'up' ? -1 : 1) + this.items.length) % this.items.length;
      this.confirmClear = false;
      this.draw();
    } else if ((e.key === 'left' || e.key === 'right') && isVolume(this.items[this.sel])) this.activate(e.key === 'left' ? -1 : 1);
    else if (e.key === 'confirm' || ((e.key === 'left' || e.key === 'right') && this.items[this.sel] !== 'clear' && this.items[this.sel] !== 'back')) this.activate();
    else if (e.key === 'back') this.o.onBack();
  }

  dispose() {
    this.offTap();
    this.offAudio();
    this.el.remove();
  }
}
