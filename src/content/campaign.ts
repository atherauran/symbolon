import { isOperator } from '../math/evaluate';
import { gridPoint } from '../physics/model';
import type { Beat, BossPhase, DeviceSpec, RailSpec } from '../game/types';
import type { LieKind } from '../rules/lies';

export interface Zone {
  beat: Beat;
  /** Boss phases of one duel are consecutive zones sharing one arena and one x-range. */
  duel: boolean;
  /** The encounter this zone belongs to. */
  title: string;
  subtitle: string;
  /** World x-range [start, end). Zones sit edge to edge along one rightward spine. */
  x: [number, number];
}
export interface Region {
  title: string;
  subtitle: string;
  knowledge: string;
  numeral: string;
  symbol: string;
  /** The kind of Falsehood that walks this region, and how often one is large or huge. */
  lie: LieKind;
  large: number;
  huge: number;
  zones: Zone[];
}
/** Zone widths in world pixels: a device zone spans start ground + device; a duel arena is one screen. */
export const ZONE_WIDTH = 2300;
export const ARENA_WIDTH = 1280;

const CHAPTERS: Omit<Region, 'zones'>[] = [
  {
    title: 'One Becomes Many',
    lie: 'math',
    large: 0,
    huge: 0,
    subtitle: 'Every possibility starts with one.',
    knowledge:
      'Use whole numbers and basic operations. You will also work with measurement, magnification, and cell division.',
    numeral: 'I',
    symbol: '+',
  },
  {
    title: 'Below Zero',
    lie: 'math',
    large: 0.2,
    huge: 0,
    subtitle: 'There is something on the other side.',
    knowledge:
      'Work with negative numbers, fractions, powers, and square roots. Apply speed and solve linear equations.',
    numeral: 'II',
    symbol: '−',
  },
  {
    title: 'Balance',
    lie: 'force',
    large: 0.25,
    huge: 0,
    subtitle: 'Whatever you do to one side…',
    knowledge: 'Use equal-arm balances and lever moments. Convert mass to weight with G = mg.',
    numeral: 'III',
    symbol: '=',
  },
  {
    title: 'Line of Sight',
    lie: 'math',
    large: 0.3,
    huge: 0.05,
    subtitle: 'Light always keeps its angle.',
    knowledge: 'Use reflection, the Pythagorean theorem, convex lenses, and straight-line equations.',
    numeral: 'IV',
    symbol: '°',
  },
  {
    title: 'Waves',
    lie: 'math',
    large: 0.3,
    huge: 0.1,
    subtitle: 'Everything that moves has a rhythm.',
    knowledge: 'Read amplitude and frequency, then apply them to sound, heart rate, and wave speed.',
    numeral: 'V',
    symbol: '∿',
  },
  {
    title: 'The Unknown',
    lie: 'math',
    large: 0.35,
    huge: 0.15,
    subtitle: 'Every unknown has a value.',
    knowledge: 'Combine cell division, levers, timing, reflection, and frequency, then solve a quadratic equation.',
    numeral: 'VI',
    symbol: '𝑥',
  },
];

/** A rail's slots follow its canonical solution: operators get round slots. Nothing is pre-filled. */
const rail = (label: string, solution: string[], extra: Partial<RailSpec> = {}): RailSpec => ({
  label,
  solution,
  slots: solution.map((t) => (isOperator(t) ? 'operator' : 'value')),
  effect: 'device',
  ...extra,
});
const beat = (
  name: string,
  objective: string,
  spec: RailSpec,
  layout: Beat['layout'],
  rest: Partial<Beat> = {},
): Beat => ({ name, objective, rail: spec, layout, ...rest });
const device = (name: string, objective: string, spec: RailSpec, params: DeviceSpec, rest: Partial<Beat> = {}): Beat =>
  beat(name, objective, spec, 'device', { device: params, ...rest });
type Draft = Omit<Zone, 'x'> & { chapter: number };
const puzzle = (chapter: number, title: string, subtitle: string, beats: Beat[]): Draft[] =>
  beats.map((beat) => ({ chapter, beat, duel: false, title, subtitle }));
const duel = (chapter: number, title: string, subtitle: string, phases: BossPhase[]): Draft[] =>
  phases.map((beat) => ({ chapter, beat, duel: true, title, subtitle }));
