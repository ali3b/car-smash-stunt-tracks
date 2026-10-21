// ?scene=audio: a plain DOM bench for every song, sound and voice. The car controls go through the event contract
// (getAudio().emit), so the bench also exercises ./events.ts. window.__csAudio is the check handle
// (scripts/audio-check.mjs).
import { ENGINE_PROFILES, getAudio, PROFILES, renderEngine, renderSfx, renderSong, renderTyres, SFX_NAMES, SONG_NAMES, SONGS, songSeconds, type EngineProfile, type SfxName, type Surface } from './index';
import { SURFACES } from './sfx';

const CSS = `
  body { overflow:auto !important; background:#14101f; color:#ece6ff; font:14px/1.4 system-ui, sans-serif; padding:20px 24px; margin:0; }
  h1 { font-size:20px; margin:0 0 4px; letter-spacing:.04em; }
  h2 { font-size:12px; text-transform:uppercase; letter-spacing:.14em; color:#ff9f43; margin:22px 0 8px; }
  .row { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
  button { background:#2a2140; color:#ece6ff; border:1px solid #5b4a8a; border-radius:6px; padding:7px 12px; font:inherit; cursor:pointer; }
  button:hover { background:#3a2d5a; }
  button.on { background:#ff9f43; border-color:#ffc078; color:#1a1226; }
  label { display:flex; gap:8px; align-items:center; min-width:280px; }
  label span { min-width:70px; color:#b9acd9; }
  input[type=range] { width:170px; }
  output { min-width:52px; font-variant-numeric:tabular-nums; color:#b9acd9; }
  .note { color:#9c90bd; font-size:12px; }
  #status { margin-top:6px; color:#9c90bd; font-variant-numeric:tabular-nums; }
  #meter { height:6px; background:#ff9f43; width:0; transition:width .08s; border-radius:3px; margin-top:6px; }
`;

const SFX_DEMO: Partial<Record<SfxName, { label: string; opts?: Record<string, unknown> }[]>> = {
  bump: [{ label: 'bump soft', opts: { strength: 0.2 } }, { label: 'bump hard', opts: { strength: 0.9 } }],
  land: [{ label: 'land soft', opts: { strength: 0.25 } }, { label: 'land hard', opts: { strength: 1 } }],
  wallHit: [{ label: 'wall hit', opts: { strength: 0.8 } }],
  shift: [{ label: 'shift up', opts: { up: true } }, { label: 'shift down', opts: { up: false } }],
  beep: [{ label: 'beep', opts: { n: 3 } }],
};

