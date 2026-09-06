import dataset from "../data/ea-ratings.json" with { type: "json" };
import { MODEL_PARAMS } from "../model/params.ts";

export const DRIVER_RATING_FIELDS = ["OVR", "EXP", "RAC", "AWA", "PAC"] as const;
export type DriverRatingField = (typeof DRIVER_RATING_FIELDS)[number];
export type EaDriverRatings = Readonly<Record<DriverRatingField, number>>;

export const DRIVER_RATINGS_SOURCE = Object.freeze({ ...dataset.source, checkedAt: dataset.checkedAt });
export const DRIVER_RATINGS_ITERATION = Object.freeze({ ...dataset.iteration });
export const DRIVER_RATINGS_COVERAGE = Object.freeze({ ...dataset.coverage });
export const DRIVER_RATINGS_METADATA_DISCREPANCIES = Object.freeze(dataset.metadataDiscrepancies.map((item) => Object.freeze({ ...item })));
export const DRIVER_RATING_RECORDS = Object.freeze(dataset.drivers.map((record) => Object.freeze({
  ...record,
  ratings: Object.freeze({ ...record.ratings }),
  eaMetadata: Object.freeze({ ...record.eaMetadata }),
  projectMetadata: Object.freeze({ ...record.projectMetadata }),
})));

export interface DriverPerformanceResolution {
  /** Seconds per lap added to the model; negative means a faster baseline. */
  readonly paceSeconds: number;
  /** Multiplies tyre degradation, not an observed tyre-management score. */
  readonly wearMultiplier: number;
  /** Multiplies the model's wet-surface mismatch penalty. */
  readonly wetPenaltyMultiplier: number;
  /** EA RAC, or the model's neutral racecraft baseline in equal/missing mode. */
  readonly racecraft: number;
  /** Always original EA points, even when equalPerformance bypasses mapping. */
  readonly ratings: EaDriverRatings | null;
  readonly source: typeof DRIVER_RATINGS_SOURCE;
  readonly iteration: typeof DRIVER_RATINGS_ITERATION;
  /** True means a unique complete rating exists, not that it is applied. */
  readonly available: boolean;
}

export function hasValidDriverRatings(value: unknown): value is EaDriverRatings {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return DRIVER_RATING_FIELDS.every((field) => {
    const score = candidate[field];
    return typeof score === "number" && Number.isFinite(score) && Number.isInteger(score) &&
      score >= MODEL_PARAMS.performance.ratingMin && score <= MODEL_PARAMS.performance.ratingMax;
  });
}

/** Official game judgement → explicit project mapping; no points are invented. */
export function resolveDriverPerformance(driverId: string, equalPerformance = false): DriverPerformanceResolution {
  const matches = DRIVER_RATING_RECORDS.filter((record) => record.driverId === driverId);
  const ratings = matches.length === 1 && hasValidDriverRatings(matches[0].ratings) ? matches[0].ratings : null;
  const P = MODEL_PARAMS.performance;
  const shared = { ratings, source: DRIVER_RATINGS_SOURCE, iteration: DRIVER_RATINGS_ITERATION, available: ratings !== null };
  if (equalPerformance || ratings === null) {
    return {
      ...shared,
      paceSeconds: P.neutralPaceSeconds,
      wearMultiplier: P.neutralDeg,
      wetPenaltyMultiplier: P.neutralDeg,
      racecraft: MODEL_PARAMS.race.racecraftReference,
    };
  }
  const wetRating = P.wetOverallWeight * ratings.OVR + P.wetAwarenessWeight * ratings.AWA;
  return {
    ...shared,
    paceSeconds: (P.paceReference - ratings.PAC) * P.paceSecondsPerPoint,
    wearMultiplier: P.neutralDeg - (ratings.EXP - P.experienceReference) * P.wearPerExperiencePoint,
    wetPenaltyMultiplier: P.neutralDeg + (P.wetReference - wetRating) * P.wetPenaltyPerPoint,
    racecraft: ratings.RAC,
  };
}