const phase = (
  name: string,
  component: string,
  attack: string,
  counter: string,
  spec: RailSpec,
  hazard: Beat['hazard'],
  hits: number,
  rest: Partial<BossPhase> = {},
): BossPhase => ({
  name,
  component,
  objective: counter,
  rail: spec,
  attack,
  counter,
  hazard,
  layout: 'arena',
  hits,
  ...rest,
});

/*
 * Objectives say what to achieve, never the number or the method. Every value a puzzle needs is in the scene:
 * tiles, bricks, rulers, stopwatches, counters, labels on loads. `intro` states a law once, when it first matters.
 */
const ENCOUNTERS: Draft[][] = [
  // Chapter I — One Becomes Many
  puzzle(1, 'A small beginning', 'You. And one possibility.', [
    beat(
      'First bridge',
      'Build a bridge across the gap.',
      rail('Bridge length', ['1', '+', '1'], { effect: 'extend', target: 2 }),
      'gap',
      {
        loose: [
          ['1', 200, 590],
          ['+', 440, 590],
        ],
        intro: 'E to pick up. E to place. F to make it real.',
      },
    ),
  ]),
  puzzle(1, 'One becomes many', 'Every cell began as one.', [
    device(
      'Division',
      'Grow a bridge of cells that fills the gap.',
      rail('Divisions', ['1', '+', '2']),
      { kind: 'division', cells: 8, size: 0.75 },
      { enemies: 1, enemyTokens: ['2'], intro: 'A cell divides into two.', law: 'cell division' },
    ),
  ]),
  puzzle(1, 'Measure twice', 'The world has its own numbers.', [
    device(
      'Read the ruler',
      'Bridge the gap exactly.',
      rail('Bridge length · m', ['2', '+', '2'], { units: 'm' }),
      { kind: 'measure', gap: 4, start: 0 },
      { intro: 'Lengths are measured in meters.', law: 'length', enemies: 2, enemyTokens: ['4', '+'] },
    ),
    device(
      'Under the lens',
      'Make the cell’s image fit the lock exactly.',
      rail('Magnification · eyepiece × objective', ['5', '*', '10']),
      { kind: 'microscope', mode: 'zoom', specimen: 0.1, gate: 5 },
      { enemies: 2, enemyTokens: ['5', '10'], hazard: 'bolts', law: 'magnification', loose: [['*', 200, 590]] },
    ),
  ]),
  puzzle(1, 'Applied mathematics', 'Put some force behind the idea.', [
    device(
      'Lift off',
      'Launch yourself onto the high ledge.',
      rail('Launch height · m', ['2', '*', '3'], { units: 'm' }),
      { kind: 'launch', height: 6 },
      { enemies: 3, enemyTokens: ['3', '+', '2'], hazard: 'bolts', noOperatorRack: true, loose: [['*', 60, 590]] },
    ),
  ]),
  duel(1, 'The Unknown', 'It has been watching from the margins.', [
    phase(
      'Eight cells',
      '𝑥',
      'DIVIDE',
      'Split your counter into one shard for every shield cell.',
      rail('Divisions', ['1', '+', '2']),
      'bolts',
      2,
      { device: { kind: 'division', cells: 8, size: 0.5 } },
    ),
    phase(
      'Twice the unknown',
      '𝑥 + 𝑥 = 6',
      'DOUBLE',
      'Find 𝑥. Its value breaks the armour.',
      rail('𝑥 =', ['1', '+', '2'], { effect: 'solve', substitute: 'x+x', target: 6 }),
      'bolts',
      2,
      { intro: '𝑥 stands for a number nobody has found yet.', law: 'unknowns' },
    ),
  ]),
  // Chapter II — Below Zero
  puzzle(2, 'The other way round', 'Not everything faces the way you do.', [
    device(
      'A broken ruler',
      'Bridge the gap exactly.',
      rail('Bridge length · m', ['7', '-', '3'], { units: 'm' }),
      { kind: 'measure', gap: 4, start: 3 },
      { enemies: 2, enemyTokens: ['7', '-'], hazard: 'negative' },
    ),
    device(
      'Upside down',
      'Bring the cell to the centre of the view.',
      rail('Slide shift · mm, rightward +', ['0', '-', '3'], { units: 'mm' }),
      { kind: 'microscope', mode: 'center', offset: -3 },
      { enemies: 2, enemyTokens: ['3', '0'], hazard: 'negative', law: 'inverted images' },
    ),
  ]),
  puzzle(2, 'Food chain', 'Energy thins out on the way up.', [
    device(
      'Energy pyramid',
      'Power the fox lift up to the ledge.',
      rail('Sunlight for the grass · kJ', ['4', '*', '5', '*', '5'], { units: 'kJ' }),
      { kind: 'foodchain', demo: 25, ratio: 0.2, ledge: 4 },
      {
        intro: 'Energy passes up a food chain, but most of it is lost at every step.',
        law: 'food chain energy',
        enemies: 2,
        enemyTokens: ['5', '*'],
        loose: [['4', 860, 590]],
        hazard: 'bolts',
      },
    ),
  ]),
  puzzle(2, 'Keep pace', 'Arrive at exactly the right moment.', [
    device(
      'Right on time',
      'Send the cart so it arrives as the bar levels.',
      rail('Cart speed · m/s', ['8', '/', '4'], { units: 'm/s' }),
      { kind: 'cart', distance: 8, time: 4 },
      {
        intro: 'speed = distance ÷ time',
        law: 'speed',
        enemies: 1,
        enemyTokens: ['8'],
        hazard: 'vectors',
        loose: [['/', 860, 590]],
      },
    ),
  ]),
  puzzle(2, 'Something is watching', 'A familiar shape. An unfamiliar intention.', [
    device(
      'Bloom',
      'Grow the colony across the gap. Keep hold of your operators.',
      rail('Culture time · s', ['2', '*', '4'], { units: 's' }),
      { kind: 'division', cells: 16, size: 0.5, period: 2 },
      {
        enemies: 2,
        enemyTokens: ['2', '^'],
        hazard: 'negative',
        theft: true,
        intro: 'A power repeats multiplication: 2⁴ = 2 × 2 × 2 × 2.',
        law: 'powers',
      },
    ),
    device(
      'Bring it down to size',
      'Reach the top of the wall.',
      rail('Steps', ['√', '9']),
      { kind: 'stairs', height: 3, bricks: true },
      { enemies: 3, enemyTokens: ['9', '√'], hazard: 'negative', theft: true, law: 'square roots' },
    ),
  ]),
  duel(2, 'The Unknown returns', '𝑥 has a value of its own.', [
    phase(
      'An unknown value',
      '𝑥 + 5 = 2',
      'SUBTRACT',
      'Find 𝑥. Its value breaks the armour.',
      rail('𝑥 =', ['2', '-', '5'], { effect: 'solve', substitute: 'x+5', target: 2 }),
      'negative',
      2,
      { intro: 'Whatever you do to one side, do to the other.', law: 'linear equations' },
    ),
    phase(
      'Three of a kind',
      '3𝑥 − 4 = 8',
      'DIVIDE',
      'Find 𝑥. Guard your operators.',
      rail('𝑥 =', ['8', '/', '2'], { effect: 'solve', substitute: '3*x-4', target: 8 }),
      'bolts',
      3,
      { theft: true },
    ),
    phase(
      'The charge',
      '𝑥 → ← 1',
      'CHARGE',
      'Meet 𝑥 at the trap at the same moment.',
      rail('Cart speed · m/s', ['6', '/', '2'], { units: 'm/s' }),
      'charge',
      2,
      {
        device: { kind: 'meet', distance: 6, runnerDistance: 6, runnerSpeed: 3, trapX: 700 },
        loose: [['6', 1150, 590]],
      },
    ),
  ]),
  // Chapter III — Balance
  puzzle(3, 'Both sides', 'A level beam is a bridge.', [
    device(
      'The scale',
      'Add your mass to the right pan. A level balance is a bridge.',
      rail('Your mass · kg', ['7', '-', '3'], { units: 'kg' }),
      {
        kind: 'lever',
        pans: true,
        arms: [3, 3],
        loads: [
          { side: -1, arm: 3, mass: 7 },
          { side: 1, arm: 3, mass: 3 },
        ],
        control: 'force',
        controlArm: 3,
      },
      { intro: 'An equal-arm balance compares masses.', law: 'equal-arm balance', enemies: 2, enemyTokens: ['7', '3'] },
    ),
    device(
      'Identical crates',
      'Both crates hold the same mass. Level the balance.',
      rail('Each crate · kg', ['6', '/', '2'], { units: 'kg' }),
      {
        kind: 'lever',
        pans: true,
        arms: [3, 3],
        loads: [
          { side: -1, arm: 3, mass: 0, label: '𝑥', count: 2 },
          { side: -1, arm: 3, mass: 1 },
          { side: 1, arm: 3, mass: 7 },
        ],
        control: 'mass',
      },
      { enemies: 2, enemyTokens: ['6', '/'], hazard: 'bolts' },
    ),
  ]),
  puzzle(3, 'The lever', 'Distance is a kind of strength.', [
    device(
      'Where to hang it',
      'Choose where your 6 N weight hangs.',
      rail('Hook distance · m', ['8', '-', '4'], { units: 'm' }),
      { kind: 'lever', arms: [3, 5], loads: [{ side: -1, arm: 3, force: 8 }], control: 'arm', controlForce: 6 },
      {
        intro: 'Lever balance: F₁ × L₁ = F₂ × L₂',
        law: 'lever balance',
        enemies: 2,
        enemyTokens: ['8', '4'],
        hazard: 'bolts',
      },
    ),
    device(
      'Mass and weight',
      'This load is marked in kilograms. Level the lever.',
      rail('Hook weight · N', ['2', '*', '10', '/', '4'], { units: 'N' }),
      { kind: 'lever', arms: [2, 4], loads: [{ side: -1, arm: 1, mass: 2 }], control: 'force', controlArm: 4 },
      {
        intro: 'Weight: G = mg, where g = 10 N/kg.',
        law: 'weight',
        enemies: 2,
        enemyTokens: ['10', '*'],
        hazard: 'bolts',
      },
    ),
  ]),
  puzzle(3, 'Heavy company', 'They brought weight with them.', [
    device(
      'Under fire',
      'Level the lever. The operators are out in the field.',
      rail('Hook weight · N', ['9', '*', '2', '/', '3'], { units: 'N' }),
      { kind: 'lever', arms: [3, 4], loads: [{ side: -1, arm: 2, force: 9 }], control: 'force', controlArm: 3 },
      {
        enemies: 3,
        enemyTokens: ['2', '9', '3'],
        hazard: 'bolts',
        noOperatorRack: true,
        loose: [
          ['*', 140, 590],
          ['/', 880, 590],
        ],
      },
    ),
  ]),
  // Chapter IV — Line of Sight
  puzzle(4, 'Angles and mirrors', 'Light always keeps its angle.', [
    device(
      'Mirror',
      'Tilt the mirror so the beam goes straight up into the sensor.',
      rail('Mirror tilt · °', ['9', '*', '5'], { units: '°' }),
      {
        kind: 'mirror',
        laser: [890, 458],
        beam: 0,
        mirror: [1270, 458],
        sensor: [1270, 138],
        control: 'tilt',
        bridge: [950, 1540],
      },
      {
        intro: 'Law of reflection: the angle in equals the angle out.',
        law: 'reflection',
        enemies: 2,
        enemyTokens: ['9', '5'],
        hazard: 'bolts',
      },
    ),
    device(
      'Bank shot',
      'Tilt the mirror to send the rising beam level into the sensor.',
      rail('Mirror tilt · °', ['3', '*', '5'], { units: '°' }),
      {
        kind: 'mirror',
        laser: [1000, 578],
        beam: 30,
        mirror: [1346.41, 378],
        sensor: [1720, 378],
        control: 'tilt',
        bridge: [1150, 1650],
      },
      { enemies: 3, enemyTokens: ['3', '5', '*'], hazard: 'vectors', theft: true },
    ),
  ]),
  puzzle(4, 'The long side', 'Area remembers length.', [
    device(
      'The long side',
      'Fill the square on the long side. The plank takes its side length.',
      rail('Square area · m²', ['3', '^', '2', '+', '4', '^', '2'], { units: 'm²' }),
      { kind: 'squares', run: 4, rise: 3 },
      {
        intro: 'The squares on the two short sides add up to the square on the long side.',
        law: 'Pythagorean theorem',
        enemies: 2,
        enemyTokens: ['3', '4'],
        loose: [['^', 860, 590]],
        hazard: 'bolts',
      },
    ),
    device(
      'Raise the ledge',
      'The plank is 5 m long. Raise the ledge until the plank locks in.',
      rail('Square on the rising side · m²', ['5', '^', '2', '-', '3', '^', '2'], { units: 'm²' }),
      { kind: 'squares', run: 3, plank: 5 },
      { enemies: 3, enemyTokens: ['5', '^', '3'], hazard: 'negative', theft: true },
    ),
  ]),
  puzzle(4, 'Through the lens', 'Light can draw a picture.', [
    device(
      'Same size',
      'Place the arrow so a sharp image lands on the screen.',
      rail('Object distance · m', ['2', '*', '2'], { units: 'm' }),
      { kind: 'lens', mode: 'same', focal: 2 },
      {
        intro: 'A convex lens gathers sunlight at its focus.',
        law: 'convex lens',
        enemies: 2,
        enemyTokens: ['2', '*'],
        hazard: 'bolts',
      },
    ),
    device(
      'Larger than life',
      'The lock needs a sharp image taller than the arrow.',
      rail('Object distance · m', ['3', '/', '2'], { units: 'm' }),
      { kind: 'lens', mode: 'enlarge', focal: 1, track: 9 },
      { enemies: 3, enemyTokens: ['3', '/', '2'], hazard: 'vectors', theft: true },
    ),
  ]),
  duel(4, 'Line of the Unknown', 'The same unknown. A larger world.', [
    phase(
      'A steep approach',
      '𝑦 = 𝑘𝑥',
      'SLOPE',
      'Fire along y = kx through the core.',
      rail('Slope 𝑘', ['6', '/', '3']),
      'bolts',
      3,
      { device: { kind: 'line', control: 'k', b: 0, core: [3, 6] }, core: gridPoint(3, 6) },
    ),
    phase(
      'Shifted',
      '𝑦 = 2𝑥 + 𝑏',
      'INTERCEPT',
      'Shift the line until it passes through the core.',
      rail('Intercept 𝑏', ['5', '-', '8']),
      'vectors',
      3,
      { device: { kind: 'line', control: 'b', k: 2, core: [4, 5] }, core: gridPoint(4, 5) },
    ),
  ]),
  // Chapter V — Waves
  puzzle(5, 'Riding the wave', 'Motion has a rhythm.', [
    device(
      'Frequency',
      'Count the far platforms. Make the near ones vibrate in step.',
      rail('Frequency · Hz', ['6', '/', '4'], { units: 'Hz' }),
      { kind: 'wave', mode: 'frequency', ledge: 1, frequency: 0, cycles: 6, seconds: 4 },
      {
        intro: '1 Hz is one vibration per second.',
        law: 'frequency',
        enemies: 2,
        enemyTokens: ['6', '4'],
        hazard: 'waves',
      },
    ),
    device(
      'Louder',
      'Match the sound lock’s waveform.',
      rail('Amplitude · divisions', ['9', '/', '3']),
      { kind: 'scope', mode: 'amplitude', amplitude: 3, frequency: 300 },
      {
        intro: 'A larger amplitude is a louder sound.',
        law: 'loudness',
        enemies: 2,
        enemyTokens: ['9', '/'],
        hazard: 'bolts',
      },
    ),
    device(
      'Higher',
      'Match the sound lock’s pitch.',
      rail('Frequency · Hz', ['4', '*', '10', '*', '10'], { units: 'Hz' }),
      { kind: 'scope', mode: 'frequency', amplitude: 2, frequency: 400 },
      {
        intro: 'A higher frequency is a higher pitch.',
        law: 'pitch',
        enemies: 3,
        enemyTokens: ['4', '10', '*'],
        hazard: 'waves',
        theft: true,
      },
    ),
  ]),
  puzzle(5, 'Heartbeat', 'The oldest rhythm there is.', [
    device(
      'Pacemaker',
      'Set the pacemaker to beat in step with the heart.',
      rail('Pacemaker · beats/min', ['8', '*', '9']),
      { kind: 'pulse', bpm: 72, window: 15 },
      { enemies: 3, enemyTokens: ['9', '8', '*'], hazard: 'waves', law: 'heart rate' },
    ),
  ]),
  puzzle(5, 'The rope', 'A wave carries its shape along.', [
    device(
      'Wavelength',
      'Measure the rope’s wave speed. Shake it so every stone rises together.',
      rail('Frequency · Hz', ['8', '/', '4'], { units: 'Hz' }),
      { kind: 'rope', distance: 8, seconds: 2, spacing: 2 },
      {
        intro: 'wave speed = wavelength × frequency',
        law: 'wave speed',
        enemies: 2,
        enemyTokens: ['8', '4'],
        hazard: 'vectors',
      },
    ),
  ]),
  // Chapter VI — The Unknown
  duel(6, 'Find 𝑥', 'One last expression.', [
    phase(
      'The colony',
      '𝑥² − 2𝑥 + 1 + [2ⁿ] + FL + s/t + θ + f',
      'MULTIPLY',
      'Split your counter into one shard for every shield cell.',
      rail('Divisions', ['2', '*', '2']),
      'negative',
      2,
      { device: { kind: 'division', cells: 16, size: 0.5 }, theft: true },
    ),
    phase(
      'The heavy term',
      '𝑥² − 2𝑥 + 1 + [FL] + s/t + θ + f',
      'CRUSH',
      'Level the lever against its heavy term.',
      rail('Hook weight · N', ['8', '*', '3', '/', '4'], { units: 'N' }),
      'bolts',
      2,
      {
        device: {
          kind: 'lever',
          arms: [3, 4],
          loads: [{ side: -1, arm: 3, force: 8 }],
          control: 'force',
          controlArm: 4,
          pivotX: 960,
          pivotY: 330,
        },
        core: [1000, 170],
      },
    ),
    phase(
      'The racing term',
      '𝑥² − 2𝑥 + 1 + [s/t] + θ + f',
      'CHARGE',
      'Meet it at the trap at the same moment.',
      rail('Cart speed · m/s', ['7', '/', '2'], { units: 'm/s' }),
      'charge',
      2,
      { device: { kind: 'meet', distance: 7, runnerDistance: 4, runnerSpeed: 2, trapX: 700 } },
    ),
    phase(
      'The light shield',
      '𝑥² − 2𝑥 + 1 + [θ] + f',
      'BLIND',
      'Bounce your beam off the mirror into its core.',
      rail('Mirror tilt · °', ['5', '*', '4', '+', '10'], { units: '°' }),
      'waves',
      2,
      {
        device: {
          kind: 'mirror',
          laser: [340, 600],
          beam: 50,
          mirror: [533, 370],
          sensor: [878, 309],
          control: 'tilt',
        },
        core: [878, 309],
      },
    ),
    phase(
      'Frequency armour',
      '𝑥² − 2𝑥 + 1 + [f]',
      'OSCILLATE',
      'Match its armour’s pitch.',
      rail('Frequency · Hz', ['5', '*', '10', '*', '10'], { units: 'Hz' }),
      'vectors',
      2,
      { device: { kind: 'scope', mode: 'frequency', amplitude: 3, frequency: 500 }, theft: true },
    ),
    phase(
      'Find 𝑥',
      '𝑥² − 2𝑥 + 1 = 0',
      'UNKNOWN',
      'Which value of 𝑥 makes it zero?',
      rail('𝑥 =', ['1'], { effect: 'solve', substitute: 'x^2-2*x+1', target: 0 }),
      'vectors',
      1,
      { intro: 'The last problem on the page.', law: 'quadratic equations' },
    ),
  ]),
];

