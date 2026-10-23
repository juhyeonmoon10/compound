/** School team's supplied PDF, pp. 1–3, 5–9. Examples are NOT calibrated F1 coefficients. */
export const GROUP_FORMULA_VERSION = "COMPOUND PDF experimental v1";
export type GroupDryCompound = "S" | "M" | "H";
export interface GroupCompoundParameters {
  meanLapSeconds: number;
  beta1: number;
  /** Additional slope after the cliff, not the total post-cliff slope. */
  beta2: number;
  cliffAge: number;
  wearPerKm: number;
  treadMm: number;
  treadWearPerLapMm: number;
}
export interface GroupFormulaParameters {
  compounds: Record<GroupDryCompound, GroupCompoundParameters>;
  temperature: {
    mode: "direct" | "estimated";
    directC: number;
    minC: number;
    maxC: number;
    coldCoeff: number;
    hotCoeff: number;
    p: number;
    q: number;
    speedHeatingCoeff: number;
    constantC: number;
    cornerSpeedKmh: number;
  };
  /** Optional diagnostic wear-index budget, never a certified physical failure limit. */
  wearBudget: number | null;
}

export const DEFAULT_GROUP_FORMULA_PARAMETERS: GroupFormulaParameters = {
  compounds: {
    S: { meanLapSeconds: 89.8, beta1: .12, beta2: .24, cliffAge: 18, wearPerKm: 1.2, treadMm: 2.5, treadWearPerLapMm: .12 },
    M: { meanLapSeconds: 90.2, beta1: .08, beta2: .16, cliffAge: 22, wearPerKm: 1, treadMm: 2.5, treadWearPerLapMm: .09 },
    H: { meanLapSeconds: 90.6, beta1: .04, beta2: .08, cliffAge: 25, wearPerKm: .8, treadMm: 2.5, treadWearPerLapMm: .06 },
  },
  temperature: { mode: "direct", directC: 100, minC: 90, maxC: 110, coldCoeff: .004, hotCoeff: .004,
    p: 1, q: 0, speedHeatingCoeff: 0, constantC: 0, cornerSpeedKmh: 180 },
  wearBudget: null,
};

/** Stable field order for scenario identities and reproducible notebook exports. */
export function groupFormulaSignatureParameters(parameters: GroupFormulaParameters) {
  const t = parameters.temperature;
  return {
    compounds: (["S", "M", "H"] as const).map(compound => {
      const c = parameters.compounds[compound];
      return { compound, meanLapSeconds: c.meanLapSeconds, beta1: c.beta1, beta2: c.beta2,
        cliffAge: c.cliffAge, wearPerKm: c.wearPerKm, treadMm: c.treadMm, treadWearPerLapMm: c.treadWearPerLapMm };
    }),
    temperature: { mode: t.mode, directC: t.directC, minC: t.minC, maxC: t.maxC, coldCoeff: t.coldCoeff,
      hotCoeff: t.hotCoeff, p: t.p, q: t.q, speedHeatingCoeff: t.speedHeatingCoeff, constantC: t.constantC, cornerSpeedKmh: t.cornerSpeedKmh },
    wearBudget: parameters.wearBudget,
  };
}

