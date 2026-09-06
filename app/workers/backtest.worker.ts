import { OBSERVED_BACKTEST_EVENTS, runStrategyBacktest, type StrategyBacktestResult } from "../lib/strategy-backtest.ts";

export interface BacktestWorkerRequest {
  readonly requestId: number;
  readonly eventId: string;
}

export type BacktestWorkerResponse = BacktestWorkerRequest & (
  | { readonly status: "ready"; readonly results: Record<string, StrategyBacktestResult> }
  | { readonly status: "error"; readonly message: string }
);

interface BacktestWorkerScope {
  onmessage: ((event: MessageEvent<BacktestWorkerRequest>) => void) | null;
  postMessage: (message: BacktestWorkerResponse) => void;
}

const scope = globalThis as unknown as BacktestWorkerScope;

scope.onmessage = ({ data }) => {
  const { requestId, eventId } = data;
  try {
    const event = OBSERVED_BACKTEST_EVENTS.find(item => item.id === eventId);
    if (!event || !Number.isInteger(requestId)) throw new Error("유효하지 않은 백테스트 경기 요청입니다.");
    // The expensive optimizer runs once. All three drivers share its cached
    // alternatives, so switching drivers never repeats a wet-race search.
    const results = Object.fromEntries(event.drivers.map(driver => [driver.code, runStrategyBacktest(event, driver)]));
    scope.postMessage({ requestId, eventId, status: "ready", results });
  } catch (error) {
    scope.postMessage({ requestId, eventId, status: "error", message: error instanceof Error ? error.message : "백테스트 계산에 실패했습니다." });
  }
};
