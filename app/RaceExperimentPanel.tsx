import { useLayoutEffect, useRef, useState } from "react";
import { MODEL_PARAMS } from "./model/params";
import { formatRaceTime, type StrategyResult } from "./lib/strategy";
import type { RaceEventPrior, RaceExperimentResult, RaceExperimentRival } from "./lib/race-experiments";
import type { RaceExperimentWorkerRequest, RaceExperimentWorkerResponse } from "./workers/race-experiment.worker";
import "./race-experiment.css";

export default function RaceExperimentPanel({ candidates, seed, onSeedChange, result, onResult, racecraft, startingGridPosition, pitLossSeconds, trialIndex, onTrialChange, hidden, fixedRivals, playerId, gridSlotOffsetSeconds, eventPrior }: {
  candidates: StrategyResult[]; seed: number; onSeedChange: (seed: number) => void;
  result: RaceExperimentResult | null; onResult: (result: RaceExperimentResult | null) => void;
  racecraft: number; startingGridPosition: number; pitLossSeconds: number;
  trialIndex: number; onTrialChange: (trial: number) => void; hidden?: boolean;
  fixedRivals?: readonly RaceExperimentRival[]; playerId?: string; gridSlotOffsetSeconds?: number;
  eventPrior?: RaceEventPrior;
}) {
  const worker = useRef<Worker | null>(null);
  const generation = useRef(0);
  const [status, setStatus] = useState("");
  const [running, setRunning] = useState(false);
  const conditionInputs = [candidates, seed, racecraft, startingGridPosition, pitLossSeconds,
    fixedRivals, playerId, gridSlotOffsetSeconds, eventPrior, onResult] as const;
  const [previousInputs, setPreviousInputs] = useState(conditionInputs);
  // Derive a fresh local status as props change, without a cascading state reset
  // in the worker-lifecycle effect. React retries this guarded render once.
  if (conditionInputs.some((value, index) => !Object.is(value, previousInputs[index]))) {
    setPreviousInputs(conditionInputs); setRunning(false); setStatus("");
  }
  // Invalidate during commit, before a queued old worker response can reach the
  // new condition UI. A passive effect would leave a post-paint stale window.
  useLayoutEffect(() => {
    generation.current += 1;
    worker.current?.terminate(); worker.current = null;
    onResult(null);
    return () => { generation.current += 1; worker.current?.terminate(); worker.current = null; };
  }, [candidates, seed, racecraft, startingGridPosition, pitLossSeconds, fixedRivals, playerId, gridSlotOffsetSeconds, eventPrior, onResult]);

  const run = () => {
    if (typeof Worker === "undefined") { setStatus("이 브라우저는 백그라운드 계산을 지원하지 않습니다."); return; }
    worker.current?.terminate(); worker.current = null; const request = ++generation.current;
    onResult(null);
    setRunning(true); setStatus("모든 후보에 같은 상황을 주어 300회를 계산하고 있습니다…");
    try {
      const instance = new Worker(new URL("./workers/race-experiment.worker.ts", import.meta.url), { type: "module" });
      worker.current = instance;
      let settled = false;
      const finish = (error?: string) => { if (settled) return; settled = true; instance.terminate(); if (generation.current === request) { worker.current = null; setRunning(false); if (error) setStatus(error); } };
      instance.onmessage = (message: MessageEvent<RaceExperimentWorkerResponse>) => {
        if (settled || generation.current !== request || message.data?.requestId !== request) return;
        if (message.data.result) {
          const next = message.data.result;
          if (next.seed !== seed || next.trials !== MODEL_PARAMS.race.trials || next.candidates.length !== candidates.length
            || next.eventTimelines.length !== next.trials
            || (eventPrior && JSON.stringify(next.prior) !== JSON.stringify(eventPrior))) { finish("계산 조건과 응답이 일치하지 않아 결과를 적용하지 않았습니다."); return; }
          onResult(next); onTrialChange(0); setStatus("300회 계산 완료 · 같은 시드로 다시 재현할 수 있습니다.");
          finish();
        } else finish(message.data.error || "계산 응답을 읽지 못했습니다.");
      };
      instance.onerror = () => finish("확률 실험을 계산하지 못했습니다. 다시 시도해 주세요.");
      instance.onmessageerror = () => finish("계산 응답을 읽지 못했습니다. 다시 시도해 주세요.");
      instance.postMessage({ requestId: request, candidates, options: { seed, trials: MODEL_PARAMS.race.trials, trackLaps: candidates[0]?.lapCosts.length, racecraft, startingGridPosition, pitLossSeconds, rivalStrategies: candidates, fixedRivals, playerId, gridSlotOffsetSeconds, eventPrior } } satisfies RaceExperimentWorkerRequest);
    } catch { generation.current += 1; worker.current?.terminate(); worker.current = null; setRunning(false); setStatus("백그라운드 계산기를 열지 못했습니다."); }
  };
  const timeline = result?.eventTimelines[trialIndex];
  return <section className="race-experiment" hidden={hidden} aria-labelledby="race-experiment-title">
    <header><div><span>프로젝트 추정 · 공통 상황 실험</span><h3 id="race-experiment-title">같은 전략, 다른 레이스 상황</h3><p>위 보드는 결정론 결과입니다. 아래는 고정된 후보를 SC·VSC·가상 20대 교통 상황에 각각 넣어 비교하며, 확률까지 최적화한 DP 해는 아닙니다. {fixedRivals ? "3D와 20대 참가자·출발 순번·상대 전략·능력치 기초 랩 비용을 공유하되, 교통·SC/VSC의 계산 방식은 별도입니다." : "공유 그리드가 없는 호환 모드로, 3D의 팀·선수별 배치와 다른 일반 상대팩을 사용합니다."}</p></div>
      <div className="race-experiment__controls"><label>재현 시드<input type="number" min="0" max={MODEL_PARAMS.race.uintRange - 1} value={seed} onChange={event => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 0 && value < MODEL_PARAMS.race.uintRange) onSeedChange(value); }} /></label><button type="button" disabled={running || !candidates.length} onClick={run}>{running ? "계산 중…" : "300회 확률 실험"}</button>{running && <button type="button" onClick={() => { generation.current++; worker.current?.terminate(); worker.current = null; setRunning(false); setStatus("계산을 취소했습니다."); }}>취소</button>}</div>
    </header>
    <p role="status">{status}</p>
    <RacePriorEvidence prior={eventPrior} />
    {result && <><div className="race-experiment__results">{result.candidates.map((candidate, index) => <article key={candidate.signature}><h4>전략 {index + 1} · 후보 내 승률 {(candidate.winRate * 100).toFixed(1)}%</h4><strong>{formatRaceTime(candidate.p10Seconds)} – {formatRaceTime(candidate.p90Seconds)}</strong><p>P10–P90 완주 시간 · 프로젝트 추정</p><small>평균 교통 손실 +{candidate.meanTrafficLossSeconds.toFixed(2)}초 · 피트 절약 {candidate.meanPitSavingSeconds.toFixed(2)}초</small><small>가상 20대 중 1위 {(candidate.gridWinRate * 100).toFixed(1)}% · 후보 내 승률과 다릅니다.</small></article>)}</div>
      <p>시드 {result.seed} · {result.trials}회 중 SC {result.eventSummary.scTrials}회, VSC {result.eventSummary.vscTrials}회. 동률 승률은 나눠 계산합니다.</p>
      <label className="race-experiment__trial">리플레이 옆에서 확인할 공통 상황 <input type="number" min="1" max={result.trials} value={trialIndex + 1} onChange={event => onTrialChange(Math.min(result.trials - 1, Math.max(0, Math.trunc(Number(event.target.value) || 1) - 1)))} />회차</label>
      <p>{timeline?.events.length ? timeline.events.map(event => `${event.kind} L${event.startLap}–L${event.endLap}`).join(" · ") : "이 회차는 SC·VSC 없음"} · 3D 시간표를 바꾸지 않는 별도 실험 오버레이입니다.</p></>}
    <details><summary>확률·교통 가정과 한계</summary><p>과거 관측 빈도를 사용하더라도 실제 경기의 발생 시점을 예측하는 것은 아닙니다. 한 시행에 SC·VSC 각각 최대 한 구간을 생성하며, 서로 겹치지 않는 자리가 없으면 뒤 구간은 생략됩니다. SC에서는 정상 피트 손실의 {Math.round(MODEL_PARAMS.race.scPitFactor * 100)}%, VSC에서는 {Math.round(MODEL_PARAMS.race.vscPitFactor * 100)}%를 적용합니다. 이 손실 배수와 운영 모형은 프로젝트 추정입니다.</p><p>앞차와 {MODEL_PARAMS.race.followingGapSeconds}초 이내에서 페이스 차의 {MODEL_PARAMS.race.trafficLossFraction * 100}%를 손실로 적용하고 EA RAC 기반 프로젝트 추월 확률을 사용합니다. {fixedRivals ? "19대 상대의 실제 선수 ID·RAC·전략 배정·페이스/마모/젖음 계수는 3D와 같은 입력을 사용합니다. 기존 리플레이의 교통 손실을 가져오지 않아 MC 교통을 이중 적용하지 않습니다." : "19대 상대는 일반 고정 전략 풀과 일정한 페이스 간격을 사용합니다."} 상대의 전략 풀과 난수 조건은 후보 간 동일합니다. SC의 실제 대열 압축·추가 주행 지연·전체 차량 물리와 피트 현장 운영은 재현하지 않습니다.</p>{result?.limitations.map(note => <p key={note}>{note}</p>)}</details>
  </section>;
}

