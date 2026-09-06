import {
  evaluateStrategy,
  optimizeTyreStrategies,
  TRACK_PRESETS,
  type Compound,
  type StrategyEvaluation,
  type StrategyOptimizerInput,
  type StrategyResult,
  type StrategyStintInput,
  type StopCount,
  type TrackPresetId,
} from "./strategy.ts";
import {
  analysisForTrack,
} from "./tyre-analysis.ts";
import backtestEvidence from "../data/backtest-evidence.json" with { type: "json" };
import { getHistoricalCalibration } from "./historical-calibration.ts";
import { MODEL_PARAMS } from "../model/params.ts";
import type { WeatherInput } from "./weather.ts";

export const BACKTEST_EVIDENCE = backtestEvidence;
type EvidenceEvent = (typeof backtestEvidence.events)[number];

export interface ObservedStint extends StrategyStintInput {
  readonly observedTyreLifeStart: number;
  readonly observedTyreLifeEnd: number;
}

export interface ObservedDriverPlan {
  readonly code: string;
  readonly name: string;
  readonly team: string;
  readonly finish: number;
  readonly stints: readonly ObservedStint[];
  readonly raceElapsedSeconds?: number | null;
  readonly gapToWinnerSeconds?: number | null;
  readonly lapTimeSumSeconds?: number | null;
}

export interface ObservedBacktestEvent {
  readonly id: string;
  readonly label: string;
  readonly circuit: string;
  readonly trackId: TrackPresetId;
  readonly raceLaps: number;
  readonly drivers: readonly ObservedDriverPlan[];
  readonly evidence?: EvidenceEvent;
}

const stint = (
  compound: Compound,
  startLap: number,
  endLap: number,
  observedTyreLifeStart = 1,
): ObservedStint =>
  Object.freeze({
    compound,
    startLap,
    endLap,
    observedTyreLifeStart,
    observedTyreLifeEnd: observedTyreLifeStart + endLap - startLap,
  });

const LEGACY_BACKTEST_EVENTS = Object.freeze([
  {
    id: "austria-2025",
    label: "2025 오스트리아 GP",
    circuit: "Red Bull Ring",
    trackId: "spielberg",
    raceLaps: 70,
    drivers: Object.freeze([
      { code: "NOR", name: "Lando Norris", team: "McLaren", finish: 1, stints: Object.freeze([stint("M", 1, 20), stint("H", 21, 52), stint("M", 53, 70)]) },
      { code: "PIA", name: "Oscar Piastri", team: "McLaren", finish: 2, stints: Object.freeze([stint("M", 1, 24), stint("H", 25, 53), stint("M", 54, 70)]) },
      { code: "LEC", name: "Charles Leclerc", team: "Ferrari", finish: 3, stints: Object.freeze([stint("M", 1, 25), stint("H", 26, 49), stint("M", 50, 70)]) },
    ]),
  },
  {
    id: "hungary-2025",
    label: "2025 헝가리 GP",
    circuit: "Hungaroring",
    trackId: "hungaroring",
    raceLaps: 70,
    drivers: Object.freeze([
      { code: "NOR", name: "Lando Norris", team: "McLaren", finish: 1, stints: Object.freeze([stint("M", 1, 31), stint("H", 32, 70, 2)]) },
      { code: "PIA", name: "Oscar Piastri", team: "McLaren", finish: 2, stints: Object.freeze([stint("M", 1, 18), stint("H", 19, 45, 2), stint("H", 46, 70)]) },
      { code: "RUS", name: "George Russell", team: "Mercedes", finish: 3, stints: Object.freeze([stint("M", 1, 19), stint("H", 20, 43), stint("H", 44, 70)]) },
    ]),
  },
  {
    id: "italy-2025",
    label: "2025 이탈리아 GP",
    circuit: "Monza",
    trackId: "monza",
    raceLaps: 53,
    drivers: Object.freeze([
      { code: "VER", name: "Max Verstappen", team: "Red Bull Racing", finish: 1, stints: Object.freeze([stint("M", 1, 37), stint("H", 38, 53)]) },
      { code: "NOR", name: "Lando Norris", team: "McLaren", finish: 2, stints: Object.freeze([stint("M", 1, 46), stint("S", 47, 53, 3)]) },
      { code: "PIA", name: "Oscar Piastri", team: "McLaren", finish: 3, stints: Object.freeze([stint("M", 1, 45), stint("S", 46, 53, 4)]) },
    ]),
  },
] satisfies readonly ObservedBacktestEvent[]);

