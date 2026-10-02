import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  cellsAfter,
  chainEnergy,
  imageDistance,
  imageOffset,
  judge,
  netMoment,
  reflect,
  traceLight,
  travelTime,
  wavelength,
  weight,
} from './model.ts';
import type { Beat, DeviceSpec } from '../game/types.ts';

const beat = (device: DeviceSpec): Beat => ({
  name: '',
  objective: '',
  layout: 'device',
  device,
  rail: { label: '', slots: ['value'], solution: ['1'], effect: 'device' },
});
const ok = (device: DeviceSpec, value: number) => judge(beat(device), { num: value }).success;

test('textbook laws', () => {
  assert.equal(travelTime(8, 2), 4);
  assert.equal(weight({ side: 1, arm: 1, mass: 2 }), 20);
  assert.equal(
    netMoment([
      { side: -1, arm: 2, force: 6 },
      { side: 1, arm: 3, force: 4 },
    ]),
    0,
  );
  assert.equal(reflect(0, 45), 90);
  assert.equal(reflect(30, 15), 0);
  assert.equal(wavelength(4, 2), 2);
});

test('carts arrive only when the bar is level', () => {
  const cart: DeviceSpec = { kind: 'cart', distance: 8, time: 4 };
  assert.ok(ok(cart, 2));
  assert.ok(!ok(cart, 3) && !ok(cart, -2) && !ok(cart, 0));
  const ferry: DeviceSpec = { kind: 'cart', distance: 6, time: 3, reverse: true };
  assert.ok(ok(ferry, -2) && !ok(ferry, 2));
});

test('levers tip toward the larger moment', () => {
  const lever: DeviceSpec = {
    kind: 'lever',
    arms: [3, 4],
    loads: [{ side: -1, arm: 2, force: 6 }],
    control: 'force',
    controlArm: 3,
  };
  assert.ok(ok(lever, 4));
  assert.match(judge(beat(lever), { num: 5 }).readout, /tips right/);
  assert.match(judge(beat(lever), { num: 3 }).readout, /tips left/);
  const hook: DeviceSpec = {
    kind: 'lever',
    arms: [3, 5],
    loads: [{ side: -1, arm: 3, force: 8 }],
    control: 'arm',
    controlForce: 6,
  };
  assert.ok(ok(hook, 4) && !ok(hook, 6));
});

test('light reflects off the mirror into the sensor', () => {
  const mirror: Extract<DeviceSpec, { kind: 'mirror' }> = {
    kind: 'mirror',
    laser: [890, 458],
    beam: 0,
    mirror: [1270, 458],
    sensor: [1270, 138],
    control: 'tilt',
  };
  assert.ok(traceLight(mirror, 45).hit);
  assert.ok(!traceLight(mirror, 30).hit);
  const floor: Extract<DeviceSpec, { kind: 'mirror' }> = {
    kind: 'mirror',
    laser: [1000, 298],
    beam: 0,
    mirror: [1320, 618],
    tilt: 0,
    sensor: [1640, 298],
    control: 'aim',
  };
  assert.ok(traceLight(floor, 45).hit);
  assert.ok(!traceLight(floor, 30).hit, 'a shallower beam lands past the mirror');
});

test('ropes accept any frequency whose crests land on every stone', () => {
  const rope: DeviceSpec = { kind: 'rope', distance: 8, seconds: 2, spacing: 2 };
  assert.ok(ok(rope, 2) && ok(rope, 4));
  assert.ok(!ok(rope, 3) && !ok(rope, 1));
});

test('cells double with every whole division', () => {
  assert.equal(cellsAfter(3), 8);
  const gap: DeviceSpec = { kind: 'division', cells: 8, size: 0.75 };
  assert.ok(ok(gap, 3) && !ok(gap, 2) && !ok(gap, 4) && !ok(gap, 1.5));
  const culture: DeviceSpec = { kind: 'division', cells: 16, size: 0.5, period: 2 };
  assert.ok(ok(culture, 8) && ok(culture, 9), 'the fourth division happens at 8 s; the fifth not until 10 s');
  assert.ok(!ok(culture, 7) && !ok(culture, 10));
});

test('microscope images are magnified and inverted', () => {
  assert.ok(ok({ kind: 'microscope', mode: 'zoom', specimen: 0.1, gate: 5 }, 50));
  assert.ok(!ok({ kind: 'microscope', mode: 'zoom', specimen: 0.1, gate: 5 }, 40));
  assert.equal(imageOffset(-3, -3), 0);
  assert.equal(imageOffset(-3, 3), -6, 'moving the slide right moves the image left');
  assert.ok(
    ok({ kind: 'microscope', mode: 'center', offset: -3 }, -3) &&
      !ok({ kind: 'microscope', mode: 'center', offset: -3 }, 3),
  );
});

test('food chains pass energy up level by level', () => {
  assert.ok(Math.abs(chainEnergy(100, 0.2, 2) - 4) < 1e-9);
  const chain: DeviceSpec = { kind: 'foodchain', demo: 25, ratio: 0.2, ledge: 4 };
  assert.ok(ok(chain, 100) && !ok(chain, 20) && !ok(chain, 125));
});

test('convex lenses follow the f and 2f rules', () => {
  assert.equal(imageDistance(4, 2), 4);
  assert.equal(imageDistance(1.5, 1), 3);
  const same: DeviceSpec = { kind: 'lens', mode: 'same', focal: 2 };
  assert.ok(ok(same, 4) && !ok(same, 3) && !ok(same, 2) && !ok(same, 1));
  const enlarge: DeviceSpec = { kind: 'lens', mode: 'enlarge', focal: 1, track: 9 };
  assert.ok(ok(enlarge, 1.5) && ok(enlarge, 1.2));
  assert.ok(
    !ok(enlarge, 2) && !ok(enlarge, 3) && !ok(enlarge, 1) && !ok(enlarge, 1.1),
    'too far away, same size, no image, or beyond the track',
  );
});

test('launch pads, pacemakers and brick walls need the exact value', () => {
  assert.ok(ok({ kind: 'launch', height: 6 }, 6) && !ok({ kind: 'launch', height: 6 }, 5));
  assert.ok(ok({ kind: 'pulse', bpm: 72, window: 15 }, 72) && !ok({ kind: 'pulse', bpm: 72, window: 15 }, 18));
  assert.ok(ok({ kind: 'stairs', height: 6, bricks: true }, 6) && !ok({ kind: 'stairs', height: 6, bricks: true }, 5));
});
