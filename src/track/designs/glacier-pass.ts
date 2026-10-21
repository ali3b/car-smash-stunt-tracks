// Glacier Pass (alpine, medium): spiral up the helix onto the viaduct, which carries the road up to the glacier.
// Across the ice field on the top, down the east face, and back through the avalanche galleries, passing under
// the viaduct.
import { TrackBuilder } from '../author';

export default function glacierPass() {
  const b = new TrackBuilder('Glacier Pass', 'alpine');
  b.hill(16, 14, 25, 24); // the glacier
  b.lake(18, 10, 25, 12); // the meltwater lake
  b.start(5, 5, 'E')
    .straight(5)
    .helix('left')
    .deck(2)
    .deckLeft()
    .deck(2)
    .span() // the valley road passes under here
    .deck(3)
    .ramp('down') // the viaduct lands on the glacier (a ramp laid down its slope: level with the top)
    .ice(3)
    .right('large', 'ice')
    .ice(4)
    .left('small', 'ice')
    .straight(2)
    .right('large')
    .straight(3) // down the east face
    .right('large')
    .straight(10)
    .right('large')
    .straight(2)
    .tunnel(3) // avalanche galleries
    .straight(5)
    .cross() // under the viaduct
    .straight(11)
    .left('large')
    .straight(1)
    .left('large')
    .close();
  b.props('tree', [[7, 7], [9, 3], [14, 3], [20, 4], [24, 5], [12, 11], [9, 13], [6, 16], [11, 20], [5, 23]]);
  b.props('boat', [[21, 11, 1]]);
  b.props('diner', [[7, 3]]);
  b.props('windmill', [[19, 20]]);
  b.scatter('tree', 60, [0, 0, 29, 29], 21);
  return b.build();
}