export function startAudioBench(root: HTMLElement) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  document.title = 'Car Smash Stunt Tracks: audio bench';
  const audio = getAudio();

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & Record<string, unknown> = {}, parent: HTMLElement = root): HTMLElementTagNameMap[K] => {
    const n = Object.assign(document.createElement(tag), props);
    parent.appendChild(n);
    return n;
  };
  const section = (title: string) => {
    el('h2', { textContent: title });
    return el('div', { className: 'row' });
  };
  const slider = (parent: HTMLElement, label: string, min: number, max: number, step: number, value: number, on: (v: number) => void, key?: string) => {
    const l = el('label', {}, parent);
    el('span', { textContent: label }, l);
    const i = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) }, l);
    const o = el('output', { textContent: String(value) }, l);
    if (key) i.dataset.key = key;
    i.oninput = () => {
      o.textContent = i.value;
      on(Number(i.value));
    };
    return i;
  };

  el('h1', { textContent: 'Car Smash Stunt Tracks: audio bench' });
  el('div', { className: 'note', textContent: 'Click anywhere or press a key to start audio. M mutes. Everything is synthesised: FM tones, filtered noise, our own music.' });
  const status = el('div', { id: 'status' });
  const meter = el('div', { id: 'meter' });
  const refresh = () => {
    status.textContent = `context: ${audio.ctx?.state ?? 'locked (click)'} · song: ${audio.currentSong ?? 'none'} · ${audio.settings.muted ? 'MUTED' : 'sound on'} · level ${audio.level().toFixed(3)}`;
    meter.style.width = `${Math.min(100, audio.level() * 400)}%`;
  };
  setInterval(refresh, 100);
  audio.onChange(refresh);

  // ---- music
  const songs = section('Music');
  for (const name of SONG_NAMES) {
    const s = SONGS[name];
    el('button', { textContent: `${name}: ${s.title}`, title: `${s.bpm} bpm, ${songSeconds(s).toFixed(1)} s loop`, onclick: () => audio.music(name) }, songs).dataset.song = name;
  }
  el('button', { textContent: 'stop', onclick: () => audio.music(null) }, songs).dataset.stop = '';

  // ---- one-shots
  const fx = section('Sound effects');
  for (const name of SFX_NAMES) {
    for (const d of SFX_DEMO[name] ?? [{ label: name }]) el('button', { textContent: d.label, onclick: () => audio.sfx(name, d.opts ?? { strength: 0.8 }) }, fx).dataset.sfx = name;
  }

  // ---- events
  const ev = section('Events (the contract in events.ts)');
  const evButtons: [string, () => void][] = [
    ['countdown 3-2-1-GO', () => [3, 2, 1, 0].forEach((n, i) => setTimeout(() => audio.emit('countdown', { n }), i * 800))],
    ['impact bump', () => audio.emit('impact', { kind: 'bump', strength: 0.5 })],
    ['impact land', () => audio.emit('impact', { kind: 'land', strength: 0.9 })],
    ['impact wall', () => audio.emit('impact', { kind: 'wall', strength: 0.7, x: -0.5 })],
    ['impact car', () => audio.emit('impact', { kind: 'car', strength: 0.7, x: 0.5 })],
    ['crash', () => audio.emit('crash', { strength: 1 })],
    ['checkpoint', () => audio.emit('checkpoint', {})],
    ['finish 1st', () => audio.emit('finish', { car: 0, place: 1 })],
    ['finish 2nd', () => audio.emit('finish', { car: 0, place: 2 })],
    ['ui click', () => audio.emit('ui', { kind: 'click' })],
    ['ui select', () => audio.emit('ui', { kind: 'select' })],
  ];
  for (const [label, f] of evButtons) el('button', { textContent: label, onclick: f }, ev).dataset.event = label;
  const sc = section('Scenes (music per screen; race music waits for GO)');
  for (const name of ['menu', 'race', 'replay', 'results', 'editor', 'silence'] as const) el('button', { textContent: `scene ${name}`, onclick: () => audio.emit('scene', { name }) }, sc).dataset.scene = name;

  // ---- the car
  const car = section('Car (emit("car", …) every 50 ms while running)');
  const state = { profile: 'v8' as EngineProfile, rpm: 900, throttle: 0, load: 0, gear: 1, speed: 0, slip: 0, slipRear: 0, surface: 'paved' as Surface, scrape: 0, x: 0, grounded: true, opponents: false, auto: false };
  const profiles = el('div', { className: 'row' }, car);
  const profileBtns = ENGINE_PROFILES.map((p) => {
    const b = el('button', { textContent: PROFILES[p].label, className: p === state.profile ? 'on' : '' }, profiles);
    b.dataset.profile = p;
    b.onclick = () => {
      state.profile = p;
      profileBtns.forEach((x) => (x.className = x.dataset.profile === p ? 'on' : ''));
      rpmSlider.min = String(PROFILES[p].idle);
      rpmSlider.max = String(PROFILES[p].redline);
      rpmSlider.value = String(PROFILES[p].idle);
      rpmSlider.dispatchEvent(new Event('input'));
    };
    return b;
  });
  const sliders = el('div', { className: 'row' }, car);
  const rpmSlider = slider(sliders, 'rpm', PROFILES.v8.idle, PROFILES.v8.redline, 10, state.rpm, (v) => (state.rpm = v), 'rpm');
  slider(sliders, 'throttle', 0, 1, 0.01, 0, (v) => (state.throttle = v), 'throttle');
  slider(sliders, 'load', 0, 1, 0.01, 0, (v) => (state.load = v), 'load');
  slider(sliders, 'gear', 1, 6, 1, 1, (v) => (state.gear = v), 'gear');
  slider(sliders, 'speed m/s', 0, 90, 0.5, 0, (v) => (state.speed = v), 'speed');
  slider(sliders, 'slip front', 0, 1, 0.01, 0, (v) => (state.slip = v), 'slip');
  slider(sliders, 'slip rear', 0, 1, 0.01, 0, (v) => (state.slipRear = v), 'slipRear');
  slider(sliders, 'scrape', 0, 1, 0.01, 0, (v) => (state.scrape = v), 'scrape');
  slider(sliders, 'pan x', -1, 1, 0.01, 0, (v) => (state.x = v), 'x');
  const surf = el('div', { className: 'row' }, car);
  const surfBtns = SURFACES.map((s) => {
    const b = el('button', { textContent: s, className: s === state.surface ? 'on' : '' }, surf);
    b.dataset.surface = s;
    b.onclick = () => {
      state.surface = s;
      surfBtns.forEach((x) => (x.className = x.dataset.surface === s ? 'on' : ''));
    };
    return b;
  });
  const toggles = el('div', { className: 'row' }, car);
  let running = false;
  const toggle = (id: string, label: string, get: () => boolean, set: (v: boolean) => void) => {
    const b = el('button', { id, textContent: label }, toggles);
    b.onclick = () => {
      set(!get());
      b.className = get() ? 'on' : '';
    };
    b.className = get() ? 'on' : '';
  };
  toggle('run', 'car running', () => running, (v) => (running = v));
  toggle('grounded', 'grounded', () => state.grounded, (v) => (state.grounded = v));
  toggle('opponents', '+3 opponents', () => state.opponents, (v) => (state.opponents = v));
  toggle('auto', 'auto drive (accelerate, shift, lift)', () => state.auto, (v) => (state.auto = v));
  let paused = false;
  toggle('pause', 'paused', () => paused, (v) => audio.emit('pause', { paused: (paused = v) }));

  // Auto drive: a simple gearbox model so the engine can be heard pulling through the gears.
  let autoT = 0;
  const tick = () => {
    if (!running) return;
    const prof = PROFILES[state.profile];
    if (state.auto) {
      autoT += 0.05;
      const phase = autoT % 12;
      const accel = phase < 9;
      state.throttle = accel ? 1 : 0;
      state.load = accel ? 0.8 : 0;
      const top = 85;
      state.speed = accel ? Math.min(top, state.speed + 9 * 0.05 * (1 - state.speed / top / 1.1)) : Math.max(0, state.speed - 14 * 0.05);
      const gearTop = [0, 14, 26, 40, 56, 72, 90];
      let g = 1;
      while (g < 6 && state.speed > gearTop[g]) g++;
      state.gear = g;
      const lo = g === 1 ? 0 : gearTop[g - 1] * 0.7;
      const r = Math.min(1, Math.max(0, (state.speed - lo) / (gearTop[g] - lo)));
      state.rpm = prof.idle + (prof.redline - prof.idle) * (accel ? 0.15 + 0.85 * r : 0.05 + 0.9 * r);
    }
    audio.emit('car', {
      car: 0,
      player: true,
      profile: state.profile,
      rpm: state.rpm,
      throttle: state.throttle,
      load: state.load,
      gear: state.gear,
      speed: state.speed,
      slip: [state.slip, state.slip, state.slipRear, state.slipRear],
      surface: state.surface,
      grounded: state.grounded,
      scrape: state.scrape,
      x: state.x,
    });
    if (state.opponents) {
      ENGINE_PROFILES.slice(1).forEach((p, i) => {
        const pd = PROFILES[p];
        const w = 0.55 + 0.35 * Math.sin(performance.now() / (900 + i * 310));
        audio.emit('car', { car: i + 1, profile: p, rpm: pd.idle + (pd.redline - pd.idle) * w, throttle: 0.8, speed: 30, x: (i - 1) * 0.7, level: 0.35 });
      });
    }
  };
  setInterval(tick, 50);

  // ---- volume
  const vol = section('Volume (saved in localStorage cs.audio)');
  for (const k of ['master', 'music', 'sfx'] as const) slider(vol, k, 0, 1, 0.01, audio.settings[k], (v) => audio.setVolume(k, v), `vol-${k}`);
  el('button', { textContent: 'mute (M)', onclick: () => audio.toggleMute() }, vol);

  window.__csAudio = { audio, state, songs: SONG_NAMES, sfx: [...SFX_NAMES], profiles: ENGINE_PROFILES, surfaces: SURFACES, renderSong, renderSfx, renderEngine, renderTyres };
  refresh();
}

declare global {
  interface Window {
    __csAudio: Record<string, unknown>;
  }
}
