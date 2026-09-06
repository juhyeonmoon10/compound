import { buildWeatherTimeline, calculatedCrossovers, type WeatherInput, type RainPreset } from "./lib/weather";
import { RAIN_LABELS, TYRE_COLORS, TYRE_LABELS } from "./model/params";
import "./weather.css";

export default function WeatherControls({ value, laps, temperatureC, onChange }: { value: WeatherInput; laps: number; temperatureC: number; onChange: (value: WeatherInput) => void }) {
  const timeline = buildWeatherTimeline(laps, temperatureC, value);
  const cross = calculatedCrossovers();
  const start = timeline.input.startLap!, end = timeline.input.endLap!;
  return <fieldset className="weather-controls">
    <legend>강수와 수막 <small>프로젝트 추정</small></legend>
    <label>강수 프리셋<select value={value.preset} onChange={event => onChange({ preset: event.target.value as RainPreset })}>
      {Object.entries(RAIN_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
    </select></label>
    {value.preset !== "none" && <div className="weather-controls__range">
      <label>비 시작 랩<input aria-label="비 시작 랩" type="number" min={1} max={end} value={start} onChange={e => onChange({ ...value, startLap: Math.min(end, Math.max(1, Math.round(Number(e.target.value)))), endLap: end })} /></label>
      <label>비 끝 랩<input aria-label="비 끝 랩" type="number" min={start} max={laps} value={end} onChange={e => onChange({ ...value, startLap: start, endLap: Math.max(start, Math.min(laps, Math.round(Number(e.target.value)))) })} /></label>
    </div>}
    <div className="water-preview" role="img" aria-label={`전체 ${laps}랩 수막. 최대 ${Math.max(...timeline.laps.map(l => l.water)).toFixed(2)} · 프로젝트 추정`}>
      {timeline.laps.map(lap => <i key={lap.lap} style={{ height: `${lap.water * 100}%`, background: TYRE_COLORS.WET }} title={`L${lap.lap} · 수막 ${lap.water.toFixed(2)} · ${lap.raining ? "비" : "비 없음"}`} />)}
    </div>
    <p>슬릭 → 인터: 수막 {cross.slickInter.toFixed(2)} 초과 · 인터 → 웨트: 약 {cross.interWet.toFixed(2)} <small>프로젝트 추정</small></p>
    <details><summary>교차점·규칙 해석</summary><p>{cross.note} 요청 식에서 0.12·0.55는 교차점이 아닙니다. 타이어 마모·과열 누적·선수 능력치까지 더한 실제 전환점은 달라집니다.</p><p>FIA 건식 2종 의무는 해당 차량이 인터·웨트를 실제 사용했을 때 면제됩니다. 비 구간이 있다는 이유만으로 모든 전략을 면제하지 않습니다. <a href="https://www.fia.com/system/files/documents/fia_2026_f1_regulations_-_section_b_sporting_-_iss_08_-_2026-08-05_7.pdf" target="_blank" rel="noreferrer">공식 자료 · B6.3.6</a></p></details>
    <div className="weather-tyres">{Object.entries(TYRE_LABELS).map(([id,label]) => <span key={id} style={{ borderColor: TYRE_COLORS[id as keyof typeof TYRE_COLORS] }}>{label}</span>)}</div>
  </fieldset>;
}
