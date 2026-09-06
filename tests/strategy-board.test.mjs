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
import { MODEL_PARAMS, TYRE_COLORS, TYRE_LABELS } from "../app/model/params.ts";
import { TRACK_PRESETS } from "../app/lib/strategy.ts";
import { TEAM_PROFILES } from "../app/lib/participants.ts";

// Render the real TSX component without introducing a browser or a build artifact.
// CSS is the only skipped module; geometry and markup use production imports.
const cache = new Map();
function loadComponent(filename) {
  if (filename.endsWith(".css")) return {};
  if (cache.has(filename)) return cache.get(filename).exports;
  const source = readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, { fileName: filename, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const evaluatedModule = { exports: {} };
  cache.set(filename, evaluatedModule);
  const nativeRequire = createRequire(filename);
  const localRequire = (specifier) => {
    if (!specifier.startsWith(".")) return nativeRequire(specifier);
    const target = resolve(dirname(filename), specifier);
    const resolved = [target, `${target}.ts`, `${target}.tsx`].find(existsSync);
    if (!resolved) throw new Error(`Missing component dependency: ${specifier}`);
    return loadComponent(resolved);
  };
  runInThisContext(`(function(exports, require, module) {${compiled}\n})`, { filename })(evaluatedModule.exports, localRequire, evaluatedModule);
  return evaluatedModule.exports;
}

const { default: RaceBriefingOverview, strategyBoardRowGeometry } = loadComponent(fileURLToPath(new URL("../app/RaceBriefingOverview.tsx", import.meta.url)));

function strategy(compounds = ["M", "H"], pits = [24], total = 58, signature = "medium-hard") {
  const ends = [...pits, total];
  return {
    signature, scenarioSignature: "same-model", rank: 1, isLegal: true, violations: [],
    totalSeconds: 5000, formattedTime: "1:23:20.000", stopCount: pits.length, pitAfterLaps: pits,
    stints: compounds.map((compound, index) => ({ compound, startLap: index ? ends[index - 1] + 1 : 1, endLap: ends[index], laps: ends[index] - (index ? ends[index - 1] : 0) })),
  };
}

test("strategy board places pit wheels at window midpoints on the shared race axis", () => {
  const result = strategyBoardRowGeometry(strategy(), [{ startLap: 20, optimalLap: 24, endLap: 30, thresholdSeconds: 1 }], 58, 0);
  const board = MODEL_PARAMS.board;
  assert.equal(result.pits[0].midpointLap, 25);
  assert.equal(result.pits[0].x, board.lineStart + 25 / 58 * (board.lineEnd - board.lineStart));
  assert.notEqual(result.pits[0].x, board.lineStart + 24 / 58 * (board.lineEnd - board.lineStart));
  assert.equal(result.pits[0].labelX, result.pits[0].x - board.pitWheel / 2 - board.windowGap);
  assert.equal(result.finishX, board.finishX);
});

test("all rows share exact prescribed spacing and contiguous line endpoints", () => {
  for (const rowIndex of [0, 1, 2]) {
    const result = strategyBoardRowGeometry(strategy(["S", "M", "H"], [15, 36]), [], 58, rowIndex);
    assert.equal(result.y, MODEL_PARAMS.board.firstRowY + rowIndex * MODEL_PARAMS.board.rowGap);
    assert.equal(result.segments[0].startX, MODEL_PARAMS.board.lineStart);
    assert.equal(result.segments.at(-1).endX, MODEL_PARAMS.board.lineEnd);
    result.segments.slice(1).forEach((segment, index) => assert.equal(segment.startX, result.segments[index].endX));
    assert.ok(result.segments.every((segment) => segment.endX > segment.startX));
  }
});

test("single-window fallback and zero-stop wet plans remain drawable", () => {
  const fallback = strategyBoardRowGeometry(strategy(), [], 58, 0);
  assert.deepEqual([fallback.pits[0].startLap, fallback.pits[0].endLap], [24, 24]);
  const wet = strategyBoardRowGeometry(strategy(["WET"], []), [], 58, 0);
  assert.equal(wet.pits.length, 0);
  assert.equal(wet.segments.length, 1);
  assert.equal(wet.finalCompound, "WET");
  assert.equal(wet.segments[0].color, TYRE_COLORS.WET);
});

test("five compound colors stay semantic and early pit labels remain inside the chart", () => {
  for (const compound of Object.keys(TYRE_COLORS)) {
    const result = strategyBoardRowGeometry(strategy([compound, "H"], [1]), [], 58, 0);
    assert.equal(result.segments[0].color, TYRE_COLORS[compound]);
    assert.equal(result.pits[0].labelAnchor, "start");
    assert.ok(result.pits[0].labelX >= MODEL_PARAMS.board.lineStart);
    assert.ok(result.pits[0].labelX + result.pits[0].estimatedTextWidth < MODEL_PARAMS.board.lineEnd);
  }
  assert.throws(() => strategyBoardRowGeometry(strategy(), [], 0, 0), RangeError);
});

test("rendered board preserves incoming strategy order, five-tyre legend, and accessible selection", () => {
  const results = [strategy(["S", "H"], [15], 58, "first"), strategy(["WET", "INTER", "M"], [18, 35], 58, "second"), strategy(["H", "M"], [40], 58, "third")];
  const team = TEAM_PROFILES[0];
  const markup = renderToStaticMarkup(React.createElement(RaceBriefingOverview, {
    track: TRACK_PRESETS.melbourne, team, driver: team.drivers[0], trackTemperatureC: 34,
    startingGridPosition: 10, trafficLevel: "medium", maxStops: 3, pitLossSeconds: 22.7,
    modelSource: "project", results, pitWindows: [[], [], []], selectedRank: 1, topThreeActive: true,
    workspace: "board", weatherSummary: "비 뒤 마름", ruleExplanation: "우천 타이어 사용 시 건식 두 종류 의무 면제",
    onOpenSetup() {}, onSelectStrategy() {}, onOpenManual() {}, onOpenReplay() {}, onWorkspaceChange() {},
  }));
  const boardEnd = markup.indexOf('class="strategy-board-result"');
  const graphic = markup.slice(0, boardEnd);
  assert.match(graphic, new RegExp(`viewBox="0 0 ${MODEL_PARAMS.board.width} ${MODEL_PARAMS.board.height}"`));
  const rowLabels = [...graphic.matchAll(/class="strategy-board__row-hit"[^>]*aria-label="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(rowLabels.length, 3);
  assert.match(rowLabels[0], /소프트 → 하드/);
  assert.match(rowLabels[1], /웨트 → 인터미디어트 → 미디엄/);
  assert.match(rowLabels[2], /하드 → 미디엄/);
  assert.match(graphic, /class="strategy-board__row-hit" aria-pressed="true" aria-label="전략 2/);
  for (const compound of Object.keys(TYRE_LABELS)) assert.ok(graphic.includes(`data-legend-compound="${compound}"`));
  assert.ok(!graphic.includes("1:23:20.000"), "model race times belong below the graphic");
  assert.ok(!markup.includes("공동 최단"));
  assert.ok(markup.includes("22.7초"));
  assert.ok(markup.includes("우천 타이어 사용 시 건식 두 종류 의무 면제"));
  assert.ok(markup.includes("프로젝트 추정"));
});
