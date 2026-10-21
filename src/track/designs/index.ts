// Our track designs by id (see src/track/tracks/index.ts for names and descriptions; scripts/build-tracks.ts builds them).
import type { TrackFile } from '../types';
import sundayDrive from './sunday-drive';
import palmBay from './palm-bay';
import cactusCanyon from './cactus-canyon';
import downtownRush from './downtown-rush';
import glacierPass from './glacier-pass';
import lagoonLeap from './lagoon-leap';
import mesaMadness from './mesa-madness';
import skylineStunts from './skyline-stunts';
import avalancheRun from './avalanche-run';
import harvestHavoc from './harvest-havoc';

export const DESIGNS: Record<string, () => TrackFile> = {
  'sunday-drive': sundayDrive,
  'palm-bay': palmBay,
  'cactus-canyon': cactusCanyon,
  'downtown-rush': downtownRush,
  'glacier-pass': glacierPass,
  'lagoon-leap': lagoonLeap,
  'mesa-madness': mesaMadness,
  'skyline-stunts': skylineStunts,
  'avalanche-run': avalancheRun,
  'harvest-havoc': harvestHavoc,
};
