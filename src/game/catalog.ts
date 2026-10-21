// The car line-up and the opponent drivers: our own names, made-up stats and personalities. A car's id is its model
// name in ssg.models.json; the stats are showroom numbers (the SIM lane owns the real tunings) and also set the stub
// car's pace. `engine` picks the car's synthesised engine voice (src/audio/engine.ts). Drivers are portraits of the generator's driver characters (driver-a..f, falling back to driver-a).

import type { EngineProfile } from '../audio/engine';

export interface CarInfo {
  id: string;
  name: string;
  /** One line under the name. */
  blurb: string;
  topSpeedMph: number;
  /** 0–60 mph, seconds. */
  zeroSixty: number;
  hp: number;
  weightLb: number;
  gears: number;
  /** 1..5 bars. */
  grip: number;
  /** Accent colour (menus) and the paint used when the model has no variants. */
  colour: string;
  /** Engine sound: v8 (muscle, stock, the pre-war flathead), flat6 (boxers), turbo4 (rally, touring), f1 (V10). */
  engine: EngineProfile;
}

export const CARS: CarInfo[] = [
  { id: 'car-rally', name: 'GRAVEL HORNET', blurb: 'A stubby rally hatch that loves loose dirt.', topSpeedMph: 128, zeroSixty: 5.9, hp: 280, weightLb: 2750, gears: 5, grip: 4, colour: '#e84a2a', engine: 'turbo4' },
  { id: 'car-touring', name: 'BOXLINE GT', blurb: 'Four doors, a roll cage and no manners.', topSpeedMph: 141, zeroSixty: 6.4, hp: 310, weightLb: 3100, gears: 6, grip: 3, colour: '#2f7de1', engine: 'turbo4' },
  { id: 'car-openwheeler', name: 'NEEDLE F', blurb: 'Light as a kite, twitchy as a cat.', topSpeedMph: 188, zeroSixty: 2.9, hp: 590, weightLb: 1400, gears: 6, grip: 5, colour: '#f2c230', engine: 'f1' },
  { id: 'car-stock', name: 'THUNDER STOCK', blurb: 'Big V8, big bumpers, bigger crashes.', topSpeedMph: 172, zeroSixty: 4.6, hp: 720, weightLb: 3400, gears: 4, grip: 2, colour: '#d33a8c', engine: 'v8' },
  { id: 'car-vintage', name: 'BRASS COMET', blurb: 'A pre-war roadster with a stubborn heart.', topSpeedMph: 125, zeroSixty: 9.4, hp: 160, weightLb: 2200, gears: 4, grip: 2, colour: '#b07a3a', engine: 'v8' },
  { id: 'car-super', name: 'COBALT VENOM', blurb: 'Mid-engined, wide and very loud.', topSpeedMph: 202, zeroSixty: 3.1, hp: 700, weightLb: 3050, gears: 7, grip: 4, colour: '#5a5ff0', engine: 'flat6' },
  { id: 'car-sr-muscle', name: 'IRON BRUTE', blurb: 'Seventies muscle: eight cylinders and no brakes to speak of.', topSpeedMph: 166, zeroSixty: 4.8, hp: 520, weightLb: 3600, gears: 4, grip: 2, colour: '#c8322f', engine: 'v8' },
  { id: 'car-buggy', name: 'DUNE FLEA', blurb: 'Tiny, bouncy, unbreakable. Mostly.', topSpeedMph: 124, zeroSixty: 6.0, hp: 190, weightLb: 1250, gears: 4, grip: 3, colour: '#7ec44a', engine: 'flat6' },
];

export interface Opponent {
  id: string;
  name: string;
  /** Short handle shown on the HUD. */
  tag: string;
  /** Personality, one or two lines. */
  bio: string;
  /** What they say before the race. */
  quote: string;
  /** 1..5: how fast they drive. */
  skill: number;
  /** 1..5: how much they risk on the stunts. */
  nerve: number;
  /** The car they bring. */
  carId: string;
  colour: string;
  /** ssg.models.json character drawn as the portrait (falls back to driver-a). */
  model: string;
}

export const OPPONENTS: Opponent[] = [
  { id: 'pip', name: 'PIP OKONJO', tag: 'PIP', bio: 'Rookie mechanic who builds her own engines and drives them gently.', quote: 'Go easy on the gearbox, please.', skill: 1, nerve: 2, carId: 'car-buggy', colour: '#7ec44a', model: 'driver-d' },
  { id: 'hank', name: 'HANK BRISCO', tag: 'HANK', bio: 'Retired trucker. Never brakes before a corner, never apologises after.', quote: 'Corners are a suggestion.', skill: 2, nerve: 5, carId: 'car-stock', colour: '#d33a8c', model: 'driver-e' },
  { id: 'lena', name: 'LENA VOSS', tag: 'LENA', bio: 'Former stunt double. Calm on the loop, furious in traffic.', quote: 'I have done this upside down. Twice.', skill: 3, nerve: 4, carId: 'car-rally', colour: '#e84a2a', model: 'driver-c' },
  { id: 'marco', name: 'MARCO "DIAL" DIAZ', tag: 'DIAL', bio: 'Radio host who commentates his own laps, out loud, the whole way.', quote: 'And Diaz takes the lead, folks!', skill: 3, nerve: 3, carId: 'car-touring', colour: '#2f7de1', model: 'driver-b' },
  { id: 'gus', name: 'GUS HALVORSEN', tag: 'GUS', bio: 'Pit-crew chief turned driver. Knows every line on every track.', quote: 'Your left rear looks soft.', skill: 4, nerve: 2, carId: 'car-sr-muscle', colour: '#20c4a8', model: 'driver-f' },
  { id: 'nova', name: 'NOVA KADE', tag: 'NOVA', bio: 'Three-time champion. Says nothing. Wins anyway.', quote: '...', skill: 5, nerve: 4, carId: 'car-super', colour: '#5a5ff0', model: 'driver-a' },
];

export const carInfo = (id: string) => CARS.find((c) => c.id === id) ?? CARS[0];
export const opponentInfo = (id: string | null) => (id ? (OPPONENTS.find((o) => o.id === id) ?? null) : null);
