import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TEAM_PROFILES } from "../app/lib/participants.ts";
import { MODEL_PARAMS } from "../app/model/params.ts";
import { RECENT_TEAM_EVIDENCE, OFFICIAL_TEAM_PACE_EVIDENCE, getRecentTeamPerformance, officialTeamPaceCoverage } from "../app/lib/recent-team-performance.ts";

const near = (a, b) => assert.ok(Math.abs(a - b) < MODEL_PARAMS.validation.toleranceSeconds);
const row = (eventId, value, laps = 20, season = 2026) => ({
  eventId, season, team: "Example", teamId: "example", compound: "M", laps, stints: 4,
  paceDeltaSeconds: value, paceStatus: "observational-proxy",
  degradationSecondsPerLap: 0.12, degradationCI95: [0.1, 0.14],
  referencePositiveTeamSlopeMedian: 0.1,
});

test("current-season observations include all eleven teams and keep 2025 comparison separate", () => {
  for (const team of TEAM_PROFILES) {
    const profile = getRecentTeamPerformance(team.id);
    assert.equal(profile.source.kind, "recent-observational", team.id);
    assert.deepEqual(profile.source.seasons, [RECENT_TEAM_EVIDENCE.selection.currentSeason]);
    assert.equal(profile.source.currentSeasonCollected, true);
    assert.ok(profile.source.events >= MODEL_PARAMS.historical.minTeamEvents);
    assert.ok(Number.isFinite(profile.observedPaceSeconds));
    assert.equal(profile.pitStationarySeconds, null);
    assert.equal(profile.pitCrewDeltaSeconds, MODEL_PARAMS.performance.neutralPitDeltaSeconds);
  }
  assert.equal(getRecentTeamPerformance("audi", 2025).observedPaceSeconds, null);
  assert.equal(getRecentTeamPerformance("cadillac", 2025).observedPaceSeconds, null);
  assert.ok(getRecentTeamPerformance("kick-sauber", 2025).observedPaceSeconds !== null);
});

test("event-equal averaging excludes other seasons and null rows rather than turning them into zero", () => {
  const rows = [row("a", 1, 20), row("b", 3, 400), row("c", null, 500), row("old", -50, 900, 2025)];
  const profile = getRecentTeamPerformance("example", 2026, rows);
  near(profile.observedPaceSeconds, 2);
  assert.equal(profile.source.events, 2);
  assert.equal(profile.source.laps, 420);
  near(profile.observedDegRatio, 1.2);
  assert.equal(getRecentTeamPerformance("example", 2026, rows.slice(0, 1)).observedPaceSeconds, null);
});

test("missing or nonfinite pace is neutral and raw nulls cannot enter the model as real zero observations", () => {
  for (const rows of [[], [row("a", null), row("b", Infinity)], [{ ...row("a", 1), laps: NaN }, row("b", 1)]]) {
    const result = getRecentTeamPerformance("example", 2026, rows);
    assert.equal(result.source.kind, "unavailable");
    assert.equal(result.observedPaceSeconds, null);
    assert.equal(result.paceSeconds, MODEL_PARAMS.performance.neutralPaceSeconds);
    assert.equal(result.degMultiplier, MODEL_PARAMS.performance.neutralDeg);
  }
  for (const team of TEAM_PROFILES) {
    const official = officialTeamPaceCoverage(team.id);
    assert.equal(official.verifiedValues, 0);
    assert.ok(official.observations.every(value => value.value === null));
  }
});

test("degradation needs positive intervals and separate multiple-event support", () => {
  const first = row("a", 1), second = row("b", 2);
  for (const altered of [
    { ...second, degradationCI95: [-0.1, 0.2] },
    { ...second, degradationSecondsPerLap: -1, degradationCI95: [-1.1, -0.9] },
    { ...second, referencePositiveTeamSlopeMedian: null },
    { ...second, degradationCI95: [NaN, 0.2] },
    { ...second, stints: 2 },
  ]) {
    const value = getRecentTeamPerformance("example", 2026, [first, altered]);
    assert.ok(value.observedPaceSeconds !== null);
    assert.equal(value.observedDegRatio, null);
    assert.equal(value.degMultiplier, MODEL_PARAMS.performance.neutralDeg);
  }
});

test("project shrink and caps do not mutate raw observation points", () => {
  const rows = [row("a", 50), row("b", 50)];
  const saved = structuredClone(rows);
  const result = getRecentTeamPerformance("example", 2026, rows);
  assert.equal(result.observedPaceSeconds, 50);
  assert.equal(result.paceSeconds, MODEL_PARAMS.historical.maxTeamPaceSeconds);
  assert.deepEqual(rows, saved);
});

// Render the actual component with real model/data imports; only stylesheet loading is skipped.
const componentCache = new Map();
function loadComponent(filename) {
  if (filename.endsWith(".css")) return {};
  if (filename.endsWith(".json")) return JSON.parse(readFileSync(filename, "utf8"));
  if (componentCache.has(filename)) return componentCache.get(filename).exports;
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), { fileName: filename, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const loaded = { exports: {} };
  componentCache.set(filename, loaded);
  const nativeRequire = createRequire(filename);
  const localRequire = (specifier) => {
    if (!specifier.startsWith(".")) return nativeRequire(specifier);
    const target = resolve(dirname(filename), specifier);
    const dependency = [target, `${target}.ts`, `${target}.tsx`].find(existsSync);
    if (!dependency) throw new Error(`Missing component dependency: ${specifier}`);
    return loadComponent(dependency);
  };
  runInThisContext(`(function(exports, require, module) {${compiled}\n})`, { filename })(loaded.exports, localRequire, loaded);
  return loaded.exports;
}
const { TeamObservationEvidence } = loadComponent(fileURLToPath(new URL("../app/HistoricalEvidencePanel.tsx", import.meta.url)));

test("rendered team evidence separates official missing values, two seasons, adoption and stationary pit absence", () => {
  const markup = renderToStaticMarkup(React.createElement(TeamObservationEvidence));
  for (const phrase of ["2025 관측 · 비교만", "2026 관측 · 우선 채택", "채택 페이스 · 최속 0", "피트크루 보정 0초 · 중립", "미확보를 0초로 평균 내지 않습니다", "동일 성능 모드에서는 이 보정을 적용하지 않습니다"]) {
    assert.ok(markup.includes(phrase), phrase);
  }
  assert.equal((markup.match(/확인 0 \/ 5경기 · 결측 제외/g) ?? []).length, TEAM_PROFILES.length);
  assert.ok(markup.includes('role="region" tabindex="0"'));
  assert.ok(markup.includes('scope="col"'));
  assert.ok(markup.includes("아우디"));
  assert.ok(markup.includes("캐딜락"));
  for (const event of RECENT_TEAM_EVIDENCE.events) assert.ok(markup.includes(`${event.timingSourceUrl}SessionInfo.json`));
  for (const event of OFFICIAL_TEAM_PACE_EVIDENCE.events) assert.ok(markup.includes(event.source.url));
});
