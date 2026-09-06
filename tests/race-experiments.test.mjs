import assert from "node:assert/strict";
import test from "node:test";
import { MODEL_PARAMS } from "../app/model/params.ts";
import { runRaceExperiments, trafficRandomDraw, followingTrafficLoss, overtakeProbability, assessUndercut } from "../app/lib/race-experiments.ts";

// Deliberately simple race plans make accounting independently inspectable.
function plan(pits, drivingTimes = Array(30).fill(80)) {
  let cumulative = 0;
  const lapCosts = drivingTimes.map((time, index) => {
    const pitLossSeconds = pits.includes(index) ? 20 : 0;
    cumulative += time + pitLossSeconds;
    return { lap: index + 1, lapTimeSeconds: time + pitLossSeconds, pitLossSeconds, cumulativeSeconds: cumulative };
  });
  const boundaries = [0, ...pits, drivingTimes.length];
  return {
    scenarioSignature: "test-race", totalSeconds: cumulative, isLegal: true,
    pitAfterLaps: pits, stopCount: pits.length, lapCosts,
    stints: boundaries.slice(0, -1).map((start, index) => ({
      compound: index % 2 ? "H" : "M", startLap: start + 1, endLap: boundaries[index + 1],
    })),
  };
}

const dryPrior = {
  scProbability: 0, vscProbability: 0, sourceType: "project-estimate", sourceLabel: "test: no neutralisation",
};

test("traffic is charged only within one second and overtaking responds to RAC and pace", () => {
  assert.equal(followingTrafficLoss(0.5, 1), 0.4);
  assert.equal(followingTrafficLoss(1, 1), 0.4);
  assert.equal(followingTrafficLoss(1.001, 1), 0);
  assert.equal(followingTrafficLoss(-1, 1), 0);
  assert.equal(followingTrafficLoss(0.5, -1), 0);
  assert.ok(overtakeProbability(95, 1) > overtakeProbability(75, 1));
  assert.ok(overtakeProbability(85, 2) > overtakeProbability(85, 0));
  assert.equal(overtakeProbability(0, 0), MODEL_PARAMS.race.overtakeMin);
  assert.equal(overtakeProbability(100, 100), MODEL_PARAMS.race.overtakeMax);
});

test("300 seeded trials are reproducible and use an explicitly estimated prior", () => {
  const candidates = [plan([12]), plan([18])];
  const first = runRaceExperiments(candidates, { seed: 42 });
  const second = runRaceExperiments(candidates, { seed: 42 });
  assert.deepEqual(first, second);
  assert.equal(first.trials, 300);
  assert.equal(first.gridSize, 20);
  assert.equal(first.prior.sourceType, "project-estimate");
  assert.equal(first.method, "fixed-candidate-monte-carlo");
  assert.equal(first.eventTimelines.length, 300);
  assert.notDeepEqual(first.eventTimelines, runRaceExperiments(candidates, { seed: 43 }).eventTimelines);
});

test("every candidate uses the same event timeline per trial", () => {
  const result = runRaceExperiments([plan([8, 18]), plan([14]), plan([20])], { seed: 42, trials: 12 });
  for (const timeline of result.eventTimelines) {
    for (const candidate of result.candidates) {
      assert.equal(candidate.trials[timeline.trial].eventTimelineId, timeline.id);
    }
    for (const event of timeline.events) {
      assert.ok(event.startLap >= 1 && event.endLap <= 30 && event.startLap <= event.endLap);
    }
    if (timeline.events.length > 1) assert.ok(timeline.events[0].endLap < timeline.events[1].startLap);
  }
});

test("candidate order cannot alter rival assignment, common draws or trial outcomes", () => {
  const candidates = [plan([8, 18]), plan([14]), plan([20])];
  const first = runRaceExperiments(candidates, { seed: 139, trials: 15 });
  const reversed = runRaceExperiments([...candidates].reverse(), { seed: 139, trials: 15 });
  assert.deepEqual(first.eventTimelines, reversed.eventTimelines);
  for (const candidate of first.candidates) {
    const match = reversed.candidates.find((other) => other.signature === candidate.signature);
    assert.deepEqual(candidate.trials, match.trials);
    assert.equal(candidate.winRate, match.winRate);
  }
  const common = trafficRandomDraw(139, 1, 5, "player", "rival-2");
  for (let lap = 1; lap < 10; lap += 1) trafficRandomDraw(139, 1, lap, "rival-4", "rival-6");
  assert.equal(trafficRandomDraw(139, 1, 5, "player", "rival-2"), common);
  assert.notEqual(trafficRandomDraw(139, 1, 6, "player", "rival-2"), common);
});

