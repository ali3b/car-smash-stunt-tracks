// A tiny tracker-style sequencer. A song is an order list of patterns; a pattern holds one token string per channel.
// Tokens, one per step (space separated, `|` ignored as a bar marker):
//   C4  F#3  Bb2       a note (sharps or flats, octave 4 = middle C's octave)
//   A3+C#4+E4          a chord
//   .                  hold the previous note one more step
//   -                  rest (ends the previous note)
//   X:n                shorthand for X followed by n-1 holds (`-:4` = four steps of rest)
//   X!                 accent (louder)
//   drum channels: letters k s h o c t m x (combine: `kh`, `sc`), `.`/`-` = nothing
// A channel shorter than its pattern repeats (a one-bar drum loop under a four-bar tune). Lengths must be whole bars.
import { drum, midiToHz, playNote, type Patch } from './fm';

export interface Channel {
  patch: Patch | 'drums';
  gain?: number;
  pan?: number;
  /** Semitones added to every note. */
  transpose?: number;
}

export interface Song {
  title: string;
  bpm: number;
  /** Steps per beat: 4 = 16ths, 2 = 8ths. */
  stepsPerBeat: number;
  /** Delay of every odd step as a fraction of a step (0.33 ≈ triplet shuffle). */
  swing?: number;
  loop: boolean;
  /** Beats per bar (default 4). */
  beatsPerBar?: number;
  channels: Record<string, Channel>;
  patterns: Record<string, Record<string, string>>;
  order: string[];
}

interface Ev {
  ch: string;
  notes?: number[];
  drums?: string;
  steps: number;
  vel: number;
}

export interface CompiledSong {
  song: Song;
  total: number;
  stepDur: number;
  byStep: Ev[][];
}

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function noteToMidi(n: string) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(n);
  if (!m) throw new Error(`bad note "${n}"`);
  return 12 * (Number(m[3]) + 1) + PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
