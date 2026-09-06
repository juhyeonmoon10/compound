import assert from "node:assert/strict";
import test from "node:test";
import { getModelValidationChecks } from "../app/lib/model-validation.ts";
import { MODEL_PARAMS } from "../app/model/params.ts";
import { evaluateStrategy, TRACK_PRESETS } from "../app/lib/strategy.ts";
import { wetPenalty } from "../app/lib/weather.ts";

test("seven controlled reference regressions pass and are cached immutably", () => {
  const checks = getModelValidationChecks();
  assert.equal(checks.length, 7);
  assert.ok(Object.isFrozen(checks));
  for (const check of checks) {
    assert.ok(Object.isFrozen(check));
    assert.equal(typeof check.title, "string");
    assert.equal(typeof check.detail, "string");
    assert.equal(check.pass, true, check.detail);
  }
  assert.equal(getModelValidationChecks(), checks, "cached result means no repeated 300-trial experiment");
});

test("current inputs cannot change fixed-fixture regression thresholds or rerun their MC", () => {
  const baseline = getModelValidationChecks();
  const dry = getModelValidationChecks({ track: "monaco", fuelGainSecondsPerLap: 0 });
  const wet = getModelValidationChecks({ track: "silverstone", laps: 8, weather: { preset: "heavy" }, pitLossSeconds: 0 });
  assert.equal(dry.length, baseline.length + 1);
  assert.equal(wet.length, baseline.length + 1);
  baseline.forEach((check, index) => {
    assert.equal(dry[index], check);
    assert.equal(wet[index], check);
  });
  assert.equal(dry.at(-1).pass, true);
  assert.equal(wet.at(-1).pass, true);
  assert.match(dry.at(-1).detail, /계산용 진단/);
});

test("fuel measurement isolates paired on/off costs, not changing tyre ages", () => {
  const track = TRACK_PRESETS.melbourne;
  const input = { track, weather: { preset: "none" }, rules: { minStops: 0, maxStops: 1, requireTwoDryCompounds: false }, stints: [{ compound: "H", startLap: 1, endLap: track.laps }] };
  const on = evaluateStrategy(input);
  const off = evaluateStrategy({ ...input, fuelGainSecondsPerLap: 0 });
  const gain = off.lapCosts.at(-1).lapTimeSeconds - on.lapCosts.at(-1).lapTimeSeconds;
  assert.ok(Math.abs(gain - 2.85) <= MODEL_PARAMS.validation.toleranceSeconds);
  on.lapCosts.forEach((lap, index) => assert.deepEqual(lap.tyreState, off.lapCosts[index].tyreState));
  assert.match(getModelValidationChecks()[0].detail, /2\.850초/);
});

test("cliff reporting distinguishes combined degradation from the cliff term alone", () => {
  const P = MODEL_PARAMS.validation;
  const soft = evaluateStrategy({ track: "bahrain", laps: P.cliffOldAge + 1, fuelGainSecondsPerLap: 0, rules: { minStops: 0, maxStops: 1, requireTwoDryCompounds: false }, stints: [{ compound: "S", startLap: 1, endLap: P.cliffOldAge + 1 }] });
  const old = soft.lapCosts[P.cliffOldAge], fresh = soft.lapCosts[P.cliffNewAge];
  const totalDelta = old.lapTimeSeconds - fresh.lapTimeSeconds;
  const cliffDelta = old.tyreState.cliffLossSeconds - fresh.tyreState.cliffLossSeconds;
  assert.ok(totalDelta > P.cliffMinimumSeconds);
  assert.ok(cliffDelta < P.cliffMinimumSeconds);
  assert.match(getModelValidationChecks()[1].detail, /클리프 추가분은 1\.550초/);
});

test("pit sensitivity is a designated case, not a claim about every optimum", () => {
  const laps = TRACK_PRESETS.bahrain.laps;
  const evaluate = pit => evaluateStrategy({ track: "bahrain", rules: { minStops: 1, maxStops: 1, requireTwoDryCompounds: true }, stints: [{ compound: "S", startLap: 1, endLap: pit }, { compound: "H", startLap: pit + 1, endLap: laps }] }).totalSeconds;
  const pit = MODEL_PARAMS.validation.pitSensitivityAfterLap;
  assert.ok(Math.abs(evaluate(pit) - evaluate(pit + 1)) >= MODEL_PARAMS.validation.pitSensitivitySeconds);
  assert.ok(Math.abs(evaluate(pit + 2) - evaluate(pit + 3)) < MODEL_PARAMS.validation.pitSensitivitySeconds, "a nearby boundary is a counterexample to a universal >=0.3 claim");
  assert.match(getModelValidationChecks()[2].detail, /모든 최적점에서.*보장.*아닙니다/);
});

test("wet switching tests preserve the 0.10 discontinuity and the 0.60 new-set crossover", () => {
  const step = MODEL_PARAMS.validation.crossoverStep;
  assert.ok(wetPenalty("M", 0.10) < wetPenalty("INTER", 0.10));
  assert.ok(wetPenalty("M", 0.10 + step) > wetPenalty("INTER", 0.10 + step));
  assert.ok(Math.abs(wetPenalty("INTER", 0.60) - wetPenalty("WET", 0.60)) <= MODEL_PARAMS.validation.toleranceSeconds);
  assert.match(getModelValidationChecks()[3].detail, /불연속/);
  assert.match(getModelValidationChecks()[4].detail, /실측 교차점이 아닙니다/);
});

test("invalid current conditions fail explicitly without invalidating the fixed checks", () => {
  const invalid = getModelValidationChecks({ track: "melbourne", laps: 0 });
  assert.equal(invalid.at(-1).pass, false);
  assert.match(invalid.at(-1).detail, /입력을 계산할 수 없습니다/);
  assert.ok(invalid.slice(0, -1).every(check => check.pass));
});
