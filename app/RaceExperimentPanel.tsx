import { useLayoutEffect, useRef, useState } from "react";
import { MODEL_PARAMS } from "./model/params";
import { formatRaceTime, type StrategyResult } from "./lib/strategy";
import type { RaceExperimentResult, RaceExperimentRival } from "./lib/race-experiments";
import type { RaceExperimentWorkerRequest, RaceExperimentWorkerResponse } from "./workers/race-experiment.worker";
import "./race-experiment.css";

export default function RaceExperimentPanel({ candidates, seed, onSeedChange, result, onResult, racecraft, startingGridPosition, pitLossSeconds, trialIndex, onTrialChange, hidden, fixedRivals, playerId, gridSlotOffsetSeconds }: {
  candidates: StrategyResult[]; seed: number; onSeedChange: (seed: number) => void;
  result: RaceExperimentResult | null; onResult: (result: RaceExperimentResult | null) => void;
  racecraft: number; startingGridPosition: number; pitLossSeconds: number;
  trialIndex: number; onTrialChange: (trial: number) => void; hidden?: boolean;
  fixedRivals?: readonly RaceExperimentRival[]; playerId?: string; gridSlotOffsetSeconds?: number;
}) {
  const worker = useRef<Worker | null>(null);
  const generation = useRef(0);
  const [status, setStatus] = useState("");
  const [running, setRunning] = useState(false);
  const conditionInputs = [candidates, seed, racecraft, startingGridPosition, pitLossSeconds,
    fixedRivals, playerId, gridSlotOffsetSeconds, onResult] as const;
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
  }, [candidates, seed, racecraft, startingGridPosition, pitLossSeconds, fixedRivals, playerId, gridSlotOffsetSeconds, onResult]);

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
            || next.eventTimelines.length !== next.trials) { finish("계산 조건과 응답이 일치하지 않아 결과를 적용하지 않았습니다."); return; }
          onResult(next); onTrialChange(0); setStatus("300회 계산 완료 · 같은 시드로 다시 재현할 수 있습니다.");
          finish();
        } else finish(message.data.error || "계산 응답을 읽지 못했습니다.");
      };
      instance.onerror = () => finish("확률 실험을 계산하지 못했습니다. 다시 시도해 주세요.");
      instance.onmessageerror = () => finish("계산 응답을 읽지 못했습니다. 다시 시도해 주세요.");
      instance.postMessage({ requestId: request, candidates, options: { seed, trials: MODEL_PARAMS.race.trials, trackLaps: candidates[0]?.lapCosts.length, racecraft, startingGridPosition, pitLossSeconds, rivalStrategies: candidates, fixedRivals, playerId, gridSlotOffsetSeconds } } satisfies RaceExperimentWorkerRequest);
    } catch { generation.current += 1; worker.current?.terminate(); worker.current = null; setRunning(false); setStatus("백그라운드 계산기를 열지 못했습니다."); }
  };
  const timeline = result?.eventTimelines[trialIndex];
  return <section className="race-experiment" hidden={hidden} aria-labelledby="race-experiment-title">
    <header><div><span>프로젝트 추정 · 공통 상황 실험</span><h3 id="race-experiment-title">같은 전략, 다른 레이스 상황</h3><p>위 보드는 결정론 결과입니다. 아래는 고정된 후보를 SC·VSC·가상 20대 교통 상황에 각각 넣어 비교하며, 확률까지 최적화한 DP 해는 아닙니다. {fixedRivals ? "3D와 20대 참가자·출발 순번·상대 전략·능력치 기초 랩 비용을 공유하되, 교통·SC/VSC의 계산 방식은 별도입니다." : "공유 그리드가 없는 호환 모드로, 3D의 팀·선수별 배치와 다른 일반 상대팩을 사용합니다."}</p></div>
      <div className="race-experiment__controls"><label>재현 시드<input type="number" min="0" max={MODEL_PARAMS.race.uintRange - 1} value={seed} onChange={event => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 0 && value < MODEL_PARAMS.race.uintRange) onSeedChange(value); }} /></label><button type="button" disabled={running || !candidates.length} onClick={run}>{running ? "계산 중…" : "300회 확률 실험"}</button>{running && <button type="button" onClick={() => { generation.current++; worker.current?.terminate(); worker.current = null; setRunning(false); setStatus("계산을 취소했습니다."); }}>취소</button>}</div>
    </header>
    <p role="status">{status}</p>
    {result && <><div className="race-experiment__results">{result.candidates.map((candidate, index) => <article key={candidate.signature}><h4>전략 {index + 1} · 후보 내 승률 {(candidate.winRate * 100).toFixed(1)}%</h4><strong>{formatRaceTime(candidate.p10Seconds)} – {formatRaceTime(candidate.p90Seconds)}</strong><p>P10–P90 완주 시간 · 프로젝트 추정</p><small>평균 교통 손실 +{candidate.meanTrafficLossSeconds.toFixed(2)}초 · 피트 절약 {candidate.meanPitSavingSeconds.toFixed(2)}초</small><small>가상 20대 중 1위 {(candidate.gridWinRate * 100).toFixed(1)}% · 후보 내 승률과 다릅니다.</small></article>)}</div>
      <p>시드 {result.seed} · {result.trials}회 중 SC {result.eventSummary.scTrials}회, VSC {result.eventSummary.vscTrials}회. 동률 승률은 나눠 계산합니다.</p>
      <label className="race-experiment__trial">리플레이 옆에서 확인할 공통 상황 <input type="number" min="1" max={result.trials} value={trialIndex + 1} onChange={event => onTrialChange(Math.min(result.trials - 1, Math.max(0, Math.trunc(Number(event.target.value) || 1) - 1)))} />회차</label>
      <p>{timeline?.events.length ? timeline.events.map(event => `${event.kind} L${event.startLap}–L${event.endLap}`).join(" · ") : "이 회차는 SC·VSC 없음"} · 3D 시간표를 바꾸지 않는 별도 실험 오버레이입니다.</p></>}
    <details><summary>확률·교통 가정과 한계</summary><p>공식 2018–2025 서킷별 발생 통계를 아직 확보하지 못해 모든 서킷에 동일한 실험용 사전값을 사용합니다. 경기당 SC {MODEL_PARAMS.race.fallbackScProbability * 100}%, VSC {MODEL_PARAMS.race.fallbackVscProbability * 100}%; 정상 피트 손실의 SC {MODEL_PARAMS.race.scPitFactor * 100}%, VSC {MODEL_PARAMS.race.vscPitFactor * 100}%를 적용합니다.</p><p>앞차와 {MODEL_PARAMS.race.followingGapSeconds}초 이내에서 페이스 차의 {MODEL_PARAMS.race.trafficLossFraction * 100}%를 손실로 적용하고 EA RAC 기반 프로젝트 추월 확률을 사용합니다. {fixedRivals ? "19대 상대의 실제 선수 ID·RAC·전략 배정·페이스/마모/젖음 계수는 3D와 같은 입력을 사용합니다. 기존 리플레이의 교통 손실을 가져오지 않아 MC 교통을 이중 적용하지 않습니다." : "19대 상대는 일반 고정 전략 풀과 일정한 페이스 간격을 사용합니다."} 상대의 전략 풀과 난수 조건은 후보 간 동일합니다. SC의 실제 대열 압축·추가 주행 지연·전체 차량 물리와 피트 현장 운영은 재현하지 않습니다.</p>{result?.limitations.map(note => <p key={note}>{note}</p>)}</details>
  </section>;
}
