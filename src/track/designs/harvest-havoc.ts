// Harvest Havoc (country, extreme): everything at once across the fields. A loop off the line, the chicane by the
// farmhouse, a long run along the field to jump the river, then a choice: through the grain pipe and round the
// banked bend by the barns, or the field road with its corkscrew roll. The helix climbs to the aqueduct over the
// river, and a last jump over the mill stream brings you home.
import { TrackBuilder } from '../author';

export default function harvestHavoc() {
  const b = new TrackBuilder('Harvest Havoc', 'country');
  b.lake(15, 0, 15, 29, false); // the river
  b.lake(9, 0, 9, 3, false); // the mill stream
  b.hill(21, 19, 25, 24); // Orchard Hill
  const main = b.start(3, 3, 'N')
    .straight(2)
    .loop()
    .straight(1)
    .chicane('R') // by the farmhouse
    .straight(3)
    .right('large')
    .straight(8) // flat out along the field
    .jump(1); // over the river
  const fields = main.fork('R', 'large');
  main
    .pipe(3, [1]) // the grain pipe
    .left('large')
    .straight(2) // up Orchard Hill
    .ice(3)
    .straight(5)
    .bank('R')
    .bankedTurn('R')
    .bankedTurn('R')
    .banked(2)
    .unbank()
    .straight(3)
    .loop()
    .straight(13)
    .merge('R', 'large');
  fields.straight(1).roll().straight(3).left('large').straight(7).join();
  main
    .straight(2)
    .right('large')
    .straight(1)
    .helix('right')
    .deck(6)
    .deck(4, 'elevated-span') // the aqueduct
    .ramp('down', 'ramp-solid')
    .straight(2)
    .jump(1, 'ramp-bridge') // over the mill stream
    .straight(3)
    .right('large')
    .close();
  b.props('barn', [[21, 12], [23, 12], [25, 10]]);
  b.props('windmill', [[22, 21], [23, 23], [8, 19]]);
  b.props('tree', [[21, 20], [22, 23], [24, 20], [9, 7], [11, 17], [5, 18]]);
  b.props('boat', [[15, 20, 0], [15, 8, 0]]);
  b.props('gas-station', [[5, 4]]);
  b.scatter('tree', 50, [0, 0, 29, 29], 29);
  return b.build();
}
