import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_EXPERIMENTS,
  EXPERIMENT_STORAGE_KEY,
  EXPERIMENT_STORAGE_VERSION,
  compareExperiments,
  createExperiment,
  csvCell,
  experimentsToCsv,
  isExperimentSnapshot,
  parseExperiments,
  serializeExperiments,
} from "../app/lib/experiment-notebook.ts";

function snapshot(overrides = {}) {
  return {
    trackId: "melbourne", trackName: "앨버트 파크", laps: 58,
    modelSource: "project", pitLossSeconds: 20.5, degradationPercent: 100,
    trackTemperatureC: 34, maxStops: 2, modeLabel: "TOP 1",
    strategy: {
      formattedTime: "1:24:12.500", totalSeconds: 5052.5,
      stints: [{ compound: "M", startLap: 1, endLap: 22 }, { compound: "H", startLap: 23, endLap: 58 }],
      pitAfterLaps: [22], scenarioSignature: "model:v3:all-parameters",
    }, ...overrides,
  };
}

function record(id = "first", overrides = {}) {
  return createExperiment(snapshot(overrides), "기준 실험", { id, createdAt: "2026-09-05T03:00:00.000Z" });
}

test("snapshots preserve numeric precision and detach mutable input arrays", () => {
  const input = snapshot();
  const saved = createExperiment(input, "  마모 실험  ", { id: "one", createdAt: "2026-09-05T03:00:00.000Z" });
  input.strategy.stints[0].endLap = 10;
  input.strategy.pitAfterLaps.push(50);
  assert.equal(saved.name, "마모 실험");
  assert.equal(saved.strategy.stints[0].endLap, 22);
  assert.deepEqual(saved.strategy.pitAfterLaps, [22]);
  assert.equal(saved.strategy.totalSeconds, 5052.5);
});

test("malformed or discontinuous strategy records cannot enter storage", () => {
  for (const strategy of [
    { ...snapshot().strategy, totalSeconds: NaN },
    { ...snapshot().strategy, pitAfterLaps: [23] },
    { ...snapshot().strategy, stints: [{ compound: "M", startLap: 1, endLap: 22 }, { compound: "H", startLap: 24, endLap: 58 }] },
    { ...snapshot().strategy, stints: [{ compound: "M", startLap: 1, endLap: 22 }, { compound: "W", startLap: 23, endLap: 58 }] },
    { ...snapshot().strategy, stints: [{ compound: "M", startLap: 1, endLap: 22 }, { compound: "H", startLap: 23, endLap: 57 }] },
  ]) assert.equal(isExperimentSnapshot(snapshot({ strategy })), false);
  assert.equal(isExperimentSnapshot(snapshot({ maxStops: 0 })), false);
});

test("storage round-trip has an explicit version and preserves stable identities", () => {
  const records = [record(), record("second")];
  const result = parseExperiments(serializeExperiments(records));
  assert.equal(result.status, "ok");
  assert.deepEqual(result.records, records);
  assert.equal(parseExperiments(null).status, "empty");
  assert.equal(parseExperiments("{bad").status, "invalid");
  assert.equal(parseExperiments('{"version":3,"records":[]}').status, "incompatible");
});

test("corrupt records and duplicate IDs are isolated without losing valid records", () => {
  const first = record();
  const result = parseExperiments(JSON.stringify({ version: 1, records: [null, first, { ...first, name: "duplicate" }, record("second"), { ...first, id: "broken", laps: 500 }] }));
  assert.deepEqual(result.records.map((item) => item.id), ["first", "second"]);
  assert.equal(result.discardedCount, 3);
});

test("storage limits are enforced rather than silently evicting older experiments on save", () => {
  const records = Array.from({ length: MAX_EXPERIMENTS + 1 }, (_, index) => record(String(index)));
  assert.throws(() => serializeExperiments(records), /Invalid experiment collection/);
  assert.throws(() => serializeExperiments([record(), record()]), /Invalid experiment collection/);
  assert.equal(parseExperiments(JSON.stringify({ version: 1, records })).records.length, MAX_EXPERIMENTS);
});

