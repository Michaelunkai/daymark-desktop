import assert from "node:assert/strict";
import test from "node:test";
import {
  isDiscreteMouseWheel,
  nextSmoothScrollPosition,
  normalizeWheelDelta,
} from "./smooth-wheel";

test("normalizes line and page wheel events to pixels", () => {
  assert.equal(normalizeWheelDelta(3, 1, 900), 48);
  assert.equal(normalizeWheelDelta(1, 2, 900), 900);
  assert.equal(normalizeWheelDelta(75, 0, 900), 75);
});

test("smooths coarse mouse wheels while preserving precise trackpad input", () => {
  assert.equal(isDiscreteMouseWheel(0, 100, 0), true);
  assert.equal(isDiscreteMouseWheel(0, 3.5, 0), false);
  assert.equal(isDiscreteMouseWheel(0, 1, 1), true);
});

test("eases toward the requested position without overshooting", () => {
  const next = nextSmoothScrollPosition(100, 200);
  assert(next > 100 && next < 200);
  assert.equal(nextSmoothScrollPosition(199.8, 200), 200);
  assert.equal(nextSmoothScrollPosition(452.6667, 453.6), 453.6);
  assert.equal(nextSmoothScrollPosition(1.3334, 0), 0);
});
