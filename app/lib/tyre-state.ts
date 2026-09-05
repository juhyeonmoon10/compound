import type { Compound } from "./strategy.ts";

/**
 * Closed-form, deterministic tyre-state proxy used by the school project.
 *
 * These values are transparent project calibration constants, not official
 * team telemetry. The calculation depends only on the current compound, tyre
 * age and fixed race conditions, so the dynamic-programming state remains
 * complete and identical inputs always produce identical results.
 */
export const TYRE_STATE_MODEL_VERSION = "APEX TYRE v1.0";

export type TyreThermalState = "cold" | "optimal" | "hot";
export type TyreCondition =
  | "warming"
  | "optimal"
  | "worn"
  | "graining"
  | "overheated"
  | "cliff";

export interface TyreStateSnapshot {
  readonly temperatureC: number;
  readonly optimalMinC: number;
  readonly optimalMaxC: number;
  readonly thermalState: TyreThermalState;
  readonly condition: TyreCondition;
  readonly wearPercent: number;
  readonly gripPercent: number;
  readonly warmupLossSeconds: number;
  readonly grainingLossSeconds: number;
  readonly overheatLossSeconds: number;
  readonly cliffLossSeconds: number;
  readonly totalStateLossSeconds: number;
}

export interface TyreStateInput {
  readonly compound: Compound;
  /** Zero-based age: the first racing lap on a set has age 0. */
  readonly tyreAge: number;
  readonly maxStintLaps: number;
  readonly tyreSeverity: number;
  readonly trackTemperatureC: number;
  /** Existing alpha/beta degradation, used only for the display grip score. */
  readonly degradationSeconds: number;
}

interface ThermalProfile {
  readonly startTemperatureC: number;
  readonly equilibriumTemperatureC: number;
  readonly warmupLaps: number;
  readonly optimalMinC: number;
  readonly optimalMaxC: number;
  readonly firstLapWarmupLossSeconds: number;
}

const THERMAL_PROFILES: Readonly<Record<Compound, ThermalProfile>> = {
  S: {
    startTemperatureC: 82,
    equilibriumTemperatureC: 103,
    warmupLaps: 0.85,
    optimalMinC: 92,
    optimalMaxC: 105,
    firstLapWarmupLossSeconds: 0.26,
  },
  M: {
    startTemperatureC: 79,
    equilibriumTemperatureC: 99,
    warmupLaps: 1.45,
    optimalMinC: 88,
    optimalMaxC: 103,
    firstLapWarmupLossSeconds: 0.46,
  },
  H: {
    startTemperatureC: 76,
    equilibriumTemperatureC: 95,
    warmupLaps: 2.25,
    optimalMinC: 85,
    optimalMaxC: 101,
    firstLapWarmupLossSeconds: 0.72,
  },
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function thermalState(
  temperatureC: number,
  profile: ThermalProfile,
): TyreThermalState {
  if (temperatureC < profile.optimalMinC) return "cold";
  if (temperatureC > profile.optimalMaxC) return "hot";
  return "optimal";
}

/**
 * Estimates the tyre state during one lap without randomness or hidden state.
 * Ordinary wear time remains in alpha*a + beta*a²; this function adds only
 * warm-up, graining, overheating and end-of-life cliff penalties.
 */
export function calculateTyreState(
  input: TyreStateInput,
): TyreStateSnapshot {
  const profile = THERMAL_PROFILES[input.compound];
  const tyreAge = Math.max(0, input.tyreAge);
  const lapsOnSet = tyreAge + 1;
  const maxStintLaps = Math.max(1, input.maxStintLaps);
  const lifeRatio = lapsOnSet / maxStintLaps;
  const severity = clamp(input.tyreSeverity, 2, 5);
  const trackTemperatureC = clamp(input.trackTemperatureC, 10, 60);

  const equilibriumTemperatureC =
    profile.equilibriumTemperatureC +
    2 * (severity - 3) +
    0.16 * (trackTemperatureC - 35);
  const thermalProgress =
    1 - Math.exp(-lapsOnSet / profile.warmupLaps);
  const lateHeatC =
    Math.max(0, lifeRatio - 0.68) *
    (8 + 1.5 * (severity - 2));
  const temperatureC =
    profile.startTemperatureC +
    (equilibriumTemperatureC - profile.startTemperatureC) *
      thermalProgress +
    lateHeatC;

  const warmupLossSeconds =
    profile.firstLapWarmupLossSeconds *
    Math.exp(-tyreAge / profile.warmupLaps);

  const firstLapTemperatureC =
    profile.startTemperatureC +
    (equilibriumTemperatureC - profile.startTemperatureC) *
      (1 - Math.exp(-1 / profile.warmupLaps));
  const initialColdDeficitC = Math.max(
    0,
    profile.optimalMinC - firstLapTemperatureC,
  );
  const grainingLossSeconds =
    0.45 *
    clamp(initialColdDeficitC / 8, 0, 1) ** 1.25 *
    Math.exp(-tyreAge / 3.2);

  const overheatDegreesC = Math.max(
    0,
    temperatureC - profile.optimalMaxC,
  );
  const overheatLossSeconds = Math.min(
    1.5,
    0.016 * overheatDegreesC * overheatDegreesC,
  );

  const cliffProgress = clamp(
    (lifeRatio - 0.82) / 0.18,
    0,
    2.2,
  );
  const cliffLossSeconds =
    1.55 * cliffProgress * cliffProgress;
  const totalStateLossSeconds =
    warmupLossSeconds +
    grainingLossSeconds +
    overheatLossSeconds +
    cliffLossSeconds;

  const wearPercent = clamp(lifeRatio * 100, 0, 160);
  const gripPercent = clamp(
    100 -
      4 * Math.min(lifeRatio, 1.4) -
      1.2 * Math.max(0, input.degradationSeconds) -
      6 *
        (warmupLossSeconds +
          grainingLossSeconds +
          overheatLossSeconds) -
      7 * cliffLossSeconds,
    65,
    100,
  );

  let condition: TyreCondition = "optimal";
  if (cliffLossSeconds >= 0.25 || lifeRatio >= 1) {
    condition = "cliff";
  } else if (overheatLossSeconds >= 0.08) {
    condition = "overheated";
  } else if (grainingLossSeconds >= 0.1) {
    condition = "graining";
  } else if (warmupLossSeconds >= 0.1) {
    condition = "warming";
  } else if (lifeRatio >= 0.68) {
    condition = "worn";
  }

  return {
    temperatureC,
    optimalMinC: profile.optimalMinC,
    optimalMaxC: profile.optimalMaxC,
    thermalState: thermalState(temperatureC, profile),
    condition,
    wearPercent,
    gripPercent,
    warmupLossSeconds,
    grainingLossSeconds,
    overheatLossSeconds,
    cliffLossSeconds,
    totalStateLossSeconds,
  };
}
