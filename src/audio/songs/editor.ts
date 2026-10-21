// Editor theme, "Blueprint": D major, 96 bpm, a light swing. Electric-piano chords, a soft lead and a light beat;
// unobtrusive while building tracks. A (4 bars with lead) → B (4 bars, chords and arpeggio only), looping.
import type { Song } from '../sequencer';
import { arp, bass, epiano, flute } from './patches';
import { arp16, bars, chord } from './util';

const BEAT = 'k - h - x - h - - k h - x - h h';
const comp = (c: string) => `${c}:6 ${c}:2 -:2 ${c}:6`;
const CHORDS = [chord('D4', 'maj7'), chord('B3', 'm7'), chord('G3', 'maj7'), chord('A3', '6')];
const BASS = bars('D2:6 D2:2 -:2 A2:6', 'B1:6 B1:2 -:2 F#2:6', 'G1:6 G1:2 -:2 D2:6', 'A1:6 A1:2 -:2 E2:6');

export const editor: Song = {
  title: 'Blueprint',
  bpm: 96,
  stepsPerBeat: 4,
  swing: 0.18,
  loop: true,
  channels: {
    lead: { patch: flute, pan: 0.15, gain: 0.8 },
    keys: { patch: epiano, pan: -0.2 },
    arp: { patch: arp, pan: 0.4, gain: 0.6 },
    bass: { patch: bass, gain: 0.8 },
    drums: { patch: 'drums', gain: 0.45 },
  },
  patterns: {
    A: {
      lead: bars('-:4 F#5:2 E5:2 C#5:4 A4:4', 'B4:3 D5:3 F#5:2 E5:8', '-:4 D5:2 B4:2 F#5:4 D5:4', 'E5:6 C#5:2 A4:8'),
      keys: bars(...CHORDS.map(comp)),
      bass: BASS,
      drums: BEAT,
    },
    B: {
      keys: bars(...CHORDS.map(comp)),
      arp: bars(arp16('D4', 'maj7'), arp16('B3', 'm7'), arp16('G3', 'maj7'), arp16('A3', '6')),
      bass: BASS,
      drums: BEAT,
    },
  },
  order: ['A', 'B'],
};
