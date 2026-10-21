// Race bookkeeping on top of the car simulation: the start grid, progress along the circuit, checkpoints, wrong-way
// and missed-section penalties, crashes and recovery, the finish, and the counters for the results screen. Our own
// rules, documented in docs/DESIGN.md "Race rules". Deterministic: the same track, cars and input bytes give the
// same race (the computer opponent is deterministic too).
//
// The opponent is an OpponentDriver (src/sim/opponent.ts: by default a RouteDriver on the track's route with a
// rival's profile). Each step runs in the original's order: the player's stepCar with the opponent as `other`, the
// player's bookkeeping (which may end its race), then the driver's step with the player's car, then its bookkeeping.
//
// Units: car positions in physics units (64 per track unit); the path in track units (src/sim/track-path.ts).
import { cloneCarState, createCarState, type CarParams, type CarState, type SimRules } from './car';
import { CRASH_FINISH } from './motion';
import type { OpponentDriver, OpponentRoute, OpponentStart } from './opponent';
import { buildRoute, gridStarts } from './opponent-route';
import { createTrackProbe, type TrackProbe } from './probe';
import { stepCar } from './step';
import { DEFAULT_RULES } from './tunings';
import { nearestOnPath, pointAt, tracePath, type PathSection, type TrackPath } from './track-path';
import type { PieceKind, TrackFile } from '../track/types';

export const RACE_HZ = 20;

/** The rules' numbers (docs/DESIGN.md "Race rules"). */
export const RULES = {
  /** Cars start this far behind the finish line, which crosses the middle of the start-finish piece (track units). */
  gridBack: 220,
  /** Lateral grid offset of the two cars from the centre line (track units). */
  gridSide: 55,
  /** A crashed car is put back on the road after this many steps. */
  crashDelay: 2 * RACE_HZ,
  /** Time penalty for a crash (s). */
  crashPenalty: 3,
  /** Rejoining the circuit further on after leaving the road: per piece skipped (s). */
  skipPenalty: 2,
  /** How many pieces ahead a car can rejoin (further ahead does not count: it must drive back). */
  maxSkip: 8,
  /** Driving against the course for this long (steps) shows WRONG WAY... */
  wrongWayAfter: RACE_HZ,
  /** ...and every this many steps after that costs wrongWayPenalty seconds. */
  wrongWayEvery: 4 * RACE_HZ,
  wrongWayPenalty: 5,
  /** All four wheels off the ground for this many steps counts as a jump. */
  jumpSteps: 10,
  /** The race gives up after this long (steps). */
  timeLimit: 10 * 60 * RACE_HZ,
  /** After the player finishes, the opponent gets this long to finish too (steps). */
  opponentWait: 30 * RACE_HZ,
  /** A car going nowhere for this long while racing is put back on the road (steps, no penalty)... */
  stuckAfter: 6 * RACE_HZ,
  /** ...unless it has got this far (track units) from where it was. */
  stuckDistance: 100,
  /** A car is only put back where it last drove this close to the centre line (track units). */
  safeLateral: 150,
  /** A car put back within this distance of the other car (track units)... */
  resetClear: 160,
  /** ...is put this far to the side of the road away from it instead. */
  resetSide: 70,
} as const;

/** Pieces where a car cannot be put back (it would be upside down or inside a stunt). */
const NO_RESET: ReadonlySet<PieceKind> = new Set(['loop', 'corkscrew-roll', 'corkscrew-helix', 'pipe', 'pipe-entry', 'pipe-obstacle', 'ramp', 'ramp-bridge', 'ramp-solid', 'slalom']);
/** Pieces where the car's heading says nothing about its direction of travel. */
const NO_WRONG_WAY: ReadonlySet<PieceKind> = new Set(['loop', 'corkscrew-roll', 'corkscrew-helix', 'pipe', 'pipe-obstacle']);

export interface RacerEvent {
  kind: 'checkpoint' | 'penalty' | 'jump' | 'crash' | 'reset' | 'finish' | 'wrong-way';
  /** Penalty seconds for 'penalty'. */
  seconds?: number;
}

