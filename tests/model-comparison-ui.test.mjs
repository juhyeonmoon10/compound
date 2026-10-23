import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_GROUP_FORMULA_PARAMETERS } from "../app/lib/group-formula.ts";
import { evaluateStrategy } from "../app/lib/strategy.ts";

const require = createRequire(import.meta.url);
const ts = require("typescript");
async function component(name, componentImports = {}) {
  const url = new URL(`../app/${name}.tsx`, import.meta.url);
  let compiled = ts.transpileModule(readFileSync(url, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText.replace(/^import "[^"]+\.css";\s*$/gm, "");
  for (const dependency of ["react", "react/jsx-runtime"]) {
    compiled = compiled.replaceAll(`from "${dependency}"`, `from ${JSON.stringify(pathToFileURL(require.resolve(dependency)).href)}`);
  }
  for (const dependency of ["group-formula", "strategy", "observed-tyre-model"]) {
    compiled = compiled.replaceAll(`from "./lib/${dependency}"`, `from ${JSON.stringify(new URL(`./lib/${dependency}.ts`, url).href)}`);
  }
  for (const [dependency, dataUrl] of Object.entries(componentImports)) {
    compiled = compiled.replaceAll(`from "./${dependency}"`, `from ${JSON.stringify(dataUrl)}`);
  }
  const dataUrl = `data:text/javascript,${encodeURIComponent(compiled)}`;
  return { dataUrl, Component: (await import(dataUrl)).default };
}

const guide = await component("ModelDifferenceGuide");
const source = await component("ObservedCalibrationPanel");
const { Component: Panel } = await component("GroupFormulaPanel", {
  ModelDifferenceGuide: guide.dataUrl, ObservedCalibrationPanel: source.dataUrl,
});
const input = { track: "bahrain", laps: 8, pitLossSeconds: 22.986, rules: { maxStops: 1 } };
const stints = [{ compound: "S", startLap: 1, endLap: 4 }, { compound: "H", startLap: 5, endLap: 8 }];
const groupInput = { ...input, groupFormula: DEFAULT_GROUP_FORMULA_PARAMETERS };
const observedInput = { ...input, observedTyreModel: "2025-bahrain", raceSeason: 2025 };
const render = (overrides = {}) => renderToStaticMarkup(createElement(Panel, {
  active: false, observedActive: false, observedAvailable: true, observedInput: null,
  parameters: DEFAULT_GROUP_FORMULA_PARAMETERS, legacyInput: input, groupInput, stints,
  onApply: () => {}, onObserved: () => {}, ...overrides,
}));

test("model guide explains six concrete differences and keeps the temperature example labelled", () => {
  const html = renderToStaticMarkup(createElement(guide.Component));
  assert.equal((html.match(/class="model-difference-row"/g) ?? []).length, 6);
  assert.match(html, /같은 DP로 최적 전략/);
  assert.match(html, /설명용 설정/);
  assert.match(html, /랩당 0.4초/);
  assert.match(html, /온도 손실만 23.2초/);
  assert.match(html, /더 짧게 예측한 모델이 더 정확하다는 뜻은 아니/);
  assert.doesNotMatch(html, /<details[^>]* open/);
});

test("two-model comparison is retained and unsupported event calibration is explicitly unavailable", () => {
  const html = render({ observedAvailable: false });
  assert.match(html, /같은 전략으로 두 모델 비교/);
  assert.match(html, /모둠 − 기존/);
  assert.match(html, /disabled=""[^>]*>관측 보정/);
  assert.match(html, /2025 바레인 계수 실험 열기/);
  assert.match(html, /서킷도 바레인으로 전환/);
  assert.match(html, /PDF 모둠 식의 적용값/);
});

test("three-model comparison renders actual same-plan times and separates total cost from age-only loss", () => {
  const html = render({ observedActive: true, observedInput });
  for (const model of [input, groupInput, observedInput]) {
    assert.ok(html.includes(evaluateStrategy({ ...model, stints }).formattedTime));
  }
  assert.match(html, /같은 전략으로 세 모델 비교/);
  assert.match(html, /현재 피트 손실/);
  assert.match(html, /전체 시간 차이에는 신품 속도차와 온도·상태 손실/);
  assert.match(html, /온도·마모·그립은 미모델링/);
  assert.match(html, /연료 효과 \(이 값을 뺌\)/);
  assert.match(html, /관측 − 기존/);
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
});

test("observed evidence renders exact coefficients, fixed PDF examples and the correct validation limitations", () => {
  const html = renderToStaticMarkup(createElement(source.Component, {
    active: true, available: true, pitLossSeconds: 24, onApply: () => {},
  }));
  for (const value of ["0.020146", "0.003565", "0.096782", "0.134825", "0.558", "1.829", "1.200", "2.880",
    "158랩", "340랩", "196랩", "22.986", "22.148", "23.754", "24.000", "694랩", "210랩", "0.413999", "0.546823"]) {
    assert.ok(html.includes(value), value);
  }
  assert.match(html, /학습 표본만의 범위는 아닙니다/);
  assert.match(html, /외삽/);
  assert.match(html, /전체 선택 회귀 모델/);
  assert.match(html, /이 열화식 단독이나 전체 레이스의 예측 오차가 아닙니다/);
  assert.match(html, /FIA가 발표한 공식 타이어 수식이나 실제 경기 전체를 재현한 모델은 아닙니다/);
  assert.match(html, /livetiming.formula1.com/);
  assert.match(html, /2025_04_brn_f1_r0_timing_racelapanalysis_v01.pdf/);
});
