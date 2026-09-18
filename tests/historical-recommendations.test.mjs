import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { recommendHistoricalStrategies, importHistoricalStints, STRATEGY_EXAMPLES } from "../app/lib/historical-recommendations.ts";

const conditions = { trackId: "melbourne", startingGridPosition: 10, trackTemperatureC: 34, airTemperatureC: 23, humidityPercent: 58, maxStops: 2, laps: 58, weather: { preset: "none" } };
const driver = (code, grid, pit = 20, finish = 9) => ({ code, name: code, team: "test fixture", gridPosition: grid, finishPosition: finish, stints: [{ compound: "M", startLap: 1, endLap: pit, tyreLifeStart: 1 }, { compound: "H", startLap: pit + 1, endLap: 58, tyreLifeStart: 1 }] });
const event = (overrides = {}) => ({ id: "fixture", season: 2025, trackId: "melbourne", name: "test fixture", date: "2025-01-01", raceLaps: 58, trackTemperatureC: 34, airTemperatureC: 23, humidityPercent: 58, weatherKind: "dry", wetLapStart: null, wetLapEnd: null, raceControl: { sc: false, vsc: false, red: false }, timingUrl: "https://example.invalid/test-fixture", drivers: [driver("AAA", 10)], ...overrides });

test("ranking uses starting grid and temperatures, not final position or model time", () => {
  const events = [event({ drivers: [driver("WIN", 1, 18, 1), driver("MID", 10, 24, 12), driver("CLOSE", 8, 21, 9)] })];
  const first = recommendHistoricalStrategies(conditions, events);
  assert.deepEqual(first.matches.map(row => row.driver.code), ["MID", "CLOSE"]);
  assert.equal(recommendHistoricalStrategies({ ...conditions, startingGridPosition: 2 }, events).matches[0].driver.code, "WIN");
  const cold = event({ id: "cold", trackTemperatureC: 26, drivers: [driver("COLD", 10)] });
  const warm = event({ id: "warm", trackTemperatureC: 40, drivers: [driver("WARM", 10, 21)] });
  assert.equal(recommendHistoricalStrategies({ ...conditions, trackTemperatureC: 39 }, [cold, warm]).matches[0].driver.code, "WARM");
});

test("never fills missing recommendations with another circuit, weather or invented plans", () => {
  assert.equal(recommendHistoricalStrategies({ ...conditions, trackId: "madrid" }, [event()]).matches.length, 0);
  assert.equal(recommendHistoricalStrategies(conditions, [event({ weatherKind: "wet" })]).matches.length, 0);
  assert.equal(recommendHistoricalStrategies({ ...conditions, trackTemperatureC: 65 }, [event()]).matches.length, 0);
  assert.equal(recommendHistoricalStrategies(conditions, [event({ trackTemperatureC: null })]).matches.length, 0);
  assert.equal(recommendHistoricalStrategies(conditions, [event({ airTemperatureC: 50 })]).matches.length, 0);
  assert.equal(recommendHistoricalStrategies(conditions, [event({ humidityPercent: 90 })]).matches.length, 0);
  const result = recommendHistoricalStrategies(conditions, [event()]);
  assert.equal(result.matches.length, 1);
  assert.match(result.reason, /1개/);
});

test("duplicate observed plans are deduplicated; every returned lap stays intact", () => {
  const original = event({ drivers: [driver("AAA", 10), driver("BBB", 10), driver("CCC", 11, 21)] });
  const snapshot = JSON.stringify(original);
  const result = recommendHistoricalStrategies(conditions, [original]);
  assert.equal(result.candidateCount, 3);
  assert.equal(result.matches.length, 2);
  assert.equal(result.matches[0].driver.stints, original.drivers[0].stints);
  assert.equal(JSON.stringify(original), snapshot);
});

test("rain transitions must match timing as well as wet/dry category", () => {
  const wet = event({ weatherKind: "wet-to-dry", wetLapStart: 1, wetLapEnd: 35 });
  assert.equal(recommendHistoricalStrategies({ ...conditions, weather: { preset: "rain-to-dry", endLap: 35 } }, [wet]).matches.length, 1);
  assert.equal(recommendHistoricalStrategies({ ...conditions, weather: { preset: "rain-to-dry", endLap: 8 } }, [wet]).matches.length, 0);
  assert.equal(recommendHistoricalStrategies({ ...conditions, weather: { preset: "none", initialWater: 0.8 } }, [wet]).matches.length, 0);
});

test("only explicit simulation import adjusts the final stint and never rescales pit laps", () => {
  const match = recommendHistoricalStrategies({ ...conditions, laps: 59 }, [event()]).matches[0];
  assert.match(match.adaptation, /1랩 연장/);
  const imported = importHistoricalStints(match, 59);
  assert.equal(imported[0].endLap, 20);
  assert.equal(imported[1].endLap, 59);
  assert.equal(match.driver.stints[1].endLap, 58);
  assert.equal(importHistoricalStints(match, 65), null);
});

test("dataset has verifiable sources, contiguous actual plans and more than podium coverage", () => {
  assert.ok(STRATEGY_EXAMPLES.events.length >= 30);
  assert.ok(STRATEGY_EXAMPLES.events.some(e => e.drivers.some(d => d.gridPosition >= 15)));
  for (const e of STRATEGY_EXAMPLES.events) {
    assert.match(e.timingUrl, /^https:\/\/livetiming\.formula1\.com\/static\/(2023|2024|2025)\//);
    for (const d of e.drivers) {
      assert.ok(d.gridPosition > 0 && d.finishPosition > 0);
      assert.equal(d.stints[0].startLap, 1);
      assert.equal(d.stints.at(-1).endLap, e.raceLaps);
      d.stints.forEach((s, i) => { assert.ok(s.endLap >= s.startLap); if (i) assert.equal(s.startLap, d.stints[i-1].endLap + 1); });
    }
  }
  const defaultResult = recommendHistoricalStrategies(conditions);
  assert.ok(defaultResult.matches.length > 0, "default dry Melbourne must use actual dry evidence");
  assert.ok(defaultResult.matches.every(row => row.event.trackId === "melbourne" && row.event.weatherKind === "dry"));
});

test("recommendation surface is historical; DP is retained only as a separate model baseline", () => {
  const lab = readFileSync(new URL("../app/StrategyLab.tsx", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../app/HistoricalStrategyRecommendations.tsx", import.meta.url), "utf8");
  assert.match(lab, /workspace === "board" && <HistoricalStrategyRecommendations/);
  assert.match(lab, /모델 계산 후보/);
  assert.match(lab, /importHistoricalStints\(match, appliedTrack.laps\)/);
  assert.match(ui, /조건 유사도 순/);
  assert.match(ui, /F1 원본 타이밍 자료/);
  assert.doesNotMatch(ui, /optimizeTyreStrategies/);
});
