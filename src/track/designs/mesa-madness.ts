// Mesa Madness (desert, hard): a corkscrew roll on the flats, then the helix up onto Table Mesa and out along
// skyways from mesa to mesa, and a flat-out run down off Eagle Mesa to jump the dry wash on the way home. A skyway
// leaves a mesa top on a ramp laid down its slope (a level deck carried from the top) and lands the same way.
import { TrackBuilder } from '../author';

export default function mesaMadness() {
  const b = new TrackBuilder('Mesa Madness', 'desert');
  b.hill(11, 7, 16, 10); // Table Mesa
  b.hill(19, 19, 25, 25); // Red Mesa
  b.hill(3, 19, 8, 25); // Eagle Mesa
  const t = b.start(5, 2, 'E')
    .straight(2)
    .roll()
    .straight(1)
    .left('large')
    .helix('right') // up onto Table Mesa
    .ramp('down') // across its slope, level with the top
    .straight(2)
    .right('large')
    .straight(3)
    .ramp('up') // off the east edge on a skyway
    .deck(2, 'elevated-solid')
    .deckLeft()
    .deck(2)
    .deck(3, 'elevated-span')
    .deck(1)
    .ramp('down') // onto Red Mesa
    .straight(3)
    .left('large')
    .straight(1)
    .ramp('up') // the long skyway to Eagle Mesa
    .deck(8, 'elevated-solid')
    .ramp('down')
    .straight(4)
    .left('large')
    .straight(3)
    .straight(1) // down off the edge
    .straight(9) // flat out down the wash
    .jump(1, 'ramp-solid') // over the last water in it
    .straight(2)
    .left('large');
  t.close();
  b.lake(2, 7, 4, 7, false); // the last water in the wash
  b.props('cactus', [[14, 7], [15, 9], [23, 21], [24, 24], [6, 21], [7, 25], [8, 4], [18, 3], [26, 8]]);
  b.props('gas-station', [[7, 0]]);
  b.props('windmill', [[13, 3]]);
  b.scatter('cactus', 50, [0, 0, 29, 29], 8);
  return b.build();
}
