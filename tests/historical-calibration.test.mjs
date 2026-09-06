import test from "node:test";
import assert from "node:assert/strict";
import { HISTORICAL_EVIDENCE, evaluateHistoricalCoefficient, poolHistoricalCompound, getHistoricalCalibration, getObservedTeamPerformance, nearestHistoricalTrack } from "../app/lib/historical-calibration.ts";
import { TRACK_PRESETS, TRACK_PRESET_IDS } from "../app/lib/strategy.ts";
import { MODEL_PARAMS } from "../app/model/params.ts";

const quadratic = {
  compound: "M", model: "quadratic", accepted: true,
  laps: 80, stints: 6, identifiable: true,
  alphaSecondsPerLap: 0.03, betaSecondsPerLapSquared: 0.002,
  alphaCI95: [0.01, 0.05], betaCI95: [0.001, 0.003],
};

test("nested gate accepts significant curvature without requiring the unshifted alpha CI to be positive", () => {
  const accepted = evaluateHistoricalCoefficient({ ...quadratic, alphaSecondsPerLap: -0.003, alphaCI95: [-0.01, 0.004] });
  assert.equal(accepted.accepted, true);
  assert.ok(Math.abs(accepted.alpha0 - 0.001) < 1e-12);
  assert.ok(Math.abs(accepted.offsetCorrectionSeconds + 0.001) < 1e-12);
});

test("linear fallback must be independently refitted and accepted on training data", () => {
  const row = { ...quadratic, model: "linear", betaSecondsPerLapSquared: 0, betaCI95: [0, 0] };
  assert.equal(evaluateHistoricalCoefficient(row).accepted, true);
  assert.equal(evaluateHistoricalCoefficient({ ...row, accepted: false }).accepted, false);
  assert.equal(evaluateHistoricalCoefficient({ ...row, alphaCI95: [-0.01, 0.05] }).accepted, false);
  assert.equal(evaluateHistoricalCoefficient({ ...row, betaSecondsPerLapSquared: 0.001 }).accepted, false);
});

test("confidence, identifiability, sample and physical-shape failures retain priors without clipping", () => {
  for (const change of [
    { identifiable: false }, { laps: MODEL_PARAMS.historical.minLaps - 1 },
    { stints: MODEL_PARAMS.historical.minStints - 1 }, { betaCI95: [-0.001, 0.003] },
    { alphaSecondsPerLap: -0.03 }, { betaSecondsPerLapSquared: -0.01 },
    { alphaSecondsPerLap: NaN }, { model: undefined },
  ]) assert.equal(evaluateHistoricalCoefficient({ ...quadratic, ...change }).accepted, false);
});

test("sample-weighted age conversion preserves the fitted polynomial including its age-zero constant", () => {
  const second = { ...quadratic, laps: 160, alphaSecondsPerLap: 0.06, betaSecondsPerLapSquared: 0.003 };
  const prior = TRACK_PRESETS.silverstone.compounds.M;
  const pooled = poolHistoricalCompound([quadratic, second], prior);
  assert.ok(pooled);
  for (const age of [0, 1, 10, 24]) {
    const life = age + 1;
    const expected = prior.offsetSeconds + [quadratic, second].reduce((sum, row) => sum + row.laps * (row.alphaSecondsPerLap * life + row.betaSecondsPerLapSquared * life ** 2), 0) / 240;
    const actual = pooled.offsetSeconds + pooled.alpha * age + pooled.beta * age ** 2;
    assert.ok(Math.abs(expected - actual) < 1e-10);
  }
  assert.equal(poolHistoricalCompound([{ ...quadratic, accepted: false }], prior), undefined);
});

test("same-severity fallback is labelled, and pit losses never transfer between circuits", () => {
  const nearest = nearestHistoricalTrack("melbourne");
  assert.ok(nearest);
  assert.equal(TRACK_PRESETS[nearest].tyreSeverity, TRACK_PRESETS.melbourne.tyreSeverity);
  const unobserved = getHistoricalCalibration("melbourne");
  assert.equal(unobserved.coverage.hasDirectData, false);
  assert.equal(unobserved.provenance.borrowed, true);
  assert.equal(unobserved.pitLossSeconds, undefined);
  assert.equal(unobserved.provenance.currentSeasonCollected, false);
});

test("observed pit loss replaces a preset only at the declared adoption difference", () => {
  for (const trackId of TRACK_PRESET_IDS) {
    const calibration = getHistoricalCalibration(trackId);
    const observed = calibration.coverage.observedPitLossSeconds;
    if (observed === undefined || Math.abs(observed - TRACK_PRESETS[trackId].pitLossSeconds) < MODEL_PARAMS.historical.pitAdoptionDifferenceSeconds) {
      assert.equal(calibration.pitLossSeconds, undefined);
    } else assert.equal(calibration.pitLossSeconds, observed);
  }
  assert.ok(getHistoricalCalibration("spa").pitLossSeconds !== undefined);
});

test("team proxies expose original observations and never claim a measured pit crew or 2026 source", () => {
  for (const missing of ["audi", "cadillac"]) {
    const result = getObservedTeamPerformance(missing);
    assert.equal(result.source.kind, "unavailable");
    assert.equal(result.observedPaceSeconds, null);
    assert.equal(result.observedDegRatio, null);
    assert.equal(result.paceSeconds, MODEL_PARAMS.performance.neutralPaceSeconds);
    assert.equal(result.degMultiplier, MODEL_PARAMS.performance.neutralDeg);
  }
  const result = getObservedTeamPerformance("ferrari");
  assert.equal(result.source.kind, "historical-observational");
  assert.ok(Number.isFinite(result.observedPaceSeconds));
  assert.ok(Math.abs(result.paceSeconds) <= MODEL_PARAMS.historical.maxTeamPaceSeconds);
  assert.ok(result.degMultiplier >= MODEL_PARAMS.performance.teamDegMin);
  assert.ok(result.degMultiplier <= MODEL_PARAMS.performance.teamDegMax);
  assert.equal(result.source.currentSeasonCollected, false);
  assert.equal(result.source.stationaryPitCollected, false);
  assert.equal(result.pitCrewDeltaSeconds, 0);
});

test("compact evidence maintains actual sample totals and separately reports selected-model holdout", () => {
  const { summary, events, selectedModelSummary } = HISTORICAL_EVIDENCE;
  assert.equal(events.length, 21);
  assert.equal(new Set(events.map((event) => event.trackId)).size, 7);
  for (const key of ["rawLaps", "modelLaps", "stints"]) assert.equal(summary[key], events.reduce((sum, event) => sum + event[key], 0));
  const testLaps = events.reduce((sum, event) => sum + event.modelSelection.validation.testLaps, 0);
  const absoluteError = events.reduce((sum, event) => sum + event.modelSelection.validation.absoluteErrorSumSeconds, 0);
  assert.equal(selectedModelSummary.holdoutLaps, testLaps);
  assert.ok(Math.abs(selectedModelSummary.weightedHoldoutMaeSeconds - absoluteError / testLaps) < 1e-12);
  assert.equal(HISTORICAL_EVIDENCE.wet.reduce((sum, event) => sum + event.intermediateWetMatchedLaps, 0), 0);
});
