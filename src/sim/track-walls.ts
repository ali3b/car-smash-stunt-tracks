// The wall table: vertical lines the wheels may not cross (rails, kerbs of ramps and decks, tunnel and pipe sides,
// building walls). A wall is a point (x, z) in the piece's own frame and the direction of the line from it, stored as
// an orientation in 1/1024 turn (the angle of (-dx, dz), as the original measures it). The surface rules pick one per
// wheel by index. Built from the piece geometry; tests/surface-tables.test.ts compares it with the original's table.
import { polarAngle } from './fixmath';
import { arcPoint, sectorAngle } from './track-planes';

export interface Wall {
  angle: number;
  x: number;
  z: number;
}

/** A wall through (x, z) running along (dx, dz). */
const line = (x: number, z: number, dx: number, dz: number): Wall => ({ angle: polarAngle(-dx, dz) & 1023, x, z });
/** A wall from point a towards point b. */
const seg = (a: [number, number], b: [number, number]): Wall => line(a[0], a[1], b[0] - a[0], b[1] - a[1]);

/** The four sides of a box x0..x1 by z0..z1, in the order south, north, east, west (each its own corner and direction). */
function box(x0: number, x1: number, z0: number, z1: number) {
  return {
    s: line(x1, z0, 1, 0),
    n: line(x0, z1, -1, 0),
    e: line(x1, z1, 0, 1),
    w: line(x0, z0, 0, -1),
  };
}

/** Helix rails: 24 sectors round the block centre; `side` -1 for the left-turning helix, 1 for the right. */
function helixRails(side: number): { outer: Wall[]; inner: Wall[] } {
  const axis = (c: number, s: number): [number, number] => [side * c, s];
  const p = (r: number, k: number) => arcPoint(0, 0, r, sectorAngle(k, 24, 1024), axis);
  const outer: Wall[] = [];
  const inner: Wall[] = [];
  for (let k = 0; k < 24; k++) {
    // The rails run so that the road is always on the same side of them.
    if (side > 0) {
      outer.push(seg(p(632, k + 1), p(632, k)));
      inner.push(seg(p(392, k), p(392, k + 1)));
    } else {
      outer.push(seg(p(632, k), p(632, k + 1)));
      inner.push(seg(p(392, k + 1), p(392, k)));
    }
  }
  return { outer, inner };
}

/** Rails of the elevated wide corner: 18 sectors of the arc round (-1024, -1024) at r = 1416 and 1656. */
function cornerRails(): { inner: Wall[]; outer: Wall[] } {
  const axis = (c: number, s: number): [number, number] => [c, s];
  const p = (r: number, k: number) => arcPoint(-1024, -1024, r, sectorAngle(k, 18, 256), axis);
  const inner: Wall[] = [];
  const outer: Wall[] = [];
  for (let k = 0; k < 18; k++) {
    inner.push(seg(p(1416, k), p(1416, k + 1)));
    outer.push(seg(p(1656, k + 1), p(1656, k)));
  }
  return { inner, outer };
}

let cache: Wall[] | null = null;
export function buildWalls(): Wall[] {
  if (cache) return cache;
  const w: Wall[] = [];
  const right = helixRails(1);
  const left = helixRails(-1);
  // 0..99: helix rails, each followed by the rail of the straight that leaves the helix at deck height.
  w.push(...right.outer, line(632, 344, 0, -1));
  w.push(...right.inner, line(392, 178, 0, 1));
  w.push(...left.outer, line(-632, -5, 0, 1));
  w.push(...left.inner, line(-392, 178, 0, -1));
  // 100..104: road edges (left, right), a line across the road at its middle and at both ends.
  w.push(line(-120, 0, 0, 1), line(120, 0, 0, -1), line(0, 0, -1, 0), line(0, 512, -1, 0), line(0, -512, 1, 0));
  // 105..140: elevated corner rails.
  const c = cornerRails();
  w.push(...c.inner, ...c.outer);
  // 141..148: slalom blocks (74 x 30, on alternate halves of the road).
  const b2 = box(-97, -23, 241, 271);
  const b1 = box(23, 97, -271, -241);
  w.push(b2.n, b2.s, b2.e, b2.w, b1.s, b1.n, b1.e, b1.w);
  // 149..154: tunnel walls (120..270 either side) and the tunnel mouths.
  w.push(line(-270, -512, 0, -1), line(270, 512, 0, 1), line(-120, -512, 0, 1), line(120, 512, 0, -1));
  w.push(line(-270, 512, -1, 0), line(-120, -512, 1, 0));
  // 155..158: pipe sides (164 out) and the obstacle's ends.
  w.push(line(164, 512, 0, 1), line(-164, -512, 0, -1), line(0, -75, 1, 0), line(0, 75, -1, 0));
  // 159, 160: pipe entry sides, narrowing from 164 at the pipe to 115 at the open end.
  w.push(seg([164, 512], [164 + 49, 512 + 1024]), seg([-115, -512], [-115 + 49, -512 - 1024]));
  // 161..184: buildings.
  const barn = box(-150, 150, -150, 150);
  w.push(barn.s, barn.n, barn.e, barn.w);
  const gas = box(-200, 260, -80, 80);
  w.push(line(240, -80, 1, 0), gas.w, gas.e, gas.n);
  const diner = box(-180, 180, -100, 100);
  w.push(diner.s, diner.e, diner.w, diner.n);
  const office = box(-200, 200, -200, 200);
  w.push(office.s, office.n, office.w, office.e);
  const mill = box(-114, 114, -114, 114);
  w.push(mill.w, mill.n, mill.e, mill.s);
  const boat = box(-170, 260, -110, 110);
  w.push(boat.s, boat.e, boat.w, boat.n);
  // 185: inside the roll corkscrew, a line through the centre a little off the axis.
  w.push(line(0, 0, 120, 1024));
  // 186..189: the highway median: its sides and the wedge where it starts.
  w.push(line(120, 512, 0, 1), line(120, 334, 120, 166), line(-120, 334, 0, -1), seg([0, 168], [120, 2]));
  // 190: unused.
  w.push({ angle: 0, x: 0, z: 0 });
  return (cache = w);
}
