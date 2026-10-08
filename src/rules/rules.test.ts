import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  REACTIONS,
  atomCount,
  atoms,
  balanced,
  equationText,
  findReaction,
  makeEquation,
  missing,
  rises,
  unbalanced,
  EQUATIONS,
} from './chem.ts';
import { CHAINS, EATS, brokenChain, cross, dominant, validChain } from './bio.ts';
import { isTrue, lieText, makeLie, needsNegative, repair, sizeOf, wrongness, type Lie } from './lies.ts';

/** Deterministic generator for repeatable tests. */
function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
}

test('formulas count their atoms', () => {
  assert.deepEqual(atoms('Fe3O4'), { Fe: 3, O: 4 });
  assert.deepEqual(atoms('H2O'), { H: 2, O: 1 });
  assert.equal(atomCount('CH4'), 5);
  assert.ok(rises('H2') && rises('CH4') && !rises('CO2') && !rises('O2'));
});

test('reactions run in any order, only under their conditions, and conserve atoms', () => {
  assert.deepEqual(findReaction(['O2', 'H2'])?.out, [['H2O', 2]]);
  assert.equal(findReaction(['H2O']), null, 'water only splits with electricity');
  assert.deepEqual(findReaction(['H2O'], { power: true })?.out, [
    ['H2', 2],
    ['O2', 1],
  ]);
  assert.equal(findReaction(['CO2', 'H2O']), null, 'photosynthesis needs light');
  assert.ok(findReaction(['H2O', 'CO2'], { light: true }));
  for (const r of REACTIONS.filter((r) => !r.light)) assert.ok(balanced(r), JSON.stringify(r));
});

test('unbalanced equations balance at their textbook coefficients', () => {
  for (const id of Object.keys(EQUATIONS)) {
    const species = makeEquation(id);
    assert.ok(unbalanced(species).size > 0, `${id} starts unbalanced`);
    for (const s of species) s.count = s.need;
    assert.equal(unbalanced(species).size, 0, `${id} balances`);
    assert.equal(missing(species), 0);
  }
  assert.equal(equationText(makeEquation('water')), 'H2+O2→H2O');
  const water = makeEquation('water');
  water[0].count = 2;
  water[2].count = 2;
  assert.equal(equationText(water), '2H2+O2→2H2O');
});

test('food chains start with a producer and every arrow is a meal', () => {
  for (const chain of CHAINS) assert.ok(validChain(chain));
  assert.ok(!validChain(['rabbit', 'fox']), 'no producer');
  assert.ok(!validChain(['grass', 'fox']), 'foxes do not eat grass');
  assert.ok(!validChain(['grass', null, 'fox']), 'a missing link');
  for (const [eater, food] of Object.entries(EATS))
    assert.ok(CHAINS.some((c) => c.indexOf(food) === c.indexOf(eater) - 1));
  assert.deepEqual(brokenChain(1, 0, 4), { chain: CHAINS[1], hidden: [1, 2, 3] });
});

test('a gene cross gives four equally likely children', () => {
  assert.deepEqual(cross('Aa', 'Aa'), ['AA', 'Aa', 'Aa', 'aa']);
  assert.equal(cross('Aa', 'Aa').filter(dominant).length, 3, '3 : 1');
  assert.equal(cross('AA', 'aa').filter(dominant).length, 4);
  assert.equal(cross('Aa', 'aa').filter(dominant).length, 2);
});

test('math Falsehoods only move toward true', () => {
  const lie = makeLie('math', seeded(1), { first: true });
  assert.equal(lieText(lie), '1 + 1 = 3');
  assert.ok(!repair(lie, { kind: 'number', value: 2 }), 'past true');
  assert.ok(!repair(lie, { kind: 'number', value: -1 }), 'away from true');
  assert.ok(!repair(lie, { kind: 'halve' }), 'too small to halve');
  assert.equal(lieText(lie), '1 + 1 = 3', 'a bounce changes nothing');
  assert.ok(repair(lie, { kind: 'number', value: 1 }));
  assert.ok(isTrue(lie));
  assert.equal(lieText(lie), '1 + 1 + 1 = 3');

  const negative = makeLie('math', seeded(1), { first: true, negative: true });
  assert.ok(needsNegative(negative) && !repair(negative, { kind: 'number', value: 1 }));
  assert.ok(repair(negative, { kind: 'number', value: -1 }) && isTrue(negative));
  assert.equal(lieText(negative), '2 + 2 − 1 = 3');
});

