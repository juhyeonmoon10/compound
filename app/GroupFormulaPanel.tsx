import { useMemo, useState } from "react";
import { calculateGroupFormulaLap, DEFAULT_GROUP_FORMULA_PARAMETERS, validateGroupFormulaParameters, type GroupFormulaParameters, type GroupCompoundParameters } from "./lib/group-formula";
import { evaluateStrategy, TRACK_PRESETS, type StrategyOptimizerInput, type StrategyStintInput } from "./lib/strategy";
import "./group-formula.css";
import ModelDifferenceGuide from "./ModelDifferenceGuide";

type Props = {
  active: boolean;
  parameters: GroupFormulaParameters;
  legacyInput: StrategyOptimizerInput;
  groupInput: StrategyOptimizerInput;
  stints: readonly StrategyStintInput[];
  onApply: (active: boolean, parameters: GroupFormulaParameters) => void;
};
const cloneDefaults = () => structuredClone(DEFAULT_GROUP_FORMULA_PARAMETERS);
const finiteLabel = (n: number | null, unit = "") => n === null ? "미설정" : Number.isFinite(n) ? `${n.toFixed(1)}${unit}` : "제한 없음";

function NumberField({ label, value, onChange, min = 0, max, step = "any" }: {
  label: string; value: number | null; onChange: (value: number | null) => void; min?: number; max?: number; step?: string;
}) {
  return <label className="formula-number"><span>{label}</span><input type="number" min={min} max={max} step={step} value={value === null || Number.isNaN(value) ? "" : value}
    onChange={event => onChange(event.target.value === "" ? null : Number(event.target.value))} /></label>;
}

