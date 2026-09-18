"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { TEAM_PROFILES } from "./lib/participants";
import { buildRaceClassification, type RaceResultRow } from "./lib/race-results";
import { telemetryDriverName } from "./lib/replay-telemetry";
import { formatRaceTime, type TrackPreset } from "./lib/strategy";
import type { VirtualRace } from "./lib/virtual-incidents";
import { TYRE_COLORS, TYRE_LABELS } from "./model/params";
import "./race-results.css";

function identity(row: RaceResultRow) {
  const team = TEAM_PROFILES.find(team => team.drivers.some(driver => driver.id === row.id));
  const driver = team?.drivers.find(driver => driver.id === row.id);
  return { team, driver, name: driver?.lastName ?? row.label, color: team?.primary ?? "#a8b1bf" };
}
const styleFor = (row: RaceResultRow) => ({ "--result-team": identity(row).color }) as CSSProperties;
const gapText = (row: RaceResultRow) => row.retired ? "DNF" : row.finishSeconds === null ? "—" : row.position === 1
  ? formatRaceTime(row.finishSeconds) : row.gapSeconds === null ? "—" : `+${row.gapSeconds.toFixed(3)}`;
function TyreSequence({ row }: { row: RaceResultRow }) {
  return <span className="race-results__tyres" aria-label={row.stints.map(stint => `${TYRE_LABELS[stint.compound]} L${stint.startLap}–${stint.endLap}`).join(" → ")}>
    {row.stints.map((stint, index) => <span key={index} title={`${TYRE_LABELS[stint.compound]} · L${stint.startLap}–${stint.endLap}`}
      style={{ "--result-tyre": TYRE_COLORS[stint.compound] } as CSSProperties}>{stint.compound === "INTER" ? "I" : stint.compound === "WET" ? "W" : stint.compound}</span>)}
  </span>;
}

