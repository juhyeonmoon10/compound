import assert from "node:assert/strict";
import test from "node:test";
import {
  OBSERVED_BACKTEST_EVENTS,
  BACKTEST_EVIDENCE,
  createBacktestInput,
  runStrategyBacktest,
} from "../app/lib/strategy-backtest.ts";
import { evaluateStrategy, TRACK_PRESETS } from "../app/lib/strategy.ts";
import { MODEL_PARAMS } from "../app/model/params.ts";

test("seven races and all 21 observed podium plans have continuous coverage", () => {
  assert.equal(OBSERVED_BACKTEST_EVENTS.length, 7);
  assert.equal(new Set(OBSERVED_BACKTEST_EVENTS.map(event => event.id)).size, 7);
  assert.equal(
    OBSERVED_BACKTEST_EVENTS.reduce((sum, event) => sum + event.drivers.length, 0),
    21,
  );
  for (const event of OBSERVED_BACKTEST_EVENTS) {
    for (const driver of event.drivers) {
      assert.equal(driver.stints[0].startLap, 1);
      assert.equal(driver.stints.at(-1).endLap, event.raceLaps);
      driver.stints.slice(1).forEach((stint, index) => {
        assert.equal(stint.startLap, driver.stints[index].endLap + 1);
      });
      const collected = event.evidence.drivers.find(item => item.code === driver.code);
      assert.deepEqual(driver.stints, collected.stints, `${event.id} ${driver.code}: recorded stint data`);
    }
  }
});

test("the previously published nine strategy sequences are preserved", () => {
  const previous = [
    ["austria-2025", ["M:1-20|H:21-52|M:53-70", "M:1-24|H:25-53|M:54-70", "M:1-25|H:26-49|M:50-70"]],
    ["hungary-2025", ["M:1-31|H:32-70", "M:1-18|H:19-45|H:46-70", "M:1-19|H:20-43|H:44-70"]],
    ["italy-2025", ["M:1-37|H:38-53", "M:1-46|S:47-53", "M:1-45|S:46-53"]],
  ];
  for (const [id, sequences] of previous) {
    const event = OBSERVED_BACKTEST_EVENTS.find(item => item.id === id);
    assert.deepEqual(event.drivers.map(driver => driver.stints.map(stint => `${stint.compound}:${stint.startLap}-${stint.endLap}`).join("|")), sequences);
  }
});

test("official elapsed time is winner time plus gap, not the gap or lap-time sum", () => {
  for (const event of BACKTEST_EVIDENCE.events) {
    assert.match(event.source.timingUrl, /^https:\/\/livetiming\.formula1\.com\/static\//);
    const winnerTime = event.drivers[0].resultTimeSeconds;
    for (const driver of event.drivers) {
      assert.equal(driver.resultStatus, "Finished");
      assert.ok(Math.abs(driver.raceElapsedSeconds - winnerTime - driver.gapToWinnerSeconds) < 1e-6);
      assert.ok(driver.raceElapsedSeconds > 3_000);
      if (driver.finish > 1) assert.equal(driver.gapToWinnerSeconds, driver.resultTimeSeconds);
    }
  }
  const britain = BACKTEST_EVIDENCE.events.find(event => event.id === "britain-2025");
  assert.equal(britain.drivers[0].raceElapsedSeconds, 5_835.735);
  assert.equal(britain.drivers[1].raceElapsedSeconds, 5_842.547);
});

test("baseline stays independent of actual elapsed time and Britain uses a labelled wet approximation", () => {
  for (const event of OBSERVED_BACKTEST_EVENTS) {
    const input = createBacktestInput(event);
    assert.equal(input.baseLapTimeSeconds, TRACK_PRESETS[event.trackId].baseLapTimeSeconds);
    const alteredTimes = { ...event, drivers: event.drivers.map(driver => ({ ...driver, raceElapsedSeconds: driver.raceElapsedSeconds * 2 })) };
    assert.deepEqual(createBacktestInput(alteredTimes), input);
  }
  const britain = OBSERVED_BACKTEST_EVENTS.find(event => event.id === "britain-2025");
  const input = createBacktestInput(britain);
  assert.equal(input.weather.preset, "rain-to-dry");
  assert.equal(input.rules.maxStops, MODEL_PARAMS.weather.maxStops);
  assert.equal(input.rules.requireTwoDryCompounds, true);
  assert.equal(input.weather.endLap, Math.max(...britain.evidence.weather.rainfallLapNumbers));
  assert.ok(britain.evidence.weather.wetTyreLapFraction > 0);
  assert.ok(britain.evidence.raceControl.scSignalStarts > 0);
});

test("rain does not waive the two-compound rule without actual INTER or WET use", () => {
  const britain = OBSERVED_BACKTEST_EVENTS.find(event => event.id === "britain-2025");
  const input = createBacktestInput(britain);
  const dryOnly = [
    { compound: "S", startLap: 1, endLap: 20 },
    { compound: "S", startLap: 21, endLap: 40 },
    { compound: "S", startLap: 41, endLap: britain.raceLaps },
  ];
  assert.equal(evaluateStrategy({ ...input, stints: dryOnly }).isLegal, false);
  for (const compound of ["INTER", "WET"]) {
    const usesWetTyre = [{ ...dryOnly[0], compound }, ...dryOnly.slice(1)];
    assert.equal(evaluateStrategy({ ...input, stints: usesWetTyre }).isLegal, true, compound);
  }
});

test("backtests are deterministic, report full-time errors, and comparable plans never beat the optimum", () => {
  for (const event of OBSERVED_BACKTEST_EVENTS) {
    for (const driver of event.drivers) {
      const first = runStrategyBacktest(event, driver);
      const second = runStrategyBacktest(event, driver);
      assert.equal(first.comparableToOptimizer, first.observed.isLegal);
      assert.equal(first.alternatives.length, 20);
      assert.ok(Number.isFinite(first.deltaToBestSeconds));
      if (first.comparableToOptimizer) assert.ok(first.deltaToBestSeconds >= -1e-7);
      assert.equal(first.observed.totalSeconds, second.observed.totalSeconds);
      assert.deepEqual(first.alternatives, second.alternatives);
      assert.equal(first.modelRaceElapsedSeconds, first.observed.totalSeconds);
      assert.equal(first.actualRaceElapsedSeconds, driver.raceElapsedSeconds);
      assert.equal(first.modelMinusActualSeconds, first.modelRaceElapsedSeconds - driver.raceElapsedSeconds);
      assert.equal(first.absoluteRaceErrorPercent, Math.abs(first.modelMinusActualSeconds) / driver.raceElapsedSeconds * 100);
      assert.ok(first.limitations.some(text => text.includes("SC/VSC")));
      assert.ok(first.limitations.some(text => text.includes("중고 타이어")));
      assert.match(first.sourceUrl, /^https:\/\/www\.formula1\.com\//);
    }
  }
});

test("used sets from timing data remain explicitly marked", () => {
  const used = OBSERVED_BACKTEST_EVENTS.flatMap((event) =>
    event.drivers.flatMap((driver) =>
      driver.stints.filter((stint) => stint.observedTyreLifeStart > 1),
    ),
  );
  assert.ok(used.length >= 4);
});
