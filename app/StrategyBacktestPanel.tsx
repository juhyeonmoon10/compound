"use client";

import { uiLabel } from "./ui-labels";
import { RAIN_LABELS, TYRE_COLORS, TYRE_LABELS } from "./model/params";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  OBSERVED_BACKTEST_EVENTS,
  type ObservedStint,
  type StrategyBacktestResult,
} from "./lib/strategy-backtest";
import { formatRaceTime, type StrategyStintInput } from "./lib/strategy";
import type { BacktestWorkerResponse } from "./workers/backtest.worker";

const COMPOUND_LABEL = TYRE_LABELS;

type BacktestSnapshot = {
  readonly phase: "idle" | "running" | "ready" | "cancelled" | "error" | "unsupported";
  readonly eventId: string | null;
  readonly results: Record<string, StrategyBacktestResult> | null;
  readonly message: string | null;
};

/** Kept independent of React so cancellation, stale replies and cache hits are testable. */
export function createBacktestController(createWorker: () => Worker | null) {
  let snapshot: BacktestSnapshot = { phase: "idle", eventId: null, results: null, message: null };
  let activeWorker: Worker | null = null;
  let generation = 0;
  const cache = new Map<string, Record<string, StrategyBacktestResult>>();
  const listeners = new Set<() => void>();
  const publish = (next: BacktestSnapshot) => {
    snapshot = Object.freeze(next);
    listeners.forEach(listener => listener());
  };
  const stop = () => {
    generation += 1;
    if (activeWorker) {
      activeWorker.onmessage = null;
      activeWorker.onerror = null;
      activeWorker.onmessageerror = null;
      activeWorker.terminate();
      activeWorker = null;
    }
  };
  const selectEvent = (eventId: string) => {
    stop();
    const cached = cache.get(eventId);
    if (cached) {
      publish({ phase: "ready", eventId, results: cached, message: null });
      return;
    }
    publish({ phase: "running", eventId, results: null, message: null });
    const requestId = generation;
    try {
      const worker = createWorker();
      if (!worker) {
        publish({ phase: "unsupported", eventId, results: null, message: "이 브라우저는 Web Worker를 지원하지 않아 백테스트를 계산할 수 없습니다. 최신 브라우저에서 열어 주세요. 화면을 멈추는 동기 계산은 실행하지 않습니다." });
        return;
      }
      activeWorker = worker;
      const current = () => generation === requestId && activeWorker === worker && snapshot.eventId === eventId;
      const fail = (message: string) => {
        if (!current()) return;
        stop();
        publish({ phase: "error", eventId, results: null, message });
      };
      worker.onmessage = ({ data }: MessageEvent<BacktestWorkerResponse>) => {
        if (!current()) return;
        if (!data || typeof data !== "object") {
          fail("백테스트 결과를 읽을 수 없습니다. 다시 계산해 주세요.");
          return;
        }
        if (data.requestId !== requestId || data.eventId !== eventId) return;
        if (data.status === "error") {
          fail(data.message);
          return;
        }
        if (data.status !== "ready" || !data.results || Array.isArray(data.results) || Object.keys(data.results).length === 0) {
          fail("백테스트 결과를 읽을 수 없습니다. 다시 계산해 주세요.");
          return;
        }
        cache.set(eventId, data.results);
        stop();
        publish({ phase: "ready", eventId, results: data.results, message: null });
      };
      worker.onerror = (error) => {
        error.preventDefault();
        fail(error.message || "백테스트 작업을 시작하지 못했습니다. 다시 계산해 주세요.");
      };
      worker.onmessageerror = () => fail("백테스트 결과 전송에 실패했습니다. 다시 계산해 주세요.");
      worker.postMessage({ requestId, eventId });
    } catch (error) {
      stop();
      publish({ phase: "error", eventId, results: null, message: error instanceof Error ? error.message : "백테스트 작업을 시작하지 못했습니다." });
    }
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    selectEvent,
    cancel: () => {
      if (snapshot.phase !== "running") return;
      stop();
      publish({ phase: "cancelled", eventId: snapshot.eventId, results: null, message: "계산을 취소했습니다. 다시 계산하거나 다른 경기를 선택할 수 있습니다." });
    },
    retry: () => { if (snapshot.eventId) selectEvent(snapshot.eventId); },
    dispose: stop,
  };
}

