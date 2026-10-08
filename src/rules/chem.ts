/** 初中 chemistry: formulas, the reactions a reaction spot can run, and balancing. No Phaser dependencies. */

/** Relative molecular mass. Air averages 29: a gas lighter than air rises. */
export const MASS: Record<string, number> = {
  H2: 2,
  CH4: 16,
  NH3: 17,
  H2O: 18,
  N2: 28,
  O2: 32,
  CO2: 44,
  Cl2: 71,
  HCl: 36.5,
};
export const AIR = 29;
export const GASES = new Set(['H2', 'O2', 'CO2', 'Cl2', 'CH4', 'N2']);
export const rises = (formula: string) => GASES.has(formula) && MASS[formula] < AIR;

/** Atoms in a formula: 'Fe3O4' → { Fe: 3, O: 4 }. */
export function atoms(formula: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [, element, n] of formula.matchAll(/([A-Z][a-z]?)(\d*)/g))
    out[element] = (out[element] ?? 0) + (n ? Number(n) : 1);
  return out;
}
export const atomCount = (formula: string) => Object.values(atoms(formula)).reduce((a, b) => a + b, 0);

/** [formula, coefficient] */
export type Term = [string, number];
export interface Reaction {
  in: Term[];
  out: Term[];
  /** Needs electricity (electrolysis). */
  power?: boolean;
  /** Needs sunlight (photosynthesis). */
  light?: boolean;
}
export const REACTIONS: Reaction[] = [
  {
    in: [
      ['H', 1],
      ['H', 1],
    ],
    out: [['H2', 1]],
  },
  {
    in: [
      ['O', 1],
      ['O', 1],
    ],
    out: [['O2', 1]],
  },
  {
    in: [
      ['H2', 2],
      ['O2', 1],
    ],
    out: [['H2O', 2]],
  },
  {
    in: [
      ['C', 1],
      ['O2', 1],
    ],
    out: [['CO2', 1]],
  },
  {
    in: [
      ['H2', 1],
      ['Cl2', 1],
    ],
    out: [['HCl', 2]],
  },
  {
    in: [
      ['Na', 2],
      ['Cl2', 1],
    ],
    out: [['NaCl', 2]],
  },
  {
    in: [['H2O', 2]],
    out: [
      ['H2', 2],
      ['O2', 1],
    ],
    power: true,
  },
  {
    in: [
      ['CO2', 1],
      ['H2O', 1],
    ],
    out: [
      ['starch', 1],
      ['O2', 1],
    ],
    light: true,
  },
];

const key = (formulas: string[]) => [...formulas].sort().join('+');
/** The reaction these substances start, in any order, under these conditions. */
export function findReaction(inputs: string[], { power = false, light = false } = {}): Reaction | null {
  const k = key(inputs);
  return (
    REACTIONS.find(
      (r) => key(r.in.map(([f]) => f)) === k && Boolean(r.power) === power && Boolean(r.light) === light,
    ) ?? null
  );
}

/** Conservation of mass: every element has as many atoms on each side. Starch is left out (not a formula). */
export function balanced(reaction: Pick<Reaction, 'in' | 'out'>): boolean {
  const count = (side: Term[]) => {
    const n: Record<string, number> = {};
    for (const [f, c] of side) for (const [el, k] of Object.entries(atoms(f))) n[el] = (n[el] ?? 0) + k * c;
    return n;
  };
  const [a, b] = [count(reaction.in), count(reaction.out)];
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].every((el) => a[el] === b[el]);
}

/** One substance in an equation being balanced: formula, balanced coefficient, side (0 left, 1 right), current coefficient. */
export interface Species {
  formula: string;
  need: number;
  side: 0 | 1;
  count: number;
}
/** Unbalanced equations, as [formula, balanced coefficient, side]. Each starts with every coefficient at 1. */
export const EQUATIONS: Record<string, [string, number, 0 | 1][]> = {
  h2: [
    ['H', 2, 0],
    ['H2', 1, 1],
  ],
  o2: [
    ['O', 2, 0],
    ['O2', 1, 1],
  ],
  water: [
    ['H2', 2, 0],
    ['O2', 1, 0],
    ['H2O', 2, 1],
  ],
  split: [
    ['H2O', 2, 0],
    ['H2', 2, 1],
    ['O2', 1, 1],
  ],
  methane: [
    ['CH4', 1, 0],
    ['O2', 2, 0],
    ['CO2', 1, 1],
    ['H2O', 2, 1],
  ],
  hcl: [
    ['H2', 1, 0],
    ['Cl2', 1, 0],
    ['HCl', 2, 1],
  ],
  salt: [
    ['Na', 2, 0],
    ['Cl2', 1, 0],
    ['NaCl', 2, 1],
  ],
  iron: [
    ['Fe', 3, 0],
    ['O2', 2, 0],
    ['Fe3O4', 1, 1],
  ],
  alumina: [
    ['Al', 4, 0],
    ['O2', 3, 0],
    ['Al2O3', 2, 1],
  ],
};
export const makeEquation = (id: string): Species[] =>
  EQUATIONS[id].map(([formula, need, side]) => ({ formula, need, side, count: 1 }));
/** Molecules still missing before the equation balances. */
export const missing = (species: Species[]) => species.reduce((a, s) => a + s.need - s.count, 0);

/** Elements whose atoms do not match across the arrow. */
export function unbalanced(species: Species[]): Set<string> {
  const n: [Record<string, number>, Record<string, number>] = [{}, {}];
  for (const s of species)
    for (const [el, k] of Object.entries(atoms(s.formula))) n[s.side][el] = (n[s.side][el] ?? 0) + k * s.count;
  const elements = new Set([...Object.keys(n[0]), ...Object.keys(n[1])]);
  return new Set([...elements].filter((el) => (n[0][el] ?? 0) !== (n[1][el] ?? 0)));
}

/** "2H2+O2→2H2O" */
export function equationText(species: Species[]): string {
  const side = (k: 0 | 1) =>
    species
      .filter((s) => s.side === k)
      .map((s) => (s.count > 1 ? s.count : '') + s.formula)
      .join('+');
  return `${side(0)}→${side(1)}`;
}
