// The game's flow: which screen is up and which 3D backdrop runs behind it.
//
//   title (attract: demo race + logo, best-times loop) → main menu ┬ race:   car → track → race → results ┬ again
//                                                                   ├ versus: car → rival → track → race … ├ replay (VCR)
//                                                                   ├ editor (?scene=editor)                ├ high scores
//                                                                   ├ replays → replay (VCR)                └ menu
//                                                                   ├ high scores
//                                                                   └ options
// The race is a RaceSession stepped at SIM_HZ (20 Hz) from the 60 Hz Loop, drawn by a RaceView between two snapshots.
// Both come from src/game/integrations.ts (stubs until the SIM and RENDER lanes register theirs).
// window.__cs.flow is the test handle (scripts/flow-check.mjs).
import * as THREE from 'three';
import { Loop, STEP } from '../engine/loop';
import { clearPressed, drainMenu, readInput, wasPressed, type MenuEvent } from '../engine/input';
import { cycleDosLook, dosLabel } from '../engine/retro';
import { encodeInputByte, INPUT_ACCEL, type CarInput } from '../sim/input';
import { TRACKS, getTrack } from '../track/tracks';
import { modelIndex } from '../models';
import { CARS, OPPONENTS, carInfo, opponentInfo } from './catalog';
import { createReplayPlayer, createSession, createView, integrations } from './integrations';
import { getAudio } from '../audio';
import { Showroom, renderPortrait } from './showroom';
import { addScore, deleteReplay, getOptions, listReplays, placeFor, replayData, saveReplay, scoresFor, setOptions, type SavedReplay } from './storage';
import { SIM_DT, SIM_HZ, type CameraMode, type RaceResult, type RaceSession, type RaceSetup, type RaceSnapshot, type RaceView, type ReplayData, type ReplayPlayer } from './types';
import type { Screen } from '../ui/screens/common';
import { MainMenuScreen, TitleScreen, type MainItem } from '../ui/screens/title';
import { CarSelectScreen } from '../ui/screens/car-select';
import { OpponentSelectScreen } from '../ui/screens/opponent-select';
import { TrackSelectScreen } from '../ui/screens/track-select';
import { ResultsScreen, type ResultsChoice } from '../ui/screens/results';
import { ScoresScreen } from '../ui/screens/scores';
import { OptionsScreen } from '../ui/screens/options';
import { PauseScreen, type PauseChoice } from '../ui/screens/pause';
import { ReplaysScreen } from '../ui/screens/replays';
import { VcrScreen } from '../ui/screens/vcr';
import { LoadingScreen } from '../ui/screens/loading';
import { RaceHud } from '../ui/race-hud';
import { toast } from '../ui/toast';
import type { AudioScene } from '../audio';
import { GameAudio } from './game-audio';

export type FlowState = 'loading' | 'title' | 'menu' | 'car' | 'opponent' | 'track' | 'race' | 'results' | 'scores' | 'replays' | 'replay' | 'options';

/** The music per screen (the race's own starts at GO; loading keeps what is playing). */
const SCENES: Partial<Record<FlowState, AudioScene>> = {
  title: 'menu',
  menu: 'menu',
  car: 'menu',
  opponent: 'menu',
  track: 'menu',
  scores: 'menu',
  replays: 'menu',
  options: 'menu',
  race: 'race',
  results: 'results',
  replay: 'replay',
};

/** Real seconds of 3-2-1-GO before a race. */
const COUNTDOWN = 3;
/** Seconds the finished race stays on screen before the results. */
const FINISH_HOLD = 2;

/** A race on screen: the session (or replay player), its view and the two snapshots it draws between. */
interface Live {
  setup: RaceSetup;
  view: RaceView;
  session: RaceSession | null;
  replay: ReplayPlayer | null;
  prev: RaceSnapshot;
  next: RaceSnapshot;
  acc: number;
  demo: boolean;
  /** Its cars are heard (not the demo race behind the menus). */
  sound: boolean;
  /** Last replay step whose one-off sounds played. */
  heardTick: number;
}

