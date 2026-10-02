import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { evaluate, format, isOperator, near } from './evaluate.ts';
import { CAMPAIGN, unlockedThrough } from '../content/campaign.ts';
import { judge } from '../physics/model.ts';

test('arithmetic, fractions, precedence, and roots', () => {
  for (const [source, value] of [
    ['2+2', 4],
    ['2*3', 6],
    ['2+3*4', 14],
    ['-2^2', -4],
    ['2^3', 8],
    ['1/2+1/4', 0.75],
    ['√9', 3],
    ['√(16)', 4],
    ['0-1/2', -0.5],
    ['3^2+4^2', 25],
  ] as const) {
    const result = evaluate(source);
    assert.ok(result.valid, source);
    assert.ok(near(result.value!.num, value), source);
  }
  assert.equal(evaluate('1/2+1/4').display, '3/4');
  assert.equal(evaluate('0-2').display, '−2');
  assert.deepEqual(evaluate('√(9/4)').value!.fraction, [3, 2]);
});
test('substitution solves authored equations', () => {
  assert.equal(evaluate('x+5', evaluate('2-5').value).value!.num, 2);
  assert.equal(evaluate('x^2-2*x+1', evaluate('1').value).value!.num, 0);
});
test('invalid or beyond-curriculum expressions stay inactive', () => {
  for (const source of ['1/0', '2+', '√(0-1)', '0^0', '2√9', 'sin(1)', 'i*i', 'sum(1,1,4)', 'x', '+2', 'alert(1)'])
    assert.equal(evaluate(source).valid, false, source);
});

test('objectives never state the answer', () => {
  CAMPAIGN.forEach((encounter) =>
    (encounter.phases ?? encounter.beats).forEach((beat) => {
      const value = evaluate(beat.rail.solution.join('')).value!;
      if (!beat.device || beat.device.kind !== 'lever')
        assert.ok(!beat.objective.includes(format(value)), `${beat.name}: ${beat.objective}`);
    }),
  );
});

test('every rail is solvable with carried tokens and no operator is pre-filled', () => {
  CAMPAIGN.forEach((encounter, encounterIndex) => {
    (encounter.phases ?? encounter.beats).forEach((beat, beatIndex) => {
      const name = `${encounter.title}: ${beat.name}`,
        spec = beat.rail;
      assert.ok(!('initial' in spec), name);
      assert.equal(spec.solution.length, spec.slots.length, name);
      spec.solution.forEach((token, i) =>
        assert.equal(spec.slots[i], isOperator(token) ? 'operator' : 'value', `${name} slot ${i}`),
      );
      const loose = (beat.loose ?? []).map(([token]) => token);
      const racks =
        beat.stock ??
        unlockedThrough(encounterIndex, beatIndex).filter(
          (t) => !loose.includes(t) && !(beat.noOperatorRack && isOperator(t)),
        );
      for (const token of spec.solution)
        assert.ok(racks.includes(token) || loose.includes(token), `${name}: ${token} is not available`);
      if (beat.stock) {
        const left = [...beat.stock, ...loose];
        for (const token of spec.solution) {
          assert.ok(left.includes(token), `${name}: not enough ${token} in stock`);
          left.splice(left.indexOf(token), 1);
        }
      }
      const result = evaluate(spec.solution.join(''));
      assert.ok(result.valid, name);
      assert.ok(judge(beat, result.value!).success, `${name}: ${judge(beat, result.value!).readout}`);
      assert.equal(judge(beat, { num: result.value!.num + 7 }).success, false, `${name}: a wrong value also succeeds`);
    });
  });
});
