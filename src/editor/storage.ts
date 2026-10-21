// Where tracks come from and go: the browser's localStorage (saved tracks, the work in progress, the track handed
// to the race scene), JSON files (export / import), the bundled tracks in src/track/tracks/ and, in dev only, the
// local reference tracks in local-tracks/ (listed by the dev server, vite.config.ts; never shipped).
import type { TrackFile } from '../track/types';
import { parseTrack } from './doc';

export const SAVED_KEY = 'cs.editor.saved';
export const WORK_KEY = 'cs.editor.work';
/** The race scene reads this for ?scene=race&track=custom. */
export const CUSTOM_TRACK_KEY = 'cs.customTrack';

function read<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function savedTracks(): Record<string, TrackFile> {
  return read<Record<string, TrackFile>>(SAVED_KEY) ?? {};
}

export function saveTrack(t: TrackFile): boolean {
  const all = savedTracks();
  all[t.name] = t;
  return write(SAVED_KEY, all);
}

export function deleteSaved(name: string) {
  const all = savedTracks();
  delete all[name];
  write(SAVED_KEY, all);
}

export function loadWork(): TrackFile | null {
  const w = read<unknown>(WORK_KEY);
  if (!w) return null;
  try {
    return parseTrack(w);
  } catch {
    return null;
  }
}

export const saveWork = (t: TrackFile) => write(WORK_KEY, t);

export const setCustomTrack = (t: TrackFile) => write(CUSTOM_TRACK_KEY, t);

/** Tracks shipped with the game (src/track/tracks/*.json, when the folder has any). */
export function bundledTracks(): Record<string, TrackFile> {
  const files = import.meta.glob('../track/tracks/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
  const out: Record<string, TrackFile> = {};
  for (const [path, json] of Object.entries(files)) {
    try {
      const t = parseTrack(json);
      out[path.replace(/^.*\/|\.json$/g, '')] = t;
    } catch (e) {
      console.warn(`bundled track ${path}: ${(e as Error).message}`);
    }
  }
  return out;
}

/** Dev only: names of the local reference tracks (local-tracks/*.json). */
export async function localTrackNames(): Promise<string[]> {
  if (!import.meta.env.DEV) return [];
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}__local-tracks`);
    return r.ok ? ((await r.json()) as string[]) : [];
  } catch {
    return [];
  }
}

export async function loadLocalTrack(name: string): Promise<TrackFile> {
  if (!import.meta.env.DEV) throw new Error('local tracks are a development aid');
  const r = await fetch(`${import.meta.env.BASE_URL}local-tracks/${encodeURIComponent(name)}.json`);
  if (!r.ok) throw new Error(`no local track "${name}"`);
  return parseTrack(await r.json());
}

export function exportFile(t: TrackFile) {
  const blob = new Blob([JSON.stringify(t)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${t.name.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'track'}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function importFile(file: File): Promise<TrackFile> {
  const text = await file.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('not a JSON file');
  }
  return parseTrack(json);
}