export class Flow {
  readonly loop: Loop;
  state: FlowState = 'loading';
  screen: Screen | null = null;
  private overlay: Screen | null = null;
  private live: Live | null = null;
  private showroom: Showroom | null = null;
  private hud: RaceHud | null = null;
  private buildToken = 0;
  /** What the player is putting together. */
  private mode: 'race' | 'versus' = 'race';
  private setup: Omit<RaceSetup, 'track' | 'trackId'> & { trackId: string };
  private countdown = 0;
  private finishT = 0;
  private paused = false;
  private lastResult: { result: RaceResult; replay: ReplayData; place: number; committed: boolean; highlight?: number; saved?: boolean } | null = null;
  private replayBack: 'results' | 'replays' = 'replays';
  private demoCam = 0;
  private demoCamT = 0;
  private paints = new Map<string, { name: string; tint: string | null }[]>();
  private portraits = new Map<string, string>();
  /** Tests: a fixed driving input (null = keyboard / pad), or the autopilot (the session's path follower; throttle only on the stub). */
  override: CarInput | null = null;
  autopilot = false;
  /** Draw the race (tests turn it off). */
  private drawing = true;
  private padHeld = new Set<string>();
  readonly audio = new GameAudio();
  /** Something was drawn on the canvas (keep it on screen while the next backdrop builds, never a blank frame). */
  private drawn = false;
  /** The interpolation of the last frame (held while paused). */
  private lastAlpha = 0;

