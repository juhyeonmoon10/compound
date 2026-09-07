import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MODEL_PARAMS } from "../app/model/params.ts";
import { evaluateStrategy, TRACK_PRESETS } from "../app/lib/strategy.ts";
import { createRaceGrid, raceGridFrameAt } from "../app/lib/race-grid.ts";
import { prepareStrategyReplay, strategyRaceFrameAt } from "../app/lib/strategy-race.ts";

// Exercise the actual renderer's camera mathematics without a DOM/WebGL context.
// The player-heading regression also loads the real GLB; visual rendering,
// shadows and fullscreen still require browser verification.
const require = createRequire(import.meta.url);
const ts = require("typescript");
const sourceUrl = new URL("../app/RaceScene3D.tsx", import.meta.url);
const source = readFileSync(sourceUrl, "utf8");
async function loadRenderer(sourceText) {
  let compiled = ts.transpileModule(`${sourceText}\nexport { renderFrame, createFormulaCar };`, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  for (const name of ["react", "react/jsx-runtime", "three", "three/addons/loaders/GLTFLoader.js"]) {
    compiled = compiled.replaceAll(`from "${name}"`, `from ${JSON.stringify(import.meta.resolve(name))}`);
  }
  for (const name of ["./model/params", "./lib/public-assets", "./lib/circuit-visuals", "./lib/race-scene-dimensions"]) {
    compiled = compiled.replaceAll(`from "${name}"`, `from ${JSON.stringify(new URL(`${name}.ts`, sourceUrl).href)}`);
  }
  return import(`data:text/javascript,${encodeURIComponent(compiled)}`);
}
const { renderFrame, createFormulaCar, PLAYER_FORMULA_CAR_MODEL_ASSET } = await loadRenderer(source);
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
  const { renderFrame: oldRender } = await loadRenderer(source.replace(carryBlock, ""));
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

async function loadPlayerHeadingTemplate() {
  const bytes = readFileSync(new URL("../public/models/meshy-player-car.glb", import.meta.url));
  // This inspected Meshy mesh has its nose/front wing at -X and rear wing at +X.
  // Pin the asset so replacing it requires rechecking those semantic landmarks,
  // rather than silently applying the previous model's forward-axis assumption.
  assert.equal(createHash("sha256").update(bytes).digest("hex"),
    "039e973ebb965d500000664dbbf9f6f013d9597b98c0c39db4e158f62a08fdcc",
    "Player GLB changed: visually re-audit its nose/tail axis and update the heading fixture");
  const { scene } = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  const bounds = new THREE.Box3().setFromObject(scene);
  const center = bounds.getCenter(new THREE.Vector3());
  for (const [name, x] of [["heading-nose", bounds.min.x], ["heading-tail", bounds.max.x]]) {
    const marker = new THREE.Object3D();
    marker.name = name;
    marker.position.set(x, center.y, center.z);
    scene.add(marker);
  }
  return scene;
}

function makePlayerModel(template, forwardAxis = PLAYER_FORMULA_CAR_MODEL_ASSET.defaultForwardAxis) {
  return {
    ...createFormulaCar(template, {
      primary: 0xdc0000, secondary: 0x111111, isPlayer: true, forwardAxis,
      targetLengthMeters: PLAYER_FORMULA_CAR_MODEL_ASSET.targetLengthMeters,
      targetWidthMeters: PLAYER_FORMULA_CAR_MODEL_ASSET.targetWidthMeters,
      compoundBandGeometry: new THREE.TorusGeometry(1, 0.11, 7, 20),
      addWheelCovers: true,
    }),
    id: playerId, isPlayer: true,
  };
}

function playerHeading(car) {
  car.group.updateMatrixWorld(true);
  const nose = car.group.getObjectByName("heading-nose").getWorldPosition(new THREE.Vector3());
  const tail = car.group.getObjectByName("heading-tail").getWorldPosition(new THREE.Vector3());
  return { nose, tail, forward: nose.clone().sub(tail).setY(0).normalize() };
}

function assertPlayerTravelHeading(car, displacement) {
  const { forward } = playerHeading(car);
  assert.ok(displacement.length() > 0.1, "fixture must actually advance along the track");
  assert.ok(forward.dot(displacement.clone().setY(0).normalize()) > 0.99,
    "player GLB nose must face the direction of travel, not the chase camera");
}

test("the actual player GLB faces its travel direction in chase and cockpit, with and without the grid", async (context) => {
  let now = 0;
  context.mock.method(performance, "now", () => now);
  const template = await loadPlayerHeadingTemplate();
  for (const mode of ["chase", "cockpit"]) {
    for (const withGrid of [true, false]) {
      for (const elapsed of [1, 100, 1000, 3000]) {
        const runtime = makeRuntime();
        const car = makePlayerModel(template);
        if (withGrid) runtime.gridCars.set(playerId, car);
        else runtime.primaryCar = car;
        assert.ok(playerHeading(car).forward.dot(new THREE.Vector3(0, 0, 1)) > 0.999,
          "normalized player GLB nose must point along the renderer's local +Z forward axis");
        now += 1000 / 60;
        draw(runtime, elapsed, mode, renderFrame, withGrid);
        const previousPosition = car.group.position.clone();
        now += 1000 / 60;
        draw(runtime, elapsed + 0.05, mode, renderFrame, withGrid);
        assertPlayerTravelHeading(car, car.group.position.clone().sub(previousPosition));
        const { nose, tail, forward } = playerHeading(car);
        const cameraForward = runtime.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
        assert.ok(cameraForward.dot(forward) > 0.99, `${mode} must look toward the car's nose and onward`);
        if (mode === "chase") {
          assert.ok(runtime.camera.position.clone().sub(car.group.position).dot(forward) < -5,
            "chase camera must sit behind the actual mesh's rear wing");
          assert.ok(runtime.camera.position.distanceTo(tail) < runtime.camera.position.distanceTo(nose),
            "the rear of the player mesh must be nearer the chase camera than its nose");
        }
      }
    }
  }
});

test("the previous +X player-axis setting reproduces a car travelling tail-first", async (context) => {
  let now = 0;
  context.mock.method(performance, "now", () => now);
  const runtime = makeRuntime();
  const car = makePlayerModel(await loadPlayerHeadingTemplate(), "+x");
  runtime.gridCars.set(playerId, car);
  draw(runtime, 100, "chase");
  const previousPosition = car.group.position.clone();
  now += 1000 / 60;
  draw(runtime, 100.05, "chase");
  assert.throws(() => assertPlayerTravelHeading(car, car.group.position.clone().sub(previousPosition)),
    /player GLB nose must face the direction of travel/);
});
