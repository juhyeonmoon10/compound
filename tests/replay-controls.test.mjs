import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PLAYBACK_RATES, CAMERA_MODES, replayShortcut, nextReplayCamera, nearbyReplayCars,
  canHideReplayControls, phaseAfterResetCancel, replayLapSeconds, clampReplaySeconds, replayActionLabel } from "../app/lib/replay-controls.ts";
import { createRaceGrid, raceGridFrameAt } from "../app/lib/race-grid.ts";
import { evaluateStrategy } from "../app/lib/strategy.ts";
import { lapStartSeconds } from "../app/lib/race-replay.ts";

const replaySource = readFileSync(
  new URL("../app/RaceReplay.tsx", import.meta.url),
  "utf8",
);

test("replay starts at 1x and retains all four playback rates", () => {
  assert.match(
    replaySource,
    /const \[playbackRate, setPlaybackRate\] = useState\(1\);/,
  );
  assert.deepEqual(PLAYBACK_RATES, [1, 10, 30, 60]);
});

const require = createRequire(import.meta.url);
const ts = require("typescript");
const controlUrl = new URL("../app/RaceReplayControls.tsx", import.meta.url);
let compiled = ts.transpileModule(readFileSync(controlUrl, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
for (const name of ["react", "react/jsx-runtime"]) compiled = compiled.replaceAll(`from "${name}"`, `from ${JSON.stringify(pathToFileURL(require.resolve(name)).href)}`);
for (const name of ["./lib/replay-controls", "./model/params"]) compiled = compiled.replaceAll(`from "${name}"`, `from ${JSON.stringify(new URL(`${name}.ts`, controlUrl).href)}`);
const { default: Controls } = await import(`data:text/javascript,${encodeURIComponent(compiled)}`);

const strategy = evaluateStrategy({ laps: 30, pitLossSeconds: 20, stints: [
  { compound: "M", startLap: 1, endLap: 12 }, { compound: "H", startLap: 13, endLap: 30 },
] });
const grid = createRaceGrid(Array.from({ length: 20 }, (_, i) => ({ id: `car-${i + 1}`, label: `C${i + 1}`,
  gridPosition: i + 1, pitGroup: `team-${Math.floor(i / 2)}`, strategy })), {
  gridSlotOffsetSeconds: .4, maximumTrafficLossSeconds: .8, trafficWindowSeconds: 5,
});
const car = grid.cars[9];
const noop = () => {};
function props(overrides = {}) { return { phase: "ready", ready: true, rate: 1, camera: "chase", reducedMotion: false,
  fullscreen: false, elapsed: 0, lap: 1, car, onPlay: noop, onRate: noop, onCamera: noop, onFullscreen: noop,
  onReset: noop, onLap: noop, onSeek: noop, ...overrides }; }

test("real transport markup retains seek, four rates, camera and lap buttons in every phase", () => {
  for (const phase of ["ready", "countdown", "running", "paused", "finished", "results"]) {
    for (const fullscreen of [false, true]) {
      const html = renderToStaticMarkup(createElement(Controls, props({ phase, fullscreen })));
      assert.equal((html.match(/type="range"/g) ?? []).length, 1);
      assert.match(html, /이전 랩 시작/);
      assert.match(html, /다음 랩 시작/);
      assert.match(html, /aria-label="주행 카메라"/);
      for (const rate of PLAYBACK_RATES) assert.match(html, new RegExp(`aria-pressed="${rate === 1}">` + rate + "×"));
      assert.match(html, /12랩 종료 후 피트로 이동/);
      assert.ok(html.includes(replayActionLabel(phase)));
    }
  }
});

test("loading guard disables start and seek, while rate/camera choice remains available", () => {
  const html = renderToStaticMarkup(createElement(Controls, props({ ready: false })));
  assert.match(html, /class="replay-controls__play"[^>]*disabled=""/);
  assert.match(html, /type="range"[^>]*disabled=""/);
  assert.match(html, /준비 중/);
  assert.match(html, /aria-pressed="true">1×/);
  for (const phase of ["running", "countdown"]) {
    const activeHtml = renderToStaticMarkup(createElement(Controls, props({ ready: false, phase })));
    assert.doesNotMatch(activeHtml, /class="replay-controls__play"[^>]*disabled/);
    assert.match(activeHtml, /일시정지/);
  }
});

test("canceling reset restores running or results, but does not restart canceled countdown timers", () => {
  for (const phase of ["ready", "paused", "results"]) {
    assert.equal(phaseAfterResetCancel(phase, true), phase);
    assert.equal(phaseAfterResetCancel(phase, false), phase);
  }
  assert.equal(phaseAfterResetCancel("running", true), "running");
  assert.equal(phaseAfterResetCancel("running", false), "paused");
  assert.equal(phaseAfterResetCancel("finished", true), "results");
  assert.equal(phaseAfterResetCancel("countdown", true), "paused");
  assert.match(replaySource, /phaseBeforeResetRef.current = phase/);
  assert.match(replaySource, /phaseAfterResetCancel\(phaseBeforeResetRef.current/);
});

test("camera choices cycle without resetting the user's choice on start or reset", () => {
  for (let i = 0; i < CAMERA_MODES.length; i++) {
    assert.equal(nextReplayCamera(CAMERA_MODES[i].id, false), CAMERA_MODES[(i + 1) % CAMERA_MODES.length].id);
    assert.equal(nextReplayCamera(CAMERA_MODES[i].id, true), "map");
  }
  for (const functionName of ["startCountdown", "handleReset"]) {
    const fragment = replaySource.slice(replaySource.indexOf(`const ${functionName} =`)).split("\n  };")[0];
    // startCountdown ends with the useCallback dependency list.
    const body = functionName === "startCountdown" ? fragment.split("\n  }, [")[0] : fragment;
    assert.doesNotMatch(body, /setCameraMode|setPlaybackRate/);
  }
});

test("shortcuts are local, native-control safe, and ignore composition/modifiers/repeats", () => {
  const base = { inReplay: true, interactive: false, code: "Space" };
  assert.equal(replayShortcut(base), "play");
  assert.equal(replayShortcut({ ...base, code: "KeyC" }), "camera");
  assert.equal(replayShortcut({ ...base, code: "KeyF" }), "fullscreen");
  assert.equal(replayShortcut({ ...base, code: "Escape" }), null);
  for (const flag of ["interactive", "repeat", "isComposing", "altKey", "ctrlKey", "metaKey", "shiftKey", "dialogOpen"]) {
    for (const code of ["Space", "KeyC", "KeyF"]) assert.equal(replayShortcut({ ...base, code, [flag]: true }), null);
  }
  assert.equal(replayShortcut({ ...base, inReplay: false }), null);
});

test("controls only hide while running, without focus or reset confirmation", () => {
  for (const phase of ["ready", "countdown", "running", "paused", "finished", "results"]) {
    assert.equal(canHideReplayControls(phase, false, false), phase === "running");
    assert.equal(canHideReplayControls(phase, true, false), false);
    assert.equal(canHideReplayControls(phase, false, true), false);
  }
  const css = readFileSync(new URL("../app/race-replay-workbench.css", import.meta.url), "utf8");
  assert.match(css, /data-controls-visible="false"[^}]+visibility: hidden; pointer-events: none/s);
  assert.match(css, /--replay-controls-height/);
  assert.match(css, /timing-heading button[^}]+pointer-events: auto/s);
  assert.match(css, /race-overlay.is-results[^}]+max-height:[^;]+;[^}]+overflow: auto/s);
  assert.match(css, /@container replay-screen \(max-height: 480px\)/);
});

