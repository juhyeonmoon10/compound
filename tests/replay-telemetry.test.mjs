import assert from "node:assert/strict";
import test from "node:test";
import { evaluateStrategy } from "../app/lib/strategy.ts";
import { createRaceGrid, raceGridFrameAt } from "../app/lib/race-grid.ts";
import { elapsedAtRaceDistance } from "../app/lib/strategy-race.ts";
import {
  telemetryDriverName, buildReplayTimingRows, buildReplayTelemetryEvents,
  occurredReplayEvents, prepareReplayUndercuts, settledReplayUndercuts,
} from "../app/lib/replay-telemetry.ts";

function plan(pitAfterLap = 12) {
  return evaluateStrategy({ laps: 30, pitLossSeconds: 20, stints: [
    { compound: "S", startLap: 1, endLap: pitAfterLap },
    { compound: "H", startLap: pitAfterLap + 1, endLap: 30 },
  ] });
}

function makeGrid(player = plan(), opponent = plan(17)) {
  return createRaceGrid(Array.from({ length: 20 }, (_, index) => ({
    id: index === 9 ? "max-verstappen" : index === 8 ? "george-russell" : `car-${index}`,
    label: index === 9 ? "VER" : index === 8 ? "RUS" : `C${index}`,
    gridPosition: index + 1, pitGroup: `team-${Math.floor(index / 2)}`,
    strategy: index === 9 ? player : opponent,
  })));
}

test("timing contains all twenty grid cars and exactly one Korean player row", () => {
  const grid = makeGrid();
  const frame = raceGridFrameAt(grid, 400);
  const rows = buildReplayTimingRows(grid, frame, "max-verstappen");
  assert.equal(rows.length, 20);
  assert.deepEqual(rows.map((row) => row.position), Array.from({ length: 20 }, (_, index) => index + 1));
  assert.equal(rows.filter((row) => row.isPlayer).length, 1);
  const player = rows.find((row) => row.isPlayer);
  assert.equal(player.name, "막스 베르스타펜");
  assert.equal(player.positionChange, 10 - player.position);
  assert.equal(telemetryDriverName("unknown", "테스트 선수"), "테스트 선수");
  assert.equal(rows[0].intervalSeconds, null);
  for (let index = 1; index < rows.length; index += 1) {
    const ahead = grid.cars.find((car) => car.id === rows[index - 1].id);
    const current = frame.cars[index];
    const expected = Math.max(0, current.elapsedSeconds - elapsedAtRaceDistance(ahead.replay.strategy, current.progressLaps));
    assert.equal(rows[index].intervalSeconds, expected);
    assert.equal(rows[index].leaderGapSeconds, current.gapToLeaderSeconds);
  }
});

test("pit states and completed tyre age are sampled from the same replay frame", () => {
  const grid = makeGrid();
  const car = grid.cars.find((candidate) => candidate.id === "max-verstappen");
  const pit = car.replay.segments.find((segment) => segment.kind === "pit-loss");
  const inPit = buildReplayTimingRows(grid, raceGridFrameAt(grid, (pit.startSeconds + pit.endSeconds) / 2), car.id)
    .find((row) => row.isPlayer);
  assert.equal(inPit.state, "pit");
  assert.equal(inPit.tyreAgeLaps, 0);
  assert.equal(inPit.compound, "H");
  const finish = buildReplayTimingRows(grid, raceGridFrameAt(grid, grid.durationSeconds), car.id)
    .find((row) => row.isPlayer);
  assert.equal(finish.state, "finished");
  assert.equal(finish.tyreAgeLaps, 18);
});