/** A car in the race: its simulation state and its race bookkeeping. */
export class Racer {
  car: CarState;
  /** Highest path section reached in order. */
  section = 0;
  checkpoint = 0;
  /** Lap distance reached (track units), for the progress bar. */
  reached = 0;
  penalty = 0;
  crashes = 0;
  jumps = 0;
  topSpeed = 0;
  /** Horizontal distance driven (track units). */
  distance = 0;
  finishedTick: number | null = null;
  wrongWay = false;
  /** Steps since the car crashed (null = not crashed). */
  private crashedFor: number | null = null;
  private wrongFor = 0;
  private airFor = 0;
  private stillFor = 0;
  private stillAt: [number, number, number] | null = null;
  /** The car has left the road since it was last on a section (rejoining further on is a cut). */
  private offRoad = false;
  /** Last place the car could be put back to. */
  private safe: { pos: [number, number, number]; yaw: number; section: number } | null = null;
  /** Before the finish line on the first pass (the grid is behind it). */
  private crossedStart = false;
  /** Crashes in a row on the same piece (two put the car back after it). */
  private crashSection = -1;
  private crashStreak = 0;
  /** Section the car was last rescued from, and how many pieces further on it went (it goes further each time). */
  private rescuedFrom = -1;
  private rescueSkip = 0;
  events: RacerEvent[] = [];

  constructor(
    readonly race: Race,
    readonly params: CarParams,
    readonly automatic: boolean,
    pos: [number, number, number],
    yaw: number,
    /** The computer driver of this car (null: the player, stepped by the race with the input bytes). */
    readonly driver: OpponentDriver | null = null,
  ) {
    this.car = driver ? driver.car : createCarState(params, pos, yaw, automatic);
    this.safe = { pos: [pos[0], pos[1], pos[2]], yaw, section: 0 };
  }

  get crashed() {
    return this.crashedFor !== null;
  }
  get finished() {
    return this.finishedTick !== null;
  }

