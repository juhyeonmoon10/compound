import { MODEL_PARAMS, RAIN_LABELS } from "../model/params.ts";

export type RainPreset = keyof typeof RAIN_LABELS;
export type WeatherCompound = "S" | "M" | "H" | "INTER" | "WET";
export interface WeatherInput {
  readonly preset: RainPreset;
  readonly startLap?: number;
  readonly endLap?: number;
  readonly initialWater?: number;
  readonly carsOnTrack?: number;
}
export interface WeatherLap { readonly lap: number; readonly raining: boolean; readonly water: number }
export interface WeatherTimeline {
  readonly input: WeatherInput;
  readonly laps: readonly WeatherLap[];
  readonly wetRace: boolean;
  /** Prefix counts make history-dependent dry heat O(1); lap−age determines stint start. */
  readonly interDryPrefix: readonly number[];
  readonly wetDryPrefix: readonly number[];
}
const P = MODEL_PARAMS.weather;
const clamp = (n: number) => Math.min(1, Math.max(0, n));

export function buildWeatherTimeline(laps: number, trackTemperatureC: number, input: WeatherInput = { preset: "none" }): WeatherTimeline {
  if (!(input.preset in RAIN_LABELS)) throw new RangeError("알 수 없는 강수 프리셋입니다.");
  const startLap = input.startLap ?? (input.preset === "dry-to-rain" ? Math.max(1, Math.round(laps * P.defaultStartFraction)) : 1);
  const endLap = input.endLap ?? (input.preset === "rain-to-dry" ? Math.max(startLap, Math.round(laps * P.defaultEndFraction)) : laps);
  if (!Number.isInteger(laps) || laps < 1 || !Number.isFinite(trackTemperatureC)) throw new RangeError("랩 수·노면 온도가 유효하지 않습니다.");
  if (!Number.isInteger(startLap) || !Number.isInteger(endLap) || startLap < 1 || endLap < startLap || endLap > laps) throw new RangeError("비 구간은 전체 레이스 안의 연속된 랩이어야 합니다.");
  const initialWater = input.initialWater ?? P.defaultInitialWater;
  if (!Number.isFinite(initialWater) || initialWater < 0 || initialWater > 1) throw new RangeError("초기 수막은 0~1입니다.");
  const cars = input.carsOnTrack ?? P.referenceCars;
  if (!Number.isFinite(cars) || cars < 0) throw new RangeError("차량 수는 음수가 될 수 없습니다.");
  const dryRate = P.dryRate * (1 + P.carDryingFactor * cars / P.referenceCars) * (trackTemperatureC >= P.hotTrackC ? P.hotDryingFactor : 1);
  const rainRate = input.preset === "heavy" ? P.heavyRainRate : P.lightRainRate;
  let water = initialWater;
  const timeline: WeatherLap[] = [];
  const interDryPrefix = [0], wetDryPrefix = [0];
  for (let lap = 1; lap <= laps; lap++) {
    const raining = input.preset !== "none" && lap >= startLap && lap <= endLap;
    water = clamp(water + (raining ? rainRate : -dryRate));
    timeline.push({ lap, raining, water });
    interDryPrefix.push(interDryPrefix[lap - 1] + Number(water < P.interLower));
    wetDryPrefix.push(wetDryPrefix[lap - 1] + Number(water < P.interUpper));
  }
  return { input: { ...input, startLap, endLap, initialWater, carsOnTrack: cars }, laps: timeline, wetRace: timeline.some(row => row.water > P.slickLimit), interDryPrefix, wetDryPrefix };
}

/** Wet penalty excludes ordinary alpha wear; dry heat resets at each new tyre set. */
export function wetPenalty(compound: WeatherCompound, water: number, previousDryLaps = 0): number {
  if (!Number.isFinite(water) || water < 0 || water > 1) throw new RangeError("수막은 0~1입니다.");
  if (compound === "INTER") return (water > P.interUpper ? P.interDeepBase + P.interDeepSlope * (water - P.interUpper) : P.interBase) + P.interHeatPerDryLap * previousDryLaps;
  if (compound === "WET") return P.wetBase + P.wetHeatPerDryLap * previousDryLaps;
  return water <= P.slickLimit ? P.slickDampPenalty * water / P.slickLimit : P.slickWetBase + P.slickWetSlope * (water - P.slickLimit);
}

export function dryLapsOnSet(timeline: WeatherTimeline, compound: WeatherCompound, lap: number, tyreAge: number): number {
  const prefix = compound === "INTER" ? timeline.interDryPrefix : timeline.wetDryPrefix;
  return prefix[lap - 1] - prefix[Math.max(0, lap - tyreAge - 1)];
}

export function calculatedCrossovers(): { slickInter: number; interWet: number; note: string } {
  const step = MODEL_PARAMS.validation.crossoverStep;
  let slickInter = Number.NaN, interWet = Number.NaN;
  for (let i = 0; i <= Math.round(1 / step); i++) {
    const water = i * step;
    if (!Number.isFinite(slickInter) && wetPenalty("M", water) >= wetPenalty("INTER", water)) slickInter = water;
    if (!Number.isFinite(interWet) && wetPenalty("INTER", water) >= wetPenalty("WET", water) - MODEL_PARAMS.validation.toleranceSeconds) interWet = water;
  }
  return { slickInter, interWet, note: "프로젝트 추정 · 새 타이어의 수막 페널티만 비교. 슬릭 경계는 불연속 전환으로, 두 시간이 같아지는 교점이 아님." };
}
