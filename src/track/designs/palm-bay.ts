// Palm Bay (tropical, easy): round the lagoon. The seafront highway, a banked hairpin at the marina, and the long
// causeway bridge across the lagoon.
import { TrackBuilder } from '../author';

export default function palmBay() {
  const b = new TrackBuilder('Palm Bay', 'tropical');
  b.lake(9, 12, 19, 23); // the lagoon
  b.lake(0, 0, 29, 2, false); // the sea along the south edge
  b.start(7, 6, 'E')
    .straight(1)
    .highway(8) // the seafront
    .straight(1)
    .bank('L')
    .banked(1)
    .bankedTurn('L') // the marina hairpin
    .banked(2)
    .unbank()
    .straight(6)
    .left('large')
    .ramp('up', 'ramp-bridge')
    .deck(2)
    .deck(9, 'elevated-span') // the causeway
    .deck(2)
    .ramp('down', 'ramp-bridge')
    .left('large')
    .straight(9)
    .left('large')
    .close();
  b.props('palm', [[8, 4], [11, 4], [14, 4], [17, 4], [20, 4], [6, 8], [9, 8], [24, 4], [25, 9], [25, 13], [3, 12], [3, 16], [8, 25], [21, 25]]);
  b.props('boat', [[13, 16, 1], [16, 20, 0], [5, 1, 1], [19, 1, 0], [26, 0, 1]]);
  b.props('tennis-court', [[11, 9], [13, 9]]);
  b.props('diner', [[26, 6]]);
  b.scatter('palm', 30, [0, 3, 29, 29], 7);
  return b.build();
}
