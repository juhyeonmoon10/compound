const DIFFERENCES = [
  {
    item: "타이어별 기본 속도",
    original: "서킷의 기준 랩타임에 소프트·미디엄·하드별 시간 차이를 더합니다. 자료가 있는 일부 계수는 실제 경기 분석으로 보정하고, 나머지는 서킷별 가정값을 씁니다.",
    group: "미디엄을 1로 두고, 타이어별 평균 랩타임의 비율을 기준 랩타임에 곱합니다. 시작값 89.8·90.2·90.6초는 모둠 PDF의 설명용 예시입니다.",
    originalFormula: "기준 랩타임 + 타이어별 시간 차이",
    groupFormula: "기준 랩타임 × (타이어 평균 / 미디엄 평균)",
  },
  {
    item: "오래 달릴 때의 열화",
    original: "사용 연령에 비례하는 손실과 연령의 제곱에 비례하는 손실을 더합니다. 세트 수명 후반에는 별도의 성능 절벽 비용도 붙습니다.",
    group: "처음에는 일정한 기울기로 느려지고, 설정한 절벽 연령 τ를 넘으면 β₂만큼 더 가파르게 느려집니다. 절벽 이후 기울기는 β₁ + β₂입니다.",
    originalFormula: "α × 연령 + β × 연령² + 후반 절벽 비용",
    groupFormula: "β₁ × 연령 + β₂ × max(0, 연령 − τ)",
  },
  {
    item: "타이어 온도",
    original: "타이어 종류·사용 랩 수·노면 온도·서킷 부담도로 매 랩 온도를 추정합니다. 워밍업, 그레이닝(표면 손상), 과열 등의 시간 손실을 계산합니다.",
    group: "직접 입력하거나 노면·기온·대표 코너 속도로 추정한 온도 하나를 모든 건식 랩에 적용합니다. 적정 구간 밖에서는 온도 차이의 제곱에 비례해 느려집니다. 랩별 가열·냉각은 계산하지 않습니다.",
    originalFormula: "사용 연령에 따라 온도·상태 비용 변화",
    groupFormula: "적정 구간: 0초 / 구간 밖: 계수 × 온도 차이²",
  },
  {
    item: "마모·그립·교체 한계",
    original: "현재 사용 랩 수를 모델의 최대 스틴트 길이와 비교해 마모율을 표시합니다. 그립도 별도의 간이 추정값으로 표시합니다.",
    group: "거리 마모 계수 × 서킷 길이 × 사용 랩 수로 마모 지수를 계산합니다. 선택한 한계값이 있으면 비율도 표시합니다. 마모 지수·트레드 두께·권장 스틴트는 참고용이며 시간 벌점이나 강제 리타이어를 만들지 않습니다. 그립은 미모델링입니다.",
    originalFormula: "마모율: 사용 랩 수 / 모델 세트 수명",
    groupFormula: "마모 지수: 계수 × 거리 / 강제 스틴트 상한은 기존과 동일",
  },
  {
    item: "조건을 바꾸면?",
    original: "노면 온도·기온·습도에 따라 건식 열화 계수를 조정합니다. 노면 온도는 타이어 온도 추정에도 영향을 줍니다.",
    group: "건식 열화는 편집한 β₁·β₂를 씁니다. 직접 온도 모드에서는 노면·기온을 바꿔도 대표 타이어 온도는 그대로입니다. 온도 추정 모드에서는 노면·기온이 온도 식에 반영됩니다. 기존의 습도 열화 배율은 적용하지 않습니다.",
    originalFormula: "환경 조건 → 열화 배율·온도 추정",
    groupFormula: "편집 계수 + 대표 온도 / 수막 계산은 두 모델 공통",
  },
  {
    item: "모델의 근거와 용도",
    original: "기존 프로젝트의 서킷별 가정 계수와 채택된 관측 보정값을 사용합니다. 데이터·계산 검증 탭의 기존 분석과 이어서 살펴볼 때 적합합니다. 모든 상태가 실측 데이터인 것은 아닙니다.",
    group: "모둠이 제출한 PDF의 식을 직접 실험할 수 있게 구현했습니다. PDF 예시값과 앱에서 정한 가정값이 섞여 있으며, 계수를 바꾸며 결과에 미치는 영향을 탐구할 수 있습니다. 실제 경기 예측 정확도는 별도 검증이 필요합니다.",
    originalFormula: "기존 가정 + 일부 실제 자료 보정",
    groupFormula: "모둠 PDF 식 + 예시·가정 계수 직접 편집",
  },
] as const;

