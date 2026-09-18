"use client";

import { useMemo, useState } from "react";
import { StrategyBoardGraphic } from "./RaceBriefingOverview";
import { TRACK_PRESETS } from "./lib/strategy";
import { recommendHistoricalStrategies, STRATEGY_EXAMPLES, MATCH_LIMITS, WEATHER_KIND_LABELS, type HistoricalMatch, type RecommendationConditions } from "./lib/historical-recommendations";
import { TYRE_LABELS } from "./model/params";
import "./historical-recommendations.css";

const number = (value: number | null, suffix: string) => value === null ? "미확인" : `${value.toFixed(1)}${suffix}`;

export default function HistoricalStrategyRecommendations({ conditions, onUseStrategy, onChangeConditions }: {
  conditions: RecommendationConditions;
  onUseStrategy: (match: HistoricalMatch, mode: "manual" | "replay") => void;
  onChangeConditions: () => void;
}) {
  const result = useMemo(() => recommendHistoricalStrategies(conditions), [conditions]);
  const [selectedId, setSelectedId] = useState("");
  const selected = result.matches.find(match => match.id === selectedId) ?? result.matches[0];
  const selectedIndex = selected ? result.matches.indexOf(selected) : 0;
  const track = TRACK_PRESETS[conditions.trackId];
  return <section className="historical-recommendations" aria-labelledby="historical-recommendation-title">
    <header className="historical-recommendations__header">
      <div><span>실제 사용 기록 · 조건 유사도 순</span><h2 id="historical-recommendation-title">이 조건에서 참고할 실제 전략</h2>
        <p>{track.koreanName} · 출발 P{conditions.startingGridPosition} · 노면 {conditions.trackTemperatureC}°C · 기온 {conditions.airTemperatureC}°C · 습도 {conditions.humidityPercent}% · {WEATHER_KIND_LABELS[result.weatherKind]}</p></div>
      <button type="button" onClick={onChangeConditions}>조건 변경</button>
    </header>
    <p className="historical-recommendations__summary">같은 서킷 {result.circuitEvents}경기에서 {result.candidateCount}개 조건 일치 사례를 찾았습니다. 서로 다른 교체 계획 최대 3개를 보여줍니다. 우승 확률이나 최단 시간 순위가 아닙니다.</p>
    {result.reason && <p className="historical-recommendations__notice" role="status">{result.reason}</p>}
    {selected && <>
      <StrategyBoardGraphic track={track}
        results={result.matches.map(match => ({ stints: match.driver.stints, stopCount: match.driver.stints.length - 1, signature: match.id }))}
        pitWindows={[]} selectedRank={selectedIndex} topThreeActive pitLossSeconds={0} pitSource="실제 기록"
        observedLabels={result.matches.map(match => `${match.event.season} · ${match.driver.name} · P${match.driver.gridPosition} 출발 → P${match.driver.finishPosition} 완주 · ${match.event.raceLaps}랩`)}
        observedLaps={result.matches.map(match => match.event.raceLaps)}
        onSelectStrategy={index => setSelectedId(result.matches[index].id)} />
      <div className="historical-recommendations__cards" role="group" aria-label="실제 전략 사례 선택">
        {result.matches.map((match, index) => <button type="button" key={match.id} aria-pressed={match.id === selected.id} onClick={() => setSelectedId(match.id)}>
          <span>사례 {index + 1} · {match.event.season}</span><strong>{match.driver.name}</strong>
          <span>{match.driver.stints.map(stint => TYRE_LABELS[stint.compound]).join(" → ")}</span>
          <small>출발 P{match.driver.gridPosition} · 노면 {number(match.event.trackTemperatureC, "°C")}</small>
        </button>)}
      </div>
      <article className="historical-recommendations__detail">
        <header><span>{selected.event.date} · {selected.event.name}</span><h3>{selected.driver.name} <small>{selected.driver.team}</small></h3>
          <p>실제 타이어 교체: {selected.driver.stints.slice(0, -1).map(stint => `L${stint.endLap} 종료 후`).join(" · ") || "없음"}</p></header>
        <dl>
          <div><dt>실제 출발 → 완주</dt><dd>P{selected.driver.gridPosition} → P{selected.driver.finishPosition}</dd><small>설정 출발 순위와 {selected.differences.grid}칸 차이</small></div>
          <div><dt>실제 평균 노면 온도</dt><dd>{number(selected.event.trackTemperatureC, "°C")}</dd><small>설정과 {selected.differences.trackC.toFixed(1)}°C 차이</small></div>
          <div><dt>실제 평균 기온</dt><dd>{number(selected.event.airTemperatureC, "°C")}</dd><small>설정과 {selected.differences.airC.toFixed(1)}°C 차이</small></div>
          <div><dt>실제 평균 습도</dt><dd>{number(selected.event.humidityPercent, "%")}</dd><small>{selected.differences.humidity === null ? "습도 일치 여부 미확인" : `설정과 ${selected.differences.humidity.toFixed(1)}%p 차이`}</small></div>
          <div><dt>실제 노면 흐름</dt><dd>{WEATHER_KIND_LABELS[selected.event.weatherKind]}</dd><small>강수 강도는 관측하지 않음</small></div>
          <div><dt>실제 경기 개입</dt><dd>{[selected.event.raceControl.sc && "SC", selected.event.raceControl.vsc && "VSC", selected.event.raceControl.red && "RED"].filter(Boolean).join(" · ") || "SC·VSC·RED 없음"}</dd><small>가상 사고 확률과 별개</small></div>
        </dl>
        <div className="historical-recommendations__sources"><a href={selected.event.timingUrl} target="_blank" rel="noreferrer">F1 원본 타이밍 자료 ↗</a><a href="https://docs.fastf1.dev/core.html" target="_blank" rel="noreferrer">수집 도구·항목 설명 ↗</a></div>
        {selected.adaptation && <p className="historical-recommendations__notice">{selected.adaptation}</p>}
        {selected.event.raceControl.red && <p>이 경기에는 레드 플래그가 있었습니다. 교체 기록에 중단 중 교체가 포함될 수 있으며, 모두 피트 정차를 의미하지는 않습니다.</p>}
        <p>가져온 뒤의 시간·순위는 현재 조건에서 다시 계산한 가상 결과입니다. 당시 사용한 중고 타이어 수명·SC·교통·차량 성능을 그대로 재현하지 않습니다.</p>
        <div className="historical-recommendations__actions">
          <button type="button" disabled={!selected.importable} onClick={() => onUseStrategy(selected, "manual")}>{selected.adaptation ? "마지막 랩 보정 후 편집" : "실제 전략 불러와 편집"}</button>
          <button type="button" disabled={!selected.importable} onClick={() => onUseStrategy(selected, "replay")}>{selected.adaptation ? "랩 보정 후 가상 레이스" : "이 전략으로 가상 레이스"}</button>
        </div>
        {!selected.importable && <p>실제 레이스와 랩 수 또는 교체 횟수 차이가 커서 기록 열람만 가능합니다.</p>}
      </article>
    </>}
    <details className="historical-recommendations__method"><summary>추천 기준·수집 범위·한계</summary>
      <p>출발 순위 차이 ±{MATCH_LIMITS.grid}칸, 노면 온도 ±{MATCH_LIMITS.trackC}°C, 기온 ±{MATCH_LIMITS.airC}°C, 습도 ±{MATCH_LIMITS.humidity}%p 이내를 찾습니다. 이 허용 범위는 프로젝트 기준이지 공식 F1 기준이 아닙니다.</p>
      <p>같은 서킷·건식/우천 흐름을 먼저 확인합니다. 비가 시작하거나 끝나는 시점은 실제 우천 타이어 사용 구간과 레이스 진행률 ±20% 이내로 비교합니다. 강수 강도와 수막은 실측 비교가 불가능합니다.</p>
      <p>정렬 점수 = 정규화한 출발 순위 차이 50% + 노면 온도 30% + 기온 15% + 습도 5%. 낮을수록 가깝습니다. 최종 순위나 우승 여부는 정렬에 사용하지 않습니다. 온도는 출발 순간이 아닌 경기 중 평균입니다.</p>
      <p>{STRATEGY_EXAMPLES.events.length}경기 · {STRATEGY_EXAMPLES.events.reduce((sum, event) => sum + event.drivers.length, 0)}개 전 거리 완주 기록 · 2023–2025 공개 타이밍 자료. 수집일 {STRATEGY_EXAMPLES.generatedAt.slice(0, 10)}. 누락·리타이어·랩 다운·피트 레인 출발은 제외되어 표본 편향이 있습니다.</p>
      <p>선수와 팀이 같다는 이유로 더 좋은 전략이라고 판단하지 않습니다. 교통량·사고 확률·피트 손실·연료 효과는 당시와 맞췄다고 주장하지 않습니다. 시즌별 차량 규정, 서킷 변경, 실제 C 컴파운드 배정 차이도 남습니다. DP 결과는 별도의 ‘모델 계산 후보’이며 실제 추천에 섞지 않습니다.</p>
    </details>
  </section>;
}
