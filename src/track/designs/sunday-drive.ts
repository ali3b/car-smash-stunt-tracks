// Sunday Drive (country, easy): a gentle lap of the farm. Wide bends, a chicane past the farmhouse, the covered
// bridge, a dirt lane, and a climb over Windmill Hill. No stunts.
import { TrackBuilder } from '../author';

export default function sundayDrive() {
  const b = new TrackBuilder('Sunday Drive', 'country');
  b.hill(19, 17, 23, 20); // Windmill Hill
  b.lake(11, 9, 15, 13); // the mill pond
  b.start(6, 4, 'E')
    .straight(3)
    .chicane('L')
    .straight(4)
    .tunnel(2) // the covered bridge
    .straight(2)
    .left('large')
    .straight(3)
    .dirt(2)
    .straight(11) // up, over and down Windmill Hill
    .left('large')
    .straight(10)
    .left('large')
    .straight(4)
    .right('large')
    .straight(1)
    .left('large')
    .straight(10)
    .left('large')
    .close();
  b.props('windmill', [[19, 18], [23, 19], [20, 20], [22, 17]]);
  b.props('barn', [[14, 7], [17, 7], [11, 20]]);
  b.props('boat', [[13, 11, 1]]);
  b.scatter('tree', 40, [0, 0, 29, 29], 3);
  return b.build();
}