  /** Bookkeeping after the car's physics step. */
  update(tick: number): void {
    const r = this.race;
    const c = this.car;
    const path = r.path;
    this.events = [];
    const mph = c.speed2 / 256;
    if (!this.finished) {
      this.topSpeed = Math.max(this.topSpeed, mph);
      this.distance += Math.hypot(c.pos[0] - c.prevPos[0], c.pos[2] - c.prevPos[2]) / 64;
    }

    // Jumps: long enough in the air.
    if (c.surfAll === 0) {
      this.airFor++;
      if (this.airFor === RULES.jumpSteps && !this.finished && !this.crashed) {
        this.jumps++;
        this.events.push({ kind: 'jump' });
      }
    } else this.airFor = 0;

    // A computer driver ends its own race: after a lap of its route it crosses the finish line (crash flag 3).
    if (!this.finished && this.driver && c.crash === CRASH_FINISH && this.driver.laps > 0) {
      this.finishedTick = tick;
      this.section = path.sections.length;
      this.checkpoint = r.checkpoints;
      this.reached = path.length;
      this.events.push({ kind: 'finish' });
    }

    // Crashes: wait, then put the car back.
    if (this.finished) return;
    if (c.crash === 1 || c.crash === 2) {
      if (this.crashedFor === null) {
        this.crashedFor = 0;
        this.crashes++;
        this.crashStreak = this.crashSection === this.section ? this.crashStreak + 1 : 1;
        this.crashSection = this.section;
        this.penalty += RULES.crashPenalty;
        this.events.push({ kind: 'crash' }, { kind: 'penalty', seconds: RULES.crashPenalty });
      }
      if (++this.crashedFor >= RULES.crashDelay && r.recover) this.reset();
      return;
    }
    if (!path.sections.length) return;

    // Where on the circuit: the sections covering the car's tile, the nearest one ahead of the progress.
    const x = c.pos[0] / 64;
    const y = c.pos[1] / 64;
    const z = c.pos[2] / 64;
    const tx = Math.floor(x / 1024);
    const tz = Math.floor(z / 1024);
    const onRoad = c.wheelSurface.some((s) => s >= 1 && s <= 3) || c.surfAll === 0;
    const n = path.sections.length;
    const cands = tx >= 0 && tz >= 0 && tx < 30 && tz < 30 ? path.tileSections[tz * 30 + tx] : [];
    let best = -1;
    let bestAhead = Infinity;
    let behind = -Infinity;
    for (const si of cands) {
      let ahead = si - this.section;
      if (path.closed) {
        while (ahead > n / 2) ahead -= n;
        while (ahead <= -n / 2) ahead += n;
      }
      if (ahead < -RULES.maxSkip || ahead > RULES.maxSkip) continue;
      // Stacked roads: only a section at the car's level.
      const sec = path.sections[si];
      const near = nearestOnPath(path, x, z, [si], y);
      if (near && Math.abs(near.pos[1] - y) > 260 && !isStunt(sec)) continue;
      if (ahead >= 0 && ahead < bestAhead) {
        bestAhead = ahead;
        best = si;
      } else if (ahead < 0 && bestAhead === Infinity && (best < 0 || ahead > behind)) {
        // Behind the progress (driving back): counts for wrong way, not for progress.
        behind = ahead;
        best = si;
      }
    }
    if (!onRoad) this.offRoad = true;
    if (best >= 0) {
      const sec = path.sections[best];
      if (bestAhead !== Infinity && bestAhead > 0) {
        const skipped = bestAhead - 1;
        if (skipped > 0 && this.offRoad) {
          const p = skipped * RULES.skipPenalty;
          this.penalty += p;
          this.events.push({ kind: 'penalty', seconds: p });
        }
        // Wrapping round onto the start-finish piece: the lap's last section is done.
        this.section = best;
        if (best === 0 && this.crossedStart) this.section = n; // waiting for the line
        this.passCheckpoints();
      }
      if (onRoad) this.offRoad = false;
      const here = nearestOnPath(path, x, z, [best], y);
      if (here) {
        if (this.section < n) this.reached = Math.max(this.reached, Math.min(here.s, path.sections[Math.min(this.section, n - 1)].end));
        // Safe place to come back to: upright, on the road, on a plain piece.
        const allOnRoad = c.wheelSurface.every((s) => s >= 1 && s <= 3);
        if (allOnRoad && Math.abs(here.lateral) < RULES.safeLateral && Math.abs(c.pitch) < 40 && Math.abs(c.roll) < 40 && !NO_RESET.has(sec.kind) && c.crash === 0)
          this.safe = { pos: [c.pos[0], c.pos[1], c.pos[2]], yaw: here.heading, section: best };
        // Wrong way.
        const moving = mph > 8;
        let dh = Math.abs(((c.yaw - here.heading) & 1023) - 0) % 1024;
        if (dh > 512) dh = 1024 - dh;
        const against = moving && dh > 330 && !NO_WRONG_WAY.has(sec.kind) && Math.abs(c.pitch) < 64 && Math.abs(c.roll) < 64;
        this.wrongFor = against ? this.wrongFor + 1 : 0;
        this.wrongWay = this.wrongFor > RULES.wrongWayAfter;
        if (this.wrongFor > RULES.wrongWayAfter && (this.wrongFor - RULES.wrongWayAfter) % RULES.wrongWayEvery === 0) {
          this.penalty += RULES.wrongWayPenalty;
          this.events.push({ kind: 'penalty', seconds: RULES.wrongWayPenalty });
        }
        // The finish line: the middle of the start-finish piece, crossed in the driving direction.
        if (best === 0) {
          const s0 = path.sections[0];
          const line = (s0.start + s0.end) / 2;
          if (here.s >= line) {
            if (!this.crossedStart) this.crossedStart = true;
            else if (!this.driver && this.section >= n && this.checkpoint >= r.checkpoints) {
              this.finishedTick = tick;
              this.reached = path.length;
              c.crash = 3; // the car coasts to a stop
              this.events.push({ kind: 'finish' });
            }
          }
        }
      }
    }

    // Stuck (no reverse gear): back on the road after a while.
    // Going nowhere counts too (wheels spinning against a wall or the other car, rocking against a block): the car
    // has to get RULES.stuckDistance away from where it was.
    const a = this.stillAt;
    if (!a || Math.hypot(c.pos[0] - a[0], c.pos[1] - a[1], c.pos[2] - a[2]) / 64 > RULES.stuckDistance) {
      this.stillAt = [c.pos[0], c.pos[1], c.pos[2]];
      this.stillFor = 0;
    } else this.stillFor++;
    if (this.stillFor >= RULES.stuckAfter && r.tick > RULES.stuckAfter && r.recover) {
      this.stillFor = 0;
      this.stillAt = null;
      // Stuck twice on the same piece with the wheels turning: past it, like a car that keeps crashing there. (A
      // car simply standing, e.g. the player waiting on the grid, is only put back.)
      if (mph >= 1) {
        this.crashStreak = this.crashSection === this.section ? this.crashStreak + 1 : 1;
        this.crashSection = this.section;
      }
      this.reset();
    }
  }

