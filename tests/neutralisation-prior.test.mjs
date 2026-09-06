import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInThisContext } from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getNeutralisationPrior, NEUTRALISATION_SUMMARY } from "../app/lib/neutralisation-prior.ts";
import { MODEL_PARAMS } from "../app/model/params.ts";
import { TRACK_PRESET_IDS, evaluateStrategy } from "../app/lib/strategy.ts";
import { runRaceExperiments } from "../app/lib/race-experiments.ts";

const P = MODEL_PARAMS.race;
const raw = JSON.parse(readFileSync(new URL("../app/data/neutralisation-evidence.json", import.meta.url), "utf8"));
const candidate = () => evaluateStrategy({ laps: 30, stints: [
  { compound: "M", startLap: 1, endLap: 15 }, { compound: "H", startLap: 16, endLap: 30 },
] });

test("compact data preserves every current venue's raw counts, intervals and duration samples", () => {
  assert.deepEqual(NEUTRALISATION_SUMMARY.venues.map(row => row.trackId), TRACK_PRESET_IDS);
  assert.equal(NEUTRALISATION_SUMMARY.generatedAt, raw.generatedAt);
  assert.equal(P.minObservedRaces, raw.methodology.qualityRules.minimumRacesForSuggestedAdoption.value);
  assert.equal(P.minDurationEpisodes, raw.methodology.qualityRules.minimumEpisodesForSuggestedDurationAdoption.value);
  for (const row of NEUTRALISATION_SUMMARY.venues) {
    const original = raw.venues.find(venue => venue.trackId === row.trackId);
    assert.equal(row.eligibleRaces, original.eligibleRaces);
    for (const kind of ["sc", "vsc"]) {
      for (const [key, value] of Object.entries(row[kind])) assert.deepEqual(value, original[kind][key], `${row.trackId}/${kind}/${key}`);
    }
  }
  assert.ok(!Object.hasOwn(NEUTRALISATION_SUMMARY, "events"));
});

test("observed zero remains zero while missing Madrid and unknown venues use labelled fallback", () => {
  const spa = getNeutralisationPrior("spa");
  assert.equal(spa.sourceType, "observed");
  assert.equal(spa.vscProbability, 0);
  assert.equal(spa.evidence.vsc.observedProbability, 0);
  assert.equal(spa.evidence.vsc.numerator, 0);
  assert.ok(spa.evidence.vsc.denominator >= P.minObservedRaces);
  assert.ok(spa.evidence.vsc.probabilityCI95[1] > 0, "zero observed events is not proof of a true zero probability");
  for (const id of ["madrid", "unknown-circuit", ""]) {
    const missing = getNeutralisationPrior(id);
    assert.equal(missing.sourceType, "project-estimate");
    assert.equal(missing.scProbability, P.fallbackScProbability);
    assert.equal(missing.vscProbability, P.fallbackVscProbability);
    assert.equal(missing.evidence.sc.observedProbability, null);
    assert.equal(missing.evidence.vsc.observedProbability, null);
    assert.equal(missing.evidence.sc.probabilityCI95, null);
    assert.equal(missing.scDurations, undefined);
  }
});

test("frequency and each duration distribution have independent source gates", () => {
  const jeddah = getNeutralisationPrior("jeddah");
  assert.equal(jeddah.sampleRaces, 4);
  assert.equal(jeddah.sourceType, "project-estimate");
  assert.equal(jeddah.evidence.sc.observedProbability, 1);
  assert.equal(jeddah.scProbability, P.fallbackScProbability);
  assert.equal(jeddah.evidence.sc.durationSource, "observed");
  assert.ok(jeddah.scDurations.length >= P.minDurationEpisodes);
  const monaco = getNeutralisationPrior("monaco");
  assert.equal(monaco.sourceType, "observed");
  assert.equal(monaco.scDurations, undefined);
  assert.equal(monaco.vscDurations, undefined);
  assert.equal(monaco.evidence.sc.durationSource, "project-estimate");
  assert.ok(monaco.evidence.notes.some(note => note.includes("SC 지속 랩") && note.includes("표본 미달")));
});

test("all adopted priors remain sourced, finite and immutable without changing the compact observations", () => {
  const saved = structuredClone(NEUTRALISATION_SUMMARY);
  for (const id of TRACK_PRESET_IDS) {
    const prior = getNeutralisationPrior(id);
    assert.ok(Object.isFrozen(prior));
    for (const probability of [prior.scProbability, prior.vscProbability]) assert.ok(Number.isFinite(probability) && probability >= 0 && probability <= 1);
    if (prior.sourceType === "observed") {
      assert.ok(prior.sourceUrl.startsWith("https://livetiming.formula1.com/static/"));
      assert.ok(prior.sampleRaces >= P.minObservedRaces);
    }
    for (const durations of [prior.scDurations, prior.vscDurations]) {
      if (!durations) continue;
      assert.ok(Object.isFrozen(durations));
      assert.ok(durations.every(value => Number.isInteger(value) && value >= 1));
    }
  }
  assert.deepEqual(NEUTRALISATION_SUMMARY, saved);
});