/** Keep provenance visible before a run; the large event archive loads only on demand. */
export function RacePriorEvidence({ prior }: { readonly prior?: RaceEventPrior }) {
  const [rawStatus, setRawStatus] = useState("");
  const evidence = prior?.evidence;
  const percent = (value: number | null | undefined) => value == null ? "미확보" : `${(value * 100).toFixed(1)}%`;
  const downloadRaw = async () => {
    setRawStatus("경기별 원자료를 불러오는 중입니다.");
    try {
      const raw = await import("./data/neutralisation-evidence.json");
      const url = URL.createObjectURL(new Blob([JSON.stringify(raw.default, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = "compound-sc-vsc-evidence-2018-2025.json"; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setRawStatus("공식 출처 URL·누락 사유·상태 구간이 포함된 JSON을 내려받았습니다.");
    } catch { setRawStatus("원자료를 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요."); }
  };
  return <div>
    <p>적용 발생률 · SC {percent(prior?.scProbability ?? MODEL_PARAMS.race.fallbackScProbability)} · VSC {percent(prior?.vscProbability ?? MODEL_PARAMS.race.fallbackVscProbability)} · {prior?.sourceType === "observed" ? "과거 타이밍 관측 빈도" : "프로젝트 사전값"}</p>
    <details><summary>SC·VSC 관측 표본·신뢰구간·대체값 확인</summary>
      <p>{prior?.sourceLabel ?? "선택 서킷의 관측 사전값이 연결되지 않아 프로젝트 기본값을 사용합니다."}</p>
      {evidence && <>
        <p>{evidence.sourcePeriod} · 대상 {evidence.scheduledRaces}경기 · 누락·예외 {evidence.excludedRaces}경기 제외. 관측한 0회와 자료 미확보는 다르게 처리합니다.</p>
        {(["sc", "vsc"] as const).map(kind => {
          const row = evidence[kind];
          const observedDurations = kind === "sc" ? prior?.scDurations : prior?.vscDurations;
          const durations = observedDurations ?? (kind === "sc" ? MODEL_PARAMS.race.scDurations : MODEL_PARAMS.race.vscDurations);
          return <div key={kind}><p><strong>{kind.toUpperCase()}</strong> · 관측 {row.numerator}/{row.denominator}경기 = {percent(row.observedProbability)} · 이항 비율 95% 구간 {row.probabilityCI95 ? row.probabilityCI95.map(value => percent(value)).join("–") : "미확보"}<br />
            발생률 {row.frequencyApplied ? "관측 채택" : `표본 미달 · 프로젝트 기본값 적용(최소 ${MODEL_PARAMS.race.minObservedRaces}경기)`} · 지속 랩 표본 {row.durationEpisodes}구간 → {row.durationSource === "observed" ? "관측 경험 분포" : "표본 미달 · 프로젝트 분포"} {Math.min(...durations)}–{Math.max(...durations)}랩.</p></div>;
        })}
        <p>위 95% 구간은 과거 경기의 발생 비율에 대한 이항 표본 불확실성입니다. 아래 시뮬레이션의 P10–P90 완주 시간이나 미래 경기 예측 신뢰구간과 다릅니다.</p>
        {evidence.notes.map(note => <p key={note}>{note}</p>)}
      </>}
      {prior?.sourceUrl && <p><a href={prior.sourceUrl} target="_blank" rel="noreferrer">대표 경기의 공식 타이밍 원문 ↗</a> · 전체 경기 URL은 아래 원자료에 포함됩니다.</p>}
      {evidence?.rawDataAvailable && <button type="button" onClick={downloadRaw}>경기별 출처·원자료 JSON 내려받기</button>}
      <p role="status">{rawStatus}</p>
    </details>
  </div>;
}