test("comparison reports second-minus-first and distinguishes conditional from strategy effects", () => {
  const first = record();
  const faster = record("faster", { strategy: { ...snapshot().strategy, totalSeconds: 5049.25 } });
  assert.deepEqual(compareExperiments(first, faster), {
    deltaSeconds: -3.25, differences: [], sameConditions: true, verificationMissing: false,
  });
  const different = record("different", { trackTemperatureC: 45, pitLossSeconds: 25, strategy: { ...snapshot().strategy, scenarioSignature: "different" } });
  assert.deepEqual(compareExperiments(first, different).differences, ["피트 손실", "노면 온도"]);
  assert.equal(compareExperiments(first, different).sameConditions, false);
  const hiddenChange = record("hidden", { strategy: { ...snapshot().strategy, scenarioSignature: "fuel-or-humidity-change" } });
  assert.deepEqual(compareExperiments(first, hiddenChange).differences, ["기타 모델 조건"]);
  const unverified = record("old", { strategy: { ...snapshot().strategy, scenarioSignature: undefined } });
  assert.equal(compareExperiments(first, unverified).sameConditions, false);
  assert.equal(compareExperiments(first, unverified).verificationMissing, true);
});

test("CSV quotes commas, double quotes and newlines and blocks spreadsheet formulas", () => {
  assert.equal(csvCell('실험, "A"\n다음 줄'), '"실험, ""A""\n다음 줄"');
  for (const value of ["=HYPERLINK(\"bad\")", "+1+1", "-2+3", "@SUM(A1)", "  =1+1", "\t=1+1", "\rplain"]) {
    assert.ok(csvCell(value).startsWith('"\''));
  }
  assert.equal(csvCell(-5), '"-5"');
  const saved = { ...record(), name: '=HYPERLINK("https://invalid.example")' };
  const csv = experimentsToCsv([saved]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"\'=HYPERLINK(""https://invalid.example"")"'));
  assert.ok(csv.includes('"M:L1–22 / H:L23–58"'));
  assert.ok(csv.endsWith("\r\n"));
});

function research(overrides = {}) {
  return {
    weather: { preset: "dry-to-rain", startLap: 20, endLap: 58, initialWater: 0, carsOnTrack: 20 },
    seed: 20260906, scTimelineSummary: "시드 20260906 · 300회 · SC 108 / VSC 85 · 프로젝트 추정",
    teamId: "red-bull", driverId: "max-verstappen", performanceEnabled: true,
    mc: { trials: 300, winRate: 0.79, p10Seconds: 5040.125, p90Seconds: 5060.75 },
    eaRatings: { sourceUrl: "https://www.ea.com/games/f1/ratings", checkedAt: "2026-09-06", iteration: "2026june",
      ratings: { OVR: 95, EXP: 88, RAC: 96, AWA: 82, PAC: 97 } },
    ...overrides,
  };
}

test("v1 records are discoverable under the same key and round-trip without invented research", () => {
  const original = [record(), record("legacy-second")];
  const legacy = JSON.stringify({ version: 1, records: original });
  const parsed = parseExperiments(legacy);
  assert.equal(EXPERIMENT_STORAGE_KEY, "apex:experiment-notebook:v1");
  assert.equal(EXPERIMENT_STORAGE_VERSION, 2);
  assert.equal(parsed.discardedCount, 0);
  assert.deepEqual(parsed.records, original);
  assert.equal(Object.hasOwn(parsed.records[0], "research"), false);
  const upgraded = serializeExperiments([...parsed.records, record("new", { research: research() })]);
  assert.equal(JSON.parse(upgraded).version, 2);
  assert.deepEqual(parseExperiments(upgraded).records.slice(0, 2), original);
  assert.equal(legacy, JSON.stringify({ version: 1, records: original }));
});

test("v2 research preserves the weather, seed, MC precision, EA provenance and detaches nested objects", () => {
  const input = snapshot({ research: research() });
  const saved = createExperiment(input, "비 오는 날 실험", { id: "wet", createdAt: "2026-09-06T03:00:00.000Z" });
  const expected = structuredClone(saved);
  input.research.weather.startLap = 10;
  input.research.mc.p10Seconds = 1;
  input.research.eaRatings.ratings.PAC = 1;
  assert.deepEqual(saved, expected);
  assert.equal(saved.research.seed, 20260906);
  assert.equal(saved.research.mc.p10Seconds, 5040.125);
  assert.deepEqual(parseExperiments(serializeExperiments([saved])).records, [saved]);
});

test("all five compounds are saved without accepting unrelated symbols or prototype keys", () => {
  for (const compound of ["S", "M", "H", "INTER", "WET"]) {
    const original = snapshot();
    const data = { ...original, strategy: { ...original.strategy,
      stints: [{ compound, startLap: 1, endLap: 22 }, { compound: "H", startLap: 23, endLap: 58 }] } };
    assert.equal(isExperimentSnapshot(data), true);
    const saved = createExperiment(data, "타이어", { id: compound, createdAt: "2026-09-06T03:00:00.000Z" });
    assert.equal(parseExperiments(serializeExperiments([saved])).records[0].strategy.stints[0].compound, compound);
  }
  for (const compound of ["I", "W", "__proto__", "constructor", ["S"]]) {
    const original = snapshot();
    assert.equal(isExperimentSnapshot({ ...original, strategy: { ...original.strategy,
      stints: [{ compound, startLap: 1, endLap: 22 }, { compound: "H", startLap: 23, endLap: 58 }] } }), false);
  }
});

test("invalid new research fields cannot silently corrupt a saved experiment", () => {
  for (const override of [
    { seed: -1 }, { seed: 2 ** 32 }, { seed: 0.2 }, { seed: "42" },
    { weather: { preset: "snow" } }, { weather: { preset: ["none"] } },
    { weather: { preset: "none", initialWater: null } }, { weather: { preset: "light", startLap: 40, endLap: 20 } },
    { weather: { preset: "heavy", endLap: 60 } }, { weather: { preset: "none", carsOnTrack: -1 } },
    { teamId: "" }, { driverId: "" }, { performanceEnabled: "yes" }, { scTimelineSummary: "" },
    { mc: { trials: 0, winRate: 0.5, p10Seconds: 20, p90Seconds: 30 } },
    { mc: { trials: 300, winRate: 1.1, p10Seconds: 20, p90Seconds: 30 } },
    { mc: { trials: 300, winRate: 0.5, p10Seconds: 30, p90Seconds: 20 } },
    { eaRatings: { ...research().eaRatings, ratings: { ...research().eaRatings.ratings, PAC: 101 } } },
  ]) {
    const input = snapshot({ research: research(override) });
    assert.equal(isExperimentSnapshot(input), false, JSON.stringify(override));
    assert.throws(() => createExperiment(input, "invalid", { id: "x", createdAt: "2026-09-06T03:00:00.000Z" }), /Invalid experiment snapshot/);
  }
});

test("research comparisons flag input differences but do not treat MC outputs as changed conditions", () => {
  const baseline = record("first", { research: research() });
  const changed = record("second", { research: research({ seed: 7, driverId: "lando-norris", teamId: "mclaren",
    performanceEnabled: false, scTimelineSummary: "SC 없음", weather: { preset: "none" }, mc: { ...research().mc, trials: 100 } }) });
  assert.deepEqual(compareExperiments(baseline, changed).differences,
    ["강수 조건", "난수 시드", "SC/VSC 시나리오", "팀", "선수", "능력치 적용", "확률 실험 시행 수"]);
  const resultsOnly = record("results", { research: research({ mc: { ...research().mc, winRate: 0.9, p10Seconds: 5020 } }) });
  assert.equal(compareExperiments(baseline, resultsOnly).sameConditions, true);
  const legacy = compareExperiments(record("legacy"), baseline);
  assert.equal(legacy.sameConditions, false);
  assert.equal(legacy.verificationMissing, true);
  assert.deepEqual(legacy.differences, ["연구 조건 기록 유무"]);
});

test("weather defaults compare equal to explicitly resolved values and rating changes are flagged", () => {
  const implicit = record("implicit", { research: research({ weather: { preset: "none" } }) });
  assert.deepEqual(implicit.research.weather, { preset: "none", startLap: 1, endLap: 58, initialWater: 0, carsOnTrack: 20 });
  const explicit = record("explicit", { research: research({ weather: { preset: "none", startLap: 1, endLap: 58, initialWater: 0, carsOnTrack: 20 } }) });
  assert.equal(compareExperiments(implicit, explicit).sameConditions, true);
  const updatedEa = record("updated", { research: research({ weather: { preset: "none" },
    eaRatings: { ...research().eaRatings, ratings: { ...research().eaRatings.ratings, PAC: 98 } } }) });
  assert.deepEqual(compareExperiments(implicit, updatedEa).differences, ["EA 레이팅 스냅샷"]);
});

test("CSV includes reproducibility inputs, MC outputs and provenance with legacy blank cells", () => {
  const current = record("research", { research: research({ scTimelineSummary: "=HYPERLINK(\"bad\")" }) });
  const csv = experimentsToCsv([current, record("legacy")]);
  for (const text of ["난수 시드", "SC/VSC 시나리오 요약", "강수 프리셋", "팀 ID", "선수 ID", "EA PAC", "MC P10(초)", "20260906", "5040.125", "2026june", "미기록(v1)"]) {
    assert.ok(csv.includes(text), text);
  }
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'));
  // This fixture has no newlines in cells: every row must retain every column.
  const columnCount = (row) => (row.match(/","/g)?.length ?? 0) + 1;
  const rows = csv.trimEnd().split("\r\n");
  assert.equal(columnCount(rows[0]), columnCount(rows[1]));
  assert.equal(columnCount(rows[0]), columnCount(rows[2]));
});
