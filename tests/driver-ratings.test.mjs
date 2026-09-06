import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import original from "../app/data/ea-ratings.json" with { type: "json" };
import { MODEL_PARAMS } from "../app/model/params.ts";
import { TEAM_PROFILES } from "../app/lib/participants.ts";
import {
  DRIVER_RATING_RECORDS,
  DRIVER_RATINGS_METADATA_DISCREPANCIES,
  DRIVER_RATINGS_SOURCE,
  hasValidDriverRatings,
  resolveDriverPerformance,
} from "../app/lib/driver-ratings.ts";

function closeTo(actual, expected) {
  assert.ok(Math.abs(actual - expected) < MODEL_PARAMS.validation.toleranceSeconds, `${actual} differs from ${expected}`);
}

test("all current drivers match exact source points without inventing ratings", () => {
  const participants = TEAM_PROFILES.flatMap((team) => team.drivers);
  assert.equal(DRIVER_RATING_RECORDS.length, original.coverage.sourceDriverCount);
  assert.equal(participants.length, original.coverage.expectedDriverCount);
  for (const driver of participants) {
    const source = original.drivers.find((item) => item.driverId === driver.id);
    const mapped = resolveDriverPerformance(driver.id);
    assert.ok(source, driver.id);
    assert.equal(mapped.available, true, driver.id);
    assert.deepEqual(mapped.ratings, source.ratings);
    assert.ok(Object.isFrozen(mapped.ratings));
    assert.ok(Number.isFinite(mapped.paceSeconds));
    assert.ok(mapped.wearMultiplier > 0);
    assert.ok(mapped.wetPenaltyMultiplier > 0);
  }
});

test("pace and wear mapping use the correct signs and preserve nonzero driver differences", () => {
  const verstappen = resolveDriverPerformance("max-verstappen");
  const hamilton = resolveDriverPerformance("lewis-hamilton");
  const norris = resolveDriverPerformance("lando-norris");
  closeTo(verstappen.paceSeconds, -0.27);
  closeTo(norris.paceSeconds, -0.18);
  closeTo(verstappen.paceSeconds - norris.paceSeconds, -0.09);
  closeTo(verstappen.wearMultiplier, 0.988);
  closeTo(hamilton.wearMultiplier, 0.973);
  assert.ok(hamilton.wearMultiplier < verstappen.wearMultiplier, "higher EXP lowers the assumed wear multiplier");
});

test("wet mapping weights overall and awareness while racecraft preserves raw RAC", () => {
  const verstappen = resolveDriverPerformance("max-verstappen");
  const hamilton = resolveDriverPerformance("lewis-hamilton");
  closeTo(verstappen.wetPenaltyMultiplier, 0.952);
  closeTo(hamilton.wetPenaltyMultiplier, 0.934);
  assert.equal(verstappen.racecraft, original.drivers.find((row) => row.driverId === "max-verstappen").ratings.RAC);
  assert.ok(hamilton.wetPenaltyMultiplier < verstappen.wetPenaltyMultiplier);
});

test("equal performance keeps provenance and source points but bypasses every driver effect", () => {
  for (const source of original.drivers) {
    const value = resolveDriverPerformance(source.driverId, true);
    assert.equal(value.paceSeconds, MODEL_PARAMS.performance.neutralPaceSeconds);
    assert.equal(value.wearMultiplier, MODEL_PARAMS.performance.neutralDeg);
    assert.equal(value.wetPenaltyMultiplier, MODEL_PARAMS.performance.neutralDeg);
    assert.equal(value.racecraft, MODEL_PARAMS.race.racecraftReference);
    assert.equal(value.available, true);
    assert.deepEqual(value.ratings, source.ratings);
    assert.equal(value.source.url, original.source.url);
    assert.deepEqual(value.iteration, original.iteration);
  }
});

test("missing drivers get neutral effects and explicit absent ratings, not another driver's points", () => {
  for (const id of ["unknown-driver", "", "VER", "1", "max-verstappen "]) {
    const missing = resolveDriverPerformance(id);
    assert.equal(missing.available, false);
    assert.equal(missing.ratings, null);
    assert.equal(missing.paceSeconds, MODEL_PARAMS.performance.neutralPaceSeconds);
    assert.equal(missing.wearMultiplier, MODEL_PARAMS.performance.neutralDeg);
    assert.equal(missing.wetPenaltyMultiplier, MODEL_PARAMS.performance.neutralDeg);
    assert.equal(missing.racecraft, MODEL_PARAMS.race.racecraftReference);
  }
});

