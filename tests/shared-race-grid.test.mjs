import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { applyEntryPerformance, resolveEntryPerformance } from "../app/lib/entry-performance.ts";
import { buildSharedRaceGrid } from "../app/lib/shared-race-grid.ts";
import { createRaceGrid } from "../app/lib/race-grid.ts";
import { evaluateStrategy } from "../app/lib/strategy.ts";
import { runRaceExperiments } from "../app/lib/race-experiments.ts";
import { MODEL_PARAMS } from "../app/model/params.ts";

function fixture(equalPerformance = false) {
  const input = applyEntryPerformance({ laps: 30, weather: { preset: "heavy", initialWater: 0.7 }, pitLossSeconds: 20 }, "red-bull", "max-verstappen", equalPerformance);
  const candidates = [10, 15, 20].map((pit) => evaluateStrategy({ ...input, stints: [
    { compound: "INTER", startLap: 1, endLap: pit }, { compound: "WET", startLap: pit + 1, endLap: 30 },
  ] }));
  const sharedInput = { teamId: "red-bull", driverId: "max-verstappen", equalPerformance,
    playerStrategy: candidates[0], strategyPool: candidates, startingGridPosition: 10 };
  return { shared: buildSharedRaceGrid(sharedInput), sharedInput, candidates };
}

function options(shared) { return { seed: 42, trials: 30, playerId: shared.playerId,
  fixedRivals: shared.fixedRivals, gridSlotOffsetSeconds: shared.gridSlotOffsetSeconds,
  racecraft: shared.racecraft, startingGridPosition: shared.startingGridPosition }; }

test("shared helper preserves the replay's twenty participants, slots and opponent assignment", () => {
  const { shared, candidates } = fixture();
  assert.equal(shared.entries.length, 20);
  assert.equal(shared.fixedRivals.length, 19);
  assert.equal(shared.playerId, "max-verstappen");
  assert.equal(shared.racecraft, 96);
  assert.deepEqual([...shared.entries.map((entry) => entry.gridPosition)].sort((a, b) => a - b), Array.from({ length: 20 }, (_, index) => index + 1));
  assert.equal(new Set(shared.entries.map((entry) => entry.id)).size, 20);
  for (let index = 1; index < shared.entries.length; index += 1) {
    const entry = shared.entries[index];
    assert.equal(entry.strategy, candidates[(index * 7 + entry.gridPosition) % candidates.length]);
    const rival = shared.fixedRivals.find((item) => item.driverId === entry.id);
    assert.equal(rival.gridPosition, entry.gridPosition);
    assert.deepEqual(rival.strategy.stints, entry.strategy.stints);
    assert.equal(rival.costBasis, "entry-adjusted-no-traffic");
    assert.equal(rival.racecraft, resolveEntryPerformance(entry.pitGroup, entry.id).racecraft);
  }
  const replay = readFileSync(new URL("../app/RaceReplay.tsx", import.meta.url), "utf8");
  assert.match(replay, /shared = entryContext \? buildSharedRaceGrid/);
  assert.match(replay, /entries: readonly RaceGridEntry\[\] = shared\?\.entries/);
});

test("fixed rival lap plans include entry coefficients only, never prior traffic or stack losses", () => {
  const { shared, candidates } = fixture();
  const entryOnly = createRaceGrid(shared.entries, { performanceMode: "equal", gridSlotOffsetSeconds: 0,
    trafficWindowSeconds: 0, maximumTrafficLossSeconds: 0, pitStackWindowSeconds: 0, pitStackLossSeconds: 0 });
  const driven = createRaceGrid(shared.entries);
  let independentRaceLosses = 0;
  for (const rival of shared.fixedRivals) {
    const exact = entryOnly.cars.find((car) => car.id === rival.driverId);
    const withTraffic = driven.cars.find((car) => car.id === rival.driverId);
    assert.deepEqual(rival.strategy, exact.replay.strategy);
    assert.ok(exact.lapTimings.every((lap) => lap.gridOffsetSeconds === 0 && lap.trafficLossSeconds === 0 && lap.pitStackLossSeconds === 0));
    independentRaceLosses += withTraffic.totalSeconds - rival.strategy.totalSeconds;
  }
  assert.ok(independentRaceLosses > 0);
  const player = entryOnly.cars.find((car) => car.id === shared.playerId);
  assert.ok(player.lapTimings.every((lap) => lap.entryModelAdjustmentSeconds === 0));
  assert.ok(Math.abs(player.totalSeconds - candidates[0].totalSeconds) < MODEL_PARAMS.validation.toleranceSeconds);
});