test("pit and finish event times use adjusted grid segments, not unadjusted strategy time", () => {
  const grid = makeGrid();
  const events = buildReplayTelemetryEvents(grid);
  const car = grid.cars.find((candidate) => candidate.id === "max-verstappen");
  const pit = car.replay.segments.find((segment) => segment.kind === "pit-loss");
  const entry = events.find((event) => event.driverId === car.id && event.kind === "pit-entry");
  const exit = events.find((event) => event.driverId === car.id && event.kind === "pit-exit");
  const finish = events.find((event) => event.driverId === car.id && event.kind === "finish");
  assert.equal(entry.atSeconds, pit.startSeconds);
  assert.equal(exit.atSeconds, pit.endSeconds);
  assert.notEqual(entry.atSeconds, car.strategy.lapCosts[11].cumulativeSeconds);
  assert.equal(finish.atSeconds, car.totalSeconds);
  assert.equal(events.filter((event) => event.kind === "start").length, 1);
  assert.equal(events.filter((event) => event.kind === "finish").length, 20);
  assert.ok(events.every((event) => !["SC", "VSC"].includes(event.kind)));
});

test("scrubbing cannot leak future events and my-car filter preserves the shared start", () => {
  const grid = makeGrid();
  const all = buildReplayTelemetryEvents(grid);
  const pit = all.find((event) => event.driverId === "max-verstappen" && event.kind === "pit-entry");
  const before = occurredReplayEvents(all, pit.atSeconds - 0.001, "max-verstappen");
  assert.ok(!before.some((event) => event.id === pit.id));
  const at = occurredReplayEvents(all, pit.atSeconds, "max-verstappen");
  assert.ok(at.some((event) => event.id === pit.id));
  assert.ok(at.every((event) => event.driverId === null || event.driverId === "max-verstappen"));
  assert.deepEqual(occurredReplayEvents(all, 0, "max-verstappen").map((event) => event.kind), ["start"]);
  assert.deepEqual(buildReplayTelemetryEvents(grid), all);
});

test("a continuous cliff produces one entry event rather than one warning every lap", () => {
  const original = plan();
  const cliffPlan = { ...original, lapCosts: original.lapCosts.map((lap) => ({
    ...lap, tyreState: { ...lap.tyreState, condition: lap.lap >= 8 && lap.lap <= 12 ? "cliff" : "optimal" },
  })) };
  const grid = makeGrid(cliffPlan);
  const events = buildReplayTelemetryEvents(grid).filter((event) => event.driverId === "max-verstappen" && event.kind === "cliff");
  assert.equal(events.length, 1);
  assert.equal(events[0].lap, 8);
  const car = grid.cars.find((candidate) => candidate.id === "max-verstappen");
  assert.equal(events[0].atSeconds, car.replay.segments.find((segment) => segment.kind === "track" && segment.lap === 8).startSeconds);
});

test("undercut verdict is withheld until BOTH cars complete the settling lap", () => {
  const grid = makeGrid();
  const assessments = prepareReplayUndercuts(grid, "max-verstappen");
  assert.equal(assessments.length, 1);
  const assessment = assessments[0];
  assert.equal(assessment.opponentId, "george-russell");
  assert.equal(assessment.settlementLap, 20);
  const player = grid.cars.find((car) => car.id === "max-verstappen");
  const opponent = grid.cars.find((car) => car.id === "george-russell");
  const after = Math.max(player.lapTimings[19].cumulativeSeconds, opponent.lapTimings[19].cumulativeSeconds);
  assert.equal(assessment.resolvedAtSeconds, after);
  assert.deepEqual(settledReplayUndercuts(assessments, after - 0.001), []);
  assert.equal(settledReplayUndercuts(assessments, after).length, 1);
  assert.equal(assessment.gapAfterSeconds, player.lapTimings[19].cumulativeSeconds - opponent.lapTimings[19].cumulativeSeconds);
});

test("non-undercuts and an unsettled final-race stop never produce success claims", () => {
  assert.deepEqual(prepareReplayUndercuts(makeGrid(plan(17), plan(12)), "max-verstappen"), []);
  const grid = makeGrid(plan(26), plan(29));
  const assessments = prepareReplayUndercuts(grid, "max-verstappen");
  assert.equal(assessments.length, 1);
  assert.equal(assessments[0].status, "inconclusive");
  assert.deepEqual(settledReplayUndercuts(assessments, grid.durationSeconds), []);
  assert.deepEqual(prepareReplayUndercuts(grid, "car-0"), []);
  assert.deepEqual(prepareReplayUndercuts(grid, "max-verstappen", "max-verstappen"), []);
});
