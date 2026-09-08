"use client";

import { useId, useMemo, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { RaceGrid, RaceGridFrame } from "./lib/race-grid";
import type { RaceExperimentTimeline } from "./lib/race-experiments";
import type { Compound } from "./lib/strategy";
import {
  buildReplayTelemetryEvents, buildReplayTimingRows, occurredReplayEvents,
  prepareReplayUndercuts, settledReplayUndercuts,
  type ReplayTelemetryEvent,
} from "./lib/replay-telemetry";
import { MODEL_PARAMS, TYRE_COLORS, TYRE_LABELS } from "./model/params";
import "./replay-telemetry.css";

export interface ReplayTelemetryProps {
  readonly grid: RaceGrid;
  readonly frame: RaceGridFrame;
  readonly playerId: string;
  /** Pass false during setup/countdown, so a t=0 frame is not called a start. */
  readonly hasStarted?: boolean;
  readonly comparisonDriverId?: string;
  /** A real returned MC trial, displayed unchanged and separately from replay. */
  readonly experimentTimeline?: RaceExperimentTimeline | null;
  readonly onSeek?: (seconds: number) => void;
}

const TABS = [{ id: "timing", label: "전체 순위" },
  { id: "stints", label: "스틴트 기록" }, { id: "events", label: "레이스 이벤트" }] as const;
type Tab = typeof TABS[number]["id"];

function tyreStyle(compound: Compound): CSSProperties {
  return { "--telemetry-tyre": TYRE_COLORS[compound] } as CSSProperties;
}

function Tyre({ compound }: { compound: Compound }) {
  return <span className="replay-telemetry-tyre" style={tyreStyle(compound)}
    aria-label={TYRE_LABELS[compound]} title={TYRE_LABELS[compound]}>
    {compound === "INTER" ? "I" : compound === "WET" ? "W" : compound}
  </span>;
}

function modelClock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function eventDescription(event: ReplayTelemetryEvent): string {
  switch (event.kind) {
    case "start": return "레이스 출발";
    case "pit-entry": return `${event.lap}랩 종료 후 피트 진입`;
    case "pit-exit": return `${event.compound ? TYRE_LABELS[event.compound] : "새"} 타이어로 복귀`;
    case "cliff": return "타이어 성능 급락 구간 진입 · 모델 추정";
    case "finish": return "체커기 · 주행 완료";
  }
}

export default function ReplayTelemetry({ grid, frame, playerId, hasStarted, comparisonDriverId, experimentTimeline, onSeek }: ReplayTelemetryProps) {
  const id = useId();
  const [tab, setTab] = useState<Tab>("timing");
  const [onlyPlayerEvents, setOnlyPlayerEvents] = useState(true);
  const rows = useMemo(() => buildReplayTimingRows(grid, frame, playerId), [grid, frame, playerId]);
  const eventSchedule = useMemo(() => buildReplayTelemetryEvents(grid), [grid]);
  const undercutSchedule = useMemo(() => prepareReplayUndercuts(grid, playerId, comparisonDriverId),
    [grid, playerId, comparisonDriverId]);
  const started = hasStarted ?? frame.elapsedSeconds > 0;
  const events = started ? occurredReplayEvents(eventSchedule, frame.elapsedSeconds, onlyPlayerEvents ? playerId : undefined) : [];
  const undercuts = settledReplayUndercuts(undercutSchedule, frame.elapsedSeconds);
  const carFrames = new Map(frame.cars.map((car) => [car.id, car]));
  const player = frame.cars.find((car) => car.id === playerId);

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === "ArrowRight" ? (index + 1) % TABS.length
      : event.key === "ArrowLeft" ? (index + TABS.length - 1) % TABS.length
        : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    setTab(TABS[next].id);
    document.getElementById(`${id}-${TABS[next].id}-tab`)?.focus();
  }

  return <section className="replay-telemetry" aria-labelledby={`${id}-heading`}>
    <header className="replay-telemetry-header">
      <div><span className="replay-telemetry-kicker">레이스 데이터 / 모델 리플레이</span><h3 id={`${id}-heading`}>전략이 레이스를 바꾸는 순간</h3></div>
      <p><b>{frame.completed ? "레이스 종료" : player?.completed ? "내 차 완주" : started ? `${player?.lap ?? 1} / ${grid.totalLaps}랩` : "출발 대기"}</b><span>{modelClock(frame.elapsedSeconds)} · {grid.cars.length}대</span></p>
    </header>
    <div className="replay-telemetry-tabs" role="tablist" aria-label="레이스 데이터 보기">
      {TABS.map((item, index) => <button key={item.id} type="button" role="tab"
        id={`${id}-${item.id}-tab`} aria-selected={tab === item.id} aria-controls={`${id}-${item.id}-panel`}
        tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)} onKeyDown={(event) => onTabKey(event, index)}>{item.label}</button>)}
    </div>

    <div id={`${id}-timing-panel`} role="tabpanel" aria-labelledby={`${id}-timing-tab`} hidden={tab !== "timing"} tabIndex={0}>
      <div className="replay-telemetry-table-scroll">
        <table className="replay-telemetry-table"><caption>타이어 사용 랩은 완료한 랩 수입니다. 격차는 같은 주행 거리에 도달한 모델 시각으로 비교합니다.</caption>
          <thead><tr><th scope="col">순위</th><th scope="col">드라이버</th><th scope="col">타이어 / 사용</th><th scope="col">선두 격차</th><th scope="col">앞차 격차</th><th scope="col">출발 대비</th><th scope="col">상태</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id} className={row.isPlayer ? "is-player" : undefined}>
            <td><b>{row.position}</b></td><th scope="row"><span>{row.name}</span>{row.isPlayer && <small className="replay-telemetry-player-tag">내 차</small>}</th>
            <td><span className="replay-telemetry-tyre-cell"><Tyre compound={row.compound} /><span>{row.tyreAgeLaps}랩</span></span></td>
            <td>{row.position === 1 ? "선두" : `+${row.leaderGapSeconds.toFixed(3)}초`}</td>
            <td>{row.intervalSeconds === null ? "—" : `+${row.intervalSeconds.toFixed(3)}초`}</td>
            <td><span className={row.positionChange > 0 ? "position-gain" : row.positionChange < 0 ? "position-loss" : undefined}
              aria-label={row.positionChange === 0 ? "변동 없음" : `${Math.abs(row.positionChange)}계단 ${row.positionChange > 0 ? "상승" : "하락"}`}>
              {row.positionChange === 0 ? "—" : `${row.positionChange > 0 ? "↑" : "↓"}${Math.abs(row.positionChange)}`}</span></td>
            <td><span className={row.state === "pit" ? "replay-telemetry-pit" : "replay-telemetry-state"}>{!started ? "출발 대기" : row.state === "pit" ? "피트" : row.state === "finished" ? "완주" : "주행"}</span></td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>

    <div id={`${id}-stints-panel`} role="tabpanel" aria-labelledby={`${id}-stints-tab`} hidden={tab !== "stints"} tabIndex={0}>
      <p className="replay-telemetry-help">각 차량의 전략 · 가로 위치는 랩입니다. 세로 표식은 현재 진행, 옅은 구간은 남은 계획입니다.</p>
      <div className="replay-telemetry-gantt-legend">
        <span><i className="replay-telemetry-pit-key" aria-hidden="true" />피트 전환 · 랩 종료 후</span>
        {experimentTimeline && <><strong>확률 실험 조건 · 재생 시계 미반영</strong>
          <span><i className="replay-telemetry-neutral-key is-sc" aria-hidden="true" />안전 차량(SC)</span>
          <span><i className="replay-telemetry-neutral-key is-vsc" aria-hidden="true" />가상 안전 차량(VSC)</span></>}
      </div>
      <div className="replay-telemetry-gantt-scroll"><div className="replay-telemetry-gantt">
        <div className="replay-telemetry-gantt-axis"><span>드라이버</span><div><span>출발</span><span>{grid.totalLaps}랩</span></div></div>
        {rows.map((row) => {
          const car = grid.cars.find((candidate) => candidate.id === row.id)!;
          const progress = carFrames.get(row.id)?.progressLaps ?? 0;
          return <div key={row.id} className={`replay-telemetry-gantt-row${row.isPlayer ? " is-player" : ""}`}>
            <span className="replay-telemetry-gantt-name"><b>{row.position}</b>{row.name}{row.isPlayer && <small>내 차</small>}</span>
            <div className="replay-telemetry-stints" aria-label={`${row.name}의 스틴트`}>
              {car.strategy.stints.map((stint) => <span key={stint.startLap} className="replay-telemetry-stint"
                style={{ ...tyreStyle(stint.compound), width: `${(stint.endLap - stint.startLap + 1) / grid.totalLaps * 100}%` }}
                title={`${TYRE_LABELS[stint.compound]} · ${stint.startLap}–${stint.endLap}랩`}
                aria-label={`${TYRE_LABELS[stint.compound]} ${stint.startLap}랩부터 ${stint.endLap}랩까지`}>
                <span>{stint.compound === "INTER" ? "I" : stint.compound === "WET" ? "W" : stint.compound} <small>{stint.endLap}</small></span>
              </span>)}
              <span className="replay-telemetry-future" style={{ left: `${progress / grid.totalLaps * 100}%` }} aria-hidden="true" />
              {experimentTimeline?.events.map((event, index) => <span
                key={`neutral-${index}-${event.kind}-${event.startLap}`}
                className={`replay-telemetry-neutral-band ${event.kind === "SC" ? "is-sc" : "is-vsc"}`}
                style={{ left: `${(event.startLap - 1) / grid.totalLaps * 100}%`, width: `${(event.endLap - event.startLap + 1) / grid.totalLaps * 100}%` }}
                role="img" aria-label={`확률 실험 ${event.kind === "SC" ? "안전 차량" : "가상 안전 차량"} ${event.startLap}–${event.endLap}랩 · 재생 시계 미반영`}
                title={`${event.kind} ${event.startLap}–${event.endLap}랩 · 확률 실험 조건, 재생 시계 미반영`} />)}
              {car.strategy.stints.slice(0, -1).map((stint) => <span key={`pit-${stint.endLap}`}
                className="replay-telemetry-pit-marker" style={{ left: `${stint.endLap / grid.totalLaps * 100}%` }}
                role="img" aria-label={`${stint.endLap}랩 종료 후 피트 전환`} title={`${stint.endLap}랩 종료 후 피트 전환`} />)}
              <span className="replay-telemetry-progress" style={{ left: `${progress / grid.totalLaps * 100}%` }} aria-hidden="true" />
            </div>
          </div>;
        })}
      </div></div>
    </div>

    <div id={`${id}-events-panel`} role="tabpanel" aria-labelledby={`${id}-events-tab`} hidden={tab !== "events"} tabIndex={0}>
      <div className="replay-telemetry-event-toolbar"><p>현재 재생 시각까지 발생한 이벤트</p><label><input type="checkbox" checked={onlyPlayerEvents} onChange={(event) => setOnlyPlayerEvents(event.target.checked)} />내 차만</label></div>
      {!started && <p className="replay-telemetry-help">레이스가 시작되면 이벤트를 기록합니다.</p>}
      <ol className="replay-telemetry-events">{[...events].reverse().map((event) => <li key={event.id} className={event.driverId === playerId ? "is-player" : undefined}>
        <time>{modelClock(event.atSeconds)}</time><span className={`replay-telemetry-event-icon event-${event.kind}`} aria-hidden="true">{event.kind === "pit-entry" || event.kind === "pit-exit" ? "피" : event.kind === "cliff" ? "!" : event.kind === "finish" ? "완" : "출"}</span>
        <div><strong>{event.driverName}{event.driverId === playerId && <small className="replay-telemetry-player-tag">내 차</small>}</strong><p>{eventDescription(event)}</p>{onSeek && <button type="button" className="replay-event-seek" aria-label={`${event.driverName} ${eventDescription(event)} 시점으로 이동`} onClick={() => onSeek(event.atSeconds)}>이 시점 보기 →</button>}</div><span className="replay-telemetry-event-lap">{event.lap}랩</span>
      </li>)}</ol>
      <div className="replay-telemetry-undercut"><h4>언더컷 정산</h4>
        <p>같은 완료 스톱 수로 상대 피트 후 {MODEL_PARAMS.race.undercutSettlingLaps}랩을 두 차량 모두 마친 뒤 판정합니다. 기본 상대는 출발 당시 바로 앞 차량입니다.</p>
        {undercuts.length === 0 ? <span>아직 확정할 수 있는 언더컷 결과가 없습니다.</span> : <ul>{undercuts.map((item) => <li key={`${item.opponentId}-${item.stopNumber}`}>
          <b>{item.opponentName} 대비 {item.stopNumber}차 피트 · {item.status === "success" ? "언더컷 성공" : item.status === "failed" ? "언더컷 실패" : "판정 보류"}</b>
          <span>{item.settlementLap}랩 정산 · {item.reason}{item.gapAfterSeconds !== null && ` (${item.gapAfterSeconds >= 0 ? "+" : ""}${item.gapAfterSeconds.toFixed(3)}초)`}</span>
        </li>)}</ul>}
      </div>
    </div>

    {experimentTimeline && <aside className="replay-telemetry-neutralisation" aria-label="확률 실험의 안전 차량·가상 안전 차량 타임라인">
      <div><strong>안전 차량(SC) / 가상 안전 차량(VSC) · 확률 실험 {experimentTimeline.trial + 1}번</strong><span>{experimentTimeline.id}</span></div>
      <p>저장된 실험 시나리오를 그대로 표시합니다. 위 주행 순위·시계에는 이 SC/VSC 할인이나 감속이 적용되지 않습니다.</p>
      {experimentTimeline.events.length === 0 ? <span>이 시행에는 SC/VSC 구간이 없습니다.</span>
        : <ul>{experimentTimeline.events.map((event, index) => <li key={`${index}-${event.kind}-${event.startLap}`}><b>{event.kind === "SC" ? "안전 차량(SC)" : "가상 안전 차량(VSC)"}</b><span>{event.startLap}–{event.endLap}랩</span></li>)}</ul>}
    </aside>}
    <footer className="replay-telemetry-footer">실제 F1 실시간 중계가 아닌 모델 계산 결과입니다. 타이어 의미 색상은 팀 색상과 독립적으로 유지됩니다.</footer>
  </section>;
}
