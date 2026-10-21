// The race HUD (DOM over the canvas): time and penalties top left, checkpoints (and the rival) top right, the
// speedometer, gear and rev bar bottom right, centre messages (countdown, WRONG WAY, penalty, checkpoint, jump).
import { addStyle, esc, fmtTime, PIXEL_FONT } from './pixel';
import { C } from './screens/common';
import type { RaceSnapshot } from '../game/types';

const CSS = `
.cs-hud { position: fixed; inset: 0; z-index: 10; pointer-events: none; font-family: ${PIXEL_FONT}; color: ${C.text}; text-shadow: 2px 2px 0 rgba(0,0,0,.7); }
.cs-hud .box { position: absolute; background: rgba(10,13,28,.72); border-radius: 4px; }
.cs-hud .time { left: 28px; top: 24px; padding: 14px 20px 16px; border-left: 5px solid ${C.orange}; }
.cs-hud .time .k { font-size: 8px; color: ${C.muted}; letter-spacing: 2px; }
.cs-hud .time .v { margin-top: 10px; font-size: 28px; letter-spacing: 1px; }
.cs-hud .time .pen { margin-top: 10px; font-size: 9px; color: ${C.pink}; display: none; }
.cs-hud .time .pen.on { display: block; }
.cs-hud .prog { right: 28px; top: 24px; padding: 14px 18px; width: 300px; }
.cs-hud .prog .k { display: flex; justify-content: space-between; font-size: 8px; color: ${C.muted}; letter-spacing: 1px; }
.cs-hud .prog .k b { font-weight: normal; color: ${C.text}; }
.cs-hud .prog .cps { display: flex; gap: 4px; margin: 10px 0 4px; }
.cs-hud .prog .cps i { flex: 1; height: 10px; background: rgba(255,255,255,.12); transform: skewX(-20deg); }
.cs-hud .prog .cps i.on { background: ${C.yellow}; }
.cs-hud .prog .track { position: relative; height: 6px; margin-top: 14px; background: rgba(255,255,255,.1); }
.cs-hud .prog .track .me, .cs-hud .prog .track .op { position: absolute; top: -5px; width: 8px; height: 16px; margin-left: -4px; }
.cs-hud .prog .track .me { background: ${C.yellow}; } .cs-hud .prog .track .op { background: ${C.pink}; }
.cs-hud .prog .rv { display: none; margin-top: 12px; font-size: 8px; color: ${C.pink}; }
.cs-hud .prog.vs .rv { display: flex; justify-content: space-between; }
.cs-hud .speedo { right: 28px; bottom: 28px; width: 260px; padding: 16px 20px 18px; }
.cs-hud .speedo .row { display: flex; align-items: flex-end; justify-content: space-between; }
.cs-hud .speedo .mph { font-size: 48px; line-height: 1; letter-spacing: -2px; }
.cs-hud .speedo .unit { font-size: 9px; color: ${C.muted}; margin: 0 0 4px 8px; }
.cs-hud .speedo .gear { width: 58px; height: 58px; display: flex; align-items: center; justify-content: center; font-size: 26px; color: ${C.ink};
  background: ${C.cyan}; transform: skewX(-10deg); text-shadow: none; }
.cs-hud .speedo .gear.r { background: ${C.pink}; color: #fff; }
.cs-hud .speedo .revs { display: flex; gap: 3px; margin-top: 14px; }
.cs-hud .speedo .revs i { flex: 1; height: 12px; background: rgba(255,255,255,.1); }
.cs-hud .speedo .revs i.on { background: ${C.green}; } .cs-hud .speedo .revs i.on.hi { background: ${C.yellow}; } .cs-hud .speedo .revs i.on.red { background: ${C.orange}; }
.cs-hud .speedo .box2 { display: flex; justify-content: space-between; margin-top: 10px; font-size: 7px; color: ${C.muted}; }
.cs-hud .cam { left: 28px; bottom: 28px; padding: 10px 14px; font-size: 8px; color: ${C.muted}; line-height: 2; }
.cs-hud .cam b { color: ${C.text}; font-weight: normal; }
.cs-hud .msg { position: absolute; left: 0; right: 0; top: 30%; text-align: center; }
.cs-hud .msg div { display: inline-block; padding: 16px 30px; font-size: 24px; letter-spacing: 3px; transform: skewX(-12deg); }
.cs-hud .msg .ev { background: ${C.yellow}; color: ${C.ink}; text-shadow: none; box-shadow: 6px 6px 0 rgba(0,0,0,.4); animation: cs-hud-pop .25s both; }
.cs-hud .msg .ev.pen { background: ${C.pink}; color: #fff; }
.cs-hud .msg .ww { background: #d01f2a; color: #fff; animation: cs-blink .7s steps(2) infinite; }
.cs-hud .count { position: absolute; left: 0; right: 0; top: 34%; text-align: center; font-size: 120px; color: ${C.yellow};
  text-shadow: 6px 6px 0 ${C.orange}, 12px 12px 0 rgba(0,0,0,.5); animation: cs-hud-pop .3s both; }
.cs-hud .count.go { color: ${C.green}; text-shadow: 6px 6px 0 #1a7a3c, 12px 12px 0 rgba(0,0,0,.5); }
@keyframes cs-hud-pop { from { transform: scale(1.6); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes cs-blink { 50% { opacity: 0; } }
@media (max-width: 1080px) { .cs-hud.replay .speedo { bottom: 124px; } }
@media (max-width: 600px) { .cs-hud.replay .speedo { bottom: 172px; } }
@media (max-width: 980px), (max-height: 620px) { .cs-hud .time .v { font-size: 18px; } .cs-hud .speedo { width: 190px; } .cs-hud .speedo .mph { font-size: 30px; }
  .cs-hud .prog { width: 220px; } .cs-hud .count { font-size: 70px; } }
/* Phones (portrait): the time and progress boxes side by side within the width, no camera hint (touch controls). */
@media (max-width: 600px) { .cs-hud .time { left: 10px; top: 10px; padding: 10px 12px 12px; } .cs-hud .time .v { font-size: 15px; margin-top: 8px; }
  .cs-hud .prog { right: 10px; top: 10px; width: calc(50vw - 20px); padding: 10px 12px; } .cs-hud .prog .k { font-size: 7px; }
  .cs-hud .speedo { right: 10px; bottom: 10px; width: 170px; padding: 10px 12px 12px; } .cs-hud .speedo .mph { font-size: 24px; }
  .cs-hud .speedo .gear { width: 40px; height: 40px; font-size: 18px; } .cs-hud .cam { display: none; } .cs-hud .count { font-size: 56px; }
  .cs-hud .msg div { font-size: 14px; padding: 12px 18px; } }
`;

