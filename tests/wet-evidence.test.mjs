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
import evidence from "../app/data/wet-weather-2025.json" with { type: "json" };

function quantile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position), upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

test("saved five comparisons and per-race quantiles preserve the original observed points", () => {
  const expected = { melbourne: [[46, 6.367, 4, 6]], silverstone: [[8, -2.342, 6, 11], [9, -6.186, 5, 10], [40, 2.056, 2, 7], [41, 0.714, 2, 6]], spa: [] };
  for (const event of evidence.events) {
    assert.deepEqual(event.sameLapComparisons.map(row => [row.lap, row.firstMinusSecondSeconds, row.firstSamples, row.secondSamples]), expected[event.trackId]);
    for (const distribution of event.sameLapDifferenceDistributions) {
      const values = distribution.points.map(row => row.firstMinusSecondSeconds);
      assert.equal(distribution.statistics.count, values.length);
      for (const [key, percentile] of [["min", 0], ["q1", 0.25], ["median", 0.5], ["q3", 0.75], ["max", 1]]) {
        assert.ok(Math.abs(distribution.statistics[key] - quantile(values, percentile)) <= 0.000501, `${event.trackId}/${key}`);
      }
      assert.ok(distribution.points.every(point => event.sameLapComparisons.some(row => row.lap === point.lap)));
    }
  }
  assert.equal(evidence.supportsWetCrossoverCalibration, false);
});

test("only the British sparse interval changes sign, with no invented exact crossover lap", () => {
  const intervals = evidence.events.flatMap(event => event.observedSignChangeIntervals.map(interval => ({ event: event.trackId, ...interval })));
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].event, "silverstone");
  assert.equal(intervals[0].fromLap, 9);
  assert.equal(intervals[0].toLap, 40);
  assert.equal(intervals[0].unobservedLapsBetween, 30);
  assert.equal(intervals[0].exactCrossoverLap, null);
  assert.ok(intervals[0].before.firstMinusSecondSeconds < 0 && intervals[0].after.firstMinusSecondSeconds > 0);
});

test("cache-only tyre changes and weather coverage retain source URLs without making a calibration claim", () => {
  const expectedChanges = { melbourne: 31, silverstone: 23, spa: 20 };
  for (const event of evidence.events) {
    assert.equal(event.collectionStatus, "cache-refreshed-no-network");
    assert.ok(event.timingSourceUrl.startsWith("https://livetiming.formula1.com/static/2025/"));
    assert.equal(event.actualTyreChanges.length, expectedChanges[event.trackId]);
    for (const change of event.actualTyreChanges) {
      assert.equal(change.firstLapOnNewTyre, change.afterLap + 1);
      assert.notEqual(change.fromCompound, change.toCompound);
      assert.ok(["DRY", "INTERMEDIATE", "WET"].includes(change.fromCompound));
      assert.ok([true, false, null].includes(change.rainfall));
    }
    const total = event.retainedCompoundSummary.reduce((sum, row) => sum + row.laps, 0);
    assert.equal(event.weatherJoinCoverage.retainedLaps, total);
    for (const key of ["rainfallKnownLaps", "trackTempKnownLaps", "humidityKnownLaps"]) assert.ok(event.weatherJoinCoverage[key] <= total);
    for (const group of event.retainedCompoundSummary) {
      assert.equal(group.lapTimeDistribution.count, group.laps);
      const values = ["min", "q1", "median", "q3", "max"].map(key => group.lapTimeDistribution[key]);
      assert.deepEqual(values, [...values].sort((a, b) => a - b));
    }
    assert.equal(event.intermediateWetMatchedLaps, 0);
    assert.equal(event.calibrationStatus, "project-estimates-retained");
  }
  assert.ok(evidence.methodology.filter.some(rule => rule.includes("no five-lap stint filter")));
  assert.equal(evidence.collectionMode, "offline-cache-only; no other dataset regenerated");
});

const cache = new Map();
function loadComponent(filename) {
  if (filename.endsWith(".css")) return {};
  if (filename.endsWith(".json")) return JSON.parse(readFileSync(filename, "utf8"));
  if (cache.has(filename)) return cache.get(filename).exports;
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), { fileName: filename, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const loaded = { exports: {} };
  cache.set(filename, loaded);
  const nativeRequire = createRequire(filename);
  const localRequire = specifier => {
    if (!specifier.startsWith(".")) return nativeRequire(specifier);
    const target = resolve(dirname(filename), specifier);
    const dependency = [target, `${target}.ts`, `${target}.tsx`].find(existsSync);
    if (!dependency) throw new Error(`Missing dependency: ${specifier}`);
    return loadComponent(dependency);
  };
  runInThisContext(`(function(exports, require, module) {${compiled}\n})`, { filename })(loaded.exports, localRequire, loaded);
  return loaded.exports;
}
const { default: WetEvidencePanel, wetRainLabel } = loadComponent(fileURLToPath(new URL("../app/WetEvidencePanel.tsx", import.meta.url)));

test("actual rendered panel exposes all five points, sample sizes, source links and uncertainty", () => {
  const html = renderToStaticMarkup(React.createElement(WetEvidencePanel));
  for (const phrase of ["서로 다른 경기는 합치지 않습니다", "4대 / 6대", "2대 / 7대", "중간 30개 랩", "정확한 전환 랩은 미확보", "신뢰구간이 아닙니다", "31건", "23건", "20건", "자료 수집과 모델 보정은 별개"]) assert.ok(html.includes(phrase), phrase);
  assert.equal((html.match(/<circle /g) ?? []).length, 5);
  for (const event of evidence.events) {
    assert.ok(html.includes(`${event.timingSourceUrl}WeatherData.jsonStream`));
    for (const point of event.sameLapComparisons) assert.ok(html.includes(`${point.firstMinusSecondSeconds.toFixed(3)}초`));
  }
  assert.ok(html.includes('role="region" tabindex="0"'));
  assert.ok(html.includes('scope="row"'));
});

test("missing rainfall is visibly distinct from an observed false flag", () => {
  assert.equal(wetRainLabel(null), "강수 자료 미확보");
  assert.equal(wetRainLabel(undefined), "강수 자료 미확보");
  assert.equal(wetRainLabel(false), "강수 미관측");
  assert.equal(wetRainLabel(true), "강수 관측");
});
