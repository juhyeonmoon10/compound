import { MODEL_PARAMS } from "../model/params.ts";
import { evaluateStrategy, TRACK_PRESETS, type StrategyOptimizerInput, type StrategyEvaluation } from "./strategy.ts";
import { runRaceExperiments } from "./race-experiments.ts";
import { wetPenalty } from "./weather.ts";

export interface ModelValidationCheck {
  readonly title: string;
  readonly detail: string;
  readonly pass: boolean;
}

const P = MODEL_PARAMS.validation;
const near = (left: number, right: number) => Math.abs(left - right) <= P.toleranceSeconds;
let referenceChecks: readonly ModelValidationCheck[] | undefined;

/** Fixed synthetic regression fixtures. No observed race time is a calibration target. */
function buildReferenceChecks(): readonly ModelValidationCheck[] {
  const fuelTrack = TRACK_PRESETS.melbourne;
  const fuelCase = {
    track: fuelTrack, weather: { preset: "none" as const },
    rules: { minStops: 0 as const, maxStops: 1 as const, requireTwoDryCompounds: false },
    stints: [{ compound: "H" as const, startLap: 1, endLap: fuelTrack.laps }],
  };
  const withFuel = evaluateStrategy(fuelCase);
  const noFuel = evaluateStrategy({ ...fuelCase, fuelGainSecondsPerLap: 0 });
  const pairedFuelGains = noFuel.lapCosts.map((lap, index) => lap.lapTimeSeconds - withFuel.lapCosts[index].lapTimeSeconds);
  const fuelGain = pairedFuelGains[pairedFuelGains.length - 1] - pairedFuelGains[0];
  const fuelControlsMatch = noFuel.lapCosts.every((lap, index) =>
    near(lap.lapTimeSeconds - withFuel.lapCosts[index].lapTimeSeconds, fuelTrack.fuelGainSecondsPerLap * index)
    && near(lap.pitLossSeconds, withFuel.lapCosts[index].pitLossSeconds)
    && near(lap.tyreState.totalStateLossSeconds, withFuel.lapCosts[index].tyreState.totalStateLossSeconds));

  const tyreTrack = TRACK_PRESETS.bahrain;
  const soft = evaluateStrategy({
    track: tyreTrack, laps: P.cliffOldAge + 1, fuelGainSecondsPerLap: 0,
    weather: { preset: "none" },
    rules: { minStops: 0, maxStops: 1, requireTwoDryCompounds: false },
    stints: [{ compound: "S", startLap: 1, endLap: P.cliffOldAge + 1 }],
  });
  const oldSoft = soft.lapCosts[P.cliffOldAge];
  const newSoft = soft.lapCosts[P.cliffNewAge];
  const softDelta = oldSoft.lapTimeSeconds - newSoft.lapTimeSeconds;
  const cliffDelta = oldSoft.tyreState.cliffLossSeconds - newSoft.tyreState.cliffLossSeconds;

  const pitPlan = (afterLap: number): StrategyEvaluation => evaluateStrategy({
    track: tyreTrack, weather: { preset: "none" },
    rules: { minStops: 1, maxStops: 1, requireTwoDryCompounds: true },
    stints: [
      { compound: "S", startLap: 1, endLap: afterLap },
      { compound: "H", startLap: afterLap + 1, endLap: tyreTrack.laps },
    ],
  });
  const originalPit = pitPlan(P.pitSensitivityAfterLap);
  const shiftedPit = pitPlan(P.pitSensitivityAfterLap + 1);
  const pitDelta = Math.abs(originalPit.totalSeconds - shiftedPit.totalSeconds);

  const W = MODEL_PARAMS.weather;
  const slickBoundary = W.slickLimit;
  const justAboveSlick = slickBoundary + P.crossoverStep;
  // This equality is derived from the supplied deep-water formulas, not wet telemetry.
  const interWetCrossing = W.interUpper + (W.wetBase - W.interDeepBase) / W.interDeepSlope;
  const crossoverInsideModel = interWetCrossing > W.interUpper && interWetCrossing <= 1;

  const options = { trials: MODEL_PARAMS.race.trials, seed: MODEL_PARAMS.race.defaultSeed };
  const firstExperiment = runRaceExperiments([originalPit, shiftedPit], options);
  const secondExperiment = runRaceExperiments([originalPit, shiftedPit], options);
  const sameSeed = JSON.stringify(firstExperiment) === JSON.stringify(secondExperiment);
  const sharedTimelines = firstExperiment.eventTimelines.length === options.trials
    && firstExperiment.eventTimelines.every((timeline, index) => firstExperiment.candidates.every(candidate =>
      candidate.trials[index]?.eventTimelineId === timeline.id && candidate.trials[index]?.trial === timeline.trial));

  return Object.freeze([
    {
      title: "연료 효과 · 통제 기준",
      detail: `멜버른 ${fuelTrack.laps}랩 동일 H 전략의 연료 on/off 차분: 마지막−첫 랩 ${fuelGain.toFixed(3)}초. 타이어·피트 효과는 쌍별로 통제하며 기준 범위 ${P.fuelMinSeconds}–${P.fuelMaxSeconds}초를 검사합니다. 현재 선택 조건의 예측값은 아닙니다.`,
      pass: fuelControlsMatch && fuelGain >= P.fuelMinSeconds && fuelGain <= P.fuelMaxSeconds,
    },
    {
      title: "소프트 열화와 클리프 · 통제 기준",
      detail: `바레인, 연료 효과 0: S ${P.cliffOldAge + 1}번째−${P.cliffNewAge + 1}번째 랩 총차 ${softDelta.toFixed(3)}초 > ${P.cliffMinimumSeconds}초. 이 중 클리프 추가분은 ${cliffDelta.toFixed(3)}초입니다. 총 열화와 클리프 단독 효과를 구분합니다.`,
      pass: soft.isLegal && softDelta > P.cliffMinimumSeconds && cliffDelta > 0 && oldSoft.tyreState.condition === "cliff",
    },
    {
      title: "피트 1랩 이동 · 지정 사례",
      detail: `바레인 S→H 교체 L${P.pitSensitivityAfterLap}→L${P.pitSensitivityAfterLap + 1}: 총시간 차 ${pitDelta.toFixed(3)}초 ≥ ${P.pitSensitivitySeconds}초. 교체 횟수·피트 손실은 동일합니다. 모든 최적점에서 이 차이를 보장하는 검사가 아닙니다.`,
      pass: originalPit.isLegal && shiftedPit.isLegal && pitDelta >= P.pitSensitivitySeconds
        && originalPit.stopCount === shiftedPit.stopCount
        && near(originalPit.breakdown.pitLossSeconds, shiftedPit.breakdown.pitLossSeconds)
        && near(originalPit.breakdown.fuelGainSeconds, shiftedPit.breakdown.fuelGainSeconds),
    },
    {
      title: "슬릭 ↔ 인터 전환 경계",
      detail: `제공 식의 수막 ${slickBoundary.toFixed(2)}에서는 슬릭이 빠르고 ${justAboveSlick.toFixed(4)}에서는 인터가 빠릅니다. 불연속 전환이며 두 시간이 같아지는 교점 또는 실측 학습값이 아닙니다.`,
      pass: wetPenalty("M", slickBoundary) < wetPenalty("INTER", slickBoundary)
        && wetPenalty("M", justAboveSlick) > wetPenalty("INTER", justAboveSlick),
    },
    {
      title: "인터 ↔ 웨트 식의 교점",
      detail: `제공된 새 타이어 수막 페널티 식에서 수막 ${interWetCrossing.toFixed(2)}에 두 값이 일치하고 전후 우열이 바뀝니다. 열화·마른 노면 누적 가열을 제외한 식 검사입니다. 실측 교차점이 아닙니다.`,
      pass: crossoverInsideModel && near(wetPenalty("INTER", interWetCrossing), wetPenalty("WET", interWetCrossing))
        && wetPenalty("INTER", interWetCrossing - P.crossoverStep) < wetPenalty("WET", interWetCrossing - P.crossoverStep)
        && wetPenalty("INTER", interWetCrossing + P.crossoverStep) > wetPenalty("WET", interWetCrossing + P.crossoverStep),
    },
    {
      title: "몬테카를로 · 동일 시드 재현",
      detail: `지정된 바레인 전략 2개를 ${options.trials}회씩 두 번 실행: 시드 ${options.seed}, 시행별 전체 결과의 정확한 일치를 검사합니다. 최초 1회 검증 결과를 캐시하며 UI 설정 변경으로 재실행하지 않습니다.`,
      pass: sameSeed,
    },
    {
      title: "몬테카를로 · 공통 사건 일정",
      detail: `${options.trials}개 시행 각각에서 두 전략이 같은 SC/VSC 일정 ID를 사용하는지 확인합니다. 후보별로 다른 사건을 뽑아 전략 우열을 비교하지 않습니다.`,
      pass: sharedTimelines,
    },
  ].map(check => Object.freeze(check)));
}