export class RaceHud {
  readonly el = document.createElement('div');
  private msgT = 0;
  private lastCount = '';
  private revs: HTMLElement[] = [];
  private q = <T extends HTMLElement>(s: string) => this.el.querySelector<T>(s)!;

  constructor(opts: { versus: string | null; gears: number }) {
    addStyle('cs-hud-css', CSS);
    this.el.className = 'cs-hud';
    this.el.innerHTML = `
      <div class="box time"><div class="k">TIME</div><div class="v">0:00.00</div><div class="pen"></div></div>
      <div class="box prog${opts.versus ? ' vs' : ''}"><div class="k"><span>CHECKPOINT</span><b class="cpn">0 / 0</b></div><div class="cps"></div>
        <div class="track"><span class="me"></span>${opts.versus ? '<span class="op"></span>' : ''}</div>
        <div class="rv"><span>${opts.versus ? esc(opts.versus) : ''}</span><span class="gap"></span></div></div>
      <div class="box speedo"><div class="row"><div><span class="mph">0</span><span class="unit">MPH</span></div><div class="gear">1</div></div>
        <div class="revs">${'<i></i>'.repeat(16)}</div><div class="box2"><span class="gb"></span><span>REVS</span></div></div>
      <div class="box cam"><b class="cn">CHASE CAM</b><br>C CAMERA &middot; ESC PAUSE</div>
      <div class="msg"></div><div class="countw"></div>`;
    this.revs = [...this.el.querySelectorAll<HTMLElement>('.revs i')];
    this.revs.forEach((r, i) => {
      if (i >= 11) r.classList.add('hi');
      if (i >= 14) r.classList.add('red');
    });
    document.body.appendChild(this.el);
  }

