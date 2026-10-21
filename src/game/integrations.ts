// Where the other lanes plug in. SIM calls registerSession/registerReplayPlayer (src/game/sim-session.ts, from start.ts), RENDER calls registerView (e.g. from
// their own module imported by main.ts); until then the flow uses the stubs.
import type { RaceSession, RaceView, ReplayPlayer } from './types';
import { StubRaceSession, StubReplayPlayer } from './stub-session';
import { StubRaceView } from './stub-view';

let sessionFactory: () => RaceSession = () => new StubRaceSession();
let replayFactory: () => ReplayPlayer = () => new StubReplayPlayer(() => sessionFactory());
let viewFactory: () => RaceView = () => new StubRaceView();
const real = { session: false, replay: false, view: false };

export function registerSession(f: () => RaceSession) {
  sessionFactory = f;
  real.session = true;
}
export function registerReplayPlayer(f: () => ReplayPlayer) {
  replayFactory = f;
  real.replay = true;
}
export function registerView(f: () => RaceView) {
  viewFactory = f;
  real.view = true;
}

export const createSession = () => sessionFactory();
export const createReplayPlayer = () => replayFactory();
export const createView = () => viewFactory();
/** Which integrations are the real ones (the rest are stubs). */
export const integrations = () => ({ ...real });
