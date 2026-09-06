"use client";

import { uiLabel } from "./ui-labels";

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
const HistoricalEvidencePanel = lazy(() => import("./HistoricalEvidencePanel"));
import { publicAsset } from "./lib/public-assets";
import RaceBriefingOverview from "./RaceBriefingOverview";
import type { StrategyWorkspace } from "./RaceBriefingOverview";
import { calculatePitWindows } from "./lib/pit-windows";
const StrategyBacktestPanel = lazy(() => import("./StrategyBacktestPanel"));
import ExperimentNotebook from "./ExperimentNotebook";
import "./experience.css";
import WeatherControls from "./WeatherControls";
import WetEvidencePanel from "./WetEvidencePanel";
import RaceExperimentPanel from "./RaceExperimentPanel";
import { buildRepresentativeStrategies } from "./lib/representative-strategies";
import type { RaceExperimentResult } from "./lib/race-experiments";
import { buildSharedRaceGrid } from "./lib/shared-race-grid";
import { getModelValidationChecks } from "./lib/model-validation";
import PerformanceEvidencePanel from "./PerformanceEvidencePanel";
import { applyEntryPerformance, resolveEntryPerformance } from "./lib/entry-performance";
import { TYRE_COLORS, TYRE_LABELS, RAIN_LABELS, MODEL_PARAMS } from "./model/params";
import { calculatedCrossovers, type WeatherInput } from "./lib/weather";
import type { RaceTrafficLevel } from "./RaceReplay";
const RaceReplay = lazy(() => import("./RaceReplay"));
import {
  PLAYER_RACE_CAR_ASSET,
  RACE_CAR_ASSET,
} from "./lib/visual-assets";
import {
  DEFAULT_TEAM_ID,
  TEAM_PROFILES,
  findTeamProfile,
  type TeamId,
  type TeamProfile,
} from "./lib/participants";
import {
  buildManualStints,
  createDefaultManualPlan,
  manualPlanFromStrategy,
  normalizeManualPlan,
  stintSignature,
  type ManualStrategyPlan,
} from "./lib/manual-strategy";
import {
  COMPOUNDS,
  ALL_COMPOUNDS,
  STRATEGY_MODEL_VERSION,
  TRACK_PRESET_IDS,
  TRACK_PRESETS,
  evaluateStrategy,
  formatRaceTime,
  optimizeTyreStrategies,
  type Compound,
  type StopCount,
  type StrategyEvaluation,
  type StrategyOptimizerInput,
  type StrategyResult,
  type StrategyStintInput,
  type TrackPresetId,
} from "./lib/strategy";
import { formatTyreStateMetric, type TyreCondition } from "./lib/tyre-state";
import { getHistoricalCalibration, HISTORICAL_EVIDENCE } from "./lib/historical-calibration";
const FASTF1_ANALYSIS_SUMMARY = HISTORICAL_EVIDENCE.summary;
// Preserve the stored v1 model-source identifier while expanding its evidence.
function historicalCalibrationForTrack(trackId: TrackPresetId) {
  const value = getHistoricalCalibration(trackId);
  return { ...value, compoundModels: value.compoundModels ?? {}, note: value.summaryKorean };
}

type ModelSource = "project" | "fastf1-2025";

type RunConfig = {
  trackId: TrackPresetId;
  modelSource: ModelSource;
  maxStops: StopCount;
  pitLossSeconds: number;
  degradationPercent: number;
  fuelGainSecondsPerLap: number;
  trackTemperatureC: number;
  airTemperatureC: number;
  humidityPercent: number;
  startingGridPosition: number;
  trafficLevel: RaceTrafficLevel;
  weather: WeatherInput;
  teamId: TeamId;
  driverId: string;
  equalPerformance: boolean;
};

type AnalysisMode = "top3" | "manual";
type PageView =
  | "home"
  | "strategy"
  | "data"
  | "method"
  | "research";
type ResultDetailTab = "chart" | "cost";

const PAGE_VIEWS: ReadonlyArray<{
  id: PageView;
  label: string;
  controls: string;
}> = [
  { id: "home", label: "홈", controls: "home" },
  { id: "strategy", label: "전략 설계", controls: "simulation" },
  { id: "data", label: "데이터 분석", controls: "data-analysis" },
  { id: "method", label: "알고리즘·검증", controls: "algorithm verification" },
  { id: "research", label: "정보·출처", controls: "research" },
];

const RESULT_DETAIL_TABS: ReadonlyArray<{
  id: ResultDetailTab;
  label: string;
}> = [
  { id: "chart", label: "랩타임 차트" },
  { id: "cost", label: "비용 분해" },
];

const COMPOUND_NAMES = TYRE_LABELS;
const COMPOUND_COLORS = TYRE_COLORS;

const TYRE_CONDITION_LABELS: Readonly<Record<TyreCondition, string>> = {
  warming: "워밍업",
  optimal: "최적",
  worn: "마모 진행",
  graining: "그레이닝",
  overheated: "과열",
  cliff: "성능 절벽",
  "wet-running": "과열 누적 없음",
};

const TRAFFIC_LEVELS: ReadonlyArray<{
  id: RaceTrafficLevel;
  label: string;
  description: string;
}> = [
  { id: "low", label: "적음", description: "클린에어에 가까운 간격" },
  { id: "medium", label: "보통", description: "기본 20대 레이스 간격" },
  { id: "high", label: "많음", description: "근접 주행과 교통 손실 증가" },
];

const INITIAL_CONFIG: RunConfig = {
  trackId: "melbourne",
  modelSource: "fastf1-2025",
  maxStops: 2,
  pitLossSeconds: TRACK_PRESETS.melbourne.pitLossSeconds,
  degradationPercent: 100,
  fuelGainSecondsPerLap:
    TRACK_PRESETS.melbourne.fuelGainSecondsPerLap,
  trackTemperatureC: 34,
  airTemperatureC: 23,
  humidityPercent: 58,
  startingGridPosition: 10,
  trafficLevel: "medium",
  weather: { preset: "none" },
  teamId: DEFAULT_TEAM_ID,
  driverId: findTeamProfile(DEFAULT_TEAM_ID).drivers[0].id,
  equalPerformance: false,
};

function configForTrack(
  current: RunConfig,
  trackId: TrackPresetId,
): RunConfig {
  const preset = TRACK_PRESETS[trackId];

  return {
    ...current,
    trackId,
    weather: { preset: current.weather.preset },
    modelSource:
      historicalCalibrationForTrack(trackId) !== null &&
      current.modelSource === "fastf1-2025"
        ? "fastf1-2025"
        : "project",
    pitLossSeconds: current.modelSource === "fastf1-2025" ? getHistoricalCalibration(trackId).pitLossSeconds ?? preset.pitLossSeconds : preset.pitLossSeconds,
    fuelGainSecondsPerLap: preset.fuelGainSecondsPerLap,
    degradationPercent: 100,
  };
}

function makeOptimizerInput(config: RunConfig): StrategyOptimizerInput {
  const preset = TRACK_PRESETS[config.trackId];
  const calibration =
    config.modelSource === "fastf1-2025"
      ? historicalCalibrationForTrack(config.trackId)
      : null;
  const hotTrackAdjustment = Math.max(0, config.trackTemperatureC - 35) * 0.006;
  const coldTrackAdjustment = Math.max(0, 25 - config.trackTemperatureC) * 0.002;
  const hotAirAdjustment = Math.max(0, config.airTemperatureC - 30) * 0.002;
  const humidityAdjustment = Math.max(0, config.humidityPercent - 70) * 0.001;
  const environmentScale =
    1 +
    hotTrackAdjustment +
    coldTrackAdjustment +
    hotAirAdjustment +
    humidityAdjustment;
  const degradationScale =
    (config.degradationPercent / 100) * environmentScale;
  const calibratedCompound = (compound: Compound) => {
    const learned = calibration?.compoundModels[compound];
    return {
      offsetSeconds: learned?.offsetSeconds ?? preset.compounds[compound].offsetSeconds,
      alpha:
        (learned?.alpha ?? preset.compounds[compound].alpha) *
        degradationScale,
      beta:
        (learned?.beta ?? preset.compounds[compound].beta) *
        degradationScale,
    };
  };

  return applyEntryPerformance({
    track: config.trackId,
    pitLossSeconds: config.pitLossSeconds,
    fuelGainSecondsPerLap: config.fuelGainSecondsPerLap,
    trackTemperatureC: config.trackTemperatureC,
    weather: config.weather,
    compoundModels: {
      S: calibratedCompound("S"),
      M: calibratedCompound("M"),
      H: calibratedCompound("H"),
    },
    rules: {
      minStops: 1,
      maxStops: config.maxStops,
      requireTwoDryCompounds: true,
      minStintLaps: 1,
    },
    topK: 3,
  }, config.teamId, config.driverId, config.equalPerformance);
}

function sameConfig(left: RunConfig, right: RunConfig) {
  return (
    left.trackId === right.trackId &&
    left.modelSource === right.modelSource &&
    left.maxStops === right.maxStops &&
    left.pitLossSeconds === right.pitLossSeconds &&
    left.degradationPercent === right.degradationPercent &&
    left.fuelGainSecondsPerLap === right.fuelGainSecondsPerLap &&
    left.trackTemperatureC === right.trackTemperatureC &&
    left.airTemperatureC === right.airTemperatureC &&
    left.humidityPercent === right.humidityPercent &&
    left.startingGridPosition === right.startingGridPosition &&
    left.trafficLevel === right.trafficLevel && JSON.stringify(left.weather) === JSON.stringify(right.weather) && left.equalPerformance === right.equalPerformance && left.teamId === right.teamId && left.driverId === right.driverId
  );
}

function calculateDisplayedStrategies(input: StrategyOptimizerInput): StrategyResult[] {
  const globalBest = optimizeTyreStrategies({ ...input, topK: 1 })[0];
  return [...buildRepresentativeStrategies(input, { globalBest }).strategies];
}

function compoundClass(compound: Compound) {
  return `compound compound--${compound.toLowerCase()}`;
}

function strategySequence(strategy: StrategyEvaluation) {
  return strategy.stints.map((stint) => stint.compound).join(" → ");
}

function formatDelta(seconds: number) {
  return `${seconds >= 0 ? "+" : "−"}${Math.abs(seconds).toFixed(3)}초`;
}

function formatSignedSeconds(seconds: number) {
  const sign = seconds > 0 ? "+" : seconds < 0 ? "−" : "";
  return `${sign}${Math.abs(seconds).toFixed(1)} s`;
}

function manualDeltaText(seconds: number) {
  if (Math.abs(seconds) < 0.0005) {
    return "추천 1위와 동일 기록";
  }
  return `추천 1위보다 ${formatDelta(seconds)}`;
}

function manualViolationText(violation: string) {
  if (violation.startsWith("Pit-stop count must be between")) {
    return "현재 계산 조건에서 허용한 피트스톱 횟수를 벗어났습니다.";
  }
  if (violation === "A dry race must use at least two distinct compounds.") {
    return "건식 레이스는 서로 다른 컴파운드를 2종 이상 사용해야 합니다.";
  }

  const tooLong = violation.match(
    /^([SMH]) stint on laps (\d+)-(\d+) exceeds its (\d+)-lap limit\.$/,
  );
  if (tooLong) {
    return `${tooLong[1]} 타이어의 L${tooLong[2]}–L${tooLong[3]} 스틴트가 모델 한계 ${tooLong[4]}랩을 넘습니다.`;
  }

  const tooShort = violation.match(
    /^([SMH]) stint on laps (\d+)-(\d+) is shorter than (\d+) laps\.$/,
  );
  if (tooShort) {
    return `${tooShort[1]} 타이어의 L${tooShort[2]}–L${tooShort[3]} 스틴트가 최소 ${tooShort[4]}랩보다 짧습니다.`;
  }

  return violation;
}

