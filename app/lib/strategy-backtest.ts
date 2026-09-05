import {
  evaluateStrategy,
  optimizeTyreStrategies,
  type Compound,
  type StrategyEvaluation,
  type StrategyOptimizerInput,
  type StrategyResult,
  type StrategyStintInput,
  type TrackPresetId,
} from "./strategy.ts";
import {
  analysisForTrack,
  historicalCalibrationForTrack,
} from "./tyre-analysis.ts";

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
}

export interface ObservedBacktestEvent {
  readonly id: string;
  readonly label: string;
  readonly circuit: string;
  readonly trackId: TrackPresetId;
  readonly raceLaps: number;
  readonly drivers: readonly ObservedDriverPlan[];
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

export const OBSERVED_BACKTEST_EVENTS = Object.freeze([
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

const RULES = Object.freeze({
  minStops: 1 as const,
  maxStops: 2 as const,
  requireTwoDryCompounds: true,
  minStintLaps: 1,
});

export function createBacktestInput(
  event: ObservedBacktestEvent,
): StrategyOptimizerInput {
  const analysis = analysisForTrack(event.trackId);
  const calibration = historicalCalibrationForTrack(event.trackId);
  return {
    track: event.trackId,
    laps: event.raceLaps,
    trackTemperatureC: analysis
      ? (analysis.summary.trackTempMinC + analysis.summary.trackTempMaxC) / 2
      : 35,
    compoundModels: calibration?.compoundModels,
    rules: RULES,
  };
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
}

const alternativesCache = new Map<string, readonly StrategyResult[]>();

export function runStrategyBacktest(
  event: ObservedBacktestEvent,
  driver: ObservedDriverPlan,
): StrategyBacktestResult {
  const input = createBacktestInput(event);
  let alternatives = alternativesCache.get(event.id);
  if (!alternatives) {
    alternatives = Object.freeze(
      optimizeTyreStrategies({ ...input, topK: 20 }),
    );
    alternativesCache.set(event.id, alternatives);
  }
  const observed = evaluateStrategy({ ...input, stints: driver.stints });
  const observedKey = planKey(driver.stints);
  const match = alternatives.find(
    (candidate) => planKey(candidate.stints) === observedKey,
  );
  const analysis = analysisForTrack(event.trackId);

  return Object.freeze({
    observed,
    alternatives: Object.freeze(alternatives),
    best: alternatives[0],
    modelRank: match?.rank ?? null,
    deltaToBestSeconds: observed.totalSeconds - alternatives[0].totalSeconds,
    sourceUrl: analysis?.source.raceSourceUrl ?? "https://www.formula1.com/",
    documentationUrl:
      analysis?.source.documentationUrl ?? "https://docs.fastf1.dev/",
  });
}
