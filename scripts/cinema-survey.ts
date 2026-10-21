// Surveys races on our bundled tracks for the cinema takes (scripts/record.mjs): drives each track with the
// built-in path follower (optionally against a rival) on the real simulation and lists the moments worth filming:
// stunt sections with their ticks, jumps (air time, height, speed), crashes and close racing.
//   npx vite-node scripts/cinema-survey.ts [track ...] [--car car-super] [--rival nova]
import { SimRaceSession } from '../src/game/sim-session';
import { loadTrack, TRACKS } from '../src/track/tracks';

const args = process.argv.slice(2);
const opt = (k: string, d: string | null) => {
  const i = args.indexOf(k);
  return i >= 0 ? args.splice(i, 2)[1] : d;
};
const car = opt('--car', 'car-super')!;
const rival = opt('--rival', null);
/** Flat out from this many path sections before every jump (0 = the path follower's own throttle). */
const flat = Number(opt('--flat', '0'));
const ids = args.length ? args : TRACKS.filter((t) => t.id !== 'test-oval').map((t) => t.id);

for (const id of ids) {
  const track = await loadTrack(id);
  const s = new SimRaceSession();
  s.start({ trackId: id, track, carId: car, paint: null, opponentId: rival, gearbox: 'auto' });
  const out: string[] = [];
  let kind = '';
  let kindAt = 0;
  let air: { t: number; h0: number; hMax: number; mph: number } | null = null;
  let crashed = false;
  let close = 0;
  for (let i = 0; i < 20 * 400; i++) {
    let input = s.autopilotInput();
    if (flat) {
      const secs = s.sim.path.sections;
      const here = s.stats().section;
      for (let k = 0; k <= flat; k++) if (secs[(here + k) % secs.length]?.jumpGap > 0) input = (input & ~2) | 1;
    }
    const snap = s.step(input);
    const st = s.stats();
    const p = snap.player;
    if (st.kind !== kind) {
      if (kind && !/^(straight|road|corner|curve)/.test(kind)) out.push(`  ${(kindAt / 20).toFixed(1)}-${(i / 20).toFixed(1)}s ${kind}`);
      kind = st.kind ?? '';
      kindAt = i;
    }
    if (p.airborne && !air) air = { t: i, h0: p.pos[1], hMax: p.pos[1], mph: p.speedMph };
    if (air) air.hMax = Math.max(air.hMax, p.pos[1]);
    if (!p.airborne && air) {
      if (i - air.t >= 8) out.push(`  ${(air.t / 20).toFixed(1)}s AIR ${((i - air.t) / 20).toFixed(1)}s rise ${(air.hMax - air.h0).toFixed(1)}m at ${air.mph.toFixed(0)}mph${p.crashed ? ' CRASH-LANDING' : ''}`);
      air = null;
    }
    if (p.crashed && !crashed) out.push(`  ${(i / 20).toFixed(1)}s CRASH on ${st.kind} at ${p.speedMph.toFixed(0)}mph`);
    crashed = p.crashed;
    if (snap.opponent) {
      const d = Math.hypot(p.pos[0] - snap.opponent.pos[0], p.pos[2] - snap.opponent.pos[2]);
      if (d < 12 && i > 60) close++;
    }
    if (s.result()) break;
  }
  const r = s.result();
  console.log(`${id}: ${r ? `${r.finished ? 'finished' : 'not finished'} ${r.timeSeconds.toFixed(1)}s top ${r.topSpeedMph.toFixed(0)} jumps ${r.jumps} won ${r.won}` : 'timeout'} crashes ${s.stats().crashes}${rival ? ` close-steps ${close}` : ''}`);
  console.log(out.join('\n'));
}
