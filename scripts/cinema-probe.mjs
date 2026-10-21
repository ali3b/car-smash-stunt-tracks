// Frame-by-frame smoothness of the cameras through a stunt (in-car raw vs eased orientation, chase), measured on the capture scene without rendering: the
// car's and the camera's movement per 60 fps frame and the camera's turn per frame, through the Lagoon Leap loop.
// The documentary's polish chapter draws it (scripts/documentary.py).
//   node scripts/cinema-probe.mjs [http://127.0.0.1:5308] [out.json]
import fs from 'node:fs';
import { openCapture, loadTake } from './record.mjs';
import { TAKES } from './cinema-moments.mjs';

const [base = 'http://127.0.0.1:5308', out = 'test-results/documentary/probe.json'] = process.argv.slice(2);
const ctx = await openCapture({ base, width: 320, height: 180, gpu: process.argv.includes('--gpu') });
await loadTake(ctx.page, TAKES.lagoon);
const run = (shot, ease = 0.05) => ctx.page.evaluate(([s, e]) => window.__cs.capture.probe(s, 6.5, 12.5, 60, e), [shot, ease]);
const res = { what: 'Lagoon Leap loop, 6.5-12.5 s of the take, 60 fps', chase: await run({ type: 'chase', dist: 12, height: 3.5 }), cockpit: await run({ type: 'cockpit' }), cockpitRaw: await run({ type: 'cockpit' }, 0) };
await ctx.browser.close();
fs.writeFileSync(out, JSON.stringify(res));
console.log(out, res.chase.length, 'frames');