  private passCheckpoints() {
    const r = this.race;
    while (this.checkpoint < r.checkpoints && this.section >= r.checkpointSections[this.checkpoint]) {
      this.checkpoint++;
      if (this.checkpoint < r.checkpoints) this.events.push({ kind: 'checkpoint' });
    }
  }

  /** Put the car back at the last safe place, standing, facing along the circuit. */
  reset(): void {
    if (this.crashStreak >= 2) {
      // Stuck on the same obstacle: past it, to the next piece the car can stand on.
      // Rescued from here before and crashed again: the next standable piece after that one, and so on.
      this.rescueSkip = this.rescuedFrom === this.section ? this.rescueSkip + 1 : 0;
      const r = this.race.rescuePoint(this.section + this.rescueSkip);
      if (r) {
        this.safe = r;
        this.section = Math.max(this.section, r.section - 1);
        this.rescuedFrom = this.section;
        // One more crash on this piece goes straight on to the next rescue.
        this.crashStreak = 1;
        this.crashSection = this.section;
      }
    }
    const s = this.safe;
    this.crashedFor = null;
    this.wrongFor = 0;
    this.offRoad = false;
    if (!s) return;
    const pos: [number, number, number] = [s.pos[0], s.pos[1] - 0x200, s.pos[2]];
    // The other car is standing there (both crashed in the same place): to the side of the road away from it.
    const other = this.race.player === this ? this.race.opponent : this.race.player;
    if (other) {
      const dx = (other.car.pos[0] - pos[0]) / 64;
      const dz = (other.car.pos[2] - pos[2]) / 64;
      if (Math.hypot(dx, dz) < RULES.resetClear) {
        const h = (s.yaw * Math.PI) / 512;
        const [rx, rz] = [Math.cos(h), Math.sin(h)]; // right of the heading
        const away = dx * rx + dz * rz > 0 ? -1 : 1;
        pos[0] += Math.round(away * rx * RULES.resetSide * 64);
        pos[2] += Math.round(away * rz * RULES.resetSide * 64);
      }
    }
    if (this.driver) {
      this.driver.reset({ pos, yaw: s.yaw });
      this.car = this.driver.car;
    } else this.car = createCarState(this.params, pos, s.yaw, this.car.automatic);
    this.events.push({ kind: 'reset' });
    this.race.onReset(this, s.section);
  }

  /** A copy of the car for snapshots. */
  carCopy(): CarState {
    return cloneCarState(this.car);
  }
}

const isStunt = (s: PathSection) => s.kind === 'loop' || s.kind === 'corkscrew-roll' || s.kind === 'corkscrew-helix';

export interface RaceOptions {
  track: TrackFile;
  player: CarParams;
  automatic: boolean;
  /**
   * The computer opponent (null: a time trial). The race calls `driver.init` with `route` (default: buildRoute of
   * the track) and the opponent's grid place.
   */
  opponent?: { driver: OpponentDriver; route?: OpponentRoute } | null;
  rules?: SimRules;
  /** Grid places (default: the original's two-car grid beside the start line, or the centre line for a time trial). */
  grid?: { player: OpponentStart; opponent?: OpponentStart };
  /** The surface both cars drive on (default: createTrackProbe of the track). */
  surface?: TrackProbe;
  /** false: no recovery, a wrecked or stuck car stays where it is (the original's behaviour; golden tests). */
  recover?: boolean;
}

/** The race: both cars, the circuit, the clock. */
export class Race {
  readonly path: TrackPath;
  readonly surface: TrackProbe;
  readonly rules: SimRules;
  readonly checkpoints: number;
  /** Section index a car must reach for each checkpoint (the last one is the lap's end). */
  readonly checkpointSections: number[];
  readonly player: Racer;
  readonly opponent: Racer | null;
  /** The opponent's driver (null in a time trial). */
  readonly driver: OpponentDriver | null;
  /** Crashed and stuck cars are put back on the road (RaceOptions.recover). */
  readonly recover: boolean;
  tick = 0;
  over = false;
  private resetHooks: ((r: Racer, section: number) => void)[] = [];

