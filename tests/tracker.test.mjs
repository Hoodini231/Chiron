import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hueRanges } from '../dist/tracker.js';
test('red covers both ends of OpenCV hue space', () => {
  assert.deepEqual(hueRanges(0, 14), [
    [0, 14],
    [166, 179],
  ]);
  assert.deepEqual(hueRanges(175, 10), [
    [165, 179],
    [0, 5],
  ]);
});
test('other colours stay inside their hue interval', () => {
  assert.deepEqual(hueRanges(88, 14), [[74, 102]]);
  assert.deepEqual(hueRanges(29, 14), [[15, 43]]);
  assert.deepEqual(hueRanges(143, 14), [[129, 157]]);
});