test('halving rounds up and keeps the side that is wrong', () => {
  const lie: Lie = { kind: 'math', terms: [5, 5], rhs: 22 };
  assert.ok(repair(lie, { kind: 'halve' }));
  assert.equal(wrongness(lie), 6);
  assert.equal(lie.rhs, 16);
  const negative: Lie = { kind: 'math', terms: [9, 4], rhs: 2 };
  assert.ok(repair(negative, { kind: 'halve' }) && wrongness(negative) === 6 && needsNegative(negative));
  const force: Lie = { kind: 'force', left: [2], right: [9] };
  assert.ok(repair(force, { kind: 'halve' }));
  assert.deepEqual(force, { kind: 'force', left: [2], right: [6] });
  assert.ok(repair(force, { kind: 'number', value: 4 }) && isTrue(force));
  assert.equal(lieText(force), '2 + 4 N = 6 N');
});

test('chemistry and biology Falsehoods take the missing molecule or organism', () => {
  const chem = makeLie('chem', seeded(2), { first: true });
  assert.equal(lieText(chem), 'H → H2');
  assert.ok(!repair(chem, { kind: 'chem', formula: 'H2' }), 'H2 is already enough');
  assert.ok(!repair(chem, { kind: 'number', value: 1 }));
  assert.ok(repair(chem, { kind: 'chem', formula: 'H' }) && isTrue(chem));
  const bio = makeLie('bio', seeded(2), { chains: [[1, 0, 4]] });
  assert.equal(lieText(bio), 'grass → ? → ? → ? → eagle');
  assert.ok(!repair(bio, { kind: 'org', name: 'fox' }));
  for (const name of ['snake', 'insect', 'frog']) assert.ok(repair(bio, { kind: 'org', name }));
  assert.ok(isTrue(bio) && !repair(bio, { kind: 'org', name: 'frog' }));
});

test('generated Falsehoods start false, at their size, and can always be repaired', () => {
  const rng = seeded(7);
  for (let i = 0; i < 300; i++) {
    const size = (['small', 'large', 'huge'] as const)[i % 3];
    for (const lie of [
      makeLie('math', rng, { size }),
      makeLie('math', rng, { size, negative: true }),
      makeLie('force', rng, { size }),
      makeLie('chem', rng, { equations: Object.keys(EQUATIONS) }),
      makeLie('bio', rng, {
        chains: [
          [0, 0, 2],
          [1, 0, 4],
          [1, 1, 4],
        ],
      }),
    ]) {
      assert.ok(!isTrue(lie), lieText(lie));
      if (lie.kind === 'math' || lie.kind === 'force') assert.equal(sizeOf(lie), size, lieText(lie));
      if (lie.kind === 'math') assert.ok(lie.terms.every((t) => t > 0) && lie.rhs > 0, lieText(lie));
      // Unit throws, or the right molecule or organism, always finish the job.
      let guard = 40;
      while (!isTrue(lie) && guard--) {
        const thrown =
          lie.kind === 'chem'
            ? { kind: 'chem' as const, formula: lie.species.find((s) => s.count < s.need)!.formula }
            : lie.kind === 'bio'
              ? { kind: 'org' as const, name: lie.chain[lie.hidden[0]] }
              : { kind: 'number' as const, value: needsNegative(lie) ? -1 : 1 };
        assert.ok(repair(lie, thrown));
      }
      assert.ok(isTrue(lie));
    }
  }
});
