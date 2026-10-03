import test from 'node:test';
import assert from 'node:assert/strict';
import { axisGutter, axisTicks } from './chartScale.js';

test('the axis top is a round step at or above the tallest bar', () => {
  const ticks = axisTicks(23417, 4);
  assert.deepEqual(ticks, [0, 10000, 20000, 30000]);
  assert.ok(ticks.at(-1) >= 23417);
});

test('a 2.5 step is available, so 96 does not jump to 200', () => {
  assert.deepEqual(axisTicks(96, 4), [0, 25, 50, 75, 100]);
});

test('ticks are evenly spaced and start at zero', () => {
  const ticks = axisTicks(4300, 4);
  assert.equal(ticks[0], 0);
  const step = ticks[1];
  ticks.forEach((tick, index) => assert.equal(tick, step * index));
});

test('no value, zero and nonsense all give a usable axis instead of dividing by zero', () => {
  for (const input of [0, -50, null, undefined, NaN, 'abc']) {
    const ticks = axisTicks(input, 4);
    assert.deepEqual(ticks, [0, 1], `axisTicks(${String(input)})`);
    assert.ok(ticks.at(-1) > 0);
  }
});

test('floating point does not leak into a tick label', () => {
  for (const tick of axisTicks(0.7, 4)) {
    assert.equal(tick, Number(tick.toFixed(6)));
  }
});

test('the axis gutter fits the longest label it is given', () => {
  // "$150,000" is 8 characters, so a shade over 46px plus the padding.
  assert.equal(axisGutter(['$0', '$50,000', '$150,000']), Math.round(8 * 5.8) + 8);
  assert.ok(axisGutter(['$0']) < axisGutter(['$150,000']));
});

test('a short axis does not reserve room a long one would need', () => {
  const short = axisGutter(['0', '25', '50']);
  assert.ok(short < 30, `a two character axis reserved ${short}px`);
});

test('an empty or nonsense axis still returns usable padding', () => {
  assert.equal(axisGutter([]), 8);
  assert.equal(axisGutter([null, undefined]), 8);
});
