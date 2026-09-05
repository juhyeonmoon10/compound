import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_EXPERIMENTS,
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
  assert.equal(parseExperiments('{"version":2,"records":[]}').status, "incompatible");
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
