"use client";

import { useState } from "react";
import { HISTORICAL_EVIDENCE as evidence, OBSERVED_TRACK_IDS, evaluateHistoricalCoefficient, getHistoricalCalibration } from "./lib/historical-calibration";
import { RECENT_TEAM_EVIDENCE, OFFICIAL_TEAM_PACE_EVIDENCE, getRecentTeamPerformance, officialTeamPaceCoverage } from "./lib/recent-team-performance";
import { getAdoptedTeamPerformance } from "./lib/entry-performance";
import { TRACK_PRESETS, TRACK_PRESET_IDS, type TrackPresetId } from "./lib/strategy";
import { TEAM_PROFILES } from "./lib/participants";
import { MODEL_PARAMS, TYRE_LABELS } from "./model/params";
import { uiLabel } from "./ui-labels";
import "./historical-evidence.css";
import { PIT_LOSS_COVERAGE, loadPitLossRawEvidence } from "./lib/historical-calibration";

function PitLossEvidence() {
  const [status, setStatus] = useState("");
  const download = async () => {
    try {
      setStatus("피트 랩 원자료를 불러오는 중…");
      const raw = await loadPitLossRawEvidence();
      const url = URL.createObjectURL(new Blob([JSON.stringify(raw, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "compound-pit-loss-evidence.json"; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000); setStatus("원시 랩 근거를 내려받았습니다.");
    } catch { setStatus("자료를 내려받지 못했습니다. 다시 시도해 주세요."); }
  };
  return <details><summary>기존값과 관측 피트 손실 · 24개 서킷</summary><p>실측 기반 프로젝트 관측 추정 · (인랩 + 아웃랩) − 2 × 주변 정상 랩 중앙값. 정차 교체 시간과 다릅니다. 기존값과 {MODEL_PARAMS.historical.pitAdoptionDifferenceSeconds}초 이상 차이 나는 확보 값만 교체합니다. 기존 다경기 풀링 자료가 있으면 표본이 작은 단일 경기보다 우선합니다.</p>
    <div className="historical-evidence__table-scroll"><table><thead><tr><th>서킷</th><th>기존 가정</th><th>관측 중앙값</th><th>표본·출처</th><th>채택값</th></tr></thead><tbody>{PIT_LOSS_COVERAGE.map(row => { const result = getHistoricalCalibration(row.trackId); return <tr key={row.trackId}><th scope="row">{TRACK_PRESETS[row.trackId].koreanName}</th><td>{seconds(TRACK_PRESETS[row.trackId].pitLossSeconds, 2)}</td><td>{seconds(row.medianSeconds, 2)}</td><td>{row.samples || "—"}쌍<small>{row.sourceLabel}</small>{row.sourceUrls[0] && <a href={`${row.sourceUrls[0]}SessionInfo.json`} target="_blank" rel="noreferrer">공식 세션 ↗</a>}</td><td>{seconds(result.pitLossSeconds ?? TRACK_PRESETS[row.trackId].pitLossSeconds, 2)}<small>{result.pitLossSeconds === undefined ? "프로젝트 추정 유지" : "관측 추정 채택"}</small></td></tr>; })}</tbody></table></div><button type="button" onClick={download}>피트 원시 랩 JSON 내려받기</button><p role="status">{status}</p></details>;
}

const VIEWS = [{ id: "coverage", label: "수집·검증" }, { id: "calibration", label: "계수 채택" }, { id: "teams", label: "팀 관측" }] as const;
type EvidenceView = (typeof VIEWS)[number]["id"];
const count = (value: number) => value.toLocaleString("ko-KR");
const seconds = (value: number | null | undefined, digits = 3) => value == null ? "미확보" : `${value.toFixed(digits)}초`;

/** Separately renderable for source/absence and accessibility regression checks. */
export function TeamObservationEvidence() {
  const currentSeason = RECENT_TEAM_EVIDENCE.selection.currentSeason;
  const comparisonSeason = RECENT_TEAM_EVIDENCE.selection.comparisonSeason;
  return <div className="historical-evidence__content">
    <h3>공식 차트 · 실제 기록 분석 · 모델 채택을 구분합니다.</h3>
    <p>공식 팀별 페이스 차트의 미확보 값은 그대로 남겼습니다. 오른쪽은 FastF1 공개 타이밍을 같은 경기·컴파운드 안에서 정제한 프로젝트 분석이며, EA 선수 점수나 공식 Race Simulation Pace 차트 전사값이 아닙니다.</p>
    <div className="historical-evidence__metrics" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>{RECENT_TEAM_EVIDENCE.summary.bySeason.map(summary => <article key={summary.season}><span>{summary.season}년 팀 관측</span><strong>{summary.analysedEvents}<small>경기 · {summary.sourceTeamNames.length}팀</small></strong><p>원시 {count(summary.rawLaps)} → 정제 {count(summary.modelLaps)}랩</p></article>)}</div>
    <div className="historical-evidence__table-scroll" role="region" tabIndex={0} aria-label="공식 차트와 연도별 관측 및 채택값 비교, 좌우 스크롤 가능">
      <table><caption>페이스 단위: 초/랩. 관측치는 같은 컴파운드 중앙값 대비, 채택치는 가장 빠른 팀을 0초로 맞춘 프로젝트 보정입니다.</caption><thead><tr><th scope="col">팀</th><th scope="col">공식 차트 {OFFICIAL_TEAM_PACE_EVIDENCE.selection.requestedRaceCount}경기</th><th scope="col">{comparisonSeason} 관측 · 비교만</th><th scope="col">{currentSeason} 관측 · 우선 채택</th><th scope="col">채택 페이스 · 최속 0</th><th scope="col">채택 열화 배수</th><th scope="col">정차 교체 시간</th></tr></thead>
        <tbody>{TEAM_PROFILES.map(team => {
          const official = officialTeamPaceCoverage(team.id);
          const comparison = getRecentTeamPerformance(team.id, comparisonSeason);
          const applied = getAdoptedTeamPerformance(team.id);
          return <tr key={team.id}><th scope="row">{uiLabel(team.name)}</th>
            <td>{official.verifiedValues ? `${official.verifiedValues}경기 확인` : "미확보"}<small>확인 {official.verifiedValues} / {official.requestedEvents}경기 · 결측 제외</small></td>
            <td>{seconds(comparison.observedPaceSeconds)}<small>{comparison.source.events}경기 · {count(comparison.source.laps)}유효랩</small></td>
            <td>{seconds(applied.observedPaceSeconds)}<small>{applied.source.events}경기 · {count(applied.source.laps)}유효랩</small></td>
            <td>{seconds(applied.adoptedPaceSeconds)}<small>{applied.source.kind === "unavailable" ? "자료 미달 · 중립" : "프로젝트 축소·기준 보정"}</small></td>
            <td>{applied.degMultiplier.toFixed(3)}×<small>{applied.observedDegRatio === null ? "열화 신뢰 기준 미달 · 중립" : `관측 비율 ${applied.observedDegRatio.toFixed(3)}× · ${applied.source.degradationEvents}경기`}</small></td>
            <td>{seconds(applied.pitStationarySeconds)}<small>피트크루 보정 {applied.pitCrewDeltaSeconds}초 · 중립</small></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <p className="historical-evidence__callout">현재 {currentSeason}년의 유효 경기 {MODEL_PARAMS.historical.minTeamEvents}개 이상을 사용합니다. 경기 안에서는 유효 랩수로, 경기 간에는 동일 비중으로 집계한 뒤 페이스의 {MODEL_PARAMS.historical.teamPaceShrink * 100}%만 ±{MODEL_PARAMS.historical.maxTeamPaceSeconds}초 이내로 제한하고 최속 팀을 0초로 맞춥니다. 이 축소·상한·기준 이동은 공식 수치가 아닌 프로젝트 규칙입니다. 동일 성능 모드에서는 이 보정을 적용하지 않습니다.</p>
    <div className="historical-evidence__notes"><article><h4>2025 비교값은 섞지 않습니다.</h4><p>2026 규정·차량과 다른 2025 데이터는 비교용입니다. Audi·Cadillac은 2026 실제 팀 이름으로 관측됐습니다. 2025 Sauber를 Audi 2026 성능으로 바꾸지 않고, Cadillac의 과거값도 만들지 않았습니다.</p></article><article><h4>열화와 피트크루는 별도 기준입니다.</h4><p>열화는 양의 신뢰구간과 유효 {MODEL_PARAMS.historical.minTeamEvents}경기 기준을 추가로 확인합니다. 피트 진입·진출 시각 차이는 정차 교체 시간이 아니므로 정차 시간은 미확보로, 실행 보정은 중립으로 유지합니다.</p></article></div>
    <details><summary>공식 차트 자료 확인 결과 · {OFFICIAL_TEAM_PACE_EVIDENCE.selection.requestedRaceCount}경기</summary><p>기준 시각 {OFFICIAL_TEAM_PACE_EVIDENCE.selection.cutoffUtc}. 로그인 이후 자료는 우회하지 않았으며, 미확보를 0초로 평균 내지 않습니다.</p><div className="historical-evidence__table-scroll"><table><thead><tr><th>경기 날짜</th><th>공식 원문</th><th>숫자 확보 상태</th></tr></thead><tbody>{OFFICIAL_TEAM_PACE_EVIDENCE.events.map(event => <tr key={event.id}><th scope="row">{event.raceDate}</th><td><a href={event.source.url} target="_blank" rel="noreferrer">{event.label} 공식 자료 ↗</a></td><td>{event.availability === "article-found-content-gated" ? "로그인 이후 본문 미열람" : "공개 자료에서 차트 숫자 미확보"}</td></tr>)}</tbody></table></div></details>
    <details><summary>실제 관측의 출처·정제·불확실성</summary>
      <p>정확성 플래그, 녹색기, 비가 내리지 않는 것으로 기록된 기상, 타이어 수명과 스틴트 길이를 확인하고 피트·재출발 직후 랩을 제외했습니다. 회귀로 경기 진행·노면 온도·컴파운드 수명 영향을 조정해도 선수·교통·연료·에너지 운영의 영향은 남습니다. 비가 그친 기록만으로 마른 노면을 증명할 수 없습니다.</p>
      <p>2026 잔트포르트의 타이밍 무결성·랩 정렬 경고와 헝가리의 스틴트 자동 정정 경고를 원자료 메타정보에 보존했습니다. 실제 대체 출전 선수가 포함될 수 있으며, 그 선수의 팀 배정은 해당 경기 타이밍 기록을 따릅니다. 마모 구간은 적은 스틴트의 근사 신뢰구간으로 전체 예측 정확도를 뜻하지 않습니다.</p>
      <div className="historical-evidence__table-scroll"><table><thead><tr><th>경기</th><th>원시 → 정제</th><th>타이밍 원문</th></tr></thead><tbody>{RECENT_TEAM_EVIDENCE.events.map(event => <tr key={event.id}><th scope="row">{event.season} · {TRACK_PRESETS[event.trackId as TrackPresetId].koreanName}</th><td>{count(event.rawLaps)} → {count(event.modelLaps)}랩</td><td><a href={`${event.timingSourceUrl}SessionInfo.json`} target="_blank" rel="noreferrer">공식 세션 정보 ↗</a></td></tr>)}</tbody></table></div>
    </details>
  </div>;
}

export default function HistoricalEvidencePanel({ appliedTrackId = "melbourne", onApply }: { readonly appliedTrackId?: TrackPresetId; readonly onApply?: (trackId: TrackPresetId) => void }) {
  const [view, setView] = useState<EvidenceView>("coverage");
  const [trackId, setTrackId] = useState<TrackPresetId>(OBSERVED_TRACK_IDS.includes(appliedTrackId) ? appliedTrackId : "silverstone");
  const [downloadStatus, setDownloadStatus] = useState("");
  const track = TRACK_PRESETS[trackId];
  const calibration = getHistoricalCalibration(trackId);
  const selectedEvents = evidence.events.filter((event) => event.trackId === trackId);
  const downloadEvidence = async () => {
    setDownloadStatus("원시 집계 JSON을 불러오는 중입니다.");
    try {
      const raw = await import("./data/historical-dry-2023-2025.json");
      const url = URL.createObjectURL(new Blob([JSON.stringify(raw.default, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = "compound-historical-evidence-2023-2025.json"; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDownloadStatus("경기별 집계·회귀·출처가 포함된 JSON을 내려받았습니다.");
    } catch { setDownloadStatus("파일을 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요."); }
  };

  return <section className="historical-evidence" aria-labelledby="historical-evidence-title">
    <header className="historical-evidence__header">
      <div><span className="historical-evidence__eyebrow">실제 기록 → 검증 → 모델</span><h2 id="historical-evidence-title">주장보다 먼저, 근거를 확인하세요.</h2><p>타이어 계수는 2023–2025년, 팀 페이스는 별도 2025·2026년 공개 결승 기록입니다. 관측값과 프로젝트 채택값을 구분합니다.</p></div>
      <button type="button" onClick={downloadEvidence}>집계 JSON 내려받기 ↗</button>
    </header>
    <p className="historical-evidence__live" role="status">{downloadStatus}</p>
    <div className="historical-evidence__metrics">
      <article><span>실제 경기</span><strong>{evidence.summary.collectedDryEvents}<small>경기 · {evidence.summary.circuits}서킷</small></strong><p>2023 · 2024 · 2025</p></article>
      <article><span>기준 2차 모형 정제 후</span><strong>{count(evidence.summary.modelLaps)}<small>랩</small></strong><p>원시 {count(evidence.summary.rawLaps)}랩 · {count(evidence.summary.stints)}스틴트</p></article>
      <article><span>선택 모형 홀드아웃 MAE</span><strong>{evidence.selectedModelSummary.weightedHoldoutMaeSeconds?.toFixed(3) ?? "—"}<small>초/랩</small></strong><p>스틴트 뒤 25% · 모델 선택에는 사용 안 함</p></article>
      <article><span>피트 손실 관측 범위</span><strong>{PIT_LOSS_COVERAGE.filter((row) => row.status === "observational-estimate").length}<small>/ {TRACK_PRESET_IDS.length}서킷</small></strong><p>미확보 서킷은 가정값 유지</p></article>
    </div>
    <nav className="historical-evidence__views" aria-label="실제 데이터 상세 보기">{VIEWS.map((item) => <button type="button" key={item.id} aria-pressed={view === item.id} onClick={() => setView(item.id)}>{item.label}</button>)}</nav>

    {view === "coverage" && <div className="historical-evidence__content">
      <div className="historical-evidence__section-title"><h3>어느 경기까지 수집했나요?</h3><span>각 칸: 정제 랩 / 스틴트</span></div>
      <div className="historical-evidence__table-scroll"><table><thead><tr><th>서킷</th>{evidence.summary.byYear.map((year) => <th key={year.season}>{year.season}</th>)}<th>선택 모형 MAE</th></tr></thead><tbody>{OBSERVED_TRACK_IDS.map((id) => {
        const events = evidence.events.filter((event) => event.trackId === id);
        const testLaps = events.reduce((sum, event) => sum + (event.modelSelection?.validation.testLaps ?? 0), 0);
        const errorSum = events.reduce((sum, event) => sum + (event.modelSelection?.validation.absoluteErrorSumSeconds ?? 0), 0);
        return <tr key={id}><th scope="row">{TRACK_PRESETS[id].koreanName}</th>{evidence.summary.byYear.map((year) => { const event = events.find((item) => item.season === year.season); return <td key={year.season}>{event ? `${count(event.modelLaps)} / ${event.stints}` : "미수집"}</td>; })}<td>{seconds(testLaps ? errorSum / testLaps : null)}</td></tr>;
      })}</tbody><tfoot><tr><th>합계</th>{evidence.summary.byYear.map((year) => <td key={year.season}>{count(year.modelLaps)} / {count(year.stints)}</td>)}<td>{seconds(evidence.selectedModelSummary.weightedHoldoutMaeSeconds)}</td></tr></tfoot></table></div>
      <div className="historical-evidence__notes"><article><h4>어떻게 검증했나요?</h4><p>스틴트 앞 75%에서 제곱항의 유의성을 검사하고, 미유의 항은 제거한 뒤 선형 모형을 다시 적합합니다. 남겨 둔 뒤 25%는 예측 오차 측정에만 씁니다.</p></article><article><h4>오차는 무엇의 오차인가요?</h4><p>선택된 통계 회귀의 랩타임 오차입니다. 전체 전략 시뮬레이터나 실제 순위 예측의 정확도가 아닙니다. 모든 항을 2차로 둔 비교 모형 MAE는 {seconds(evidence.summary.weightedHoldoutMaeSeconds)}입니다.</p></article></div>
      <PitLossEvidence />
    </div>}

    {view === "calibration" && <div className="historical-evidence__content">
      <div className="historical-evidence__section-title"><h3>실측값을 그대로 넣지 않습니다.</h3><label>서킷 <select value={trackId} onChange={(event) => setTrackId(event.target.value as TrackPresetId)}>{TRACK_PRESET_IDS.map((id) => <option key={id} value={id}>{TRACK_PRESETS[id].koreanName}</option>)}</select></label></div>
      <p className="historical-evidence__callout">{calibration.summaryKorean}</p>
      <p>양의 β 신뢰구간과 변환 후 비음수 조건을 통과하면 2차항을 사용합니다. 그렇지 않으면 선형 회귀를 다시 적합해 α의 양의 구간을 확인합니다. 타이어 수명 1→0 기준 변환 시 α₀=α+2β, 상수 보정=α+β를 함께 적용합니다.</p>
      {!selectedEvents.length && <p className="historical-evidence__empty">이 서킷의 직접 관측은 없습니다. {calibration.sourceTrackId ? `${TRACK_PRESETS[calibration.sourceTrackId].koreanName}의 같은 열화 등급 자료를 참고하는 대체값입니다.` : "같은 열화 등급의 참조 자료도 없습니다."} 피트 손실은 다른 서킷에서 빌려오지 않습니다.</p>}
      <div className="historical-evidence__table-scroll"><table><thead><tr><th>경기·타이어</th><th>선택 모형</th><th>학습 α [95%]</th><th>학습 β [95%]</th><th>채택</th></tr></thead><tbody>{(selectedEvents.length ? selectedEvents : evidence.events.filter((event) => event.trackId === calibration.sourceTrackId)).flatMap((event) => (event.modelSelection?.coefficients ?? []).map((row) => { const gate = evaluateHistoricalCoefficient(row); return <tr key={`${event.id}-${row.compound}`}><th scope="row">{event.season} · {TYRE_LABELS[row.compound as "S" | "M" | "H"]}</th><td>{row.model === "quadratic" ? "2차" : "선형 재적합"}</td><td>{row.alphaSecondsPerLap == null ? "식별 불가" : <>{row.alphaSecondsPerLap.toFixed(4)}<small>[{row.alphaCI95?.map((x) => x.toFixed(4)).join(", ")}]</small></>}</td><td>{row.model === "linear" ? "제곱항 제외" : row.betaSecondsPerLapSquared == null ? "식별 불가" : <>{row.betaSecondsPerLapSquared.toFixed(5)}<small>[{row.betaCI95?.map((x) => x.toFixed(5)).join(", ")}]</small></>}</td><td><span className={gate.accepted ? "historical-evidence__accepted" : "historical-evidence__muted"}>{gate.accepted ? "채택" : "가정 유지"}</span><small>{gate.reason}</small></td></tr>; }))}</tbody></table></div>
      <p className="historical-evidence__muted">채택 계수는 학습 구간의 랩 수로 가중한 프로젝트 초깃값입니다. 경기별 S/M/H 절대 배합이 같다고 가정하거나 2026 실측값으로 표기하지 않습니다. 초기 속도 차이와 비선형 타이어 상태 비용은 가정값이 남습니다.</p>
      {onApply && <button type="button" className="historical-evidence__apply" onClick={() => onApply(trackId)}>{track.koreanName} 근거로 전략 비교하기 →</button>}
    </div>}

    {view === "teams" && <TeamObservationEvidence />}

  </section>;
}