export default function RaceResults({ race, track, score, strategyDelta, onReplay, onEditStrategy, onOpenAnalysis, onReturnToTrack, fullscreen, onFullscreen }: {
  race: VirtualRace; track: TrackPreset; score: number | null; strategyDelta: number | null;
  onReplay: () => void; onEditStrategy?: () => void; onOpenAnalysis?: () => void;
  onReturnToTrack: () => void; fullscreen: boolean; onFullscreen: () => void;
}) {
  const result = useMemo(() => buildRaceClassification(race), [race]);
  const player = result.rows.find(row => row.id === race.playerId)!;
  const [page, setPage] = useState(0);
  const [view, setView] = useState<"classification" | "strategy">("classification");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  const visibleRows = result.rows.slice(page * 10, page * 10 + 10);
  const pages = Math.ceil(result.rows.length / 10);
  return <section className="race-results" aria-labelledby="race-results-title">
    <header className="race-results__header">
      <div className="race-results__brand">COMPOUND<span>RACE CONTROL</span></div>
      <div className="race-results__title"><p>{track.country} · {track.koreanName}</p>
        <h3 ref={heading} tabIndex={-1} id="race-results-title">RACE CLASSIFICATION</h3></div>
      <div className="race-results__session"><span>시뮬레이션 결과</span><strong>{race.grid.totalLaps}<small> LAPS</small></strong></div>
      <button className="race-results__expand" type="button" onClick={onFullscreen}>{fullscreen ? "전체화면 나가기" : "전체화면"}</button>
    </header>

    <div className="race-results__body">
      <div className="race-results__classification">
        <div className="race-results__toolbar">
          <div className="race-results__tabs" role="group" aria-label="결과표 보기">
            <button type="button" aria-pressed={view === "classification"} onClick={() => setView("classification")}>최종 순위</button>
            <button type="button" aria-pressed={view === "strategy"} onClick={() => setView("strategy")}>타이어 전략</button>
          </div>
          <div className="race-results__pages" role="group" aria-label="순위 범위">
            {Array.from({ length: pages }, (_, index) => <button type="button" key={index} aria-pressed={page === index} onClick={() => setPage(index)}>
              {index * 10 + 1}–{Math.min(result.rows.length, index * 10 + 10)}</button>)}
          </div>
        </div>
        <div className="race-results__table-wrap" tabIndex={0} aria-label="가상 레이스 결과표, 가로 스크롤 가능">
          <table className="race-results__table"><caption className="sr-only">{view === "classification" ? "최종 순위" : "완료한 타이어 전략"} · {page * 10 + 1}위부터</caption>
            <thead><tr><th scope="col">POS</th><th scope="col">DRIVER <small>선수 / 팀</small></th>
              {view === "classification" ? <><th scope="col">GAP <small>기록 / 격차</small></th><th scope="col">PIT</th><th scope="col">±</th></>
                : <><th scope="col">TYRE STRATEGY <small>실제 주행 구간</small></th><th scope="col">LAPS</th></>}
            </tr></thead>
            <tbody>{visibleRows.map(row => {
              const person = identity(row);
              return <tr key={row.id} data-player={row.id === race.playerId} data-retired={row.retired} style={styleFor(row)}>
                <td className="race-results__position">{row.position.toString().padStart(2, "0")}</td>
                <th scope="row" className="race-results__driver"><span>{person.name}<i>{row.id === race.playerId ? "YOU" : person.driver?.number ?? ""}</i></span><small>{person.team?.name ?? row.label}</small></th>
                {view === "classification" ? <><td className="race-results__gap">{gapText(row)}{row.retired && <small>{row.completedLaps} LAPS</small>}</td><td>{row.stops}</td>
                  <td className="race-results__change" data-direction={row.positionChange !== null && row.positionChange > 0 ? "up" : row.positionChange !== null && row.positionChange < 0 ? "down" : "same"}>
                    {row.positionChange === null || row.positionChange === 0 ? "—" : `${row.positionChange > 0 ? "↑" : "↓"}${Math.abs(row.positionChange)}`}</td></>
                  : <><td><div className="race-results__stint-bar" aria-label={`${row.label} 타이어별 주행 랩`}>
                    {row.stints.map((stint, index) => <span key={index} style={{ width: `${stint.distanceLaps / race.grid.totalLaps * 100}%`, background: TYRE_COLORS[stint.compound], color: stint.compound === "S" || stint.compound === "WET" ? "#fff" : "#101117" }}
                      title={`${TYRE_LABELS[stint.compound]} · L${stint.startLap}–${stint.endLap}`}>{stint.compound === "INTER" ? "I" : stint.compound === "WET" ? "W" : stint.compound}</span>)}
                  </div></td><td>{row.completedLaps}{row.retired && <small>DNF</small>}</td></>}
              </tr>;
            })}</tbody>
          </table>
        </div>
        <div className="race-results__table-note"><span>완주 {result.finishers} / {result.rows.length}</span><span>피트 {result.totalStops}회</span><span>차량 접촉 {result.totalContacts}건</span></div>
        {page !== Math.floor((player.position - 1) / 10) && <button className="race-results__find-me" type="button" onClick={() => setPage(Math.floor((player.position - 1) / 10))}>내 결과 보기 · {player.retired ? "DNF" : `P${player.position}`} {identity(player).name}</button>}
      </div>

      <aside className="race-results__summary" aria-label="포디움과 내 레이스 요약">
        <div className="race-results__podium">
          <h4>PODIUM <span>상위 3명</span></h4>
          {result.podium.length ? <div className="race-results__podium-drivers">{result.podium.map(row => {
            const person = identity(row);
            return <div key={row.id} className="race-results__podium-driver" data-position={row.position} style={styleFor(row)}>
              <span className="race-results__podium-number">{row.position.toString().padStart(2, "0")}</span>
              {person.driver && <img src={person.driver.headshotUrl} alt="" loading="lazy" onError={event => { event.currentTarget.style.visibility = "hidden"; }} />}
              <strong>{person.name}</strong><small>{person.team?.name ?? ""}</small>
            </div>;
          })}</div> : <p className="race-results__no-finisher">완주한 선수가 없습니다.</p>}
        </div>
        <div className="race-results__personal" style={styleFor(player)}>
          <div className="race-results__personal-heading"><span>YOUR RACE <small>내 레이스</small></span><strong>{player.retired ? "DNF" : `P${player.position}`}</strong></div>
          <p>{telemetryDriverName(player.id, player.label)} <span>출발 P{player.gridPosition}</span></p>
          <dl><div><dt>{player.retired ? "완료 랩" : "완주 시간"}</dt><dd>{player.retired ? `${player.completedLaps} / ${race.grid.totalLaps}` : formatRaceTime(player.finishSeconds!)}</dd></div>
            <div><dt>베스트 랩</dt><dd>{player.fastestLap ? formatRaceTime(player.fastestLap.seconds) : "—"}</dd></div>
          </dl>
          <TyreSequence row={player} /><small className="race-results__pit-laps">{player.pitLaps.length ? player.pitLaps.map(lap => `L${lap}`).join(" / ") + " 종료 후 교체" : "완료한 피트 스톱 없음"}</small>
        </div>
        <div className="race-results__fastest"><span>FASTEST LAP <small>가상 주행</small></span>
          <strong>{result.fastest?.fastestLap ? formatRaceTime(result.fastest.fastestLap.seconds) : "—"}</strong>
          <p>{result.fastest ? `${identity(result.fastest).name} · LAP ${result.fastest.fastestLap!.lap}` : "완료한 랩 없음"}</p>
        </div>
        <details className="race-results__model"><summary>전략 점수 {score ?? "—"} / 100 <span>계산 기준</span></summary>
          <p>DP 최적해 대비 {strategyDelta === null ? "비교 불가" : `${strategyDelta >= 0 ? "+" : ""}${strategyDelta.toFixed(3)}초`}. 점수는 사고 운을 제외한 기본 전략 평가입니다. 위 완주 시간·순위에는 교통·접촉·사고를 반영합니다.</p>
        </details>
      </aside>
    </div>

    <footer className="race-results__footer"><div className="race-results__actions">
      <button type="button" className="is-primary" onClick={onReplay}>같은 전략 다시 주행</button>
      {onEditStrategy && <button type="button" onClick={onEditStrategy}>전략 수정</button>}
      {onOpenAnalysis && <button type="button" onClick={onOpenAnalysis}>데이터 분석</button>}
      <button type="button" onClick={onReturnToTrack}>주행 화면으로</button>
    </div><p>전 차량 종료까지 계산한 가상 결과 · 실측 기록 및 공식 FIA 분류가 아닙니다.</p>
      <details className="race-results__sources"><summary>화면 참고 출처</summary><p><a href="https://www.formula1.com/en/results/2025/races/1254/australia/race-result" target="_blank" rel="noreferrer">F1 공식 Race Result</a> · <a href="https://pbs.twimg.com/media/GJaaGZ-WMAA6OPW?format=jpg&name=medium" target="_blank" rel="noreferrer">Race Classification 중계 그래픽</a> · <a href="https://liveblog.digitalimages.sky/lc-images-sky/lcimg-b9011770-87d8-44b8-9848-efeafdd00dd2.png" target="_blank" rel="noreferrer">Sky Sports 결과 그래픽</a></p></details>
    </footer>
  </section>;
}
