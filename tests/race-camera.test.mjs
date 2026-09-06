import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as THREE from "three";
import { MODEL_PARAMS } from "../app/model/params.ts";
import { evaluateStrategy, TRACK_PRESETS } from "../app/lib/strategy.ts";
import { createRaceGrid, raceGridFrameAt } from "../app/lib/race-grid.ts";
import { prepareStrategyReplay, strategyRaceFrameAt } from "../app/lib/strategy-race.ts";

// Exercise the actual renderer's camera mathematics without a DOM/WebGL context.
// This checks tracking, not the appearance of GLB meshes, shadows or fullscreen.
const require = createRequire(import.meta.url);
const ts = require("typescript");
const sourceUrl = new URL("../app/RaceScene3D.tsx", import.meta.url);
const source = readFileSync(sourceUrl, "utf8");
async function loadRenderFrame(sourceText) {
  let compiled = ts.transpileModule(`${sourceText}\nexport { renderFrame };`, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  for (const name of ["react", "react/jsx-runtime", "three", "three/addons/loaders/GLTFLoader.js"]) {
    compiled = compiled.replaceAll(`from "${name}"`, `from ${JSON.stringify(import.meta.resolve(name))}`);
  }
  for (const name of ["./model/params", "./lib/public-assets", "./lib/circuit-visuals", "./lib/race-scene-dimensions"]) {
    compiled = compiled.replaceAll(`from "${name}"`, `from ${JSON.stringify(new URL(`${name}.ts`, sourceUrl).href)}`);
  }
  return (await import(`data:text/javascript,${encodeURIComponent(compiled)}`)).renderFrame;
}
const renderFrame = await loadRenderFrame(source);
const playerId = "charles-leclerc";
const circuitLengthMeters = TRACK_PRESETS.montreal.circuitLengthKm * 1000;
const strategy = evaluateStrategy({
  track: "montreal", rules: { maxStops: 3 },
  laps: 70, pitLossSeconds: 20, weather: { preset: "heavy" },
  stints: [
    { compound: "M", startLap: 1, endLap: 14 },
    { compound: "INTER", startLap: 15, endLap: 25 },
    { compound: "WET", startLap: 26, endLap: 50 },
    { compound: "INTER", startLap: 51, endLap: 70 },
  ],
});
const replay = prepareStrategyReplay(strategy);
const entries = Array.from({ length: 20 }, (_, index) => ({
  id: index === 9 ? playerId : `rival-${index}`,
  label: index === 9 ? "LEC" : `R${index}`,
  gridPosition: index + 1, pitGroup: `team-${Math.floor(index / 2)}`, strategy,
}));
const grid = createRaceGrid(entries);
const telemetry = { water: 1, raining: true, speedKph: 250, speed01: 0.5,
  signedTurn: 0, braking: 0, overtakePulse: 0, reducedMotion: true };

function makeCar(id, isPlayer = false) {
  return { id, isPlayer, group: new THREE.Group(), compoundBands: [], wheelTravelDistance: 0 };
}
function makeRuntime() {
  const sprayGeometry = new THREE.BufferGeometry();
  sprayGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MODEL_PARAMS.wetVisual.sprayCount * 3), 3));
  return {
    camera: new THREE.PerspectiveCamera(57, 16 / 9, 0.1, 700),
    cameraLookAt: new THREE.Vector3(), cameraAnchorPosition: new THREE.Vector3(), cameraUp: new THREE.Vector3(0, 1, 0),
    worldPoints: Array.from({ length: 720 }, (_, index) => {
      const angle = index / 720 * Math.PI * 2;
      return new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle)).multiplyScalar(circuitLengthMeters / (2 * Math.PI));
    }),
    primaryCar: makeCar("primary"), referenceCar: makeCar("reference"),
    gridCars: new Map(entries.map((entry) => [entry.id, makeCar(entry.id, entry.id === playerId)])),
    playerGridCarId: playerId, roadHalfWidth: 6, circuitLengthMeters,
    sun: new THREE.DirectionalLight(), sunTarget: new THREE.Object3D(), sunOffset: new THREE.Vector3(-70, 115, 45),
    wetRoadMaterial: new THREE.MeshStandardMaterial(), wetSpray: new THREE.Points(sprayGeometry, new THREE.PointsMaterial()),
    scene: new THREE.Scene(), renderer: { render() {} },
    hasRendered: false, lastCameraMode: null, lastRenderMs: null, smoothedSpeedKph: 0,
    lastFocusPosition: null, overtakePulse: 0, lastModelElapsedSeconds: null,
  };
}
function draw(runtime, elapsed, mode, render = renderFrame, withGrid = true) {
  const frame = strategyRaceFrameAt(replay, replay, elapsed);
  const gridFrame = withGrid ? raceGridFrameAt(grid, elapsed) : undefined;
  render(runtime, frame, mode, gridFrame, telemetry);
  return gridFrame;
}