test("counterfactual candidate changes cannot alter the shared 19 opponents", () => {
  const { shared, sharedInput, candidates } = fixture();
  assert.deepEqual(buildSharedRaceGrid({ ...sharedInput, playerStrategy: candidates[2] }).fixedRivals, shared.fixedRivals);
  const first = runRaceExperiments(candidates, options(shared));
  const reversed = runRaceExperiments([...candidates].reverse(), { ...options(shared), fixedRivals: [...shared.fixedRivals].reverse() });
  assert.deepEqual(first.eventTimelines, reversed.eventTimelines);
  assert.deepEqual(first.gridModel, reversed.gridModel);
  assert.equal(first.gridModel.kind, "shared-replay-entries");
  assert.equal(first.gridModel.playerId, shared.playerId);
  for (const candidate of first.candidates) {
    const match = reversed.candidates.find((item) => item.signature === candidate.signature);
    assert.deepEqual(candidate.trials, match.trials);
    for (const trial of candidate.trials) assert.equal(trial.eventTimelineId, first.eventTimelines[trial.trial].id);
  }
  assert.deepEqual(first, runRaceExperiments(candidates, options(shared)));
});

test("equal mode adds no entry ability or generic synthetic pace spread to the shared grid", () => {
  const { shared, sharedInput, candidates } = fixture(true);
  const uniform = buildSharedRaceGrid({ ...sharedInput, strategyPool: [candidates[0]], startingGridPosition: 1 });
  assert.ok(uniform.fixedRivals.every((rival) => rival.racecraft === MODEL_PARAMS.race.racecraftReference));
  assert.ok(uniform.entries.every((entry) => entry.entryModelAdjustment.paceDeltaSeconds === 0
    && entry.entryModelAdjustment.wearMultiplierRatio === 1 && entry.entryModelAdjustment.wetPenaltyMultiplierRatio === 1));
  const result = runRaceExperiments([candidates[0], candidates[0]], { ...options(uniform),
    eventPrior: { scProbability: 0, vscProbability: 0, sourceType: "project-estimate", sourceLabel: "test" } });
  assert.equal(result.candidates[0].meanTrafficLossSeconds, 0);
  assert.ok(Math.abs(result.candidates[0].meanSeconds - candidates[0].totalSeconds) < MODEL_PARAMS.validation.toleranceSeconds);
  assert.deepEqual(result.candidates[0].trials, result.candidates[1].trials);
  assert.equal(result.candidates[0].winRate, 0.5);
  assert.equal(shared.fixedRivals.length, 19);
});

test("invalid shared rosters and already-race-adjusted cost declarations are rejected", () => {
  const { shared, candidates } = fixture();
  assert.throws(() => runRaceExperiments(candidates, { ...options(shared), fixedRivals: shared.fixedRivals.slice(1) }), /19 fixed rivals/);
  for (const replacement of [
    { driverId: shared.playerId }, { gridPosition: shared.startingGridPosition },
    { costBasis: "already-traffic-adjusted" }, { racecraft: NaN },
  ]) assert.throws(() => runRaceExperiments(candidates, { ...options(shared),
    fixedRivals: shared.fixedRivals.map((rival, index) => index ? rival : { ...rival, ...replacement }) }));
  assert.throws(() => buildSharedRaceGrid({ ...fixture().sharedInput, teamId: "ferrari" }), /belong/);
  const generic = runRaceExperiments(candidates, { trials: 1 });
  assert.equal(generic.gridModel.kind, "generic-fixed-pack");
});
