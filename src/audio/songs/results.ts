// Results theme, "Victory Lap": C major, 112 bpm. A proud bell lead with brass stabs over root-fifth bass and pad,
// eight bars, looping.
import type { Song } from '../sequencer';
import { bass, bellLead, brass, pad } from './patches';
import { bars, chord, rf8 } from './util';

const BEAT = 'k - h - s - h - k - h k s - h -';
const ROOTS: [string, 'maj' | 'min'][] = [
  ['C4', 'maj'],
  ['A3', 'min'],
  ['F3', 'maj'],
  ['G3', 'maj'],
  ['F3', 'maj'],
  ['G3', 'maj'],
  ['C4', 'maj'],
  ['C4', 'maj'],
];

export const results: Song = {
  title: 'Victory Lap',
  bpm: 112,
  stepsPerBeat: 4,
  loop: true,
  channels: {
    lead: { patch: bellLead, pan: 0.1 },
    stab: { patch: brass, pan: -0.25, gain: 0.8 },
    bass: { patch: bass },
    pad: { patch: pad, pan: 0.3 },
    drums: { patch: 'drums', gain: 0.7 },
  },
  patterns: {
    A: {
      lead: bars('G4:4 C5:4 E5:4 G5:4', 'A5:6 G5:2 E5:4 C5:4', 'F5:4 A5:4 C6:6 A5:2', 'G5:8 D5:4 B4:4', 'A5:4 G5:2 F5:2 C5:4 F5:4', 'B5:4 A5:2 G5:2 D5:4 G5:4', 'C6:4 G5:4 E5:4 G5:4', 'C6:12 -:4'),
      stab: bars(...ROOTS.map(([r, q]) => chord(r, q)).map((c) => `${c}:3 ${c}:3 ${c}:2 -:8`)),
      bass: bars(...ROOTS.map(([r]) => rf8(r.replace(/\d$/, (o) => String(Number(o) - 2))))),
      pad: bars(...ROOTS.map(([r, q]) => `${chord(r, q)}:16`)),
      drums: bars(BEAT.replace('k', 'kc'), BEAT, BEAT, BEAT, BEAT, BEAT, BEAT, 'k - s - s - s - m m m m t t t t'),
    },
  },
  order: ['A'],
};