export default function ModelDifferenceGuide() {
  return <div className="model-difference-guide">
    <p className="model-difference-guide__intro">모든 모델은 <strong>같은 DP로 최적 전략을 찾고</strong>, 타이어가 한 랩의 시간에 미치는 영향을 계산하는 식이 달라요. 아래는 기존 모델과 모둠 PDF 원식의 차이이며, 바레인 관측 보정은 별도 안내에서 확인할 수 있어요.</p>
    <details className="model-difference-guide__details">
      <summary>기존 모델과 모둠 수식, 뭐가 다른가요?</summary>
      <div className="model-difference-guide__body">
        <h3>같은 전략을 서로 다른 계산식으로 평가합니다</h3>
        <p>DP는 가능한 타이어·교체 선택의 누적 시간을 비교해 가장 빠른 전략을 찾는 방법입니다. 두 모델은 같은 DP를 쓰지만, 속도차·열화·온도 손실의 계산식이 달라 같은 전략의 예상 완주시간이 달라집니다. 최적 전략을 다시 찾으면 추천 타이어나 교체 시점도 달라질 수 있습니다.</p>
        <div className="model-difference-guide__rows">
          {DIFFERENCES.map(row => <article className="model-difference-row" key={row.item}>
            <h4>{row.item}</h4>
            <div><span className="model-difference-row__label">기존 모델</span><p>{row.original}</p><code>{row.originalFormula}</code></div>
            <div><span className="model-difference-row__label">모둠 수식 모델</span><p>{row.group}</p><code>{row.groupFormula}</code></div>
          </article>)}
        </div>
        <aside className="model-difference-example" aria-label="온도 계산 예시">
          <h4>예를 들어, 타이어 온도가 120°C라면?</h4>
          <p>모둠 식의 설명용 설정이 <strong>적정 온도 90–110°C · 고온 계수 0.004</strong>이면, 110°C보다 10°C 높으므로 <strong>0.004 × 10² = 랩당 0.4초</strong>를 더합니다. 58랩을 전부 건식 타이어로 달리면 온도 손실만 23.2초입니다.</p>
          <p>이 설정에서는 모든 건식 타이어에 같은 온도와 적정 구간을 적용하므로, 온도만 바꾸면 총시간은 달라져도 최적 교체 시점은 같을 수 있습니다. 기존 모델은 사용 연령에 따라 온도와 워밍업 손실이 달라집니다.</p>
        </aside>
        <div className="model-difference-shared">
          <h4>두 모델에 공통으로 적용되는 것</h4>
          <p>서킷·레이스 거리·피트 손실·연료 효과·정차 횟수 규칙·최대 스틴트 길이는 같습니다. 선수·팀 성능 옵션과 3D 주행도 함께 사용합니다. 우천 타이어(INTER·WET), 노면 수막, 교통·사고·SC·VSC 처리는 기존 기능을 공유합니다.</p>
          <p>첫 랩의 타이어 사용 연령은 0입니다. 연령 10은 그 세트로 이미 10랩을 마친 뒤 시작하는 랩을 뜻합니다.</p>
        </div>
        <p className="model-difference-takeaway"><strong>비교할 때는</strong> 같은 조건·같은 전략을 놓고 아래의 시간 차이와 비용 분해를 보세요. 더 짧게 예측한 모델이 더 정확하다는 뜻은 아니며, 정확도는 실제 경기 데이터와 따로 비교해야 합니다.</p>
      </div>
    </details>
  </div>;
}
