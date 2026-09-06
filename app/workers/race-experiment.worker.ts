import { runRaceExperiments, type RaceExperimentOptions, type RaceExperimentResult } from "../lib/race-experiments.ts";
import type { StrategyEvaluation } from "../lib/strategy.ts";

export interface RaceExperimentWorkerRequest {
  readonly requestId: number;
  readonly candidates: readonly StrategyEvaluation[];
  readonly options: RaceExperimentOptions;
}
export type RaceExperimentWorkerResponse = { readonly requestId: number; readonly result: RaceExperimentResult; readonly error?: never }
  | { readonly requestId: number; readonly error: string; readonly result?: never };

self.onmessage = (event: MessageEvent<RaceExperimentWorkerRequest>) => {
  const requestId = event.data?.requestId;
  try {
    if (!Number.isSafeInteger(requestId) || requestId < 1) throw new RangeError("유효한 확률 실험 요청 ID가 필요합니다.");
    self.postMessage({ requestId, result: runRaceExperiments(event.data.candidates, event.data.options) } satisfies RaceExperimentWorkerResponse);
  } catch (error) {
    self.postMessage({ requestId, error: error instanceof Error ? error.message : "확률 실험 계산 실패" } satisfies RaceExperimentWorkerResponse);
  }
};
