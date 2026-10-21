// Avalanche Run (alpine, extreme): from the line at the foot of the west valley, a long run to the double jump over
// the twin streams, the frozen loop, then a choice: the low road up the valley through the avalanche shelters, or
// the high road straight over Widow's Peak on dirt and ice. Home down the west valley: the bollards, a jump over
// the frozen tarn and black ice to the line.
import { TrackBuilder } from '../author';

export default function avalancheRun() {
  const b = new TrackBuilder('Avalanche Run', 'alpine');
  b.hill(10, 18, 20, 24); // Widow's Peak
  b.lake(12, 0, 12, 4, false); // the twin streams
  b.lake(16, 0, 16, 4, false);
  b.lake(0, 13, 5, 13, false); // the frozen tarn under the west jump
  const main = b.start(2, 8, 'S')
    .straight(3)
    .left('large')
    .straight(7)
    .jump(1) // the double jump: down, across the island, up again
    .straight(1)
    .jump(1)
    .ice(2)
    .loop() // the frozen loop
    .straight(1)
    .left('large');
  const high = main.fork('L');
  main
    .straight(3)
    .tunnel(4) // avalanche shelters
    .straight(13)
    .left('large')
    .straight(6)
    .merge('L')
    .straight(12)
    .left('large')
    .slalom(2) // the bollards
    .dirt(3)
    .straight(6)
    .jump(1) // over the tarn
    .ice(3) // black ice to the line
    .close();
  high
    .straight(6)
    .right('large')
    .dirt(5)
    .straight(6) // up Widow's Peak
    .ice(7)
    .straight(2) // and down
    .join();
  b.props('tree', [[6, 6], [11, 7], [20, 7], [26, 10], [27, 20], [21, 28], [8, 28], [5, 12], [6, 21], [13, 14]]);
  b.props('windmill', [[13, 22], [19, 20]]);
  b.props('diner', [[6, 1]]);
  b.props('gas-station', [[26, 24]]);
  b.scatter('tree', 70, [0, 0, 29, 29], 17);
  return b.build();
}
