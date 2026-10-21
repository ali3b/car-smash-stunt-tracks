// Skyline Stunts (city, hard): the loop at the foot of the towers, then a choice: the low road through the pipe
// under the plaza (two barriers inside) or the high road over the rooftops. Then flat out up the avenue to jump the
// canal, the corkscrew roll, a fast run round the docks and a leap back over the canal on the way home.
import { TrackBuilder } from '../author';

export default function skylineStunts() {
  const b = new TrackBuilder('Skyline Stunts', 'city');
  b.lake(0, 15, 29, 15, false); // the canal
  const main = b.start(4, 3, 'E').straight(2).loop().straight(1);
  const high = main.fork('L', 'large');
  main
    .straight(1)
    .pipe(4, [1, 3]) // under the plaza
    .straight(1)
    .merge('L', 'large');
  high
    .straight(1)
    .ramp('up', 'ramp-bridge')
    .deckRight()
    .deck(6, 'elevated-solid') // over the rooftops
    .deckRight()
    .ramp('down', 'ramp-bridge')
    .straight(1)
    .join();
  main
    .straight(4)
    .left('large')
    .straight(9) // up the avenue
    .jump(1, 'ramp-bridge') // over the canal
    .straight(3)
    .roll()
    .straight(2)
    .left('large')
    .straight(4)
    .chicane('R')
    .straight(16)
    .left('large')
    .straight(8)
    .jump(1, 'ramp-solid') // back over the canal
    .straight(9)
    .left('large')
    .close();
  b.props('office', [[13, 10], [15, 10], [17, 10], [12, 12], [14, 12], [16, 12], [20, 13], [22, 13], [9, 13], [7, 13], [10, 21], [13, 21], [16, 21], [19, 20], [22, 28]]);
  b.props('tennis-court', [[13, 14], [16, 14]]);
  b.props('diner', [[8, 1]]);
  b.props('boat', [[11, 15, 1], [24, 15, 1]]);
  b.scatter('office', 50, [0, 0, 29, 29], 13);
  return b.build();
}
