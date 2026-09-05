import test from "node:test";
import assert from "node:assert/strict";
import { evaluateStrategy } from "../app/lib/strategy.ts";
import {
  calculatePitWindows,
  DEFAULT_PIT_WINDOW_THRESHOLD_SECONDS,
} from "../app/lib/pit-windows.ts";

function inputFor(laps, extra = {}) {
  return {
    track: "melbourne",
    laps,
    rules: { minStops: 1, maxStops: 2, minStintLaps: 1 },
    ...extra,
  };
}

function plan(input, compounds, ends) {
  return evaluateStrategy({
    ...input,
    stints: compounds.map((compound, index) => ({
      compound,
      startLap: index === 0 ? 1 : ends[index - 1] + 1,
      endLap: ends[index] ?? input.laps,
    })),
  });
}

test("a no-stop plan has no pit sensitivity windows", () => {
  const input = inputFor(12);
  const reference = plan(input, ["H"], []);
  assert.deepEqual(calculatePitWindows(reference, input, 12), []);
});

test("every lap shown in a one-stop window is legal and within the stated time budget", () => {
  const input = inputFor(30);
  const allPlans = Array.from({ length: 29 }, (_, index) =>
    plan(input, ["S", "H"], [index + 1]),
  );
  const reference = allPlans.filter((item) => item.isLegal).sort(
    (left, right) => left.totalSeconds - right.totalSeconds,
  )[0];
  const [window] = calculatePitWindows(reference, input, 30);
  assert.equal(window.thresholdSeconds, DEFAULT_PIT_WINDOW_THRESHOLD_SECONDS);
  assert.equal(window.optimalLap, reference.pitAfterLaps[0]);
  assert.ok(window.startLap <= window.optimalLap);
  assert.ok(window.endLap >= window.optimalLap);

  for (let lap = window.startLap; lap <= window.endLap; lap += 1) {
    const shifted = allPlans[lap - 1];
    assert.equal(shifted.isLegal, true, `L${lap} must remain legal`);
    assert.ok(shifted.totalSeconds <= reference.totalSeconds + 1 + 1e-9);
  }
  for (const lap of [window.startLap - 1, window.endLap + 1]) {
    if (lap < 1 || lap >= 30) continue;
    const outside = allPlans[lap - 1];
    assert.ok(!outside.isLegal || outside.totalSeconds > reference.totalSeconds + 1);
  }
});

test("two-stop windows move only their own stop and respect minimum stint lengths", () => {
  const input = inputFor(18, {
    rules: { minStops: 2, maxStops: 2, minStintLaps: 4 },
  });
  const reference = plan(input, ["S", "M", "H"], [6, 12]);
  const windows = calculatePitWindows(reference, input, 18, 1_000);
  assert.deepEqual(windows, [
    { startLap: 4, optimalLap: 6, endLap: 8, thresholdSeconds: 1_000 },
    { startLap: 10, optimalLap: 12, endLap: 14, thresholdSeconds: 1_000 },
  ]);

  for (const [index, window] of windows.entries()) {
    for (let lap = window.startLap; lap <= window.endLap; lap += 1) {
      const stops = [...reference.pitAfterLaps];
      stops[index] = lap;
      const shifted = plan(input, ["S", "M", "H"], stops);
      assert.equal(shifted.isLegal, true);
      assert.equal(shifted.pitAfterLaps[1 - index], reference.pitAfterLaps[1 - index]);
    }
  }
  // Independent ranges are intentionally not a Cartesian product of legal plans.
  assert.equal(plan(input, ["S", "M", "H"], [8, 10]).isLegal, false);
});

test("maximum tyre life can bound a window even when all times fit the budget", () => {
  const input = inputFor(14, {
    compoundModels: { S: { maxStintLaps: 6 }, H: { maxStintLaps: 10 } },
  });
  const reference = plan(input, ["S", "H"], [5]);
  const [window] = calculatePitWindows(reference, input, 14, 1_000);
  assert.deepEqual(window, {
    startLap: 4, optimalLap: 5, endLap: 6, thresholdSeconds: 1_000,
  });
});

test("threshold comparison includes the boundary and is relative to the displayed plan", () => {
  const input = inputFor(20);
  const candidates = Array.from({ length: 19 }, (_, index) =>
    plan(input, ["M", "H"], [index + 1]),
  ).filter((candidate) => candidate.isLegal);
  const best = [...candidates].sort((a, b) => a.totalSeconds - b.totalSeconds)[0];
  const neighboring = candidates.find(
    (candidate) => Math.abs(candidate.pitAfterLaps[0] - best.pitAfterLaps[0]) === 1 &&
      candidate.totalSeconds > best.totalSeconds + 1e-6,
  );
  assert.ok(neighboring);
  const threshold = neighboring.totalSeconds - best.totalSeconds;
  const [inclusive] = calculatePitWindows(best, input, 20, threshold);
  assert.ok(neighboring.pitAfterLaps[0] >= inclusive.startLap);
  assert.ok(neighboring.pitAfterLaps[0] <= inclusive.endLap);
  const [exclusive] = calculatePitWindows(best, input, 20, threshold - 1e-6);
  assert.ok(
    neighboring.pitAfterLaps[0] < exclusive.startLap ||
    neighboring.pitAfterLaps[0] > exclusive.endLap,
  );

  // A non-optimal Top 3 row can include a faster neighboring plan at +0 s.
  const [rowRelative] = calculatePitWindows(neighboring, input, 20, 0);
  assert.equal(rowRelative.optimalLap, neighboring.pitAfterLaps[0]);
  assert.ok(best.pitAfterLaps[0] >= rowRelative.startLap);
  assert.ok(best.pitAfterLaps[0] <= rowRelative.endLap);
});

test("rounded cached totals do not change the pit-window calculation", () => {
  const input = inputFor(20);
  const reference = plan(input, ["S", "H"], [8]);
  assert.deepEqual(
    calculatePitWindows({ ...reference, totalSeconds: Math.round(reference.totalSeconds) }, input, 20),
    calculatePitWindows(reference, input, 20),
  );
});

test("mismatched scenarios, inconsistent laps and illegal reference plans are rejected", () => {
  const input = inputFor(20);
  const reference = plan(input, ["S", "H"], [8]);
  assert.throws(() => calculatePitWindows(reference, { ...input, pitLossSeconds: 99 }, 20), /same scenario/);
  assert.throws(() => calculatePitWindows(reference, input, 21), /cover totalLaps/);
  assert.throws(() => calculatePitWindows({ ...reference, pitAfterLaps: [9] }, input, 20), /match the reference stints/);
  const illegal = plan(input, ["S", "S"], [8]);
  assert.throws(() => calculatePitWindows(illegal, input, 20), /illegal reference strategy/);
  for (const threshold of [-1, NaN, Infinity]) {
    assert.throws(() => calculatePitWindows(reference, input, 20, threshold), /thresholdSeconds/);
  }
  for (const laps of [0, 1.5, NaN]) {
    assert.throws(() => calculatePitWindows(reference, input, laps), /totalLaps/);
  }
});
