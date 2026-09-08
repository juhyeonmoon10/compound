import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TEAM_PROFILES } from "../app/lib/participants.ts";
import { TYRE_COLORS, TYRE_LABELS } from "../app/model/params.ts";
import { evaluateStrategy } from "../app/lib/strategy.ts";
import { createRaceGrid, raceGridFrameAt } from "../app/lib/race-grid.ts";
import { telemetryDriverName } from "../app/lib/replay-telemetry.ts";

// Render the actual TSX with React's server renderer. This is not browser DOM,
// CSS layout, Fullscreen API, keyboard interaction, or GPU verification.
const require = createRequire(import.meta.url);
const ts = require("typescript");
const sourceUrl = new URL("../app/ReplayTelemetry.tsx", import.meta.url);
let compiled = ts.transpileModule(readFileSync(sourceUrl, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
for (const moduleName of ["react", "react/jsx-runtime"]) {
  compiled = compiled.replaceAll(`from "${moduleName}"`, `from ${JSON.stringify(pathToFileURL(require.resolve(moduleName)).href)}`);
}
for (const moduleName of ["./lib/replay-telemetry", "./model/params"]) {
  compiled = compiled.replaceAll(`from "${moduleName}"`, `from ${JSON.stringify(new URL(`${moduleName}.ts`, sourceUrl).href)}`);
}
compiled = compiled.replace('import "./replay-telemetry.css";', "");
const { default: ReplayTelemetry } = await import(`data:text/javascript,${encodeURIComponent(compiled)}`);

const playerId = "max-verstappen";
function makeGrid() {
  const compounds = Object.keys(TYRE_COLORS);
  const entries = TEAM_PROFILES.flatMap((team) => team.drivers.map((driver) => ({ team, driver })))
    .slice(0, 20).map(({ team, driver }, index) => ({
      id: driver.id, label: driver.code, gridPosition: index + 1, pitGroup: team.id,
      strategy: evaluateStrategy({ laps: 30, pitLossSeconds: 20, weather: { preset: "heavy" }, stints: [
        { compound: compounds[index % compounds.length], startLap: 1, endLap: 12 },
        { compound: compounds[index % compounds.length] === "H" ? "M" : "H", startLap: 13, endLap: 30 },
      ] }),
    }));
  return createRaceGrid(entries);
}
function render(grid, time = 0, props = {}) {
  return renderToStaticMarkup(createElement(ReplayTelemetry, {
    grid, frame: raceGridFrameAt(grid, time), playerId, ...props,
  }));
}

test("all 22 current drivers have Korean telemetry names without code-only fallbacks", () => {
  const drivers = TEAM_PROFILES.flatMap((team) => team.drivers);
  assert.equal(drivers.length, 22);
  for (const driver of drivers) {
    assert.match(telemetryDriverName(driver.id, driver.code), /^[가-힣 ]+$/);
  }
});

test("actual markup shows 20 waiting cars, Korean units and fixed five-compound colours", () => {
  const html = render(makeGrid(), 0, { hasStarted: false });
  const body = html.match(/<tbody>(.*?)<\/tbody>/s)[1];
  assert.equal((body.match(/<tr(?:\s|>)/g) ?? []).length, 20);
  assert.equal((body.match(/출발 대기/g) ?? []).length, 20);
  assert.match(html, /선두 격차/);
  assert.match(html, /앞차 격차/);
  assert.match(html, /\+\d+\.\d{3}초/);
  assert.doesNotMatch(html, />PIT<|>FINISH<|>START<|>RACE DATA/);
  assert.doesNotMatch(html, /레이스 출발/);
  for (const [compound, color] of Object.entries(TYRE_COLORS)) {
    assert.ok(html.includes(`--telemetry-tyre:${color}`));
    assert.ok(html.includes(`aria-label="${TYRE_LABELS[compound]}"`));
  }
  assert.match(html, /role="tablist" aria-label="레이스 데이터 보기"/);
  assert.equal((html.match(/role="tab"/g) ?? []).length, 3);
  assert.equal((html.match(/role="tabpanel"/g) ?? []).length, 3);
  assert.equal((html.match(/class="replay-telemetry-pit-marker"/g) ?? []).length, 20);
  assert.match(html, /class="replay-telemetry-pit-marker" style="left:40%" role="img" aria-label="12랩 종료 후 피트 전환"/);
  assert.doesNotMatch(html, /class="replay-telemetry-neutral-band/);
});

test("pit and finish states are rendered in Korean from the live grid frame", () => {
  const grid = makeGrid();
  const player = grid.cars.find((car) => car.id === playerId);
  const pit = player.replay.segments.find((segment) => segment.kind === "pit-loss");
  const atPit = render(grid, (pit.startSeconds + pit.endSeconds) / 2, { hasStarted: true });
  const playerRow = atPit.match(/<tr class="is-player">(.*?)<\/tr>/s)[1];
  assert.match(playerRow, /막스 베르스타펜/);
  assert.match(playerRow, /class="replay-telemetry-pit">피트/);
  assert.match(playerRow, />0랩</);
  const finished = render(grid, grid.durationSeconds, { hasStarted: true });
  assert.match(finished, /레이스 종료/);
  const body = finished.match(/<tbody>(.*?)<\/tbody>/s)[1];
  assert.equal((body.match(/>완주</g) ?? []).length, 20);
  assert.match(finished, /체커기 · 주행 완료/);
});

test("my car has one timing-row marker and explicit bold styling in timing and stints", () => {
  const html = render(makeGrid());
  const body = html.match(/<tbody>(.*?)<\/tbody>/s)[1];
  assert.equal((body.match(/class="is-player"/g) ?? []).length, 1);
  assert.equal((body.match(/class="replay-telemetry-player-tag">내 차/g) ?? []).length, 1);
  assert.match(html, /class="replay-telemetry-gantt-row is-player"/);
  const css = readFileSync(new URL("../app/replay-telemetry.css", import.meta.url), "utf8");
  assert.match(css, /\.replay-telemetry-table tr\.is-player th[^}]*font-weight: 700/);
  assert.match(css, /\.replay-telemetry-gantt-row\.is-player \.replay-telemetry-gantt-name[^}]*font-weight: 700/);
  assert.match(css, /\.replay-telemetry-tyre\s*\{[^}]*color: var\(--telemetry-tyre\)/);
});

test("SC/VSC data is shown only when supplied, unchanged and explicitly separate from replay time", () => {
  const grid = makeGrid();
  const timeline = { trial: 7, id: "trial:7:provided-only", events: [
    { kind: "SC", startLap: 9, endLap: 12 }, { kind: "VSC", startLap: 19, endLap: 20 },
  ] };
  const before = structuredClone(timeline);
  const without = render(grid, 100, { hasStarted: true });
  assert.doesNotMatch(without, /class="replay-telemetry-neutralisation"/);
  const html = render(grid, 100, { hasStarted: true, experimentTimeline: timeline });
  assert.match(html, /trial:7:provided-only/);
  assert.match(html, /확률 실험 8번/);
  assert.match(html, /안전 차량\(SC\)/);
  assert.match(html, /가상 안전 차량\(VSC\)/);
  assert.match(html, /9–12랩/);
  assert.match(html, /19–20랩/);
  assert.match(html, /주행 순위·시계에는 이 SC\/VSC 할인이나 감속이 적용되지 않습니다/);
  assert.match(html, /확률 실험 조건 · 재생 시계 미반영/);
  assert.equal((html.match(/class="replay-telemetry-neutral-band is-sc"/g) ?? []).length, 20);
  assert.equal((html.match(/class="replay-telemetry-neutral-band is-vsc"/g) ?? []).length, 20);
  assert.ok(html.includes(`class="replay-telemetry-neutral-band is-sc" style="left:${8 / 30 * 100}%;width:${4 / 30 * 100}%"`));
  assert.ok(html.includes(`class="replay-telemetry-neutral-band is-vsc" style="left:${18 / 30 * 100}%;width:${2 / 30 * 100}%"`));
  assert.deepEqual(timeline, before);
  assert.equal((html.match(/class="replay-telemetry-neutralisation"/g) ?? []).length, 1);
  const empty = render(grid, 100, { experimentTimeline: { ...timeline, events: [] } });
  assert.match(empty, /이 시행에는 SC\/VSC 구간이 없습니다/);
});

test("ReplayTelemetry remains outside the fullscreen viewport in the information drawer", () => {
  const source = readFileSync(new URL("../app/RaceReplay.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("RaceReplay.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const telemetry = [], viewports = [];
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "ReplayTelemetry") telemetry.push(node);
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some((attribute) =>
      ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === "ref"
      && ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression?.getText(ast) === "viewportRef")) viewports.push(node);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(telemetry.length, 1);
  assert.equal(viewports.length, 1);
  assert.equal(telemetry[0].parent.openingElement.tagName.getText(ast), "div");
  assert.match(telemetry[0].parent.openingElement.getText(ast), /hidden=\{panel !== "data"\}/);
  assert.ok(telemetry[0].getStart(ast) > viewports[0].end);
  const props = new Map(telemetry[0].attributes.properties.map((attribute) => [attribute.name.getText(ast), attribute.initializer?.getText(ast)]));
  assert.equal(props.get("grid"), "{raceGridData.grid}");
  assert.equal(props.get("frame"), "{gridFrame}");
  assert.equal(props.get("playerId"), "{driver.id}");
  assert.equal(props.get("hasStarted"), '{phase !== "ready" && phase !== "countdown"}');
  assert.equal(props.get("experimentTimeline"), "{experimentTimeline}");
  assert.equal(props.get("onSeek"), "{seekAndPause}");
  assert.match(source, /const target = viewportRef\.current as FullscreenTarget/);
  assert.match(source, /readonly experimentTimeline\?: RaceExperimentTimeline \| null/);
});
