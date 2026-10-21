// Everything the game keeps in localStorage: the options, the high-score table per track (7 places, best total time
// first) and the saved replays. Every read survives blocked or broken storage (falls back to defaults).
import type { Gearbox, ReplayData } from './types';

const OPTIONS_KEY = 'cs.options';
const SCORES_KEY = 'cs.scores';
const REPLAYS_KEY = 'cs.replays';
export const TABLE_SIZE = 7;
export const MAX_REPLAYS = 12;

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // Storage blocked or full: kept for this page only.
  }
}

// ---- options ----------------------------------------------------------------------------------------------------

export interface Options {
  gearbox: Gearbox;
  /** Camera the race starts in. */
  camera: 'cockpit' | 'chase';
  /** The last picks, so the menus open on them. */
  carId: string;
  paint: string | null;
  opponentId: string;
  trackId: string;
  /** Initials last typed into the high-score table. */
  initials: string;
}

const DEFAULT_OPTIONS: Options = { gearbox: 'auto', camera: 'chase', carId: 'car-rally', paint: null, opponentId: 'lena', trackId: '', initials: 'YOU' };

let options: Options = { ...DEFAULT_OPTIONS, ...read<Partial<Options>>(OPTIONS_KEY, {}) };
export const getOptions = () => options;
export function setOptions(o: Partial<Options>) {
  options = { ...options, ...o };
  write(OPTIONS_KEY, options);
}

// ---- high scores ------------------------------------------------------------------------------------------------

export interface ScoreEntry {
  initials: string;
  /** Total time (driven + penalties), seconds. */
  total: number;
  penalty: number;
  carId: string;
  /** ISO date. */
  date: string;
}

type Tables = Record<string, ScoreEntry[]>;

export function scoresFor(trackId: string): ScoreEntry[] {
  return (read<Tables>(SCORES_KEY, {})[trackId] ?? []).slice(0, TABLE_SIZE);
}

/** The place (0-based) a total would take, or -1 when it doesn't make the table. */
export function placeFor(trackId: string, total: number): number {
  const t = scoresFor(trackId);
  const i = t.findIndex((e) => total < e.total);
  if (i >= 0) return i;
  return t.length < TABLE_SIZE ? t.length : -1;
}

/** Add an entry; returns its place (or -1). */
export function addScore(trackId: string, e: ScoreEntry): number {
  const place = placeFor(trackId, e.total);
  if (place < 0) return -1;
  const all = read<Tables>(SCORES_KEY, {});
  const t = (all[trackId] ?? []).slice();
  t.splice(place, 0, e);
  all[trackId] = t.slice(0, TABLE_SIZE);
  write(SCORES_KEY, all);
  return place;
}

export function clearScores() {
  write(SCORES_KEY, {});
}

// ---- replays ----------------------------------------------------------------------------------------------------

export interface SavedReplay {
  id: string;
  date: string;
  /** What the list shows. */
  title: string;
  total: number | null;
  data: Omit<ReplayData, 'inputs'> & { inputs: string };
}

/** Base64 in chunks (spreading a long race's bytes into one call overflows the argument limit). */
const toB64 = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return btoa(s);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function listReplays(): SavedReplay[] {
  return read<SavedReplay[]>(REPLAYS_KEY, []);
}

export function saveReplay(r: ReplayData, title: string, total: number | null): SavedReplay {
  const entry: SavedReplay = { id: `${Date.now().toString(36)}`, date: new Date().toISOString(), title, total, data: { ...r, inputs: toB64(r.inputs) } };
  write(REPLAYS_KEY, [entry, ...listReplays()].slice(0, MAX_REPLAYS));
  return entry;
}

export function deleteReplay(id: string) {
  write(REPLAYS_KEY, listReplays().filter((r) => r.id !== id));
}

export function replayData(s: SavedReplay): ReplayData {
  return { ...s.data, inputs: fromB64(s.data.inputs) };
}
