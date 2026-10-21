// Lagoon Leap (tropical, hard): the loop by the beach bar, the reef pipe (mind the coral), a banked hairpin, then
// two leaps over the lagoon's inlets and a wriggle back down the west shore.
import { TrackBuilder } from '../author';

export default function lagoonLeap() {
  const b = new TrackBuilder('Lagoon Leap', 'tropical');
  b.lake(9, 8, 19, 18); // the lagoon
  b.lake(20, 17, 27, 17, false); // east inlet
  b.lake(12, 19, 12, 26, false); // north inlet
  b.land(12, 11, 15, 14); // Turtle Island
  b.start(9, 4, 'E')
    .straight(1)
    .loop()
    .straight(2)
    .pipe(2, [1]) // the reef pipe, with its coral head
    .straight(1)
    .bank('L')
    .banked(1)
    .bankedTurn('L')
    .banked(1)
    .unbank()
    .straight(8) // flat out up the east shore
    .jump(1) // over the east inlet
    .straight(1)
    .left('large')
    .straight(8)
    .jump(1, 'ramp-bridge') // over the north inlet
    .straight(2)
    .left('large')
    .straight(3)
    .chicane('L')
    .straight(2)
    .chicane('R')
    .straight(5)
    .left('large')
    .close();
  b.props('diner', [[12, 2]]); // the beach bar
  b.props('palm', [[10, 2], [14, 2], [17, 6], [12, 12], [14, 13], [13, 14], [25, 14], [20, 23], [11, 23], [5, 12], [5, 17]]);
  b.props('boat', [[11, 16, 1], [17, 10, 0], [12, 24, 0], [25, 17, 1]]);
  b.props('tennis-court', [[3, 6]]);
  b.scatter('palm', 35, [0, 0, 29, 29], 4);
  return b.build();
}
