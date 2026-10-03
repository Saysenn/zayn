import test from 'node:test';
import assert from 'node:assert/strict';
import { lineRuns, scaleFor, trimEdges } from './sourceTrend.js';

const month = (label, unavailable = false) => ({ label, unavailable });
const labels = (rows) => rows.map((row) => row.label);

test('empty months at the ends are dropped, and a gap in the middle is kept', () => {
  const rows = [month('Jun', true), month('Jul', true), month('Aug'), month('Sep', true), month('Oct')];
  assert.deepEqual(labels(trimEdges(rows)), ['Aug', 'Sep', 'Oct']);
});

test('trailing empty months go too', () => {
  assert.deepEqual(labels(trimEdges([month('Aug'), month('Sep', true)])), ['Aug']);
});

test('a range with nothing in it trims to nothing rather than throwing', () => {
  assert.deepEqual(trimEdges([month('Jun', true), month('Jul', true)]), []);
  assert.deepEqual(trimEdges([]), []);
});

test('a range that is all data is returned untouched', () => {
  const rows = [month('Aug'), month('Sep')];
  assert.deepEqual(labels(trimEdges(rows)), ['Aug', 'Sep']);
});

const at = (index, forecast = false) => ({ index, forecast });
const shape = (runs) => runs.map((run) => [run.forecast, run.points.map((point) => point.index)]);

test('one unbroken stretch of months is one line', () => {
  assert.deepEqual(shape(lineRuns([at(0), at(1), at(2)])), [[false, [0, 1, 2]]]);
});

// This is the case that left the chart as five dots: past, current and next
// were three different kinds, so a per-source polyline had one point each.
test('solid and dashed meet, because the forecast run starts on the last real month', () => {
  assert.deepEqual(shape(lineRuns([at(0), at(1), at(2), at(3, true)])), [
    [false, [0, 1, 2]],
    [true, [2, 3]],
  ]);
});

test('a missing month breaks the line rather than drawing through it', () => {
  assert.deepEqual(shape(lineRuns([at(0), at(1), at(3), at(4)])), [
    [false, [0, 1]],
    [false, [3, 4]],
  ]);
});

test('a lone point draws no line, and neither does nothing at all', () => {
  assert.deepEqual(lineRuns([at(2)]), []);
  assert.deepEqual(lineRuns([]), []);
  assert.deepEqual(shape(lineRuns([at(0), at(2, true)])), []);
});

test('an all forecast range is still one dashed line', () => {
  assert.deepEqual(shape(lineRuns([at(0, true), at(1, true)])), [[true, [0, 1]]]);
});

test('the scale always includes zero and never collapses to a point', () => {
  assert.deepEqual(scaleFor([10, 40]), { min: 0, max: 40 });
  const flat = scaleFor([5, 5]);
  assert.ok(flat.max > flat.min);
  assert.deepEqual(scaleFor([]), { min: 0, max: 1 });
});