  setGearbox(label: string) {
    this.q('.gb').textContent = label;
  }

  setCamera(name: string) {
    this.q('.cn').textContent = `${name.toUpperCase()} CAM`;
    // The in-car view has its own instruments (render/dashboard.ts: speed, revs and gear), so the speed panel goes.
    this.q('.speedo').style.display = name === 'cockpit' ? 'none' : '';
  }

  /** Countdown: '3', '2', '1', 'GO!' or '' (hidden). */
  countdown(text: string) {
    if (text === this.lastCount) return;
    this.lastCount = text;
    this.q('.countw').innerHTML = text ? `<div class="count${text.startsWith('GO') ? ' go' : ''}">${text}</div>` : '';
  }

  /** A centre message for a moment. */
  flash(text: string, seconds = 1.4) {
    this.msgT = seconds;
    this.q('.msg').innerHTML = `<div class="ev${text.startsWith('PENALTY') ? ' pen' : ''}">${esc(text)}</div>`;
  }

  /** Draw a snapshot (one-off events go through flash(), once per simulation step). DOM writes only on change. */
  update(s: RaceSnapshot, dt: number) {
    this.set('time', this.q('.time .v'), fmtTime(s.time));
    const pen = this.q('.time .pen');
    pen.classList.toggle('on', s.penaltySeconds > 0);
    this.set('pen', pen, `PENALTY +${s.penaltySeconds} S`);
    const p = s.progress;
    this.set('cpn', this.q('.cpn'), `${p.checkpoint} / ${p.checkpoints}`);
    const cps = this.q('.cps');
    if (cps.childElementCount !== p.checkpoints) cps.innerHTML = '<i></i>'.repeat(p.checkpoints);
    if (this.cache.get('cp') !== String(p.checkpoint)) {
      this.cache.set('cp', String(p.checkpoint));
      [...cps.children].forEach((c, i) => c.classList.toggle('on', i < p.checkpoint));
    }
    this.setStyle('me', this.q('.track .me'), `${(p.fraction * 100).toFixed(2)}%`);
    if (s.opponentProgress) {
      const op = this.el.querySelector<HTMLElement>('.track .op');
      if (op) this.setStyle('op', op, `${(s.opponentProgress.fraction * 100).toFixed(2)}%`);
      const d = (p.fraction - s.opponentProgress.fraction) * 100;
      this.set('gap', this.q('.gap'), s.opponentFinished ? 'FINISHED' : d >= 0 ? 'BEHIND YOU' : 'AHEAD');
    }
    const car = s.player;
    this.set('mph', this.q('.mph'), String(Math.round(car.speedMph)));
    const g = this.q('.gear');
    this.set('gear', g, car.gear < 0 ? 'R' : car.gear === 0 ? 'N' : String(car.gear));
    g.classList.toggle('r', car.gear < 0);
    const lit = Math.round(car.rpm * this.revs.length);
    if (this.cache.get('lit') !== String(lit)) {
      this.cache.set('lit', String(lit));
      this.revs.forEach((r, i) => r.classList.toggle('on', i < lit));
    }
    if (this.msgT > 0) {
      this.msgT -= dt;
      if (this.msgT <= 0) this.q('.msg').innerHTML = '';
    }
    if (s.wrongWay && this.msgT <= 0) {
      if (!this.q('.msg').firstElementChild?.classList.contains('ww')) this.q('.msg').innerHTML = '<div class="ww">WRONG WAY</div>';
    } else if (!s.wrongWay && this.msgT <= 0 && this.q('.msg').firstElementChild?.classList.contains('ww')) this.q('.msg').innerHTML = '';
  }

  private cache = new Map<string, string>();
  private set(key: string, el: HTMLElement, text: string) {
    if (this.cache.get(key) === text) return;
    this.cache.set(key, text);
    el.textContent = text;
  }
  private setStyle(key: string, el: HTMLElement, left: string) {
    if (this.cache.get(key) === left) return;
    this.cache.set(key, left);
    el.style.left = left;
  }

  show(on: boolean) {
    this.el.style.display = on ? '' : 'none';
  }

  dispose() {
    this.el.remove();
  }
}
