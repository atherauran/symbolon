/**
 * Falsehoods: false statements that walk. Each throw that moves one toward true repairs it a little;
 * anything else bounces off. One kind per region theme:
 *   math   terms … = rhs; a thrown number adds a term toward true, never past it
 *   force  forces that claim to balance (L = R); a thrown number adds a force to the weaker side
 *   chem   an equation whose atoms don't match; a thrown molecule adds one where the equation is short
 *   bio    a food chain with links missing; a thrown organism puts a missing link back
 * A thrown ÷ halves how wrong a math or force Falsehood is. No Phaser dependencies.
 */
import { brokenChain } from './bio';
import { equationText, makeEquation, missing, type Species } from './chem';

export type LieKind = 'math' | 'force' | 'chem' | 'bio';
export type Lie =
  | { kind: 'math'; terms: number[]; rhs: number }
  | { kind: 'force'; left: number[]; right: number[] }
  | { kind: 'chem'; species: Species[] }
  | { kind: 'bio'; chain: string[]; hidden: number[] };
export type Thrown =
  | { kind: 'number'; value: number }
  | { kind: 'halve' }
  | { kind: 'chem'; formula: string }
  | { kind: 'org'; name: string };
export type Size = 'small' | 'large' | 'huge';
export type Rng = () => number;

/** How wrong a lie may start, by size. */
export const SIZES: Record<Size, [number, number]> = { small: [1, 3], large: [4, 9], huge: [10, 18] };
/** The first Falsehood of each kind is always the same, so it can be learned. */
export const FIRST = {
  math: { terms: [1, 1], rhs: 3 },
  negative: { terms: [2, 2], rhs: 3 },
  huge: { terms: [5, 5], rhs: 22 },
};
const TERMS: [number, number] = [1, 4];

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const randInt = (rng: Rng, a: number, b: number) => a + Math.floor(rng() * (b - a + 1));

/** How far from true: the number of repairs it still needs at one unit (or one molecule, one link) each. */
export function wrongness(lie: Lie): number {
  switch (lie.kind) {
    case 'math':
      return Math.abs(lie.rhs - sum(lie.terms));
    case 'force':
      return Math.abs(sum(lie.left) - sum(lie.right));
    case 'chem':
      return missing(lie.species);
    case 'bio':
      return lie.hidden.length;
  }
}
export const isTrue = (lie: Lie) => wrongness(lie) === 0;
/** A math lie whose left side is too big needs negative numbers. */
export const needsNegative = (lie: Lie) => lie.kind === 'math' && sum(lie.terms) > lie.rhs;

/** Body size from how wrong it is. Chemistry and biology lies are short, so they grow sooner. */
export function sizeOf(lie: Lie): Size {
  const [small, large] = lie.kind === 'chem' ? [1, 6] : lie.kind === 'bio' ? [1, 9] : [3, 9];
  const n = wrongness(lie);
  return n <= small ? 'small' : n <= large ? 'large' : 'huge';
}

/** Applies a throw. Returns false, leaving the lie unchanged, when the throw bounces off. */
export function repair(lie: Lie, thrown: Thrown): boolean {
  if (lie.kind === 'math') {
    const d = lie.rhs - sum(lie.terms);
    if (thrown.kind === 'halve') {
      if (Math.abs(d) < 2) return false;
      lie.rhs = sum(lie.terms) + Math.sign(d) * Math.ceil(Math.abs(d) / 2);
      return true;
    }
    if (thrown.kind !== 'number') return false;
    const n = thrown.value;
    // Only toward true, never past it.
    if (!Number.isInteger(n) || !n || Math.sign(n) !== Math.sign(d) || Math.abs(n) > Math.abs(d)) return false;
    lie.terms.push(n);
    return true;
  }
  if (lie.kind === 'force') {
    const d = wrongness(lie),
      leftStrong = sum(lie.left) > sum(lie.right);
    if (thrown.kind === 'halve') {
      if (d < 2) return false;
      const weak = sum(leftStrong ? lie.right : lie.left),
        strong = [weak + Math.ceil(d / 2)];
      if (leftStrong) lie.left = strong;
      else lie.right = strong;
      return true;
    }
    if (thrown.kind !== 'number' || !Number.isInteger(thrown.value) || thrown.value <= 0 || thrown.value > d)
      return false;
    (leftStrong ? lie.right : lie.left).push(thrown.value);
    return true;
  }
  if (lie.kind === 'chem') {
    if (thrown.kind !== 'chem') return false;
    const short = lie.species.find((s) => s.formula === thrown.formula && s.count < s.need);
    if (!short) return false;
    short.count++;
    return true;
  }
  if (thrown.kind !== 'org') return false;
  const i = lie.hidden.find((k) => lie.chain[k] === thrown.name);
  if (i === undefined) return false;
  lie.hidden = lie.hidden.filter((k) => k !== i);
  return true;
}

export interface LieOptions {
  size?: Size;
  /** Math only: the left side is the bigger one. */
  negative?: boolean;
  /** The first Falsehood of its kind (and, for math, of its variant). */
  first?: boolean;
  /** Chem: ids from EQUATIONS to choose from. */
  equations?: string[];
  /** Bio: brokenChain arguments to choose from. */
  chains?: [number, number, number][];
}

export function makeLie(kind: LieKind, rng: Rng, options: LieOptions = {}): Lie {
  const pick = <T>(list: T[]) => list[randInt(rng, 0, list.length - 1)];
  const size = options.size ?? 'small';
  if (kind === 'math') {
    if (options.first) {
      const { terms, rhs } = options.negative ? FIRST.negative : size === 'huge' ? FIRST.huge : FIRST.math;
      return { kind, terms: [...terms], rhs };
    }
    const off = randInt(rng, ...SIZES[size]);
    if (options.negative) {
      const rhs = randInt(rng, 1, 4),
        left = rhs + off,
        a = randInt(rng, Math.ceil(left / 3), Math.floor((2 * left) / 3));
      return { kind, terms: [a, left - a], rhs };
    }
    const terms = [randInt(rng, ...TERMS), randInt(rng, ...TERMS)];
    return { kind, terms, rhs: sum(terms) + off };
  }
  if (kind === 'force') {
    if (options.first) return { kind, left: [2], right: [1] };
    const off = randInt(rng, ...SIZES[size]),
      weak = randInt(rng, 1, 5);
    return rng() < 0.5 ? { kind, left: [weak + off], right: [weak] } : { kind, left: [weak], right: [weak + off] };
  }
  if (kind === 'chem') return { kind, species: makeEquation(options.first ? 'h2' : pick(options.equations ?? ['h2'])) };
  const [index, from, to] = options.first ? [0, 0, 2] : pick(options.chains ?? [[0, 0, 2]]);
  return { kind, ...brokenChain(index, from, to) };
}

/** What the Falsehood claims, as display text. */
export function lieText(lie: Lie): string {
  const terms = (values: number[]) =>
    values.map((n, i) => (i ? (n < 0 ? ` − ${-n}` : ` + ${n}`) : n < 0 ? `−${-n}` : String(n))).join('');
  switch (lie.kind) {
    case 'math':
      return `${terms(lie.terms)} = ${lie.rhs < 0 ? `−${-lie.rhs}` : lie.rhs}`;
    case 'force':
      return `${terms(lie.left)} N = ${terms(lie.right)} N`;
    case 'chem':
      return equationText(lie.species).replaceAll('+', ' + ').replace('→', ' → ');
    case 'bio':
      return lie.chain.map((o, i) => (lie.hidden.includes(i) ? '?' : o)).join(' → ');
  }
}