/** Lays every zone out along the spine, region by region. Phases of one duel share their arena. */
function layout(): Region[] {
  const regions: Region[] = CHAPTERS.map((chapter) => ({ ...chapter, zones: [] }));
  let x = 0;
  for (const encounter of ENCOUNTERS)
    encounter.forEach(({ chapter, ...zone }, i) => {
      const start = zone.duel && i > 0 ? x - ARENA_WIDTH : x;
      x = start + (zone.duel ? ARENA_WIDTH : ZONE_WIDTH);
      regions[chapter - 1].zones.push({ ...zone, x: [start, x] });
    });
  return regions;
}
export const REGIONS = layout();
export const ZONE_COUNT = REGIONS.reduce((n, r) => n + r.zones.length, 0);

/** Zones in play order, with their region and index. */
export const ALL_ZONES = REGIONS.flatMap((region, r) => region.zones.map((zone, z) => ({ zone, region: r, index: z })));
export const zoneOrder = (region: number, zone: number) =>
  ALL_ZONES.findIndex((entry) => entry.region === region && entry.index === zone);

/**
 * The known set at a checkpoint: every token and law of every rail solved before it. Racks only offer known
 * tokens; new ones are found loose in the world or dropped by Falsehoods. Each concept lengthens focus.
 */
export function knownBefore(region: number, zone: number): string[] {
  const known = new Set<string>();
  for (const { zone: done } of ALL_ZONES.slice(0, zoneOrder(region, zone))) {
    done.beat.rail.solution.forEach((t) => known.add(t));
    if (done.beat.law) known.add(done.beat.law);
  }
  return [...known];
}