function StrategyTimeline({
  title,
  stints,
  laps,
  observed = false,
}: {
  title: string;
  stints: readonly (StrategyStintInput | ObservedStint)[];
  laps: number;
  observed?: boolean;
}) {
  return (
    <article className="backtest-timeline">
      <header>
        <h4>{title}</h4>
        <span>{stints.length - 1}회 교체</span>
      </header>
      <div className="backtest-timeline__bar">
        {stints.map((item, index) => {
          const length = item.endLap - item.startLap + 1;
          const tyreLife =
            observed && "observedTyreLifeStart" in item
              ? item.observedTyreLifeStart
              : 1;
          return (
            <div
              className={`backtest-stint is-${item.compound.toLowerCase()}`}
              style={{ width: `${(length / laps) * 100}%`, background: TYRE_COLORS[item.compound], color: item.compound === "WET" ? "#fff" : "#0a0c0a" }}
              key={`${item.compound}-${item.startLap}`}
              title={`${COMPOUND_LABEL[item.compound]} · L${item.startLap}–${item.endLap}`}
            >
              <b>{item.compound}</b>
              <span>L{item.startLap}–{item.endLap}</span>
              {tyreLife > 1 && <em>중고 +{tyreLife - 1}</em>}
              {index < stints.length - 1 && <i aria-hidden="true" />}
            </div>
          );
        })}
      </div>
      <p>
        피트 {stints.slice(0, -1).map((item) => `L${item.endLap}`).join(" · ")}
      </p>
    </article>
  );
}

