import evidence from "./data/wet-weather-2025.json";
import { TRACK_PRESETS, type TrackPresetId } from "./lib/strategy";

const tyreLabel = (compound: string) => ({ DRY: "슬릭", INTERMEDIATE: "인터", WET: "웨트" }[compound] ?? compound);
export const wetRainLabel = (value: boolean | null | undefined) => value === true ? "강수 관측" : value === false ? "강수 미관측" : "강수 자료 미확보";
const seconds = (value: number | null | undefined) => value == null ? "미확보" : `${value > 0 ? "+" : ""}${value.toFixed(3)}초`;
const metric = (value: number | null | undefined, unit: string) => value == null ? "미확보" : `${value}${unit}`;
type DifferencePoint = (typeof evidence.events)[number]["sameLapComparisons"][number];

function DifferencePlot({ points, title }: { readonly points: readonly DifferencePoint[]; readonly title: string }) {
  const minimum = Math.min(0, ...points.map(point => point.firstMinusSecondSeconds));
  const maximum = Math.max(0, ...points.map(point => point.firstMinusSecondSeconds));
  const span = maximum - minimum || 1;
  const x = (value: number) => 120 + (value - minimum) / span * 470;
  const height = points.length * 30 + 48;
  return <svg viewBox={`0 0 720 ${height}`} width="100%" role="img" aria-label={`${title}. 같은 랩 중앙값 차이 ${points.length}개. 정확한 수치는 아래 표에서 확인할 수 있습니다.`}>
    <line x1={x(0)} x2={x(0)} y1="4" y2={height - 24} stroke="currentColor" strokeDasharray="3 4" opacity="0.4" />
    {points.map((point, index) => <g key={point.lap}>
      <text x="0" y={index * 30 + 20} fill="currentColor" fontSize="13">L{point.lap} · {point.firstSamples}/{point.secondSamples}대</text>
      <line x1={x(0)} x2={x(point.firstMinusSecondSeconds)} y1={index * 30 + 16} y2={index * 30 + 16} stroke="currentColor" opacity="0.4" />
      <circle cx={x(point.firstMinusSecondSeconds)} cy={index * 30 + 16} r="4" fill="currentColor" />
      <text x="714" y={index * 30 + 20} textAnchor="end" fill="currentColor" fontSize="13">{seconds(point.firstMinusSecondSeconds)}</text>
    </g>)}
    <text x={x(0)} y={height - 4} textAnchor="middle" fill="currentColor" fontSize="12">0초</text>
  </svg>;
}

