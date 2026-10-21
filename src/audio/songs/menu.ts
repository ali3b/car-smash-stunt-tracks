// Menu theme, "Neon Overpass": B minor, 124 bpm. Square lead over octave-pumping FM bass, a 16th arpeggio, string
// pad and a gated beat. Intro (2 bars) → A (4) → B (4) → A → B, looping.
import type { Song } from '../sequencer';
import { arp, bass, lead, pad } from './patches';
import { arp16, bars, chord, oct8 } from './util';

const BEAT = 'k - h - s - h - k - k h s - h h';
const FILL = 'k - h - s - h - k - s s m m t t';

export const menu: Song = {
  title: 'Neon Overpass',
  bpm: 124,
  stepsPerBeat: 4,
  loop: true,
  channels: {
    lead: { patch: lead, pan: 0.1 },
    arp: { patch: arp, pan: -0.35 },
    bass: { patch: bass },
    pad: { patch: pad, pan: 0.3 },
    drums: { patch: 'drums', gain: 0.75 },
  },
  patterns: {
    intro: {
      arp: bars(arp16('B3', 'min'), arp16('A3')),
      bass: bars(oct8('B1'), oct8('A1')),
      pad: bars(`${chord('B3', 'min')}:16`, `${chord('A3')}:16`),
      drums: bars('kc - - - - - - - k - - - k - - -', FILL),
    },
    A: {
      lead: bars('F#4:2 B4:2 D5:3 C#5:1 B4:2 A4:2 F#4:4', 'G4:2 B4:2 D5:2 E5:2 D5:4 B4:4', 'A4:2 D5:2 F#5:3 E5:1 D5:2 C#5:2 A4:4', 'C#5:4 E5:4 A4:6 -:2'),
      arp: bars(arp16('B3', 'min'), arp16('G3'), arp16('D4'), arp16('A3')),
      bass: bars(oct8('B1'), oct8('G1'), oct8('D2'), oct8('A1')),
      pad: bars(`${chord('B3', 'min')}:16`, `${chord('G3')}:16`, `${chord('D4')}:16`, `${chord('A3')}:16`),
      drums: bars(BEAT.replace('k', 'kc'), BEAT, BEAT, FILL),
    },
    B: {
      lead: bars('B4:3 D5:3 G5:2 F#5:4 D5:4', 'E5:3 C#5:3 A4:2 E5:4 C#5:4', 'F#5:2 E5:2 C#5:2 A4:2 C#5:4 E5:4', 'F#5:8 D5:4 B4:4'),
      arp: bars(arp16('G3'), arp16('A3'), arp16('F#3', 'min'), arp16('B3', 'min')),
      bass: bars(oct8('G1'), oct8('A1'), oct8('F#1'), oct8('B1')),
      pad: bars(`${chord('G3')}:16`, `${chord('A3')}:16`, `${chord('F#3', 'min')}:16`, `${chord('B3', 'min')}:16`),
      drums: bars(BEAT.replace('k', 'kc'), BEAT, BEAT, FILL),
    },
  },
  order: ['intro', 'A', 'B', 'A', 'B'],
};
