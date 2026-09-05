"use client";

import { useMemo, useState } from "react";
import {
  OBSERVED_BACKTEST_EVENTS,
  runStrategyBacktest,
  type ObservedStint,
} from "./lib/strategy-backtest";
import type { StrategyStintInput } from "./lib/strategy";

const COMPOUND_LABEL = { S: "SOFT", M: "MEDIUM", H: "HARD" } as const;

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
        <span>{stints.length - 1} STOP</span>
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
              style={{ width: `${(length / laps) * 100}%` }}
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
        PIT {stints.slice(0, -1).map((item) => `L${item.endLap}`).join(" · ")}
      </p>
    </article>
  );
}

export default function StrategyBacktestPanel() {
  const [eventIndex, setEventIndex] = useState(0);
  const [driverIndex, setDriverIndex] = useState(0);
  const event = OBSERVED_BACKTEST_EVENTS[eventIndex];
  const driver = event.drivers[Math.min(driverIndex, event.drivers.length - 1)];
  const result = useMemo(
    () => runStrategyBacktest(event, driver),
    [event, driver],
  );

  return (
    <section className="strategy-backtest" aria-labelledby="backtest-title">
      <header className="strategy-backtest__header">
        <div>
          <span className="detail-label">ACTUAL STRATEGY BACKTEST</span>
          <h3 id="backtest-title">실제 전략을 알고리즘에 다시 넣어보기</h3>
        </div>
        <p>
          2025년 3개 경기 상위 3명의 관측 전략을 같은 비용 함수로 재평가합니다.
          실제 완주 시간이나 선수 실력을 정답으로 사용하지 않습니다.
        </p>
      </header>

      <div className="backtest-event-tabs" role="tablist" aria-label="백테스트 경기">
        {OBSERVED_BACKTEST_EVENTS.map((item, index) => (
          <button
            type="button"
            role="tab"
            aria-selected={eventIndex === index}
            className={eventIndex === index ? "is-active" : ""}
            onClick={() => {
              setEventIndex(index);
              setDriverIndex(0);
            }}
            key={item.id}
          >
            <b>{item.label}</b>
            <span>{item.circuit} · {item.raceLaps}랩</span>
          </button>
        ))}
      </div>

      <div className="backtest-driver-tabs" aria-label="드라이버 선택">
        {event.drivers.map((item, index) => (
          <button
            type="button"
            className={driverIndex === index ? "is-active" : ""}
            onClick={() => setDriverIndex(index)}
            key={item.code}
          >
            <b>{item.code}</b>
            <span>{item.name} · P{item.finish}</span>
          </button>
        ))}
      </div>

      <div className="backtest-metrics">
        <article><span>실제 완주 순위</span><strong>P{driver.finish}</strong><small>참고 정보</small></article>
        <article><span>모델 내 동일 전략</span><strong>{result.modelRank ? `#${result.modelRank}` : "20+"}</strong><small>탐색 상위 20개 기준</small></article>
        <article><span>모델 최적 대비</span><strong>+{result.deltaToBestSeconds.toFixed(2)}s</strong><small>모델 비용 차이</small></article>
        <article><span>피트스톱</span><strong>{result.observed.stopCount} vs {result.best.stopCount}</strong><small>관측 / 모델 1위</small></article>
      </div>

      <div className="backtest-comparison">
        <StrategyTimeline title={`${driver.code} 관측 전략`} stints={driver.stints} laps={event.raceLaps} observed />
        <StrategyTimeline title="모델 최적 전략" stints={result.best.stints} laps={event.raceLaps} />
      </div>

      <div className="backtest-bottom">
        <article className="backtest-ranking">
          <header><h4>모델 추천 Top 3</h4><span>Δ BEST</span></header>
          {result.alternatives.slice(0, 3).map((item) => (
            <div key={item.signature}>
              <b>#{item.rank}</b>
              <span>{item.stints.map((stint) => `${stint.compound} ${stint.laps}L`).join(" → ")}</span>
              <strong>+{(item.totalSeconds - result.best.totalSeconds).toFixed(2)}s</strong>
            </div>
          ))}
        </article>
        <aside className="backtest-method">
          <h4>이 숫자의 의미</h4>
          <p>
            컴파운드와 교체 랩만 바꾼 반사실적 비교입니다. 교통, 세이프티카,
            드라이버 페이스는 제외했습니다. 실제 중고 타이어는 표시하지만 현재
            비용 함수는 새 세트로 정규화하므로 결과 해석의 한계입니다.
          </p>
          <div>
            <a href={result.sourceUrl} target="_blank" rel="noreferrer">F1 경기 출처 ↗</a>
            <a href={result.documentationUrl} target="_blank" rel="noreferrer">FastF1 문서 ↗</a>
          </div>
        </aside>
      </div>
    </section>
  );
}
