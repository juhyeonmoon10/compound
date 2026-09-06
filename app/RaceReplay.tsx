"use client";
import { TYRE_LABELS } from "./model/params";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import RaceScene3D, {
  type RaceSceneCamera,
  type RaceSceneGridVisual,
  type RaceSceneHandle,
  type RaceScenePoint,
  type RaceSceneTelemetry,
} from "./RaceScene3D";
import { resolveEntryPerformance } from "./lib/entry-performance";
import { buildSharedRaceGrid, sharedRaceParticipants } from "./lib/shared-race-grid";
import { RACE_CAR_ASSET } from "./lib/visual-assets";
import type {
  DriverProfile,
  TeamId,
  TeamProfile,
} from "./lib/participants";
import {
  PERFORMANCE_DATA_SOURCES,
  PERFORMANCE_MODEL_VERSION,
  racePerformanceProfile,
  type RacePerformanceMode,
} from "./lib/performance";
import {
  CIRCUIT_LAYOUT_SOURCE,
  circuitLayoutUrl,
} from "./lib/circuit-layouts";
import {
  createRaceGrid,
  raceGridCar,
  raceGridFrameAt,
  type RaceGrid,
  type RaceGridCarFrame,
  type RaceGridEntry,
  type RaceGridFrame,
} from "./lib/race-grid";
import { lapStartSeconds } from "./lib/race-replay";
import {
  evaluateStrategyComparison,
  finalStrategyDeltaSeconds,
  prepareStrategyReplay,
  strategyRaceFrameAt,
  type StrategyRaceFrame,
} from "./lib/strategy-race";
import {
  formatRaceTime,
  type Compound,
  type StrategyEvaluation,
  type StrategyResult,
  type TrackPreset,
  type TrackPresetId,
} from "./lib/strategy";
import type { TyreCondition } from "./lib/tyre-state";

type CameraMode = "map" | RaceSceneCamera;
type ReplayPhase =
  | "ready"
  | "countdown"
  | "running"
  | "paused"
  | "finished"
  | "results";
type WebGLStatus = "loading" | "ready" | "failed";

