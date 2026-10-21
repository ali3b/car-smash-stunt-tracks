// The editor's piece palette: every kind in the catalogue, grouped, with its variants (mirror images, handedness)
// and whether it takes a surface.
import { KINDS_WITH_SURFACES } from '../track/pieces';
import type { PieceKind } from '../track/types';

export interface PaletteEntry {
  kind: PieceKind;
  label: string;
  /** Variants the kind comes in, as [value, label]; the first is the default. */
  variants?: [string, string][];
  /** A fixed variant (scenery props). */
  variant?: string;
  /** Takes paved / dirt / ice. */
  surfaces: boolean;
  /** One-letter mark drawn on the grid. */
  mark?: string;
}

export interface PaletteGroup {
  name: string;
  entries: PaletteEntry[];
}

const AB: [string, string][] = [
  ['a', 'A'],
  ['b', 'B (mirror)'],
];
const LR: [string, string][] = [
  ['left', 'Left'],
  ['right', 'Right'],
];

const entry = (kind: PieceKind, label: string, extra: Partial<PaletteEntry> = {}): PaletteEntry => ({ kind, label, surfaces: KINDS_WITH_SURFACES.has(kind), ...extra });

export const PROPS: [string, string][] = [
  ['tree', 'Tree'],
  ['palm', 'Palm'],
  ['cactus', 'Cactus'],
  ['barn', 'Barn'],
  ['windmill', 'Windmill'],
  ['office', 'Office'],
  ['gas-station', 'Gas station'],
  ['diner', 'Diner'],
  ['tennis-court', 'Tennis court'],
  ['boat', 'Boat'],
];

export const PALETTE: PaletteGroup[] = [
  { name: 'Roads', entries: [entry('start-finish', 'Start / finish'), entry('straight', 'Straight'), entry('tunnel', 'Tunnel', { mark: 'T' })] },
  { name: 'Corners', entries: [entry('corner-small', 'Corner'), entry('corner-large', 'Wide corner')] },
  {
    name: 'Elevated',
    entries: [
      entry('elevated', 'Elevated'),
      entry('elevated-solid', 'Solid deck'),
      entry('elevated-span', 'Span'),
      entry('elevated-span-over-road', 'Bridge over road'),
      entry('elevated-corner', 'Elevated corner'),
    ],
  },
  { name: 'Ramps', entries: [entry('ramp', 'Ramp'), entry('ramp-solid', 'Solid ramp'), entry('ramp-bridge', 'Bridge ramp')] },
  {
    name: 'Banked',
    entries: [entry('bank-entry', 'Bank entry', { variants: AB }), entry('banked', 'Banked', { variant: 'a' }), entry('banked-corner', 'Banked corner', { variant: 'a' })],
  },
  {
    name: 'Stunts',
    entries: [
      entry('loop', 'Loop', { mark: 'L' }),
      entry('corkscrew-roll', 'Corkscrew', { mark: 'C' }),
      entry('corkscrew-helix', 'Helix', { variants: LR, mark: 'H' }),
      entry('pipe-entry', 'Pipe entry'),
      entry('pipe', 'Pipe'),
      entry('pipe-obstacle', 'Pipe obstacle', { mark: 'O' }),
      entry('chicane', 'Chicane', { variants: AB }),
      entry('slalom', 'Slalom', { mark: 'S' }),
    ],
  },
  { name: 'Junctions', entries: [entry('crossroads', 'Crossroads'), entry('split-small', 'Fork', { variants: AB }), entry('split-large', 'Wide fork', { variants: AB })] },
  { name: 'Highway', entries: [entry('highway-entry', 'Highway entry'), entry('highway', 'Highway')] },
  { name: 'Scenery', entries: PROPS.map(([v, label]) => entry('scenery', label, { variant: v })) },
];

export const ALL_ENTRIES = PALETTE.flatMap((g) => g.entries);

/** The palette entry for a placed piece (to copy its kind into the brush). */
export function entryFor(kind: PieceKind, variant?: string): PaletteEntry | undefined {
  return ALL_ENTRIES.find((e) => e.kind === kind && (e.kind !== 'scenery' || e.variant === variant));
}

/** Letter drawn on a grid tile for a scenery prop. */
export const propMark = (variant?: string) => (variant ?? '?')[0].toUpperCase();
