import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync as readRawFileSync, readdirSync } from "node:fs";
// Source contracts must work with both Git CRLF checkouts and LF worktrees.
const readFileSync = (path, options) => {
  const value = readRawFileSync(path, options);
  return typeof value === "string" ? value.replace(/\r\n/g, "\n") : value;
};
import {
  COMPOUNDS,
  TRACK_PRESET_IDS,
  TRACK_PRESETS,
  evaluateStrategy,
  formatRaceTime,
  optimizeTyreStrategies,
} from "../app/lib/strategy.ts";
import {
  DEFAULT_TEAM_ID,
  TEAM_PROFILES,
  findTeamProfile,
} from "../app/lib/participants.ts";
import {
  buildManualStints,
  createDefaultManualPlan,
  manualPlanFromStrategy,
  normalizeManualPlan,
  stintSignature,
} from "../app/lib/manual-strategy.ts";
import {
  CIRCUIT_LAYOUTS,
  circuitLayoutUrl,
} from "../app/lib/circuit-layouts.ts";
import { CIRCUIT_VISUAL_THEMES } from "../app/lib/circuit-visuals.ts";
import {
  buildReplaySegments,
  lapStartSeconds,
  replayFrameAt,
} from "../app/lib/race-replay.ts";
import {
  elapsedAtRaceDistance,
  evaluateStrategyComparison,
  finalStrategyDeltaSeconds,
  prepareStrategyReplay,
  raceDistanceAtFrame,
  strategyRaceFrameAt,
} from "../app/lib/strategy-race.ts";
import {
  RACE_GRID_SIZE,
  createRaceGrid,
  raceGridCar,
  raceGridFrameAt,
} from "../app/lib/race-grid.ts";
import {
  PERFORMANCE_DATA_SOURCES,
  PERFORMANCE_MODEL_VERSION,
  racePerformanceProfile,
} from "../app/lib/performance.ts";
import {
  TYRE_STATE_MODEL_VERSION,
  calculateTyreState,
} from "../app/lib/tyre-state.ts";
import {
  F1_CAR_LENGTH_METERS,
  F1_CAR_WIDTH_METERS,
  FIA_GRID_SLOT_LENGTH_METERS,
  FIA_STANDARD_TRACK_WIDTH_METERS,
  FIA_START_GRID_WIDTH_METERS,
  circuitScaleForPolyline,
  closedPolylineLength,
  gridSlotOffsetMeters,
  startGridVisualOffsetMeters,
  trackHalfWidthMetersAt,
} from "../app/lib/race-scene-dimensions.ts";

function signature(stints) {
  return stints
    .map(
      (stint) =>
        `${stint.compound}:${stint.startLap}-${stint.endLap}`,
    )
    .join(">");
}

function makeRaceGridEntries(strategies) {
  return Array.from({ length: RACE_GRID_SIZE }, (_, index) => ({
    id: `car-${String(index + 1).padStart(2, "0")}`,
    label: `Strategy car ${index + 1}`,
    gridPosition: index + 1,
    pitGroup: `team-${Math.floor(index / 2) + 1}`,
    strategy: strategies[index % strategies.length],
  }));
}

function readWebpContract(fileUrl) {
  const asset = readFileSync(fileUrl);
  assert.ok(asset.length >= 12);
  assert.equal(asset.toString("ascii", 0, 4), "RIFF");
  assert.equal(asset.toString("ascii", 8, 12), "WEBP");
  assert.equal(asset.readUInt32LE(4) + 8, asset.length);

  let hasTransparency = false;
  let hasImageData = false;
  let offset = 12;

  while (offset + 8 <= asset.length) {
    const type = asset.toString("ascii", offset, offset + 4);
    const length = asset.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;

    assert.ok(dataEnd <= asset.length);
    if (type === "ALPH") {
      hasTransparency = true;
    }
    if (type === "VP8X") {
      assert.ok(length >= 10);
      hasTransparency ||= (asset[dataStart] & 0x10) !== 0;
    }
    if (type === "VP8 " || type === "VP8L" || type === "ANMF") {
      hasImageData = true;
    }

    offset = dataEnd + (length % 2);
  }

  assert.equal(offset, asset.length);
  assert.ok(hasImageData);

  return { hasTransparency, bytes: asset.length };
}

function bruteForceEightLaps(trackId, maxStops = 2) {
  const preset = TRACK_PRESETS[trackId];
  const track = {
    ...preset,
    laps: 8,
    compounds: Object.fromEntries(
      COMPOUNDS.map((compound) => [
        compound,
        { ...preset.compounds[compound], maxStintLaps: 8 },
      ]),
    ),
  };
  const candidates = [];

  function add(stints) {
    const result = evaluateStrategy({
      track,
      stints,
      rules: {
        minStops: 1,
        maxStops,
        requireTwoDryCompounds: true,
        minStintLaps: 1,
      },
    });
    if (result.isLegal) {
      candidates.push({
        signature: signature(stints),
        totalSeconds: result.totalSeconds,
      });
    }
  }

  for (const first of COMPOUNDS) {
    for (const second of COMPOUNDS) {
      for (let pit = 1; pit < 8; pit += 1) {
        add([
          { compound: first, startLap: 1, endLap: pit },
          { compound: second, startLap: pit + 1, endLap: 8 },
        ]);
      }
    }
  }

  if (maxStops === 2) {
    for (const first of COMPOUNDS) {
      for (const second of COMPOUNDS) {
        for (const third of COMPOUNDS) {
          for (let pit1 = 1; pit1 < 7; pit1 += 1) {
            for (let pit2 = pit1 + 1; pit2 < 8; pit2 += 1) {
              add([
                { compound: first, startLap: 1, endLap: pit1 },
                {
                  compound: second,
                  startLap: pit1 + 1,
                  endLap: pit2,
                },
                {
                  compound: third,
                  startLap: pit2 + 1,
                  endLap: 8,
                },
              ]);
            }
          }
        }
      }
    }
  }

  return candidates
    .sort(
      (left, right) =>
        left.totalSeconds - right.totalSeconds ||
        left.signature.localeCompare(right.signature),
    )
    .slice(0, 3);
}

