import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { TEAM_PROFILES } from "../app/lib/participants.ts";
import { applyEntryPerformance, resolveEntryPerformance } from "../app/lib/entry-performance.ts";
import { evaluateStrategy } from "../app/lib/strategy.ts";
import { createRaceGrid, relativeEntryModelAdjustment } from "../app/lib/race-grid.ts";
import { MODEL_PARAMS } from "../app/model/params.ts";

const TOLERANCE = MODEL_PARAMS.validation.toleranceSeconds;
const zeroRaceLosses = { gridSlotOffsetSeconds: 0, maximumTrafficLossSeconds: 0, pitStackLossSeconds: 0 };
const assertNear = (actual, expected) => assert.ok(Math.abs(actual - expected) < TOLERANCE, `${actual} != ${expected}`);

function fixture({ equal = false, wet = false, driverId = "max-verstappen" } = {}) {
  const all = TEAM_PROFILES.flatMap((team) => team.drivers.map((driver) => ({ team, driver })));
  const player = all.find((entry) => entry.driver.id === driverId);
  const participants = [player, ...all.filter((entry) => entry !== player)].slice(0, 20);
  const input = applyEntryPerformance({ track: "melbourne", laps: 30, pitLossSeconds: 20,
    weather: wet ? { preset: "heavy", initialWater: 0.8 } : { preset: "none" } }, player.team.id, player.driver.id, equal);
  const strategy = evaluateStrategy({ ...input, stints: [
    { compound: "M", startLap: 1, endLap: 15 }, { compound: "H", startLap: 16, endLap: 30 },
  ] });
  const primaryProfile = resolveEntryPerformance(player.team.id, player.driver.id, equal);
  const entries = participants.map(({ team, driver }, index) => ({
    id: driver.id, label: driver.code, gridPosition: index + 1, pitGroup: team.id, strategy,
    entryModelAdjustment: relativeEntryModelAdjustment(player.driver.id, primaryProfile,
      resolveEntryPerformance(team.id, driver.id, equal)),
  }));
  return { grid: createRaceGrid(entries, zeroRaceLosses), entries, primaryProfile, strategy };
}

test("primary DP performance is never applied a second time in the replay", () => {
  for (const wet of [false, true]) {
    const { grid, strategy } = fixture({ wet });
    const primary = grid.cars.find((car) => car.id === "max-verstappen");
    assert.equal(primary.entryModelAdjustment.sourceKind, "project-mapping-relative-to-dp");
    assert.equal(primary.entryModelAdjustment.paceDeltaSeconds, 0);
    assert.equal(primary.entryModelAdjustment.wearMultiplierRatio, 1);
    assert.equal(primary.entryModelAdjustment.wetPenaltyMultiplierRatio, 1);
    assertNear(primary.totalSeconds, strategy.totalSeconds);
    assert.deepEqual({ ...primary.replay.strategy.breakdown, totalSeconds: strategy.breakdown.totalSeconds }, strategy.breakdown);
    for (const lap of primary.lapTimings) {
      assert.equal(lap.entryModelAdjustmentSeconds, 0);
      assert.equal(lap.performanceAdjustmentSeconds, 0);
      assert.equal(lap.adjustedLapTimeSeconds, strategy.lapCosts[lap.lap - 1].lapTimeSeconds);
    }
  }
});

test("all twenty cars have exactly zero relative adjustments in equal-performance mode", () => {
  const { grid, strategy } = fixture({ equal: true, wet: true });
  assert.equal(grid.cars.length, 20);
  for (const car of grid.cars) {
    assertNear(car.totalSeconds, strategy.totalSeconds);
    for (const lap of car.lapTimings) {
      assert.equal(lap.entryPaceAdjustmentSeconds, 0);
      assert.equal(lap.entryLinearWearAdjustmentSeconds, 0);
      assert.equal(lap.entryQuadraticWearAdjustmentSeconds, 0);
      assert.equal(lap.entryWetPenaltyAdjustmentSeconds, 0);
      assert.equal(lap.performanceAdjustmentSeconds, 0);
    }
  }
});

test("rivals receive only pace difference and relative wear/wet ratios", () => {
  const { grid, strategy, primaryProfile } = fixture({ wet: true });
  const rival = grid.cars.find((car) => car.id === "lewis-hamilton");
  const profile = resolveEntryPerformance("ferrari", "lewis-hamilton");
  assert.equal(rival.entryModelAdjustment.referenceDriverId, "max-verstappen");
  for (const lap of rival.lapTimings) {
    const original = strategy.lapCosts[lap.lap - 1];
    const pace = profile.paceSeconds - primaryProfile.paceSeconds;
    const linear = original.linearDegradationSeconds * (profile.wearMultiplier / primaryProfile.wearMultiplier - 1);
    const quadratic = original.quadraticDegradationSeconds * (profile.wearMultiplier / primaryProfile.wearMultiplier - 1);
    const wet = original.wetPenaltySeconds * (profile.wetPenaltyMultiplier / primaryProfile.wetPenaltyMultiplier - 1);
    assert.equal(lap.entryPaceAdjustmentSeconds, pace);
    assert.equal(lap.entryLinearWearAdjustmentSeconds, linear);
    assert.equal(lap.entryQuadraticWearAdjustmentSeconds, quadratic);
    assert.equal(lap.entryWetPenaltyAdjustmentSeconds, wet);
    assert.equal(lap.entryModelAdjustmentSeconds, pace + linear + quadratic + wet);
    assert.equal(lap.carPaceAdjustmentSeconds, 0);
    assert.equal(lap.driverPaceAdjustmentSeconds, 0);
    assert.equal(lap.tyreManagementAdjustmentSeconds, 0);
    assert.equal(lap.racecraftAdjustmentSeconds, 0);
    assert.equal(lap.pitCrewAdjustmentSeconds, 0);
    assertNear(lap.adjustedLapTimeSeconds, original.lapTimeSeconds + pace + linear + quadratic + wet);
  }
});