  constructor(o: RaceOptions) {
    this.path = tracePath(o.track);
    this.surface = o.surface ?? createTrackProbe(o.track);
    this.rules = o.rules ?? DEFAULT_RULES;
    this.recover = o.recover ?? true;
    const n = this.path.sections.length;
    this.checkpoints = Math.max(2, Math.min(10, Math.round(n / 6)));
    this.checkpointSections = Array.from({ length: this.checkpoints }, (_, k) => (k === this.checkpoints - 1 ? n : Math.round(((k + 1) * n) / this.checkpoints)));
    // The opponent needs a route (a track without a start/finish line has none: then it is a time trial).
    const built = o.opponent && !o.opponent.route ? buildRoute(o.track) : null;
    const route = o.opponent?.route ?? built;
    const driver = route ? (o.opponent?.driver ?? null) : null;
    let grid = o.grid;
    if (!grid && driver && built) grid = gridStarts(o.track, built);
    const place = (s: OpponentStart | undefined, side: number): [[number, number, number], number] => (s ? [[s.pos[0], s.pos[1], s.pos[2]], s.yaw] : this.gridSlot(side));
    this.player = new Racer(this, o.player, o.automatic, ...place(grid?.player, driver ? -RULES.gridSide : 0));
    this.driver = driver;
    if (driver && route) {
      const [pos, yaw] = place(grid?.opponent, RULES.gridSide);
      driver.init(route, { pos, yaw });
      this.opponent = new Racer(this, driver.params, true, pos, yaw, driver);
    } else this.opponent = null;
  }

  /** A grid position on the start-finish piece: behind the line, `side` units right of the centre line. */
  private gridSlot(side: number): [[number, number, number], number] {
    const s0 = this.path.sections[0];
    const at = s0 ? pointAt(this.path, (s0.start + s0.end) / 2 - RULES.gridBack) : null;
    if (!at) return [[15 * 65536, 0, 15 * 65536], 0];
    const h = (at.heading * Math.PI) / 512;
    const x = at.pos[0] + Math.cos(h) * side;
    const z = at.pos[2] + Math.sin(h) * side;
    const ground = this.surface.sampler.surfaceAt(x, at.pos[1] + 20, z);
    const y = Number.isFinite(ground.height) ? ground.height : at.pos[1];
    return [[Math.round(x * 64), Math.round(y * 64), Math.round(z * 64)], at.heading];
  }

  /** Where a car stuck on section `from` is put: on the next piece after it a car can stand on. */
  rescuePoint(from: number): { pos: [number, number, number]; yaw: number; section: number } | null {
    const secs = this.path.sections;
    const n = secs.length;
    for (let k = 1; k < Math.min(n, 12); k++) {
      const j = from + k;
      if (j >= n && !this.path.closed) return null;
      const sec = secs[j % n];
      if (NO_RESET.has(sec.kind) || j % n === 0) continue;
      const at = pointAt(this.path, sec.start + Math.min(150, (sec.end - sec.start) / 2));
      if (!at) return null;
      const g = this.surface.sampler.surfaceAt(at.pos[0], at.pos[1] + 20, at.pos[2], [at.pos[0], at.pos[1] + 20, at.pos[2]]);
      const y = Number.isFinite(g.height) ? g.height : at.pos[1];
      return { pos: [Math.round(at.pos[0] * 64), Math.round(y * 64) + 0x200, Math.round(at.pos[2] * 64)], yaw: at.heading, section: j % n };
    }
    return null;
  }

  onReset(r: Racer, section: number) {
    for (const h of this.resetHooks) h(r, section);
  }
  /** Called when a car is put back on the road (the autopilot re-syncs). */
  onAnyReset(h: (r: Racer, section: number) => void) {
    this.resetHooks.push(h);
  }

  /** One 20 Hz step with the player's input byte. */
  step(input: number): void {
    if (this.over) return;
    this.tick++;
    const p = this.player;
    const o = this.opponent;
    stepCar(p.car, p.params, this.rules, input & 0xff, this.surface, {
      other: o ? { car: o.car, params: o.params } : undefined,
    });
    p.update(this.tick);
    if (o && this.driver) {
      this.driver.step(this.surface, { car: p.car, params: p.params });
      o.update(this.tick);
    }
    const oppDone = !o || o.finished;
    if ((p.finished && (oppDone || this.tick - p.finishedTick! > RULES.opponentWait)) || this.tick >= RULES.timeLimit) this.over = true;
  }
}
