import evidence from "../data/calibration-summary.json" with { type: "json" };
import { MODEL_PARAMS } from "../model/params.ts";

/** Event-specific, training-selected regression; this is not an FIA coefficient set. */
export const OBSERVED_TYRE_MODEL_VERSION = "COMPOUND Bahrain 2025 observed v1";
export type ObservedTyreModelId = "2025-bahrain";
export type ObservedDryCompound = "S" | "M" | "H";

export interface ObservedTyreCoefficient {
  readonly alpha0: number;
  readonly beta: number;
  readonly sourceAlpha: number;
  /** Removed when normalising the fitted TyreLife=age+1 equation to new-set loss=0. */
  readonly absorbedIntercept: number;
  readonly laps: number;
  readonly stints: number;
  readonly model: "linear" | "quadratic";
  readonly alphaCI95: readonly number[];
  readonly betaCI95: readonly number[];
  /** Age range of all retained analysis rows; not the training-only support. */
  readonly observedAgeMin: number;
  readonly observedAgeMax: number;
}

const event = evidence.events.find(row => row.id === "2025-bahrain");
if (!event?.modelSelection || event.season !== 2025 || event.trackId !== "bahrain") {
  throw new Error("2025 바레인 관측 모델의 경기별 학습 근거를 찾을 수 없습니다.");
}

const coefficients = {} as Record<ObservedDryCompound, ObservedTyreCoefficient>;
for (const compound of ["S", "M", "H"] as const) {
  // Deliberately select training-only accepted terms, never event.coefficients or pooled races.
  const row = event.modelSelection.coefficients.find(item => item.compound === compound);
  if (!row || !row.identifiable || row.accepted !== true || row.alphaSecondsPerLap === null
    || row.betaSecondsPerLapSquared === null || row.laps < MODEL_PARAMS.historical.minLaps
    || row.stints < MODEL_PARAMS.historical.minStints || !row.alphaCI95 || row.alphaCI95.length !== 2
    || !row.betaCI95 || row.betaCI95.length !== 2) {
    throw new Error(`${compound}: 관측 열화 계수의 식별·표본·학습 선택 근거가 부족합니다.`);
  }
  const alpha = row.alphaSecondsPerLap;
  const beta = row.betaSecondsPerLapSquared;
  const support = event.coefficients.find(item => item.compound === compound);
  if (!support || support.tyreLifeMin === null || support.tyreLifeMax === null
    || !Number.isFinite(support.tyreLifeMin) || !Number.isFinite(support.tyreLifeMax)) {
    throw new Error(`${compound}: 관측 자료의 타이어 사용 범위를 확인할 수 없습니다.`);
  }
  const alpha0 = alpha + 2 * beta;
  if (![alpha, beta, ...row.alphaCI95, ...row.betaCI95].every(Number.isFinite)
    || alpha0 < 0 || beta < 0
    || (row.model === "quadratic" && row.betaCI95[0] <= 0)
    || (row.model === "linear" && (row.alphaCI95[0] <= 0 || beta !== 0))
    || (row.model !== "linear" && row.model !== "quadratic")) {
    throw new Error(`${compound}: 관측 열화 계수가 학습 신뢰구간·비음수 변환 기준을 통과하지 못했습니다.`);
  }
  coefficients[compound] = Object.freeze({
    alpha0, beta, sourceAlpha: alpha, absorbedIntercept: alpha + beta,
    laps: row.laps, stints: row.stints, model: row.model,
    alphaCI95: Object.freeze([...row.alphaCI95]), betaCI95: Object.freeze([...row.betaCI95]),
    observedAgeMin: support.tyreLifeMin - 1, observedAgeMax: support.tyreLifeMax - 1,
  });
}

const fiaLapAnalysisUrl = "https://api.fia.com/sites/default/files/2025_04_brn_f1_r0_timing_racelapanalysis_v01.pdf";
const pitLoss = event.pitLoss;
if (pitLoss.status !== "observational-estimate" || pitLoss.medianSeconds === null || !pitLoss.iqrSeconds
  || pitLoss.iqrSeconds.length !== 2 || pitLoss.retainedSamples < 1) {
  throw new Error("2025 바레인의 피트 손실 추정 근거가 부족합니다.");
}

export const OBSERVED_BAHRAIN_2025 = Object.freeze({
  id: "2025-bahrain" as const,
  eventId: "2025-bahrain" as const,
  season: 2025 as const,
  trackId: "bahrain" as const,
  eventName: event.eventName,
  sourceDocument: "app/data/calibration-summary.json",
  coefficientSource: "events[2025-bahrain].modelSelection.coefficients",
  timingSourceUrl: event.timingSourceUrl,
  fiaLapAnalysisUrl,
  sourceUrls: Object.freeze([event.timingSourceUrl, fiaLapAnalysisUrl]),
  coefficients: Object.freeze(coefficients),
  pitLoss: Object.freeze({ ...pitLoss, medianSeconds: pitLoss.medianSeconds, iqrSeconds: Object.freeze([...pitLoss.iqrSeconds]) }),
  validation: Object.freeze({ ...event.modelSelection.validation,
    byCompound: Object.freeze(event.modelSelection.validation.byCompound.map(row => Object.freeze({ ...row }))) }),
  selectionMethod: event.modelSelection.method,
  validationNote: "동일 경기의 스틴트별 앞 75% 학습·뒤 25% 시험. 전체 선택 회귀 모델의 랩 오차이며, 이 열화식 단독이나 전체 레이스의 예측 오차가 아닙니다.",
});

/** Per-lap loss relative to a new set. age=0 is the start of the set's first lap. */
export function calculateObservedTyreLoss(compound: ObservedDryCompound, age: number) {
  if (!Number.isFinite(age) || age < 0) throw new RangeError("타이어 사용 랩 수는 유한한 음이 아닌 값이어야 합니다.");
  const coefficient = OBSERVED_BAHRAIN_2025.coefficients[compound];
  if (!coefficient) throw new RangeError("2025 바레인 관측 보정은 S·M·H에만 제공됩니다.");
  const linearDegradationSeconds = coefficient.alpha0 * age;
  const quadraticDegradationSeconds = coefficient.beta * age * age;
  return { linearDegradationSeconds, quadraticDegradationSeconds,
    totalSeconds: linearDegradationSeconds + quadraticDegradationSeconds };
}
