// Race theme, "Redline Run": A minor, 150 bpm. Synth brass over a 16th FM bass, arpeggio and a driving beat.
// Intro (2) → A (4) → B (4) → A → B, looping.
import type { Song } from '../sequencer';
import { arp, bass, brass } from './patches';
import { arp16, bars, bass16 } from './util';

const BEAT = 'k - h - s - h k k - h - s - h h';
const FILL = 'k - h - s - h k s s s s m m t t';

export const race: Song = {
  title: 'Redline Run',
  bpm: 150,
  stepsPerBeat: 4,
  loop: true,
  channels: {
    lead: { patch: brass, pan: 0.05 },
    arp: { patch: arp, pan: 0.35, gain: 0.8 },
    bass: { patch: bass, gain: 0.9 },
    drums: { patch: 'drums', gain: 0.8 },
  },
  patterns: {
    intro: {
      arp: bars(arp16('A3', 'min'), arp16('E3', 'min')),
      bass: bars(bass16('A1'), bass16('E1')),
      drums: bars(BEAT, 'k - k - s - k - s s s s m m t t'),
    },
    A: {
      lead: bars('A4:2 C5:2 E5:2 A5:2 G5:2 E5:2 C5:2 E5:2', 'F5:4 E5:2 C5:2 A4:4 C5:4', 'D5:2 G5:2 B5:2 G5:2 D5:4 B4:4', 'E5:6 D5:2 B4:4 G4:4'),
      arp: bars(arp16('A3', 'min'), arp16('F3'), arp16('G3'), arp16('E3', 'min')),
      bass: bars(bass16('A1'), bass16('F1'), bass16('G1'), bass16('E1')),
      drums: bars(BEAT.replace('k', 'kc'), BEAT, BEAT, FILL),
    },
    B: {
      lead: bars('C6:3 A5:3 F5:2 A5:3 C6:3 F5:2', 'B5:3 G5:3 D5:2 G5:4 B5:4', 'C6:4 B5:2 A5:2 E5:4 C5:4', 'A5:12 -:4'),
      arp: bars(arp16('F3'), arp16('G3'), arp16('A3', 'min'), arp16('A3', 'min')),
      bass: bars(bass16('F1'), bass16('G1'), bass16('A1'), bass16('A1')),
      drums: bars(BEAT.replace('k', 'kc'), BEAT, BEAT, FILL),
    },
  },
  order: ['intro', 'A', 'B', 'A', 'B'],
};
