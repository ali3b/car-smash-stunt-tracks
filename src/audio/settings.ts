// Volumes and mute, persisted in localStorage `cs.audio`.
export interface AudioSettings {
  master: number;
  music: number;
  sfx: number;
  muted: boolean;
}

const KEY = 'cs.audio';
export const DEFAULT_SETTINGS: AudioSettings = { master: 0.8, music: 0.6, sfx: 0.9, muted: false };

export function loadSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const v = JSON.parse(raw) as Partial<AudioSettings>;
    const num = (x: unknown, d: number) => (typeof x === 'number' && x >= 0 && x <= 1 ? x : d);
    return { master: num(v.master, DEFAULT_SETTINGS.master), music: num(v.music, DEFAULT_SETTINGS.music), sfx: num(v.sfx, DEFAULT_SETTINGS.sfx), muted: v.muted === true };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: AudioSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode / blocked storage: settings just don't persist.
  }
}