test("compact timing always includes the player once, including P7 and P20", () => {
  const cars = raceGridFrameAt(grid, 0).cars;
  for (const position of [1, 6, 7, 10, 11, 20]) {
    const player = cars[position - 1];
    const nearby = nearbyReplayCars(cars, player.id);
    assert.equal(nearby.length, 3);
    assert.equal(nearby.filter(item => item.id === player.id).length, 1);
    assert.equal(new Set(nearby.map(item => item.id)).size, 3);
    assert.deepEqual(nearby.map(item => item.position), [...nearby.map(item => item.position)].sort((a, b) => a - b));
  }
  assert.equal(nearbyReplayCars([], "missing").length, 0);
});

test("lap and pit markers use grid/traffic/stack-adjusted time without changing strategy", () => {
  const before = structuredClone(strategy);
  for (const lap of [1, 2, 12, 13, 14, 30, 31]) {
    const seconds = replayLapSeconds(car, lap);
    const frame = raceGridFrameAt(grid, seconds).cars.find(item => item.id === car.id);
    if (lap === 31) assert.equal(frame.completed, true);
    else { assert.equal(frame.lap, lap); assert.equal(frame.isPitting, false); }
  }
  assert.notEqual(replayLapSeconds(car, 14), lapStartSeconds(strategy, 14));
  const pit = car.replay.segments.find(segment => segment.kind === "pit-loss");
  assert.equal(raceGridFrameAt(grid, pit.startSeconds).cars.find(item => item.id === car.id).isPitting, true);
  assert.deepEqual(strategy, before);
  assert.equal(clampReplaySeconds(-20, 100), 0);
  assert.equal(clampReplaySeconds(200, 100), 100);
  assert.equal(clampReplaySeconds(NaN, 100), 0);
});

test("one unified transport is inside the driving fullscreen target; information stays outside", () => {
  const ast = ts.createSourceFile("RaceReplay.tsx", replaySource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const controls = [], viewports = [], drawers = [];
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "RaceReplayControls") controls.push(node);
    if (ts.isJsxElement(node)) {
      const attrs = node.openingElement.attributes.getText(ast);
      if (/ref=\{viewportRef\}/.test(attrs)) viewports.push(node);
      if (/className="replay-drawer"/.test(attrs)) drawers.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(controls.length, 1);
  assert.equal(viewports.length, 1);
  assert.equal(drawers.length, 1);
  assert.ok(controls[0].pos > viewports[0].pos && controls[0].end < viewports[0].end);
  assert.ok(drawers[0].pos >= viewports[0].end);
  assert.doesNotMatch(replaySource, /race-replay__fullscreen-playback|handleFullscreenSpace/);
  const seekBody = replaySource.slice(replaySource.indexOf("const seekTo ="), replaySource.indexOf("const cancelCountdown ="));
  assert.match(seekBody, /clearTimeout\(resultsTimerRef.current\)/);
  assert.match(replaySource, /setPauseReason\(document.hidden/);
  assert.match(replaySource, /role="status">\s*<span aria-hidden="true">Ⅱ<\/span><span>\{pauseReason/s);
});
