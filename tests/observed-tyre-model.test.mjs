import test from "node:test";
import assert from "node:assert/strict";
import evidence from "../app/data/calibration-summary.json" with { type: "json" };
import { OBSERVED_BAHRAIN_2025, OBSERVED_TYRE_MODEL_VERSION, calculateObservedTyreLoss } from "../app/lib/observed-tyre-model.ts";
import { COMPOUNDS, TRACK_PRESETS, evaluateStrategy, optimizeTyreStrategies } from "../app/lib/strategy.ts";
import { DEFAULT_GROUP_FORMULA_PARAMETERS } from "../app/lib/group-formula.ts";
import { prepareStrategyReplay, strategyRaceFrameAt } from "../app/lib/strategy-race.ts";
import { buildSharedRaceGrid } from "../app/lib/shared-race-grid.ts";
import { createRaceGrid } from "../app/lib/race-grid.ts";
import { DEFAULT_TEAM_ID, findTeamProfile } from "../app/lib/participants.ts";

const near = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≈ ${b}`);
const base = { track: "bahrain", laps: 8, rules: { maxStops: 1 },
  stints: [{ compound: "S", startLap: 1, endLap: 4 }, { compound: "H", startLap: 5, endLap: 8 }] };
const observed = { ...base, observedTyreModel: "2025-bahrain", raceSeason: 2025 };

test("Bahrain metadata uses the selected training fit and exposes its actual validation scope", () => {
  const event = evidence.events.find(row => row.id === "2025-bahrain");
  assert.equal(OBSERVED_BAHRAIN_2025.eventId, event.id);
  assert.equal(OBSERVED_BAHRAIN_2025.season, 2025);
  assert.equal(OBSERVED_BAHRAIN_2025.trackId, "bahrain");
  for (const compound of COMPOUNDS) {
    const row = event.modelSelection.coefficients.find(item => item.compound === compound);
    const c = OBSERVED_BAHRAIN_2025.coefficients[compound];
    assert.equal(row.accepted, true); assert.equal(row.identifiable, true);
    assert.equal(c.sourceAlpha, row.alphaSecondsPerLap);
    assert.equal(c.beta, row.betaSecondsPerLapSquared);
    assert.equal(c.laps, row.laps); assert.equal(c.stints, row.stints); assert.equal(c.model, row.model);
    assert.equal(c.model === "quadratic" ? c.betaCI95[0] > 0 : c.alphaCI95[0] > 0, true);
    assert.notEqual(c.sourceAlpha, event.coefficients.find(item => item.compound === compound).alphaSecondsPerLap);
    assert.equal(c.observedAgeMin, 1);
    assert.equal(c.observedAgeMax, { S: 27, M: 30, H: 29 }[compound]);
  }
  assert.deepEqual(OBSERVED_BAHRAIN_2025.pitLoss.iqrSeconds, [22.148, 23.754]);
  assert.equal(OBSERVED_BAHRAIN_2025.pitLoss.medianSeconds, 22.986);
  assert.equal(OBSERVED_BAHRAIN_2025.pitLoss.retainedSamples, 26);
  assert.equal(OBSERVED_BAHRAIN_2025.validation.trainLaps, 694);
  assert.equal(OBSERVED_BAHRAIN_2025.validation.testLaps, 210);
  assert.equal(OBSERVED_BAHRAIN_2025.validation.maeSeconds, .413999);
  assert.equal(OBSERVED_BAHRAIN_2025.validation.rmseSeconds, .546823);
  assert.match(OBSERVED_BAHRAIN_2025.validationNote, /전체 선택 회귀 모델/);
  assert.ok(OBSERVED_BAHRAIN_2025.sourceUrls.includes(event.timingSourceUrl));
});

test("new-set-normalised observed loss reproduces the requested per-lap examples", () => {
  near(calculateObservedTyreLoss("S", 10).totalSeconds, .55796);
  near(calculateObservedTyreLoss("S", 20).totalSeconds, 1.82892);
  near(calculateObservedTyreLoss("M", 10).totalSeconds, .96782);
  near(calculateObservedTyreLoss("H", 10).totalSeconds, 1.34825);
  for (const compound of COMPOUNDS) {
    const c = OBSERVED_BAHRAIN_2025.coefficients[compound];
    near(calculateObservedTyreLoss(compound, 0).totalSeconds, 0);
    for (const age of [0, 1, 10, 20]) {
      const sourceLoss = c.sourceAlpha * (age + 1) + c.beta * (age + 1) ** 2;
      near(calculateObservedTyreLoss(compound, age).totalSeconds, sourceLoss - c.absorbedIntercept);
    }
  }
  for (const age of [-1, Infinity, NaN]) assert.throws(() => calculateObservedTyreLoss("S", age));
});

test("observed model rejects a missing season, other events, and a combined PDF model", () => {
  for (const override of [{ raceSeason: undefined }, { raceSeason: 2026 }, { track: "melbourne" },
    { track: { ...TRACK_PRESETS.bahrain, id: "custom" } }, { observedTyreModel: "2024-bahrain" }]) {
    assert.throws(() => evaluateStrategy({ ...observed, ...override }), /2025 바레인/);
  }
  assert.throws(() => evaluateStrategy({ ...observed, groupFormula: DEFAULT_GROUP_FORMULA_PARAMETERS }), /별도의 계산 모델/);
});

test("old and PDF outputs retain their pre-change totals and optional inputs keep old identity", () => {
  near(evaluateStrategy(base).totalSeconds, 784.7904020886338);
  near(evaluateStrategy({ ...base, groupFormula: DEFAULT_GROUP_FORMULA_PARAMETERS }).totalSeconds, 783.4200000000002);
  assert.deepEqual(evaluateStrategy(base), evaluateStrategy({ ...base, observedTyreModel: undefined, raceSeason: 2025 }));
  const legacySignature = JSON.parse(evaluateStrategy(base).scenarioSignature);
  assert.equal(legacySignature.observedTyreModel, undefined);
  const activeSignature = JSON.parse(evaluateStrategy(observed).scenarioSignature).observedTyreModel;
  assert.equal(activeSignature.version, OBSERVED_TYRE_MODEL_VERSION);
  assert.equal(activeSignature.id, "2025-bahrain"); assert.equal(activeSignature.raceSeason, 2025);
});

test("observed costs replace old degradation and thermal terms and do not add the source intercept", () => {
  const overrides = { baseLapTimeSeconds: 90, fuelGainSecondsPerLap: 0, pitLossSeconds: 22.986,
    compoundModels: { S: { alpha: 10, beta: 10, offsetSeconds: -.5 }, H: { alpha: 20, beta: 20, offsetSeconds: .3 } } };
  const race = evaluateStrategy({ ...observed, ...overrides });
  for (const lap of race.lapCosts) {
    const loss = calculateObservedTyreLoss(lap.compound, lap.tyreAge);
    const offset = overrides.compoundModels[lap.compound].offsetSeconds;
    near(lap.lapTimeSeconds, 90 + offset + loss.totalSeconds + lap.pitLossSeconds);
    near(lap.linearDegradationSeconds, loss.linearDegradationSeconds);
    near(lap.quadraticDegradationSeconds, loss.quadraticDegradationSeconds);
    assert.equal(lap.tyreState.modelKind, "observed-regression");
    for (const metric of ["temperatureC", "wearPercent", "gripPercent", "optimalMinC", "optimalMaxC"]) assert.equal(lap.tyreState[metric], null);
    assert.equal(lap.tyreState.totalStateLossSeconds, 0);
    assert.equal(lap.tyreState.thermalState, "not-modelled");
  }
  near(race.lapCosts[0].lapTimeSeconds, 89.5);
  near(race.lapCosts[4].lapTimeSeconds, 90.3 + 22.986);
  assert.equal(race.breakdown.pitLossSeconds, 22.986);
  const hot = evaluateStrategy({ ...observed, ...overrides, trackTemperatureC: 60 });
  const cold = evaluateStrategy({ ...observed, ...overrides, trackTemperatureC: 10 });
  near(hot.totalSeconds, cold.totalSeconds);
});

test("observed DP optimum agrees with exhaustive one-stop plans under the same cost equation", () => {
  const input = { track: "bahrain", raceSeason: 2025, observedTyreModel: "2025-bahrain", laps: 7,
    rules: { minStops: 1, maxStops: 1, requireTwoDryCompounds: true }, allowedCompounds: COMPOUNDS, topK: 1 };
  const candidates = [];
  for (const from of COMPOUNDS) for (const to of COMPOUNDS) for (let pit = 1; pit < input.laps; pit++) {
    const candidate = evaluateStrategy({ ...input, stints: [{ compound: from, startLap: 1, endLap: pit },
      { compound: to, startLap: pit + 1, endLap: input.laps }] });
    if (candidate.isLegal) candidates.push(candidate);
  }
  const optimum = optimizeTyreStrategies(input)[0];
  near(optimum.totalSeconds, Math.min(...candidates.map(row => row.totalSeconds)));
  near(evaluateStrategy({ ...input, stints: optimum.stints }).totalSeconds, optimum.totalSeconds);
});

test("wet tyre terms keep their existing fallback instead of claiming observed temperature or wear", () => {
  for (const compound of ["INTER", "WET"]) {
    const input = { ...base, weather: { preset: "heavy", initialWater: .8 },
      rules: { minStops: 0, maxStops: 1, requireTwoDryCompounds: false },
      stints: [{ compound, startLap: 1, endLap: 8 }] };
    const standard = evaluateStrategy(input);
    const observation = evaluateStrategy({ ...input, observedTyreModel: "2025-bahrain", raceSeason: 2025 });
    near(standard.totalSeconds, observation.totalSeconds);
    assert.deepEqual(standard.lapCosts, observation.lapCosts);
    assert.equal(observation.lapCosts[0].tyreState.modelKind, "wet-heat-only");
  }
});

test("3D replay and equal-performance race grid consume observed lap costs", () => {
  const race = evaluateStrategy(observed);
  const replay = prepareStrategyReplay(race);
  near(replay.segments.at(-1).endSeconds, race.totalSeconds);
  assert.equal(strategyRaceFrameAt(replay, replay, race.totalSeconds).completed, true);
  const driver = findTeamProfile(DEFAULT_TEAM_ID).drivers[0];
  const shared = buildSharedRaceGrid({ teamId: DEFAULT_TEAM_ID, driverId: driver.id, playerStrategy: race,
    strategyPool: [race], startingGridPosition: 1, equalPerformance: true });
  const grid = createRaceGrid(shared.entries, { gridSlotOffsetSeconds: 0, maximumTrafficLossSeconds: 0, pitStackLossSeconds: 0 });
  assert.equal(grid.cars.length, 20);
  for (const car of grid.cars) {
    near(car.totalSeconds, race.totalSeconds);
    near(car.replay.segments.at(-1).endSeconds, race.totalSeconds);
    assert.equal(car.replay.strategy.lapCosts[0].tyreState.modelKind, "observed-regression");
  }
});
