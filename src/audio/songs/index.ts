// Our own music, composed for this game in the sequencer's pattern language.
import type { Song } from '../sequencer';
import { editor } from './editor';
import { menu } from './menu';
import { race } from './race';
import { results } from './results';

export const SONGS = { menu, race, results, editor } satisfies Record<string, Song>;
export type SongName = keyof typeof SONGS;
export const SONG_NAMES = Object.keys(SONGS) as SongName[];
