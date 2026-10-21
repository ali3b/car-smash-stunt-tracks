// The audio event contract: what the sim / game tells the audio system. Other lanes call
//   const audio = audioSink();            // = getAudio(), typed as just the sink
//   audio.emit('car', { car: 0, player: true, profile: 'v8', rpm, throttle, load, gear, speed, slip, surface, scrape });
// once per rendered frame per car (opponents too, with `x` / `level` for pan and distance), and the one-off events
// below when they happen. Stop sending `car` frames (or emit `carGone`) and that car's sounds fade out by themselves.
import type { EngineProfile } from './engine';
import { getAudio } from './index';
import type { SfxName, Surface } from './sfx';

export type { EngineProfile } from './engine';
export type { Surface } from './sfx';

/** Music per screen. Race music waits for the green light (`countdown` n = 0); `silence` stops the music. */
export type AudioScene = 'menu' | 'race' | 'replay' | 'results' | 'editor' | 'silence';

/** One frame of a car's continuous sound state. */
export interface CarAudioFrame {
  /** Car id (any number; 0 = the player by default). */
  car: number;
  /** A human-driven car (full level, drives the wind). Defaults to car === 0. */
  player?: boolean;
  /** Engine voice; changing it swaps the voice. Default 'v8'. */
  profile?: EngineProfile;
  /** Real rpm (the profile's idle..redline; the F1 voice idles at 4000 and screams to 18000). */
  rpm: number;
  /** Pedal 0..1. */
  throttle: number;
  /** Engine load 0..1 (how hard it pulls: ~0 with the wheels in the air or the clutch in). Default throttle × 0.8. */
  load?: number;
  /** Current gear; a change plays the shift (up: ignition cut + clunk, down: rev blip). */
  gear?: number;
  /** Ground speed in m/s (rolling noise, wind). */
  speed: number;
  /** Tyre slip 0..1, overall or per wheel [fl, fr, rl, rr]. */
  slip?: number | readonly number[];
  /** Surface under the tyres; a change while rolling plays a short transition. Default 'paved'. */
  surface?: Surface;
  /** False while airborne (no rolling or skid sound). Default true. */
  grounded?: boolean;
  /** Wall contact 0..1 while sliding along a wall or barrier (0 = none). */
  scrape?: number;
  /** Stereo position -1 (left) .. 1 (right). Default 0. */
  x?: number;
  /** Loudness multiplier (distant opponents ~0.2..0.5). Default 1 for the player, 0.4 for others. */
  level?: number;
}

export interface AudioEvents {
  car: CarAudioFrame;
  /**
   * A hit. strength 0..1. bump = a small suspension knock (kerb, piece seam); land = touching down after air;
   * wall = hitting a wall / barrier / scenery; car = car on car.
   */
  impact: { car?: number; strength: number; kind: 'bump' | 'land' | 'wall' | 'car'; x?: number };
  /** The car is wrecked (the race's crash). */
  crash: { car?: number; strength?: number; x?: number };
  /** Start countdown: n = 3, 2, 1 beep; n = 0 is GO (starts the race music). */
  countdown: { n: number };
  /** Passed a checkpoint / split. */
  checkpoint: { car?: number };
  /** Crossed the finish line. place 1 / no place = fanfare; a later place just gets the checkpoint chime. */
  finish: { car: number; place?: number; player?: boolean };
  /** Screen change: picks the music. */
  scene: { name: AudioScene };
  /** Menu / editor feedback. */
  ui: { kind: 'click' | 'select' | 'back' | 'place' | 'erase' };
  /** A car left the world (race over, car removed): its voices fade out. */
  carGone: { car: number };
  /** Game paused: car sounds fade out (music and UI stay). */
  pause: { paused: boolean };
}

export type AudioEventType = keyof AudioEvents;

/** What the game holds to drive the sound. */
export interface AudioEventSink {
  emit<K extends AudioEventType>(type: K, e: AudioEvents[K]): void;
}

/** The page's audio system as an event sink. */
export function audioSink(): AudioEventSink {
  return getAudio();
}

/** Sound names playable directly via getAudio().sfx(name). */
export type { SfxName };