export default function GroupFormulaPanel({ active, parameters, legacyInput, groupInput, stints, onApply }: Props) {
  const [draft, setDraft] = useState(() => structuredClone(parameters));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(parameters);
  const comparison = useMemo(() => {
    try { return { original: evaluateStrategy({ ...legacyInput, stints }), group: evaluateStrategy({ ...groupInput, stints }), error: "" }; }
    catch (cause) { return { original: null, group: null, error: cause instanceof Error ? cause.message : "비교 계산에 실패했습니다." }; }
  }, [legacyInput, groupInput, stints]);
  const track = typeof groupInput.track === "object" ? groupInput.track : TRACK_PRESETS[groupInput.track ?? "melbourne"];
  const rows = useMemo(() => (["S", "M", "H"] as const).map(compound => ({ compound, ...calculateGroupFormulaLap({ parameters,
    compound, tyreAge: 0, baseLapTimeSeconds: groupInput.baseLapTimeSeconds ?? track.baseLapTimeSeconds,
    trackTemperatureC: groupInput.trackTemperatureC ?? 34, airTemperatureC: groupInput.airTemperatureC ?? 23,
    circuitLengthKm: groupInput.circuitLengthKm ?? track.circuitLengthKm ?? 1, pitLossSeconds: groupInput.pitLossSeconds ?? track.pitLossSeconds,
    wearMultiplier: groupInput.groupWearMultiplier }) })), [parameters, groupInput, track]);
  const apply = (nextActive: boolean, next = parameters) => {
    try {
      validateGroupFormulaParameters(next);
      onApply(nextActive, next);
      setError("");
      setNotice(`${nextActive ? "모둠 수식" : "기존"} 모델을 적용했습니다. 타이어와 교체 시점은 유지했습니다.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "계수를 확인하세요."); }
  };
  const setTemperature = (key: keyof GroupFormulaParameters["temperature"], value: number | null) =>
    setDraft(current => ({ ...current, temperature: { ...current.temperature, [key]: value ?? NaN } }));
  const setCompound = (compound: "S" | "M" | "H", key: keyof GroupCompoundParameters, value: number | null) =>
    setDraft(current => ({ ...current, compounds: { ...current.compounds, [compound]: { ...current.compounds[compound], [key]: value ?? NaN } } }));
  const delta = comparison.group && comparison.original ? comparison.group.totalSeconds - comparison.original.totalSeconds : 0;
  const costRows = [
    ["컴파운드 속도차 + 노면 수막", "compoundOffsetSeconds"], ["사용 연령에 따른 선형 열화", "linearDegradationSeconds"],
    ["기존: 2차 열화 / 모둠: 절벽 이후 추가 열화", "quadraticDegradationSeconds"],
    ["기존: 워밍업·온도·절벽 / 모둠: 온도만", "tyreStateLossSeconds"], ["피트 손실 (공통)", "pitLossSeconds"],
  ] as const;

  return <section className="formula-lab" aria-labelledby="formula-model-title">
    <div className="formula-lab__bar">
      <div><span className="formula-kicker">CALCULATION MODEL</span><h2 id="formula-model-title">계산 모델</h2></div>
      <div className="formula-toggle" role="group" aria-label="계산 모델 선택">
        <button type="button" aria-pressed={!active} onClick={() => apply(false)}>기존 모델</button>
        <button type="button" aria-pressed={active} onClick={() => apply(true)}>모둠 수식 <small>실험</small></button>
      </div>
      <p>{active ? "전략 계산·3D 주행에 모둠 수식 적용" : "기존 알고리즘 유지 · 모둠 식과 비교 가능"}</p>
    </div>
    {active && <p className="formula-scope">PDF 예시 + 명시된 가정값을 사용하는 실험 모델입니다. S·M·H에 적용하며, INTER·WET·수막·교통·사고는 기존 모델을 유지합니다.</p>}
    {error && <p className="formula-error" role="alert">{error}</p>}
    <p className="sr-only" role="status">{notice}</p>
    <ModelDifferenceGuide />
    <details className="formula-details">
      <summary>같은 전략으로 두 모델 비교 · 수식과 계수 설정</summary>
      <div className="formula-details__body">
        <h3>타이어와 피트 시점을 고정한 비교</h3>
        <p>지금 직접 편집한 전략을 양쪽 모델로 계산합니다. 서킷·선수·날씨·연료·피트 손실·스틴트 상한은 동일합니다. 짧게 예측한 모델이 더 정확하다는 뜻은 아닙니다.</p>
        {comparison.error && <p role="alert">{comparison.error}</p>}
        {comparison.original && comparison.group && <>
          <div className="formula-comparison">
            <article><span>기존 모델</span><strong>{comparison.original.formattedTime}</strong><small>{comparison.original.isLegal ? "공통 전략 제약 통과" : "전략 제약 위반 · 참고값"}</small></article>
            <article><span>모둠 수식 모델</span><strong>{comparison.group.formattedTime}</strong><small>{comparison.group.isLegal ? "공통 전략 제약 통과" : "전략 제약 위반 · 참고값"}</small></article>
            <article><span>모둠 − 기존</span><strong>{delta >= 0 ? "+" : "−"}{Math.abs(delta).toFixed(3)}초</strong><small>교통·사고 발생 전 결정론 계산</small></article>
          </div>
          <div className="formula-table-wrap"><table><caption>모델별 시간 비용 (초)</caption><thead><tr><th>비용 항목</th><th>기존</th><th>모둠</th></tr></thead>
            <tbody>{costRows.map(([label, key]) => <tr key={key}><th>{label}</th><td>{comparison.original!.breakdown[key].toFixed(3)}</td><td>{comparison.group!.breakdown[key].toFixed(3)}</td></tr>)}</tbody></table></div>
          <details><summary>랩별 비교 데이터</summary><div className="formula-table-wrap formula-table-wrap--laps"><table><thead><tr><th>랩</th><th>타이어</th><th>사용 연령</th><th>기존 랩타임</th><th>모둠 랩타임</th><th>모둠 온도</th><th>누적 차이</th></tr></thead><tbody>
            {comparison.original.lapCosts.map((lap, index) => { const other = comparison.group!.lapCosts[index]; return <tr key={lap.lap}><td>{lap.lap}</td><td>{lap.compound}</td><td>{lap.tyreAge}</td><td>{lap.lapTimeSeconds.toFixed(3)}</td><td>{other.lapTimeSeconds.toFixed(3)}</td><td>{finiteLabel(other.tyreState.temperatureC, "°C")}</td><td>{(other.cumulativeSeconds - lap.cumulativeSeconds).toFixed(3)}초</td></tr>; })}
          </tbody></table></div></details>
        </>}

        <details className="formula-coefficients"><summary>모둠 수식 계수 편집 {dirty ? "· 적용 전 변경 있음" : ""}</summary>
          <form onSubmit={event => { event.preventDefault(); apply(true, draft); }}>
            <h3>1. 타이어 온도 → 랩타임 손실 <small>PDF 6–8쪽</small></h3>
            <p>기본 적정 온도 90–110°C, 손실 계수 0.004는 PDF의 설명용 예시입니다. 현재 100°C는 앱의 시작값이며 실제 측정값이 아닙니다.</p>
            <label className="formula-select">타이어 온도 입력 방식<select value={draft.temperature.mode} onChange={event => setDraft(current => ({ ...current, temperature: { ...current.temperature, mode: event.target.value as "direct" | "estimated" } }))}>
              <option value="direct">타이어 온도 직접 입력</option><option value="estimated">노면·기온·코너 속도로 추정 (계수 필요)</option></select></label>
            <div className="formula-fields">
              {draft.temperature.mode === "direct" && <NumberField label="대표 타이어 온도 (°C)" value={draft.temperature.directC} min={-50} max={250} onChange={v => setTemperature("directC", v)} />}
              <NumberField label="적정 온도 하한 (°C)" value={draft.temperature.minC} max={250} onChange={v => setTemperature("minC", v)} />
              <NumberField label="적정 온도 상한 (°C)" value={draft.temperature.maxC} max={250} onChange={v => setTemperature("maxC", v)} />
              <NumberField label="저온 손실 계수 (s/°C²)" value={draft.temperature.coldCoeff} onChange={v => setTemperature("coldCoeff", v)} />
              <NumberField label="고온 손실 계수 (s/°C²)" value={draft.temperature.hotCoeff} onChange={v => setTemperature("hotCoeff", v)} />
            </div>
            {draft.temperature.mode === "estimated" && <><p className="formula-warning">PDF 3쪽의 식을 Ttyre = p·Ttrack + q·Tair + b·v² + c로 정리했습니다. p·q·b·c는 문서에 값이 없습니다. 초기값 1·0·0·0은 미보정 자리값입니다. v는 대표 코너 속도(m/s)로 해석하며 슬립 속도와 동일하다고 가정하지 않습니다. 시간에 따른 가열·냉각 모델은 아닙니다.</p><div className="formula-fields">
              <NumberField label="노면 영향 p" value={draft.temperature.p} onChange={v => setTemperature("p", v)} />
              <NumberField label="기온 영향 q" value={draft.temperature.q} onChange={v => setTemperature("q", v)} />
              <NumberField label="속도 가열 b (°C·s²/m²)" value={draft.temperature.speedHeatingCoeff} onChange={v => setTemperature("speedHeatingCoeff", v)} />
              <NumberField label="온도 상수 c (°C)" value={draft.temperature.constantC} min={-1000} onChange={v => setTemperature("constantC", v)} />
              <NumberField label="대표 코너 속도 (km/h → m/s 변환)" value={draft.temperature.cornerSpeedKmh} max={400} onChange={v => setTemperature("cornerSpeedKmh", v)} />
            </div></>}
            <p>현재 모델은 모든 건식 타이어에 동일한 대표 온도와 적정 구간을 적용합니다. 따라서 직접 온도만 바꾸면 건식 전략 전체에 같은 랩당 손실이 더해져, 최적 교체 시점은 같을 수 있습니다.</p>
            <h3>2. 컴파운드별 속도·열화·마모 <small>PDF 1·2·5·9쪽</small></h3>
            <p>평균 랩타임 89.8 / 90.2 / 90.6초와 거리 마모 1.2 / 1.0 / 0.8은 문서 예시입니다. β₁·β₂·절벽 연령·트레드 값은 실행을 위한 앱 가정값입니다. 실제 데이터에 맞춰 바꿔주세요.</p>
            <div className="formula-compounds">{(["S", "M", "H"] as const).map(compound => <fieldset key={compound}><legend>{compound} · {compound === "S" ? "소프트" : compound === "M" ? "미디엄" : "하드"}</legend>
              <NumberField label={`${compound} 평균 랩타임 (초)`} value={draft.compounds[compound].meanLapSeconds} min={.001} onChange={v => setCompound(compound, "meanLapSeconds", v)} />
              <NumberField label={`${compound} β₁ · 기본 열화 (초/랩)`} value={draft.compounds[compound].beta1} onChange={v => setCompound(compound, "beta1", v)} />
              <NumberField label={`${compound} β₂ · 절벽 후 추가 기울기`} value={draft.compounds[compound].beta2} onChange={v => setCompound(compound, "beta2", v)} />
              <NumberField label={`${compound} τ · 절벽 연령 (랩)`} value={draft.compounds[compound].cliffAge} min={1} onChange={v => setCompound(compound, "cliffAge", v)} />
              <NumberField label={`${compound} 거리 마모 계수 (지수/km)`} value={draft.compounds[compound].wearPerKm} onChange={v => setCompound(compound, "wearPerKm", v)} />
              <NumberField label={`${compound} 초기 트레드 (mm)`} value={draft.compounds[compound].treadMm} min={.001} onChange={v => setCompound(compound, "treadMm", v)} />
              <NumberField label={`${compound} 두께 감소 (mm/랩)`} value={draft.compounds[compound].treadWearPerLapMm} onChange={v => setCompound(compound, "treadWearPerLapMm", v)} />
            </fieldset>)}</div>
            <NumberField label="마모 지수 한계 Mmax (선택 · 비우면 비율 미계산)" value={draft.wearBudget} min={.001} onChange={v => setDraft(current => ({ ...current, wearBudget: v }))} />
            <p>거리 마모와 트레드 두께는 권장 길이·진단용입니다. 실제 고장 한계로 검증되지 않아 강제 리타이어나 별도 시간 벌점을 만들지 않습니다. 공통 스틴트 상한은 기존 모델 그대로 유지합니다.</p>
            <div className="formula-actions"><button type="submit">계수 적용 · 모둠 모델로 계산</button><button type="button" onClick={() => { setDraft(cloneDefaults()); setError(""); }}>문서 예시·초기 가정값 불러오기</button></div>
          </form>
        </details>

        <h3>현재 적용값으로 계산한 수명 참고치</h3>
        <div className="formula-table-wrap"><table><thead><tr><th>타이어</th><th>속도 비율</th><th>타이어 온도</th><th>권장 스틴트</th><th>트레드 소모 길이</th><th>1랩 마모 지수</th><th>지수 한계 길이</th></tr></thead><tbody>
          {rows.map(row => <tr key={row.compound}><th>{row.compound}</th><td>{row.paceRatio.toFixed(6)}</td><td>{finiteLabel(row.temperatureC, "°C")}</td><td>{finiteLabel(row.suggestedStintLaps, "랩")}</td><td>{finiteLabel(row.treadLifeLaps, "랩")}</td><td>{row.wearUnits.toFixed(3)}</td><td>{finiteLabel(row.wearBudgetLaps, "랩")}</td></tr>)}
        </tbody></table></div>
        <p>권장 스틴트는 min(√(2·피트손실/β₁), 절벽 연령, 트레드/랩당 감소)입니다. 이 근삿값이 전체 레이스 최적해나 안전 한계는 아닙니다. 실제 교체 시점은 선택한 비용식을 동적계획법으로 탐색합니다. 선수 능력치가 켜져 있으면 기존과 같은 열화 배율을 β₁·β₂에 적용합니다.</p>
        <details><summary>적용한 식 · 출처와 한계</summary><div className="formula-source">
          <p>출처: 모둠 제공 「자료 조사(빅데이터, 텔레메트리, 기초 F1 타이어 정보) 문서.pdf」 1–3·5–9쪽. 공식 F1 알고리즘이나 검증된 예측식이 아니라 연구용 구현입니다.</p>
          <code>랩타임 = B × (평균 t컴파운드 / 평균 t미디엄) + β₁·age + β₂·max(0, age−τ) + 온도손실 − 연료효과 + 피트손실 + 수막손실</code>
          <code>온도손실 = 저온계수·(Tmin−T)² / 적정 구간 0 / 고온계수·(T−Tmax)²</code>
          <code>마모 지수 M = 거리 마모 계수 × 서킷 길이(km) × 사용 랩 수</code>
          <p>첫 랩의 age는 0입니다. 마모는 해당 랩 완료 후 누적으로 표시합니다. 절편 β₀는 기준 랩타임 B에 포함되어 중복으로 더하지 않습니다. 평균 속도 비율은 연료·온도·타이어 사용 연령·선수·서킷이 맞춰진 표본으로 보정해야 합니다. 현재 예시 평균은 이러한 보정을 입증하지 않습니다.</p>
          <p>온도·마모·열화는 독립적인 간이식으로 연결했습니다. 동일 대표 온도가 전 랩에 적용되므로 워밍업·냉각의 시간 변화와 실측 그립은 예측하지 않습니다. 그립은 ‘미모델링’으로 표시합니다. 기존 연구 검증 수치는 새 모둠 모델의 정확도를 증명하지 않습니다.</p>
        </div></details>
      </div>
    </details>
  </section>;
}
