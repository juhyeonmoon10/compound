import type { ExperimentResearchInfo } from "./experiment-notebook.ts";
import type { DriverPerformanceResolution } from "./driver-ratings.ts";
import type { RaceExperimentResult } from "./race-experiments.ts";
import type { StrategyEvaluation } from "./strategy.ts";
import type { WeatherInput } from "./weather.ts";

/** Snapshot only a matching completed experiment; never attach another plan's win rate. */
export function buildExperimentResearch(input: {
  weather: WeatherInput; seed: number; teamId: string; driverId: string;
  performanceEnabled: boolean; driver: DriverPerformanceResolution;
  strategy: StrategyEvaluation; isManual: boolean;
  experiment: RaceExperimentResult | null; trialIndex: number;
}): ExperimentResearchInfo {
  const signature = `${input.strategy.scenarioSignature}|${input.strategy.stints.map(stint => `${stint.compound}:${stint.startLap}-${stint.endLap}`).join("|")}`;
  const experiment = input.experiment?.seed === input.seed && !input.isManual ? input.experiment : null;
  const candidate = experiment?.candidates.find(value => value.signature === signature);
  const timeline = candidate ? experiment?.eventTimelines[input.trialIndex] : undefined;
  const summary = candidate && experiment ? [
    `${experiment.trials}회 · 시드 ${experiment.seed} · ${experiment.prior.sourceLabel}`,
    `SC ${experiment.eventSummary.scTrials}회 / VSC ${experiment.eventSummary.vscTrials}회 / 사건 없음 ${experiment.eventSummary.noEventTrials}회`,
    timeline ? `선택 시행 ${timeline.trial + 1}: ${timeline.events.map(event => `${event.kind} L${event.startLap}–${event.endLap}`).join(" · ") || "사건 없음"}` : "선택 시행 없음",
    "동일 후보의 확률 실험이며 3D 재생 시계에는 SC 감속이 반영되지 않습니다.",
  ].join("\n") : input.isManual ? "직접 설계 전략 · 해당 전략의 확률 실험은 실행하지 않음" : "현재 전략과 시드에 일치하는 확률 실험 미실행";
  return {
    weather: input.weather, seed: input.seed, teamId: input.teamId, driverId: input.driverId,
    performanceEnabled: input.performanceEnabled, scTimelineSummary: summary,
    ...(candidate && experiment ? { mc: { trials: experiment.trials, winRate: candidate.winRate,
      p10Seconds: candidate.p10Seconds, p90Seconds: candidate.p90Seconds } } : {}),
    ...(input.driver.ratings ? { eaRatings: { sourceUrl: input.driver.source.url,
      checkedAt: input.driver.source.checkedAt, iteration: input.driver.iteration.label,
      ratings: input.driver.ratings } } : {}),
  };
}
