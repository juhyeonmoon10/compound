import assert from "node:assert/strict";
import test from "node:test";
import {
  OBSERVED_BACKTEST_EVENTS,
  runStrategyBacktest,
} from "../app/lib/strategy-backtest.ts";

test("all nine observed plans cover their race continuously", () => {
  assert.equal(
    OBSERVED_BACKTEST_EVENTS.reduce((sum, event) => sum + event.drivers.length, 0),
    9,
  );
  for (const event of OBSERVED_BACKTEST_EVENTS) {
    for (const driver of event.drivers) {
      assert.equal(driver.stints[0].startLap, 1);
      assert.equal(driver.stints.at(-1).endLap, event.raceLaps);
      driver.stints.slice(1).forEach((stint, index) => {
        assert.equal(stint.startLap, driver.stints[index].endLap + 1);
      });
    }
  }
});

test("backtests are legal, deterministic and never beat the optimum", () => {
  for (const event of OBSERVED_BACKTEST_EVENTS) {
    for (const driver of event.drivers) {
      const first = runStrategyBacktest(event, driver);
      const second = runStrategyBacktest(event, driver);
      assert.equal(first.observed.isLegal, true);
      assert.equal(first.alternatives.length, 20);
      assert.ok(Number.isFinite(first.deltaToBestSeconds));
      assert.ok(first.deltaToBestSeconds >= -1e-7);
      assert.equal(first.observed.totalSeconds, second.observed.totalSeconds);
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