test("identical plans receive identical outcomes and split candidate wins", () => {
  const candidate = plan([12]);
  const result = runRaceExperiments([candidate, candidate], { seed: 8, trials: 20 });
  assert.deepEqual(result.candidates[0].trials, result.candidates[1].trials);
  assert.equal(result.candidates[0].winRate, 0.5);
  assert.equal(result.candidates[1].winRate, 0.5);
});

test("SC discount uses the pit-entry lap even when the next charged lap is green", () => {
  const options = {
    seed: 1, trials: 1, trackLaps: 60,
    eventPrior: { ...dryPrior, scProbability: 1 },
  };
  const preview = runRaceExperiments([plan([20], Array(60).fill(80))], options);
  const event = preview.eventTimelines[0].events[0];
  assert.equal(event.kind, "SC");
  const candidate = plan([event.endLap], Array(60).fill(80));
  const result = runRaceExperiments([candidate], options);
  assert.deepEqual(result.eventTimelines, preview.eventTimelines);
  assert.ok(Math.abs(result.candidates[0].meanPitSavingSeconds - 20 * (1 - MODEL_PARAMS.race.scPitFactor)) < 1e-9);
  const overridden = runRaceExperiments([candidate], { ...options, pitLossSeconds: 30 });
  assert.ok(Math.abs(overridden.candidates[0].meanPitSavingSeconds - 30 * (1 - MODEL_PARAMS.race.scPitFactor)) < 1e-9);
});

test("zero-event scenarios have no pit saving and finite ordered quantiles", () => {
  const result = runRaceExperiments([plan([10]), plan([20])], { seed: 91, trials: 25, eventPrior: dryPrior });
  assert.equal(result.eventSummary.noEventTrials, 25);
  for (const candidate of result.candidates) {
    assert.equal(candidate.meanPitSavingSeconds, 0);
    assert.ok(Number.isFinite(candidate.meanSeconds));
    assert.ok(candidate.p10Seconds <= candidate.p90Seconds);
    assert.ok(candidate.meanTrafficLossSeconds >= 0);
    assert.ok(candidate.trials.every((trial) => trial.finishPosition >= 1 && trial.finishPosition <= 20));
  }
  assert.ok(Math.abs(result.candidates.reduce((sum, candidate) => sum + candidate.winRate, 0) - 1) < 1e-9);
});

test("invalid candidates and unsourced observed priors are rejected", () => {
  assert.throws(() => runRaceExperiments([]), /candidate/);
  assert.throws(() => runRaceExperiments([plan([10])], { trials: 0 }), /trials/);
  assert.throws(() => runRaceExperiments([plan([10])], { seed: NaN }), /seed/);
  assert.throws(() => runRaceExperiments([plan([10]), plan([5], Array(10).fill(80))]), /same race/);
  assert.throws(() => runRaceExperiments([plan([10])], { eventPrior: { ...dryPrior, sourceType: "observed" } }), /sourceUrl/);
  assert.throws(() => runRaceExperiments([plan([10])], { eventPrior: { ...dryPrior, scProbability: 2 } }), /scProbability/);
});

test("undercut is judged only after the defender stops plus three settling laps", () => {
  const defender = plan([12], Array(25).fill(80));
  const attackerTimes = Array(25).fill(80);
  for (let index = 8; index < 15; index += 1) attackerTimes[index] = 79;
  const attacker = plan([8], attackerTimes);
  const result = assessUndercut(attacker, defender, 2)[0];
  assert.equal(result.settlementLap, 15);
  assert.equal(result.equalCompletedStops, true);
  assert.equal(result.gapBeforeSeconds, 2);
  assert.equal(result.gapAfterSeconds, -5);
  assert.equal(result.status, "success");
  assert.equal(assessUndercut(plan([8], Array(25).fill(80)), defender, 2)[0].status, "failed");
  assert.equal(assessUndercut(attacker, defender, -2)[0].status, "not-applicable");
});

test("different completed stop counts or insufficient settling laps do not claim undercut success", () => {
  const earlyExtraStop = plan([8, 14], Array(25).fill(75));
  const defender = plan([12], Array(25).fill(80));
  assert.equal(assessUndercut(earlyExtraStop, defender, 50)[0].status, "inconclusive");
  assert.equal(assessUndercut(plan([20]), plan([29]), 2)[0].status, "inconclusive");
  assert.equal(assessUndercut(plan([20]), plan([20]), 2)[0].status, "not-applicable");
});