export default function WetEvidencePanel() {
  return <section className="weather-evidence" aria-labelledby="wet-evidence-title">
    <h3 id="wet-evidence-title">젖은 노면 · 실제 기록과 관측 비교</h3>
    <p>2025 호주·영국·벨기에의 랩에 강수 여부·노면 온도·습도를 연결했습니다. 같은 번호 랩의 다른 차량 중앙값 비교이며, 같은 시각의 통제 실험이나 타이어만의 인과 효과가 아닙니다. 서로 다른 경기는 합치지 않습니다.</p>
    <div className="analysis-table-wrap" role="region" tabIndex={0} aria-label="우천 경기별 표본, 좌우 스크롤 가능"><table><caption>정제 후 타이어별 관측 표본</caption><thead><tr><th scope="col">서킷</th><th scope="col">슬릭 랩</th><th scope="col">인터 랩</th><th scope="col">웨트 랩</th><th scope="col">동랩 비교</th><th scope="col">타이어 종류 전환</th></tr></thead><tbody>
      {evidence.events.map(event => <tr key={event.trackId}><th scope="row">{TRACK_PRESETS[event.trackId as TrackPresetId].koreanName}</th>{["DRY", "INTERMEDIATE", "WET"].map(compound => <td key={compound}>{event.retainedCompoundSummary.find(row => row.compound === compound)?.laps ?? 0}</td>)}<td>{event.sameLapComparisons.length}개 랩</td><td>{event.actualTyreChanges == null ? "미확보" : `${event.actualTyreChanges.length}건`}</td></tr>)}
    </tbody></table></div>

    {evidence.events.map(event => {
      const track = TRACK_PRESETS[event.trackId as TrackPresetId].koreanName;
      const coverage = event.weatherJoinCoverage;
      return <details key={event.trackId}><summary>{track} · 동랩 차이 분포와 실제 타이어 전환</summary>
        <p>{event.collectionStatus === "cache-refreshed-no-network" ? "기존 타이밍 캐시에서 확인 · 네트워크 재수집 없음" : "캐시 미확보 · 저장된 요약만 사용"}. {event.timingSourceUrl && <><a href={`${event.timingSourceUrl}SessionInfo.json`} target="_blank" rel="noreferrer">공식 경기 정보 ↗</a> · <a href={`${event.timingSourceUrl}WeatherData.jsonStream`} target="_blank" rel="noreferrer">기상 원문 ↗</a> · <a href={`${event.timingSourceUrl}TimingAppData.jsonStream`} target="_blank" rel="noreferrer">타이어 타이밍 원문 ↗</a></>}</p>
        {event.sameLapDifferenceDistributions.length ? event.sameLapDifferenceDistributions.map(distribution => <div key={`${distribution.firstCompound}-${distribution.secondCompound}`}>
          <h4>{tyreLabel(distribution.firstCompound)} − {tyreLabel(distribution.secondCompound)} · {distribution.statistics.count}개 랩</h4>
          <p>양수는 뒤 타이어가 더 빨랐다는 뜻입니다. 최소 {seconds(distribution.statistics.min)} · Q1 {seconds(distribution.statistics.q1)} · 중앙값 {seconds(distribution.statistics.median)} · Q3 {seconds(distribution.statistics.q3)} · 최대 {seconds(distribution.statistics.max)}. {distribution.statistics.count === 1 ? "표본이 하나라 모든 요약값이 같습니다." : "작은 관측 표본의 산포이며 신뢰구간이 아닙니다."}</p>
          <div className="analysis-table-wrap" role="region" tabIndex={0} aria-label={`${track} 관측점 분포, 좌우 스크롤 가능`}><div style={{ minWidth: "32rem" }}><DifferencePlot points={distribution.points} title={`${track} ${tyreLabel(distribution.firstCompound)}와 ${tyreLabel(distribution.secondCompound)} 차이`} /></div></div>
        </div>) : <p>같은 랩에 서로 다른 타이어 종류를 비교할 정제 표본이 없습니다. 차이를 0초로 표시하거나 다른 경기에서 가져오지 않습니다.</p>}
        {event.sameLapComparisons.length > 0 && <div className="analysis-table-wrap" role="region" tabIndex={0} aria-label={`${track} 동랩 비교 개별점`}><table><caption>개별 관측값 · 서로 다른 차량 표본 수 포함</caption><thead><tr><th scope="col">랩</th><th scope="col">비교</th><th scope="col">차량 표본</th><th scope="col">중앙값 차이</th><th scope="col">노면</th><th scope="col">습도</th><th scope="col">강수 센서</th></tr></thead><tbody>
          {event.sameLapComparisons.map(row => <tr key={`${row.lap}-${row.firstCompound}-${row.secondCompound}`}><th scope="row">L{row.lap}</th><td>{tyreLabel(row.firstCompound)} − {tyreLabel(row.secondCompound)}</td><td>{row.firstSamples}대 / {row.secondSamples}대</td><td>{seconds(row.firstMinusSecondSeconds)}</td><td>{metric(row.trackTempC, "°C")}</td><td>{metric(row.humidityPercent, "%")}</td><td>{wetRainLabel(row.rainfallTrue)}</td></tr>)}
        </tbody></table></div>}

        <h4>관측 우위의 부호 변화</h4>
        {event.observedSignChangeIntervals.length ? event.observedSignChangeIntervals.map(change => <p key={`${change.fromLap}-${change.toLap}`}>
          L{change.fromLap}의 {seconds(change.before.firstMinusSecondSeconds)}({change.before.firstSamples}/{change.before.secondSamples}대, {wetRainLabel(change.before.rainfallTrue)}) → L{change.toLap}의 {seconds(change.after.firstMinusSecondSeconds)}({change.after.firstSamples}/{change.after.secondSamples}대, {wetRainLabel(change.after.rainfallTrue)}).
          중간 {change.unobservedLapsBetween}개 랩의 동시 비교가 없어 정확한 전환 랩은 미확보입니다. 이 구간은 관측 부호 변화이지 최적 피트 랩이나 실측 수막 교차점이 아닙니다.
        </p>) : <p>확보한 같은 랩 비교에서는 부호 변화 구간을 확인할 수 없습니다. 전환이 없었다는 뜻은 아닙니다.</p>}

        <details><summary>타이어별 전체 랩타임 분포 · 서로 다른 주행 구간 포함</summary>
          <p>각 종류가 쓰인 레이스 구간·선수·타이어 수명이 다릅니다. 이 전체 분포의 차이를 타이어 성능 차이로 해석하지 마세요.</p>
          <div className="analysis-table-wrap" role="region" tabIndex={0} aria-label={`${track} 타이어별 랩타임 분포`}><table><thead><tr><th scope="col">타이어</th><th scope="col">표본</th><th scope="col">최소</th><th scope="col">Q1</th><th scope="col">중앙값</th><th scope="col">Q3</th><th scope="col">최대</th></tr></thead><tbody>{event.retainedCompoundSummary.map(row => <tr key={row.compound}><th scope="row">{tyreLabel(row.compound)}</th><td>{row.laps}랩 · {row.drivers}명</td>{(["min", "q1", "median", "q3", "max"] as const).map(key => <td key={key}>{seconds(row.lapTimeDistribution?.[key])}</td>)}</tr>)}</tbody></table></div>
        </details>
        <details><summary>실제 타이어 종류 전환 · {event.actualTyreChanges?.length ?? "미확보"}건</summary>
          <p>피트 기록이 있는 전환과 피트 표지가 없는 전환을 구분합니다. 기록된 교체 결정은 최적 전략이나 타이어 속도 교차점의 정답이 아닙니다. FastF1이 정정한 스틴트 정보가 포함될 수 있습니다.</p>
          {event.actualTyreChanges?.length ? <div className="analysis-table-wrap" role="region" tabIndex={0} aria-label={`${track} 실제 타이어 전환 기록`}><table><thead><tr><th scope="col">선수</th><th scope="col">전환</th><th scope="col">종료 랩 → 새 타이어 첫 랩</th><th scope="col">피트 근거</th><th scope="col">강수 센서</th></tr></thead><tbody>{event.actualTyreChanges.map((change, index) => <tr key={`${change.driver}-${change.afterLap}-${index}`}><th scope="row">{change.driver}</th><td>{tyreLabel(change.fromCompound)} → {tyreLabel(change.toCompound)}</td><td>L{change.afterLap} → L{change.firstLapOnNewTyre}</td><td>{change.pitTimingRecorded ? "피트 시각 확인" : "피트 표지 없음"}</td><td>{wetRainLabel(change.rainfall)}</td></tr>)}</tbody></table></div> : <p>확인 가능한 전환 원자료가 없습니다.</p>}
        </details>
        {coverage && <p>기상 조인 확인: 정제 {coverage.retainedLaps}랩 중 강수 {coverage.rainfallKnownLaps}, 노면 온도 {coverage.trackTempKnownLaps}, 습도 {coverage.humidityKnownLaps}랩 확보. 선택된 기상 샘플부터 해당 차량의 랩 종료까지 {metric(coverage.weatherAgeAtLapEndSeconds.min, "초")}–{metric(coverage.weatherAgeAtLapEndSeconds.max, "초")}. 이는 조인 시간차이며 센서 지연을 측정한 값이 아닙니다.</p>}
      </details>;
    })}

    <details><summary>우천 전용 정제·날씨 조인·보정 게이트</summary>
      <p>정상·정확성 확인 랩에서 피트 인/아웃, 첫 랩, 삭제·생성 랩, 녹색기 외 구간을 제외했습니다. 이 우천 요약에는 건식 회귀의 5랩 스틴트 필터·IQR 제거·홀드아웃 학습을 적용하지 않았습니다.</p>
      <p>날씨는 각 차량의 랩 안 첫 샘플을 사용하고, 없으면 랩 종료 전 마지막 값을 사용합니다. 분 단위 기상값의 보간이나 두 차량의 정확한 같은 시각 비교가 아닙니다. 모든 강수값이 없으면 미확보로 남기며, 강수 미관측은 마른 노면을 증명하지 않습니다.</p>
      <p><strong>자료 수집과 모델 보정은 별개</strong> · 웨트 및 인터–웨트 동랩 비교 표본과 수막 깊이·강수 강도 센서가 없어 관측 수막 교차점을 학습할 수 없습니다. 설정 화면의 수막 경계는 프로젝트 비용식의 결과이며 이 관측 자료로 보정된 값이 아닙니다.</p>
      <small>확인: {evidence.generatedAt.slice(0, 10)} · <a href={evidence.methodology.weatherJoinDocumentationUrl} target="_blank" rel="noreferrer">FastF1 자료 결합 방법 ↗</a></small>
    </details>
  </section>;
}
