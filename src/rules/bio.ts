/** 初中 biology: who eats whom, and how a gene pair passes from parents to children. No Phaser dependencies. */

/** Each organism and what it eats; arrows in a food chain point from the eaten to the eater. */
export const EATS: Record<string, string> = {
  rabbit: 'grass',
  fox: 'rabbit',
  insect: 'grass',
  frog: 'insect',
  snake: 'frog',
  eagle: 'snake',
};
export const CHAINS = [
  ['grass', 'rabbit', 'fox'],
  ['grass', 'insect', 'frog', 'snake', 'eagle'],
];
export const PRODUCERS = new Set(['grass']);

/** A true food chain starts with a producer, and every arrow is a real meal. */
export function validChain(chain: (string | null)[]): boolean {
  if (chain.some((o) => !o) || !PRODUCERS.has(chain[0]!)) return false;
  return chain.every((o, i) => i === 0 || EATS[o!] === chain[i - 1]);
}

/** Part of a real chain, from link `from` to link `to`, with the links between them missing. */
export function brokenChain(index: number, from: number, to: number): { chain: string[]; hidden: number[] } {
  const chain = CHAINS[index].slice(from, to + 1);
  return { chain, hidden: chain.map((_, k) => k).slice(1, -1) };
}

/**
 * A single gene pair, written dominant first ('Aa'). Each parent passes on one of its two genes,
 * so a cross has four equally likely children.
 */
export function cross(a: string, b: string): string[] {
  const child = (x: string, y: string) => (x === 'A' || y !== 'A' ? x + y : y + x);
  return [child(a[0], b[0]), child(a[0], b[1]), child(a[1], b[0]), child(a[1], b[1])];
}
/** The dominant trait shows whenever one dominant gene is present. */
export const dominant = (genes: string) => genes.includes('A');