/** Preserve the previously published nine plans, and attach newly collected timing evidence. */
export const OBSERVED_BACKTEST_EVENTS: readonly ObservedBacktestEvent[] = Object.freeze([
  ...LEGACY_BACKTEST_EVENTS.map((event): ObservedBacktestEvent => {
    const source = backtestEvidence.events.find((item) => item.id === event.id);
    return { ...event, evidence: source, drivers: event.drivers.map((driver) => ({ ...source?.drivers.find((item) => item.code === driver.code), ...driver })) };
  }),
  ...backtestEvidence.events.filter((source) => !LEGACY_BACKTEST_EVENTS.some((event) => event.id === source.id)).map((source): ObservedBacktestEvent => ({
    id: source.id, label: source.label, circuit: TRACK_PRESETS[source.trackId as TrackPresetId].name,
    trackId: source.trackId as TrackPresetId, raceLaps: source.raceLaps, evidence: source,
    drivers: source.drivers.map((driver) => ({ ...driver, stints: driver.stints.map((item) => ({ ...item, compound: item.compound as Compound })) })),
  })),
]);

const RULES = Object.freeze({
  minStops: 1 as const,
  maxStops: 2 as const,
  requireTwoDryCompounds: true,
  minStintLaps: 1,
});

export function createBacktestInput(
  event: ObservedBacktestEvent,
): StrategyOptimizerInput {
  const calibration = getHistoricalCalibration(event.trackId);
  const weather = approximateBacktestWeather(event);
  const observedMaxStops = Math.max(...event.drivers.map((driver) => driver.stints.length - 1));
  const maxStops = Math.min(MODEL_PARAMS.weather.maxStops, Math.max(RULES.maxStops, observedMaxStops, weather.preset === "none" ? RULES.maxStops : MODEL_PARAMS.weather.maxStops)) as StopCount;
  return {
    track: event.trackId,
    laps: event.raceLaps,
    // The baseline remains the declared circuit preset; never invert the actual total.
    baseLapTimeSeconds: TRACK_PRESETS[event.trackId].baseLapTimeSeconds,
    trackTemperatureC: event.evidence?.weather.meanTrackTemperatureC ?? undefined,
    compoundModels: calibration.compoundModels,
    pitLossSeconds: calibration.pitLossSeconds,
    weather,
    // Rain alone is not the exception: the core checks actual INTER/WET use.
    rules: { ...RULES, maxStops },
  };
}

/** Project approximation from observed rain flags and wet start, not inferred water-depth telemetry. */
export function approximateBacktestWeather(event: ObservedBacktestEvent): WeatherInput {
  const wet = event.evidence?.weather;
  if (!wet || wet.wetTyreLaps === 0) return { preset: "none" };
  const leader = event.drivers[0];
  const beginsWet = leader.stints[0]?.compound === "INTER" || leader.stints[0]?.compound === "WET";
  const rainLaps = wet.rainfallLapNumbers;
  const observedWetEnd = Math.max(1, ...leader.stints.filter((stint) => stint.compound === "INTER" || stint.compound === "WET").map((stint) => stint.endLap));
  const endLap = Math.min(event.raceLaps, rainLaps.length ? Math.max(...rainLaps) : observedWetEnd);
  return { preset: beginsWet ? "rain-to-dry" : "dry-to-rain", startLap: beginsWet ? 1 : Math.max(1, rainLaps[0] ?? leader.stints.find((stint) => stint.compound === "INTER" || stint.compound === "WET")?.startLap ?? 1), endLap, initialWater: beginsWet ? (MODEL_PARAMS.weather.interLower + MODEL_PARAMS.weather.interUpper) / 2 : MODEL_PARAMS.weather.defaultInitialWater };
}

function planKey(stints: readonly StrategyStintInput[]): string {
  return stints
    .map(({ compound, startLap, endLap }) => `${compound}:${startLap}-${endLap}`)
    .join("|");
}