test("adjusted cost categories, lap sum and replay segment duration agree without double-counting wet cost", () => {
  const { entries } = fixture({ wet: true });
  const grid = createRaceGrid(entries); // Include independent traffic, grid and pit-stack costs.
  for (const car of grid.cars) {
    const adjusted = car.replay.strategy;
    assert.equal(car.totalSeconds, car.lapTimings.at(-1).cumulativeSeconds);
    assert.equal(car.totalSeconds, car.lapTimings.reduce((sum, lap) => sum + lap.adjustedLapTimeSeconds, 0));
    assertNear(car.replay.segments.at(-1).endSeconds, car.totalSeconds);
    assertNear(car.replay.segments.reduce((sum, segment) => sum + segment.modelSeconds, 0), car.totalSeconds);
    const b = adjusted.breakdown;
    assertNear(b.baselineSeconds + b.compoundOffsetSeconds + b.linearDegradationSeconds
      + b.quadraticDegradationSeconds + b.tyreStateLossSeconds - b.fuelGainSeconds + b.pitLossSeconds, car.totalSeconds);
    for (const lap of adjusted.lapCosts) {
      assertNear(lap.baselineSeconds + lap.compoundOffsetSeconds + lap.linearDegradationSeconds
        + lap.quadraticDegradationSeconds + lap.tyreState.totalStateLossSeconds - lap.fuelGainSeconds + lap.pitLossSeconds, lap.lapTimeSeconds);
      const original = car.strategy.lapCosts[lap.lap - 1];
      const delta = car.lapTimings[lap.lap - 1].entryWetPenaltyAdjustmentSeconds;
      assertNear(lap.wetPenaltySeconds, original.wetPenaltySeconds + delta);
      assertNear(lap.compoundOffsetSeconds, original.compoundOffsetSeconds + delta);
    }
  }
});

test("legacy grids retain point-mode behavior, but mixing legacy points with relative mapping is rejected", () => {
  const { entries } = fixture();
  assert.throws(() => createRaceGrid(entries, { performanceMode: "realistic" }), /cannot be combined/);
  const legacy = entries.map(({ entryModelAdjustment, ...entry }) => {
    void entryModelAdjustment;
    return { ...entry, performance: { carPace: 95, driverPace: 95, tyreManagement: 95, consistency: 95, racecraft: 95, pitCrew: 95 } };
  });
  const equal = createRaceGrid(legacy, { ...zeroRaceLosses, performanceMode: "equal" });
  const realistic = createRaceGrid(legacy, { ...zeroRaceLosses, performanceMode: "realistic" });
  assert.ok(realistic.cars[0].totalSeconds < equal.cars[0].totalSeconds);
  assert.ok(realistic.cars[0].lapTimings.some((lap) => lap.carPaceAdjustmentSeconds < 0));
  assert.ok(realistic.cars.every((car) => car.lapTimings.every((lap) => lap.entryModelAdjustmentSeconds === 0)));
});

test("DP scenario signatures remain checked and invalid scalar mappings cannot enter the grid", () => {
  const { entries, primaryProfile } = fixture();
  assert.throws(() => createRaceGrid(entries.map((entry, index) => index === 1
    ? { ...entry, strategy: { ...entry.strategy, scenarioSignature: "another-scenario" } } : entry)), /same resolved scenario/);
  for (const override of [
    { paceDeltaSeconds: Infinity }, { wearMultiplierRatio: 0 }, { wetPenaltyMultiplierRatio: NaN },
    { referenceDriverId: "absent-driver" }, { sourceKind: "official-measured-seconds" }, { paceDeltaSeconds: -1000 },
  ]) {
    assert.throws(() => createRaceGrid(entries.map((entry) => ({ ...entry,
      entryModelAdjustment: { ...entry.entryModelAdjustment, ...override } })), zeroRaceLosses));
  }
  assert.throws(() => relativeEntryModelAdjustment("max-verstappen", { ...primaryProfile, wearMultiplier: -1 },
    { ...primaryProfile, wearMultiplier: -2 }), /positive finite/);
});

test("relative mapping remains deterministic and does not mutate the DP evaluation", () => {
  const { entries, strategy, grid } = fixture({ wet: true });
  const saved = structuredClone(strategy);
  assert.deepEqual(createRaceGrid(entries, zeroRaceLosses), grid);
  assert.deepEqual(strategy, saved);
  entries[0].entryModelAdjustment.paceDeltaSeconds = 10;
  assert.equal(grid.cars[0].entryModelAdjustment.paceDeltaSeconds, 0);
});

test("replay entry context selects the new path and legacy point labels remain only in its fallback panel", () => {
  const source = readFileSync(new URL("../app/RaceReplay.tsx", import.meta.url), "utf8");
  assert.match(source, /const performanceMode = entryContext \? "equal" : legacyPerformanceMode/);
  assert.match(source, /performanceMode: entryContext \? "equal" : performanceMode/);
  assert.match(source, /entryContext && entryPerformance \? <div className="race-replay__performance-panel">/);
  assert.match(source, /상단 동일 성능 모드 사용/);
  assert.match(source, /EA 공식 점수 → 프로젝트 추정/);
});