function TeamCarVisual({ team }: { team: TeamProfile }) {
  return (
    <article className="team-car-card">
      <div className="team-car-card__heading">
        <div>
          <span>2026 공식 차량 이미지</span>
          <strong>{team.carModel}</strong>
        </div>
        <b>{team.code}</b>
      </div>
      <div className="team-car-photo">
        <span hidden aria-hidden="true">
          {team.carModel}
        </span>
        {/* Dynamic local assets keep a visible model-name fallback. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={team.id}
          src={publicAsset(team.carImage.src)}
          alt={`${uiLabel(team.name)} ${team.carModel} 공식 차량 이미지`}
          loading="lazy"
          decoding="async"
          onError={(event) => {
            event.currentTarget.hidden = true;
            const fallback = event.currentTarget.previousElementSibling;
            if (fallback instanceof HTMLElement) {
              fallback.hidden = false;
            }
          }}
        />
        <i aria-hidden="true" />
      </div>
      <div className="team-car-card__credit">
        <span>F1 공식 이미지 출처</span>
        <p>
          <a
            href={team.carImage.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            2026 공식 차량 렌더
          </a>{" "}
          · 비공식·비영리 사용
        </p>
      </div>
    </article>
  );
}

function strategyReason(
  best: StrategyResult,
  runnerUp: StrategyResult | undefined,
) {
  const delta = runnerUp
    ? runnerUp.totalSeconds - best.totalSeconds
    : 0;
  const pitText =
    best.pitAfterLaps.length > 0
      ? `${best.pitAfterLaps.map((lap) => `${lap}랩`).join(" · ")} 뒤 교체`
      : "무정차";

  if (runnerUp && Math.abs(delta) < 0.0005) {
    return `선택한 비용식에서 ${strategySequence(best)}의 ${pitText} 조합은 공동 최단 총시간입니다. 동률 후보는 결과 재현을 위한 결정론적 내부 순서로 표시됩니다.`;
  }

  return `선택한 비용식에서 ${strategySequence(best)}의 ${pitText} 조합이 열화와 피트 손실의 합을 가장 작게 만들었습니다.${
    runnerUp ? ` 2위 후보보다 예상 총시간이 ${delta.toFixed(3)}초 짧습니다.` : ""
  }`;
}

function getChartGeometry(strategy: StrategyEvaluation) {
  const { width, height, padding } = MODEL_PARAMS.chart;
  const values = strategy.lapCosts.map((lap) => lap.lapTimeSeconds);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const min = Math.floor((rawMin - 0.6) * 2) / 2;
  const max = Math.ceil((rawMax + 0.6) * 2) / 2;
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const x = (lap: number) =>
    padding.left +
    ((lap - 1) / Math.max(1, strategy.lapCosts.length - 1)) * innerWidth;
  const y = (value: number) =>
    padding.top + ((max - value) / Math.max(0.1, max - min)) * innerHeight;
  const points = strategy.lapCosts
    .map((lap) => `${x(lap.lap)},${y(lap.lapTimeSeconds)}`)
    .join(" ");

  return {
    width,
    height,
    padding,
    innerWidth,
    innerHeight,
    min,
    max,
    x,
    y,
    points,
  };
}

function StrategyTimeline({
  strategy,
  totalLaps,
}: {
  strategy: StrategyEvaluation;
  totalLaps: number;
}) {
  return (
    <div
      className="timeline"
      role="img"
      aria-label={`${strategySequence(strategy)} 전략. ${strategy.stints
        .map(
          (stint) =>
            `${COMPOUND_NAMES[stint.compound]} ${stint.startLap}랩부터 ${stint.endLap}랩`,
        )
        .join(", ")}`}
    >
      {strategy.stints.map((stint) => (
        <div
          className={`timeline__stint timeline__stint--${stint.compound.toLowerCase()}`}
          key={`${stint.compound}-${stint.startLap}`}
          style={{ width: `${(stint.laps / totalLaps) * 100}%` }}
          title={`${COMPOUND_NAMES[stint.compound]} · L${stint.startLap}–${stint.endLap}`}
        >
          <strong>{stint.compound}</strong>
          <span>
            L{stint.startLap}–{stint.endLap}
          </span>
        </div>
      ))}
    </div>
  );
}

function LapTimeChart({ strategy }: { strategy: StrategyEvaluation }) {
  const chartId = useId();
  const chart = getChartGeometry(strategy);
  const yTicks = [chart.max, (chart.max + chart.min) / 2, chart.min];
  const lastLap = strategy.lapCosts.length;
  const xTicks = [...new Set([1, Math.round(lastLap / 2), lastLap])];

  return (
    <>
      <div className="chart-wrap">
        <svg
          className="lap-chart"
          viewBox={`0 0 ${chart.width} ${chart.height}`}
          role="img"
          aria-labelledby={`${chartId}-title ${chartId}-desc`}
        >
          <title id={`${chartId}-title`}>선택 전략의 예상 랩타임 변화</title>
          <desc id={`${chartId}-desc`}>
            연료 감소로 기본 랩타임이 낮아지고, 각 스틴트 안에서는 타이어
            열화로 랩타임이 증가합니다. 피트랩에서는 고정 피트 손실이
            더해집니다.
          </desc>
          {strategy.lapCosts.filter(lap => lap.raining).map(lap => { const step = chart.innerWidth / Math.max(1, lastLap - 1); return <rect key={`rain-${lap.lap}`} x={Math.max(chart.padding.left, chart.x(lap.lap) - step / 2)} y={chart.padding.top} width={lap.lap === 1 || lap.lap === lastLap ? step / 2 : step} height={chart.innerHeight} fill={TYRE_COLORS.WET} opacity="0.12" />; })}
          <polyline points={strategy.lapCosts.map(lap => `${chart.x(lap.lap)},${chart.padding.top + (1 - lap.water) * chart.innerHeight}`).join(" ")} fill="none" stroke={TYRE_COLORS.WET} strokeWidth="1" strokeDasharray="4 3"><title>수막 0~1 · 프로젝트 추정 (오른쪽 축)</title></polyline>
          {MODEL_PARAMS.chart.waterTicks.map(water => <text key={`water-${water}`} x={chart.width - chart.padding.right + 9} y={chart.padding.top + (1 - water) * chart.innerHeight + 4} fill="#91afc9" fontSize="12">{water.toFixed(1)}</text>)}

          {strategy.stints.map((stint) => {
            const startX =
              stint.startLap === 1
                ? chart.padding.left
                : chart.x(stint.startLap) -
                  chart.innerWidth / Math.max(1, lastLap - 1) / 2;
            const endX =
              stint.endLap === lastLap
                ? chart.padding.left + chart.innerWidth
                : chart.x(stint.endLap) +
                  chart.innerWidth / Math.max(1, lastLap - 1) / 2;
            return (
              <rect
                key={`zone-${stint.startLap}`}
                x={startX}
                y={chart.padding.top}
                width={Math.max(0, endX - startX)}
                height={chart.innerHeight}
                fill={COMPOUND_COLORS[stint.compound]}
                opacity="0.055"
              />
            );
          })}

          {yTicks.map((tick) => (
            <g key={tick}>
              <line
                x1={chart.padding.left}
                x2={chart.padding.left + chart.innerWidth}
                y1={chart.y(tick)}
                y2={chart.y(tick)}
                stroke="#29302b"
                strokeDasharray="4 7"
              />
              <text
                x={chart.padding.left - 10}
                y={chart.y(tick) + 4}
                textAnchor="end"
                fill="#7f8881"
                fontSize="12"
              >
                {tick.toFixed(1)}초
              </text>
            </g>
          ))}

          {xTicks.map((tick) => (
            <text
              key={tick}
              x={chart.x(tick)}
              y={chart.height - 12}
              textAnchor="middle"
              fill="#7f8881"
              fontSize="12"
            >
              L{tick}
            </text>
          ))}

          {strategy.stints.slice(1).map((stint) => (
            <g key={`pit-${stint.startLap}`}>
              <line
                x1={chart.x(stint.startLap)}
                x2={chart.x(stint.startLap)}
                y1={chart.padding.top}
                y2={chart.padding.top + chart.innerHeight}
                stroke="var(--pit)"
                strokeDasharray="3 5"
              />
              <text
                x={chart.x(stint.startLap)}
                y={16}
                textAnchor="middle"
                fill="var(--pit)"
                fontSize="11"
                fontWeight="700"
              >
                피트
              </text>
            </g>
          ))}

          <polyline
            points={chart.points}
            fill="none"
            stroke="#f4f6f1"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {strategy.lapCosts.map((lap) => (
            <circle
              key={lap.lap}
              cx={chart.x(lap.lap)}
              cy={chart.y(lap.lapTimeSeconds)}
              r={lap.pitLossSeconds > 0 ? 4 : 1.8}
              fill={
                lap.pitLossSeconds > 0
                  ? "var(--pit)"
                  : COMPOUND_COLORS[lap.compound]
              }
            >
              <title>{`L${lap.lap} · ${lap.compound} · ${lap.lapTimeSeconds.toFixed(3)}초`}</title>
            </circle>
          ))}
        </svg>
      </div>
      <p className="weather-model-summary">프로젝트 추정 · 흰 선: 랩타임(왼쪽 초) · 파란 점선: 수막(오른쪽 0–1) · 파란 배경: 비가 오는 랩. 물보라·광택 연출과 독립된 계산값입니다.</p>
      <details className="data-table">
        <summary>원본 랩 데이터 드로어 열기</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>랩</th>
                <th>타이어</th>
                <th>사용 랩</th>
                <th>온도</th>
                <th>그립</th>
                <th>마모</th>
                <th>상태</th>
                <th>예상 랩타임</th>
                <th>피트 손실</th>
              </tr>
            </thead>
            <tbody>
              {strategy.lapCosts.map((lap) => (
                <tr key={`row-${lap.lap}`}>
                  <td>L{lap.lap}</td>
                  <td>{COMPOUND_NAMES[lap.compound]}</td>
                  <td>{lap.tyreAge + 1}</td>
                  <td>{formatTyreStateMetric(lap.tyreState.temperatureC, "°C")}</td>
                  <td>{formatTyreStateMetric(lap.tyreState.gripPercent, "%")}</td>
                  <td>{formatTyreStateMetric(lap.tyreState.wearPercent, "%")}</td>
                  <td>
                    {TYRE_CONDITION_LABELS[lap.tyreState.condition]}
                    {lap.tyreState.modelKind === "wet-heat-only" && <small> · 이전 건조 {lap.tyreState.wetDryLaps}랩 · 프로젝트 비용 모델</small>}
                  </td>
                  <td>{lap.lapTimeSeconds.toFixed(3)}초</td>
                  <td>
                    {lap.pitLossSeconds > 0
                      ? `${lap.pitLossSeconds.toFixed(1)}초`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

function exhaustiveEightLapTop3(input: StrategyOptimizerInput) {
  const trackId =
    typeof input.track === "string" ? input.track : "melbourne";
  const baseTrack = TRACK_PRESETS[trackId];
  const track = {
    ...baseTrack,
    laps: 8,
    compounds: {
      ...baseTrack.compounds,
      S: { ...baseTrack.compounds.S, maxStintLaps: 8 },
      M: { ...baseTrack.compounds.M, maxStintLaps: 8 },
      H: { ...baseTrack.compounds.H, maxStintLaps: 8 },
    },
  };
  const candidates: Array<{
    signature: string;
    totalSeconds: number;
  }> = [];

  const pushCandidate = (stints: StrategyStintInput[]) => {
    const evaluation = evaluateStrategy({
      ...input,
      track,
      laps: 8,
      stints,
    });
    if (!evaluation.isLegal) return;
    candidates.push({
      signature: stints
        .map(
          (stint) =>
            `${stint.compound}:${stint.startLap}-${stint.endLap}`,
        )
        .join(">"),
      totalSeconds: evaluation.totalSeconds,
    });
  };

  for (const first of COMPOUNDS) {
    for (const second of COMPOUNDS) {
      for (let pit = 1; pit < 8; pit += 1) {
        pushCandidate([
          { compound: first, startLap: 1, endLap: pit },
          { compound: second, startLap: pit + 1, endLap: 8 },
        ]);
      }
    }
  }

  if ((input.rules?.maxStops ?? 2) === 2) {
    for (const first of COMPOUNDS) {
      for (const second of COMPOUNDS) {
        for (const third of COMPOUNDS) {
          for (let firstPit = 1; firstPit < 7; firstPit += 1) {
            for (
              let secondPit = firstPit + 1;
              secondPit < 8;
              secondPit += 1
            ) {
              pushCandidate([
                {
                  compound: first,
                  startLap: 1,
                  endLap: firstPit,
                },
                {
                  compound: second,
                  startLap: firstPit + 1,
                  endLap: secondPit,
                },
                {
                  compound: third,
                  startLap: secondPit + 1,
                  endLap: 8,
                },
              ]);
            }
          }
        }
      }
    }
  }

  const unique = new Map<
    string,
    { signature: string; totalSeconds: number }
  >();
  for (const candidate of candidates) {
    const current = unique.get(candidate.signature);
    if (!current || candidate.totalSeconds < current.totalSeconds) {
      unique.set(candidate.signature, candidate);
    }
  }

  return [...unique.values()]
    .sort(
      (left, right) =>
        left.totalSeconds - right.totalSeconds ||
        left.signature.localeCompare(right.signature),
    )
    .slice(0, 3);
}

function ValidationPanel({
  input,
  results,
}: {
  input: StrategyOptimizerInput;
  results: StrategyResult[];
}) {
  const checks = useMemo(() => {
    const repeated = calculateDisplayedStrategies(input);
    const shortInput: StrategyOptimizerInput = {
      ...input,
      laps: 8,
      topK: 3,
      weather: { preset: "none" },
      rules: { ...input.rules, minStops: 1, maxStops: Math.min(2, input.rules?.maxStops ?? 2) as StopCount },
    };
    const shortDp = optimizeTyreStrategies(shortInput);
    const shortBrute = exhaustiveEightLapTop3(shortInput);
    const bruteMatch =
      shortDp.length === shortBrute.length &&
      shortDp.every(
        (strategy, index) =>
          strategy.signature === shortBrute[index]?.signature &&
          Math.abs(
            strategy.totalSeconds -
              (shortBrute[index]?.totalSeconds ?? Number.POSITIVE_INFINITY),
          ) < 1e-7,
      );

    return [
      {
        title: "DP ↔ 완전탐색",
        detail: "8랩 가상 문제 상위 3개 일치",
        pass: bruteMatch,
      },
      {
        title: "모델 제약",
        detail: "설정한 스톱 범위 · 실제 우천 타이어 사용 시 건식 2종 면제",
        pass: results.every((result) => result.isLegal),
      },
      {
        title: "결정성",
        detail: "같은 입력이면 같은 결과",
        pass:
          JSON.stringify(repeated.map((result) => result.signature)) ===
          JSON.stringify(results.map((result) => result.signature)),
      },
      {
        title: "시간 경계값",
        detail: "초가 60으로 표시되지 않음",
        pass: !formatRaceTime(4_979.9996, 3).includes(":60."),
      },
      ...getModelValidationChecks(input),
    ];
  }, [input, results]);

  return (
    <div className="verification-grid">
      {checks.map((check) => (
        <article className="verification-card" key={check.title}>
          <div
            className={`verification-card__status ${
              check.pass ? "is-pass" : "is-fail"
            }`}
          >
            {check.pass ? "통과" : "확인 필요"}
          </div>
          <h3>{check.title}</h3>
          <p>{check.detail}</p>
        </article>
      ))}
    </div>
  );
}

export default function StrategyLab({
  initialTrackId = "melbourne",
}: {
  initialTrackId?: TrackPresetId;
}) {
  const [initialConfig] = useState<RunConfig>(() =>
    configForTrack(INITIAL_CONFIG, initialTrackId),
  );
  const [draft, setDraft] = useState<RunConfig>(initialConfig);
  const [applied, setApplied] = useState<RunConfig>(initialConfig);
  const [teamId, setTeamId] = useState<TeamId>(DEFAULT_TEAM_ID);
  const [driverId, setDriverId] = useState(
    findTeamProfile(DEFAULT_TEAM_ID).drivers[0].id,
  );
  const [draftTeamId, setDraftTeamId] = useState<TeamId>(DEFAULT_TEAM_ID);
  const [draftDriverId, setDraftDriverId] = useState(driverId);
  const [selectedRank, setSelectedRank] = useState(0);
  const [analysisMode, setAnalysisMode] =
    useState<AnalysisMode>("top3");
  const [pageView, setPageView] = useState<PageView>("strategy");
  const [workspace, setWorkspace] = useState<StrategyWorkspace>("board");
  const [resultDetailTab, setResultDetailTab] =
    useState<ResultDetailTab>("chart");
  const [results, setResults] = useState<StrategyResult[]>(() =>
    calculateDisplayedStrategies(makeOptimizerInput(initialConfig)),
  );
  const [experimentSeed, setExperimentSeed] = useState<number>(MODEL_PARAMS.race.defaultSeed);
  const [raceExperiment, setRaceExperiment] = useState<RaceExperimentResult | null>(null);
  const [experimentTrial, setExperimentTrial] = useState(0);
  const [calculationRevision, setCalculationRevision] = useState(0);
  const [manualPlan, setManualPlan] = useState<ManualStrategyPlan>(() => {
    const initialTrack = TRACK_PRESETS[initialConfig.trackId];
    const initialBest = results[0];
    return initialBest
      ? manualPlanFromStrategy(initialBest, initialTrack.laps)
      : createDefaultManualPlan(initialTrack.laps);
  });
  const [committedManualPlan, setCommittedManualPlan] =
    useState<ManualStrategyPlan | null>(null);
  const [announcement, setAnnouncement] = useState(
    `${TRACK_PRESETS[initialConfig.trackId].koreanName} 예시 전략 계산이 완료되었습니다.`,
  );
  const [raceSetupOpen, setRaceSetupOpen] = useState(false);
  const setupPanelRef = useRef<HTMLElement>(null);
  const setupTriggerRef = useRef<HTMLElement | null>(null);
  const closeScenarioSetup = useCallback(() => {
    setDraft({ ...applied });
    setDraftTeamId(teamId);
    setDraftDriverId(driverId);
    setRaceSetupOpen(false);
  }, [applied, teamId, driverId]);

  useEffect(() => {
    if (!raceSetupOpen) return;
    const previousOverflow = document.body.style.overflow;
    const panel = setupPanelRef.current;
    const focusableSelector =
      'button:not([disabled]), select:not([disabled]), input:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
    const focusables = panel
      ? Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector))
      : [];
    const handleModalKeydown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        closeScenarioSetup();
        return;
      }
      if (event.key !== "Tab" || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.body.style.overflow = "hidden";
    focusables[0]?.focus();
    window.addEventListener("keydown", handleModalKeydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleModalKeydown);
      setupTriggerRef.current?.focus();
    };
  }, [raceSetupOpen, closeScenarioSetup]);

  const selectedTeam = findTeamProfile(teamId);
  const selectedDriver =
    selectedTeam.drivers.find((driver) => driver.id === driverId) ??
    selectedTeam.drivers[0];
  const draftTeam = findTeamProfile(draftTeamId);
  const draftDriver =
    draftTeam.drivers.find((driver) => driver.id === draftDriverId) ??
    draftTeam.drivers[0];
  const teamTheme = {
    "--apex": selectedTeam.primary,
    "--apex-dark": selectedTeam.secondary,
    "--team-primary": selectedTeam.primary,
    "--team-secondary": selectedTeam.secondary,
    "--team-on-primary": selectedTeam.onPrimary,
    "--participant-accent": selectedTeam.primary,
    "--participant-accent-2": selectedTeam.secondary,
    "--participant-on-accent": selectedTeam.onPrimary,
  } as CSSProperties;

  const optimizerInput = useMemo(
    () => makeOptimizerInput(applied),
    [applied],
  );
  const appliedTrack = TRACK_PRESETS[applied.trackId];
  const entryProfile = useMemo(() => resolveEntryPerformance(applied.teamId, applied.driverId, applied.equalPerformance), [applied.teamId, applied.driverId, applied.equalPerformance]);
  const sharedExperimentGrid = useMemo(() => results[0] ? buildSharedRaceGrid({ teamId: applied.teamId, driverId: applied.driverId, playerStrategy: results[0], strategyPool: results, startingGridPosition: applied.startingGridPosition, equalPerformance: applied.equalPerformance }) : null, [applied.teamId, applied.driverId, applied.startingGridPosition, applied.equalPerformance, results]);
  const equalResults = useMemo(() => calculateDisplayedStrategies(makeOptimizerInput({ ...applied, equalPerformance: true })), [applied]);
  const performanceSummary = applied.equalPerformance ? "동일 성능 모드 · 팀·선수 시간 보정 없음" : `능력치 반영 · 동일 성능 대비 Top 3 ${equalResults.every((value, index) => value.signature === results[index]?.signature) ? "구성 유지" : "구성 변경"} · 1번 총시간 차이 ${formatDelta((results[0]?.totalSeconds ?? 0) - (equalResults[0]?.totalSeconds ?? 0))} · 프로젝트 추정`;
  const strategyPitWindows = useMemo(
    () =>
      results
        .slice(0, 3)
        .map((strategy) =>
          calculatePitWindows(strategy, optimizerInput, appliedTrack.laps),
        ),
    [appliedTrack.laps, optimizerInput, results],
  );
  const selectedTopThree = results[selectedRank] ?? results[0];
  const draftTrack = TRACK_PRESETS[draft.trackId];
  const dirty = !sameConfig(draft, applied);

  const normalizedManualPlan = useMemo(
    () =>
      normalizeManualPlan(
        manualPlan,
        appliedTrack.laps,
        applied.maxStops,
      ),
    [applied.maxStops, appliedTrack.laps, manualPlan],
  );
  const manualStints = useMemo(
    () => buildManualStints(normalizedManualPlan, appliedTrack.laps),
    [appliedTrack.laps, normalizedManualPlan],
  );
  const manualStrategy = useMemo(
    () =>
      evaluateStrategy({
        ...optimizerInput,
        stints: manualStints,
      }),
    [manualStints, optimizerInput],
  );
  const committedManualStrategy = useMemo(() => {
    if (committedManualPlan === null) return null;
    const committedStints = buildManualStints(
      committedManualPlan,
      appliedTrack.laps,
    );
    return evaluateStrategy({
      ...optimizerInput,
      stints: committedStints,
    });
  }, [appliedTrack.laps, committedManualPlan, optimizerInput]);

  const sensitivity = useMemo(() => {
    if (pageView !== "method") {
      return null;
    }

    const low = optimizeTyreStrategies(
      makeOptimizerInput({
        ...applied,
        degradationPercent: Math.max(
          60,
          applied.degradationPercent - 10,
        ),
      }),
    )[0];
    const high = optimizeTyreStrategies(
      makeOptimizerInput({
        ...applied,
        degradationPercent: Math.min(
          150,
          applied.degradationPercent + 10,
        ),
      }),
    )[0];
    const reference = results[0];
    const stable =
      reference !== undefined &&
      low?.signature === reference.signature &&
      high?.signature === reference.signature;
    return { low, high, stable };
  }, [applied, pageView, results]);

  const handleTrackChange = (trackId: TrackPresetId) => {
    setDraft((current) => configForTrack(current, trackId));
  };

  const handleTeamChange = (nextTeamId: TeamId) => {
    const nextTeam = findTeamProfile(nextTeamId);
    setTeamId(nextTeamId);
    setDriverId(nextTeam.drivers[0].id);
    applyConfiguration(applied, nextTeam.drivers[0]);
  };

  const applyConfiguration = (
    nextConfig: RunConfig,
    profileDriver = selectedDriver,
  ) => {
    nextConfig = { ...nextConfig, driverId: profileDriver.id, teamId: TEAM_PROFILES.find(team => team.drivers.some(driver => driver.id === profileDriver.id))?.id ?? nextConfig.teamId };
    const nextTrack = TRACK_PRESETS[nextConfig.trackId];
    const nextResults = calculateDisplayedStrategies(
      makeOptimizerInput(nextConfig),
    );
    const nextBest = nextResults[0];

    setDraft({ ...nextConfig });
    setApplied({ ...nextConfig });
    setResults(nextResults);
    setCalculationRevision((revision) => revision + 1);
    setSelectedRank(0);
    setWorkspace("board");
    setAnalysisMode("top3");
    setCommittedManualPlan(null);
    setResultDetailTab("chart");
    setManualPlan(
      nextBest
        ? manualPlanFromStrategy(nextBest, nextTrack.laps)
        : createDefaultManualPlan(nextTrack.laps),
    );
    setAnnouncement(
      `${uiLabel(profileDriver.firstName)} ${uiLabel(profileDriver.lastName)} 프로필로 ${nextTrack.koreanName} ${nextTrack.laps}랩의 타이어 전략 상위 3개와 직접 전략 비교가 준비되었습니다.`,
    );

    const url = new URL(window.location.href);
    url.searchParams.set("circuit", nextConfig.trackId);
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  };

  const runCalculation = () => {
    applyConfiguration(draft);
  };

  const handleQuickTrackChange = (trackId: TrackPresetId) => {
    applyConfiguration(configForTrack(applied, trackId));
  };

  const applyHistoricalCalibration = (trackId: TrackPresetId) => {
    const calibration = historicalCalibrationForTrack(trackId);
    const nextConfig = {
      ...configForTrack(
        { ...applied, modelSource: "fastf1-2025" },
        trackId,
      ),
      modelSource: "fastf1-2025" as const,
    };
    applyConfiguration(nextConfig);
    setPageView("strategy");
    setAnnouncement(
      calibration.summaryKorean,
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (!selectedTopThree) {
    return (
      <main className="fatal-state">
        <p>현재 조건에서 완주 가능한 전략을 찾지 못했습니다.</p>
      </main>
    );
  }

  const best = results[0];
  const runnerUp = results[1];
  const bestDelta =
    runnerUp === undefined ? 0 : runnerUp.totalSeconds - best.totalSeconds;
  const analysisStrategy =
    analysisMode === "manual"
      ? committedManualStrategy ?? manualStrategy
      : selectedTopThree;
  const replayStrategy =
    analysisMode === "manual"
      ? committedManualStrategy ?? manualStrategy
      : selectedTopThree;
  const replayReference = best;
  const replayStrategyLabel =
    analysisMode === "manual"
      ? "내 전략"
      : `전략 ${String(selectedTopThree.rank).padStart(2, "0")}`;
  const replayReferenceLabel = "동적계획법 최적";
  const manualDelta = manualStrategy.totalSeconds - best.totalSeconds;
  const manualPitDelta = manualStrategy.breakdown.pitLossSeconds - best.breakdown.pitLossSeconds;
  const manualTyreDelta = manualDelta - manualPitDelta;
  const manualMatch = results.find(
    (strategy) =>
      strategy.signature === stintSignature(manualStrategy.stints),
  );
  const committedManualSignature =
    committedManualStrategy === null
      ? null
      : stintSignature(committedManualStrategy.stints);
  const manualDraftDirty =
    committedManualSignature !== null &&
    committedManualSignature !== stintSignature(manualStrategy.stints);
  const degradationTotal =
    analysisStrategy.breakdown.linearDegradationSeconds +
    analysisStrategy.breakdown.quadraticDegradationSeconds +
    analysisStrategy.breakdown.tyreStateLossSeconds;
  const tyreAdjustment =
    analysisStrategy.breakdown.compoundOffsetSeconds + degradationTotal;
  const adjustmentMax = Math.max(
    1,
    Math.abs(tyreAdjustment),
    analysisStrategy.breakdown.fuelGainSeconds,
    analysisStrategy.breakdown.pitLossSeconds,
  );

  const updateManualCompound = (index: number, compound: Compound) => {
    setManualPlan((current) => {
      const compounds: ManualStrategyPlan["compounds"] = [
        ...current.compounds,
      ];
      compounds[index] = compound;
      return { ...current, compounds };
    });
  };

  const updateManualPit = (index: number, lap: number) => {
    setManualPlan((current) => {
      const pitAfterLaps: ManualStrategyPlan["pitAfterLaps"] = [
        ...current.pitAfterLaps,
      ];
      pitAfterLaps[index] = lap;
      return normalizeManualPlan(
        { ...current, pitAfterLaps },
        appliedTrack.laps,
        applied.maxStops,
      );
    });
  };

  const loadBestIntoManual = () => {
    setManualPlan(manualPlanFromStrategy(best, appliedTrack.laps));
    setAnnouncement("추천 1위 전략을 직접 전략 편집기에 불러왔습니다.");
  };

  const resetManualPlan = () => {
    setManualPlan(createDefaultManualPlan(appliedTrack.laps));
    setAnalysisMode("top3");
    setAnnouncement("직접 전략을 1스톱 기본 구성으로 초기화했습니다.");
  };

  const commitManualStrategyForReplay = () => {
    if (!manualStrategy.isLegal) {
      setAnnouncement(
        "규칙 위반을 먼저 수정해야 직접 전략을 주행할 수 있습니다.",
      );
      return;
    }
    setCommittedManualPlan({
      stopCount: normalizedManualPlan.stopCount,
      compounds: [...normalizedManualPlan.compounds],
      pitAfterLaps: [...normalizedManualPlan.pitAfterLaps],
    });
    setAnalysisMode("manual");
    setWorkspace("replay");
    setResultDetailTab("chart");
    setAnnouncement(
      "직접 만든 전략을 고정하고 DP 최적 전략과 타임 트라이얼을 준비했습니다.",
    );
    window.requestAnimationFrame(() => {
      document
        .getElementById("strategy-replay")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const selectResultDetailTab = (tab: ResultDetailTab) => {
    setResultDetailTab(tab);
    setAnnouncement(
      `${RESULT_DETAIL_TABS.find((item) => item.id === tab)?.label ?? "세부 차트"}를 열었습니다.`,
    );
  };

  const selectPageView = (view: PageView) => {
    setPageView(view);
    setAnnouncement(
      `${PAGE_VIEWS.find((item) => item.id === view)?.label ?? "주요 화면"}을 열었습니다.`,
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openScenarioSetup = () => {
    setupTriggerRef.current = document.activeElement as HTMLElement | null;
    setDraft({ ...applied });
    setDraftTeamId(teamId);
    setDraftDriverId(driverId);
    setRaceSetupOpen(true);
  };

  const openRaceSimulation = () => {
    setPageView("strategy");
    setWorkspace("replay");
    setAnnouncement("선택한 전략의 레이스 시뮬레이션으로 이동했습니다.");
    window.requestAnimationFrame(() => {
      document
        .getElementById("strategy-replay")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const handleResultDetailTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }

    event.preventDefault();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? RESULT_DETAIL_TABS.length - 1
          : (index +
              (event.key === "ArrowRight" ? 1 : -1) +
              RESULT_DETAIL_TABS.length) %
            RESULT_DETAIL_TABS.length;
    const nextTab = RESULT_DETAIL_TABS[nextIndex];
    selectResultDetailTab(nextTab.id);
    document.getElementById(`detail-tab-${nextTab.id}`)?.focus();
  };

  return (
    <div
      className="site-shell"
      data-team={selectedTeam.id}
      data-workspace={workspace}
      style={teamTheme}
    >
      <a className="skip-link" href="#main-content">
        본문으로 바로가기
      </a>

      <header className="page-header" id="top">
        <nav className="topbar" aria-label="주요 섹션">
          <button
            type="button"
            className="brand"
            aria-label="compound 홈"
            onClick={() => selectPageView("home")}
          >
            <span className="brand__mark">c</span>
            <span>
              compound
              <small>타이어 전략 분석</small>
            </span>
          </button>
          <div className="topnav" aria-label="주요 화면">
            {PAGE_VIEWS.map((view) => (
              <button
                type="button"
                className={pageView === view.id ? "is-active" : ""}
                aria-controls={view.controls}
                aria-current={pageView === view.id ? "page" : undefined}
                onClick={() => selectPageView(view.id)}
                key={view.id}
              >
                {view.label}
              </button>
            ))}
          </div>
          <label className="equal-performance-toggle"><input type="checkbox" checked={applied.equalPerformance} onChange={event => applyConfiguration({ ...applied, equalPerformance: event.target.checked })} />동일 성능 모드</label>
        </nav>

      </header>

      <main className="long-page" id="main-content">
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>

        <section
          className="home-page section-shell"
          id="home"
          aria-labelledby="home-title"
          hidden={pageView !== "home"}
        >
          <div className="home-page__hero">
            <div>
              <span>데이터 기반 F1 전략 분석</span>
              <h1 id="home-title">더 빠른 한 랩보다,<br />더 빠른 레이스.</h1>
              <p>{performanceSummary}</p>
              <p>
                실제 F1 공개 랩을 분석하고, 설명 가능한 동적계획법으로
                타이어 전략 상위 3개를 만든 뒤 반복 실험과 백테스트로
                검증합니다.
              </p>
              <div>
                <button type="button" onClick={() => selectPageView("strategy")}>
                  전략 설계 시작
                </button>
                <button type="button" onClick={() => selectPageView("method")}>
                  계산 원리 보기
                </button>
              </div>
            </div>
            <article>
              <span>현재 조건의 예측 전략</span>
              <strong>{appliedTrack.koreanName}</strong>
              <small>{appliedTrack.laps}랩 · {RAIN_LABELS[applied.weather.preset]} · 프로젝트 추정</small>
              <StrategyTimeline strategy={best} totalLaps={appliedTrack.laps} />
              <p>{strategySequence(best)} · {best.formattedTime}</p>
            </article>
          </div>
          <dl className="home-page__metrics">
            <div><dt>실측 · 공개 결승 랩</dt><dd>{FASTF1_ANALYSIS_SUMMARY.rawLaps.toLocaleString()}</dd></div>
            <div><dt>실측 · 정제 후 분석 랩</dt><dd>{FASTF1_ANALYSIS_SUMMARY.modelLaps.toLocaleString()}</dd></div>
            <div><dt>실측 · 분석 스틴트</dt><dd>{FASTF1_ANALYSIS_SUMMARY.stints}</dd></div>
            <div><dt>공식 제원 · 서킷</dt><dd>{TRACK_PRESET_IDS.length}</dd></div>
          </dl>
          <p className="weather-model-summary">실측 분석 · 7서킷 21경기, 랩 수 가중 홀드아웃 MAE {HISTORICAL_EVIDENCE.selectedModelSummary.weightedHoldoutMaeSeconds?.toFixed(3)}초/랩. 회귀의 예측 오차이며 전체 레이스 시뮬레이션 정확도가 아닙니다.</p>
          <ol className="home-page__flow">
            <li><span>01</span><strong>공개 데이터</strong><small>FastF1 랩·타이어·날씨</small></li>
            <li><span>02</span><strong>열화 추정</strong><small>연료와 환경을 통제한 회귀</small></li>
            <li><span>03</span><strong>상위 3개 계산</strong><small>상위 후보 동적계획법</small></li>
            <li><span>04</span><strong>결과 검증</strong><small>백테스트·민감도·반복 실험</small></li>
          </ol>
        </section>

        <section
          className="intro-strip"
          aria-labelledby="intro-strip-title"
          hidden={pageView !== "strategy"}
        >
          <div>
            <p>레이스 위크엔드 / 의사결정 지원</p>
            <h1 id="intro-strip-title">
              레이스가 시작되기 전에
              <br />
              전략을 설계하세요.
            </h1>
          </div>
          <p className="intro-strip__copy">
            2026 시즌의 실제 서킷과 조건을 선택해 규정을 만족하는 타이어
            전략 상위 3개를 비교합니다. 계산 결과와 모델 가정, 전략 전환
            조건을 함께 확인할 수 있습니다.
          </p>
        </section>

        <section
          className="simulator section-shell"
          id="simulation"
          aria-labelledby="simulation-title"
          hidden={pageView !== "strategy"}
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">01 · 전략 시뮬레이션</p>
              <h2 id="simulation-title">조건부터 결과까지 한 흐름으로</h2>
            </div>
            <p>
              조건을 바꾸고 계산하면 추천 전략, 상위 3개 타임라인, 직접 만든
              전략과 상세 차트가 아래 순서대로 갱신됩니다.
            </p>
          </div>

          <RaceBriefingOverview
            track={appliedTrack}
            team={selectedTeam}
            driver={selectedDriver}
            trackTemperatureC={applied.trackTemperatureC}
            startingGridPosition={applied.startingGridPosition}
            trafficLevel={applied.trafficLevel}
            maxStops={applied.maxStops}
            pitLossSeconds={applied.pitLossSeconds}
            modelSource={applied.modelSource}
            pitSource={Math.abs(applied.pitLossSeconds - (getHistoricalCalibration(applied.trackId).pitLossSeconds ?? Infinity)) < MODEL_PARAMS.validation.toleranceSeconds ? "실측 기반 추정" : "프로젝트 추정"}
            modelSummary={applied.modelSource === "fastf1-2025" ? getHistoricalCalibration(applied.trackId).summaryKorean : "가정 기반 타이어 계수입니다. 팀·선수 보정은 상단 동일 성능 설정을 따릅니다."}
            weatherSummary={`${RAIN_LABELS[applied.weather.preset]} · 수막·우천 페널티는 프로젝트 추정`}
            ruleExplanation={selectedTopThree.ruleExplanation}
            performanceSummary={performanceSummary}
            results={results}
            pitWindows={strategyPitWindows}
            selectedRank={selectedRank}
            topThreeActive={analysisMode === "top3"}
            workspace={workspace}
            onWorkspaceChange={(view) => {
              if (workspace === "manual" && (view === "detail" || view === "notebook")) {
                setCommittedManualPlan(null);
                setAnalysisMode("manual");
              }
              setWorkspace(view);
              if (view === "replay") setAnnouncement("선택 전략의 3D 리플레이를 준비합니다.");
            }}
            onOpenSetup={openScenarioSetup}
            onSelectStrategy={(index) => {
              setSelectedRank(index);
              setAnalysisMode("top3");
              setResultDetailTab("chart");
            }}
            onOpenManual={() => {
              setManualPlan(manualPlanFromStrategy(selectedTopThree, appliedTrack.laps));
              setWorkspace("manual");
              setAnnouncement(`후보 ${selectedTopThree.rank}을 편집기에 불러왔습니다.`);
            }}
            onOpenReplay={() => {
              setAnalysisMode("top3");
              openRaceSimulation();
            }}
          />

          <p className="weather-model-summary">강수: {RAIN_LABELS[applied.weather.preset]} · 수막·우천 페널티: 프로젝트 추정. 슬릭→인터 경계 {calculatedCrossovers().slickInter.toFixed(2)} 초과, 인터→웨트 약 {calculatedCrossovers().interWet.toFixed(2)}. {selectedTopThree.ruleExplanation} 3D 노면 광택·물보라는 계산과 분리된 연출입니다.</p>
          <p className="weather-model-summary" hidden={workspace !== "board"}>1번은 기존 K-best DP의 최단 해입니다. 2·3번은 순서만 다른 구성을 묶은 대표 대안이며 전역 2·3위가 아닙니다. 같은 스톱 수·컴파운드 집합은 {MODEL_PARAMS.race.minimumDistinctSeconds}초 이상 차이 나는 후보만 표시합니다.{results.length < 3 && ` 현재 조건에서 구별되는 후보는 ${results.length}개입니다.`}</p>
          <RaceExperimentPanel hidden={pageView !== "strategy" || workspace !== "board"} candidates={results} seed={experimentSeed} onSeedChange={setExperimentSeed} result={raceExperiment} onResult={setRaceExperiment} racecraft={entryProfile.racecraft} startingGridPosition={applied.startingGridPosition} pitLossSeconds={applied.pitLossSeconds} trialIndex={experimentTrial} onTrialChange={setExperimentTrial} fixedRivals={sharedExperimentGrid?.fixedRivals} playerId={sharedExperimentGrid?.playerId} gridSlotOffsetSeconds={sharedExperimentGrid?.gridSlotOffsetSeconds} />
          <div className="lab-grid">
            <p className="sr-only">{performanceSummary}</p>
            <aside className="setup-column" aria-label="레이스 시나리오 설정">
              <section
                className="participant-panel participant-theme"
                id="race-context"
                aria-labelledby="participant-title"
              >
                <div className="participant-panel__heading">
                  <div>
                    <span>01 · 서킷과 참가자</span>
                    <h2 id="participant-title">서킷·팀·드라이버 선택</h2>
                  </div>
                  <p>
                    EA 공식 레이팅과 공개 랩 기반 팀 추정치를 전략 비용에 반영합니다. 상단 동일 성능 모드로 보정을 끌 수 있습니다.
                  </p>
                </div>

                <div className="participant-selectors participant-selectors--triple">
                  <label>
                    <span className="field-label">서킷</span>
                    <span className="select-wrap">
                      <select
                        id="context-track"
                        value={applied.trackId}
                        onChange={(event) =>
                          handleQuickTrackChange(
                            event.target.value as TrackPresetId,
                          )
                        }
                      >
                        {TRACK_PRESET_IDS.map((trackId) => {
                          const track = TRACK_PRESETS[trackId];
                          return (
                            <option value={trackId} key={trackId}>
                              {track.koreanName} · {track.laps}랩
                              {track.calendarStatus === "called-off"
                                ? " · 2026 취소"
                                : ""}
                            </option>
                          );
                        })}
                      </select>
                    </span>
                  </label>
                  <label>
                    <span className="field-label">팀</span>
                    <span className="select-wrap">
                      <select
                        id="context-team"
                        value={selectedTeam.id}
                        onChange={(event) =>
                          handleTeamChange(event.target.value as TeamId)
                        }
                      >
                        {TEAM_PROFILES.map((team) => (
                          <option value={team.id} key={team.id}>
                            {uiLabel(team.name)}
                          </option>
                        ))}
                      </select>
                    </span>
                  </label>
                  <label>
                    <span className="field-label">드라이버</span>
                    <span className="select-wrap">
                      <select
                        id="context-driver"
                        value={selectedDriver.id}
                        onChange={(event) => {
                          setDriverId(event.target.value);
                          const driver = selectedTeam.drivers.find(driver => driver.id === event.target.value);
                          if (driver) applyConfiguration(applied, driver);
                        }}
                      >
                        {selectedTeam.drivers.map((driver) => (
                          <option value={driver.id} key={driver.id}>
                            {uiLabel(driver.firstName)} {uiLabel(driver.lastName)}
                          </option>
                        ))}
                      </select>
                    </span>
                  </label>
                </div>

                <div className="participant-showcase">
                  <article className="driver-card">
                    <div className="driver-card__portrait">
                      <span aria-hidden="true">{selectedDriver.code}</span>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        key={selectedDriver.id}
                        src={selectedDriver.headshotUrl}
                        alt={`${uiLabel(selectedDriver.firstName)} ${uiLabel(selectedDriver.lastName)}`}
                        referrerPolicy="no-referrer"
                        onError={(event) => {
                          event.currentTarget.hidden = true;
                        }}
                      />
                    </div>
                    <strong className="driver-card__number">
                      {selectedDriver.number}
                    </strong>
                    <div className="driver-card__identity">
                      <span>{uiLabel(selectedDriver.firstName)}</span>
                      <h4>{uiLabel(selectedDriver.lastName)}</h4>
                      <p>
                        {uiLabel(selectedTeam.name)} · {selectedDriver.countryCode}
                      </p>
                    </div>
                    <div
                      className="driver-card__team-mark"
                      aria-hidden="true"
                    >
                      <span>{selectedTeam.code}</span>
                      <i />
                    </div>
                  </article>

                  <TeamCarVisual team={selectedTeam} />
                </div>
              </section>

            <section
              className="control-panel"
              id="conditions"
              aria-labelledby="conditions-title"
            >
              <div className="panel-heading">
                <div>
                  <span className="panel-index">02 · 레이스 조건</span>
                  <h3 id="conditions-title">주행 조건</h3>
                </div>
                <span className="model-tag">모델 입력값 · 가정</span>
              </div>

              <div className="track-summary">
                <span>{draftTrack.shortCode}</span>
                <div>
                  <div className="track-summary__title">
                    <strong>{draftTrack.koreanName}</strong>
                    {draftTrack.calendarStatus === "called-off" && (
                      <i>2026 취소 · 분석용</i>
                    )}
                  </div>
                  <p>{draftTrack.trait}</p>
                  <small>
                    {draftTrack.circuitLengthKm.toFixed(3)} km ·{" "}
                    {draftTrack.turns}코너 · 추정 타이어 부하{" "}
                    {draftTrack.tyreSeverity}/5 · 추정 피트 손실{" "}
                    {draftTrack.pitLossSeconds.toFixed(1)}초
                  </small>
                </div>
                <b>{draftTrack.laps}랩</b>
              </div>

              <div className="apex-race-conditions">
                <section
                  className="apex-condition-card"
                  aria-labelledby="weather-conditions-title"
                >
                  <div className="apex-condition-card__heading">
                    <div>
                      <span>환경 조건 · 설정</span>
                      <h4 id="weather-conditions-title">환경 조건</h4>
                    </div>
                    <b>랩별 노면 모델</b>
                  </div>

                  <div className="apex-weather-grid">
                    <label className="apex-track-temperature">
                      <span>
                        노면 온도
                        <output htmlFor="track-temperature">
                          {draft.trackTemperatureC}°C
                        </output>
                      </span>
                      <input
                        id="track-temperature"
                        type="range"
                        min="10"
                        max="60"
                        step="1"
                        value={draft.trackTemperatureC}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            trackTemperatureC: Number(event.target.value),
                          }))
                        }
                      />
                      <small>
                        <span>10°</span>
                        <span>60°</span>
                      </small>
                    </label>

                    <label className="apex-number-field">
                      <span>기온</span>
                      <span>
                        <input
                          type="number"
                          min="0"
                          max="45"
                          step="1"
                          value={draft.airTemperatureC}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              airTemperatureC: Math.min(
                                45,
                                Math.max(0, Number(event.target.value)),
                              ),
                            }))
                          }
                          aria-label="기온 °C"
                        />
                        <b>°C</b>
                      </span>
                    </label>

                    <label className="apex-number-field">
                      <span>습도</span>
                      <span>
                        <input
                          type="number"
                          min="20"
                          max="100"
                          step="1"
                          value={draft.humidityPercent}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              humidityPercent: Math.min(
                                100,
                                Math.max(20, Number(event.target.value)),
                              ),
                            }))
                          }
                          aria-label="습도 %"
                        />
                        <b>%</b>
                      </span>
                    </label>
                  </div>

                  <WeatherControls value={draft.weather} laps={draftTrack.laps} temperatureC={draft.trackTemperatureC} onChange={weather => setDraft(current => ({ ...current, weather, maxStops: weather.preset === "none" && current.maxStops === 3 ? 2 : current.maxStops }))} />

                  <p className="apex-condition-card__note">
                    노면 온도는 랩별 타이어 온도·그립 상태와 기준 열화
                    계수에 함께 반영합니다. 기온·습도는 열화 민감도
                    보정값입니다. 강수는 랩별 수막과 타이어 비용에 반영합니다. 우천 계수는 프로젝트 추정이며 실측으로 보정되지 않았습니다.
                  </p>
                </section>

                <section
                  className="apex-condition-card"
                  aria-labelledby="race-situation-title"
                >
                  <div className="apex-condition-card__heading">
                    <div>
                      <span>경기 상황 · 설정</span>
                      <h4 id="race-situation-title">레이스 상황</h4>
                    </div>
                    <b>20대 출발 그리드</b>
                  </div>

                  <label className="apex-grid-position">
                    <span>예상 스타팅 그리드</span>
                    <span>
                      <b>P</b>
                      <input
                        type="number"
                        min="1"
                        max="20"
                        step="1"
                        value={draft.startingGridPosition}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            startingGridPosition: Math.min(
                              20,
                              Math.max(1, Number(event.target.value)),
                            ),
                          }))
                        }
                        aria-label="예상 스타팅 그리드"
                      />
                    </span>
                  </label>

                  <fieldset className="apex-traffic-field">
                    <legend>예상 트래픽</legend>
                    <div>
                      {TRAFFIC_LEVELS.map((level) => (
                        <label key={level.id} title={level.description}>
                          <input
                            type="radio"
                            name="traffic-level"
                            value={level.id}
                            checked={draft.trafficLevel === level.id}
                            onChange={() =>
                              setDraft((current) => ({
                                ...current,
                                trafficLevel: level.id,
                              }))
                            }
                          />
                          <span>{level.label}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <p className="apex-condition-card__note">
                    그리드와 트래픽은 상위 3개의 클린에어 최적화 순위를
                    바꾸지 않고, 아래 20대 자동주행의 출발 위치와 교통
                    손실에 반영됩니다.
                  </p>
                </section>
              </div>

              <div className="condition-grid">
              <fieldset className="field-group model-source-field">
                <legend>타이어 열화 계수 출처</legend>
                <div className="segmented-control">
                  <label>
                    <input
                      type="radio"
                      name="model-source"
                      value="project"
                      checked={draft.modelSource === "project"}
                      onChange={() =>
                        setDraft((current) => ({
                          ...current,
                          modelSource: "project",
                        }))
                      }
                    />
                    <span>가정 기반 모델</span>
                  </label>
                  <label
                    title={
                      historicalCalibrationForTrack(draft.trackId)
                        ? getHistoricalCalibration(draft.trackId).summaryKorean
                        : "이 서킷은 아직 실제 데이터 보정 사례가 없습니다."
                    }
                  >
                    <input
                      type="radio"
                      name="model-source"
                      value="fastf1-2025"
                      checked={draft.modelSource === "fastf1-2025"}
                      disabled={
                        historicalCalibrationForTrack(draft.trackId) === null
                      }
                      onChange={() =>
                        setDraft((current) => configForTrack({ ...current, modelSource: "fastf1-2025" }, current.trackId))
                      }
                    />
                    <span>2023–2025 관측 기반 보정</span>
                  </label>
                </div>
                <small>
                  {historicalCalibrationForTrack(draft.trackId)
                    ? historicalCalibrationForTrack(draft.trackId)?.note
                    : "현재 바레인·바르셀로나·레드불 링·헝가로링·몬차에서만 활성화됩니다."}
                </small>
              </fieldset>

              <fieldset className="field-group">
                <legend>탐색할 최대 피트스톱</legend>
                <div className="segmented-control">
                  {(draft.weather.preset === "none" ? [1, 2] : [1, 2, 3] as StopCount[]).map((stops) => (
                    <label key={stops}>
                      <input
                        type="radio"
                        name="max-stops"
                        value={stops}
                        checked={draft.maxStops === stops}
                        onChange={() =>
                          setDraft((current) => ({
                            ...current,
                            maxStops: stops as StopCount,
                          }))
                        }
                      />
                      <span>{stops}회 교체</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="range-field">
                <div className="range-field__label">
                  <label htmlFor="pit-loss">고정 피트 손실</label>
                  <output htmlFor="pit-loss">
                    {draft.pitLossSeconds.toFixed(1)}초
                  </output>
                </div>
                <input
                  id="pit-loss"
                  type="range"
                  min="16"
                  max="30"
                  step="0.1"
                  value={draft.pitLossSeconds}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      pitLossSeconds: Number(event.target.value),
                    }))
                  }
                />
                <div className="range-field__ends">
                  <span>16초</span>
                  <span>30초</span>
                </div>
              </div>

              <div className="range-field">
                <div className="range-field__label">
                  <label htmlFor="degradation">타이어 열화 강도</label>
                  <output htmlFor="degradation">
                    {draft.degradationPercent}%
                  </output>
                </div>
                <input
                  id="degradation"
                  type="range"
                  min="70"
                  max="140"
                  step="1"
                  value={draft.degradationPercent}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      degradationPercent: Number(event.target.value),
                    }))
                  }
                />
                <div className="range-field__ends">
                  <span>낮음</span>
                  <span>높음</span>
                </div>
              </div>

              <details className="advanced-settings">
                <summary>고급 설정 드로어</summary>
                <div className="range-field">
                  <div className="range-field__label">
                    <label htmlFor="fuel-gain">랩당 연료 효과</label>
                    <output htmlFor="fuel-gain">
                      {draft.fuelGainSecondsPerLap.toFixed(3)}초
                    </output>
                  </div>
                  <input
                    id="fuel-gain"
                    type="range"
                    min="0.02"
                    max="0.08"
                    step="0.001"
                    value={draft.fuelGainSecondsPerLap}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        fuelGainSecondsPerLap: Number(event.target.value),
                      }))
                    }
                  />
                </div>
              </details>
              </div>

              <button
                type="button"
                className="calculate-button"
                onClick={runCalculation}
              >
                <span>{dirty ? "새 조건으로 상위 3개 계산" : "상위 3개 다시 계산"}</span>
                <span aria-hidden="true">→</span>
              </button>
              <p className="input-note">
                건식 최대 2회·우천 최대 3회는 모델 탐색 범위이며 FIA의 의무 정차 횟수를
                뜻하지 않습니다.{" "}
                {draft.modelSource === "fastf1-2025"
                  ? getHistoricalCalibration(draft.trackId).summaryKorean
                  : "현재 선택은 서킷 등급 기반 가정 계수입니다."}
              </p>
            </section>
            </aside>

            <div
              className="result-column"
              data-detail-tab={resultDetailTab}
            >
              <div className="flow-section-heading" id="recommendation">
                <div>
                  <span>
                    추천 전략 · {appliedTrack.koreanName}
                  </span>
                  <h3>레이스를 완주하는 세 가지 전략.</h3>
                </div>
                <p>현재 적용된 조건에서 예상 총시간이 가장 짧은 전략입니다.</p>
              </div>
              <div className="result-status">
                <div>
                  <span className="status-light" aria-hidden="true" />
                  계산 완료
                </div>
                <p>
                  {selectedTeam.code} · {selectedDriver.code} ·{" "}
                  {appliedTrack.koreanName} ·{" "}
                  {appliedTrack.laps}랩 · 최대 {applied.maxStops}회 교체
                </p>
              </div>
              <article className="winner-card">
                <div className="winner-card__top">
                  <div>
                    <span className="rank-label">추천 · 1위</span>
                    <div className="compound-sequence">
                      {best.stints.map((stint, index) => (
                        <span key={`${stint.compound}-${stint.startLap}`}>
                          {index > 0 && (
                            <i aria-hidden="true">→</i>
                          )}
                          <b className={compoundClass(stint.compound)}>
                            {stint.compound}
                          </b>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="winner-time">
                    <span>예상 완주시간</span>
                    <strong>{best.formattedTime}</strong>
                    <small>2위보다 {bestDelta.toFixed(3)}초 단축</small>
                  </div>
                </div>

                <StrategyTimeline
                  strategy={best}
                  totalLaps={appliedTrack.laps}
                />

                <div className="winner-card__facts">
                  <div>
                    <span>피트랩</span>
                    <strong>
                      {best.pitAfterLaps
                        .map((lap) => `L${lap}`)
                        .join(" · ")}
                    </strong>
                  </div>
                  <div>
                    <span>정차 횟수</span>
                    <strong>{best.stopCount}회 교체</strong>
                  </div>
                  <div>
                    <span>내부 규칙</span>
                    <strong className="legal-label">
                      <i aria-hidden="true">✓</i> 모델 제약 통과
                    </strong>
                  </div>
                </div>

                <p className="plain-explanation">
                  <span aria-hidden="true">↳</span>
                  {strategyReason(best, runnerUp)}
                </p>
              </article>

              <section className="top-three" aria-labelledby="top-three-title">
                <div className="subsection-heading">
                  <div>
                    <span>03 · 상위 3개 전략 타임라인</span>
                    <h3 id="top-three-title">상위 3개 전략 타임라인</h3>
                  </div>
                  <p>전략을 선택하면 아래 세부 차트가 바뀝니다.</p>
                </div>
                <div className="strategy-cards">
                  {results.map((strategy, index) => (
                    <button
                      type="button"
                      className={`strategy-card ${
                        analysisMode === "top3" &&
                        selectedRank === index
                          ? "is-selected"
                          : ""
                      }`}
                      aria-label={`추천 ${strategy.rank}위, ${strategySequence(
                        strategy,
                      )}, 예상 완주시간 ${strategy.formattedTime}, 피트랩 ${strategy.pitAfterLaps
                        .map((lap) => `L${lap}`)
                        .join(" · ")}. 선택해 세부 차트 보기`}
                      aria-pressed={
                        analysisMode === "top3" &&
                        selectedRank === index
                      }
                      onClick={() => {
                        setSelectedRank(index);
                        setAnalysisMode("top3");
                        setResultDetailTab("chart");
                      }}
                      key={strategy.signature}
                    >
                      <span className="strategy-card__rank">
                        0{strategy.rank}
                      </span>
                      <div className="strategy-card__sequence">
                        {strategy.stints.map((stint) => (
                          <b
                            className={compoundClass(stint.compound)}
                            key={`${stint.compound}-${stint.startLap}`}
                          >
                            {stint.compound}
                          </b>
                        ))}
                      </div>
                      <strong>{strategy.formattedTime}</strong>
                      <StrategyTimeline
                        strategy={strategy}
                        totalLaps={appliedTrack.laps}
                      />
                      <dl>
                        <div>
                          <dt>차이</dt>
                          <dd>
                            {index === 0
                              ? "최단"
                              : formatDelta(
                                  strategy.totalSeconds -
                                    best.totalSeconds,
                                )}
                          </dd>
                        </div>
                        <div>
                          <dt>피트</dt>
                          <dd>
                            {strategy.pitAfterLaps
                              .map((lap) => `L${lap}`)
                              .join(" · ")}
                          </dd>
                        </div>
                      </dl>
                    </button>
                  ))}
                </div>
              </section>

              <section
                className={`manual-builder ${
                  manualStrategy.isLegal ? "" : "is-invalid"
                }`}
                id="manual-strategy"
                aria-labelledby="manual-builder-title"
              >
                <div className="manual-builder__heading">
                  <div>
                    <span>02 / 직접 전략 설계</span>
                    <h3 id="manual-builder-title">직접 전략 만들기</h3>
                    <p>
                      상위 3개는 그대로 두고, 컴파운드와 피트랩을 직접 정해
                      같은 비용식으로 비교합니다.
                    </p>
                  </div>
                  <div className="manual-builder__tools">
                    <span>
                      현재 계산 조건 ·{" "}
                      {appliedTrack.koreanName}{" "}
                      {appliedTrack.laps}랩
                    </span>
                    <div>
                      <button type="button" onClick={loadBestIntoManual}>
                        추천 1위 불러오기
                      </button>
                      <button type="button" onClick={resetManualPlan}>
                        초기화
                      </button>
                    </div>
                  </div>
                </div>

                <div className="manual-builder__grid">
                  <div className="manual-editor">
                    <fieldset className="manual-stop-field">
                      <legend>정차 횟수</legend>
                      <div className="manual-stop-options">
                        {([1, 2, MODEL_PARAMS.weather.maxStops] as StopCount[]).map((stops) => (
                          <label key={`manual-${stops}-stop`}>
                            <input
                              type="radio"
                              name="manual-stop-count"
                              value={stops}
                              checked={
                                normalizedManualPlan.stopCount === stops
                              }
                              disabled={stops > applied.maxStops}
                              onChange={() =>
                                setManualPlan((current) =>
                                  normalizeManualPlan(
                                    { ...current, stopCount: stops },
                                    appliedTrack.laps,
                                    applied.maxStops,
                                  ),
                                )
                              }
                            />
                            <span>{stops}회 교체</span>
                          </label>
                        ))}
                      </div>
                      {applied.maxStops === 1 && (
                        <small>현재 계산 조건은 최대 1회 교체입니다.</small>
                      )}
                    </fieldset>

                    <div className="manual-stint-list">
                      {manualStrategy.stints.map((stint, index) => {
                        const pitLap =
                          normalizedManualPlan.pitAfterLaps[index];
                        const pitMinimum =
                          index === 0
                            ? 1
                            : normalizedManualPlan.pitAfterLaps[index - 1] + 1;
                        const pitMaximum =
                          index < normalizedManualPlan.stopCount - 1
                            ? normalizedManualPlan.pitAfterLaps[index + 1] - 1
                            : appliedTrack.laps - 1;

                        return (
                          <article
                            className="manual-stint-row"
                            key={`manual-stint-${index}`}
                          >
                            <div className="manual-stint-row__meta">
                              <span>
                                스틴트 {String(index + 1).padStart(2, "0")}
                              </span>
                              <strong>
                                L{stint.startLap}–L{stint.endLap}
                              </strong>
                              <small>{stint.laps}랩</small>
                            </div>

                            <fieldset className="manual-compound-picker">
                              <legend>타이어</legend>
                              <div>
                                {ALL_COMPOUNDS.map((compound) => (
                                  <label
                                    key={`manual-${index}-${compound}`}
                                  >
                                    <input
                                      type="radio"
                                      name={`manual-compound-${index}`}
                                      value={compound}
                                      aria-label={`스틴트 ${index + 1} ${COMPOUND_NAMES[compound]}`}
                                      checked={
                                        normalizedManualPlan.compounds[
                                          index
                                        ] === compound
                                      }
                                      onChange={() =>
                                        updateManualCompound(
                                          index,
                                          compound,
                                        )
                                      }
                                    />
                                    <span
                                      className={compoundClass(compound)}
                                      aria-hidden="true"
                                    >
                                      {compound}
                                    </span>
                                  </label>
                                ))}
                              </div>
                            </fieldset>

                            {index <
                              normalizedManualPlan.stopCount && (
                              <div className="manual-pit-control">
                                <label
                                  htmlFor={`manual-pit-range-${index}`}
                                >
                                  L{pitLap} 종료 후 피트
                                </label>
                                <div>
                                  <input
                                    id={`manual-pit-range-${index}`}
                                    type="range"
                                    min={pitMinimum}
                                    max={pitMaximum}
                                    step="1"
                                    value={pitLap}
                                    onChange={(event) =>
                                      updateManualPit(
                                        index,
                                        Number(event.target.value),
                                      )
                                    }
                                  />
                                  <input
                                    type="number"
                                    inputMode="numeric"
                                    min={pitMinimum}
                                    max={pitMaximum}
                                    step="1"
                                    value={pitLap}
                                    aria-label={`피트 ${index + 1} 랩 직접 입력`}
                                    onChange={(event) =>
                                      updateManualPit(
                                        index,
                                        Number(event.target.value),
                                      )
                                    }
                                  />
                                </div>
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  </div>

                  <div
                    className={`manual-preview ${
                      manualStrategy.isLegal ? "" : "is-invalid"
                    }`}
                    role="group"
                    aria-labelledby="manual-preview-title"
                    aria-live="polite"
                    aria-describedby={
                      manualStrategy.isLegal
                        ? undefined
                        : "manual-strategy-errors"
                    }
                  >
                    <div className="manual-preview__top">
                      <div>
                        <span>직접 설계한 전략</span>
                        <h4 id="manual-preview-title">내 전략</h4>
                      </div>
                      <b
                        className={
                          manualStrategy.isLegal
                            ? "is-legal"
                            : "is-invalid"
                        }
                      >
                        {manualStrategy.isLegal
                          ? "규칙 통과"
                          : "수정 필요"}
                      </b>
                    </div>

                    <div className="manual-preview__time">
                      <span>예상 완주시간</span>
                      <strong>{manualStrategy.formattedTime}</strong>
                      <small>
                        {manualStrategy.isLegal
                          ? manualDeltaText(manualDelta)
                          : "규칙 위반 · 순위 비교 제외"}
                      </small>
                    </div>

                    <StrategyTimeline
                      strategy={manualStrategy}
                      totalLaps={appliedTrack.laps}
                    />

                    <dl className="manual-preview__facts">
                      <div>
                        <dt>피트</dt>
                        <dd>
                          {manualStrategy.pitAfterLaps
                            .map((lap) => `L${lap}`)
                            .join(" · ")}
                        </dd>
                      </div>
                      <div>
                        <dt>구성</dt>
                        <dd>{strategySequence(manualStrategy)}</dd>
                      </div>
                    </dl>

                    <p className="manual-preview__match">
                      {manualStrategy.isLegal
                        ? manualMatch
                          ? `상위 3개 #${manualMatch.rank}와 같은 전략`
                          : "직접 만든 고유 전략"
                        : "규칙을 고치면 상위 3개와 공정하게 비교할 수 있습니다."}
                    </p>

                    {manualStrategy.isLegal && <div className="manual-impact" aria-label="추천 최단 전략 대비 시간 차이 원인">
                      <span>최단 전략과 무엇이 다른가?</span>
                      <dl>
                        <div><dt>타이어 사용 비용</dt><dd>{formatSignedSeconds(manualTyreDelta)}</dd></div>
                        <div><dt>피트스톱 비용</dt><dd>{formatSignedSeconds(manualPitDelta)}</dd></div>
                      </dl>
                      <small>기준 페이스와 연료 효과는 같은 조건으로 고정됩니다.</small>
                    </div>}

                    {!manualStrategy.isLegal && (
                      <ul
                        className="manual-errors"
                        id="manual-strategy-errors"
                      >
                        {manualStrategy.violations.map((violation) => (
                          <li key={violation}>
                            {manualViolationText(violation)}
                          </li>
                        ))}
                      </ul>
                    )}

                    <button
                      type="button"
                      className="manual-analysis-button"
                      disabled={!manualStrategy.isLegal}
                      onClick={commitManualStrategyForReplay}
                    >
                      이 전략으로 3D 비교
                    </button>
                    <button type="button" className="manual-inspect-button" disabled={!manualStrategy.isLegal}
                      onClick={() => {
                        setCommittedManualPlan(null);
                        setAnalysisMode("manual");
                        setWorkspace("detail");
                      }}>시간 차이 분석하기</button>
                    <button type="button" className="manual-inspect-button" disabled={!manualStrategy.isLegal}
                      onClick={() => {
                        setCommittedManualPlan(null);
                        setAnalysisMode("manual");
                        setWorkspace("notebook");
                      }}>실험 노트에 기록하기</button>
                    <p className="manual-preview__note">
                      {!manualStrategy.isLegal
                        ? "규칙 위반 전략은 상위 3개 순위 비교에서 제외합니다."
                        : manualDraftDirty
                          ? "편집 내용이 아직 주행에 반영되지 않았습니다. 다시 주행 버튼을 눌러 고정하세요."
                          : "같은 랩타임·열화·피트 손실 모델로 계산하고 주행 전략을 고정합니다."}
                    </p>
                  </div>
                </div>
              </section>

              <div
                className="detail-section-heading"
                id="detail-analysis"
              >
                <div>
                  <span>03 / 결과 해석</span>
                  <h3>선택 전략 세부 차트</h3>
                </div>
                <p>
                  선택한 전략의 시간 차이가 어디에서 발생하는지 확인하세요.
                </p>
              </div>

              <div className="result-detail-tabs">
                <div>
                  <span>상세 분석</span>
                  <strong>
                    {analysisMode === "manual"
                      ? "직접 설계한 전략"
                      : `전략 0${selectedTopThree.rank}`}
                  </strong>
                </div>
                <div role="tablist" aria-label="세부 차트">
                  {RESULT_DETAIL_TABS.map((tab, index) => (
                    <button
                      type="button"
                      role="tab"
                      id={`detail-tab-${tab.id}`}
                      aria-controls={`detail-panel-${tab.id}`}
                      aria-selected={resultDetailTab === tab.id}
                      tabIndex={resultDetailTab === tab.id ? 0 : -1}
                      onClick={() => selectResultDetailTab(tab.id)}
                      onKeyDown={(event) =>
                        handleResultDetailTabKeyDown(event, index)
                      }
                      key={tab.id}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              <section
                className="analysis-card analysis-card--chart"
                id="detail-panel-chart"
                role="tabpanel"
                aria-labelledby="detail-tab-chart chart-title"
                hidden={resultDetailTab !== "chart"}
              >
                <div className="analysis-card__heading">
                  <div>
                    <span>랩타임 모델 · 추정</span>
                    <h3 id="chart-title">예상 랩타임</h3>
                  </div>
                  <p className="chart-note">
                    점에 마우스를 올리거나 원본 데이터 드로어에서 값을
                    확인할 수 있습니다.
                  </p>
                </div>
                <LapTimeChart strategy={analysisStrategy} />
              </section>

              <section
                className="analysis-card analysis-card--cost"
                id="detail-panel-cost"
                role="tabpanel"
                aria-labelledby="detail-tab-cost cost-title"
                hidden={resultDetailTab !== "cost"}
              >
                <div className="analysis-card__heading">
                  <div>
                    <span>시간 비용 내역 · 추정</span>
                    <h3 id="cost-title">시간 비용 분해</h3>
                  </div>
                  <strong className="analysis-total">
                    {analysisStrategy.formattedTime}
                  </strong>
                </div>

                <div className="cost-list">
                  <div className="cost-row cost-row--baseline">
                    <div>
                      <span>기준 주행</span>
                      <small>B × 전체 랩</small>
                    </div>
                    <div className="cost-track">
                      <i style={{ width: "100%" }} />
                    </div>
                    <strong>
                      {formatRaceTime(
                        analysisStrategy.breakdown.baselineSeconds,
                        1,
                      )}
                    </strong>
                  </div>
                  <div className="cost-row">
                    <div>
                      <span>타이어 조정</span>
                      <small>컴파운드 + 마모 + 온도 상태</small>
                    </div>
                    <div className="cost-track">
                      <i
                        style={{
                          width: `${(Math.abs(tyreAdjustment) / adjustmentMax) * 100}%`,
                        }}
                      />
                    </div>
                    <strong>{formatSignedSeconds(tyreAdjustment)}</strong>
                  </div>
                  <div className="cost-row cost-row--benefit">
                    <div>
                      <span>연료 감소</span>
                      <small>전체 랩 기준 효과</small>
                    </div>
                    <div className="cost-track">
                      <i
                        style={{
                          width: `${(analysisStrategy.breakdown.fuelGainSeconds / adjustmentMax) * 100}%`,
                        }}
                      />
                    </div>
                    <strong>
                      {formatSignedSeconds(
                        -analysisStrategy.breakdown.fuelGainSeconds,
                      )}
                    </strong>
                  </div>
                  <div className="cost-row cost-row--pit">
                    <div>
                      <span>피트스톱</span>
                      <small>
                        {analysisStrategy.stopCount} ×{" "}
                        {applied.pitLossSeconds.toFixed(1)}초
                      </small>
                    </div>
                    <div className="cost-track">
                      <i
                        style={{
                          width: `${(analysisStrategy.breakdown.pitLossSeconds / adjustmentMax) * 100}%`,
                        }}
                      />
                    </div>
                    <strong>
                      {formatSignedSeconds(
                        analysisStrategy.breakdown.pitLossSeconds,
                      )}
                    </strong>
                  </div>
                </div>
                <p className="cost-equation">
                  기준 주행 + 타이어 조정 − 연료 효과 + 피트 손실 ={" "}
                  <strong>{analysisStrategy.formattedTime}</strong>
                </p>
              </section>

              {pageView === "strategy" && workspace === "replay" && <Suspense fallback={<div className="replay-loading" role="status">3D 리플레이를 준비하고 있습니다…</div>}><RaceReplay
                key={`race-${calculationRevision}-${applied.trackId}-${stintSignature(
                  replayStrategy.stints,
                )}-${stintSignature(replayReference.stints)}`}
                trackId={applied.trackId}
                track={appliedTrack}
                strategy={replayStrategy}
                strategyLabel={replayStrategyLabel}
                referenceStrategy={replayReference}
                referenceLabel={replayReferenceLabel}
                team={selectedTeam}
                driver={selectedDriver}
                gridStrategies={results}
                optimalStrategy={best}
                startingGridPosition={applied.startingGridPosition}
                trafficLevel={applied.trafficLevel}
                entryContext={{ teamId: applied.teamId, driverId: applied.driverId, equalPerformance: applied.equalPerformance }}
                experimentTimeline={raceExperiment?.eventTimelines[experimentTrial] ?? null}
                onOpenSetup={openScenarioSetup}
                onEditStrategy={() => {
                  setWorkspace("manual");
                  document
                    .getElementById("manual-strategy")
                    ?.scrollIntoView({
                      behavior: "smooth",
                      block: "start",
                    });
                }}
                onOpenAnalysis={() => {
                  setWorkspace("detail");
                  document
                    .getElementById("detail-analysis")
                    ?.scrollIntoView({
                      behavior: "smooth",
                      block: "start",
                    });
                }}
              /></Suspense>}
              {pageView === "strategy" && workspace === "replay" && <details className="panel replay-lap-details"><summary>자세히 보기 · 선택 전략 랩타임</summary><LapTimeChart strategy={replayStrategy} /></details>}

              {workspace === "notebook" && <ExperimentNotebook currentSnapshot={analysisStrategy.isLegal ? {
                trackId: applied.trackId,
                trackName: appliedTrack.koreanName,
                laps: appliedTrack.laps,
                modelSource: applied.modelSource,
                pitLossSeconds: applied.pitLossSeconds,
                degradationPercent: applied.degradationPercent,
                trackTemperatureC: applied.trackTemperatureC,
                maxStops: applied.maxStops,
                modeLabel: analysisMode === "manual" ? "직접 설계" : `추천 후보 ${selectedTopThree.rank}`,
                strategy: analysisStrategy,
              } : null} />}

            </div>
          </div>
        </section>

        <section
          className="data-analysis-section section-shell"
          id="data-analysis"
          aria-labelledby="data-analysis-title"
          hidden={pageView !== "data"}
        >
          <PerformanceEvidencePanel selectedDriverId={applied.driverId} equalPerformance={applied.equalPerformance} />
          <p className="weather-model-summary">프로젝트 추정 · 현재 팀 페이스 +{entryProfile.teamPaceSeconds.toFixed(3)}초/랩 (관측 확보 팀 중 최속 기준 0), 팀·선수 합산 열화 {entryProfile.wearMultiplier.toFixed(4)}배. {entryProfile.team.explanation}</p>
          <WetEvidencePanel />
          {pageView === "data" && <Suspense fallback={<p role="status">관측 자료를 불러오는 중…</p>}><HistoricalEvidencePanel appliedTrackId={applied.trackId} onApply={applyHistoricalCalibration} /></Suspense>}
        </section>

        <section
          className="method-section section-shell"
          id="algorithm"
          aria-labelledby="algorithm-title"
          hidden={pageView !== "method"}
        >
          <div className="section-heading section-heading--light">
            <div>
              <p className="eyebrow">03 · 계산 원리</p>
              <h2 id="algorithm-title">알고리즘을 숨기지 않습니다</h2>
            </div>
            <p>
              compound의 결과는 AI 문장이 아니라, 공개된 비용식과 제약조건을
              같은 순서로 계산한 값입니다.
            </p>
          </div>

          <div className="formula-card">
            <div>
              <span>한 랩의 예상시간 · 모델 추정</span>
              <code>
                LapTime(l,c,a) = B + Δ<sub>c</sub> + α<sub>c</sub>a + β
                <sub>c</sub>a² + Θ(c,a,T<sub>s</sub>,v) + W(c,w,d) − γ(l−1)
              </code>
            </div>
            <p>
              기준 페이스(B)에 컴파운드 차이(Δ), 타이어 나이(a)에 따른
              1·2차 열화, 노면 온도(Ts)와 서킷 부담도(v)로 계산한
              워밍업·그레이닝·과열·성능 절벽 비용(Θ), 연료 감소
              효과(γ)를 합산합니다. 피트한 경우에는 서킷별 고정 손실을
              한 번 추가합니다. 직접 설계한 전략도 이 동일한 비용식으로
              별도 평가합니다. W는 랩별 수막(w)과 현재 세트의 이전 건조 랩 수(d)에
              따른 우천 페널티입니다. INTER·WET에는 건식 상태 비용 Θ 대신 과열
              누적 비용을 사용합니다. 날씨 일정이 같으면 비용도 같으며 SC·교통의
              확률 실험은 이 결정론 DP와 별도로 실행합니다.
            </p>
          </div>

          <div className="method-flow" aria-label="DP 계산 흐름">
            {[
              {
                number: "01",
                title: "문제 정의",
                body: "전체 레이스의 예상 총시간을 최소화합니다.",
                code: "min Σ LapTime + PitLoss",
              },
              {
                number: "02",
                title: "상태 저장",
                body: "같은 상태에서 요청한 K개까지 빠른 경로를 보존합니다. 보드의 전역 1위는 K=1로 계산합니다.",
                code: "DP[l][c][a][mask][s][wet]",
              },
              {
                number: "03",
                title: "두 가지 선택",
                body: "현재 타이어로 계속 달리거나 새 타이어로 교체합니다.",
                code: "유지 / 교체 → S·M·H·INTER·WET",
              },
              {
                number: "04",
                title: "완주 후보 정렬",
                body: "전역 최적 1개를 유지하고 중복되지 않는 대표 대안 2개를 별도 탐색합니다. 대안은 전역 2·3위가 아닙니다.",
                code: "제약 확인 → 최적 1개 + 대표 대안",
              },
            ].map((step) => (
              <article key={step.number}>
                <span>{step.number}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
                <code>{step.code}</code>
              </article>
            ))}
          </div>

          <div className="algorithm-detail-grid">
            <article className="state-card">
              <span className="detail-label">계산 상태의 구성</span>
              <h3>상태에 무엇을 기억하나?</h3>
              <dl>
                <div>
                  <dt>l</dt>
                  <dd>현재까지 완료한 랩</dd>
                </div>
                <div>
                  <dt>c</dt>
                  <dd>현재 컴파운드 S/M/H/INTER/WET</dd>
                </div>
                <div>
                  <dt>a</dt>
                  <dd>현재 타이어 사용 랩 수</dd>
                </div>
                <div>
                  <dt>mask</dt>
                  <dd>지금까지 사용한 건식 컴파운드 집합</dd>
                </div>
                <div>
                  <dt>s</dt>
                  <dd>누적 피트스톱 횟수</dd>
                </div>
                <div><dt>wet</dt><dd>INTER 또는 WET 실제 사용 여부 · 건식 2종 의무 면제 판정</dd></div>
              </dl>
            </article>

            <article className="pseudo-card">
              <span className="detail-label">의사코드</span>
              <h3>핵심 로직</h3>
              <pre>
                <code>{`각 랩의 모든 DP 상태에서:
  현재 타이어 유지 비용 계산
  스톱 여유가 있으면:
    허용된 5종 타이어로 교체 비용 계산
  동일 상태의 빠른 경로 K개 유지

실제 우천 타이어 사용 여부와 건식 2종 규칙 검사
원본 K-best 최적해 유지
순서 중복을 묶은 대표 대안 2개 탐색`}</code>
              </pre>
            </article>

            <article className="why-dp-card">
              <span className="detail-label">동적계획법을 쓰는 이유</span>
              <h3>당장 빠른 선택이 끝까지 빠르지는 않습니다.</h3>
              <p>
                소프트의 한 랩 이득만 보고 고르면 후반 열화와 추가
                피트스톱을 놓칠 수 있습니다. DP는 같은 상태에 도착한 누적
                비용을 비교해, 이후 선택에 필요 없는 느린 경로를
                제거합니다.
              </p>
              <div className="compare-paths">
                <span>
                  <i>S</i> 지금 빠름
                </span>
                <b>≠</b>
                <span>
                  <i>Σ</i> 완주까지 빠름
                </span>
              </div>
            </article>
          </div>
        </section>

        <section
          className="verification-section section-shell"
          id="verification"
          aria-labelledby="verification-title"
          hidden={pageView !== "method"}
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">04 · 알고리즘 검증</p>
              <h2 id="verification-title">정답보다 검증 가능한 과정</h2>
            </div>
            <p>
              아래 항목은 현재 브라우저에서 같은 계산 함수를 다시 실행해
              확인합니다. 통과하지 못한 항목은 따로 표시합니다.
            </p>
          </div>
          {pageView === "method" && sensitivity && (
            <>
              <ValidationPanel input={optimizerInput} results={results} />
              {pageView === "method" && <Suspense fallback={<p role="status">실제 경기 비교 자료를 불러오는 중…</p>}><StrategyBacktestPanel /></Suspense>}

              <section
                className={`sensitivity-card ${
                  sensitivity.stable ? "is-stable" : "is-sensitive"
                }`}
                aria-label="민감도 분석"
              >
                <div>
                  <span>
                    {sensitivity.stable ? "전략 유지" : "조건에 민감"}
                  </span>
                  <h3>열화율 ±10% 민감도</h3>
                </div>
                <p>
                  {sensitivity.stable
                    ? "열화율을 10% 낮추거나 높여도 추천 1위 전략이 유지됩니다."
                    : `열화율 가정이 바뀌면 1위 전략도 바뀝니다. 낮은 열화: ${
                        sensitivity.low
                          ? strategySequence(sensitivity.low)
                          : "계산 불가"
                      }, 높은 열화: ${
                        sensitivity.high
                          ? strategySequence(sensitivity.high)
                          : "계산 불가"
                      }.`}
                </p>
              </section>
            </>
          )}

          <div className="verification-note">
            <div>
              <span className="detail-label">검증 범위</span>
              <h3>구현 정확성과 모델 현실성은 다릅니다.</h3>
            </div>
            <p>
              완전탐색 대조는 코드가 정해진 비용식을 정확히 최소화하는지
              확인합니다. 데이터 분석 탭의 2023–2025년 21개 레이스는
              별도로 시간순 랩 예측 오차를 검증합니다. 두 검증 모두 실제
              순위나 실제 피트 전략이 정답임을 증명하지는 않습니다.
            </p>
          </div>
        </section>

        <section
          className="limits-section section-shell research-panel"
          id="research"
          aria-labelledby="research-title"
          hidden={pageView !== "research"}
        >
          <div className="research-overview">
            <div>
              <p className="eyebrow">01 · 서비스 소개</p>
              <h2 id="research-title">
                데이터 분석으로 구현한 타이어 전략 알고리즘
              </h2>
            </div>
            <p>
              실제 팀 시스템을 재현하는 대신 공개 자료와 설명 가능한
              비용식으로 전략을 생성하고 비교·검증하는 비공식·비영리
              시뮬레이터입니다.
            </p>
          </div>

          <div className="research-block-heading">
            <span>02 · 데이터 출처</span>
            <h3>현재 데이터와 다음 분석 단계</h3>
          </div>

          <div className="research-data-grid">
            <article>
              <span>현재 구현 범위</span>
              <h3>공개 메타데이터 + 선택형 실데이터 보정</h3>
              <p>
                2026 최초 공개 캘린더의 24개 개최지에 공식 랩 수·길이·
                코너 수를 반영했습니다. 바레인·제다는 취소 상태로
                표시하되 역사·가상 분석용으로 유지합니다. 재생 화면의
                24개 서킷 윤곽은 CC BY 4.0 공개 SVG를 사용합니다. 열화
                등급, 피트 손실과 대부분의 랩타임 계수는 알고리즘 시연용
                모델 추정값입니다. 7서킷의 2023–2025 실제 정제 랩에서
                학습 신뢰 기준을 통과한 컴파운드 계수를 적용하며,
                미수집 서킷은 같은 열화 등급의 가까운 서킷 대체값임을 표시합니다. 랩별 타이어
                온도·마모·그립은 공개 텔레메트리가 아닌 설명 가능한
                재현 가능한 추정 모델입니다.
              </p>
              <a
                href="https://www.fia.com/news/fia-and-formula-1-announce-2026-calendar"
                target="_blank"
                rel="noreferrer"
              >
                FIA 2026 캘린더 원안 ↗
              </a>
            </article>
            <article>
              <span>실측 분석 자료</span>
              <h3>FastF1 2023–2025 · 7서킷 21경기</h3>
              <p>
                실제 결승 세션 {FASTF1_ANALYSIS_SUMMARY.rawLaps.toLocaleString()}
                랩을 시작으로 건식·녹색기·정확 랩과 정상 스틴트를
                선별했습니다. 최종{" "}
                {FASTF1_ANALYSIS_SUMMARY.modelLaps.toLocaleString()}랩·
                {FASTF1_ANALYSIS_SUMMARY.stints}개 스틴트로 서킷별 타이어
                열화 효과를 추정하고, 각 스틴트의 뒤 25%를 시간 순서대로
                검증했습니다.
              </p>
              <button
                type="button"
                onClick={() => selectPageView("data")}
              >
                데이터 분석 결과 보기 →
              </button>
            </article>
            <article className="research-data-grid__wide">
              <span>3D 모델 출처</span>
              <h3>전략 계산과 분리된 레이스 시각화</h3>
              <p>
                플레이어 차량은 {PLAYER_RACE_CAR_ASSET.creator}의{" "}
                “{PLAYER_RACE_CAR_ASSET.title}”에{" "}
                {PLAYER_RACE_CAR_ASSET.modifications}를 적용했습니다.
                상대 차량은 {RACE_CAR_ASSET.creator}의{" "}
                “{RACE_CAR_ASSET.title}”을 경량 모델로 유지합니다. 두
                자산은 자동 주행 화면에만 사용되며 타이어 전략의
                랩타임·열화·피트 손실 계산에는 영향을 주지 않습니다.
              </p>
              <div className="research-data-links">
                <a
                  href={PLAYER_RACE_CAR_ASSET.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  플레이어 모델 ·{" "}
                  {PLAYER_RACE_CAR_ASSET.licenseLabel} ↗
                </a>
                <a
                  href={RACE_CAR_ASSET.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  상대 차량 원본 · {RACE_CAR_ASSET.licenseLabel} ↗
                </a>
              </div>
            </article>
            <article className="research-data-grid__wide">
              <span>서킷 시각화 참고 자료</span>
              <h3>실제 서킷 특성을 구분한 주행 환경</h3>
              <p>
                공식 F1 게임의 시각 재현 기준을 참고해 아스팔트 러버 라인,
                연석·런오프, 배리어와 캐치펜스, 브레이킹 보드, 피트 시설을
                공통 안전 요소로 구성했습니다. 24개 서킷은 실제 개최지에
                맞춰 공원·상설·사막·도심·마리나·산악·스타디움 환경과
                대표 랜드마크를 각각 적용합니다. 이 배경 역시 전략 계산과
                분리된 시각화 계층입니다.
              </p>
              <div className="research-data-links">
                <a
                  href="https://www.ea.com/games/f1/f1-25/news/f1-25-advancements-deep-dive"
                  target="_blank"
                  rel="noreferrer"
                >
                  EA SPORTS F1 25 서킷 재현 기준 ↗
                </a>
                <a
                  href="https://www.fia.com/circuit-safety"
                  target="_blank"
                  rel="noreferrer"
                >
                  FIA 서킷 안전 기준 ↗
                </a>
              </div>
            </article>
          </div>

          <ol className="data-pipeline" aria-label="데이터 분석 단계">
            <li className="is-ready">
              <span>01</span>
              <div>
                <strong>맥락 데이터</strong>
                <small>F1 2026 서킷 공식 제원</small>
              </div>
            </li>
            <li className="is-ready">
              <span>02</span>
              <div>
                <strong>프로토타입</strong>
                <small>설명 가능한 가정 계수</small>
              </div>
            </li>
            <li className="is-ready">
              <span>03</span>
              <div>
                <strong>계수 추정</strong>
                <small>
                  21개 레이스 {FASTF1_ANALYSIS_SUMMARY.modelLaps.toLocaleString()}
                  랩
                </small>
              </div>
            </li>
            <li className="is-ready">
              <span>04</span>
              <div>
                <strong>시간순 검증</strong>
                <small>각 스틴트 후반 25% 홀드아웃</small>
              </div>
            </li>
          </ol>

          <div className="section-heading">
            <div>
              <p className="eyebrow">03 · 모델 가정</p>
              <h2 id="assumptions-title">계산을 위해 고정한 가정</h2>
            </div>
            <p>
              모든 후보 전략을 같은 기준으로 비교하기 위해 아래 조건을
              공통으로 적용합니다.
            </p>
          </div>

          <div className="model-assumption">
            <span aria-hidden="true">!</span>
            <p>
              <strong>모든 타이어는 새 세트로 시작한다고 가정합니다.</strong>
              첫 주행 랩의 타이어 나이는 0이며, 피트 후에는 0으로
              초기화됩니다. 연료 효과는 피트 후에도 전체 레이스 랩을
              기준으로 이어집니다. 타이어 온도는 이전 랩의 난수가 아니라
              컴파운드·사용 랩·노면 온도·서킷 부담도의 폐쇄형 식으로
              계산합니다.
            </p>
          </div>

          <div className="section-heading research-limits-heading">
            <div>
              <p className="eyebrow">04 · 적용 범위와 한계</p>
              <h2 id="limits-title">이 모델이 말하는 것, 말하지 않는 것</h2>
            </div>
            <p>
              기본 결과는 지정한 강수 조건에서 교통을 제외한 비용식으로 전략을
              비교한 값입니다.
            </p>
          </div>

          <div className="limits-grid">
            <article className="limit-card limit-card--included">
              <span>반영 항목</span>
              <h3>계산에 반영</h3>
              <ul>
                <li>S/M/H/인터/웨트의 초기 성능·수막 불일치 비용</li>
                <li>타이어 나이에 따른 1차·2차 열화</li>
                <li>워밍업·온도·그립·그레이닝·과열·성능 급락 추정</li>
                <li>랩이 지날수록 감소하는 연료 효과</li>
                <li>서킷별 고정 피트 손실</li>
                <li>모델 탐색 범위: 건식 최대 2스톱·우천 최대 3스톱</li>
                <li>건식 2종 조건 · 인터/웨트 실제 사용 시 면제</li>
                <li>실제 서킷 윤곽 위 선택 전략 랩·피트 이벤트 재생</li>
                <li>20대 성능 추정치와 결정론적 교통·더블스택 보정</li>
                <li>고정 시드 300회 SC/VSC·교통 후보 비교 실험</li>
              </ul>
            </article>

            <article className="limit-card limit-card--excluded">
              <span>미반영 항목</span>
              <h3>이번 버전에서 제외</h3>
              <ul>
                <li>실측 강수량·수막 깊이, 실제 타이어 센서 온도·압력</li>
                <li>SC/VSC 실제 대열 압축·주행 지연, 적기, 사고와 차량 고장</li>
                <li>실제 추월·충돌·더티에어 물리</li>
                <li>팀 내부의 실제 차량 셋업과 드라이버 주행 입력</li>
                <li>상대 팀의 실시간 대응 전략</li>
                <li>피트 실수와 개별 타이어 세트 상태</li>
                <li>섹터별 물리, 실제 피트레인 경로와 GPS 차량 위치</li>
              </ul>
            </article>

            <article className="limit-card limit-card--meaning">
              <span>결과 해석</span>
              <h3>결과의 올바른 의미</h3>
              <p>
                최적화 점수는 클린에어 타이어 모델로 비교합니다. 20대 레이스
                화면에는 재현 가능한 고정 그리드 간격·교통·더블스택 보정만
                더하며, 같은 입력은 언제나 같은 결과를 냅니다. 실제 경기의
                우승을 예측한다는 뜻은 아닙니다.
              </p>
              <div>
                <strong>규정 표기</strong>
                <span>
                  FIA 인증 아님 · 모델 내부 기본 건식 규칙 판정
                </span>
              </div>
            </article>
          </div>
        </section>
      </main>

      {raceSetupOpen && (
        <div
          className="race-setup-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="race-setup-title"
        >
          <button
            type="button"
            className="race-setup-modal__backdrop"
            aria-label="레이스 설정 닫기"
            tabIndex={-1}
            onClick={closeScenarioSetup}
          />
          <section
            className="race-setup-modal__panel"
            ref={setupPanelRef}
            style={{
              "--apex": draftTeam.primary,
              "--apex-dark": draftTeam.secondary,
              "--team-primary": draftTeam.primary,
              "--team-secondary": draftTeam.secondary,
              "--team-on-primary": draftTeam.onPrimary,
              "--participant-accent": draftTeam.primary,
              "--participant-accent-2": draftTeam.secondary,
              "--participant-on-accent": draftTeam.onPrimary,
            } as CSSProperties}
          >
            <header>
              <div>
                <span>레이스 조건 설정</span>
                <h2 id="race-setup-title">그리드에 들어가기 전 설정</h2>
                <p>
                  팀·선수 능력치를 타이어 전략 비용에 기본 반영합니다. EA 게임 점수는 공식 자료이며, 초·열화·우천 배수로의 변환은 프로젝트 추정입니다. 상단 동일 성능 모드로 끌 수 있습니다.
                </p>
              </div>
              <button
                type="button"
                aria-label="레이스 설정 닫기"
                onClick={closeScenarioSetup}
              >
                ×
              </button>
            </header>

            <div className="race-setup-modal__body">
              <div className="race-setup-modal__visual">
                <div>
                  <span>{draftDriver.code}</span>
                  <strong>{draftDriver.number}</strong>
                  <h3>
                    {uiLabel(draftDriver.firstName)}{" "}
                    {uiLabel(draftDriver.lastName)}
                  </h3>
                  <p>{uiLabel(draftTeam.name)} · 2026 참가자</p>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={publicAsset(draftTeam.carImage.src)}
                  alt={draftTeam.carImage.alt}
                />
              </div>

              <div className="race-setup-modal__form">
                <div className="race-setup-modal__selects">
                  <label>
                    <span>서킷</span>
                    <select
                      aria-label="서킷"
                      value={draft.trackId}
                      onChange={(event) =>
                        handleTrackChange(
                          event.target.value as TrackPresetId,
                        )
                      }
                    >
                      {TRACK_PRESET_IDS.map((trackId) => {
                        const track = TRACK_PRESETS[trackId];
                        return (
                          <option value={trackId} key={trackId}>
                            {track.koreanName} · {track.laps}랩
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <label>
                    <span>팀</span>
                    <select
                      aria-label="팀"
                      value={draftTeam.id}
                      onChange={(event) => {
                        const nextTeamId = event.target.value as TeamId;
                        setDraftTeamId(nextTeamId);
                        setDraftDriverId(findTeamProfile(nextTeamId).drivers[0].id);
                      }}
                    >
                      {TEAM_PROFILES.map((candidate) => (
                        <option value={candidate.id} key={candidate.id}>
                          {uiLabel(candidate.name)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>드라이버</span>
                    <select
                      aria-label="드라이버"
                      value={draftDriver.id}
                      onChange={(event) =>
                        setDraftDriverId(event.target.value)
                      }
                    >
                      {draftTeam.drivers.map((candidate) => (
                        <option value={candidate.id} key={candidate.id}>
                          {uiLabel(candidate.firstName)} {uiLabel(candidate.lastName)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <WeatherControls value={draft.weather} laps={draftTrack.laps} temperatureC={draft.trackTemperatureC} onChange={weather => setDraft(current => ({ ...current, weather, maxStops: weather.preset === "none" && current.maxStops === MODEL_PARAMS.weather.maxStops ? 2 : current.maxStops }))} />
                <div className="race-setup-modal__conditions">
                  <label className="race-setup-modal__condition-wide">
                    <span>
                      노면 온도
                      <b>{draft.trackTemperatureC}°C</b>
                    </span>
                    <input
                      type="range"
                      min="10"
                      max="60"
                      step="1"
                      value={draft.trackTemperatureC}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          trackTemperatureC: Number(event.target.value),
                        }))
                      }
                    />
                  </label>

                  <label className="race-setup-modal__grid-input">
                    <span>예상 스타팅 그리드</span>
                    <span>
                      <b>P</b>
                      <input
                        type="number"
                        min="1"
                        max="20"
                        step="1"
                        value={draft.startingGridPosition}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            startingGridPosition: Math.min(
                              20,
                              Math.max(1, Number(event.target.value)),
                            ),
                          }))
                        }
                        aria-label="예상 스타팅 그리드"
                      />
                    </span>
                  </label>

                  <fieldset className="race-setup-modal__condition-wide">
                    <legend>예상 트래픽</legend>
                    {TRAFFIC_LEVELS.map((level) => (
                      <label key={`modal-traffic-${level.id}`} title={level.description}>
                        <input
                          type="radio"
                          name="modal-traffic-level"
                          checked={draft.trafficLevel === level.id}
                          onChange={() =>
                            setDraft((current) => ({
                              ...current,
                              trafficLevel: level.id,
                            }))
                          }
                        />
                        <span>{level.label}</span>
                      </label>
                    ))}
                  </fieldset>

                  <fieldset>
                    <legend>전략 탐색 범위</legend>
                    {([1, 2, ...(draft.weather.preset !== "none" ? [MODEL_PARAMS.weather.maxStops] : [])] as StopCount[]).map((stops) => (
                      <label key={`modal-${stops}`}>
                        <input
                          type="radio"
                          name="modal-max-stops"
                          checked={draft.maxStops === stops}
                          onChange={() =>
                            setDraft((current) => ({
                              ...current,
                              maxStops: stops,
                            }))
                          }
                        />
                        <span>{stops}회 교체</span>
                      </label>
                    ))}
                  </fieldset>
                  <label>
                    <span>
                      타이어 열화
                      <b>{draft.degradationPercent}%</b>
                    </span>
                    <input
                      type="range"
                      min="70"
                      max="140"
                      value={draft.degradationPercent}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          degradationPercent: Number(
                            event.target.value,
                          ),
                        }))
                      }
                    />
                  </label>
                  <label>
                    <span>
                      피트 손실
                      <b>{draft.pitLossSeconds.toFixed(1)}초</b>
                    </span>
                    <input
                      type="range"
                      min="16"
                      max="30"
                      step="0.1"
                      value={draft.pitLossSeconds}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          pitLossSeconds: Number(event.target.value),
                        }))
                      }
                    />
                  </label>
                  <fieldset className="race-setup-modal__condition-wide">
                    <legend>타이어 열화 계수 출처</legend>
                    <label>
                      <input
                        type="radio"
                        name="modal-model-source"
                        checked={draft.modelSource === "project"}
                        onChange={() =>
                          setDraft((current) => ({
                            ...current,
                            modelSource: "project",
                          }))
                        }
                      />
                      <span>가정 기반 모델</span>
                    </label>
                    <label
                      title={
                        historicalCalibrationForTrack(draft.trackId)
                          ? getHistoricalCalibration(draft.trackId).summaryKorean
                          : "이 서킷은 아직 실제 데이터 보정 사례가 없습니다."
                      }
                    >
                      <input
                        type="radio"
                        name="modal-model-source"
                        checked={draft.modelSource === "fastf1-2025"}
                        disabled={
                          historicalCalibrationForTrack(draft.trackId) === null
                        }
                        onChange={() =>
                          setDraft((current) => configForTrack({ ...current, modelSource: "fastf1-2025" }, current.trackId))
                        }
                      />
                      <span>2023–2025 관측 기반 보정</span>
                    </label>
                  </fieldset>

                  <details className="race-setup-modal__advanced">
                    <summary>고급 환경 보정</summary>
                    <div>
                      <label>
                        <span>기온 <b>{draft.airTemperatureC}°C</b></span>
                        <input
                          type="range"
                          min="0"
                          max="45"
                          step="1"
                          value={draft.airTemperatureC}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              airTemperatureC: Number(event.target.value),
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>습도 <b>{draft.humidityPercent}%</b></span>
                        <input
                          type="range"
                          min="20"
                          max="100"
                          step="1"
                          value={draft.humidityPercent}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              humidityPercent: Number(event.target.value),
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>
                          연료 감소 효과
                          <b>{draft.fuelGainSecondsPerLap.toFixed(3)}초/랩</b>
                        </span>
                        <input
                          type="range"
                          min="0.02"
                          max="0.08"
                          step="0.001"
                          value={draft.fuelGainSecondsPerLap}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              fuelGainSecondsPerLap: Number(event.target.value),
                            }))
                          }
                        />
                      </label>
                    </div>
                  </details>
                </div>
              </div>
            </div>

            <footer>
              <p>
                {draftTrack.koreanName} · {draftTrack.laps}랩 ·{" "}
                {draftTrack.circuitLengthKm.toFixed(3)} km · 공식 제원
              </p>
              <div>
                <button
                  type="button"
                  onClick={closeScenarioSetup}
                >
                  닫기
                </button>
                <button
                  type="button"
                  className="is-primary"
                  onClick={() => {
                    applyConfiguration(draft, draftDriver);
                    setTeamId(draftTeam.id);
                    setDriverId(draftDriver.id);
                    setRaceSetupOpen(false);
                  }}
                >
                  {dirty ? "계산하고 그리드 적용" : "설정 적용"}
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}

      <footer className="footer" hidden={pageView !== "research"}>
        <div className="section-shell footer__inner">
          <div>
            <a className="brand brand--footer" href="#top">
              <span className="brand__mark">c</span>
              <span>
                compound
                <small>타이어 전략 분석</small>
              </span>
            </a>
            <p>
              공개 데이터를 분석해 타이어 전략을 계산하고 비교하는
              시뮬레이터입니다.
            </p>
          </div>
          <dl>
            <div>
              <dt>계산 모델</dt>
              <dd>{STRATEGY_MODEL_VERSION}</dd>
            </div>
            <div>
              <dt>데이터 출처</dt>
              <dd>FastF1 정제 랩 · 모델 추정값</dd>
            </div>
            <div>
              <dt>모델 범위</dt>
              <dd>S/M/H/인터/웨트 · 건식 최대 2회·우천 최대 3회 · 프로젝트 범위</dd>
            </div>
          </dl>
          <p className="footer__disclaimer">
            F1 및 각 팀과 제휴하지 않은 비공식·비영리
            시뮬레이터입니다. 상단 드라이버 이미지는 Formula1.com 프로필,
            차량은 Formula1.com의 2026 공식 투명 렌더를 사용하며 각 차량
            카드에서 원본 출처를 확인할 수 있습니다. 서킷 윤곽은 Jules
            Roy의 f1-circuits-svg(CC BY 4.0)를 사용합니다. 3D 자동
            레이스의 플레이어 차량은{" "}
            {PLAYER_RACE_CAR_ASSET.creator}의 모델(CC BY 4.0), 상대
            차량은 {RACE_CAR_ASSET.creator}의{" "}
            “{RACE_CAR_ASSET.title}”을 수정해 사용합니다.
          </p>
        </div>
      </footer>
    </div>
  );
}