test("chase and cockpit stay with the selected car at every playback speed and frame rate", (context) => {
  let now = 0;
  context.mock.method(performance, "now", () => now);
  for (const mode of ["chase", "cockpit"]) {
    for (const fps of [30, 60, 120]) {
      for (const speed of [1, 10, 30, 60]) {
        const runtime = makeRuntime();
        let elapsed = 100;
        for (let step = 0; step < 100; step++) {
          now += 1000 / fps;
          elapsed += speed / fps;
          draw(runtime, elapsed, mode);
          const ownPosition = runtime.gridCars.get(playerId).group.position;
          const distance = runtime.camera.position.distanceTo(ownPosition);
          assert.ok(distance < (mode === "chase" ? 7 : 2.1), `${mode} ${speed}x ${fps}fps distance=${distance}`);
          assert.ok(runtime.cameraAnchorPosition.clone().setY(ownPosition.y).distanceTo(ownPosition) < 1e-9);
          assert.ok(runtime.camera.fov >= 55 && runtime.camera.fov <= 70);
          if (mode === "chase") {
            runtime.camera.updateMatrixWorld();
            const projected = ownPosition.clone().add(new THREE.Vector3(0, 0.6, 0)).project(runtime.camera);
            assert.ok(Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1 && projected.z < 1,
              `selected car outside chase view at ${speed}x ${fps}fps`);
          }
        }
        assert.equal(runtime.wetSpray.visible, true);
        assert.equal(runtime.wetRoadMaterial.roughness, MODEL_PARAMS.wetVisual.roughnessWet);
      }
    }
  }
});

test("the previous world-space damping reproduces the high-speed lag, and the fix removes it", async (context) => {
  let now = 0;
  context.mock.method(performance, "now", () => now);
  const carryBlock = /  if \(!modeChanged && cameraMode !== "broadcast"\) \{[\s\S]*?\n  \}\n  runtime\.cameraAnchorPosition\.copy\(primaryPose\.position\);/;
  assert.match(source, carryBlock);
  const oldRender = await loadRenderFrame(source.replace(carryBlock, ""));
  const oldRuntime = makeRuntime(), fixedRuntime = makeRuntime();
  for (let step = 0; step < 100; step++) {
    now += 1000 / 60;
    draw(oldRuntime, 100 + step, "chase", oldRender);
    draw(fixedRuntime, 100 + step, "chase");
  }
  const oldDistance = oldRuntime.camera.position.distanceTo(oldRuntime.gridCars.get(playerId).group.position);
  const fixedDistance = fixedRuntime.camera.position.distanceTo(fixedRuntime.gridCars.get(playerId).group.position);
  assert.ok(oldDistance > 20, `fixture must reproduce pre-fix delay; distance=${oldDistance}`);
  assert.ok(fixedDistance < 7, `relative tracking distance=${fixedDistance}`);
  assert.ok(oldDistance > fixedDistance * 3);
});

test("seeking, pits, fallback replay and camera switches do not leave the tracking rig behind", (context) => {
  let now = 0;
  context.mock.method(performance, "now", () => now);
  const runtime = makeRuntime();
  const pit = grid.cars.find((car) => car.id === playerId).replay.segments.find((segment) => segment.kind === "pit-loss");
  for (const [elapsed, mode, withGrid] of [
    [100, "chase", true], [2000, "chase", true], [10, "chase", true],
    [(pit.startSeconds + pit.endSeconds) / 2, "chase", true],
    [300, "cockpit", true], [301, "broadcast", true], [302, "chase", true],
    [310, "chase", false], [100, "cockpit", false],
  ]) {
    now += 1000 / 60;
    draw(runtime, elapsed, mode, renderFrame, withGrid);
    if (mode !== "broadcast") {
      const position = withGrid ? runtime.gridCars.get(playerId).group.position : runtime.primaryCar.group.position;
      assert.ok(runtime.camera.position.distanceTo(position) < 7.2);
    }
  }
});

test("broadcast camera remains trackside rather than being carried along with the car", (context) => {
  let now = 0;
  context.mock.method(performance, "now", () => now);
  const runtime = makeRuntime();
  draw(runtime, 100, "broadcast");
  const cameraBefore = runtime.camera.position.clone();
  const carBefore = runtime.gridCars.get(playerId).group.position.clone();
  now += 1000 / 60;
  draw(runtime, 100.05, "broadcast");
  assert.ok(runtime.gridCars.get(playerId).group.position.distanceTo(carBefore) > 0.1);
  assert.ok(runtime.camera.position.distanceTo(cameraBefore) < 1e-9);
});
