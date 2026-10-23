import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_GROUP_FORMULA_PARAMETERS, calculateGroupFormulaLap, validateGroupFormulaParameters } from "../app/lib/group-formula.ts";
import { COMPOUNDS, TRACK_PRESETS, evaluateStrategy, optimizeTyreStrategies } from "../app/lib/strategy.ts";
import { applyEntryPerformance } from "../app/lib/entry-performance.ts";
import { DEFAULT_TEAM_ID, findTeamProfile } from "../app/lib/participants.ts";
import { prepareStrategyReplay, strategyRaceFrameAt } from "../app/lib/strategy-race.ts";
import { buildSharedRaceGrid } from "../app/lib/shared-race-grid.ts";
import { createRaceGrid } from "../app/lib/race-grid.ts";
import { TEAM_PROFILES } from "../app/lib/participants.ts";

const params = () => structuredClone(DEFAULT_GROUP_FORMULA_PARAMETERS);
const near = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≈ ${b}`);
const lap = (parameters = params(), overrides = {}) => calculateGroupFormulaLap({ parameters, compound: "S", tyreAge: 0,
  baseLapTimeSeconds: 90.2, trackTemperatureC: 34, airTemperatureC: 23, circuitLengthKm: 5.9, pitLossSeconds: 24, ...overrides });
const caseInput = { track: "melbourne", laps: 8, rules: { minStops: 1, maxStops: 1, requireTwoDryCompounds: true },
  stints: [{ compound: "M", startLap: 1, endLap: 4 }, { compound: "H", startLap: 5, endLap: 8 }] };

test("PDF temperature examples and exact boundaries reproduce the documented loss", () => {
  for (const [temperature, loss] of [[70, 1.6], [80, .4], [90, 0], [100, 0], [110, 0], [120, .4], [130, 1.6]]) {
    const p = params(); p.temperature.directC = temperature;
    near(lap(p).temperatureLossSeconds, loss);
  }
});
test("temperature forward relation converts km/h to m/s and uses road and air separately", () => {
  const p = params(); Object.assign(p.temperature, { mode: "estimated", p: 1.2, q: .3, speedHeatingCoeff: .01, constantC: 10, cornerSpeedKmh: 180 });
  near(lap(p).temperatureC, 1.2 * 34 + .3 * 23 + .01 * 50 ** 2 + 10);
});
test("mean-lap ratios and distance wear match PDF examples", () => {
  const expected = { S: [89.8 / 90.2, 7.08], M: [1, 5.9], H: [90.6 / 90.2, 4.72] };
  for (const compound of COMPOUNDS) {
    const result = lap(params(), { compound }); near(result.paceRatio, expected[compound][0]); near(result.wearUnits, expected[compound][1]);
    near(90.2 + result.compoundOffsetSeconds, { S: 89.8, M: 90.2, H: 90.6 }[compound]);
    assert.equal(result.wearPercent, null);
  }
});
test("hinge is additional post-cliff slope and first-lap age is zero", () => {
  const p = params(), c = p.compounds.S;
  const costs = age => { const value = lap(p, { tyreAge: age }); return value.linearDegradationSeconds + value.cliffDegradationSeconds; };
  near(costs(0), 0); near(costs(c.cliffAge) - costs(c.cliffAge - 1), c.beta1);
  near(costs(c.cliffAge + 1) - costs(c.cliffAge), c.beta1 + c.beta2);
  near(lap(p, { tyreAge: 3 }).wearUnits, 4 * 7.08);
});
test("zero rates produce meaningful open-ended diagnostics and no NaN", () => {
  const p = params(); Object.assign(p.compounds.S, { beta1: 0, treadWearPerLapMm: 0, wearPerKm: 0 }); p.wearBudget = 100;
  validateGroupFormulaParameters(p);
  const result = lap(p); assert.equal(result.suggestedStintLaps, 18); assert.equal(result.treadLifeLaps, Infinity);
  assert.equal(result.wearBudgetLaps, Infinity); assert.equal(result.wearPercent, 0);
});
test("invalid parameters and implausible forward temperature are rejected", () => {
  for (const change of [p => p.compounds.M.meanLapSeconds = 0, p => p.compounds.S.beta1 = -1,
    p => p.temperature.minC = 120, p => p.temperature.coldCoeff = NaN, p => p.wearBudget = 0]) {
    const p = params(); change(p); assert.throws(() => validateGroupFormulaParameters(p));
  }
  const p = params(); Object.assign(p.temperature, { mode: "estimated", speedHeatingCoeff: 100 });
  assert.throws(() => evaluateStrategy({ ...caseInput, groupFormula: p }), /추정 타이어 온도/);
});
test("omitting PDF option preserves the original model including identity", () => {
  assert.deepEqual(evaluateStrategy(caseInput), evaluateStrategy({ ...caseInput, groupFormula: undefined }));
  assert.equal(JSON.parse(evaluateStrategy(caseInput).scenarioSignature).groupFormula, undefined);
});
test("equivalent PDF parameters keep the same identity despite object property order", () => {
  const reverse = value => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, value]) => [key, reverse(value)])) : value;
  const first = evaluateStrategy({ ...caseInput, groupFormula: params() });
  const reordered = evaluateStrategy({ ...caseInput, groupFormula: reverse(params()) });
  assert.equal(first.scenarioSignature, reordered.scenarioSignature);
  assert.equal(first.totalSeconds, reordered.totalSeconds);
});
test("same-plan temperature experiment adds 0.4 seconds per dry lap and changes replay duration", () => {
  const p = params(), hot = params(); hot.temperature.directC = 120;
  const baseline = evaluateStrategy({ ...caseInput, groupFormula: p });
  const changed = evaluateStrategy({ ...caseInput, groupFormula: hot });
  near(changed.totalSeconds - baseline.totalSeconds, 8 * .4);
  for (const [index, value] of changed.lapCosts.entries()) {
    near(value.lapTimeSeconds - baseline.lapCosts[index].lapTimeSeconds, .4);
    assert.equal(value.tyreState.modelKind, "group-formula"); assert.equal(value.tyreState.gripPercent, null);
    assert.equal(value.tyreState.temperatureC, 120); near(value.tyreState.totalStateLossSeconds, .4);
  }
  const replay = prepareStrategyReplay(changed);
  assert.equal(replay.strategy.totalSeconds, changed.totalSeconds);
  assert.equal(strategyRaceFrameAt(replay, replay, changed.totalSeconds).completed, true);
  assert.notEqual(changed.scenarioSignature, baseline.scenarioSignature);
  assert.deepEqual(changed.pitAfterLaps, baseline.pitAfterLaps);
});
test("PDF cost categories replace old degradation and state terms instead of stacking", () => {
  const p = params(); p.compounds.S.cliffAge = 2;
  const value = evaluateStrategy({ ...caseInput, groupFormula: p, baseLapTimeSeconds: 90.2, fuelGainSecondsPerLap: 0,
    compoundModels: { S: { offsetSeconds: 50, alpha: 10, beta: 10 } },
    stints: [{ compound: "S", startLap: 1, endLap: 4 }, { compound: "H", startLap: 5, endLap: 8 }] });
  near(value.lapCosts[0].lapTimeSeconds, 89.8);
  near(value.lapCosts[3].lapTimeSeconds, 89.8 + .12 * 3 + .24);
  near(value.lapCosts[3].tyreState.totalStateLossSeconds, 0);
  near(value.lapCosts[4].tyreAge, 0);
});
test("wear budget and advisory stint length do not invent hard retirement limits", () => {
  const p = params(); p.wearBudget = 1; p.compounds.M.cliffAge = 1;
  const value = evaluateStrategy({ ...caseInput, groupFormula: p });
  assert.equal(value.isLegal, true); assert.ok(value.lapCosts[3].tyreState.wearPercent > 100);
  const old = evaluateStrategy(caseInput); assert.deepEqual(value.violations, old.violations);
});
test("wet compounds retain original costs and explicitly keep their original state model", () => {
  const input = { ...caseInput, weather: { preset: "heavy" },
    stints: [{ compound: "INTER", startLap: 1, endLap: 4 }, { compound: "WET", startLap: 5, endLap: 8 }] };
  const old = evaluateStrategy(input), group = evaluateStrategy({ ...input, groupFormula: params() });
  assert.deepEqual(group.lapCosts, old.lapCosts); near(group.totalSeconds, old.totalSeconds);
  assert.equal(group.lapCosts[0].tyreState.modelKind, "wet-heat-only");
});
test("group DP agrees with independent enumeration of all one-stop dry plans", () => {
  const input = { ...caseInput, groupFormula: params(), allowedCompounds: COMPOUNDS, allowedStartingCompounds: COMPOUNDS, topK: 1 };
  const exhaustive = [];
  for (const first of COMPOUNDS) for (const second of COMPOUNDS) for (let pit = 1; pit < input.laps; pit++) {
    const candidate = evaluateStrategy({ ...input, stints: [{ compound: first, startLap: 1, endLap: pit }, { compound: second, startLap: pit + 1, endLap: input.laps }] });
    if (candidate.isLegal) exhaustive.push(candidate.totalSeconds);
  }
  near(optimizeTyreStrategies(input)[0].totalSeconds, Math.min(...exhaustive));
});
test("entry-performance mapping applies the same wear multiplier once to group slopes", () => {
  const driver = findTeamProfile(DEFAULT_TEAM_ID).drivers[0].id;
  const input = { ...caseInput, groupFormula: params() };
  const equal = applyEntryPerformance(input, DEFAULT_TEAM_ID, driver, true);
  assert.equal(equal, input);
  const mapped = applyEntryPerformance(input, DEFAULT_TEAM_ID, driver, false);
  const evaluated = evaluateStrategy(mapped);
  near(evaluated.lapCosts[3].linearDegradationSeconds, .08 * 3 * mapped.groupWearMultiplier);
  assert.ok(Number.isFinite(evaluated.totalSeconds));
  assert.equal(evaluated.lapCosts[0].tyreState.temperatureC, 100);
});

test("all group-model rivals match independent entry evaluations, including S/H pace ratios", () => {
  const driverId = findTeamProfile(DEFAULT_TEAM_ID).drivers[0].id;
  const base = { ...caseInput, groupFormula: params(), stints: [
    { compound: "S", startLap: 1, endLap: 4 }, { compound: "H", startLap: 5, endLap: 8 }] };
  const primary = evaluateStrategy(applyEntryPerformance(base, DEFAULT_TEAM_ID, driverId));
  const shared = buildSharedRaceGrid({ teamId: DEFAULT_TEAM_ID, driverId, playerStrategy: primary,
    strategyPool: [primary], startingGridPosition: 1, equalPerformance: false });
  const grid = createRaceGrid(shared.entries, { gridSlotOffsetSeconds: 0, maximumTrafficLossSeconds: 0, pitStackLossSeconds: 0 });
  assert.equal(grid.cars.length, 20);
  for (const car of grid.cars) {
    const team = TEAM_PROFILES.find(team => team.drivers.some(driver => driver.id === car.id));
    const expected = evaluateStrategy({ ...applyEntryPerformance(base, team.id, car.id), stints: base.stints });
    near(car.totalSeconds, expected.totalSeconds);
    near(car.replay.segments.at(-1).endSeconds, expected.totalSeconds);
    assert.equal(car.replay.strategy.lapCosts[0].tyreState.modelKind, "group-formula");
    near(car.replay.strategy.breakdown.totalSeconds, car.totalSeconds);
  }
});