test("ratings reject absent, fractional, nonfinite and out-of-range source values", () => {
  const valid = original.drivers[0].ratings;
  assert.equal(hasValidDriverRatings(valid), true);
  for (const invalid of [null, {}, { ...valid, OVR: null }, { ...valid, EXP: undefined }, { ...valid, RAC: NaN }, { ...valid, AWA: Infinity }, { ...valid, PAC: MODEL_PARAMS.performance.ratingMax + 1 }, { ...valid, PAC: MODEL_PARAMS.performance.ratingMin - 1 }, { ...valid, OVR: 95.5 }]) {
    assert.equal(hasValidDriverRatings(invalid), false);
  }
});

test("metadata discrepancies never remap ratings by obsolete team or race number", () => {
  assert.deepEqual(DRIVER_RATINGS_METADATA_DISCREPANCIES, original.metadataDiscrepancies);
  const verstappen = DRIVER_RATING_RECORDS.find((item) => item.driverId === "max-verstappen");
  assert.notEqual(verstappen.eaMetadata.carNumber, verstappen.projectMetadata.number);
  const hadjar = DRIVER_RATING_RECORDS.find((item) => item.driverId === "isack-hadjar");
  assert.equal(hadjar.projectMetadata.teamId, "red-bull");
  assert.equal(resolveDriverPerformance(hadjar.driverId).ratings.PAC, hadjar.ratings.PAC);
  assert.equal(DRIVER_RATINGS_SOURCE.checkedAt, original.checkedAt);
  assert.equal(DRIVER_RATINGS_SOURCE.type, "official-game-ratings-not-measured-driver-performance");
});

// Exercise the real TSX and production data, without browser or generated files.
// Only CSS is skipped; local TS/JSON imports remain real dependencies.
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
const { default: PerformanceEvidencePanel } = loadComponent(fileURLToPath(new URL("../app/PerformanceEvidencePanel.tsx", import.meta.url)));

test("rendered evidence preserves every original point and distinguishes official scores from estimated effects", () => {
  const markup = renderToStaticMarkup(React.createElement(PerformanceEvidencePanel, { selectedDriverId: "max-verstappen" }));
  assert.ok(markup.includes(original.source.url));
  assert.ok(markup.includes(original.iteration.label));
  assert.ok(markup.includes(original.checkedAt));
  assert.ok(markup.includes("실제 주행 능력을 측정한 값이 아닙니다"));
  assert.ok(markup.includes("프로젝트 추정"));
  assert.ok(markup.includes("−0.270초/랩"));
  for (const record of original.drivers) {
    const rawCells = Object.values(record.ratings).map((score) => `<td>${score}</td>`).join("");
    assert.ok(markup.includes(rawCells), `original score cells: ${record.driverId}`);
    assert.ok(markup.includes(record.projectMetadata.code));
  }
  assert.ok(markup.includes("원문과 현재 참가자 정보의 차이"));
  assert.equal((markup.match(/tabindex="0" role="region"/g) ?? []).length, 2);
  assert.ok(markup.includes('scope="row"'));
});

test("rendered equal and missing modes explain neutral mapping without presenting invented points", () => {
  const equal = renderToStaticMarkup(React.createElement(PerformanceEvidencePanel, { selectedDriverId: "max-verstappen", equalPerformance: true }));
  assert.ok(equal.includes("동일 성능 모드"));
  assert.ok(equal.includes("0.000초/랩"));
  assert.ok(equal.includes("×1.000"));
  const missing = renderToStaticMarkup(React.createElement(PerformanceEvidencePanel, { selectedDriverId: "missing-id" }));
  assert.ok(missing.includes("자료 없는 드라이버"));
  assert.ok(missing.includes("자료가 없어 모든 성능 보정을 중립값으로 적용합니다"));
  assert.ok(!missing.includes('class="performance-evidence__ratings"'));
});