test("3D race scene uses one real-world metric scale", () => {
  assert.equal(F1_CAR_WIDTH_METERS, 1.9);
  assert.equal(F1_CAR_LENGTH_METERS, 5.6);
  assert.equal(FIA_STANDARD_TRACK_WIDTH_METERS, 12);
  assert.equal(FIA_START_GRID_WIDTH_METERS, 15);
  assert.equal(FIA_GRID_SLOT_LENGTH_METERS, 8);

  const square = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
  assert.equal(closedPolylineLength(square), 400);
  assert.equal(circuitScaleForPolyline(square, 4), 10);

  const circuitLengthMeters = 5_000;
  assert.equal(trackHalfWidthMetersAt(0, circuitLengthMeters), 7.5);
  assert.equal(
    trackHalfWidthMetersAt(200 / circuitLengthMeters, circuitLengthMeters),
    7.5,
  );
  assert.ok(
    Math.abs(
      trackHalfWidthMetersAt(
        270 / circuitLengthMeters,
        circuitLengthMeters,
      ) - 6.75,
    ) < 1e-9,
  );
  assert.equal(trackHalfWidthMetersAt(0.5, circuitLengthMeters), 6);
  assert.equal(
    trackHalfWidthMetersAt(
      (circuitLengthMeters - 100) / circuitLengthMeters,
      circuitLengthMeters,
    ),
    7.5,
  );

  assert.equal(gridSlotOffsetMeters(1), 0);
  assert.equal(gridSlotOffsetMeters(20), 152);
  for (let position = 2; position <= 20; position += 1) {
    assert.equal(
      gridSlotOffsetMeters(position) -
        gridSlotOffsetMeters(position - 1),
      8,
    );
  }
  assert.equal(
    startGridVisualOffsetMeters(20, 0, circuitLengthMeters),
    156,
  );
  assert.equal(
    startGridVisualOffsetMeters(
      20,
      250 / circuitLengthMeters,
      circuitLengthMeters,
    ),
    0,
  );

  const scene = readFileSync(
    new URL("../app/RaceScene3D.tsx", import.meta.url),
    "utf8",
  );
  const replay = readFileSync(
    new URL("../app/RaceReplay.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(!scene.includes("WORLD_SPAN"));
  assert.ok(scene.includes("normalizeCarWidth(group, options.targetWidthMeters)"));
  assert.ok(scene.includes("gridSlotOffsetMeters(gridPosition)"));
  assert.ok(scene.includes("const OPPONENT_GRID_CAR_OPACITY = 0.3"));
  assert.ok(
    scene.includes(
      "const OPPONENT_GRID_CAR_RIDE_HEIGHT = ROAD_SURFACE_HEIGHT",
    ),
  );
  assert.ok(
    scene.includes(
      "car.isPlayer\n    ? PLAYER_GRID_CAR_RIDE_HEIGHT\n    : OPPONENT_GRID_CAR_RIDE_HEIGHT",
    ),
  );
  assert.ok(scene.includes("5.75 +\n      0.65 * speed01"));
  assert.ok(scene.includes("2.65 +\n      0.25 * speed01"));
  assert.ok(replay.includes("circuitLengthKm={track.circuitLengthKm}"));
});

test("2026 venue catalogue has 24 complete, ordered presets", () => {
  assert.equal(TRACK_PRESET_IDS.length, 24);
  assert.equal(new Set(TRACK_PRESET_IDS).size, 24);
  assert.equal(TRACK_PRESET_IDS[0], "melbourne");
  assert.equal(TRACK_PRESET_IDS.at(-1), "yas-marina");
  assert.deepEqual(Object.keys(TRACK_PRESETS), [...TRACK_PRESET_IDS]);
  assert.deepEqual(
    TRACK_PRESET_IDS.filter(
      (id) => TRACK_PRESETS[id].calendarStatus === "called-off",
    ),
    ["bahrain", "jeddah"],
  );

  for (const id of TRACK_PRESET_IDS) {
    const preset = TRACK_PRESETS[id];
    assert.equal(preset.id, id);
    assert.ok(preset.name.length > 0);
    assert.ok(preset.koreanName.length > 0);
    assert.ok(preset.trait.length > 0);
    assert.match(preset.shortCode, /^[A-Z]{3}$/);
    assert.ok(Number.isInteger(preset.laps) && preset.laps >= 44);
    assert.ok(preset.circuitLengthKm > 3);
    assert.ok(Number.isInteger(preset.turns) && preset.turns >= 10);
    assert.ok(preset.tyreSeverity >= 2 && preset.tyreSeverity <= 5);
    assert.ok(
      preset.baseLapTimeSeconds -
        preset.fuelGainSecondsPerLap * (preset.laps - 1) >
        0,
    );
    assert.ok(preset.pitLossSeconds >= 16 && preset.pitLossSeconds <= 30);

    for (const compound of COMPOUNDS) {
      const model = preset.compounds[compound];
      assert.ok(Number.isFinite(model.offsetSeconds));
      assert.ok(model.alpha >= 0);
      assert.ok(model.beta >= 0);
      assert.ok(
        Number.isInteger(model.maxStintLaps) &&
          model.maxStintLaps >= 1 &&
          model.maxStintLaps <= preset.laps,
      );
    }
  }

  assert.equal(TRACK_PRESETS.madrid.circuitLengthKm, 5.416);
  assert.equal(TRACK_PRESETS.madrid.turns, 22);
  assert.equal(TRACK_PRESETS.spa.laps, 44);
  assert.equal(TRACK_PRESETS.monaco.laps, 78);
});

test("tyre state is deterministic and distinguishes warm-up, heat, and cliff", () => {
  const fresh = ["S", "M", "H"].map((compound) =>
    calculateTyreState({
      compound,
      tyreAge: 0,
      maxStintLaps: 30,
      tyreSeverity: 3,
      trackTemperatureC: 35,
      degradationSeconds: 0,
    }),
  );
  const repeated = calculateTyreState({
    compound: "S",
    tyreAge: 0,
    maxStintLaps: 30,
    tyreSeverity: 3,
    trackTemperatureC: 35,
    degradationSeconds: 0,
  });

  assert.match(TYRE_STATE_MODEL_VERSION, /v1\.0/);
  assert.deepEqual(repeated, fresh[0]);
  assert.ok(
    fresh[0].warmupLossSeconds <
      fresh[1].warmupLossSeconds &&
      fresh[1].warmupLossSeconds <
        fresh[2].warmupLossSeconds,
  );
  assert.ok(
    fresh[0].temperatureC >
      fresh[1].temperatureC &&
      fresh[1].temperatureC > fresh[2].temperatureC,
  );

  const softMidStint = calculateTyreState({
    compound: "S",
    tyreAge: 9,
    maxStintLaps: 22,
    tyreSeverity: 5,
    trackTemperatureC: 50,
    degradationSeconds: 0.8,
  });
  const softAtLimit = calculateTyreState({
    compound: "S",
    tyreAge: 21,
    maxStintLaps: 22,
    tyreSeverity: 5,
    trackTemperatureC: 50,
    degradationSeconds: 3,
  });
  const softBeyondLimit = calculateTyreState({
    compound: "S",
    tyreAge: 24,
    maxStintLaps: 22,
    tyreSeverity: 5,
    trackTemperatureC: 50,
    degradationSeconds: 4,
  });

  assert.equal(softAtLimit.condition, "cliff");
  assert.equal(softAtLimit.thermalState, "hot");
  assert.ok(softAtLimit.temperatureC > softMidStint.temperatureC);
  assert.ok(softAtLimit.wearPercent > softMidStint.wearPercent);
  assert.ok(softAtLimit.gripPercent < softMidStint.gripPercent);
  assert.ok(
    softAtLimit.totalStateLossSeconds >
      softMidStint.totalStateLossSeconds,
  );
  assert.ok(
    softBeyondLimit.cliffLossSeconds >
      softAtLimit.cliffLossSeconds,
  );
});

test("all 24 circuits have distinct, complete visual environments", () => {
  assert.deepEqual(
    Object.keys(CIRCUIT_VISUAL_THEMES),
    [...TRACK_PRESET_IDS],
  );

  for (const id of TRACK_PRESET_IDS) {
    const theme = CIRCUIT_VISUAL_THEMES[id];
    assert.ok(theme);
    assert.ok(theme.grandstandAnchors.length >= 2);
    for (const [progress, side, scale] of theme.grandstandAnchors) {
      assert.ok(progress >= 0 && progress < 1);
      assert.ok(side === -1 || side === 1);
      assert.ok(scale > 0);
    }
    for (const colorKey of [
      "sky",
      "fog",
      "ground",
      "runoff",
      "asphalt",
      "barrier",
      "kerbA",
      "kerbB",
      "accent",
      "grandstand",
      "building",
    ]) {
      assert.ok(
        Number.isInteger(theme[colorKey]) &&
          theme[colorKey] >= 0x000000 &&
          theme[colorKey] <= 0xffffff,
      );
    }
  }

  assert.equal(CIRCUIT_VISUAL_THEMES.monaco.landmark, "marina");
  assert.equal(CIRCUIT_VISUAL_THEMES["las-vegas"].landmark, "sphere");
  assert.equal(CIRCUIT_VISUAL_THEMES["mexico-city"].landmark, "stadium");
  assert.equal(CIRCUIT_VISUAL_THEMES.bahrain.vegetation, "none");
  assert.equal(CIRCUIT_VISUAL_THEMES.suzuka.vegetation, "cherry");
});

test("all 24 venue presets have a safe, attributed local circuit layout", () => {
  assert.deepEqual(Object.keys(CIRCUIT_LAYOUTS), [...TRACK_PRESET_IDS]);
  assert.equal(
    new Set(
      Object.values(CIRCUIT_LAYOUTS).map((layout) => layout.fileName),
    ).size,
    TRACK_PRESET_IDS.length,
  );
  assert.ok(
    existsSync(
      new URL("../public/circuits/LICENSE.txt", import.meta.url),
    ),
  );
  const source = readFileSync(
    new URL("../public/circuits/SOURCE.txt", import.meta.url),
    "utf8",
  );
  assert.match(source, /CC BY 4\.0/);
  assert.match(source, /julesr0y\/f1-circuits-svg/);

  for (const id of TRACK_PRESET_IDS) {
    const asset = CIRCUIT_LAYOUTS[id];
    assert.equal(circuitLayoutUrl(id), `/circuits/${asset.fileName}`);
    assert.match(asset.fileName, /^[a-z0-9-]+\.svg$/);
    const assetUrl = new URL(
      `../public/circuits/${asset.fileName}`,
      import.meta.url,
    );
    assert.ok(existsSync(assetUrl), id);
    const svg = readFileSync(assetUrl, "utf8");
    assert.match(svg, /<svg\b[^>]*\bwidth="500"[^>]*\bheight="500"/);
    const paths = svg.match(/<path\b/gi) ?? [];
    const pathData = svg.match(/<path\b[^>]*\bd="([^"]+)"/i)?.[1];
    assert.equal(paths.length, 1, id);
    assert.ok(pathData && pathData.length > 100, id);
    assert.ok(pathData.trim().toLowerCase().endsWith("z"), id);
    assert.doesNotMatch(svg, /<(?:script|foreignObject|image)\b/i);
  }
});

test("all 24 presets return three unique, legal, sorted strategies", () => {
  for (const track of TRACK_PRESET_IDS) {
    const results = optimizeTyreStrategies({ track, topK: 3 });
    assert.equal(results.length, 3);
    assert.equal(new Set(results.map((item) => item.signature)).size, 3);
    assert.ok(results.every((item) => item.isLegal));
    assert.ok(
      results.every(
        (item, index) =>
          index === 0 ||
          results[index - 1].totalSeconds <= item.totalSeconds,
      ),
    );
  }
});

test("race replay preserves every lap and the exact DP model total", () => {
  const [strategy] = optimizeTyreStrategies({
    track: "silverstone",
    topK: 1,
  });
  const segments = buildReplaySegments(strategy);
  const trackSegments = segments.filter(
    (segment) => segment.kind === "track",
  );
  const pitSegments = segments.filter(
    (segment) => segment.kind === "pit-loss",
  );

  assert.equal(trackSegments.length, strategy.lapCosts.length);
  assert.equal(pitSegments.length, strategy.stopCount);
  assert.equal(segments[0].startSeconds, 0);
  assert.ok(
    Math.abs(
      segments.reduce(
        (total, segment) => total + segment.modelSeconds,
        0,
      ) - strategy.totalSeconds,
    ) < 1e-8,
  );
  assert.ok(
    Math.abs(segments.at(-1).endSeconds - strategy.totalSeconds) <
      1e-8,
  );

  for (const [index, segment] of segments.entries()) {
    assert.ok(segment.modelSeconds > 0);
    assert.ok(segment.endSeconds > segment.startSeconds);
    if (index > 0) {
      assert.ok(
        Math.abs(segment.startSeconds - segments[index - 1].endSeconds) <
          1e-8,
      );
    }
  }

  for (const pitSegment of pitSegments) {
    assert.equal(pitSegment.beforeLap, pitSegment.pitAfterLap + 1);
    assert.ok(strategy.pitAfterLaps.includes(pitSegment.pitAfterLap));
    const pitFrame = replayFrameAt(
      strategy,
      segments,
      (pitSegment.startSeconds + pitSegment.endSeconds) / 2,
    );
    assert.equal(pitFrame.isPitting, true);
    assert.equal(pitFrame.lap, pitSegment.beforeLap);
    assert.equal(pitFrame.compound, pitSegment.toCompound);
    assert.equal(pitFrame.tyreAge, 0);
    assert.equal(pitFrame.trackProgress, 0);
  }

  const firstPit = pitSegments[0];
  const beforePit = replayFrameAt(
    strategy,
    segments,
    firstPit.startSeconds - 1e-6,
  );
  const atPitStart = replayFrameAt(
    strategy,
    segments,
    firstPit.startSeconds,
  );
  const beforePitEnd = replayFrameAt(
    strategy,
    segments,
    firstPit.endSeconds - 1e-6,
  );
  const atPitEnd = replayFrameAt(
    strategy,
    segments,
    firstPit.endSeconds,
  );
  assert.equal(beforePit.isPitting, false);
  assert.equal(beforePit.lap, firstPit.pitAfterLap);
  assert.equal(atPitStart.isPitting, true);
  assert.equal(atPitStart.lap, firstPit.beforeLap);
  assert.equal(atPitStart.compound, firstPit.toCompound);
  assert.equal(beforePitEnd.isPitting, true);
  assert.equal(atPitEnd.isPitting, false);
  assert.equal(atPitEnd.lap, firstPit.beforeLap);
  assert.equal(atPitEnd.compound, firstPit.toCompound);
  assert.equal(atPitEnd.trackProgress, 0);
  assert.equal(
    lapStartSeconds(strategy, firstPit.beforeLap),
    firstPit.startSeconds,
  );

  const start = replayFrameAt(strategy, segments, -100);
  const finish = replayFrameAt(
    strategy,
    segments,
    strategy.totalSeconds + 100,
  );
  assert.equal(start.elapsedSeconds, 0);
  assert.equal(start.lap, 1);
  assert.equal(finish.elapsedSeconds, strategy.totalSeconds);
  assert.equal(finish.completed, true);
  assert.equal(finish.lap, strategy.lapCosts.length);
  assert.equal(finish.trackProgress, 1);
  assert.equal(lapStartSeconds(strategy, 1), 0);
  assert.equal(
    lapStartSeconds(strategy, strategy.lapCosts.length + 1),
    strategy.totalSeconds,
  );
  for (let lap = 2; lap <= strategy.lapCosts.length; lap += 1) {
    assert.equal(
      lapStartSeconds(strategy, lap),
      strategy.lapCosts[lap - 2].cumulativeSeconds,
    );
  }
  assert.throws(
    () => replayFrameAt(strategy, segments, Number.NaN),
    /finite/,
  );
});

test("strategy time trial uses one deterministic clock for both plans", () => {
  const [best, second] = optimizeTyreStrategies({
    track: "silverstone",
    topK: 2,
  });
  const primary = prepareStrategyReplay(second);
  const reference = prepareStrategyReplay(best);
  const start = strategyRaceFrameAt(primary, reference, 0);
  const middle = strategyRaceFrameAt(
    primary,
    reference,
    start.durationSeconds * 0.5,
  );
  const finish = strategyRaceFrameAt(
    primary,
    reference,
    start.durationSeconds + 100,
  );

  assert.equal(start.elapsedSeconds, 0);
  assert.equal(start.primaryDistanceLaps, 0);
  assert.equal(start.referenceDistanceLaps, 0);
  assert.equal(
    start.durationSeconds,
    Math.max(best.totalSeconds, second.totalSeconds),
  );
  assert.equal(middle.elapsedSeconds, start.durationSeconds * 0.5);
  assert.equal(middle.completed, false);
  assert.equal(finish.completed, true);
  assert.equal(finish.primary.completed, true);
  assert.equal(finish.reference.completed, true);
  assert.ok(
    Math.abs(
      finalStrategyDeltaSeconds(second, best) -
        (second.totalSeconds - best.totalSeconds),
    ) < 1e-9,
  );
});

test("strategy time-trial delta compares equal race distance", () => {
  const [best, second] = optimizeTyreStrategies({
    track: "monza",
    topK: 2,
  });
  const primary = prepareStrategyReplay(second);
  const reference = prepareStrategyReplay(best);

  for (const progress of [0, 0.15, 0.5, 0.83, 1]) {
    const distance = second.lapCosts.length * progress;
    const primaryTime = elapsedAtRaceDistance(second, distance);
    const frame = strategyRaceFrameAt(
      primary,
      reference,
      primaryTime,
    );
    const measuredDistance = raceDistanceAtFrame(frame.primary);
    const referenceTime = elapsedAtRaceDistance(
      best,
      measuredDistance,
    );
    assert.ok(
      Math.abs(
        frame.deltaAtDistanceSeconds -
          (frame.primary.elapsedSeconds - referenceTime),
      ) < 1e-8,
    );
  }
});

test("identical strategies overlap throughout the time trial", () => {
  const [best] = optimizeTyreStrategies({
    track: "suzuka",
    topK: 1,
  });
  const replay = prepareStrategyReplay(best);

  for (const ratio of [0, 0.1, 0.33, 0.72, 1]) {
    const frame = strategyRaceFrameAt(
      replay,
      replay,
      best.totalSeconds * ratio,
    );
    assert.deepEqual(frame.primary, frame.reference);
    assert.ok(Math.abs(frame.deltaAtDistanceSeconds) < 1e-9);
  }
});

test("scenario signatures canonically identify the resolved model and rules", () => {
  const [best, second] = optimizeTyreStrategies({
    track: "silverstone",
    topK: 2,
  });
  const reEvaluated = evaluateStrategy({
    track: "silverstone",
    stints: best.stints,
  });
  const changedPitLoss = evaluateStrategy({
    track: "silverstone",
    pitLossSeconds: TRACK_PRESETS.silverstone.pitLossSeconds + 1,
    stints: best.stints,
  });
  const changedTrackTemperature = evaluateStrategy({
    track: "silverstone",
    trackTemperatureC: 45,
    stints: best.stints,
  });

  assert.equal(best.scenarioSignature, second.scenarioSignature);
  assert.equal(best.scenarioSignature, reEvaluated.scenarioSignature);
  assert.notEqual(
    best.scenarioSignature,
    changedPitLoss.scenarioSignature,
  );
  assert.notEqual(
    best.scenarioSignature,
    changedTrackTemperature.scenarioSignature,
  );
  assert.match(best.scenarioSignature, /"modelVersion":"APEX DP v3\.0"/);
});

test("20-car strategy grid rejects illegal and mismatched scenarios", () => {
  const [bahrain] = optimizeTyreStrategies({
    track: "bahrain",
    topK: 1,
  });
  const [miami] = optimizeTyreStrategies({
    track: "miami",
    topK: 1,
  });
  const entries = makeRaceGridEntries([bahrain]);
  const illegal = evaluateStrategy({
    track: "bahrain",
    stints: [
      { compound: "M", startLap: 1, endLap: 28 },
      { compound: "M", startLap: 29, endLap: 57 },
    ],
  });

  assert.equal(bahrain.lapCosts.length, miami.lapCosts.length);
  assert.equal(illegal.isLegal, false);
  assert.throws(
    () => createRaceGrid(entries.slice(0, RACE_GRID_SIZE - 1)),
    /exactly 20/,
  );
  assert.throws(
    () =>
      createRaceGrid(
        entries.map((entry, index) =>
          index === 1 ? { ...entry, gridPosition: 1 } : entry,
        ),
      ),
    /uniquely cover/,
  );
  assert.throws(
    () =>
      createRaceGrid(
        entries.map((entry, index) =>
          index === 0 ? { ...entry, strategy: illegal } : entry,
        ),
      ),
    /must be legal/,
  );
  assert.throws(
    () =>
      createRaceGrid(
        entries.map((entry, index) =>
          index === 0 ? { ...entry, strategy: miami } : entry,
        ),
      ),
    /same resolved scenario/,
  );
});

test("20-car grid timing is deterministic and input-order independent", () => {
  const [strategy] = optimizeTyreStrategies({
    track: "silverstone",
    topK: 1,
  });
  const entries = makeRaceGridEntries([strategy]);
  const grid = createRaceGrid(entries);
  const reversedGrid = createRaceGrid([...entries].reverse());

  assert.equal(grid.cars.length, RACE_GRID_SIZE);
  assert.deepEqual(
    grid.cars.map((car) => car.gridPosition),
    Array.from({ length: RACE_GRID_SIZE }, (_, index) => index + 1),
  );
  assert.deepEqual(
    reversedGrid.cars.map((car) => ({
      id: car.id,
      totalSeconds: car.totalSeconds,
      lapTimings: car.lapTimings,
    })),
    grid.cars.map((car) => ({
      id: car.id,
      totalSeconds: car.totalSeconds,
      lapTimings: car.lapTimings,
    })),
  );

  assert.equal(grid.cars[0].lapTimings[0].gridOffsetSeconds, 0);
  assert.ok(
    Math.abs(
      grid.cars.at(-1).lapTimings[0].gridOffsetSeconds -
        19 * grid.parameters.gridSlotOffsetSeconds,
    ) < 1e-12,
  );
  assert.ok(
    grid.cars.some((car) =>
      car.lapTimings.some((lap) => lap.trafficLossSeconds > 0),
    ),
  );
  assert.ok(
    grid.cars.some((car) =>
      car.lapTimings.some((lap) => lap.pitStackLossSeconds > 0),
    ),
  );

  for (const car of grid.cars) {
    let previousCumulative = 0;
    for (const [index, lap] of car.lapTimings.entries()) {
      assert.equal(
        lap.baseLapTimeSeconds,
        strategy.lapCosts[index].lapTimeSeconds,
      );
      assert.ok(lap.cumulativeSeconds > previousCumulative);
      previousCumulative = lap.cumulativeSeconds;
    }

    const deterministicCorrections = car.lapTimings.reduce(
      (total, lap) =>
        total +
        lap.gridOffsetSeconds +
        lap.trafficLossSeconds +
        lap.pitStackLossSeconds,
      0,
    );
    assert.ok(
      Math.abs(
        car.totalSeconds -
          (strategy.totalSeconds + deterministicCorrections),
      ) < 1e-8,
    );
    assert.ok(
      Math.abs(
        car.lapTimings.at(-1).cumulativeSeconds -
          car.totalSeconds,
      ) < 1e-8,
    );
  }
});

test("2026 performance proxies are bounded, deterministic, and traceable", () => {
  assert.match(PERFORMANCE_MODEL_VERSION, /2026\.07/);
  assert.equal(PERFORMANCE_DATA_SOURCES.checkedAt, "2026-07-30");
  for (const source of [
    PERFORMANCE_DATA_SOURCES.teams,
    PERFORMANCE_DATA_SOURCES.drivers,
    PERFORMANCE_DATA_SOURCES.pitStops,
  ]) {
    assert.match(source, /^https:\/\/www\.formula1\.com\//);
  }

  for (const team of TEAM_PROFILES) {
    for (const driver of team.drivers) {
      const first = racePerformanceProfile(team, driver);
      const second = racePerformanceProfile(team, driver);
      assert.deepEqual(first, second);
      assert.ok(first.teamPoints >= 0);
      assert.ok(first.driverPoints >= 0);
      for (const rating of Object.values(first.ratings)) {
        assert.equal(Number.isInteger(rating), true);
        assert.ok(rating >= 60 && rating <= 100);
      }
    }
  }
});

test("race performance mode is deterministic and leaves equal mode unchanged", () => {
  const [strategy] = optimizeTyreStrategies({
    track: "silverstone",
    topK: 1,
  });
  const strategySnapshot = JSON.stringify(strategy);
  const neutralEntries = makeRaceGridEntries([strategy]);
  const ratedEntries = neutralEntries.map((entry, index) => {
    const rating = index % 2 === 0 ? 60 : 100;
    return {
      ...entry,
      performance: {
        carPace: rating,
        driverPace: rating,
        tyreManagement: rating,
        consistency: rating,
        racecraft: rating,
        pitCrew: rating,
      },
    };
  });

  const equalGrid = createRaceGrid(neutralEntries);
  const equalRatedGrid = createRaceGrid(ratedEntries, {
    performanceMode: "equal",
  });
  assert.deepEqual(equalRatedGrid, equalGrid);

  const realisticGrid = createRaceGrid(ratedEntries, {
    performanceMode: "realistic",
  });
  const realisticReversedGrid = createRaceGrid(
    [...ratedEntries].reverse(),
    { performanceMode: "realistic" },
  );
  assert.deepEqual(realisticReversedGrid, realisticGrid);
  assert.equal(realisticGrid.performanceMode, "realistic");
  assert.ok(
    realisticGrid.cars.some(
      (car, index) =>
        Math.abs(car.totalSeconds - equalGrid.cars[index].totalSeconds) >
        0.01,
    ),
  );

  for (const car of realisticGrid.cars) {
    const consistencyTotal = car.lapTimings.reduce(
      (total, lap) => total + lap.consistencyAdjustmentSeconds,
      0,
    );
    assert.ok(Math.abs(consistencyTotal) < 1e-10);

    for (const [index, lap] of car.lapTimings.entries()) {
      const adjustmentTotal =
        lap.carPaceAdjustmentSeconds +
        lap.driverPaceAdjustmentSeconds +
        lap.tyreManagementAdjustmentSeconds +
        lap.consistencyAdjustmentSeconds +
        lap.racecraftAdjustmentSeconds +
        lap.pitCrewAdjustmentSeconds;
      assert.ok(
        Math.abs(lap.performanceAdjustmentSeconds - adjustmentTotal) <
          1e-10,
      );
      const reconstructedLap =
        lap.baseLapTimeSeconds +
        lap.gridOffsetSeconds +
        lap.trafficLossSeconds +
        lap.pitStackLossSeconds +
        lap.carPaceAdjustmentSeconds +
        lap.driverPaceAdjustmentSeconds +
        lap.tyreManagementAdjustmentSeconds +
        lap.consistencyAdjustmentSeconds +
        lap.pitCrewAdjustmentSeconds;
      assert.ok(
        Math.abs(lap.adjustedLapTimeSeconds - reconstructedLap) < 1e-10,
      );
      if (lap.pitCrewAdjustmentSeconds !== 0) {
        assert.ok(strategy.lapCosts[index].pitLossSeconds > 0);
      }
    }
  }

  assert.equal(JSON.stringify(strategy), strategySnapshot);
  assert.throws(
    () =>
      createRaceGrid(
        ratedEntries.map((entry, index) =>
          index === 0
            ? {
                ...entry,
                performance: {
                  ...entry.performance,
                  consistency: 100.5,
                },
              }
            : entry,
        ),
        { performanceMode: "realistic" },
      ),
    /integer from 0 to 100/,
  );
  assert.throws(
    () =>
      createRaceGrid(ratedEntries, {
        performanceMode: "arcade",
      }),
    /equal or realistic/,
  );
});

test("race-grid frames expose live progress, order, gaps, tyres, and pit state", () => {
  const strategies = optimizeTyreStrategies({
    track: "monza",
    topK: 3,
  });
  const grid = createRaceGrid(makeRaceGridEntries(strategies));
  const start = raceGridFrameAt(grid, 0);
  const middle = raceGridFrameAt(grid, grid.durationSeconds / 2);
  const finish = raceGridFrameAt(grid, grid.durationSeconds + 100);

  assert.deepEqual(
    start.cars.map((car) => car.position),
    Array.from({ length: RACE_GRID_SIZE }, (_, index) => index + 1),
  );
  assert.deepEqual(
    start.cars.map((car) => car.gridPosition),
    Array.from({ length: RACE_GRID_SIZE }, (_, index) => index + 1),
  );
  assert.equal(start.cars[0].gapToLeaderSeconds, 0);

  assert.deepEqual(
    [...new Set(middle.cars.map((car) => car.position))],
    Array.from({ length: RACE_GRID_SIZE }, (_, index) => index + 1),
  );
  assert.ok(
    middle.cars.every(
      (car) =>
        car.progressLaps >= 0 &&
        car.progressLaps <= grid.totalLaps &&
        car.gapToLeaderSeconds >= 0 &&
        ["S", "M", "H"].includes(car.compound),
    ),
  );

  const sampledCar = grid.cars.find((car) =>
    car.lapTimings.some((lap) => lap.pitLossSeconds > 0),
  );
  assert.ok(sampledCar);
  const pitLap = sampledCar.lapTimings.find(
    (lap) => lap.pitLossSeconds > 0,
  );
  assert.ok(pitLap);
  const previousLapSeconds =
    sampledCar.lapTimings[pitLap.lap - 2]?.cumulativeSeconds ?? 0;
  const pitFrame = raceGridFrameAt(
    grid,
    previousLapSeconds + pitLap.pitLossSeconds / 2,
  );
  const sampledPitCar = pitFrame.cars.find(
    (car) => car.id === sampledCar.id,
  );
  assert.ok(sampledPitCar);
  assert.equal(sampledPitCar.isPitting, true);
  assert.equal(sampledPitCar.pitState, "pit");
  assert.equal(sampledPitCar.compound, pitLap.compound);

  assert.equal(finish.completed, true);
  assert.ok(finish.cars.every((car) => car.completed));
  assert.ok(finish.cars.every((car) => car.pitState === "finished"));
  assert.equal(finish.cars[0].gapToLeaderSeconds, 0);
  for (const [index, car] of finish.cars.entries()) {
    assert.equal(car.position, index + 1);
    if (index > 0) {
      assert.ok(
        finish.cars[index - 1].totalSeconds <= car.totalSeconds,
      );
    }
    assert.ok(
      Math.abs(
        car.gapToLeaderSeconds -
          (car.totalSeconds - finish.cars[0].totalSeconds),
      ) < 1e-8,
    );
  }

  assert.equal(
    raceGridCar(grid, sampledCar.id).lapTimings.length,
    grid.totalLaps,
  );
  assert.throws(
    () => raceGridCar(grid, "missing-car"),
    /Unknown race-grid car/,
  );
  assert.throws(
    () => raceGridFrameAt(grid, Number.NaN),
    /finite/,
  );
});

test("strategy comparison rejects illegal, mismatched, and non-optimal references", () => {
  const [bahrainBest] = optimizeTyreStrategies({
    track: "bahrain",
    topK: 1,
  });
  const [miamiBest] = optimizeTyreStrategies({
    track: "miami",
    topK: 1,
  });
  assert.equal(
    bahrainBest.lapCosts.length,
    miamiBest.lapCosts.length,
  );
  assert.throws(
    () =>
      strategyRaceFrameAt(
        prepareStrategyReplay(bahrainBest),
        prepareStrategyReplay(miamiBest),
        0,
      ),
    /same resolved scenario/,
  );
  assert.deepEqual(
    evaluateStrategyComparison(bahrainBest, miamiBest),
    {
      eligible: false,
      reason: "scenario-mismatch",
      deltaSeconds: null,
      deltaPercent: null,
      score: null,
    },
  );

  const illegalPrimary = evaluateStrategy({
    track: "bahrain",
    stints: [
      { compound: "M", startLap: 1, endLap: 28 },
      { compound: "M", startLap: 29, endLap: 57 },
    ],
  });
  assert.equal(illegalPrimary.isLegal, false);
  assert.deepEqual(
    evaluateStrategyComparison(illegalPrimary, bahrainBest),
    {
      eligible: false,
      reason: "primary-illegal",
      deltaSeconds: null,
      deltaPercent: null,
      score: null,
    },
  );
  assert.throws(
    () =>
      strategyRaceFrameAt(
        prepareStrategyReplay(illegalPrimary),
        prepareStrategyReplay(bahrainBest),
        0,
      ),
    /two legal strategies/,
  );

  const [silverstoneBest, silverstoneSecond] =
    optimizeTyreStrategies({
      track: "silverstone",
      topK: 2,
    });
  assert.deepEqual(
    evaluateStrategyComparison(
      silverstoneBest,
      silverstoneSecond,
    ),
    {
      eligible: false,
      reason: "reference-not-optimal",
      deltaSeconds: null,
      deltaPercent: null,
      score: null,
    },
  );
  assert.equal(silverstoneBest.rank, 1);
});

test("strategy comparison returns transparent delta and pit-normalised score", () => {
  const [best, second] = optimizeTyreStrategies({
    track: "monza",
    topK: 2,
  });
  const identical = evaluateStrategyComparison(best, best);
  assert.deepEqual(identical, {
    eligible: true,
    reason: null,
    deltaSeconds: 0,
    deltaPercent: 0,
    score: 100,
  });

  const comparison = evaluateStrategyComparison(second, best);
  assert.equal(comparison.eligible, true);
  if (!comparison.eligible) {
    assert.fail(comparison.reason);
  }
  const expectedDelta = second.totalSeconds - best.totalSeconds;
  const pitLoss =
    best.breakdown.pitLossSeconds / best.stopCount;
  assert.ok(
    Math.abs(comparison.deltaSeconds - expectedDelta) < 1e-9,
  );
  assert.ok(
    Math.abs(
      comparison.deltaPercent -
        (expectedDelta / best.totalSeconds) * 100,
    ) < 1e-12,
  );
  assert.equal(
    comparison.score,
    Math.round(100 * 2 ** (-expectedDelta / pitLoss)),
  );
  assert.ok(comparison.score >= 0 && comparison.score <= 100);
});

test("one-stop mode returns three legal strategies on all 24 presets", () => {
  for (const track of TRACK_PRESET_IDS) {
    const results = optimizeTyreStrategies({
      track,
      topK: 3,
      rules: { minStops: 1, maxStops: 1 },
    });
    assert.equal(results.length, 3, track);
    assert.equal(new Set(results.map((item) => item.signature)).size, 3);
    assert.ok(
      results.every((item) => item.stopCount === 1 && item.isLegal),
      track,
    );
  }
});

test("cost breakdown adds back to the total", () => {
  const [strategy] = optimizeTyreStrategies({ track: "monaco" });
  const breakdownTotal =
    strategy.breakdown.baselineSeconds +
    strategy.breakdown.compoundOffsetSeconds +
    strategy.breakdown.linearDegradationSeconds +
    strategy.breakdown.quadraticDegradationSeconds +
    strategy.breakdown.tyreStateLossSeconds -
    strategy.breakdown.fuelGainSeconds +
    strategy.breakdown.pitLossSeconds;
  assert.ok(Math.abs(breakdownTotal - strategy.totalSeconds) < 1e-8);

  for (const lap of strategy.lapCosts) {
    const lapTotal =
      lap.baselineSeconds +
      lap.compoundOffsetSeconds +
      lap.linearDegradationSeconds +
      lap.quadraticDegradationSeconds +
      lap.tyreState.totalStateLossSeconds -
      lap.fuelGainSeconds +
      lap.pitLossSeconds;
    assert.ok(Math.abs(lapTotal - lap.lapTimeSeconds) < 1e-8);
  }
});

test("duration formatter carries seconds at minute boundaries", () => {
  assert.equal(formatRaceTime(59.9996, 3), "1:00.000");
  assert.equal(formatRaceTime(3_599.9996, 3), "1:00:00.000");
  assert.equal(formatRaceTime(4_979.9996, 3), "1:23:00.000");
});

test("DP top three matches exhaustive search on an eight-lap problem", () => {
  const trackId = "bahrain";
  const preset = TRACK_PRESETS[trackId];
  const track = {
    ...preset,
    laps: 8,
    compounds: Object.fromEntries(
      COMPOUNDS.map((compound) => [
        compound,
        { ...preset.compounds[compound], maxStintLaps: 8 },
      ]),
    ),
  };
  const dp = optimizeTyreStrategies({ track, topK: 3 });
  const brute = bruteForceEightLaps(trackId);

  assert.deepEqual(
    dp.map((item) => ({
      signature: item.signature,
      totalSeconds: item.totalSeconds,
    })),
    brute,
  );
});

test("manual pit selections always become contiguous full-race stints", () => {
  const normalized = normalizeManualPlan(
    {
      stopCount: 2,
      compounds: ["S", "M", "H"],
      pitAfterLaps: [30, 20],
    },
    57,
  );
  const stints = buildManualStints(normalized, 57);

  assert.deepEqual(normalized.pitAfterLaps, [30, 31]);
  assert.deepEqual(stints, [
    { compound: "S", startLap: 1, endLap: 30 },
    { compound: "M", startLap: 31, endLap: 31 },
    { compound: "H", startLap: 32, endLap: 57 },
  ]);
  assert.equal(
    stints.reduce(
      (total, stint) => total + stint.endLap - stint.startLap + 1,
      0,
    ),
    57,
  );
});

test("loading Top 3 first place into manual mode keeps the same score", () => {
  const topThree = optimizeTyreStrategies({
    track: "silverstone",
    topK: 3,
  });
  const plan = manualPlanFromStrategy(topThree[0], 52);
  const manual = evaluateStrategy({
    track: "silverstone",
    stints: buildManualStints(plan, 52),
  });

  assert.equal(stintSignature(manual.stints), topThree[0].signature);
  assert.ok(
    Math.abs(manual.totalSeconds - topThree[0].totalSeconds) < 1e-9,
  );
  assert.deepEqual(manual.breakdown, topThree[0].breakdown);
  assert.equal(topThree.length, 3);
});

test("manual same-compound plan is evaluated but excluded as illegal", () => {
  const defaultPlan = createDefaultManualPlan(53);
  const manual = evaluateStrategy({
    track: "suzuka",
    stints: buildManualStints(
      {
        ...defaultPlan,
        compounds: ["M", "M", "S"],
      },
      53,
    ),
  });

  assert.equal(manual.isLegal, false);
  assert.ok(
    manual.violations.includes(
      "A dry race must use at least two distinct compounds.",
    ),
  );
  assert.ok(Number.isFinite(manual.totalSeconds));
});

test("manual two-stop selection follows a one-stop calculation limit", () => {
  const normalized = normalizeManualPlan(
    {
      stopCount: 2,
      compounds: ["S", "M", "H"],
      pitAfterLaps: [18, 36],
    },
    57,
    1,
  );

  assert.equal(normalized.stopCount, 1);
  assert.equal(buildManualStints(normalized, 57).length, 2);
});

test("Option 3 workspace connects the race briefing to five research views and existing tools", () => {
  const component = readFileSync(
    new URL("../app/StrategyLab.tsx", import.meta.url),
    "utf8",
  );
  const briefing = readFileSync(
    new URL("../app/RaceBriefingOverview.tsx", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL("../app/strategy.css", import.meta.url),
    "utf8",
  );

  const briefingOverview = component.indexOf("<RaceBriefingOverview");
  const setupColumn = component.indexOf('className="setup-column"');
  const raceReplay = component.indexOf("<RaceReplay");
  const manualBuilder = component.indexOf(
    'className={`manual-builder',
  );

  assert.ok(briefingOverview >= 0);
  assert.ok(setupColumn > briefingOverview);
  assert.ok(manualBuilder > setupColumn);
  assert.ok(raceReplay > manualBuilder);

  // Primary navigation is a five-view product contract, independent of
  // presentation dimensions or the exact layout used inside each view.
  assert.ok(component.includes("type PageView ="));
  const expectedViews = [
    ['home', '홈', 'home'],
    ['strategy', '전략 설계', 'simulation'],
    ['data', '데이터 분석', 'data-analysis'],
    ['method', '알고리즘·검증', 'algorithm verification'],
    ['research', '정보·출처', 'research'],
  ];
  for (const [id, label, controls] of expectedViews) {
    assert.ok(component.includes(`| "${id}"`) || component.includes(`=\n  | "${id}"`));
    assert.ok(
      component.includes(
        `{ id: "${id}", label: "${label}", controls: "${controls}" }`,
      ),
    );
  }
  const declaredViews = component.match(
    /\{ id: "(?:home|strategy|data|method|research)", label:/g,
  ) ?? [];
  assert.equal(declaredViews.length, 5);
  assert.ok(component.includes('const [pageView, setPageView]'));
  assert.ok(component.includes('{PAGE_VIEWS.map((view) => ('));
  assert.ok(component.includes('aria-current={pageView === view.id ? "page" : undefined}'));
  assert.ok(component.includes('onClick={() => selectPageView(view.id)}'));
  assert.ok(component.includes('hidden={pageView !== "home"}'));
  assert.ok(component.includes('hidden={pageView !== "strategy"}'));
  assert.ok(component.includes('hidden={pageView !== "data"}'));
  assert.equal(
    component.match(/hidden=\{pageView !== "method"\}/g)?.length,
    2,
  );
  assert.ok(component.includes('hidden={pageView !== "research"}'));
  assert.ok(component.includes('{pageView === "method" && sensitivity && ('));
  assert.ok(!component.includes('{pageView === "verification"'));

  // The Option 3 briefing owns the visible Top 3 board and wires every
  // high-level action back to StrategyLab state or the existing tools.
  assert.ok(
    component.includes(
      'import RaceBriefingOverview from "./RaceBriefingOverview";',
    ),
  );
  for (const prop of [
    "track={appliedTrack}",
    "team={selectedTeam}",
    "driver={selectedDriver}",
    "results={results}",
    "pitWindows={strategyPitWindows}",
    "selectedRank={selectedRank}",
    'topThreeActive={analysisMode === "top3"}',
    "onOpenSetup={openScenarioSetup}",
  ]) {
    assert.ok(component.includes(prop), prop);
  }
  const briefingUsageEnd = component.indexOf("\n          />", briefingOverview);
  assert.ok(briefingUsageEnd > briefingOverview);
  const briefingUsage = component.slice(briefingOverview, briefingUsageEnd);
  assert.ok(briefingUsage.includes("onOpenReplay={() => {"));
  const activateTopThree = briefingUsage.indexOf('setAnalysisMode("top3")');
  const openReplay = briefingUsage.indexOf("openRaceSimulation()", activateTopThree);
  assert.ok(activateTopThree >= 0);
  assert.ok(openReplay > activateTopThree);
  assert.ok(component.includes("setSelectedRank(index)"));

  assert.ok(briefing.includes('className="race-briefing"'));
  assert.ok(briefing.includes('aria-labelledby="briefing-title"'));
  assert.ok(briefing.includes('className="briefing-board"'));
  assert.ok(
    briefing.includes('id="briefing-board-title"'),
  );
  assert.ok(briefing.includes("추천 타이어 전략"));
  assert.ok(briefing.includes("{results.slice(0, 3).map((strategy, index) => ("));
  assert.ok(briefing.includes('className="briefing-board__header"'));
  assert.ok(briefing.includes('className="briefing-board__legend"'));
  assert.ok(briefing.includes('className="briefing-board__facts"'));
  assert.ok(briefing.includes('className="briefing-strip__window"'));
  assert.ok(component.includes("calculatePitWindows("));
  assert.ok(
    briefing.includes(
      "aria-pressed={topThreeActive && selectedRank === index}",
    ),
  );
  assert.ok(briefing.includes("onClick={() => onSelectStrategy(index)}"));
  assert.equal(
    briefing.match(/onClick=\{onOpenSetup\}/g)?.length,
    1,
  );
  assert.ok(briefing.includes("onClick={onOpenManual}"));
  assert.ok(briefing.includes("onClick={onOpenReplay}"));
  assert.ok(briefing.includes('aria-label="결과 출처"'));
  assert.ok(briefing.includes("실제 데이터 보정"));
  assert.ok(briefing.includes("가정 기반 계수"));
  assert.ok(briefing.includes("동적계획법 최적화"));

  // Strategies that round to the same displayed time must be presented as
  // ties, never as a fabricated 0.000-second advantage.
  assert.ok(
    briefing.includes("const DISPLAY_TIE_EPSILON_SECONDS = 0.0005"),
  );
  assert.ok(briefing.includes("function tiesDisplayedTime("));
  assert.ok(
    briefing.includes(
      "Math.abs(strategy.totalSeconds - best.totalSeconds) <",
    ),
  );
  assert.ok(briefing.includes("DISPLAY_TIE_EPSILON_SECONDS"));
  assert.ok(briefing.includes("공동 최단 총시간으로 계산되었습니다"));
  assert.ok(briefing.includes("selectedTiesBest && hasBestTie"));
  assert.ok(briefing.includes('`공동 최단 후보 · ${selected.rank}`'));
  assert.ok(!briefing.includes("0.000초 빠릅니다"));
  const tieReason = briefing.indexOf(
    "if (runnerUp && tiesDisplayedTime(runnerUp, best))",
  );
  const fasterReason = briefing.indexOf("다음 후보보다 ${gap} 빠릅니다");
  assert.ok(tieReason >= 0);
  assert.ok(fasterReason > tieReason);

  // The chart follows the compact race-broadcast pattern with real tyre art,
  // fixed compound colours, pit-window labels, and a circuit fact footer.
  assert.ok(!briefing.includes('import Image from "next/image"'));
  assert.ok(!briefing.includes("tyreCompoundIcon"));
  assert.ok(briefing.includes('publicAsset("/ui/tyre-compound-icon.png")'));
  assert.ok(briefing.includes("설정값"));
  assert.ok(briefing.includes("피트 손실"));
  assert.ok(briefing.includes("pitLossSeconds.toFixed(1)"));
  assert.ok(briefing.includes("circuitLayoutUrl(track.id)"));
  assert.ok(
    briefing.includes(
      'className={`briefing-compound is-${compound.toLowerCase()}`}',
    ),
  );
  for (const compoundClass of ["is-h", "is-m", "is-s"]) {
    assert.match(styles, new RegExp(`\\.briefing-strip__stint\\.${compoundClass}`));
  }

  // Scenario configuration and URL state remain available beneath the new
  // overview and through both setup entry points.
  assert.ok(component.includes("const openScenarioSetup = () =>"));
  assert.ok(component.includes("setDraft({ ...applied })"));
  assert.ok(component.includes("setRaceSetupOpen(true)"));
  assert.ok(component.includes("raceSetupOpen &&"));
  assert.ok(component.includes('role="dialog"'));
  assert.ok(component.includes('aria-modal="true"'));
  assert.ok(component.includes("const setupPanelRef = useRef<HTMLElement>(null)"));
  assert.ok(
    component.includes(
      "const setupTriggerRef = useRef<HTMLElement | null>(null)",
    ),
  );
  assert.ok(component.includes("setupTriggerRef.current = document.activeElement"));
  assert.ok(component.includes("panel.querySelectorAll<HTMLElement>(focusableSelector)"));
  assert.ok(component.includes('event.key !== "Tab"'));
  assert.ok(component.includes("last.focus()"));
  assert.ok(component.includes("first.focus()"));
  assert.ok(component.includes("setupTriggerRef.current?.focus()"));
  assert.ok(component.includes('className="race-setup-modal__backdrop"'));
  assert.ok(component.includes("tabIndex={-1}"));
  assert.ok(
    component.includes(
      'className="race-setup-modal__panel"',
    ),
  );
  assert.ok(component.includes("runCalculation"));
  assert.ok(component.includes("handleQuickTrackChange"));
  assert.ok(
    component.includes(
      "applyConfiguration(configForTrack(applied, trackId))",
    ),
  );
  assert.ok(
    component.includes(
      'url.searchParams.set("circuit", nextConfig.trackId)',
    ),
  );
  assert.ok(component.includes("value={applied.trackId}"));

  // Detailed charts remain the only tablist; manual comparison and the
  // existing race replay stay reachable without becoming new page tabs.
  const tablists = component.match(/role="tablist"/g) ?? [];
  assert.equal(tablists.length, 1);
  assert.ok(component.includes('<div role="tablist" aria-label="세부 차트">'));
  assert.ok(component.includes('id={`detail-tab-${tab.id}`}'));
  assert.ok(component.includes('aria-controls={`detail-panel-${tab.id}`}'));
  assert.ok(component.includes('id="detail-panel-chart"'));
  assert.ok(component.includes('id="detail-panel-cost"'));
  assert.ok(component.includes("handleResultDetailTabKeyDown"));
  assert.ok(component.includes('id="manual-strategy"'));
  assert.ok(component.includes("commitManualStrategyForReplay"));
  assert.ok(component.includes("gridStrategies={results}"));
  assert.ok(component.includes("optimalStrategy={best}"));
  assert.ok(component.includes("onOpenSetup={openScenarioSetup}"));
  assert.ok(component.includes("onEditStrategy={() =>"));
  assert.ok(component.includes("openRaceSimulation"));

  const researchStart = component.indexOf('id="research"');
  const researchEnd = component.indexOf("</main>", researchStart);
  assert.ok(researchStart >= 0);
  assert.ok(researchEnd > researchStart);
  const researchSection = component.slice(researchStart, researchEnd);
  for (const participantMarkup of [
    "participant-showcase",
    "driver-card",
    "team-car-card",
    "<TeamCarVisual",
    "selectedDriver.headshotUrl",
    "team.carImage",
  ]) {
    assert.ok(!researchSection.includes(participantMarkup));
  }

  // CSS assertions describe capabilities and responsive states rather than
  // freezing a particular pixel grid, header height, or card size.
  for (const selector of [
    ".home-page",
    ".race-briefing",
    ".race-briefing__stage",
    ".race-briefing__conditions",
    ".briefing-board",
    ".briefing-board__header",
    ".briefing-board__legend",
    ".briefing-board__facts",
    ".briefing-strip__window",
    ".briefing-tyre",
    ".briefing-row.is-selected",
    ".briefing-recommendation__actions",
  ]) {
    assert.ok(styles.includes(selector), selector);
  }
  assert.match(styles, /@media \(max-width:\s*900px\)/);
  assert.match(styles, /@media \(max-width:\s*660px\)/);
  const supportingGridStart = styles.lastIndexOf(".simulator .lab-grid {");
  const supportingGridEnd = styles.indexOf("}", supportingGridStart);
  assert.ok(supportingGridStart >= 0);
  assert.ok(supportingGridEnd > supportingGridStart);
  const supportingGridStyles = styles.slice(
    supportingGridStart,
    supportingGridEnd,
  );
  assert.match(supportingGridStyles, /display:\s*block/);
  assert.match(supportingGridStyles, /grid-template-columns:\s*none/);
  assert.ok(styles.includes(".topnav button:focus-visible"));
  assert.ok(
    styles.includes(".race-setup-modal__grid-input input:focus-visible"),
  );
  assert.ok(
    styles.includes(
      ".race-setup-modal__conditions fieldset input:focus-visible + span",
    ),
  );
  const groupedFocusStart = styles.indexOf(
    ".race-briefing__driver > button:focus-visible,",
  );
  const groupedFocusEnd = styles.indexOf("{", groupedFocusStart);
  assert.ok(groupedFocusStart >= 0);
  assert.ok(groupedFocusEnd > groupedFocusStart);
  const groupedFocusSelectors = styles.slice(
    groupedFocusStart,
    groupedFocusEnd,
  );
  for (const selector of [
    ".race-briefing__driver > button:focus-visible",
    ".race-briefing__conditions > button:focus-visible",
    ".briefing-row:focus-visible",
    ".briefing-recommendation__actions button:focus-visible",
    ".race-setup-modal__panel > header > button:focus-visible",
    ".race-setup-modal select:focus-visible",
    '.race-setup-modal input[type="range"]:focus-visible',
    ".race-setup-modal__advanced summary:focus-visible",
    ".race-setup-modal__panel > footer button:focus-visible",
  ]) {
    assert.ok(groupedFocusSelectors.includes(selector), selector);
  }
  const mobileModalStart = styles.indexOf("@media (max-width: 760px)");
  const mobileModalEnd = styles.indexOf(
    "@media (prefers-reduced-motion: reduce)",
    mobileModalStart,
  );
  assert.ok(mobileModalStart >= 0);
  assert.ok(mobileModalEnd > mobileModalStart);
  const mobileModalStyles = styles.slice(mobileModalStart, mobileModalEnd);
  assert.match(
    mobileModalStyles,
    /\.race-setup-modal__conditions fieldset\s*\{[\s\S]*?flex-wrap:\s*wrap/,
  );
  assert.match(
    styles,
    /\.briefing-row\.is-selected\s*\{[\s\S]*?var\(--team-primary\)/,
  );
  assert.match(styles, /\.briefing-strip__stint\.is-s,[\s\S]*?--compound-color:\s*#e32636/);
  assert.match(styles, /\.briefing-strip__stint\.is-m,[\s\S]*?--compound-color:\s*#f2cd19/);
  assert.match(styles, /\.briefing-strip__stint\.is-h,[\s\S]*?--compound-color:\s*#e7ebed/);
  assert.match(styles, /\.briefing-strip__line\s*\{[\s\S]*?height:\s*4px/);
  assert.match(styles, /\.briefing-strip__window\s*\{[\s\S]*?font-style:\s*italic/);

  assert.ok(component.includes("const teamTheme = {"));
  assert.ok(
    component.includes('"--apex": selectedTeam.primary'),
  );
  assert.ok(
    component.includes('"--apex-dark": selectedTeam.secondary'),
  );
  assert.ok(
    component.includes('"--team-on-primary": selectedTeam.onPrimary'),
  );
  assert.ok(component.includes("data-team={selectedTeam.id}"));
  assert.ok(component.includes("style={teamTheme}"));
  assert.ok(component.includes("calculationRevision"));
  assert.match(
    styles,
    /\.participant-theme\s*\{[\s\S]*?--team-primary:\s*var\(--apex\);[\s\S]*?--team-secondary:\s*var\(--apex-dark\);[\s\S]*?--team-on-primary:\s*var\(--participant-on-accent\);/,
  );
  assert.ok(component.includes('const COMPOUND_COLORS = TYRE_COLORS'));
});

test("2026 official-grid profiles contain eleven teams and twenty-two unique drivers", () => {
  const drivers = TEAM_PROFILES.flatMap((team) => team.drivers);

  assert.equal(TEAM_PROFILES.length, 11);
  assert.ok(TEAM_PROFILES.every((team) => team.drivers.length === 2));
  assert.equal(new Set(TEAM_PROFILES.map((team) => team.id)).size, 11);
  assert.equal(drivers.length, 22);
  assert.equal(new Set(drivers.map((driver) => driver.id)).size, 22);
  assert.equal(new Set(drivers.map((driver) => driver.number)).size, 22);
});

test("team profiles use transparent official 2026 WebP car renders", () => {
  const hex = /^#[0-9A-F]{6}$/;

  for (const team of TEAM_PROFILES) {
    assert.match(team.primary, hex);
    assert.match(team.secondary, hex);
    assert.match(team.onPrimary, hex);
    assert.ok(team.code.length >= 2);
    assert.ok(
      team.drivers.every((driver) =>
        driver.headshotUrl.startsWith("https://media.formula1.com/"),
      ),
    );
    assert.ok(team.carImage.src.startsWith("/cars/"));
    assert.ok(team.carImage.src.endsWith(".webp"));
    assert.ok(team.carImage.alt.includes(team.carModel));
    assert.ok(team.carImage.alt.includes("2026"));
    const assetUrl = new URL(
      `../public${team.carImage.src}`,
      import.meta.url,
    );
    assert.ok(existsSync(assetUrl));
    const image = readWebpContract(assetUrl);
    assert.ok(image.hasTransparency);
    assert.ok(image.bytes >= 5_000);
    assert.ok(
      team.carImage.sourceUrl.startsWith(
        "https://media.formula1.com/",
      ),
    );
    assert.ok(team.carImage.sourceUrl.includes("/2026/"));
    assert.ok(team.carImage.sourceUrl.endsWith(".webp"));
  }

  assert.equal(findTeamProfile(DEFAULT_TEAM_ID).id, DEFAULT_TEAM_ID);
  assert.equal(
    new Set(TEAM_PROFILES.map((team) => team.carImage.src)).size,
    TEAM_PROFILES.length,
  );
  assert.deepEqual(
    readdirSync(new URL("../public/cars/", import.meta.url))
      .filter((name) => /\.webp$/i.test(name))
      .sort(),
    TEAM_PROFILES.map((team) => team.carImage.src.split("/").at(-1)).sort(),
  );
});

test("transparent car stage contains the full render and hides fallback text", () => {
  const component = readFileSync(
    new URL("../app/StrategyLab.tsx", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL("../app/strategy.css", import.meta.url),
    "utf8",
  );
  const imageRule = styles.match(
    /\.team-car-photo img\s*\{([\s\S]*?)\}/,
  )?.[1];

  assert.ok(imageRule);
  assert.match(imageRule, /object-fit:\s*contain/);
  assert.match(imageRule, /object-position:\s*center bottom/);
  assert.ok(component.includes("<span hidden aria-hidden=\"true\">"));
  assert.ok(component.includes("F1 공식 이미지 출처"));
  assert.ok(component.includes("fallback.hidden = false"));
});
