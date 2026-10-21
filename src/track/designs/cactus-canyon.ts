// Cactus Canyon (desert, medium): a slalom past the gas station off the line, a long run-up and a jump
// over the creek, a dirt trail that wriggles up to Red Mesa, a lap of the mesa top and a fast run back down.
import { TrackBuilder } from '../author';

export default function cactusCanyon() {
  const b = new TrackBuilder('Cactus Canyon', 'desert');
  b.hill(15, 16, 24, 22); // Red Mesa
  b.lake(15, 0, 15, 11, false); // the creek
  b.lake(12, 10, 16, 13); // the water hole
  b.start(4, 9, 'S')
    .slalom(3) // past the gas station
    .left('large')
    .straight(8) // the long run-up
    .jump(1) // over the creek
    .straight(2)
    .left('large', 'dirt')
    .dirt(3)
    .right('small', 'dirt')
    .left('small', 'dirt')
    .dirt(2)
    .straight(4) // up onto the mesa
    .straight(2)
    .left('large')
    .straight(1)
    .straight(4) // down the west face
    .straight(3)
    .left('large')
    .straight(3)
    .right('small')
    .straight(3)
    .left('small')
    .straight(2)
    .right('large')
    .left('small')
    .close();
  b.props('gas-station', [[2, 7]]);
  b.props('diner', [[3, 2]]);
  b.props('cactus', [[7, 2], [9, 2], [16, 2], [18, 7], [22, 8], [17, 20], [23, 18], [16, 17], [6, 17]]);
  b.scatter('cactus', 45, [0, 0, 29, 29], 11);
  return b.build();
}
