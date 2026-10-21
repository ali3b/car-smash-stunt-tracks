// The tracks that ship with the game: our own designs (src/track/designs/*.ts, built into <id>.json by
// scripts/build-tracks.ts), plus test-oval.json (a plain loop for checks, listed last). `?scene=track&track=<id>`
// shows one; the game's track select lists TRACKS in order.
import type { Scenery, TrackFile } from '../types';

export type Difficulty = 'easy' | 'medium' | 'hard' | 'extreme';

export interface TrackInfo {
  id: string;
  name: string;
  scenery: Scenery;
  difficulty: Difficulty;
  description: string;
}

export interface TrackEntry extends TrackInfo {
  track: TrackFile;
}

const INFO: TrackInfo[] = [
  { id: 'sunday-drive', name: 'Sunday Drive', scenery: 'country', difficulty: 'easy', description: 'A gentle lap of the farm: wide bends, a chicane, the covered bridge, a dirt lane and a climb over Windmill Hill.' },
  { id: 'palm-bay', name: 'Palm Bay', scenery: 'tropical', difficulty: 'easy', description: 'Round the lagoon: the seafront highway, a banked hairpin at the marina and the long causeway bridge.' },
  { id: 'cactus-canyon', name: 'Cactus Canyon', scenery: 'desert', difficulty: 'medium', description: 'A slalom past the gas station, a jump over the creek, a wriggling dirt trail and a run over the top of Red Mesa.' },
  { id: 'downtown-rush', name: 'Downtown Rush', scenery: 'city', difficulty: 'medium', description: 'A figure-eight through the blocks: the big crossroads, a flyover, the underpass and a short cut through the car park.' },
  { id: 'glacier-pass', name: 'Glacier Pass', scenery: 'alpine', difficulty: 'medium', description: 'Spiral up the helix onto the viaduct, cross the ice field on the glacier and come home through the avalanche galleries.' },
  { id: 'lagoon-leap', name: 'Lagoon Leap', scenery: 'tropical', difficulty: 'hard', description: "The loop by the beach bar, the reef pipe, a banked hairpin and two leaps over the lagoon's inlets." },
  { id: 'mesa-madness', name: 'Mesa Madness', scenery: 'desert', difficulty: 'hard', description: 'A corkscrew roll on the flats, a helix up onto Table Mesa, skyways from mesa to mesa and a flat-out run off Eagle Mesa to jump the wash.' },
  { id: 'skyline-stunts', name: 'Skyline Stunts', scenery: 'city', difficulty: 'hard', description: 'The loop under the towers, then the low road through the pipe or the high road over the rooftops; a roll and two canal jumps.' },
  { id: 'avalanche-run', name: 'Avalanche Run', scenery: 'alpine', difficulty: 'extreme', description: "A double jump and a frozen loop, then the valley road or the high road over Widow's Peak on dirt and ice; a jump over the tarn." },
  { id: 'harvest-havoc', name: 'Harvest Havoc', scenery: 'country', difficulty: 'extreme', description: 'Two loops, a roll, the grain pipe, banked bends over Orchard Hill, a helix up to the aqueduct, two river jumps and a choice of routes.' },
];

const files = import.meta.glob<TrackFile>('./*.json', { eager: true, import: 'default' });
const byId = new Map(Object.entries(files).map(([path, t]) => [path.replace(/^\.\//, '').replace(/\.json$/, ''), t]));

/** Every bundled track: the designed ones in INFO order, then any other JSON here (e.g. test-oval) by name. */
export const TRACKS: TrackEntry[] = [
  ...INFO.filter((i) => byId.has(i.id)).map((i) => ({ ...i, track: byId.get(i.id)! })),
  ...[...byId]
    .filter(([id]) => !INFO.some((i) => i.id === id))
    .map(([id, track]) => ({ id, name: track.name || id, scenery: track.scenery, difficulty: 'easy' as Difficulty, description: '', track }))
    .sort((a, b) => a.name.localeCompare(b.name)),
];

/** A track from the editor's Test drive (?scene=race&track=custom): raced like a bundled one, never listed. */
let custom: TrackEntry | null = null;
export function setCustomTrack(track: TrackFile) {
  custom = { id: 'custom', name: track.name || 'Custom track', scenery: track.scenery, difficulty: 'medium', description: 'Your own track from the editor.', track };
  return custom;
}

export function getTrack(id: string): TrackEntry | undefined {
  if (id === 'custom' && custom) return custom;
  return TRACKS.find((t) => t.id === id);
}

/** Load a bundled track by id. */
export async function loadTrack(id: string): Promise<TrackFile> {
  const t = getTrack(id);
  if (!t) throw new Error(`no track "${id}" (have: ${TRACKS.map((x) => x.id).join(', ')})`);
  return t.track;
}
