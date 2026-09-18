"use client";

import { useId, useMemo, useState } from "react";
import { FLAG_LABELS, INCIDENT_MODEL, INCIDENT_RULES_SOURCE, type IncidentSettings, type VirtualRace, virtualWallSecondsAt } from "./lib/virtual-incidents";
import type { RaceGridFrame } from "./lib/race-grid";
import { buildReplayTelemetryEvents, telemetryDriverName } from "./lib/replay-telemetry";
import { formatRaceTime } from "./lib/strategy";
import "./virtual-incidents.css";

export default function VirtualIncidentPanel({ settings, onApply, driverLabel, othersCount }: {
  settings: IncidentSettings; onApply: (settings: IncidentSettings) => void; driverLabel: string; othersCount: number;
}) {
  const id = useId();
  const [draft, setDraft] = useState(settings);
  const [seed, setSeed] = useState(String(settings.seed));
  const validSeed = /^\d+$/.test(seed) && Number(seed) <= 0xffffffff;
  const anyOther = (1 - (1 - draft.othersPercent / 100) ** othersCount) * 100;
  return <form className="incident-settings" onSubmit={event => {
    event.preventDefault();
    if (validSeed || !draft.enabled) onApply({ ...draft, seed: validSeed ? Number(seed) : settings.seed });
  }}>
    <div className="incident-settings__intro"><span>VIRTUAL RACE ONLY</span><h4>차량 접촉부터 사고까지.</h4>
      <p>차량 충돌 처리와 무작위 사고 확률을 따로 설정하세요. 실제 기록·추천 전략·기본 전략 점수는 바뀌지 않습니다.</p>
      <small>확률·심각도·지속시간은 실측 데이터가 아닌 가상 실험 가정입니다.</small></div>
    <label className="incident-settings__toggle"><input type="checkbox" checked={draft.collisionsEnabled ?? true}
      onChange={event => setDraft({ ...draft, collisionsEnabled: event.target.checked })} />차량 충돌 처리</label>
    <p>앞차를 피할 공간이 있으면 옆으로 이동하고, 없으면 감속합니다. 접촉 시 시간 손실과 12초 구간 옐로우가 발생합니다. 무작위 사고 확률이 0%여도 차량 접촉은 발생할 수 있습니다.</p>
    <label className="incident-settings__toggle"><input type="checkbox" checked={draft.enabled}
      onChange={event => setDraft({ ...draft, enabled: event.target.checked })} />가상 사고 켜기</label>
    <fieldset disabled={!draft.enabled}><legend className="sr-only">가상 레이스 사고 조건</legend>
      {([{ key: "playerPercent", title: `선택한 선수 · ${driverLabel}`, note: "이 선수의 한 경기 사고 확률" },
        { key: "othersPercent", title: `다른 선수 · ${othersCount}명 각각`, note: "선택하지 않은 선수 한 명당 한 경기 사고 확률" }] as const).map(item =>
        <div className="incident-settings__probability" key={item.key}>
          <label htmlFor={`${id}-${item.key}`}>{item.title}<strong>{draft[item.key]}%</strong></label>
          <input id={`${id}-${item.key}`} type="range" min={0} max={100} step={1} value={draft[item.key]}
            onChange={event => setDraft({ ...draft, [item.key]: Number(event.target.value) })} />
          <small>{item.note} · 0% 없음 / 100% 반드시 발생</small>
        </div>)}
      <p className="incident-settings__aggregate">다른 선수 중 최소 1명이 사고 날 확률 <strong>{anyOther.toFixed(1)}%</strong><small>각 선수 독립 추첨 · 선수당 최대 1건</small></p>
      <label className="incident-settings__field">사고 대응 방식
        <select value={draft.response} onChange={event => setDraft({ ...draft, response: event.target.value as IncidentSettings["response"] })}>
          <option value="auto">자동 · 가상 심각도에 따라 결정</option>
          <option value="YELLOW">실험 고정 · 옐로우 / 복귀</option><option value="VSC">실험 고정 · VSC / 리타이어</option>
          <option value="SC">실험 고정 · SC / 리타이어</option><option value="RED">실험 고정 · 레드 / 리타이어</option>
        </select>
      </label>
      <label className="incident-settings__field">재현 시드
        <input inputMode="numeric" value={seed} onChange={event => setSeed(event.target.value)} aria-invalid={!validSeed}
          aria-describedby={`${id}-seed-help`} />
      </label>
      <small id={`${id}-seed-help`}>{validSeed ? "같은 조건·시드 = 같은 사고. 다시 재생하거나 배속을 바꿔도 유지됩니다." : "0~4294967295 사이의 정수를 입력하세요."}</small>
      <button type="button" className="incident-settings__seed" onClick={() => setSeed(String(((Number(seed) || 0) + 1) >>> 0))}>다른 사건 조합 · 시드 +1</button>
    </fieldset>
    <button className="incident-settings__apply" type="submit" disabled={draft.enabled && !validSeed}>설정 적용 · 출발 전으로 초기화</button>
    <details className="incident-settings__rules"><summary>깃발 효과·가정·출처</summary>
      <dl><dt>차량 접촉</dt><dd>차체 길이·폭을 기준으로 연속 충돌 판정. 접촉 차량 2초 감속·12초 구간 옐로우. 정차·DNF는 강제하지 않습니다. 피트 복귀 차량은 빈 공간을 기다립니다.</dd>
        <dt>확률 사고 · 옐로우</dt><dd>사고 차량 12초 정차 후 복귀. 30초 동안 해당 가상 섹터 감속·추월 제한.</dd>
        <dt>VSC</dt><dd>60초간 전 구간 감속·트랙 추월 제한. 대열을 강제로 압축하지 않습니다.</dd>
        <dt>SC</dt><dd>150초간 선두 감속·후속 차량 대열 압축·트랙 추월 제한.</dd>
        <dt>레드</dt><dd>90초간 모든 차량 진행 정지 → 60초 SC 재출발 → 정상 주행.</dd></dl>
      <p>자동 대응 비율: 옐로우 45% / VSC 25% / SC 25% / 레드 5%. 모두 교육용 가정이며 공식 사고 통계가 아닙니다. 확률은 EA 능력치·날씨에 자동 가중하지 않습니다.</p>
      <p>VSC·SC·레드 사고 차량은 DNF 처리합니다. 피트 작업은 감속 중 정상 속도로 진행하며 레드 중에는 멈춥니다. 레드는 현 위치 동결로 단순화합니다. 충돌은 서킷을 따라 움직이는 차체 영역으로 단순화하며, 강체 물리·차량 파손·전복·방호벽 충돌은 구현하지 않습니다. 실제 피트 집결·무료 타이어 교체·재출발 그리드·사고 중 타이어 온도 변화는 재현하지 않습니다. SC 차량 3D 모델 대신 대열 제어로 구현합니다.</p>
      <a href={INCIDENT_RULES_SOURCE} target="_blank" rel="noreferrer">FIA 2026 Sporting Regulations · B1.8 / B5.12–15</a>
      <small>깃발의 의미만 참고. 시간·감속률·사고 대응 비율·3분할 섹터는 프로젝트 가정입니다. 이 옵션은 이 가상 주행에만 적용되며 기존 Monte Carlo 표본에는 합산하지 않습니다.</small>
    </details>
  </form>;
}