export const midiToNote = (m: number) => `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;

/** Expand `X:n` shorthands into a flat token list. */
export function tokens(s: string) {
  const out: string[] = [];
  for (const raw of s.split(/\s+/)) {
    if (!raw || raw === '|') continue;
    const m = /^(.+):(\d+)$/.exec(raw);
    if (!m) {
      out.push(raw);
      continue;
    }
    const n = Number(m[2]);
    if (n < 1) throw new Error(`bad length in "${raw}"`);
    out.push(m[1]);
    for (let i = 1; i < n; i++) out.push(m[1] === '-' ? '-' : '.');
  }
  return out;
}

const cache = new WeakMap<Song, CompiledSong>();

export function compile(song: Song): CompiledSong {
  const hit = cache.get(song);
  if (hit) return hit;
  const bar = song.stepsPerBeat * (song.beatsPerBar ?? 4);
  const byStep: Ev[][] = [];
  let offset = 0;
  for (const name of song.order) {
    const pat = song.patterns[name];
    if (!pat) throw new Error(`${song.title}: no pattern "${name}"`);
    const chans = Object.entries(pat).map(([ch, s]) => {
      if (!song.channels[ch]) throw new Error(`${song.title}/${name}: no channel "${ch}"`);
      return [ch, tokens(s)] as const;
    });
    const len = Math.max(...chans.map(([, t]) => t.length));
    for (const [ch, t] of chans) {
      if (t.length % bar !== 0 || len % t.length !== 0) throw new Error(`${song.title}/${name}/${ch}: ${t.length} steps (bar = ${bar}, pattern = ${len})`);
      const isDrums = song.channels[ch].patch === 'drums';
      const tr = song.channels[ch].transpose ?? 0;
      for (let i = 0; i < len; i++) {
        const tok = t[i % t.length];
        if (tok === '.' || tok === '-') continue;
        const accent = tok.endsWith('!');
        const body = accent ? tok.slice(0, -1) : tok;
        const vel = accent ? 1 : 0.78;
        let steps = 1;
        while ((i % t.length) + steps < t.length && t[(i % t.length) + steps] === '.') steps++;
        const ev: Ev = isDrums ? { ch, drums: body, steps, vel } : { ch, notes: body.split('+').map((n) => noteToMidi(n) + tr), steps, vel };
        (byStep[offset + i] ??= []).push(ev);
      }
    }
    offset += len;
  }
  for (let i = 0; i < offset; i++) byStep[i] ??= [];
  const c = { song, total: offset, stepDur: 60 / song.bpm / song.stepsPerBeat, byStep };
  cache.set(song, c);
  return c;
}

/** Per-channel gain + pan nodes feeding `out`. */
export function buildChannels(ctx: BaseAudioContext, out: AudioNode, song: Song) {
  const map = new Map<string, AudioNode>();
  for (const [name, ch] of Object.entries(song.channels)) {
    const g = ctx.createGain();
    g.gain.value = ch.gain ?? 1;
    const p = ctx.createStereoPanner();
    p.pan.value = ch.pan ?? 0;
    g.connect(p).connect(out);
    map.set(name, g);
  }
  return map;
}

/** Schedule everything that starts on absolute step `i` (loops wrap) at time `t`. */
export function scheduleStep(ctx: BaseAudioContext, chans: Map<string, AudioNode>, c: CompiledSong, i: number, t: number) {
  for (const ev of c.byStep[i % c.total]) {
    const ch = c.song.channels[ev.ch];
    const dest = chans.get(ev.ch)!;
    if (ch.patch === 'drums') {
      for (const k of ev.drums!) drum(ctx, dest, k, t, ev.vel);
    } else {
      const dur = ev.steps * c.stepDur * (ch.patch.gate ?? 0.9);
      for (const n of ev.notes!) playNote(ctx, dest, ch.patch, midiToHz(n), t, dur, ev.vel);
    }
  }
}

export const stepOffset = (c: CompiledSong, i: number) => i * c.stepDur + (i % 2 === 1 ? (c.song.swing ?? 0) * c.stepDur : 0);

/** Song length in seconds (one pass). */
export const songSeconds = (song: Song) => {
  const c = compile(song);
  return c.total * c.stepDur;
};

/** Schedule a whole song from `t0` up to `until` (offline renders). */
export function scheduleAll(ctx: BaseAudioContext, out: AudioNode, song: Song, t0: number, until: number) {
  const c = compile(song);
  const chans = buildChannels(ctx, out, song);
  for (let i = 0; ; i++) {
    if (!song.loop && i >= c.total) break;
    const t = t0 + stepOffset(c, i);
    if (t >= until) break;
    scheduleStep(ctx, chans, c, i, t);
  }
}

/** Live playback with a look-ahead scheduler. */
export class SongPlayer {
  readonly out: GainNode;
  private chans: Map<string, AudioNode>;
  private c: CompiledSong;
  private step = 0;
  private t0 = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  onEnd?: () => void;

  constructor(
    private ctx: AudioContext,
    dest: AudioNode,
    readonly song: Song,
  ) {
    this.c = compile(song);
    this.out = ctx.createGain();
    this.out.connect(dest);
    this.chans = buildChannels(ctx, this.out, song);
  }

  start() {
    this.t0 = this.ctx.currentTime + 0.06;
    this.step = 0;
    this.tick();
    this.timer = setInterval(() => this.tick(), 25);
  }

  private tick() {
    const horizon = this.ctx.currentTime + 0.15;
    for (;;) {
      if (!this.song.loop && this.step >= this.c.total) {
        this.clear();
        const endIn = this.t0 + this.c.total * this.c.stepDur - this.ctx.currentTime + 1;
        setTimeout(() => this.onEnd?.(), Math.max(0, endIn * 1000));
        return;
      }
      const t = this.t0 + stepOffset(this.c, this.step);
      if (t > horizon) return;
      scheduleStep(this.ctx, this.chans, this.c, this.step, t);
      this.step++;
    }
  }

  private clear() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Fade out and drop the player. */
  stop(fade = 0.25) {
    this.clear();
    const now = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setValueAtTime(this.out.gain.value, now);
    this.out.gain.linearRampToValueAtTime(0, now + fade);
    setTimeout(() => this.out.disconnect(), (fade + 2) * 1000);
  }
}
