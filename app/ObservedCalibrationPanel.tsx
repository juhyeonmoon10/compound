import { DEFAULT_GROUP_FORMULA_PARAMETERS } from "./lib/group-formula";
import { calculateObservedTyreLoss, OBSERVED_BAHRAIN_2025 } from "./lib/observed-tyre-model";

type Props = {
  active: boolean;
  available: boolean;
  pitLossSeconds: number;
  onApply: () => void;
};

const compounds = ["S", "M", "H"] as const;
const fixed = (value: number, digits = 6) => value.toFixed(digits);
const pdfAgeLoss = (compound: typeof compounds[number], age: number) => {
  const coefficient = DEFAULT_GROUP_FORMULA_PARAMETERS.compounds[compound];
  return coefficient.beta1 * age + coefficient.beta2 * Math.max(0, age - coefficient.cliffAge);
};

export default function ObservedCalibrationPanel({ active, available, pitLossSeconds, onApply }: Props) {
  const evidence = OBSERVED_BAHRAIN_2025;
  const soft = evidence.coefficients.S;
  const validation = evidence.validation;

  return <details className="observed-calibration">
    <summary>2025 바레인 관측 보정 · 계수와 출처</summary>
    <div className="observed-calibration__body">
      <div className="observed-calibration__intro">
        <h3>{evidence.season} 바레인 · 실제 자료로 열화 계수만 보정하는 실험</h3>
        <p>한 경기의 기록을 프로젝트에서 분석한 계수입니다. FIA가 발표한 공식 타이어 수식이나 실제 경기 전체를 재현한 모델은 아닙니다. 기존 모델·모둠 PDF 원식은 그대로 남아 있습니다.</p>
        <p className="observed-calibration__status">{active
          ? "현재 적용 중 · 건식 S·M·H · 동일 성능 조건 · 현재 선수·팀은 시각화용"
          : available
            ? "현재 바레인 조건에서 별도 계산 옵션으로 선택할 수 있습니다."
            : "다른 서킷에는 적용하지 않습니다. 아래 버튼은 서킷도 바레인으로 전환합니다."}</p>
        <button type="button" className="observed-calibration__apply" onClick={onApply}>
          {active ? "관측 피트값으로 다시 적용" : available ? "2025 바레인 관측 보정 적용" : "2025 바레인 계수 실험 열기"}
        </button>
      </div>

      <h4>어떤 식으로 바뀌나요?</h4>
      <p><code>a</code>는 해당 랩을 시작하기 전에 타이어로 이미 달린 랩 수입니다. 첫 랩은 <code>a=0</code>입니다. 아래 식은 <strong>새 타이어보다 현재 한 랩이 얼마나 느려지는지(초)</strong>를 뜻하며, 스틴트 전체의 누적 손실이 아닙니다.</p>
      <div className="formula-table-wrap"><table className="observed-calibration__coefficients">
        <caption>모둠 초기 가정과 관측 보정의 사용 연령 손실 비교</caption>
        <thead><tr><th>타이어</th><th>모둠 원식의 초기 열화 계수</th><th>관측 보정식 · 초/현재 랩</th><th>계수 학습 표본</th><th>분석 자료의 관측 연령</th></tr></thead>
        <tbody>{compounds.map(compound => {
          const pdf = DEFAULT_GROUP_FORMULA_PARAMETERS.compounds[compound];
          const observed = evidence.coefficients[compound];
          return <tr key={compound}>
            <th scope="row">{compound}</th>
            <td><code>{fixed(pdf.beta1, 2)}a + {fixed(pdf.beta2, 2)}max(0, a−{pdf.cliffAge})</code></td>
            <td><code>{fixed(observed.alpha0)}a{observed.beta > 0 ? ` + ${fixed(observed.beta)}a²` : ""}</code></td>
            <td>{observed.laps}랩 · {observed.stints}스틴트</td>
            <td>a={observed.observedAgeMin}–{observed.observedAgeMax}</td>
          </tr>;
        })}</tbody>
      </table></div>
      <p className="observed-calibration__note">비교 기준은 편집 중인 모둠 계수가 아니라 앱의 고정 초기값입니다. 관측 연령은 유지된 분석 자료 전체의 범위이며, 학습 표본만의 범위는 아닙니다. a=0과 관측 범위 밖의 긴 스틴트는 외삽입니다. 기존 최대 스틴트 제약도 측정된 안전 수명은 아닙니다.</p>

      <details className="observed-calibration__examples">
        <summary>10랩·20랩 사용했을 때, 현재 한 랩 손실 비교</summary>
        <div className="formula-table-wrap"><table>
          <caption>사용 연령만의 손실 · 초/현재 랩 · 온도·피트·기본 속도 제외</caption>
          <thead><tr><th>타이어</th><th>a=10 · 모둠 초기값</th><th>a=10 · 관측 보정</th><th>a=20 · 모둠 초기값</th><th>a=20 · 관측 보정</th></tr></thead>
          <tbody>{compounds.map(compound => <tr key={compound}>
            <th scope="row">{compound}</th>
            <td>{fixed(pdfAgeLoss(compound, 10), 3)}</td>
            <td>{fixed(calculateObservedTyreLoss(compound, 10).totalSeconds, 3)}</td>
            <td>{fixed(pdfAgeLoss(compound, 20), 3)}</td>
            <td>{fixed(calculateObservedTyreLoss(compound, 20).totalSeconds, 3)}</td>
          </tr>)}</tbody>
        </table></div>
        <p>이 경기에서 H의 기울기가 M보다 크더라도, 하드가 언제나 미디엄보다 빨리 닳는다는 뜻은 아닙니다. 표본·조건이 다른 한 경기의 추정값이며 물리적인 마모량도 아닙니다.</p>
      </details>

      <div className="observed-calibration__pit">
        <h4>피트 손실은 따로 구분합니다</h4>
        <p>관측 중앙값 <strong>{fixed(evidence.pitLoss.medianSeconds, 3)}초</strong> · {evidence.pitLoss.retainedSamples}개 표본 · 중간 50% 범위 {fixed(evidence.pitLoss.iqrSeconds[0], 3)}–{fixed(evidence.pitLoss.iqrSeconds[1], 3)}초입니다. 타이어 교체를 위해 멈춘 시간만이 아니라, 정상 주행 대비 피트 진입·진출 랩의 순 시간 손실 추정치입니다.</p>
        <p>현재 조건의 공통 피트 손실은 <strong>{fixed(pitLossSeconds, 3)}초</strong>입니다. 이 옵션을 적용하면 관측 중앙값을 가져오며, 같은 전략 비교에서는 모든 모델에 현재 공통값을 씁니다. 전체 완주시간 차이를 열화 계수만의 효과로 해석하면 안 됩니다.</p>
      </div>

      <details className="observed-calibration__method">
        <summary>연령 변환과, 보정하지 않은 나머지 요소</summary>
        <p>원자료의 TyreLife를 L=a+1로 바꿉니다. αL+βL²를 펼치면 (α+2β)a+βa²+(α+β)입니다. 새 타이어 기준의 손실을 0으로 맞추려고 상수 α+β는 제거하고, α₀=α+2β를 사용합니다. 절편을 다시 더하지 않습니다.</p>
        <p>소프트 예시: α={fixed(soft.sourceAlpha)}, β={fixed(soft.beta)} → α₀={fixed(soft.alpha0)}. 제거한 상수는 {fixed(soft.absorbedIntercept)}초입니다.</p>
        <ul>
          <li>기준 랩타임·새 타이어 종류별 속도 차이·연료 효과는 프로젝트의 기존 가정값입니다. 이 자료에서 새로 측정한 값이 아닙니다. PDF 예시 평균 랩타임 비율은 섞지 않습니다.</li>
          <li>PDF 온도 벌점과 기존 워밍업·과열·절벽 상태 비용을 이 관측 열화식에 추가하지 않습니다. 노면 온도는 타이어 온도 센서값이 아닙니다. 타이어 온도·마모율·그립은 이 옵션에서 미모델링으로 표시합니다.</li>
          <li>노면 온도·기온·습도 조정이나 현재 선수·팀의 능력치를 관측 계수에 곱하지 않습니다. 건식·동일 성능을 사용하며 현재 시즌의 선수·팀 선택은 시각화용입니다.</li>
          <li>가상 사고·교통·SC·VSC 등 별도 시뮬레이션 기능을 사용하더라도, 그 값까지 이 회귀식으로 보정한 것은 아닙니다.</li>
        </ul>
      </details>

      <details className="observed-calibration__sources">
        <summary>출처와 검증 범위 · 이 숫자가 정확도를 뜻하나요?</summary>
        <p>공식 기록을 입력 자료로 사용하고, 프로젝트가 회귀 분석한 결과를 <code>{evidence.sourceDocument}</code>의 <code>{evidence.coefficientSource}</code>에서 읽습니다. 여러 경기 통합값이나 시험 표본까지 다시 맞춘 계수 대신, 이 경기의 채택된 학습용 계수만 사용합니다.</p>
        <ul>
          <li><a href={evidence.timingSourceUrl} target="_blank" rel="noreferrer">Formula 1 공식 라이브 타이밍 · 2025 바레인 레이스</a> — 랩·스틴트 등 원자료</li>
          <li><a href={evidence.fiaLapAnalysisUrl} target="_blank" rel="noreferrer">FIA 공식 Race Lap Analysis PDF</a> — 해당 경기 랩 기록 확인 자료</li>
        </ul>
        <p>선택된 <strong>전체 회귀 모델</strong>은 학습 {validation.trainLaps}랩·시험 {validation.testLaps}랩, MAE {fixed(validation.maeSeconds)}초·RMSE {fixed(validation.rmseSeconds)}초입니다. {evidence.validationNote}</p>
        <p>MAE는 랩타임 오차 절댓값의 평균, RMSE는 큰 오차를 더 반영하는 지표입니다. 위 수치는 다른 효과도 포함한 회귀 모델의 결과입니다. 단순 연령식 단독의 정확도, 전체 완주시간 오차, 다른 경기·시즌에서의 성능을 증명하지 않습니다. 기존 검증 화면의 결과 역시 이 새 옵션의 검증 결과로 바뀌지 않습니다.</p>
      </details>
    </div>
  </details>;
}