export function VirtualIncidentLog({ race, frame, onSeek, hasStarted = true }: { race: VirtualRace; frame: RaceGridFrame; onSeek: (seconds: number) => void; hasStarted?: boolean }) {
  const events = useMemo(() => {
    const baseline = buildReplayTelemetryEvents(race.grid).flatMap(event => {
      const time = event.driverId ? virtualWallSecondsAt(race, event.driverId, event.atSeconds) : 0;
      if (time === null) return [];
      return [{ id: event.id, time, label: `${event.driverId ? event.driverName + " · " : ""}${event.kind === "start" ? "출발" : event.kind === "finish" ? "완주" : event.kind === "pit-entry" ? "피트 진입" : event.kind === "pit-exit" ? "피트 복귀" : "타이어 성능 급락"}` }];
    });
    const incidents = race.incidents.flatMap(event => [
      { id: event.id, time: event.startSeconds, label: `${event.kind === "collision" ? event.label : telemetryDriverName(event.driverId, event.label)} · L${event.lap} S${event.sector} · ${FLAG_LABELS[event.flag]} · ${event.kind === "collision" ? "차량 접촉 · 감속" : event.retired ? "DNF" : "스핀 후 복귀"}` },
      ...(!event.retired && event.kind !== "collision" ? [{ id: `${event.id}:recovery`, time: event.startSeconds + INCIDENT_MODEL.recoverySeconds, label: `${event.label} · 스핀 후 주행 복귀` }] : []),
      { id: `${event.id}:end`, time: event.endSeconds, label: `${event.label} 사고 통제 종료${event.flag === "RED" ? " · SC 재출발" : " · 다른 통제 구간은 유지"}` },
      ...(event.flag === "RED" ? [{ id: `${event.id}:restart`, time: event.restartEndSeconds, label: "레드 이후 SC 재출발 구간 종료" }] : []),
    ]);
    return [...baseline, ...incidents].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  }, [race]);
  const occurred = hasStarted ? events.filter(event => event.time <= frame.elapsedSeconds) : [];
  return <div className="incident-log">
    <p>가상 충돌·사고 적용 기록 · {race.settings.enabled ? `사고 시드 ${race.settings.seed} · ` : ""}경과 시간에는 접촉·감속·레이스 중단 시간이 포함됩니다.</p>
    <div className="incident-log__table"><table><caption>가상 레이스 전체 순위</caption><thead><tr><th>순위</th><th>선수</th><th>랩</th><th>상태</th><th>선두 간격</th></tr></thead>
      <tbody>{frame.cars.map(car => <tr key={car.id} data-player={car.id === race.playerId}><td>{car.position}</td>
        <th scope="row">{telemetryDriverName(car.id, car.label)}{car.id === race.playerId ? " · 내 차" : ""}</th><td>{car.lap}</td>
        <td>{car.retired ? "DNF" : car.completed ? "완주" : car.incidentStopped ? "사고 · 정차" : car.isPitting ? "PIT" : (car.contactPulse ?? 0) > 0 ? "접촉 · 감속" : car.compound}</td>
        <td>{car.retired ? "—" : car.position === 1 ? "선두" : `+${car.gapToLeaderSeconds.toFixed(1)}초`}</td></tr>)}</tbody></table></div>
    <h4>발생한 이벤트 · {occurred.length}건</h4><p>미래 사건은 표시하지 않습니다. 항목을 누르면 해당 시점으로 이동합니다.</p>
    <ol className="incident-log__events">{occurred.slice().reverse().map(event => <li key={event.id}><button type="button" onClick={() => onSeek(event.time)}>
      <time>{formatRaceTime(event.time, 0)}</time><span>{event.label}</span></button></li>)}</ol>
  </div>;
}
