import evidence from "./data/wet-weather-2025.json";
import { TRACK_PRESETS, type TrackPresetId } from "./lib/strategy";

export default function WetEvidencePanel() {
  return <section className="weather-evidence" aria-labelledby="wet-evidence-title">
    <h3 id="wet-evidence-title">젖은 노면 · 실측 자료</h3>
    <p>2025 호주·영국·벨기에의 랩에 강수 여부·노면 온도·습도를 연결했습니다. 아래 차이는 같은 레이스 랩의 서로 다른 차량 중앙값 비교이며, 타이어만의 인과 효과가 아닙니다.</p>
    <div className="analysis-table-wrap"><table><caption>정제 후 타이어별 표본 · 실측</caption><thead><tr><th>서킷</th><th>슬릭 랩</th><th>인터 랩</th><th>웨트 랩</th><th>동일 랩 비교</th></tr></thead><tbody>
      {evidence.events.map(event => <tr key={event.trackId}><th>{TRACK_PRESETS[event.trackId as TrackPresetId].koreanName}</th>{["DRY","INTERMEDIATE","WET"].map(compound => <td key={compound}>{event.retainedCompoundSummary.find(row => row.compound === compound)?.laps ?? 0}</td>)}<td>{event.sameLapComparisons.length}</td></tr>)}
    </tbody></table></div>
    <details><summary>슬릭 − 인터 동랩 차이와 날씨 보기 · 실측</summary><div className="analysis-table-wrap"><table><thead><tr><th>서킷 / 랩</th><th>중앙값 차이</th><th>노면</th><th>습도</th><th>강수 센서</th></tr></thead><tbody>
      {evidence.events.flatMap(event => event.sameLapComparisons.map(row => <tr key={`${event.trackId}-${row.lap}`}><th>{TRACK_PRESETS[event.trackId as TrackPresetId].koreanName} L{row.lap}</th><td>{row.firstMinusSecondSeconds > 0 ? "+" : ""}{row.firstMinusSecondSeconds.toFixed(3)}초</td><td>{row.trackTempC}°C</td><td>{row.humidityPercent}%</td><td>{row.rainfallTrue ? "비" : "비 없음"}</td></tr>))}
    </tbody></table></div></details>
    <p><strong>프로젝트 추정 유지</strong> · Full Wet과 INTER–WET 동랩 비교 표본이 없어 교차 수막을 학습할 수 없습니다. 기상 센서의 강수 여부는 노면 수막 센서가 아닙니다. 기존 우천 계수는 실측 보정값이 아닙니다.</p>
    <small>확인: {evidence.generatedAt.slice(0,10)} · <a href="https://docs.fastf1.dev/core.html#fastf1.core.Laps.get_weather_data" target="_blank" rel="noreferrer">FastF1 자료 결합 방법</a></small>
  </section>;
}
