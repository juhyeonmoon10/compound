import assert from "node:assert/strict";
import test from "node:test";
import { calculateTyreState, formatTyreStateMetric } from "../app/lib/tyre-state.ts";
import { evaluateStrategy } from "../app/lib/strategy.ts";
import { buildWeatherTimeline, dryLapsOnSet, wetPenalty } from "../app/lib/weather.ts";

const wetStateInput = {
  compound: "INTER", tyreAge: 9, maxStintLaps: Number.MAX_SAFE_INTEGER,
  tyreSeverity: 3, trackTemperatureC: 34, degradationSeconds: 1.08,
};

test("wet state exposes unmodelled metrics as null, never fabricated optimal sensor values", () => {
  for (const compound of ["INTER", "WET"]) {
    const state = calculateTyreState({ ...wetStateInput, compound, previousDryLaps: 9 });
    assert.equal(state.modelKind, "wet-heat-only");
    assert.equal(state.thermalState, "not-modelled");
    for (const field of ["temperatureC", "optimalMinC", "optimalMaxC", "wearPercent", "gripPercent"]) {
      assert.equal(state[field], null, `${compound} ${field}`);
    }
    assert.equal(state.condition, "overheated");
    assert.equal(state.wetDryLaps, 9);
    assert.equal(state.totalStateLossSeconds, 0, "wet heat is already charged in wetPenalty");
    assert.equal(state.overheatLossSeconds, 0, "do not charge a dry thermal proxy again");
    assert.equal(state.warmupLossSeconds, 0);
    assert.equal(state.cliffLossSeconds, 0);
  }
});

test("no prior dry laps means no accumulated heat, not a claim of optimum grip", () => {
  const state = calculateTyreState({ ...wetStateInput, previousDryLaps: 0 });
  assert.equal(state.condition, "wet-running");
  assert.equal(state.wetDryLaps, 0);
  assert.equal(state.gripPercent, null);
  for (const previousDryLaps of [-1, 0.5, 10, NaN]) {
    assert.throws(() => calculateTyreState({ ...wetStateInput, previousDryLaps }), RangeError);
  }
});

test("the dry proxy retains finite state values and does not use wet history", () => {
  const state = calculateTyreState({ ...wetStateInput, compound: "S", maxStintLaps: 25 });
  assert.equal(state.modelKind, "dry-state-proxy");
  assert.equal(state.wetDryLaps, null);
  for (const field of ["temperatureC", "optimalMinC", "optimalMaxC", "wearPercent", "gripPercent"]) {
    assert.ok(Number.isFinite(state[field]), field);
  }
  assert.ok(state.totalStateLossSeconds > 0);
});

test("formatting distinguishes null from a genuine zero and preserves Korean missing-state text", () => {
  assert.equal(formatTyreStateMetric(null, "°C"), "미모델링");
  assert.equal(formatTyreStateMetric(null, "%"), "미모델링");
  assert.equal(formatTyreStateMetric(0, "%"), "0%");
  assert.equal(formatTyreStateMetric(94.6, "°C"), "95°C");
});

test("INTER/WET dry-running totals remain the declared time formula with heat charged once", () => {
  for (const [compound, expectedTotal] of [["INTER", 1051.65], ["WET", 1089.575]]) {
    const result = evaluateStrategy({
      laps: 10, baseLapTimeSeconds: 100, fuelGainSecondsPerLap: 0,
      weather: { preset: "none" },
      rules: { minStops: 0, maxStops: 1, requireTwoDryCompounds: false },
      stints: [{ compound, startLap: 1, endLap: 10 }],
    });
    // INTER: 1000 + 10*3.5 + sum(age=0..9)*(0.12+0.25).
    // WET:   1000 + 10*7   + sum(age=0..9)*(0.035+0.4).
    assert.ok(Math.abs(result.totalSeconds - expectedTotal) < 1e-7, compound);
    result.lapCosts.forEach((lap, index) => {
      assert.equal(lap.tyreState.wetDryLaps, index);
      assert.equal(lap.tyreState.condition, index ? "overheated" : "wet-running");
      assert.equal(lap.tyreState.totalStateLossSeconds, 0);
    });
  }
});

test("snapshot uses the same threshold-specific dry history as time cost, including pit reset and rewetting", () => {
  const weather = { preset: "heavy", startLap: 1, endLap: 8, initialWater: 0.3 };
  const timeline = buildWeatherTimeline(8, 34, weather);
  const result = evaluateStrategy({
    laps: 8, weather,
    stints: [
      { compound: "INTER", startLap: 1, endLap: 2 },
      { compound: "WET", startLap: 3, endLap: 4 },
      { compound: "WET", startLap: 5, endLap: 8 },
    ],
    rules: { minStops: 2, maxStops: 2 },
  });
  for (const lap of result.lapCosts) {
    const dryAge = dryLapsOnSet(timeline, lap.compound, lap.lap, lap.tyreAge);
    assert.equal(lap.tyreState.wetDryLaps, dryAge);
    assert.equal(lap.wetPenaltySeconds, wetPenalty(lap.compound, lap.water, dryAge));
    assert.equal(lap.tyreState.condition, dryAge ? "overheated" : "wet-running");
  }
  const rewet = evaluateStrategy({
    laps: 8, weather,
    stints: [{ compound: "WET", startLap: 1, endLap: 8 }],
    rules: { minStops: 0, maxStops: 1 },
  });
  assert.ok(rewet.lapCosts[2].water >= 0.55);
  assert.equal(rewet.lapCosts[2].tyreState.wetDryLaps, 2);
  assert.equal(rewet.lapCosts[2].tyreState.condition, "overheated", "the declared model retains heat accumulated before rewetting");
});