type FullscreenDocument = Document & {
  readonly webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type FullscreenTarget = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

interface LoadedCircuitPath {
  readonly pathD: string;
  readonly viewBox: string;
  readonly width: number;
  readonly height: number;
}

interface TrackPoint {
  readonly x: number;
  readonly y: number;
}

interface TrackPose extends TrackPoint {
  readonly angleDegrees: number;
}

function activeFullscreenElement(): Element | null {
  const fullscreenDocument = document as FullscreenDocument;
  return (
    document.fullscreenElement ??
    fullscreenDocument.webkitFullscreenElement ??
    null
  );
}

interface RaceReplayProps {
  readonly trackId: TrackPresetId;
  readonly track: TrackPreset;
  readonly strategy: StrategyEvaluation;
  readonly strategyLabel: string;
  readonly referenceStrategy: StrategyEvaluation;
  readonly referenceLabel: string;
  readonly team: TeamProfile;
  readonly driver: DriverProfile;
  readonly gridStrategies: readonly StrategyEvaluation[];
  readonly optimalStrategy: StrategyResult;
  readonly startingGridPosition: number;
  readonly trafficLevel: RaceTrafficLevel;
  readonly entryContext?: { readonly teamId: TeamId; readonly driverId: string; readonly equalPerformance: boolean };
  readonly onOpenSetup?: () => void;
  readonly onEditStrategy?: () => void;
  readonly onOpenAnalysis?: () => void;
}

const COMPOUND_NAMES = TYRE_LABELS;

const TYRE_CONDITION_LABELS: Readonly<Record<TyreCondition, string>> = {
  warming: "예열",
  optimal: "적정",
  worn: "마모",
  graining: "그레이닝",
  overheated: "과열",
  cliff: "성능 급락",
};

const TYRE_CONDITION_LABELS_KO: Readonly<Record<TyreCondition, string>> = {
  warming: "워밍업",
  optimal: "최적",
  worn: "마모 진행",
  graining: "그레이닝",
  overheated: "과열",
  cliff: "성능 절벽",
};

const PLAYBACK_RATES = [1, 10, 30, 60] as const;
const CAMERA_MODES: ReadonlyArray<{
  readonly id: CameraMode;
  readonly label: string;
  readonly description: string;
}> = [
  { id: "map", label: "지도", description: "서킷 전체 지도" },
  { id: "chase", label: "추적", description: "차량 뒤 3인칭 모델 시점" },
  {
    id: "cockpit",
    label: "운전석",
    description: "운전석 1인칭 모델 시점",
  },
  {
    id: "broadcast",
    label: "중계",
    description: "서킷 옆 중계 카메라",
  },
];

const PATH_SAMPLE_COUNT = 720;
const PERSPECTIVE_SECTION_COUNT = 46;
const PERSPECTIVE_LOOK_AHEAD = 0.065;

export type RaceTrafficLevel = "low" | "medium" | "high";

const TRAFFIC_PARAMETERS: Readonly<
  Record<
    RaceTrafficLevel,
    {
      readonly trafficWindowSeconds: number;
      readonly maximumTrafficLossSeconds: number;
    }
  >
> = {
  low: {
    trafficWindowSeconds: 1,
    maximumTrafficLossSeconds: 0.08,
  },
  medium: {
    trafficWindowSeconds: 1.5,
    maximumTrafficLossSeconds: 0.18,
  },
  high: {
    trafficWindowSeconds: 2.2,
    maximumTrafficLossSeconds: 0.3,
  },
};

function makeRaceGrid(
  selectedTeam: TeamProfile,
  selectedDriver: DriverProfile,
  playerStrategy: StrategyEvaluation,
  strategies: readonly StrategyEvaluation[],
  startingGridPosition: number,
  trafficLevel: RaceTrafficLevel,
  performanceMode: RacePerformanceMode,
  entryContext?: RaceReplayProps["entryContext"],
): {
  readonly grid: RaceGrid;
  readonly visuals: readonly RaceSceneGridVisual[];
} {
  if (entryContext && (entryContext.teamId !== selectedTeam.id || entryContext.driverId !== selectedDriver.id)) {
    throw new RangeError("Replay entry context must match the primary DP team and driver.");
  }
  const shared = entryContext ? buildSharedRaceGrid({ ...entryContext, playerStrategy,
    strategyPool: strategies, startingGridPosition }) : null;
  const participants = shared?.participants ?? sharedRaceParticipants(selectedTeam.id, selectedDriver.id);
  const opponentStrategies =
    strategies.length > 0 ? strategies : [playerStrategy];
  const playerGridPosition = Math.min(
    20,
    Math.max(1, Math.round(startingGridPosition)),
  );
  const gridSlots = [
    playerGridPosition,
    ...Array.from({ length: 20 }, (_, index) => index + 1).filter(
      (position) => position !== playerGridPosition,
    ),
  ];
  const entries: readonly RaceGridEntry[] = shared?.entries ?? participants.map(
    (participant, index) => ({
      id: participant.driver.id,
      label: participant.driver.code,
      gridPosition: gridSlots[index],
      pitGroup: participant.team.id,
      performance: racePerformanceProfile(
        participant.team,
        participant.driver,
      ).ratings,
      strategy:
        index === 0
          ? playerStrategy
          : opponentStrategies[
              (index * 7 + gridSlots[index]) %
                opponentStrategies.length
            ],
    }),
  );
  const visuals: RaceSceneGridVisual[] = participants.map(
    (participant) => ({
      id: participant.driver.id,
      color: participant.team.primary,
      secondaryColor: participant.team.secondary,
      number: participant.driver.number,
      isPlayer: participant.driver.id === selectedDriver.id,
    }),
  );

  return {
    grid: createRaceGrid(entries, {
      ...TRAFFIC_PARAMETERS[trafficLevel],
      performanceMode: entryContext ? "equal" : performanceMode,
    }),
    visuals,
  };
}

function formatRaceGap(car: RaceGridCarFrame): string {
  if (car.position === 1) return "선두";
  if (car.completed) return "완주";
  if (car.isPitting) return "피트";
  return `+${car.gapToLeaderSeconds.toFixed(1)}`;
}

function compactStrategy(strategy: StrategyEvaluation): string {
  return strategy.stints.map((stint) => stint.compound).join(" → ");
}

function compoundClass(compound: Compound): string {
  return `compound compound--${compound.toLowerCase()}`;
}

function normalizeProgress(progress: number): number {
  return ((progress % 1) + 1) % 1;
}

function pointAtSamples(
  samples: readonly TrackPoint[],
  progress: number,
): TrackPoint {
  if (samples.length === 0) return { x: 0, y: 0 };
  const normalized = normalizeProgress(progress);
  const scaled = normalized * samples.length;
  const index = Math.floor(scaled) % samples.length;
  const nextIndex = (index + 1) % samples.length;
  const mix = scaled - Math.floor(scaled);
  const current = samples[index];
  const next = samples[nextIndex];
  return {
    x: current.x + (next.x - current.x) * mix,
    y: current.y + (next.y - current.y) * mix,
  };
}

function poseAtSamples(
  samples: readonly TrackPoint[],
  progress: number,
): TrackPose {
  const point = pointAtSamples(samples, progress);
  const epsilon = 1 / Math.max(PATH_SAMPLE_COUNT, samples.length);
  const before = pointAtSamples(samples, progress - epsilon);
  const after = pointAtSamples(samples, progress + epsilon);
  return {
    ...point,
    angleDegrees:
      (Math.atan2(after.y - before.y, after.x - before.x) * 180) /
      Math.PI,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function signedTurnAtSamples(
  samples: readonly TrackPoint[],
  progress: number,
  span = 4,
): number {
  if (samples.length < 8) return 0;
  const epsilon = span / samples.length;
  const before = pointAtSamples(samples, progress - epsilon);
  const current = pointAtSamples(samples, progress);
  const after = pointAtSamples(samples, progress + epsilon);
  const headingBefore = Math.atan2(
    current.y - before.y,
    current.x - before.x,
  );
  const headingAfter = Math.atan2(
    after.y - current.y,
    after.x - current.x,
  );
  return Math.atan2(
    Math.sin(headingAfter - headingBefore),
    Math.cos(headingAfter - headingBefore),
  );
}

function visualTelemetryAt(
  samples: readonly TrackPoint[],
  frame: RaceGridCarFrame,
  circuitLengthKm: number,
  lapTimeSeconds: number,
  reducedMotion: boolean,
  overtakePulse = 0,
): RaceSceneTelemetry {
  if (
    samples.length < 8 ||
    frame.completed ||
    frame.elapsedSeconds <= 0
  ) {
    return {
      speedKph: 0,
      speed01: 0,
      signedTurn: 0,
      braking: 0,
      overtakePulse: 0,
      reducedMotion,
    };
  }

  const currentTurn = signedTurnAtSamples(
    samples,
    frame.lapProgress,
    3,
  );
  const aheadTurn = signedTurnAtSamples(
    samples,
    frame.lapProgress + 7 / samples.length,
    4,
  );
  const severity = clamp(
    Math.max(
      Math.abs(currentTurn),
      Math.abs(aheadTurn) * 0.9,
    ) / 0.48,
    0,
    1,
  );
  const easedSeverity =
    severity * severity * (3 - 2 * severity);
  const averageSpeedKph =
    (circuitLengthKm * 3600) /
    Math.max(1, lapTimeSeconds);
  const paceFactor = clamp(
    averageSpeedKph / 230,
    0.94,
    1.06,
  );
  const onTrackSpeedKph = Math.round(
    clamp(
      (330 - 150 * easedSeverity) * paceFactor,
      180,
      330,
    ),
  );
  const speedKph = frame.isPitting ? 80 : onTrackSpeedKph;

  return {
    speedKph,
    speed01: clamp((speedKph - 180) / 150, 0, 1),
    signedTurn: currentTurn,
    braking: frame.isPitting
      ? 1
      : clamp(
          (Math.abs(aheadTurn) -
            Math.abs(currentTurn) -
            0.015) /
            0.22,
          0,
          1,
        ),
    overtakePulse: reducedMotion ? 0 : clamp(overtakePulse, 0, 1),
    reducedMotion,
  };
}

function gearForSpeed(speedKph: number): number {
  if (speedKph <= 0) return 0;
  if (speedKph < 120) return 2;
  if (speedKph < 180) return 3;
  if (speedKph < 205) return 4;
  if (speedKph < 230) return 5;
  if (speedKph < 260) return 6;
  if (speedKph < 290) return 7;
  return 8;
}

function drawPerspectiveCar(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  color: string,
  number: number,
  ghost = false,
) {
  context.save();
  context.translate(x, y);
  context.scale(scale, scale);
  context.globalAlpha = ghost ? 0.78 : 1;
  context.shadowColor = ghost
    ? "rgba(115, 241, 224, .7)"
    : "rgba(0, 0, 0, .75)";
  context.shadowBlur = ghost ? 12 : 16;

  context.fillStyle = ghost ? "#73f1e0" : "#07090b";
  context.fillRect(-24, -3, 48, 8);
  context.fillStyle = "#080a0c";
  context.fillRect(-24, 5, 10, 28);
  context.fillRect(14, 5, 10, 28);

  context.fillStyle = color;
  context.beginPath();
  context.moveTo(-13, 28);
  context.lineTo(-10, -1);
  context.lineTo(-4, -17);
  context.lineTo(4, -17);
  context.lineTo(10, -1);
  context.lineTo(13, 28);
  context.closePath();
  context.fill();

  context.fillStyle = ghost ? "#0a1615" : "#f5f7f6";
  context.font = "900 10px ui-monospace, monospace";
  context.textAlign = "center";
  context.fillText(String(number), 0, 17);
  context.restore();
}

function drawPerspectiveTrack(
  canvas: HTMLCanvasElement,
  samples: readonly TrackPoint[],
  layout: LoadedCircuitPath,
  raceFrame: StrategyRaceFrame,
  mode: Exclude<CameraMode, "map">,
  team: TeamProfile,
  driver: DriverProfile,
) {
  const bounds = canvas.getBoundingClientRect();
  if (bounds.width < 20 || bounds.height < 20 || samples.length === 0) {
    return;
  }

  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const nextWidth = Math.round(bounds.width * pixelRatio);
  const nextHeight = Math.round(bounds.height * pixelRatio);
  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }

  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

  const width = bounds.width;
  const height = bounds.height;
  const horizon = height * 0.34;
  const bottom = height * 0.96;

  const sky = context.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, "#07131d");
  sky.addColorStop(0.6, "#163343");
  sky.addColorStop(1, "#8ca6aa");
  context.fillStyle = sky;
  context.fillRect(0, 0, width, horizon);

  const ground = context.createLinearGradient(0, horizon, 0, height);
  ground.addColorStop(0, "#284431");
  ground.addColorStop(1, "#0c1710");
  context.fillStyle = ground;
  context.fillRect(0, horizon, width, height - horizon);

  context.fillStyle = "rgba(230, 239, 235, .7)";
  context.fillRect(0, horizon - 2, width, 2);
  context.fillStyle = "rgba(7, 14, 19, .55)";
  for (let index = 0; index < 16; index += 1) {
    const treeX = (index / 15) * width;
    const treeHeight = 10 + ((index * 17) % 15);
    context.fillRect(treeX - 3, horizon - treeHeight, 6, treeHeight);
  }

  const currentPose = poseAtSamples(
    samples,
    raceFrame.primary.trackProgress,
  );
  const headingRadians = (currentPose.angleDegrees * Math.PI) / 180;
  const normalX = -Math.sin(headingRadians);
  const normalY = Math.cos(headingRadians);
  const sections: Array<{
    x: number;
    y: number;
    halfWidth: number;
  }> = [];

  for (let index = 0; index < PERSPECTIVE_SECTION_COUNT; index += 1) {
    const distanceRatio = index / (PERSPECTIVE_SECTION_COUNT - 1);
    const sampleProgress =
      raceFrame.primary.trackProgress +
      PERSPECTIVE_LOOK_AHEAD * Math.pow(distanceRatio, 1.08);
    const point = pointAtSamples(samples, sampleProgress);
    const relativeX = point.x - currentPose.x;
    const relativeY = point.y - currentPose.y;
    const lateral = relativeX * normalX + relativeY * normalY;
    const y =
      bottom -
      Math.pow(distanceRatio, 0.63) * (bottom - horizon - 4);
    const halfWidth =
      width *
      (0.43 -
        (0.43 - 0.024) * Math.pow(distanceRatio, 0.72));
    const lateralScale =
      (width / Math.max(layout.width, layout.height)) * 4.1;
    const centerX =
      width / 2 +
      clamp(lateral * lateralScale, -width * 0.39, width * 0.39);
    sections.push({ x: centerX, y, halfWidth });
  }

  for (let index = sections.length - 2; index >= 0; index -= 1) {
    const near = sections[index];
    const far = sections[index + 1];
    context.beginPath();
    context.moveTo(near.x - near.halfWidth, near.y);
    context.lineTo(near.x + near.halfWidth, near.y);
    context.lineTo(far.x + far.halfWidth, far.y);
    context.lineTo(far.x - far.halfWidth, far.y);
    context.closePath();
    context.fillStyle = index % 2 === 0 ? "#30363a" : "#2b3034";
    context.fill();

    const kerbWidthNear = near.halfWidth * 0.12;
    const kerbWidthFar = far.halfWidth * 0.12;
    context.fillStyle = index % 4 < 2 ? "#e9ecea" : "#d62832";
    context.beginPath();
    context.moveTo(near.x - near.halfWidth - kerbWidthNear, near.y);
    context.lineTo(near.x - near.halfWidth, near.y);
    context.lineTo(far.x - far.halfWidth, far.y);
    context.lineTo(far.x - far.halfWidth - kerbWidthFar, far.y);
    context.closePath();
    context.fill();
    context.beginPath();
    context.moveTo(near.x + near.halfWidth, near.y);
    context.lineTo(near.x + near.halfWidth + kerbWidthNear, near.y);
    context.lineTo(far.x + far.halfWidth + kerbWidthFar, far.y);
    context.lineTo(far.x + far.halfWidth, far.y);
    context.closePath();
    context.fill();

    if (index % 5 === 0) {
      context.strokeStyle = "rgba(232, 237, 234, .34)";
      context.lineWidth = Math.max(1, near.halfWidth * 0.018);
      context.beginPath();
      context.moveTo(near.x, near.y);
      context.lineTo(far.x, far.y);
      context.stroke();
    }
  }

  const ghostDistance =
    raceFrame.referenceDistanceLaps - raceFrame.primaryDistanceLaps;
  if (
    ghostDistance > 0.001 &&
    ghostDistance < PERSPECTIVE_LOOK_AHEAD
  ) {
    const ghostRatio = clamp(
      ghostDistance / PERSPECTIVE_LOOK_AHEAD,
      0,
      1,
    );
    const sectionIndex = Math.min(
      sections.length - 1,
      Math.max(1, Math.round(ghostRatio * (sections.length - 1))),
    );
    const section = sections[sectionIndex];
    drawPerspectiveCar(
      context,
      section.x,
      section.y - section.halfWidth * 0.15,
      clamp(section.halfWidth / 75, 0.15, 0.72),
      "#73f1e0",
      driver.number,
      true,
    );
  }

  if (mode === "chase") {
    drawPerspectiveCar(
      context,
      width / 2,
      height * 0.79,
      clamp(width / 390, 0.74, 1.18),
      raceFrame.primary.isPitting ? "#ffc400" : team.primary,
      driver.number,
    );
  } else {
    const cockpitTop = height * 0.72;
    context.fillStyle = "rgba(3, 5, 7, .96)";
    context.beginPath();
    context.moveTo(0, height);
    context.lineTo(0, cockpitTop + 34);
    context.quadraticCurveTo(width * 0.2, cockpitTop, width * 0.37, height);
    context.closePath();
    context.fill();
    context.beginPath();
    context.moveTo(width, height);
    context.lineTo(width, cockpitTop + 34);
    context.quadraticCurveTo(width * 0.8, cockpitTop, width * 0.63, height);
    context.closePath();
    context.fill();

    context.fillStyle = raceFrame.primary.isPitting
      ? "#ffc400"
      : team.primary;
    context.beginPath();
    context.moveTo(width * 0.43, height);
    context.lineTo(width * 0.475, cockpitTop);
    context.lineTo(width * 0.525, cockpitTop);
    context.lineTo(width * 0.57, height);
    context.closePath();
    context.fill();

    context.strokeStyle = "#080a0c";
    context.lineWidth = Math.max(12, width * 0.022);
    context.beginPath();
    context.arc(
      width / 2,
      cockpitTop + 34,
      width * 0.19,
      Math.PI * 1.08,
      Math.PI * 1.92,
    );
    context.stroke();
    context.beginPath();
    context.moveTo(width / 2, cockpitTop + 25);
    context.lineTo(width / 2, height * 0.42);
    context.stroke();

    context.fillStyle = "#0c1115";
    context.fillRect(
      width * 0.43,
      height * 0.82,
      width * 0.14,
      height * 0.09,
    );
    context.fillStyle = "#dce8e2";
    context.font = "900 12px ui-monospace, monospace";
    context.textAlign = "center";
    context.fillText(
      `${raceFrame.primary.compound} · L${raceFrame.primary.lap}`,
      width / 2,
      height * 0.875,
    );
  }

  if (raceFrame.primary.isPitting) {
    context.fillStyle = "rgba(255, 196, 0, .92)";
    context.fillRect(width * 0.33, height * 0.15, width * 0.34, 30);
    context.fillStyle = "#080a0c";
    context.font = "900 12px ui-monospace, monospace";
    context.textAlign = "center";
    context.fillText("피트 손실 추정", width / 2, height * 0.15 + 20);
  }
}

function StrategyTimelineRow({
  label,
  strategy,
  isReference = false,
}: {
  readonly label: string;
  readonly strategy: StrategyEvaluation;
  readonly isReference?: boolean;
}) {
  const totalLaps = strategy.lapCosts.length;
  return (
    <div
      className={`race-replay__timeline-row ${
        isReference ? "is-reference" : ""
      }`}
    >
      <span>{label}</span>
      <div>
        {strategy.stints.map((stint) => (
          <b
            className={compoundClass(stint.compound)}
            style={{ width: `${(stint.laps / totalLaps) * 100}%` }}
            title={`${COMPOUND_NAMES[stint.compound]} · L${stint.startLap}–L${stint.endLap}`}
            key={`${stint.compound}-${stint.startLap}`}
          >
            {stint.compound}
          </b>
        ))}
      </div>
    </div>
  );
}

export default function RaceReplay({
  trackId,
  track,
  strategy,
  strategyLabel,
  referenceStrategy,
  referenceLabel,
  team,
  driver,
  gridStrategies,
  optimalStrategy,
  startingGridPosition,
  trafficLevel,
  entryContext,
  onOpenSetup,
  onEditStrategy,
  onOpenAnalysis,
}: RaceReplayProps) {
  const primaryReplay = useMemo(
    () => prepareStrategyReplay(strategy),
    [strategy],
  );
  const referenceReplay = useMemo(
    () => prepareStrategyReplay(referenceStrategy),
    [referenceStrategy],
  );
  const initialRaceFrame = useMemo(
    () => strategyRaceFrameAt(primaryReplay, referenceReplay, 0),
    [primaryReplay, referenceReplay],
  );
  const [legacyPerformanceMode, setPerformanceMode] =
    useState<RacePerformanceMode>("equal");
  const performanceMode = entryContext ? "equal" : legacyPerformanceMode;
  const entryTeamId = entryContext?.teamId;
  const entryDriverId = entryContext?.driverId;
  const equalEntryPerformance = entryContext?.equalPerformance;
  const entryPerformance = useMemo(() => entryTeamId !== undefined && entryDriverId !== undefined
    ? resolveEntryPerformance(entryTeamId, entryDriverId, equalEntryPerformance) : null,
  [entryTeamId, entryDriverId, equalEntryPerformance]);
  const raceGridData = useMemo(
    () =>
      makeRaceGrid(
        team,
        driver,
        strategy,
        gridStrategies,
        startingGridPosition,
        trafficLevel,
        performanceMode,
        entryTeamId !== undefined && entryDriverId !== undefined && equalEntryPerformance !== undefined
          ? { teamId: entryTeamId, driverId: entryDriverId, equalPerformance: equalEntryPerformance } : undefined,
      ),
    [
      driver,
      entryTeamId,
      entryDriverId,
      equalEntryPerformance,
      gridStrategies,
      performanceMode,
      startingGridPosition,
      strategy,
      team,
      trafficLevel,
    ],
  );
  const playerGridCar = useMemo(
    () => raceGridCar(raceGridData.grid, driver.id),
    [driver.id, raceGridData.grid],
  );
  const initialGridFrame = useMemo(
    () => raceGridFrameAt(raceGridData.grid, 0),
    [raceGridData.grid],
  );
  const strategyComparison = useMemo(
    () => evaluateStrategyComparison(strategy, optimalStrategy),
    [optimalStrategy, strategy],
  );
  const playerPerformance = useMemo(
    () => racePerformanceProfile(team, driver),
    [driver, team],
  );

  const [layout, setLayout] = useState<LoadedCircuitPath | null>(null);
  const [layoutError, setLayoutError] = useState(false);
  const [raceFrame, setRaceFrame] =
    useState<StrategyRaceFrame>(initialRaceFrame);
  const [gridFrame, setGridFrame] =
    useState<RaceGridFrame>(initialGridFrame);
  const [phase, setPhase] = useState<ReplayPhase>("ready");
  const [countdown, setCountdown] = useState<
    5 | 4 | 3 | 2 | 1 | "GO" | null
  >(null);
  const [playbackRate, setPlaybackRate] = useState(60);
  const [cameraMode, setCameraMode] = useState<CameraMode>("chase");
  const [reducedMotion, setReducedMotion] = useState(false);
  const [renderingEnabled, setRenderingEnabled] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [trackSamples, setTrackSamples] = useState<
    readonly RaceScenePoint[]
  >([]);
  const [webglStatus, setWebGLStatus] =
    useState<WebGLStatus>("loading");
  const [webglReason, setWebGLReason] = useState("");
  const [liveMessage, setLiveMessage] = useState(
    `${track.koreanName} 전략 타임 트라이얼 준비`,
  );
  const isPlaying = phase === "running";

  const elapsedRef = useRef(0);
  const phaseRef = useRef<ReplayPhase>(phase);
  const renderingEnabledRef = useRef(true);
  const viewportVisibleRef = useRef(true);
  const viewportRef = useRef<HTMLDivElement>(null);
  const geometryPathRef = useRef<SVGPathElement>(null);
  const progressPathRef = useRef<SVGPathElement>(null);
  const primaryCarRef = useRef<SVGGElement>(null);
  const referenceCarRef = useRef<SVGGElement>(null);
  const raceSceneRef = useRef<RaceSceneHandle>(null);
  const perspectiveCanvasRef = useRef<HTMLCanvasElement>(null);
  const webglStatusRef = useRef<WebGLStatus>("loading");
  const pathLengthRef = useRef(0);
  const pathSamplesRef = useRef<TrackPoint[]>([]);
  const countdownTimersRef = useRef<number[]>([]);
  const lastTickRef = useRef<number | null>(null);
  const lastUiUpdateRef = useRef(0);
  const wasPittingRef = useRef(false);
  const cameraModeRef = useRef<CameraMode>(cameraMode);
  const raceFrameRef = useRef<StrategyRaceFrame>(initialRaceFrame);
  const gridFrameRef = useRef<RaceGridFrame>(initialGridFrame);
  const resultsTimerRef = useRef<number | null>(null);
  const lastPlayerPositionRef = useRef(
    initialGridFrame.cars.find((car) => car.id === driver.id)
      ?.position ?? startingGridPosition,
  );
  const overtakePulseUntilRef = useRef(0);
  const latestTelemetryRef = useRef<RaceSceneTelemetry>({
    speedKph: 0,
    speed01: 0,
    signedTurn: 0,
    braking: 0,
    overtakePulse: 0,
    reducedMotion: false,
  });

  const handleSceneAvailability = useCallback(
    (available: boolean, reason?: string) => {
      const nextStatus: WebGLStatus = available ? "ready" : "failed";
      webglStatusRef.current = nextStatus;
      setWebGLStatus(nextStatus);
      setWebGLReason(reason ?? "");
      if (
        available &&
        renderingEnabledRef.current &&
        cameraModeRef.current !== "map"
      ) {
        window.requestAnimationFrame(() => {
          if (
            renderingEnabledRef.current &&
            !document.hidden &&
            cameraModeRef.current !== "map"
          ) {
            raceSceneRef.current?.update(
              raceFrameRef.current,
              cameraModeRef.current,
              gridFrameRef.current,
              latestTelemetryRef.current,
            );
          }
        });
      }
      if (!available) {
        setLiveMessage(
          "3D 가속을 사용할 수 없어 경량 모델 화면으로 전환했습니다.",
        );
      }
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    pathSamplesRef.current = [];
    pathLengthRef.current = 0;
    webglStatusRef.current = "loading";
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setLayout(null);
      setTrackSamples([]);
      setLayoutError(false);
      setWebGLStatus("loading");
      setWebGLReason("");
    });

    fetch(circuitLayoutUrl(trackId), { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error("Circuit layout request failed.");
        }
        return response.text();
      })
      .then((svgText) => {
        if (controller.signal.aborted) return;
        const documentNode = new DOMParser().parseFromString(
          svgText,
          "image/svg+xml",
        );
        const svg = documentNode.querySelector("svg");
        const path = documentNode.querySelector("path");
        const pathD = path?.getAttribute("d");
        if (!svg || !pathD) {
          throw new Error("Circuit layout is missing path geometry.");
        }
        const width = Number.parseFloat(svg.getAttribute("width") ?? "500");
        const height = Number.parseFloat(
          svg.getAttribute("height") ?? "500",
        );
        const safeWidth = Number.isFinite(width) ? width : 500;
        const safeHeight = Number.isFinite(height) ? height : 500;
        setLayout({
          pathD,
          width: safeWidth,
          height: safeHeight,
          viewBox:
            svg.getAttribute("viewBox") ??
            `0 0 ${safeWidth} ${safeHeight}`,
        });
      })
      .catch((error: unknown) => {
        if (
          !controller.signal.aborted &&
          !(error instanceof DOMException && error.name === "AbortError")
        ) {
          setLayoutError(true);
        }
      });

    return () => controller.abort();
  }, [trackId]);

  useEffect(() => {
    const motionQuery = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    const applyMotionPreference = (matches: boolean) => {
      setReducedMotion(matches);
      if (matches) setCameraMode("map");
    };
    applyMotionPreference(motionQuery.matches);
    const handleChange = (event: MediaQueryListEvent) =>
      applyMotionPreference(event.matches);
    motionQuery.addEventListener("change", handleChange);
    return () => motionQuery.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    const updateVisibility = () => {
      const visible = !document.hidden && viewportVisibleRef.current;
      renderingEnabledRef.current = visible;
      setRenderingEnabled(visible);
      if (
        !visible &&
        (phaseRef.current === "running" || phaseRef.current === "countdown")
      ) {
        for (const timer of countdownTimersRef.current) {
          window.clearTimeout(timer);
        }
        countdownTimersRef.current = [];
        lastTickRef.current = null;
        phaseRef.current = "paused";
        setCountdown(null);
        setPhase("paused");
        setLiveMessage(
          document.hidden
            ? "브라우저가 숨겨져 재생을 일시정지했습니다. 재생 버튼으로 이어서 볼 수 있습니다."
            : "주행 화면을 벗어나 재생을 일시정지했습니다. 재생 버튼으로 이어서 볼 수 있습니다.",
        );
      }
    };
    const viewport = viewportRef.current;
    const observer =
      viewport && typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(([entry]) => {
            viewportVisibleRef.current = entry.isIntersecting;
            updateVisibility();
          })
        : null;
    if (viewport) observer?.observe(viewport);
    document.addEventListener("visibilitychange", updateVisibility);
    updateVisibility();
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const fullscreen = activeFullscreenElement() === viewportRef.current;
      setIsFullscreen(fullscreen);
      setLiveMessage(
        fullscreen
          ? "3D 주행 화면 전체 화면"
          : "주행 화면 전체 화면을 종료했습니다.",
      );
      window.requestAnimationFrame(() => {
        window.dispatchEvent(new Event("resize"));
      });
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener(
      "webkitfullscreenchange",
      handleFullscreenChange,
    );
    return () => {
      document.removeEventListener(
        "fullscreenchange",
        handleFullscreenChange,
      );
      document.removeEventListener(
        "webkitfullscreenchange",
        handleFullscreenChange,
      );
    };
  }, []);

  const updateVisuals = useCallback(
    (
      nextRaceFrame: StrategyRaceFrame,
      nextGridFrame: RaceGridFrame = gridFrameRef.current,
    ) => {
      const previousGridFrame = gridFrameRef.current;
      const playerFrame = nextGridFrame.cars.find(
        (car) => car.id === driver.id,
      );
      if (
        playerFrame &&
        nextGridFrame.elapsedSeconds > previousGridFrame.elapsedSeconds &&
        playerFrame.position < lastPlayerPositionRef.current
      ) {
        overtakePulseUntilRef.current = performance.now() + 850;
      }
      if (playerFrame) {
        lastPlayerPositionRef.current = playerFrame.position;
      }
      raceFrameRef.current = nextRaceFrame;
      gridFrameRef.current = nextGridFrame;
      if (!renderingEnabledRef.current || document.hidden) return;
      const samples = pathSamplesRef.current;
      if (samples.length > 0) {
        const primaryPose = poseAtSamples(
          samples,
          playerFrame?.lapProgress ??
            nextRaceFrame.primary.trackProgress,
        );
        const referencePose = poseAtSamples(
          samples,
          nextRaceFrame.reference.trackProgress,
        );
        primaryCarRef.current?.setAttribute(
          "transform",
          `translate(${primaryPose.x} ${primaryPose.y}) rotate(${primaryPose.angleDegrees})`,
        );
        referenceCarRef.current?.setAttribute(
          "transform",
          `translate(${referencePose.x} ${referencePose.y}) rotate(${referencePose.angleDegrees})`,
        );
      }

      progressPathRef.current?.setAttribute(
        "stroke-dashoffset",
        String(
          1000 *
            (1 -
              (nextRaceFrame.primary.completed
                ? 1
                : (playerFrame?.lapProgress ??
                  nextRaceFrame.primary.trackProgress))),
        ),
      );

      const lapTiming = playerGridCar.lapTimings[
        Math.min(
          playerGridCar.lapTimings.length - 1,
          Math.max(0, (playerFrame?.lap ?? 1) - 1),
        )
      ];
      const overtakePulse = clamp(
        (overtakePulseUntilRef.current - performance.now()) / 850,
        0,
        1,
      );
      const telemetry = playerFrame
        ? visualTelemetryAt(
            samples,
            playerFrame,
            track.circuitLengthKm,
            lapTiming?.adjustedLapTimeSeconds ??
              strategy.lapCosts[0]?.lapTimeSeconds ??
              90,
            reducedMotion,
            overtakePulse,
          )
        : latestTelemetryRef.current;
      const weatherLap = strategy.lapCosts[Math.min(strategy.lapCosts.length - 1, Math.max(0, (playerFrame?.lap ?? nextRaceFrame.primary.lap) - 1))];
      const weatherTelemetry = { ...telemetry, water: weatherLap?.water ?? 0, raining: weatherLap?.raining ?? false };
      latestTelemetryRef.current = weatherTelemetry;

      if (
        cameraModeRef.current !== "map" &&
        webglStatusRef.current === "ready"
      ) {
        raceSceneRef.current?.update(
          nextRaceFrame,
          cameraModeRef.current,
          nextGridFrame,
          weatherTelemetry,
        );
      }

      if (
        layout &&
        cameraModeRef.current !== "map" &&
        webglStatusRef.current === "failed" &&
        perspectiveCanvasRef.current
      ) {
        drawPerspectiveTrack(
          perspectiveCanvasRef.current,
          samples,
          layout,
          nextRaceFrame,
          cameraModeRef.current === "cockpit"
            ? "cockpit"
            : "chase",
          team,
          driver,
        );
      }
    },
    [
      driver,
      layout,
      playerGridCar.lapTimings,
      reducedMotion,
      strategy.lapCosts,
      team,
      track.circuitLengthKm,
    ],
  );

  useEffect(() => {
    if (!layout) return;
    const animationFrame = window.requestAnimationFrame(() => {
      const pathElement = geometryPathRef.current;
      if (!pathElement) return;
      const pathLength = pathElement.getTotalLength();
      if (!Number.isFinite(pathLength) || pathLength <= 0) return;
      pathLengthRef.current = pathLength;
      const nextSamples = Array.from(
        { length: PATH_SAMPLE_COUNT },
        (_, index) => {
          const point = pathElement.getPointAtLength(
            (pathLength * index) / PATH_SAMPLE_COUNT,
          );
          return { x: point.x, y: point.y };
        },
      );
      pathSamplesRef.current = nextSamples;
      setTrackSamples(nextSamples);
      updateVisuals(raceFrameRef.current, gridFrameRef.current);
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [layout, updateVisuals]);

  useEffect(() => {
    cameraModeRef.current = cameraMode;
    updateVisuals(raceFrameRef.current, gridFrameRef.current);
  }, [cameraMode, updateVisuals]);

  useEffect(() => {
    updateVisuals(raceFrameRef.current, gridFrameRef.current);
  }, [renderingEnabled, updateVisuals, webglStatus]);

  useEffect(() => {
    let cancelled = false;
    for (const timer of countdownTimersRef.current) {
      window.clearTimeout(timer);
    }
    countdownTimersRef.current = [];
    if (resultsTimerRef.current !== null) {
      window.clearTimeout(resultsTimerRef.current);
      resultsTimerRef.current = null;
    }
    elapsedRef.current = 0;
    lastPlayerPositionRef.current =
      initialGridFrame.cars.find((car) => car.id === driver.id)
        ?.position ?? startingGridPosition;
    overtakePulseUntilRef.current = 0;
    queueMicrotask(() => {
      if (cancelled) return;
      setCountdown(null);
      setPhase("ready");
      setRaceFrame(initialRaceFrame);
      setGridFrame(initialGridFrame);
      updateVisuals(initialRaceFrame, initialGridFrame);
    });
    return () => {
      cancelled = true;
    };
  }, [
    driver.id,
    initialGridFrame,
    initialRaceFrame,
    startingGridPosition,
    updateVisuals,
  ]);

  useEffect(() => {
    if (!isPlaying || !renderingEnabled) return;

    let animationFrame = 0;
    lastTickRef.current = null;
    const pitDurations = [
      ...primaryReplay.segments,
      ...referenceReplay.segments,
    ]
      .filter((segment) => segment.kind === "pit-loss")
      .map((segment) => segment.modelSeconds);
    const shortestPitLoss = Math.min(...pitDurations);
    const maximumModelDelta = Number.isFinite(shortestPitLoss)
      ? shortestPitLoss / 2
      : 5;

    const tick = (timestamp: number) => {
      if (!renderingEnabledRef.current || document.hidden) return;
      const previousTick = lastTickRef.current ?? timestamp;
      lastTickRef.current = timestamp;
      const realDeltaSeconds = Math.min(
        0.25,
        Math.max(0, (timestamp - previousTick) / 1000),
      );
      const nextElapsed = Math.min(
        playerGridCar.totalSeconds,
        elapsedRef.current +
          Math.min(
            realDeltaSeconds * playbackRate,
            maximumModelDelta,
          ),
      );
      elapsedRef.current = nextElapsed;
      const nextRaceFrame = strategyRaceFrameAt(
        primaryReplay,
        referenceReplay,
        nextElapsed,
      );
      const nextGridFrame = raceGridFrameAt(
        raceGridData.grid,
        nextElapsed,
      );
      const nextPlayerFrame = nextGridFrame.cars.find(
        (car) => car.id === driver.id,
      );
      updateVisuals(nextRaceFrame, nextGridFrame);

      const pitStateChanged =
        (nextPlayerFrame?.isPitting ?? false) !==
        wasPittingRef.current;
      wasPittingRef.current =
        nextPlayerFrame?.isPitting ?? false;
      if (
        timestamp - lastUiUpdateRef.current >= 90 ||
        pitStateChanged ||
        nextPlayerFrame?.completed
      ) {
        lastUiUpdateRef.current = timestamp;
        setRaceFrame(nextRaceFrame);
        setGridFrame(nextGridFrame);
      }

      if (nextPlayerFrame?.isPitting && pitStateChanged) {
        setLiveMessage(
          `랩 ${Math.max(1, nextPlayerFrame.lap - 1)} 종료 후 피트 스톱`,
        );
      }

      if (nextPlayerFrame?.completed) {
        setRaceFrame(nextRaceFrame);
        setGridFrame(nextGridFrame);
        setPhase("finished");
        setLiveMessage(`${track.koreanName} 전략 레이스 완주`);
        resultsTimerRef.current = window.setTimeout(() => {
          setPhase("results");
          resultsTimerRef.current = null;
        }, 1_350);
        return;
      }

      animationFrame = window.requestAnimationFrame(tick);
    };

    animationFrame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [
    isPlaying,
    renderingEnabled,
    playbackRate,
    driver.id,
    playerGridCar.totalSeconds,
    primaryReplay,
    raceGridData.grid,
    referenceReplay,
    track.koreanName,
    updateVisuals,
  ]);

  const seekTo = useCallback(
    (seconds: number) => {
      const nextRaceFrame = strategyRaceFrameAt(
        primaryReplay,
        referenceReplay,
        seconds,
      );
      const nextGridFrame = raceGridFrameAt(
        raceGridData.grid,
        seconds,
      );
      elapsedRef.current = Math.min(
        seconds,
        playerGridCar.totalSeconds,
      );
      raceFrameRef.current = nextRaceFrame;
      gridFrameRef.current = nextGridFrame;
      setRaceFrame(nextRaceFrame);
      setGridFrame(nextGridFrame);
      updateVisuals(nextRaceFrame, nextGridFrame);
      wasPittingRef.current =
        nextGridFrame.cars.find((car) => car.id === driver.id)
          ?.isPitting ?? false;
    },
    [
      driver.id,
      playerGridCar.totalSeconds,
      primaryReplay,
      raceGridData.grid,
      referenceReplay,
      updateVisuals,
    ],
  );

  const cancelCountdown = useCallback(() => {
    for (const timer of countdownTimersRef.current) {
      window.clearTimeout(timer);
    }
    countdownTimersRef.current = [];
    setCountdown(null);
  }, []);

  const startCountdown = useCallback(() => {
    cancelCountdown();
    if (resultsTimerRef.current !== null) {
      window.clearTimeout(resultsTimerRef.current);
      resultsTimerRef.current = null;
    }
    seekTo(0);
    setCameraMode(reducedMotion ? "map" : "chase");
    if (reducedMotion) {
      setPhase("running");
      setLiveMessage(`${playbackRate}배 모델 시간으로 자동주행`);
      return;
    }
    setPhase("countdown");
    setCountdown(5);
    setLiveMessage("스타팅 라이트 1개 점등");

    const schedule = (
      delay: number,
      value: 4 | 3 | 2 | 1 | "GO",
      message: string,
    ) => {
      countdownTimersRef.current.push(
        window.setTimeout(() => {
          setCountdown(value);
          setLiveMessage(message);
        }, delay),
      );
    };
    schedule(420, 4, "스타팅 라이트 2개 점등");
    schedule(840, 3, "스타팅 라이트 3개 점등");
    schedule(1_260, 2, "스타팅 라이트 4개 점등");
    schedule(1_680, 1, "스타팅 라이트 5개 점등");
    schedule(2_200, "GO", "출발 · 전략 레이스 시작");
    countdownTimersRef.current.push(
      window.setTimeout(() => {
        setCountdown(null);
        setPhase("running");
        setLiveMessage(`${playbackRate}배 모델 시간으로 자동주행`);
        countdownTimersRef.current = [];
      }, 2_650),
    );
  }, [
    cancelCountdown,
    playbackRate,
    reducedMotion,
    seekTo,
  ]);

  useEffect(
    () => () => {
      for (const timer of countdownTimersRef.current) {
        window.clearTimeout(timer);
      }
      countdownTimersRef.current = [];
      if (resultsTimerRef.current !== null) {
        window.clearTimeout(resultsTimerRef.current);
        resultsTimerRef.current = null;
      }
    },
    [],
  );

  const frame = raceFrame.primary;
  const referenceFrame = raceFrame.reference;
  const playerFrame =
    gridFrame.cars.find((car) => car.id === driver.id) ??
    gridFrame.cars[0];
  const finalGridFrame = useMemo(
    () =>
      raceGridFrameAt(
        raceGridData.grid,
        raceGridData.grid.durationSeconds,
      ),
    [raceGridData.grid],
  );
  const finalPlayerFrame =
    finalGridFrame.cars.find((car) => car.id === driver.id) ??
    finalGridFrame.cars[0];
  const timingTowerCars = useMemo(() => {
    const leaders = gridFrame.cars.slice(0, 10);
    if (leaders.some((car) => car.id === driver.id)) return leaders;
    return [...leaders.slice(0, 9), playerFrame];
  }, [driver.id, gridFrame.cars, playerFrame]);
  const displayLap = playerFrame.completed
    ? playerFrame.lap
    : Math.max(1, playerFrame.lap);
  const currentLapCost =
    strategy.lapCosts[
      Math.min(
        strategy.lapCosts.length - 1,
        Math.max(0, displayLap - 1),
      )
    ];
  const currentGridTiming =
    playerGridCar.lapTimings[
      Math.min(
        playerGridCar.lapTimings.length - 1,
        Math.max(0, displayLap - 1),
      )
    ];
  const displayTelemetry = visualTelemetryAt(
    trackSamples,
    playerFrame,
    track.circuitLengthKm,
    currentGridTiming?.adjustedLapTimeSeconds ??
      currentLapCost.lapTimeSeconds,
    reducedMotion,
    0,
  );
  const displayGear = gearForSpeed(displayTelemetry.speedKph);
  const displayRpm =
    displayGear === 0
      ? 0
      : Math.round(
          clamp(
            8_900 +
              ((displayTelemetry.speedKph * 43) % 2_700),
            8_900,
            11_600,
          ) / 100,
        ) * 100;
  const degradationSeconds =
    currentLapCost.linearDegradationSeconds +
    currentLapCost.quadraticDegradationSeconds +
    currentLapCost.tyreState.totalStateLossSeconds;
  const currentTyreState = currentLapCost.tyreState;
  const nextPitAfterLap = strategy.pitAfterLaps.find(
    (pitLap) => pitLap >= displayLap,
  );
  const finalDelta = finalStrategyDeltaSeconds(
    strategy,
    referenceStrategy,
  );
  const replayTheme = {
    "--replay-team": team.primary,
    "--replay-team-dark": team.secondary,
    "--replay-on-team": team.onPrimary,
  } as CSSProperties;
  const telemetryStyle = {
    "--speed-intensity": displayTelemetry.speed01.toFixed(3),
    "--brake-intensity": displayTelemetry.braking.toFixed(3),
  } as CSSProperties;

  const handlePlayPause = useCallback(() => {
    if (phase === "running") {
      setPhase("paused");
      setLiveMessage(`랩 ${displayLap}에서 전략 레이스 일시정지`);
      return;
    }
    if (phase === "countdown") {
      cancelCountdown();
      setPhase("paused");
      setLiveMessage("출발 카운트다운을 일시정지했습니다.");
      return;
    }
    if (
      phase === "ready" ||
      phase === "finished" ||
      phase === "results"
    ) {
      startCountdown();
      return;
    }
    setPhase("running");
    setLiveMessage(`${playbackRate}배 모델 시간으로 재생`);
  }, [
    cancelCountdown,
    displayLap,
    phase,
    playbackRate,
    startCountdown,
  ]);

  useEffect(() => {
    const handleFullscreenSpace = (event: KeyboardEvent) => {
      if (
        event.code !== "Space" ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        activeFullscreenElement() !== viewportRef.current
      ) {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest(
            "input, textarea, select, button, a, [role='button'], [role='slider']",
          ))
      ) {
        return;
      }

      event.preventDefault();
      handlePlayPause();
    };

    window.addEventListener("keydown", handleFullscreenSpace);
    return () =>
      window.removeEventListener("keydown", handleFullscreenSpace);
  }, [handlePlayPause]);

  const handleReset = () => {
    cancelCountdown();
    if (resultsTimerRef.current !== null) {
      window.clearTimeout(resultsTimerRef.current);
      resultsTimerRef.current = null;
    }
    setPhase("ready");
    seekTo(0);
    setLiveMessage(`${track.koreanName} 출발 상태로 초기화`);
  };

  const handlePerformanceMode = (nextMode: RacePerformanceMode) => {
    if (entryContext || nextMode === performanceMode) return;
    cancelCountdown();
    if (resultsTimerRef.current !== null) {
      window.clearTimeout(resultsTimerRef.current);
      resultsTimerRef.current = null;
    }
    setPhase("ready");
    setPerformanceMode(nextMode);
    setLiveMessage(
      nextMode === "realistic"
        ? "2026 성능 추정 모델을 20대 레이스 재생에 적용했습니다."
        : "모든 팀과 드라이버를 동일 성능으로 맞췄습니다.",
    );
  };

  const toggleFullscreen = async () => {
    const target = viewportRef.current as FullscreenTarget | null;
    if (!target) return;

    const fullscreenDocument = document as FullscreenDocument;
    try {
      if (activeFullscreenElement()) {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else {
          await fullscreenDocument.webkitExitFullscreen?.();
        }
        return;
      }

      if (target.requestFullscreen) {
        await target.requestFullscreen();
      } else if (target.webkitRequestFullscreen) {
        await target.webkitRequestFullscreen();
      } else {
        setLiveMessage(
          "이 브라우저에서는 전체 화면을 사용할 수 없습니다.",
        );
      }
    } catch {
      setLiveMessage("전체 화면 전환을 완료하지 못했습니다.");
    }
  };

  const seekToAdjacentLap = (direction: -1 | 1) => {
    cancelCountdown();
    setPhase("paused");
    const targetLap =
      direction < 0
        ? Math.max(1, displayLap - 1)
        : Math.min(frame.totalLaps + 1, displayLap + 1);
    seekTo(lapStartSeconds(strategy, targetLap));
    setLiveMessage(
      targetLap > frame.totalLaps
        ? "결승선으로 이동"
        : `랩 ${targetLap} 시작으로 이동`,
    );
  };

  const finalDeltaText =
    Math.abs(finalDelta) < 0.001
      ? "동일"
      : `${finalDelta > 0 ? "+" : "−"}${Math.abs(finalDelta).toFixed(
          3,
        )}초`;
  const activePitSegment = playerGridCar.replay.segments.find(
    (segment) =>
      segment.kind === "pit-loss" &&
      raceFrame.elapsedSeconds >= segment.startSeconds &&
      raceFrame.elapsedSeconds <= segment.endSeconds,
  );
  const pitProgress =
    activePitSegment?.kind === "pit-loss"
      ? clamp(
          (raceFrame.elapsedSeconds -
            activePitSegment.startSeconds) /
            activePitSegment.modelSeconds,
          0,
          1,
        )
      : 0;
  const resultScore =
    strategyComparison.eligible ? strategyComparison.score : null;
  const fullscreenControlShowsPause =
    phase === "running" || phase === "countdown";
  const fullscreenControlLabel = fullscreenControlShowsPause
    ? "일시정지"
    : phase === "finished" || phase === "results"
      ? "다시 시작"
      : "재생";
  const performanceMetrics = [
    ["CAR", "차량", playerPerformance.ratings.carPace],
    ["DRIVER", "페이스", playerPerformance.ratings.driverPace],
    ["TYRE", "타이어 관리", playerPerformance.ratings.tyreManagement],
    ["CONS", "일관성", playerPerformance.ratings.consistency],
    ["RACE", "레이스 운영", playerPerformance.ratings.racecraft],
    ["PIT", "피트 크루", playerPerformance.ratings.pitCrew],
  ] as const;
  const performanceModeLabel = entryContext
    ? entryContext.equalPerformance ? "상단 설정 · 동일 성능" : "EA 레이팅 기반 프로젝트 매핑"
    : performanceMode === "realistic" ? "2026 성능 추정" : "동일 기본 페이스";

  return (
    <section
      className="race-replay"
      id="strategy-replay"
      aria-labelledby="race-replay-title"
      data-phase={phase}
      data-webgl={webglStatus}
      style={replayTheme}
    >
      <div className="race-replay__heading">
        <div>
          <span>자동 전략 레이스 · 20대 시뮬레이션</span>
          <h3 id="race-replay-title">전략만 바꿔 승부하는 자동 레이스</h3>
          <p>
            {entryContext ? "20대 모두 같은 자동 주행선을 사용합니다. 상단의 동일 성능 설정을 그대로 사용하며, 추천 전략에 이미 반영한 내 차의 능력치는 다시 더하지 않습니다. 상대 차량에만 내 차 대비 페이스·마모·젖은 노면 보정 차이를 적용합니다. 사용자 조작은 결과에 들어가지 않습니다." : <>20대 모두 같은 자동 주행선을 사용합니다. 동일 성능 모드는
            타이어 전략만 분리해 비교하고, 추정 성능 모드는 공식 2026
            결과 기반의 보수적인 팀·드라이버 추정치를 추가합니다. 사용자
            조작은 어느 모드에서도 결과에 들어가지 않습니다.</>}
          </p>
        </div>
        <div className="race-replay__identity">
          <span>내 차량 · P{playerGridCar.gridPosition}</span>
          <strong>
            {strategyLabel} · {track.shortCode}
          </strong>
          <small>
            {team.code} · {driver.code} · {compactStrategy(strategy)}
          </small>
        </div>
      </div>

      <div className="race-replay__camera-bar">
        <div>
          <span>주행 시점</span>
          <strong>
            {cameraMode === "map"
              ? "서킷 전체"
              : cameraMode === "chase"
                ? "3인칭 추적"
                : cameraMode === "cockpit"
                  ? "1인칭 콕핏"
                  : "TV 중계"}
          </strong>
        </div>
        <div role="group" aria-label="주행 카메라">
          {CAMERA_MODES.map((camera) => (
            <button
              type="button"
              aria-pressed={cameraMode === camera.id}
              aria-label={camera.description}
              disabled={reducedMotion && camera.id !== "map"}
              onClick={() => {
                setCameraMode(camera.id);
                setLiveMessage(`${camera.description}으로 전환`);
              }}
              key={camera.id}
            >
              {camera.label}
            </button>
          ))}
          <button
            type="button"
            className="race-replay__fullscreen-button"
            aria-pressed={isFullscreen}
            aria-label={
              isFullscreen
                ? "3D 주행 화면 전체 화면 종료"
                : "3D 주행 화면 전체 화면"
            }
            title={isFullscreen ? "전체 화면 종료 (Esc)" : "전체 화면"}
            onClick={() => void toggleFullscreen()}
          >
            <span aria-hidden="true">{isFullscreen ? "↙" : "⛶"}</span>
            {isFullscreen ? "화면 축소" : "전체 화면"}
          </button>
        </div>
      </div>

      {entryContext && entryPerformance ? <div className="race-replay__performance-panel">
        <div className="race-replay__performance-copy">
          <span>상단 동일 성능 모드 사용</span>
          <strong>{entryContext.equalPerformance ? "동일 성능 · 추가 능력치 보정 0" : "EA 공식 점수 → 프로젝트 추정"}</strong>
          <small>내 차는 DP 계산값을 그대로 사용합니다. 상대만 내 차 대비 계수 차이를 적용하며, 이전 포인트 기반 재생 전용 능력치는 중복 적용하지 않습니다. 그리드·교통·피트 대기 손실은 별도입니다.</small>
        </div>
        <div className="race-replay__performance-source">
          <span>EA 게임 점수 · {entryPerformance.driver.iteration.label} · 확인 {entryPerformance.driver.source.checkedAt}</span>
          <a href={entryPerformance.driver.source.url} target="_blank" rel="noreferrer">EA 레이팅 원문</a>
          <span>점수→초/마모 변환은 실측이 아닌 프로젝트 규칙입니다.</span>
          <span>{entryPerformance.team.explanation}</span>
        </div>
      </div> : <div className="race-replay__performance-panel">
        <div className="race-replay__performance-copy">
          <span>차량·선수 성능 추정</span>
          <strong>
            {performanceMode === "realistic"
              ? "2026 성능 추정 모델"
              : "동일 성능 비교"}
          </strong>
          <small>
            성능치는 20대 레이스 재생에만 적용되며 추천 전략·상위 3개·전략
            점수는 바꾸지 않습니다.
          </small>
        </div>
        <div
          className="race-replay__performance-toggle"
          role="group"
          aria-label="차량과 드라이버 성능 모델"
        >
          <button
            type="button"
            aria-pressed={performanceMode === "equal"}
            disabled={phase === "running" || phase === "countdown"}
            onClick={() => handlePerformanceMode("equal")}
          >
            동일 성능
          </button>
          <button
            type="button"
            aria-pressed={performanceMode === "realistic"}
            disabled={phase === "running" || phase === "countdown"}
            onClick={() => handlePerformanceMode("realistic")}
          >
            실전 성능
          </button>
        </div>
        <div className="race-replay__performance-ratings">
          {performanceMetrics.map(([code, label, value]) => (
            <div title={`${label} 추정 ${value}/100`} key={code}>
              <span>{label}</span>
              <strong>{value}</strong>
              <i>
                <b style={{ width: `${value}%` }} />
              </i>
            </div>
          ))}
        </div>
        <div className="race-replay__performance-source">
          <span>{PERFORMANCE_MODEL_VERSION}</span>
          <span>
            {team.code} {playerPerformance.teamPoints}점 · {driver.code}{" "}
            {playerPerformance.driverPoints}점
          </span>
          <span>
            공식 데이터{" "}
            <a
              href={PERFORMANCE_DATA_SOURCES.teams}
              target="_blank"
              rel="noreferrer"
            >
              팀
            </a>
            {" · "}
            <a
              href={PERFORMANCE_DATA_SOURCES.drivers}
              target="_blank"
              rel="noreferrer"
            >
              드라이버
            </a>
            {" · "}
            <a
              href={PERFORMANCE_DATA_SOURCES.pitStops}
              target="_blank"
              rel="noreferrer"
            >
              피트스톱
            </a>
          </span>
        </div>
      </div>}

      <div className="race-replay__grid">
        <div className="race-replay__stage">
          <div className="race-replay__stage-header">
            <div>
              <span>주행 화면</span>
              <strong>{track.koreanName}</strong>
            </div>
            <b className={playerFrame.isPitting ? "is-pitting" : ""}>
              {playerFrame.completed
                ? "완주"
                : playerFrame.isPitting
                  ? "피트 정차"
                  : `P${playerFrame.position} · ${displayLap}랩`}
            </b>
          </div>

          <div
            ref={viewportRef}
            className={`race-replay__viewport is-${cameraMode}${
              isFullscreen ? " is-fullscreen-view" : ""
            }`}
            data-camera={cameraMode}
            style={telemetryStyle}
          >
            {isFullscreen && <button type="button" className="race-fullscreen-exit"
              aria-label="주행 전체화면 나가기" onClick={() => void toggleFullscreen()}>화면 나가기</button>}
            {!layout && !layoutError && (
              <div className="race-replay__loading" role="status">
                실제 서킷 경로를 불러오는 중…
              </div>
            )}
            {layoutError && (
              <div className="race-replay__loading is-error" role="status">
                서킷 경로를 표시하지 못했습니다.
              </div>
            )}
            {layout && (
              <>
                {trackSamples.length > 0 && (
                  <RaceScene3D
                    ref={raceSceneRef}
                    trackId={trackId}
                    samples={trackSamples}
                    circuitLengthKm={track.circuitLengthKm}
                    team={team}
                    driver={driver}
                    gridVisuals={raceGridData.visuals}
                    renderingEnabled={renderingEnabled && cameraMode !== "map"}
                    onAvailabilityChange={handleSceneAvailability}
                  />
                )}
                <canvas
                  ref={perspectiveCanvasRef}
                  className="race-replay__perspective race-replay__perspective--fallback"
                  aria-hidden={cameraMode === "map"}
                />
                <svg
                  className="race-replay__map"
                  viewBox={layout.viewBox}
                  preserveAspectRatio="xMidYMid meet"
                  role={cameraMode === "map" ? "img" : undefined}
                  aria-hidden={cameraMode !== "map"}
                  aria-labelledby={
                    cameraMode === "map"
                      ? "race-replay-svg-title race-replay-svg-desc"
                      : undefined
                  }
                >
                  <title id="race-replay-svg-title">{`${track.koreanName} 전략 타임 트라이얼`}</title>
                  <desc id="race-replay-svg-desc">
                    실제 서킷 윤곽을 단순화한 경로 위에서 선택 전략과
                    기준 전략의 모델 진행 위치를 표시합니다.
                  </desc>
                  <path
                    className="race-replay__track-shadow"
                    d={layout.pathD}
                  />
                  <path
                    className="race-replay__track-surface"
                    d={layout.pathD}
                  />
                  <path
                    ref={progressPathRef}
                    className="race-replay__track-progress"
                    d={layout.pathD}
                    pathLength="1000"
                    strokeDasharray="1000"
                    strokeDashoffset="1000"
                  />
                  <path
                    ref={geometryPathRef}
                    className="race-replay__track-sensor"
                    d={layout.pathD}
                  />
                  {trackSamples.length > 0 &&
                    gridFrame.cars.map((car) => {
                      const pose = poseAtSamples(
                        trackSamples,
                        car.completed ? 0.999 : car.lapProgress,
                      );
                      const visual = raceGridData.visuals.find(
                        (candidate) => candidate.id === car.id,
                      );
                      const isPlayer = car.id === driver.id;
                      return (
                        <g
                          className={`race-replay__grid-map-car ${
                            isPlayer ? "is-player" : ""
                          } ${car.isPitting ? "is-pitting" : ""}`}
                          transform={`translate(${pose.x} ${pose.y})`}
                          aria-hidden="true"
                          key={car.id}
                        >
                          <circle
                            r={isPlayer ? 8 : 4.5}
                            fill={visual?.color ?? "#cbd2d5"}
                          />
                          {isPlayer && <text y="-12">내 차</text>}
                        </g>
                      );
                    })}
                  <g
                    ref={referenceCarRef}
                    className="race-replay__map-car is-reference is-legacy"
                    aria-hidden="true"
                  >
                    <path d="M 14 0 L 4 -6 L -10 -5 L -14 0 L -10 5 L 4 6 Z" />
                    <circle cx="0" cy="0" r="3" />
                  </g>
                  <g
                    ref={primaryCarRef}
                    className={`race-replay__map-car ${
                      playerFrame.isPitting ? "is-pitting" : ""
                    } is-legacy`}
                    aria-hidden="true"
                  >
                    <path d="M 15 0 L 5 -7 L -10 -6 L -15 0 L -10 6 L 5 7 Z" />
                    <circle cx="0" cy="0" r="4" />
                  </g>
                </svg>

                {cameraMode !== "map" && (
                  <div
                    className="race-replay__model-view-label"
                    title={
                      webglStatus === "failed"
                        ? webglReason
                        : undefined
                    }
                  >
                    {webglStatus === "ready"
                      ? "3D 주행 · 실제 서킷 윤곽"
                      : webglStatus === "failed"
                        ? "간소화 주행 · 호환 모드"
                        : "3D 주행 화면 준비 중"}
                  </div>
                )}

                {cameraMode !== "map" && webglStatus === "loading" && (
                  <div className="race-replay__scene-loading">
                    <span />
                    실제 서킷 3D 도로 생성 중
                  </div>
                )}

                {cameraMode !== "map" && !reducedMotion && (
                  <div
                    className="race-replay__speed-lines"
                    aria-hidden="true"
                  />
                )}

                <aside
                  className="race-replay__timing-tower"
                  aria-label="실시간 상위 10대와 플레이어 순위"
                >
                  <div className="race-replay__timing-heading">
                    <span>순위</span>
                    <strong>주행 기록 · 추정</strong>
                    <small>타이어 · 간격</small>
                  </div>
                  <ol>
                    {timingTowerCars.map((car) => {
                      const visual = raceGridData.visuals.find(
                        (candidate) => candidate.id === car.id,
                      );
                      const isPlayer = car.id === driver.id;
                      return (
                        <li
                          className={isPlayer ? "is-player" : ""}
                          key={car.id}
                        >
                          <b>{car.position}</b>
                          <i
                            style={{
                              backgroundColor:
                                visual?.color ?? "#aeb6ba",
                            }}
                          />
                          <strong>{car.label}</strong>
                          <em
                            className={compoundClass(car.compound)}
                          >
                            {car.compound}
                          </em>
                          <span>{formatRaceGap(car)}</span>
                        </li>
                      );
                    })}
                  </ol>
                  <p>
                    자동 주행 ·{" "}
                    {performanceModeLabel}
                  </p>
                </aside>

                <div
                  className="race-replay__game-hud"
                  aria-label="게임형 전략 재생 정보"
                >
                  <div className="race-replay__hud-lap">
                    <span>현재 랩</span>
                    <strong>
                      {playerFrame.completed
                        ? playerFrame.lap
                        : displayLap}
                      <small> / {frame.totalLaps}</small>
                    </strong>
                  </div>
                  <div className="race-replay__hud-delta">
                    <span>추정 순위</span>
                    <strong>P{playerFrame.position}</strong>
                  </div>
                  <div
                    className="race-replay__hud-tyre"
                    data-condition={currentTyreState.condition}
                    role="group"
                    aria-label={`${COMPOUND_NAMES[playerFrame.compound]} 타이어, ${playerFrame.tyreAge + 1}랩째, ${Math.round(currentTyreState.temperatureC)}도, 그립 ${Math.round(currentTyreState.gripPercent)}퍼센트, 마모 ${Math.round(currentTyreState.wearPercent)}퍼센트, ${TYRE_CONDITION_LABELS_KO[currentTyreState.condition]}`}
                  >
                    <i className={compoundClass(playerFrame.compound)}>
                      {playerFrame.compound}
                    </i>
                    <span>
                      {COMPOUND_NAMES[playerFrame.compound]}
                      <small>
                        {playerFrame.tyreAge + 1}랩 ·{" "}
                        {TYRE_CONDITION_LABELS[currentTyreState.condition]}
                      </small>
                      <em>
                        {Math.round(currentTyreState.temperatureC)}°C · G
                        {Math.round(currentTyreState.gripPercent)} · W
                        {Math.round(currentTyreState.wearPercent)}
                      </em>
                    </span>
                  </div>
                  <div className="race-replay__hud-pace">
                    <span>다음 교체</span>
                    <strong>
                      {nextPitAfterLap === undefined
                        ? "완주"
                        : `L${nextPitAfterLap} 종료 후`}
                    </strong>
                  </div>
                  <div
                    className="race-replay__hud-speed"
                    data-braking={displayTelemetry.braking > 0.3}
                  >
                    <span>표시 속도 · 추정</span>
                    <strong>
                      {displayTelemetry.speedKph}
                      <small> km/h</small>
                    </strong>
                    <div>
                      <b>{displayGear === 0 ? "N" : displayGear}</b>
                      <i>{displayRpm.toLocaleString("en-US")} 회전/분</i>
                    </div>
                  </div>
                </div>

                <div className="race-replay__duel-strip">
                  <span>
                    <i />
                    {strategyLabel}
                  </span>
                  <b>타이어 전략 비교</b>
                  <span className="is-reference">
                    <i />
                    {referenceLabel}
                  </span>
                </div>

                {phase === "ready" && (
                  <div className="race-replay__race-overlay is-ready">
                    <div className="race-replay__brief-kicker">
                      <span>레이스 준비</span>
                      <i />
                      <span>자동 전략 레이스</span>
                    </div>
                    <strong>
                      {track.koreanName}
                      <small>{track.laps}랩</small>
                    </strong>
                    <p>
                      {driver.code} · P{playerGridCar.gridPosition} 출발 ·{" "}
                      {compactStrategy(strategy)}
                    </p>
                    <div className="race-replay__brief-facts">
                      <span>
                        <b>20</b>
                        전략 차량
                      </span>
                      <span>
                        <b>{strategy.stopCount}</b>
                        피트 교체
                      </span>
                      <span>
                        <b>0</b>
                        운전 조작
                      </span>
                    </div>
                    <button
                      type="button"
                      className="race-replay__start-button"
                      disabled={
                        trackSamples.length === 0 ||
                        webglStatus === "loading"
                      }
                      onClick={startCountdown}
                    >
                      <span>
                        {webglStatus === "loading"
                          ? "서킷 준비 중"
                          : "그리드 배치 · 출발"}
                      </span>
                      <b aria-hidden="true">→</b>
                    </button>
                    <small>
                      {entryContext ? `${performanceModeLabel} · 상대 계수 차이만 추가` : performanceMode === "realistic"
                        ? "2026 성능 추정 · 동일 입력 재현 · 전략 우선"
                        : "동일 기본 성능 · 재현 가능한 교통 · 전략 비교"}
                    </small>
                    {onOpenSetup && (
                      <button
                        type="button"
                        className="race-replay__brief-link"
                        onClick={onOpenSetup}
                      >
                        레이스 설정 변경
                      </button>
                    )}
                  </div>
                )}

                {phase === "countdown" && countdown !== null && (
                  <div className="race-replay__race-overlay is-countdown">
                    <span>출발 그리드 · P{playerGridCar.gridPosition}</span>
                    <div
                      className={`race-replay__start-lights ${
                        countdown === "GO" ? "is-out" : ""
                      }`}
                      aria-label={
                        countdown === "GO"
                          ? "출발"
                          : `스타팅 라이트 ${
                              6 - Number(countdown)
                            }개 점등`
                      }
                    >
                      {Array.from({ length: 5 }, (_, index) => (
                        <i
                          className={
                            countdown !== "GO" &&
                            index < 6 - Number(countdown)
                              ? "is-on"
                              : ""
                          }
                          key={index}
                        />
                      ))}
                    </div>
                    <strong>
                      {countdown === "GO" ? "출발" : "대기"}
                    </strong>
                    <small>
                      {entryContext ? `${performanceModeLabel} · 전략 중심` : performanceMode === "realistic"
                        ? "성능 추정 · 타이어 전략 중심"
                        : "동일한 기본 페이스 · 전략만 승부"}
                    </small>
                  </div>
                )}
                {phase === "paused" && !playerFrame.isPitting && (
                  <div className="race-replay__race-overlay is-paused">
                    <span>자동 전략 레이스</span>
                    <strong>일시정지</strong>
                    <small>재생 버튼을 눌러 계속하기</small>
                  </div>
                )}
                {playerFrame.isPitting &&
                  phase !== "countdown" &&
                  phase !== "results" && (
                  <div className="race-replay__race-overlay is-pit">
                    <span>피트 정차 · L{Math.max(1, displayLap - 1)}</span>
                    <strong>
                      +
                      {(
                        activePitSegment?.modelSeconds ??
                        track.pitLossSeconds
                      ).toFixed(1)}{" "}
                      초
                    </strong>
                    <div className="race-replay__pit-progress">
                      <i style={{ width: `${pitProgress * 100}%` }} />
                    </div>
                    <small>
                      {COMPOUND_NAMES[playerFrame.compound]} 장착 · 자동 피트
                    </small>
                  </div>
                )}
                {phase === "finished" && (
                  <div className="race-replay__race-overlay is-finished">
                    <span>레이스 종료</span>
                    <strong>P{finalPlayerFrame.position}</strong>
                    <small>
                      {referenceLabel} 대비 최종 {finalDeltaText}
                    </small>
                  </div>
                )}
                {phase === "results" && (
                  <div className="race-replay__race-overlay is-results">
                    <div className="race-replay__result-heading">
                      <span>시뮬레이션 결과</span>
                      <strong>
                        P{finalPlayerFrame.position}
                        <small>/ 20</small>
                      </strong>
                    </div>
                    <div className="race-replay__result-score">
                      <span>전략 평가 · 추정</span>
                      <strong>
                        {resultScore ?? "—"}
                        <small>/ 100</small>
                      </strong>
                      <p>
                        DP 최적해 대비{" "}
                        {strategyComparison.eligible
                          ? `${strategyComparison.deltaSeconds.toFixed(
                              3,
                            )}초`
                          : "비교 불가"}
                      </p>
                    </div>
                    <div className="race-replay__result-plan">
                      <span>{strategyLabel}</span>
                      <strong>{compactStrategy(strategy)}</strong>
                      <small>
                        피트{" "}
                        {strategy.pitAfterLaps
                          .map((lap) => `L${lap}`)
                          .join(" · ")}
                      </small>
                    </div>
                    <div className="race-replay__result-actions">
                      <button type="button" onClick={startCountdown}>
                        같은 전략 재도전
                      </button>
                      {onEditStrategy && (
                        <button type="button" onClick={onEditStrategy}>
                          전략 수정
                        </button>
                      )}
                      {onOpenAnalysis && (
                        <button type="button" onClick={onOpenAnalysis}>
                          데이터 분석
                        </button>
                      )}
                    </div>
                    <p>
                      점수는 운전 실력 없이 타이어 전략의 모델 시간만
                      동적계획법의 1위 전략과 비교합니다.
                    </p>
                  </div>
                )}
              </>
            )}
            <div
              className="race-replay__fullscreen-playback"
              role="group"
              aria-label="전체화면 재생 제어"
            >
              <button
                type="button"
                aria-keyshortcuts="Space"
                aria-label={`${fullscreenControlLabel} (스페이스바)`}
                onClick={handlePlayPause}
              >
                <span aria-hidden="true">
                  {fullscreenControlShowsPause ? "Ⅱ" : "▶"}
                </span>
                <strong>{fullscreenControlLabel}</strong>
              </button>
              <kbd>스페이스</kbd>
            </div>
          </div>

          <div className="race-replay__track-meta">
            <span>
              {track.circuitLengthKm.toFixed(3)} km · {track.turns}개 코너 · 공식 제원
            </span>
            <div className="race-replay__source-links">
              <a
                href={CIRCUIT_LAYOUT_SOURCE.url}
                target="_blank"
                rel="noreferrer"
              >
                {CIRCUIT_LAYOUT_SOURCE.label} ·{" "}
                {CIRCUIT_LAYOUT_SOURCE.license}
              </a>
              <a
                href={RACE_CAR_ASSET.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                3D 차량 · {RACE_CAR_ASSET.creator}
              </a>
            </div>
          </div>
        </div>

        <aside className="race-replay__telemetry" aria-label="재생 상태">
          <div className="race-replay__lap">
            <span>추정 순위</span>
            <strong>
              P{playerFrame.position}
              <small>/ 20</small>
            </strong>
          </div>

          <div className="race-replay__delta">
            <span>선두와 간격 · 추정</span>
            <strong className={playerFrame.position > 1 ? "is-loss" : ""}>
              {playerFrame.position === 1
                ? "선두"
                : `+${playerFrame.gapToLeaderSeconds.toFixed(3)}초`}
            </strong>
            <small>공유 모델 시계 · 동일 거리 기준</small>
          </div>

          <div className="race-replay__metric-grid">
            <div>
              <span>타이어</span>
              <strong>
                <i className={compoundClass(playerFrame.compound)}>
                  {playerFrame.compound}
                </i>
                {COMPOUND_NAMES[playerFrame.compound]}
              </strong>
            </div>
            <div>
              <span>타이어 나이</span>
              <strong>{playerFrame.tyreAge + 1}랩째</strong>
            </div>
            <div>
              <span>타이어 온도</span>
              <strong>
                {Math.round(currentTyreState.temperatureC)}°C
              </strong>
            </div>
            <div>
              <span>추정 그립</span>
              <strong>{Math.round(currentTyreState.gripPercent)}%</strong>
            </div>
            <div>
              <span>추정 마모</span>
              <strong>{Math.round(currentTyreState.wearPercent)}%</strong>
            </div>
            <div>
              <span>타이어 상태</span>
              <strong>
                {TYRE_CONDITION_LABELS_KO[currentTyreState.condition]}
              </strong>
            </div>
            <div>
              <span>해당 랩 모델 비용</span>
              <strong>
                {currentGridTiming.adjustedLapTimeSeconds.toFixed(3)}초
              </strong>
            </div>
            <div>
              <span>열화·상태 비용</span>
              <strong>+{degradationSeconds.toFixed(3)}초</strong>
            </div>
            <div>
              <span>모델 누적시간</span>
              <strong>{formatRaceTime(gridFrame.elapsedSeconds, 1)}</strong>
            </div>
            <div>
              <span>다음 피트</span>
              <strong>
                {nextPitAfterLap === undefined
                  ? "결승선"
                  : `L${nextPitAfterLap} 종료 후`}
              </strong>
            </div>
          </div>

          <div
            className={`race-replay__event ${
              playerFrame.isPitting ? "is-pitting" : ""
            }`}
          >
            <span>
              {playerFrame.isPitting ? "피트 상황" : "주행 상황"}
            </span>
            <strong>
              {playerFrame.isPitting
                ? `자동 피트 스톱 진행`
                : playerFrame.completed
                  ? `최종 ${finalDeltaText}`
                  : `P${playerFrame.position} · ${COMPOUND_NAMES[playerFrame.compound]} 스틴트`}
            </strong>
            <p>
              {playerFrame.isPitting
                ? `L${Math.max(1, displayLap - 1)} 종료 후 새 ${
                    COMPOUND_NAMES[playerFrame.compound]
                  } 타이어로 교체합니다.`
                : `기준 전략은 L${referenceFrame.lap} · ${
                    COMPOUND_NAMES[referenceFrame.compound]
                  }, 두 차량은 같은 자동주행 조건입니다.`}
            </p>
          </div>
        </aside>
      </div>

      <div className="race-replay__controls">
        {(phase === "paused" || phase === "results") && (
          <label className="race-replay__scrubber">
            <span>
              리플레이 모델 시간
              <b>
                {Math.round(
                  (gridFrame.elapsedSeconds /
                    Math.max(1, playerGridCar.totalSeconds)) *
                    100,
                )}
                %
              </b>
            </span>
            <input
              type="range"
              min="0"
              max={playerGridCar.totalSeconds}
              step="any"
              value={Math.min(
                gridFrame.elapsedSeconds,
                playerGridCar.totalSeconds,
              )}
              aria-label="전략 레이스 모델 시간 탐색"
              aria-valuetext={`랩 ${displayLap}, 누적 ${formatRaceTime(
                gridFrame.elapsedSeconds,
                1,
              )}`}
              onChange={(event) => {
                cancelCountdown();
                setPhase("paused");
                seekTo(Number(event.target.value));
              }}
            />
          </label>
        )}

        <div className="race-replay__transport">
          {(phase === "paused" || phase === "results") && (
            <button
              type="button"
              onClick={() => seekToAdjacentLap(-1)}
              aria-label="이전 랩 시작"
              disabled={gridFrame.elapsedSeconds <= 0}
            >
              −1랩
            </button>
          )}
          <button
            type="button"
            className="race-replay__play"
            onClick={
              phase === "ready" ? startCountdown : handlePlayPause
            }
          >
            {phase === "countdown"
              ? "출발 취소"
              : isPlaying
                ? "일시정지"
                : phase === "finished" || phase === "results"
                  ? "다시 레이스"
                  : phase === "ready"
                    ? "레이스 시작"
                    : "계속"}
          </button>
          {(phase === "paused" || phase === "results") && (
            <button
              type="button"
              onClick={() => seekToAdjacentLap(1)}
              aria-label="다음 랩 시작"
              disabled={playerFrame.completed}
            >
              +1랩
            </button>
          )}
          {phase !== "ready" && (
            <button type="button" onClick={handleReset}>
              그리드로
            </button>
          )}
          <label>
            <span>시간 압축</span>
            <select
              value={playbackRate}
              aria-label="모델 시간 압축률"
              onChange={(event) => {
                const nextRate = Number(event.target.value);
                setPlaybackRate(nextRate);
                setLiveMessage(`${nextRate}배 모델 시간으로 설정`);
              }}
            >
              {PLAYBACK_RATES.map((rate) => (
                <option value={rate} key={rate}>
                  {rate}×
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {(phase === "paused" || phase === "results") && (
      <div className="race-replay__timeline">
        <div className="race-replay__timeline-heading">
          <span>전략 타임라인</span>
          <strong>
            최종 예상 차이 · {finalDeltaText}
          </strong>
        </div>
        <div className="race-replay__timeline-tracks">
          <StrategyTimelineRow
            label={strategyLabel}
            strategy={strategy}
          />
          <StrategyTimelineRow
            label={referenceLabel}
            strategy={referenceStrategy}
            isReference
          />
          <i
            className="race-replay__timeline-cursor"
            style={{
              left: `${clamp(
                (raceFrame.primaryDistanceLaps /
                  strategy.lapCosts.length) *
                  100,
                0,
                100,
              )}%`,
            }}
            aria-hidden="true"
          />
        </div>
      </div>
      )}

      <p className="race-replay__disclaimer">
        실제 서킷 윤곽 기반의 모델 시각화입니다. 실제 고도·차량 물리를
        재현하지 않습니다. 결과 차이는 타이어 전략과 공개한 결정론적
        그리드·교통·피트 규칙에서 발생합니다. {entryContext ? "상단 성능 설정에 따라 내 차에 이미 반영한 계수는 유지하고 상대의 계수 차이만 추가합니다." : "추정 성능 모드에서는 팀·드라이버 추정치가 작은 범위로 추가됩니다."} 표시 속도·시야각·카메라
        효과는 연출용이며 전략 계산에는 사용하지 않습니다.
      </p>
      <p className="sr-only" aria-live="polite">
        {liveMessage}
      </p>
    </section>
  );
}