export default function StrategyBacktestPanel() {
  const [eventIndex, setEventIndex] = useState(0);
  const [driverIndex, setDriverIndex] = useState(0);
  const event = OBSERVED_BACKTEST_EVENTS[eventIndex];
  const driver = event.drivers[Math.min(driverIndex, event.drivers.length - 1)];
  const [controller] = useState(() => createBacktestController(() =>
    typeof Worker === "undefined" ? null : new Worker(new URL("./workers/backtest.worker.ts", import.meta.url), { type: "module", name: "compound-backtest" }),
  ));
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    controller.selectEvent(event.id);
    return controller.dispose;
  }, [controller, event.id]);
  // Never render the previous event's result during the render before the effect.
  const currentSnapshot = snapshot.eventId === event.id ? snapshot : null;
  const result = currentSnapshot?.results?.[driver.code];
  const calculating = !currentSnapshot || currentSnapshot.phase === "running" || currentSnapshot.phase === "idle";

  return (
    <section className="strategy-backtest" aria-labelledby="backtest-title">
      <header className="strategy-backtest__header">
        <div>
          <span className="detail-label">실제 관측 전략 재검증</span>
          <h3 id="backtest-title">실제 전략을 알고리즘에 다시 넣어보기</h3>
        </div>
        <p>
          2025년 {OBSERVED_BACKTEST_EVENTS.length}개 경기 상위 3명의 관측 전략을 재평가합니다.
          실제 전체시간과의 오차도 공개하며, 실제 시간에 맞춰 기준 랩타임을 역산하지 않습니다.
        </p>
      </header>

      <div className="backtest-event-tabs" role="group" aria-label="백테스트 경기">
        {OBSERVED_BACKTEST_EVENTS.map((item, index) => (
          <button
            type="button"
            aria-pressed={eventIndex === index}
            className={eventIndex === index ? "is-active" : ""}
            onClick={() => {
              setEventIndex(index);
              setDriverIndex(0);
            }}
            key={item.id}
          >
            <b>{uiLabel(item.label)}</b>
            <span>{uiLabel(item.circuit)} · {item.raceLaps}랩{item.evidence?.weather.wetTyreLaps ? " · 우천" : " · 건식"}</span>
          </button>
        ))}
      </div>

      <div className="backtest-driver-tabs" role="group" aria-label="드라이버 선택">
        {event.drivers.map((item, index) => (
          <button
            type="button"
            aria-pressed={driverIndex === index}
            className={driverIndex === index ? "is-active" : ""}
            onClick={() => setDriverIndex(index)}
            key={item.code}
          >
            <b>{item.code}</b>
            <span>{uiLabel(item.name)} · P{item.finish}</span>
          </button>
        ))}
      </div>

      {!result && <div className="backtest-method" aria-busy={calculating} style={{ marginTop: 18 }}>
        <h4>{calculating ? "전략을 별도 작업에서 계산하고 있습니다" : currentSnapshot?.phase === "cancelled" ? "계산 취소됨" : "백테스트를 계산할 수 없습니다"}</h4>
        <p role={currentSnapshot?.phase === "error" ? "alert" : "status"} aria-live="polite">
          {calculating ? "우천·3회 교체 탐색은 수십 초 걸릴 수 있습니다. 화면은 계속 사용할 수 있으며 경기를 바꾸면 이전 계산을 중단합니다. 선수 변경은 같은 경기 계산을 공유합니다." : currentSnapshot?.message}
        </p>
        <div>
          {calculating && <button type="button" onClick={controller.cancel}>계산 취소</button>}
          {(currentSnapshot?.phase === "cancelled" || currentSnapshot?.phase === "error") && <button type="button" onClick={controller.retry}>다시 계산</button>}
        </div>
      </div>}

      {result && <>
      <div className="backtest-metrics">
        <article><span>실제 전체 경과시간</span><strong>{result.actualRaceElapsedSeconds === null ? "미확보" : formatRaceTime(result.actualRaceElapsedSeconds, 1)}</strong><small>공식 우승자 시간 + 격차 · 실제 P{driver.finish}</small></article>
        <article><span>관측 전략의 모델 전체시간</span><strong>{formatRaceTime(result.modelRaceElapsedSeconds, 1)}</strong><small>교체 {result.observed.stopCount}회 · 동일 페이스 모형</small></article>
        <article><span>실제 전체시간 대비 절대 오차</span><strong>{result.absoluteRaceErrorPercent === null ? "미확보" : `${result.absoluteRaceErrorPercent.toFixed(2)}%`}</strong><small>모델 − 실제 {result.modelMinusActualSeconds === null ? "미확보" : `${result.modelMinusActualSeconds >= 0 ? "+" : ""}${result.modelMinusActualSeconds.toFixed(1)}초`}</small></article>
        <article><span>모델 최적 대비</span><strong>{result.comparableToOptimizer ? `+${Math.max(0, result.deltaToBestSeconds).toFixed(2)}초` : "탐색 범위 밖"}</strong><small>{result.comparableToOptimizer ? `후보 상위 20개 중 ${result.modelRank ? `#${result.modelRank}` : "순위 밖"} · 실제 순위 예측 아님` : "모델 제약 밖 전략 · 동등 비교 불가"}</small></article>
      </div>

      <div className="backtest-comparison">
        <article className="backtest-method">
          <h4>관측 날씨 → 모델 입력</h4>
          <p>
            평균 노면 {event.evidence?.weather.meanTrackTemperatureC?.toFixed(1) ?? "미확보"}°C · 습도 {event.evidence?.weather.meanHumidityPercent?.toFixed(1) ?? "미확보"}%.
            전체 선수 랩 중 우천 타이어 {((event.evidence?.weather.wetTyreLapFraction ?? 0) * 100).toFixed(1)}%.
            {event.evidence?.weather.rainfallLapNumbers.length ? ` 강수 관측 ${event.evidence.weather.rainfallLapNumbers.length}개 랩.` : " 강수 true 관측 없음."}
            {` 모델 프리셋: ${RAIN_LABELS[result.weatherInput.preset]}.`}
            {result.weatherInput.preset !== "none" && ` L${result.weatherInput.startLap}–${result.weatherInput.endLap}의 연속 강수로 근사했습니다. 초기 수막 ${result.weatherInput.initialWater?.toFixed(2)}는 실측이 아닌 가정입니다.`}
          </p>
        </article>
        <article className="backtest-method">
          <h4>전체시간 오차를 읽기 전에</h4>
          <p>
            관측 상태 전환: SC {event.evidence?.raceControl.scSignalStarts ?? "미확보"}회 · VSC {event.evidence?.raceControl.vscSignalStarts ?? "미확보"}회 · 적기 {event.evidence?.raceControl.redFlagSignalStarts ?? "미확보"}회.
            이는 지속시간이 아닙니다. SC/VSC, 적기·재출발, 교통, 선수별 페이스를 현재 모형은 재현하지 않습니다.
            따라서 작은 오차도 전략 알고리즘의 정확도를 단독으로 증명하지 않습니다.
          </p>
        </article>
      </div>

      <div className="backtest-comparison">
        <StrategyTimeline title={`${driver.code} 관측 전략`} stints={driver.stints} laps={event.raceLaps} observed />
        <StrategyTimeline title="모델 최적 전략" stints={result.best.stints} laps={event.raceLaps} />
      </div>

      <div className="backtest-bottom">
        <article className="backtest-ranking">
          <header><h4>원본 K-best 상위 3개 · 동률·순서 차이 포함</h4><span>최단 대비</span></header>
          {result.alternatives.slice(0, 3).map((item) => (
            <div key={item.signature}>
              <b>#{item.rank}</b>
              <span>{item.stints.map((stint) => `${stint.compound} ${stint.laps}랩`).join(" → ")}</span>
              <strong>+{(item.totalSeconds - result.best.totalSeconds).toFixed(2)}초</strong>
            </div>
          ))}
        </article>
        <aside className="backtest-method">
          <h4>이 숫자의 의미</h4>
          {result.limitations.map(text => <p key={text}>{text}</p>)}
          <div>
            <a href={result.sourceUrl} target="_blank" rel="noreferrer">F1 경기 출처 ↗</a>
            <a href={result.timingSourceUrl} target="_blank" rel="noreferrer">공식 타이밍 원본 ↗</a>
            <a href={result.documentationUrl} target="_blank" rel="noreferrer">FastF1 문서 ↗</a>
          </div>
        </aside>
      </div>
      </>}
    </section>
  );
}
