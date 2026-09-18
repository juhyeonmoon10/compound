import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRaceGrid } from "../app/lib/race-grid.ts";
import { evaluateStrategy } from "../app/lib/strategy.ts";
import { createVirtualRace, virtualRaceFrameAt, DEFAULT_INCIDENT_SETTINGS } from "../app/lib/virtual-incidents.ts";
const require = createRequire(import.meta.url), ts = require("typescript");
const url = new URL("../app/VirtualIncidentPanel.tsx", import.meta.url);
let compiled = ts.transpileModule(readFileSync(url, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText.replace(/import "\.\/virtual-incidents.css";/, "");
for (const name of ["react", "react/jsx-runtime"]) compiled = compiled.replaceAll(`from "${name}"`, `from ${JSON.stringify(pathToFileURL(require.resolve(name)).href)}`);
for (const name of ["./lib/virtual-incidents", "./lib/replay-telemetry", "./lib/strategy"]) compiled = compiled.replaceAll(`from "${name}"`, `from ${JSON.stringify(new URL(`${name}.ts`, url).href)}`);
const { default: Panel, VirtualIncidentLog: Log } = await import(`data:text/javascript,${encodeURIComponent(compiled)}`);
const strategy = evaluateStrategy({ laps: 8, pitLossSeconds: 20, stints: [
  { compound: "S", startLap: 1, endLap: 4 }, { compound: "H", startLap: 5, endLap: 8 },
] });
const grid = createRaceGrid(Array.from({ length: 20 }, (_, i) => ({ id: `car-${i}`, label: `C${i}`, gridPosition: i + 1, pitGroup: `t${i}`, strategy })));
const race = createVirtualRace(grid, "car-9", { ...DEFAULT_INCIDENT_SETTINGS, enabled: true, playerPercent: 100, othersPercent: 0, response: "RED" });
test("settings expose separate per-race rates, a seed, explicit opt-in and assumed provenance", () => {
  const html = renderToStaticMarkup(createElement(Panel, { settings: DEFAULT_INCIDENT_SETTINGS, onApply() {}, driverLabel: "VER", othersCount: 19 }));
  assert.match(html, /가상 사고 켜기/); assert.match(html, /실측 데이터가 아닌/);
  assert.match(html, /checked=""\/>차량 충돌 처리/);
  assert.match(html, /선택한 선수 · VER/); assert.match(html, /다른 선수 · 19명 각각/);
  assert.match(html, /43\.9/); assert.match(html, /fieldset disabled/);
  for (const flag of ["YELLOW", "VSC", "SC", "RED"]) assert.match(html, new RegExp(`value="${flag}"`));
  assert.match(html, /재현 시드/); assert.match(html, /fia_2026_f1_regulations/);
});
test("virtual log never reveals future accidents and distinguishes DNF from finishes", () => {
  const render = (time, hasStarted = true) => renderToStaticMarkup(createElement(Log, { race, frame: virtualRaceFrameAt(race, time), onSeek() {}, hasStarted }));
  const initial = render(0, false);
  assert.match(initial, /발생한 이벤트 · 0건/); assert.doesNotMatch(initial, /<td>DNF<\/td>/);
  const event = race.incidents[0], during = render(event.startSeconds + 1);
  assert.match(during, /<td>DNF<\/td>/); assert.match(during, /레드 · 레이스 중단/);
  assert.doesNotMatch(during, /사고 통제 종료/);
  const final = render(race.durationSeconds);
  assert.doesNotMatch(final, /C9 · 완주/); assert.match(final, /SC 재출발 구간 종료/);
  assert.equal((final.match(/data-player="true"/g) ?? []).length, 1);
});
test("only the virtual replay owns accident settings, not historical evidence or the optimizer", () => {
  const source = readFileSync(new URL("../app/StrategyLab.tsx", import.meta.url), "utf8");
  assert.match(source, /incidentSettings=\{incidentSettings\}/);
  const replay = readFileSync(new URL("../app/RaceReplay.tsx", import.meta.url), "utf8");
  assert.match(replay, /dynamicsEnabled \? <VirtualIncidentLog/);
  const results = readFileSync(new URL("../app/RaceResults.tsx", import.meta.url), "utf8");
  assert.match(results, /점수는 사고 운을 제외한 기본 전략 평가/);
  assert.match(replay, /virtualPlayerEndSeconds\(virtualRace\)/);
});

test("contact log labels both cars and does not invent a spin recovery or reveal future contacts", () => {
  const contactRace = createVirtualRace(grid, "car-9", DEFAULT_INCIDENT_SETTINGS, { enabled: true, circuitLengthMeters: 5300 });
  const event = contactRace.incidents.find(item => item.kind === "collision");
  assert.ok(event);
  const render = time => renderToStaticMarkup(createElement(Log, { race: contactRace, frame: virtualRaceFrameAt(contactRace, time), onSeek() {} }));
  assert.doesNotMatch(render(0), /차량 접촉 · 감속/);
  const during = render(event.startSeconds);
  assert.ok(during.includes(event.label));
  assert.match(during, /차량 접촉 · 감속/);
  assert.doesNotMatch(render(contactRace.durationSeconds), /스핀 후/);
});