export function validateGroupFormulaParameters(parameters: GroupFormulaParameters): void {
  const finite = (value: number, name: string, min = 0, max = Number.MAX_VALUE) => {
    if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`${name}: ${min}–${max} 범위의 숫자가 필요합니다.`);
  };
  if (!parameters || !parameters.compounds || !parameters.temperature) throw new TypeError("모둠 수식 계수가 필요합니다.");
  for (const compound of ["S", "M", "H"] as const) {
    const c = parameters.compounds[compound];
    if (!c) throw new TypeError(`${compound} 계수가 필요합니다.`);
    finite(c.meanLapSeconds, `${compound} 평균 랩타임`, .001);
    finite(c.beta1, `${compound} β₁`); finite(c.beta2, `${compound} β₂`);
    finite(c.cliffAge, `${compound} 절벽 시작`, 1);
    finite(c.wearPerKm, `${compound} 거리 마모 계수`);
    finite(c.treadMm, `${compound} 트레드 두께`, .001);
    finite(c.treadWearPerLapMm, `${compound} 랩당 두께 감소`);
  }
  const t = parameters.temperature;
  if (t.mode !== "direct" && t.mode !== "estimated") throw new RangeError("타이어 온도 입력 방식을 선택하세요.");
  for (const [key, value] of [["직접 온도", t.directC], ["최저 적정 온도", t.minC], ["최고 적정 온도", t.maxC]] as const) finite(value, key, -273.15, 300);
  if (t.minC >= t.maxC) throw new RangeError("적정 온도 하한은 상한보다 낮아야 합니다.");
  finite(t.coldCoeff, "저온 손실 계수"); finite(t.hotCoeff, "고온 손실 계수");
  finite(t.p, "p"); finite(t.q, "q"); finite(t.speedHeatingCoeff, "속도 가열 계수");
  finite(t.constantC, "온도 상수", -1000, 1000); finite(t.cornerSpeedKmh, "대표 코너 속도", 0, 400);
  if (parameters.wearBudget !== null) finite(parameters.wearBudget, "마모 지수 한계", .001);
}

/** Age is completed laps at the START of this lap. Wear is reported at its END. */
export function calculateGroupFormulaLap(input: {
  parameters: GroupFormulaParameters; compound: GroupDryCompound; tyreAge: number;
  baseLapTimeSeconds: number; trackTemperatureC: number; airTemperatureC: number;
  circuitLengthKm: number; pitLossSeconds: number; wearMultiplier?: number;
}) {
  const { parameters, compound, tyreAge, baseLapTimeSeconds, trackTemperatureC, airTemperatureC, circuitLengthKm, pitLossSeconds } = input;
  const c = parameters.compounds[compound], t = parameters.temperature;
  const multiplier = input.wearMultiplier ?? 1;
  const temperatureC = t.mode === "direct" ? t.directC
    : t.p * trackTemperatureC + t.q * airTemperatureC + t.speedHeatingCoeff * (t.cornerSpeedKmh / 3.6) ** 2 + t.constantC;
  if (!Number.isFinite(temperatureC) || temperatureC < -273.15 || temperatureC > 300) throw new RangeError("추정 타이어 온도가 범위를 벗어납니다. p·q·가열 계수를 확인하세요.");
  const thermalState: "cold" | "hot" | "optimal" = temperatureC < t.minC ? "cold" : temperatureC > t.maxC ? "hot" : "optimal";
  const temperatureLossSeconds = thermalState === "cold" ? t.coldCoeff * (t.minC - temperatureC) ** 2
    : thermalState === "hot" ? t.hotCoeff * (temperatureC - t.maxC) ** 2 : 0;
  const paceRatio = c.meanLapSeconds / parameters.compounds.M.meanLapSeconds;
  const k1 = c.beta1 * multiplier;
  const treadLifeLaps = c.treadWearPerLapMm > 0 ? c.treadMm / c.treadWearPerLapMm : Infinity;
  const wearUnits = c.wearPerKm * circuitLengthKm * (tyreAge + 1);
  const wearBudgetLaps = parameters.wearBudget === null ? null : c.wearPerKm > 0 ? parameters.wearBudget / (c.wearPerKm * circuitLengthKm) : Infinity;
  return {
    paceRatio, compoundOffsetSeconds: baseLapTimeSeconds * (paceRatio - 1),
    linearDegradationSeconds: k1 * tyreAge,
    cliffDegradationSeconds: c.beta2 * multiplier * Math.max(0, tyreAge - c.cliffAge),
    temperatureC, thermalState, temperatureLossSeconds, wearUnits,
    wearPercent: parameters.wearBudget === null ? null : 100 * wearUnits / parameters.wearBudget,
    suggestedStintLaps: Math.min(k1 > 0 ? Math.sqrt(2 * pitLossSeconds / k1) : Infinity, c.cliffAge, treadLifeLaps),
    treadLifeLaps, wearBudgetLaps,
  };
}
