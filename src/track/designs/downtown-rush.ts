// Downtown Rush (city, medium): a figure-eight through the blocks. Main Street runs under the flyover and through
// the big crossroads; the east loop climbs over Main Street on the flyover; a short cut through the car park
// (dirt, with bollards) saves the long way round the park.
import { TrackBuilder } from '../author';

export default function downtownRush() {
  const b = new TrackBuilder('Downtown Rush', 'city');
  b.lake(9, 19, 12, 21); // the park pond
  const main = b.start(15, 5, 'N')
    .straight(3)
    .span(false) // under the flyover
    .straight(5)
    .lay('crossroads')
    .straight(2);
  const carPark = main.fork('L');
  main
    .straight(3)
    .left('large')
    .straight(6)
    .left('large')
    .straight(3)
    .merge('L')
    .straight(1)
    .left('large')
    .straight(7)
    .cross() // the crossroads again
    .straight(6)
    .right('large')
    .straight(3)
    .right('large')
    .straight(5)
    .ramp('up', 'ramp-solid')
    .cross() // over Main Street on the flyover
    .ramp('down', 'ramp-solid')
    .straight(6)
    .left('large')
    .straight(3)
    .left('large')
    .straight(1)
    .tunnel(3) // the underpass
    .straight(2)
    .left('large')
    .close();
  carPark.dirt(2).slalom(2).dirt(4).join();
  b.props('office', [[13, 7], [17, 7], [13, 12], [17, 12], [11, 11], [19, 11], [20, 18], [21, 21], [17, 20], [18, 25], [10, 25], [3, 12], [3, 20], [26, 9], [26, 18], [10, 13], [8, 6]]);
  b.props('gas-station', [[17, 4]]);
  b.props('tennis-court', [[9, 16], [11, 16]]);
  b.props('diner', [[20, 13]]);
  b.props('tree', [[8, 20], [13, 20], [10, 22]]);
  b.scatter('office', 30, [0, 0, 29, 29], 5);
  return b.build();
}