  constructor(readonly renderer: THREE.WebGLRenderer) {
    // Taps on menu items, pickers and buttons.
    document.addEventListener('click', (e) => {
      if ((e.target as HTMLElement | null)?.closest?.('.cs-scr [data-act]')) this.audio.tap();
    });
    const o = getOptions();
    this.setup = { carId: o.carId, paint: o.paint, opponentId: null, gearbox: o.gearbox, trackId: getTrack(o.trackId) ? o.trackId : (TRACKS[0]?.id ?? '') };
    this.loop = new Loop({ step: (dt) => this.step(dt), render: (a, frameDt) => this.frame(frameDt, a) });
    addEventListener('resize', () => this.resize());
    // Taps on the key hints that stand for ESC / ENTER (src/ui/screens/common.ts keys()).
    document.addEventListener('click', (e) => {
      const m = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-menu]');
      if (m) this.press({ key: m.dataset.menu as MenuEvent['key'] });
    });
  }

  async start() {
    // The pixel font first: otherwise the title draws in a fallback font and jumps when it arrives.
    await Promise.race([document.fonts?.load(`16px 'Press Start 2P'`).catch(() => null), new Promise((r) => setTimeout(r, 2500))]);
    const index = await modelIndex();
    for (const c of CARS) this.paints.set(c.id, index?.models[c.id]?.data.variants ?? []);
    this.toTitle();
    this.loop.start();
  }

  // ---- screens and backdrops -----------------------------------------------------------------------------------

  private setScreen(state: FlowState, screen: Screen | null) {
    this.closeOverlay();
    this.screen?.dispose();
    this.screen = screen;
    if (screen) document.body.appendChild(screen.el);
    this.state = state;
    const scene = SCENES[state];
    if (scene) this.audio.scene(scene);
    clearPressed();
  }

  private closeOverlay() {
    this.overlay?.dispose();
    this.overlay = null;
    if (this.paused) this.audio.pause(false);
    this.paused = false;
  }

  private dropLive() {
    this.audio.silenceCars();
    this.buildToken++;
    this.live?.view.dispose();
    this.live = null;
    this.hud?.dispose();
    this.hud = null;
  }

  /** The demo race behind the title and the menus (kept running across menu screens). */
  private async ensureDemo() {
    this.showroom = null;
    if (this.live?.demo) return;
    this.dropLive();
    const token = this.buildToken;
    const tracks = TRACKS.filter((t) => t.id !== 'test-oval');
    const pool = tracks.length ? tracks : TRACKS;
    const entry = pool[Math.floor(Math.random() * pool.length)];
    if (!entry) return;
    const car = CARS[Math.floor(Math.random() * CARS.length)];
    const opp = OPPONENTS[Math.floor(Math.random() * OPPONENTS.length)];
    const setup: RaceSetup = { trackId: entry.id, track: entry.track, carId: car.id, paint: null, opponentId: opp.id, gearbox: 'auto' };
    const live = await this.buildLive(setup, token, true);
    if (!live) return;
    live.view.camera = 'orbit';
    this.demoCam = 2;
    this.demoCamT = 0;
    this.live = live;
  }

  private async buildLive(setup: RaceSetup, token: number, demo: boolean): Promise<Live | null> {
    const view = createView();
    try {
      await view.init(setup);
    } catch (e) {
      // The view failed to build (a missing car model drives in another car's body, so this is a real error):
      // say so instead of hanging on the loading screen.
      console.warn('race view failed to build', e);
      view.dispose();
      if (!demo && token === this.buildToken) {
        toast('COULD NOT LOAD THE RACE');
        this.toMenu(this.mode);
      }
      return null;
    }
    if (token !== this.buildToken) {
      view.dispose();
      return null;
    }
    const session = createSession();
    session.start(setup);
    const s = session.snapshot();
    view.resize(innerWidth, innerHeight);
    return { setup, view, session, replay: null, prev: s, next: s, acc: 0, demo, sound: !demo, heardTick: 0 };
  }

  private ensureShowroom() {
    // The demo race waits behind the showroom (no rebuild, no blank backdrop when the menus come back).
    if (this.live && !this.live.demo) this.dropLive();
    this.showroom ??= new Showroom();
    this.showroom.resize(innerWidth, innerHeight);
  }

  // ---- states --------------------------------------------------------------------------------------------------

  toTitle() {
    void this.ensureDemo();
    this.setScreen(
      'title',
      new TitleScreen({
        onStart: () => this.toMenu(),
        attractTable: () => {
          const withTimes = TRACKS.filter((t) => scoresFor(t.id).length);
          const t = (withTimes.length ? withTimes : TRACKS)[Math.floor(Math.random() * (withTimes.length || TRACKS.length))];
          return t ? { track: t.name, rows: scoresFor(t.id) } : null;
        },
      }),
    );
  }

  toMenu(initial?: MainItem) {
    void this.ensureDemo();
    this.setScreen('menu', new MainMenuScreen({ initial, onPick: (id) => this.pickMain(id), onBack: () => this.toTitle() }));
  }

  private pickMain(id: MainItem) {
    if (id === 'race' || id === 'versus') {
      this.mode = id;
      this.toCarSelect();
    } else if (id === 'editor') location.search = '?scene=editor';
    else if (id === 'replays') this.toReplays();
    else if (id === 'scores') this.toScores(this.setup.trackId);
    else this.setScreen('options', new OptionsScreen({ onBack: () => this.toMenu('options') }));
  }

  private steps() {
    return this.mode === 'versus' ? 3 : 2;
  }

  toCarSelect() {
    this.ensureShowroom();
    void this.showroom!.setCar(this.setup.carId, this.setup.paint);
    this.showroom!.setFocus(0.3);
    this.setScreen(
      'car',
      new CarSelectScreen({
        carId: this.setup.carId,
        paint: this.setup.paint,
        gearbox: this.setup.gearbox,
        step: `STEP 1 / ${this.steps()}`,
        paints: (id) => this.paints.get(id) ?? [],
        onChange: (id, paint) => void this.showroom?.setCar(id, paint),
        onDone: (carId, paint, gearbox) => {
          this.setup = { ...this.setup, carId, paint, gearbox };
          setOptions({ carId, paint, gearbox });
          if (this.mode === 'versus') this.toOpponentSelect();
          else this.toTrackSelect();
        },
        onBack: () => this.toMenu(this.mode),
      }),
    );
  }

  toOpponentSelect() {
    void this.ensureDemo();
    const scr = new OpponentSelectScreen({
      opponentId: getOptions().opponentId,
      step: 'STEP 2 / 3',
      onDone: (id) => {
        this.setup.opponentId = id;
        setOptions({ opponentId: id });
        this.toTrackSelect();
      },
      onBack: () => this.toCarSelect(),
    });
    this.setScreen('opponent', scr);
    // Portraits render once, one at a time, and fill in as they come.
    void (async () => {
      for (const o of OPPONENTS) {
        let url = this.portraits.get(o.id);
        if (!url) {
          url = (await renderPortrait(o).catch(() => null)) ?? undefined;
          if (url) this.portraits.set(o.id, url);
        }
        if (url && this.screen === scr) scr.setPortrait(o.id, url);
      }
    })();
  }

  toTrackSelect() {
    void this.ensureDemo();
    this.setScreen(
      'track',
      new TrackSelectScreen({
        tracks: TRACKS,
        trackId: this.setup.trackId,
        step: `STEP ${this.steps()} / ${this.steps()}`,
        scores: scoresFor,
        onDone: (id) => {
          this.setup.trackId = id;
          setOptions({ trackId: id });
          void this.startRace();
        },
        onBack: () => (this.mode === 'versus' ? this.toOpponentSelect() : this.toCarSelect()),
      }),
    );
  }

  /** Build and start the race with the current picks. */
  async startRace() {
    const entry = getTrack(this.setup.trackId) ?? TRACKS[0];
    if (!entry) return;
    const setup: RaceSetup = { ...this.setup, opponentId: this.mode === 'versus' ? this.setup.opponentId : null, trackId: entry.id, track: entry.track };
    this.showroom = null;
    this.dropLive();
    const token = this.buildToken;
    this.audio.scene('silence');
    this.setScreen('loading', new LoadingScreen(entry.name, carInfo(setup.carId).name));
    const live = await this.buildLive(setup, token, false);
    if (!live) return;
    this.audio.startRace(setup);
    live.view.camera = getOptions().camera;
    this.live = live;
    this.hud = new RaceHud({ versus: opponentInfo(setup.opponentId)?.tag ?? null, gears: carInfo(setup.carId).gears });
    this.hud.setGearbox(setup.gearbox === 'auto' ? 'AUTOMATIC' : 'MANUAL');
    this.hud.setCamera(live.view.camera);
    this.hud.update(live.next, 0);
    this.countdown = COUNTDOWN;
    this.finishT = 0;
    this.setScreen('race', null);
  }

  private openPause() {
    if (this.paused || this.state !== 'race') return;
    this.paused = true;
    this.audio.pause(true);
    this.overlay = new PauseScreen((c) => this.pauseChoice(c));
    document.body.appendChild(this.overlay.el);
    clearPressed();
  }

  private pauseChoice(c: PauseChoice) {
    this.closeOverlay();
    clearPressed();
    if (c === 'restart') void this.startRace();
    else if (c === 'quit') {
      this.dropLive();
      this.toMenu(this.mode);
    }
  }

  private toResults() {
    const live = this.live!;
    const result = live.session!.result()!;
    const replay: ReplayData = {
      version: 1,
      trackId: live.setup.trackId,
      carId: live.setup.carId,
      paint: live.setup.paint,
      opponentId: live.setup.opponentId,
      gearbox: live.setup.gearbox,
      inputs: live.session!.inputs(),
    };
    const place = result.finished ? placeFor(result.trackId, result.totalSeconds) : -1;
    this.lastResult = { result, replay, place, committed: place < 0 };
    this.showResults();
  }

  private showResults() {
    const lr = this.lastResult!;
    this.hud?.show(false);
    if (this.live) {
      this.live.view.camera = 'orbit';
      // The race is over: its cars go quiet under the results music.
      this.audio.silenceCars();
      this.live.sound = false;
    }
    const scr: ResultsScreen = new ResultsScreen({
      result: lr.result,
      trackName: getTrack(lr.result.trackId)?.name ?? lr.result.trackId,
      place: lr.committed ? (lr.highlight ?? -1) : lr.place,
      initials: getOptions().initials,
      entered: lr.committed,
      onInitials: (ini) => {
        setOptions({ initials: ini });
        lr.highlight = addScore(lr.result.trackId, { initials: ini, total: lr.result.totalSeconds, penalty: lr.result.penaltySeconds, carId: lr.result.carId, date: new Date().toISOString() });
        lr.committed = true;
      },
      onChoose: (c) => this.resultsChoice(c, scr),
    });
    if (lr.saved) scr.markSaved();
    this.setScreen('results', scr);
  }

  private resultsChoice(c: ResultsChoice, scr: ResultsScreen) {
    const lr = this.lastResult!;
    if (c === 'again') void this.startRace();
    else if (c === 'watch') {
      this.replayBack = 'results';
      void this.watch(lr.replay);
    } else if (c === 'save') {
      // Once per race (a second ENTER would save a duplicate).
      if (lr.saved) return toast('REPLAY ALREADY SAVED');
      lr.saved = true;
      const track = getTrack(lr.replay.trackId)?.name ?? lr.replay.trackId;
      saveReplay(lr.replay, track, lr.result.finished ? lr.result.totalSeconds : null);
      scr.markSaved();
      toast('REPLAY SAVED');
    } else if (c === 'scores') {
      this.dropLive();
      this.toScores(lr.result.trackId, lr.highlight);
    } else {
      this.dropLive();
      this.toMenu();
    }
  }

  toScores(trackId: string, highlight?: number) {
    void this.ensureDemo();
    const scr: ScoresScreen = new ScoresScreen({ tracks: TRACKS, trackId, highlight, scores: scoresFor, onBack: () => this.toMenu('scores') });
    this.setScreen('scores', scr);
  }

  toReplays() {
    void this.ensureDemo();
    this.setScreen(
      'replays',
      new ReplaysScreen({
        list: listReplays,
        trackName: (id) => getTrack(id)?.name ?? null,
        onWatch: (r: SavedReplay) => {
          this.replayBack = 'replays';
          void this.watch(replayData(r));
        },
        onDelete: (r) => deleteReplay(r.id),
        onBack: () => this.toMenu('replays'),
      }),
    );
  }

  /** Play a replay with the VCR controls (reuses the race view when it shows the same race). */
  async watch(data: ReplayData) {
    const entry = getTrack(data.trackId);
    if (!entry) return toast('TRACK NOT FOUND');
    const setup: RaceSetup = { trackId: data.trackId, track: entry.track, carId: data.carId, paint: data.paint, opponentId: data.opponentId, gearbox: data.gearbox };
    this.showroom = null;
    let view: RaceView | null = null;
    const reuse = this.live && !this.live.demo && this.live.setup.trackId === data.trackId && this.live.setup.carId === data.carId && this.live.setup.opponentId === data.opponentId;
    if (reuse) {
      view = this.live!.view;
      this.audio.silenceCars();
      this.live = null;
      this.buildToken++;
    } else {
      this.dropLive();
      const token = this.buildToken;
      this.setScreen('loading', new LoadingScreen(entry.name, 'REPLAY'));
      view = createView();
      try {
        await view.init(setup);
      } catch (e) {
        console.warn('replay view failed to build', e);
        view.dispose();
        if (token === this.buildToken) {
          toast('COULD NOT LOAD THE RACE');
          this.toReplays();
        }
        return;
      }
      if (token !== this.buildToken) return view.dispose();
    }
    this.hud?.dispose();
    const player = createReplayPlayer();
    player.load(data, entry.track);
    const f = player.frame();
    view.camera = 'chase';
    view.resize(innerWidth, innerHeight);
    this.live = { setup, view, session: null, replay: player, prev: f.prev, next: f.next, acc: 0, demo: false, sound: true, heardTick: f.next.tick };
    this.audio.startRace(setup);
    this.hud = new RaceHud({ versus: opponentInfo(setup.opponentId)?.tag ?? null, gears: carInfo(setup.carId).gears });
    this.hud.el.querySelector<HTMLElement>('.cam')!.style.display = 'none';
    this.hud.el.classList.add('replay');
    this.setScreen(
      'replay',
      new VcrScreen({
        player,
        camera: () => this.live?.view.camera ?? 'chase',
        nextCamera: () => this.nextCamera(),
        onExit: () => this.exitReplay(),
      }),
    );
  }

  private exitReplay() {
    if (this.replayBack === 'results' && this.lastResult) {
      this.hud?.dispose();
      this.hud = null;
      // Show the finished race again behind the results.
      const live = this.live;
      if (live?.replay) {
        const end = live.replay.length;
        live.replay.seek(end);
        live.replay.pause();
      }
      this.showResults();
    } else {
      this.dropLive();
      this.toReplays();
    }
  }

  private nextCamera() {
    const v = this.live?.view;
    if (!v) return;
    const i = v.cameras.indexOf(v.camera);
    v.camera = v.cameras[(i + 1) % v.cameras.length] as CameraMode;
    this.hud?.setCamera(v.camera);
  }

  // ---- per step / per frame -------------------------------------------------------------------------------------

  private driverInput(): number {
    if (this.autopilot) return this.live?.session?.autopilotInput?.() ?? INPUT_ACCEL;
    return encodeInputByte(this.override ?? readInput());
  }

  /** 60 Hz: the race (20 Hz inside), the countdown, the demo. */
  private step(dt: number) {
    const live = this.live;
    if (this.showroom) this.showroom.step(dt);
    if (!live || this.paused || this.showroom) return;
    if (live.replay) {
      live.replay.update(dt);
      const f = live.replay.frame();
      live.prev = f.prev;
      live.next = f.next;
      live.acc = f.alpha * SIM_DT;
      // The sound follows the replay at normal speed; paused, winding or rewinding, the cars are muted.
      const normal = this.replaySounds();
      this.audio.replayPlayback(normal);
      if (live.sound && normal && f.next.tick === live.heardTick + 1) this.audio.events(f.prev, f.next, live.view.camera);
      live.heardTick = f.next.tick;
      return;
    }
    const session = live.session!;
    if (!live.demo && this.state === 'race') {
      // 3, 2, 1 beeps, then GO (the race music).
      this.audio.countdown(Math.max(0, Math.ceil(this.countdown)));
      if (this.countdown > 0) {
        this.countdown -= dt;
        return;
      }
    }
    if (session.result()) {
      if (live.demo) {
        // The demo ran out: another one.
        this.live = null;
        live.view.dispose();
        void this.ensureDemo();
      } else if (this.state === 'race') {
        this.finishT += dt;
        if (this.finishT >= FINISH_HOLD) this.toResults();
      }
      // After the finish the view keeps orbiting the last snapshot.
      live.prev = live.next;
      return;
    }
    live.acc += dt;
    while (live.acc >= SIM_DT) {
      live.acc -= SIM_DT;
      live.prev = live.next;
      live.next = session.step(live.demo ? (session.autopilotInput?.() ?? INPUT_ACCEL) : this.driverInput());
      if (live.sound) this.audio.events(live.prev, live.next, live.view.camera);
      if (live.next.event && this.hud) this.hud.flash(live.next.event);
      if (live.next.finished && !live.prev.finished && this.hud) this.hud.flash(live.setup.opponentId && live.next.opponentFinished ? 'FINISH' : 'FINISHED!', 2);
    }
  }

  private padEdge(button: number): boolean {
    let edge = false;
    for (const p of navigator.getGamepads?.() ?? []) {
      if (!p) continue;
      const id = `${p.index}:${button}`;
      const down = p.buttons[button]?.pressed ?? false;
      if (down && !this.padHeld.has(id)) edge = true;
      if (down) this.padHeld.add(id);
      else this.padHeld.delete(id);
    }
    return edge;
  }

  /** Once per animation frame: menu input, the HUD, drawing. */
  private frame(dt: number, loopAlpha = 0) {
    // M is a letter while initials are typed.
    this.audio.muteKey = !(this.screen instanceof ResultsScreen && this.screen.isEntering);
    if (wasPressed('F2')) toast(`DOS LOOK: ${dosLabel(cycleDosLook())}`);
    if (this.state === 'race' && !this.paused) {
      if (wasPressed('Escape') || this.padEdge(9)) this.openPause();
      if (wasPressed('KeyC') || this.padEdge(12)) this.nextCamera();
    } else {
      const target = this.overlay ?? this.screen;
      for (const e of drainMenu()) this.press(e, target);
    }
    this.screen?.tick?.(dt);
    const live = this.showroom ? null : this.live;
    if (live) {
      // The demo's camera tours: trackside, chase, orbit.
      if (live.demo) {
        this.demoCamT += dt;
        if (this.demoCamT > 9) {
          this.demoCamT = 0;
          this.demoCam = (this.demoCam + 1) % 3;
          live.view.camera = (['tv', 'chase', 'orbit'] as const)[this.demoCam];
        }
      }
      // Between the two snapshots: the 20 Hz race's own accumulator plus the 60 Hz loop's fraction of a step, so
      // the car moves every display frame at any refresh rate (not in 1/60 s jumps).
      let alpha: number;
      if (this.paused) alpha = this.lastAlpha;
      else if (live.replay) alpha = live.replay.playing ? live.acc / SIM_DT + loopAlpha * STEP * SIM_HZ * live.replay.speed : live.acc / SIM_DT;
      else alpha = live.next === live.prev ? 1 : (live.acc + loopAlpha * STEP) / SIM_DT;
      alpha = Math.max(0, Math.min(1, alpha));
      this.lastAlpha = alpha;
      live.view.update(live.prev, live.next, alpha, dt);
      // The cars' sound (not under the pause menu, nor while a replay is paused or winding).
      if (live.sound && !this.paused && (!live.replay || this.replaySounds()))
        this.audio.cars(live.prev, live.next, alpha, dt, live.view.camera, live.view.listener?.(), !!live.session?.result());
      if (this.hud && (this.state === 'race' || this.state === 'replay')) {
        this.hud.update(live.next, dt);
        const count = this.state === 'race' && !live.replay ? (this.countdown > 0 ? String(Math.ceil(this.countdown)) : live.next.time < 0.8 ? 'GO!' : '') : '';
        this.hud.countdown(count);
      }
      if (this.drawing) live.view.render(this.renderer);
      this.drawn = true;
    } else if (this.showroom) {
      this.showroom.render(this.renderer);
      this.drawn = true;
    } else if (!this.drawn) {
      // Nothing drawn yet (first boot). Later, the last frame stays up while the next backdrop builds.
      this.renderer.setClearColor('#0b0e1c');
      this.renderer.clear();
    }
  }

  /** The replay on screen plays forward at normal speed (its cars are heard). */
  private replaySounds() {
    const r = this.live?.replay;
    return !!r && r.playing && r.speed === 1;
  }

  /** A menu press to the screen on top (tests call it through window.__cs.flow.press). */
  press(e: MenuEvent, target = this.overlay ?? this.screen) {
    if (target) this.audio.menu(e, target instanceof ResultsScreen && target.isEntering);
    target?.input(e);
  }

  /** A race the player is driving right now (the touch controls show then). */
  racing() {
    return this.state === 'race' && !this.paused && !!this.live?.session && !this.live.demo;
  }

  /** The current race's gearbox is manual. */
  manualGearbox() {
    return this.live?.setup.gearbox === 'manual';
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.live?.view.resize(innerWidth, innerHeight);
    this.showroom?.resize(innerWidth, innerHeight);
  }

  // ---- test handle ----------------------------------------------------------------------------------------------

  handle() {
    return {
      state: () => this.state,
      /** A menu key ('up', 'confirm', …) or a letter. */
      press: (k: string) => this.press(k.length === 1 ? { letter: k.toUpperCase() } : { key: k as MenuEvent['key'] }),
      setInput: (i: CarInput | null) => (this.override = i),
      autopilot: (on: boolean) => (this.autopilot = on),
      /** Tests: stop drawing the 3D race (everything else runs; a software-GL check then keeps real time). */
      drawing: (on: boolean) => (this.drawing = on),
      /** Run the simulation n seconds right now. */
      advance: (seconds: number) => this.loop.advance(seconds),
      skipCountdown: () => (this.countdown = Math.min(this.countdown, 0)),
      snapshot: () => this.live?.next ?? null,
      /** The live race session (checks call its methods inside the page, e.g. stats() on the simulation). */
      session: () => this.live?.session ?? null,
      result: () => this.lastResult?.result ?? null,
      camera: () => this.live?.view.camera ?? null,
      /** The live race view (checks call its probe(): camera, car, wheel gaps). */
      view: () => this.live?.view ?? null,
      nextCamera: () => this.nextCamera(),
      replay: () => {
        const r = this.live?.replay;
        return r ? { tick: r.tick, length: r.length, playing: r.playing, speed: r.speed } : null;
      },
      integrations,
      /** The page's audio system (level(), settings, currentSong). */
      audio: () => getAudio(),
      go: {
        title: () => this.toTitle(),
        menu: () => this.toMenu(),
        car: (mode: 'race' | 'versus' = 'race') => {
          this.mode = mode;
          this.toCarSelect();
        },
        race: (setup?: Partial<RaceSetup>) => {
          if (setup) Object.assign(this.setup, setup);
          if (setup?.opponentId) this.mode = 'versus';
          return this.startRace();
        },
        scores: (trackId?: string) => this.toScores(trackId ?? this.setup.trackId),
        replays: () => this.toReplays(),
        options: () => this.setScreen('options', new OptionsScreen({ onBack: () => this.toMenu('options') })),
      },
    };
  }
}