test("the simulator samples provided duration arrays faithfully, including a full-race period", () => {
  const base = { scProbability: 1, vscProbability: 0, sourceType: "project-estimate", sourceLabel: "controlled duration fixture" };
  const options = { seed: 79, trials: 30, eventPrior: { ...base, scDurations: [7, 7, 7] } };
  const first = runRaceExperiments([candidate()], options);
  assert.deepEqual(first, runRaceExperiments([candidate()], options));
  assert.ok(first.eventTimelines.every(timeline => timeline.events.length === 1 && timeline.events[0].endLap - timeline.events[0].startLap + 1 === 7));
  const full = runRaceExperiments([candidate()], { trials: 1, eventPrior: { ...base, scDurations: [30] } });
  assert.deepEqual(full.eventTimelines[0].events, [{ kind: "SC", startLap: 1, endLap: 30 }]);
  const vsc = runRaceExperiments([candidate()], { trials: 10, eventPrior: { ...base, scProbability: 0, vscProbability: 1, vscDurations: [3, 3, 3] } });
  assert.ok(vsc.eventTimelines.every(timeline => timeline.events[0].kind === "VSC" && timeline.events[0].endLap - timeline.events[0].startLap + 1 === 3));
});

test("malformed, noninteger, empty and longer-than-race duration arrays are rejected", () => {
  const base = { scProbability: 0, vscProbability: 0, sourceType: "project-estimate", sourceLabel: "invalid duration fixture" };
  for (const key of ["scDurations", "vscDurations"]) {
    for (const durations of [[], [0], [31], [1.5], [NaN], [Infinity], null, "3"]) {
      assert.throws(() => runRaceExperiments([candidate()], { eventPrior: { ...base, [key]: durations } }), new RegExp(key));
    }
  }
});

test("legacy fallback keeps its 300-trial seeded event counts", () => {
  const result = runRaceExperiments([candidate()], { seed: 20260906 });
  assert.equal(result.eventSummary.scTrials, 108);
  assert.equal(result.prior.sourceType, "project-estimate");
  assert.equal(result.prior.scDurations, undefined);
});

// Actual TSX render with real production dependencies. No browser or fake data
// source is used; only CSS loading and the module URL syntax are adapted.
const moduleCache = new Map();
function loadComponent(filename) {
  if (filename.endsWith(".css")) return {};
  if (filename.endsWith(".json")) return JSON.parse(readFileSync(filename, "utf8"));
  if (moduleCache.has(filename)) return moduleCache.get(filename).exports;
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), { fileName: filename, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText.replaceAll("import.meta.url", JSON.stringify(pathToFileURL(filename).href));
  const loaded = { exports: {} };
  moduleCache.set(filename, loaded);
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
const { RacePriorEvidence } = loadComponent(fileURLToPath(new URL("../app/RaceExperimentPanel.tsx", import.meta.url)));

test("rendered evidence distinguishes 0/n from unavailable 0/0, CI meaning and per-kind duration fallback", () => {
  const observed = renderToStaticMarkup(React.createElement(RacePriorEvidence, { prior: getNeutralisationPrior("spa") }));
  for (const phrase of ["관측 0/6경기 = 0.0%", "이항 비율 95% 구간", "관측 채택", "표본 미달 · 프로젝트 분포", "미래 경기 예측 신뢰구간과 다릅니다", "경기별 출처·원자료 JSON 내려받기"]) assert.ok(observed.includes(phrase), phrase);
  const missing = renderToStaticMarkup(React.createElement(RacePriorEvidence, { prior: getNeutralisationPrior("madrid") }));
  assert.ok(missing.includes("관측 0/0경기 = 미확보"));
  assert.ok(missing.includes("프로젝트 기본값 적용"));
  assert.ok(missing.includes('role="status"'));
  const source = readFileSync(new URL("../app/RaceExperimentPanel.tsx", import.meta.url), "utf8");
  assert.ok(source.includes('await import("./data/neutralisation-evidence.json")'));
  assert.ok(!/import\s+[^\n]*\sfrom\s+["'][^"']*neutralisation-evidence/.test(source));
});
