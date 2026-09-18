import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRaceGrid } from "../app/lib/race-grid.ts";
import { evaluateStrategy, TRACK_PRESETS } from "../app/lib/strategy.ts";
import { buildRaceClassification } from "../app/lib/race-results.ts";
import { createVirtualRace, DEFAULT_INCIDENT_SETTINGS, virtualRaceFrameAt, virtualWallSecondsAt } from "../app/lib/virtual-incidents.ts";

const strategy = evaluateStrategy({ laps: 8, pitLossSeconds: 20, stints: [
  { compound: "S", startLap: 1, endLap: 4 }, { compound: "H", startLap: 5, endLap: 8 },
] });
const grid = createRaceGrid(Array.from({ length: 20 }, (_, i) => ({ id: `car-${i}`, label: `C${i}`, gridPosition: i + 1, pitGroup: `t${i}`, strategy })));
const race = createVirtualRace(grid, "car-9", DEFAULT_INCIDENT_SETTINGS, { enabled: true, circuitLengthMeters: 5300 });

test("classification uses final virtual finish clocks and actual completed stops, not baseline predictions", () => {
  const result = buildRaceClassification(race), frame = virtualRaceFrameAt(race, race.durationSeconds);
  assert.equal(result.rows.length, 20);
  assert.equal(result.finishers, 20);
  assert.equal(result.totalStops, 20);
  assert.equal(result.podium.length, 3);
  for (const row of result.rows) {
    const car = frame.cars.find(car => car.id === row.id);
    assert.equal(row.position, car.position);
    assert.equal(row.finishSeconds, car.totalSeconds);
    assert.equal(row.gapSeconds, row.finishSeconds - result.rows[0].finishSeconds);
    assert.equal(row.completedLaps, 8);
    assert.equal(row.stints.reduce((sum, stint) => sum + stint.distanceLaps, 0), 8);
    assert.equal(row.fastestLap.seconds, Math.min(...Array.from({ length: 8 }, (_, i) => {
      const plan = grid.cars.find(car => car.id === row.id);
      return virtualWallSecondsAt(race, row.id, plan.lapTimings[i].cumulativeSeconds)
        - virtualWallSecondsAt(race, row.id, i ? plan.lapTimings[i - 1].cumulativeSeconds : 0);
    })));
  }
  assert.ok(result.rows.some(row => row.finishSeconds > grid.cars.find(car => car.id === row.id).totalSeconds));
});

test("retirement excludes future stints, pit stops, finish times and incomplete fastest laps", () => {
  const dnf = createVirtualRace(grid, "car-9", { ...DEFAULT_INCIDENT_SETTINGS, enabled: true, playerPercent: 100, othersPercent: 0, response: "SC" });
  const result = buildRaceClassification(dnf), row = result.rows.find(row => row.id === "car-9");
  const event = dnf.incidents[0];
  assert.equal(row.retired, true);
  assert.equal(row.finishSeconds, null);
  assert.equal(row.gapSeconds, null);
  assert.equal(row.positionChange, null);
  assert.equal(row.completedLaps, Math.floor(event.distance));
  assert.ok(Math.abs(row.stints.reduce((sum, stint) => sum + stint.distanceLaps, 0) - event.distance) < 1e-6);
  assert.ok(!row.fastestLap || row.fastestLap.lap <= row.completedLaps);
  assert.equal(result.podium.some(item => item.id === row.id), false);
  const all = buildRaceClassification(createVirtualRace(grid, "car-9", { ...DEFAULT_INCIDENT_SETTINGS, enabled: true, playerPercent: 100, othersPercent: 100, response: "SC" }));
  assert.equal(all.finishers, 0);
  assert.equal(all.podium.length, 0);
});

const require = createRequire(import.meta.url), ts = require("typescript");
const url = new URL("../app/RaceResults.tsx", import.meta.url);
let compiled = ts.transpileModule(readFileSync(url, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText.replace(/import "\.\/race-results.css";/, "");
for (const name of ["react", "react/jsx-runtime"]) compiled = compiled.replaceAll(`from "${name}"`, `from ${JSON.stringify(pathToFileURL(require.resolve(name)).href)}`);
for (const name of ["./lib/participants", "./lib/race-results", "./lib/replay-telemetry", "./lib/strategy", "./model/params"]) compiled = compiled.replaceAll(`from "${name}"`, `from ${JSON.stringify(new URL(`${name}.ts`, url).href)}`);
const { default: Results } = await import(`data:text/javascript,${encodeURIComponent(compiled)}`);

test("broadcast board renders classification, podium, real simulated fastest lap and preserved actions", () => {
  const html = renderToStaticMarkup(createElement(Results, { race, track: TRACK_PRESETS.melbourne, score: 95, strategyDelta: 4.2,
    onReplay() {}, onEditStrategy() {}, onOpenAnalysis() {}, onReturnToTrack() {}, onFullscreen() {}, fullscreen: false }));
  for (const text of ["RACE CLASSIFICATION", "PODIUM", "FASTEST LAP", "시뮬레이션 결과", "타이어 전략", "1–10", "11–20", "같은 전략 다시 주행", "전략 수정", "데이터 분석", "주행 화면으로", "화면 참고 출처"]) assert.ok(html.includes(text), text);
  assert.equal((html.match(/<tr data-player=/g) ?? []).length, 10);
  assert.match(html, /공식 FIA 분류가 아닙니다/);
  assert.match(html, /전략 점수 95/);
  assert.doesNotMatch(html, /NaN|Infinity|undefined/);
});