export interface StrategyBacktestResult {
  readonly observed: StrategyEvaluation;
  readonly alternatives: readonly StrategyResult[];
  readonly best: StrategyResult;
  readonly modelRank: number | null;
  readonly deltaToBestSeconds: number;
  readonly sourceUrl: string;
  readonly documentationUrl: string;
  readonly actualRaceElapsedSeconds: number | null;
  readonly modelRaceElapsedSeconds: number;
  readonly modelMinusActualSeconds: number | null;
  readonly absoluteRaceErrorPercent: number | null;
  readonly comparableToOptimizer: boolean;
  readonly timingSourceUrl: string;
  readonly weatherInput: WeatherInput;
  readonly limitations: readonly string[];
}

const alternativesCache = new Map<string, readonly StrategyResult[]>();

export function runStrategyBacktest(
  event: ObservedBacktestEvent,
  driver: ObservedDriverPlan,
): StrategyBacktestResult {
  const input = createBacktestInput(event);
  const cacheKey = JSON.stringify(input);
  let alternatives = alternativesCache.get(cacheKey);
  if (!alternatives) {
    alternatives = Object.freeze(
      optimizeTyreStrategies({ ...input, topK: 20 }),
    );
    alternativesCache.set(cacheKey, alternatives);
  }
  const observed = evaluateStrategy({ ...input, stints: driver.stints });
  const observedKey = planKey(driver.stints);
  const match = alternatives.find(
    (candidate) => planKey(candidate.stints) === observedKey,
  );
  const analysis = analysisForTrack(event.trackId);
  const actualRaceElapsedSeconds = driver.raceElapsedSeconds ?? null;
  const modelMinusActualSeconds = actualRaceElapsedSeconds === null ? null : observed.totalSeconds - actualRaceElapsedSeconds;

  return Object.freeze({
    observed,
    alternatives: Object.freeze(alternatives),
    best: alternatives[0],
    modelRank: match?.rank ?? null,
    deltaToBestSeconds: observed.totalSeconds - alternatives[0].totalSeconds,
    sourceUrl: analysis?.source.raceSourceUrl ?? "https://www.formula1.com/",
    documentationUrl:
      analysis?.source.documentationUrl ?? "https://docs.fastf1.dev/",
    actualRaceElapsedSeconds,
    modelRaceElapsedSeconds: observed.totalSeconds,
    modelMinusActualSeconds,
    absoluteRaceErrorPercent: actualRaceElapsedSeconds === null || modelMinusActualSeconds === null ? null : Math.abs(modelMinusActualSeconds) / actualRaceElapsedSeconds * 100,
    comparableToOptimizer: observed.isLegal,
    timingSourceUrl: event.evidence?.source.timingUrl ?? "https://docs.fastf1.dev/",
    weatherInput: input.weather ?? { preset: "none" as const },
    limitations: [
      "실제 전체시간은 공식 우승자 시간+해당 선수 격차이며 SC/VSC·교통·재출발·선수 차이를 포함합니다. 현재 모형은 이 효과를 재현하지 않습니다.",
      "기준 랩타임은 서킷 가정값으로 유지하며 실제 완주 시간에 맞춰 역산하지 않습니다.",
      "서킷 계수의 학습 자료에 해당 2025년 경기 일부가 포함되어 있어 독립된 미학습 경기 검증은 아닙니다. 경기 전체시간 오차와 회귀 홀드아웃 오차를 구분해야 합니다.",
      "실제 중고 타이어 초기 수명은 표시하지만 계산은 새 세트로 정규화합니다.",
      ...(input.weather?.preset !== "none" ? ["강수 시작/끝과 초기 수막은 실제 Rainfall·우천 타이어 사용을 프로젝트 프리셋에 근사한 값입니다. 수막·그립 실측 재현이 아니며 레드플래그·SC 구간 오차를 보정하지 않습니다."] : []),
      ...(!observed.isLegal ? ["관측 전략이 모델 탐색의 스틴트 수명 또는 정차 제약을 벗어납니다. 최적 대비 수치는 동등한 조건의 우열이 아닙니다."] : []),
    ],
  });
}
