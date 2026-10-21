// Helpers for writing pattern strings.
import { midiToNote, noteToMidi } from '../sequencer';

export const tr = (note: string, semis: number) => midiToNote(noteToMidi(note) + semis);

const Q: Record<string, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  '7': [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  '6': [0, 4, 7, 9],
  '5': [0, 7, 12],
};
/** A chord token: chord('A3', 'maj') = 'A3+C#4+E4'. */
export const chord = (root: string, q: keyof typeof Q = 'maj') => Q[q].map((i) => tr(root, i)).join('+');

export const rep = (s: string, n: number) => Array(n).fill(s).join(' ');
export const bars = (...b: string[]) => b.join(' | ');

/** One bar of 16th arpeggio up and down a chord (its tones plus the root an octave up). */
export const arp16 = (root: string, q: keyof typeof Q = 'maj') => {
  const notes = chord(root, q).split('+');
  const up = [...notes, tr(notes[0], 12)];
  const cycle = [...up, ...up.slice(1, -1).reverse()];
  return Array.from({ length: 16 }, (_, i) => cycle[i % cycle.length]).join(' ');
};
/** One bar of octave-pumping 8th bass. */
export const oct8 = (r: string) => rep(`${r}:2 ${tr(r, 12)}:2`, 4);
/** One bar of driving 16th bass with an octave flick. */
export const bass16 = (r: string) => rep(`${r} ${r} ${tr(r, 12)} ${r}`, 4);
/** One bar of root-fifth 8ths. */
export const rf8 = (r: string) => rep(`${r}:2 ${tr(r, 7)}:2`, 4);