/** Cheap optional current-input accounting check; it does not rerun DP or Monte Carlo. */
function currentAccountingCheck(input: StrategyOptimizerInput): ModelValidationCheck {
  try {
    const track = typeof input.track === "object" ? input.track : TRACK_PRESETS[input.track ?? "melbourne"];
    const laps = input.laps ?? track.laps;
    // A single H set is a numerical probe, not a recommended/legal race strategy.
    const probe = evaluateStrategy({ ...input, stints: [{ compound: "H", startLap: 1, endLap: laps }] });
    const B = probe.breakdown;
    const sum = B.baselineSeconds + B.compoundOffsetSeconds + B.linearDegradationSeconds + B.quadraticDegradationSeconds
      + B.tyreStateLossSeconds - B.fuelGainSeconds + B.pitLossSeconds;
    const lapSum = probe.lapCosts.reduce((total, lap) => total + lap.lapTimeSeconds, 0);
    return Object.freeze({
      title: "현재 조건 · 비용 합계",
      detail: `현재 선택 조건 ${laps}랩의 H 단일세트 계산용 진단: 랩 합계·성분 합계·총시간 일치. 이 진단의 전략 적합성이나 앞선 고정 기준의 임계값을 현재 조건에서 보장하지 않습니다.`,
      pass: near(sum, probe.totalSeconds) && near(lapSum, probe.totalSeconds),
    });
  } catch (error) {
    return Object.freeze({ title: "현재 조건 · 비용 합계", detail: `입력을 계산할 수 없습니다: ${error instanceof Error ? error.message : "알 수 없는 오류"}`, pass: false });
  }
}

/** Fixed reference checks are computed only on first use, independent of UI input. */
export function getModelValidationChecks(input?: StrategyOptimizerInput): readonly ModelValidationCheck[] {
  referenceChecks ??= buildReferenceChecks();
  return input ? Object.freeze([...referenceChecks, currentAccountingCheck(input)]) : referenceChecks;
}
