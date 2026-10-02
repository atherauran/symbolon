export type CharacterId = 'orange' | 'green' | 'yellow' | 'blue' | 'red';
export interface Character {
  id: CharacterId;
  name: string;
  color: number;
  hex: string;
  trait: string;
  description: string;
  speed: number;
  jump: number;
  focus: number;
  handling: number;
  force: number;
  timing: number;
}
export const CHARACTERS: Character[] = [
  {
    id: 'orange',
    name: 'Orange',
    color: 0xff962f,
    hex: '#ff962f',
    trait: 'A little more possibility.',
    description: 'Balanced movement. Longer focus while shaping equations.',
    speed: 1,
    jump: 1,
    focus: 6,
    handling: 1,
    force: 1,
    timing: 1,
  },
  {
    id: 'green',
    name: 'Green',
    color: 0x83db86,
    hex: '#83db86',
    trait: 'Everything in its own time.',
    description: 'Wider counter windows. More precise throws.',
    speed: 1,
    jump: 1,
    focus: 4,
    handling: 1,
    force: 1,
    timing: 1.25,
  },
  {
    id: 'yellow',
    name: 'Yellow',
    color: 0xf4d76b,
    hex: '#f4d76b',
    trait: 'See what comes next.',
    description: 'See throw trajectories and an expression’s value before evaluating it.',
    speed: 1,
    jump: 1,
    focus: 4,
    handling: 1,
    force: 1,
    timing: 1,
  },
  {
    id: 'blue',
    name: 'Blue',
    color: 0x72baff,
    hex: '#72baff',
    trait: 'Stay one step ahead.',
    description: 'Faster running, higher jumps, and quicker symbol handling.',
    speed: 1.12,
    jump: 1.08,
    focus: 4,
    handling: 1.25,
    force: 1,
    timing: 1,
  },
  {
    id: 'red',
    name: 'Red',
    color: 0xf27479,
    hex: '#f27479',
    trait: 'Make yourself an impact.',
    description: 'Stronger throws and melee knockback.',
    speed: 1,
    jump: 1,
    focus: 4,
    handling: 1,
    force: 1.35,
    timing: 1,
  },
];

/** Math effects turn a value directly into geometry. They carry no units and make no physical claims. */
export type MathEffect = 'extend' | 'solve';
export type SlotType = 'value' | 'operator';
export interface RailSpec {
  label: string;
  slots: SlotType[];
  /** One carried token per slot. Tests check it against the tokens unlocked by then. */
  solution: string[];
  effect: MathEffect | 'device';
  target?: number;
  units?: string;
  /** For `solve`: an equation's left side in x. The built value is substituted and compared with `target`. */
  substitute?: string;
}

/** A physical load on a lever. `mass` loads are in kg and weigh mass × g; `force` loads are in N. */
export interface Load {
  side: -1 | 1;
  arm: number;
  force?: number;
  mass?: number;
  label?: string;
  count?: number;
}
/**
 * Physics devices simulate one 初中 law exactly. Positions are world pixels; physical quantities are SI.
 * Every device is judged by `judge()` in physics/model.ts, which the device animation follows.
 */
export type DeviceSpec =
  | { kind: 'measure'; gap: number; start: number }
  | { kind: 'stairs'; height: number; bricks?: boolean }
  | { kind: 'launch'; height: number }
  | { kind: 'cart'; distance: number; time: number; reverse?: boolean }
  | { kind: 'meet'; distance: number; runnerDistance: number; runnerSpeed: number; trapX: number }
  | {
      kind: 'lever';
      loads: Load[];
      control: 'force' | 'arm' | 'mass';
      controlArm?: number;
      controlForce?: number;
      arms: [number, number];
      pans?: boolean;
      pivotX?: number;
      pivotY?: number;
    }
  | { kind: 'rotate'; length: number }
  | {
      kind: 'mirror';
      laser: [number, number];
      beam: number;
      mirror: [number, number];
      tilt?: number;
      sensor: [number, number];
      control: 'tilt' | 'aim';
      floor?: number;
      bridge?: [number, number];
    }
  | { kind: 'squares'; run: number; rise?: number; plank?: number }
  | {
      kind: 'wave';
      mode: 'amplitude' | 'frequency';
      ledge: number;
      frequency: number;
      cycles?: number;
      seconds?: number;
    }
  | { kind: 'scope'; mode: 'amplitude' | 'frequency'; amplitude: number; frequency: number }
  | { kind: 'rope'; distance: number; seconds: number; spacing: number }
  | { kind: 'line'; control: 'k' | 'b'; k?: number; b?: number; core: [number, number] }
  /** Cell division: one cell becomes 2ⁿ. With `period`, the rail sets culture time and the cell divides once per period. */
  | { kind: 'division'; cells: number; size: number; period?: number }
  /** `zoom`: image length = specimen length × magnification. `center`: the image is inverted, so it moves opposite to the slide. */
  | { kind: 'microscope'; mode: 'zoom'; specimen: number; gate: number }
  | { kind: 'microscope'; mode: 'center'; offset: number }
  /** Grass → rabbit → fox. Each level keeps `ratio` of the energy below; the fox lift rises 1 m per kJ. */
  | { kind: 'foodchain'; demo: number; ratio: number; ledge: number }
  | { kind: 'pulse'; bpm: number; window: number }
  /** Convex lens. `same`: a fixed screen at 2f. `enlarge`: the screen slides along a track of `track` m. */
  | { kind: 'lens'; mode: 'same' | 'enlarge'; focal: number; track?: number };

export type Hazard = 'bolts' | 'negative' | 'vectors' | 'waves' | 'charge';
export interface Beat {
  name: string;
  objective: string;
  rail: RailSpec;
  layout: 'gap' | 'arena' | 'device';
  device?: DeviceSpec;
  enemies?: number;
  enemyTokens?: string[];
  hazard?: Hazard;
  intro?: string;
  unlock?: string[];
  /** Tokens placed in the world instead of on a rack, as [token, x, y]. */
  loose?: [string, number, number][];
  /** The Unknown knocks carried operators out of the rail. */
  theft?: boolean;
  noOperatorRack?: boolean;
  /** Replaces the racks with exactly these tokens, one take each. */
  stock?: string[];
}
export interface BossPhase extends Beat {
  component: string;
  attack: string;
  counter: string;
  hits: number;
  core?: [number, number];
}
export interface Encounter {
  id: string;
  chapter: number;
  title: string;
  subtitle: string;
  kind: 'puzzle' | 'action' | 'boss';
  unlock: string[];
  beats: Beat[];
  phases?: BossPhase[];
}
export interface CheckpointState {
  version: 3;
  character: CharacterId;
  encounter: number;
  beat: number;
  furthest: number;
  unlocked: string[];
  complete: boolean;
  elapsed: number;
}
export interface Settings {
  sound: boolean;
  reducedMotion: boolean;
  volume: number;
}
export type GameEvent =
  | {
      type: 'hud';
      hp: number;
      focus: number;
      maxFocus: number;
      objective: string;
      chapter: number;
      title: string;
      phase: string;
      progress: number;
    }
  | { type: 'toast'; text: string; sub?: string }
  | { type: 'chapter'; chapter: number; title: string; knowledge: string }
  | { type: 'pause' }
  | { type: 'death' }
  | { type: 'complete'; elapsed: number }
  | { type: 'save'; save: CheckpointState };
