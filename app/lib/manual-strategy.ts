import type {
  Compound,
  StopCount,
  StrategyEvaluation,
  StrategyStintInput,
} from "./strategy";

export type ManualCompoundSelection = [Compound, Compound, Compound];
export type ManualPitSelection = [number, number];

export interface ManualStrategyPlan {
  readonly stopCount: StopCount;
  readonly compounds: ManualCompoundSelection;
  readonly pitAfterLaps: ManualPitSelection;
}

function assertRaceDistance(totalLaps: number): void {
  if (!Number.isInteger(totalLaps) || totalLaps < 3) {
    throw new RangeError(
      "A manual strategy requires a race of at least three laps.",
    );
  }
}

function clampInteger(value: number, minimum: number, maximum: number) {
  const integer = Number.isFinite(value) ? Math.round(value) : minimum;
  return Math.min(maximum, Math.max(minimum, integer));
}

export function createDefaultManualPlan(
  totalLaps: number,
): ManualStrategyPlan {
  assertRaceDistance(totalLaps);

  return {
    stopCount: 1,
    compounds: ["M", "H", "S"],
    pitAfterLaps: [
      clampInteger(totalLaps * 0.45, 1, totalLaps - 1),
      clampInteger(totalLaps * 0.72, 2, totalLaps - 1),
    ],
  };
}

export function normalizeManualPlan(
  plan: ManualStrategyPlan,
  totalLaps: number,
  maximumStops: StopCount = 2,
): ManualStrategyPlan {
  assertRaceDistance(totalLaps);

  const stopCount: StopCount =
    plan.stopCount === 2 && maximumStops === 2 ? 2 : 1;
  const firstPitMaximum =
    stopCount === 2 ? totalLaps - 2 : totalLaps - 1;
  const firstPit = clampInteger(
    plan.pitAfterLaps[0],
    1,
    firstPitMaximum,
  );
  const secondPit =
    stopCount === 2
      ? clampInteger(
          plan.pitAfterLaps[1],
          firstPit + 1,
          totalLaps - 1,
        )
      : clampInteger(plan.pitAfterLaps[1], 1, totalLaps - 1);

  return {
    stopCount,
    compounds: [...plan.compounds],
    pitAfterLaps: [firstPit, secondPit],
  };
}

export function buildManualStints(
  plan: ManualStrategyPlan,
  totalLaps: number,
): StrategyStintInput[] {
  const normalized = normalizeManualPlan(plan, totalLaps);
  const [firstPit, secondPit] = normalized.pitAfterLaps;

  if (normalized.stopCount === 1) {
    return [
      {
        compound: normalized.compounds[0],
        startLap: 1,
        endLap: firstPit,
      },
      {
        compound: normalized.compounds[1],
        startLap: firstPit + 1,
        endLap: totalLaps,
      },
    ];
  }

  return [
    {
      compound: normalized.compounds[0],
      startLap: 1,
      endLap: firstPit,
    },
    {
      compound: normalized.compounds[1],
      startLap: firstPit + 1,
      endLap: secondPit,
    },
    {
      compound: normalized.compounds[2],
      startLap: secondPit + 1,
      endLap: totalLaps,
    },
  ];
}

export function manualPlanFromStrategy(
  strategy: Pick<StrategyEvaluation, "stints" | "stopCount">,
  totalLaps: number,
): ManualStrategyPlan {
  const fallback = createDefaultManualPlan(totalLaps);
  if (strategy.stopCount !== 1 && strategy.stopCount !== 2) {
    return fallback;
  }

  const first = strategy.stints[0];
  const second = strategy.stints[1];
  const third = strategy.stints[2];
  if (first === undefined || second === undefined) {
    return fallback;
  }

  return normalizeManualPlan(
    {
      stopCount: strategy.stopCount,
      compounds: [
        first.compound,
        second.compound,
        third?.compound ?? fallback.compounds[2],
      ],
      pitAfterLaps: [
        first.endLap,
        second.endLap < totalLaps
          ? second.endLap
          : fallback.pitAfterLaps[1],
      ],
    },
    totalLaps,
  );
}

export function stintSignature(
  stints: readonly StrategyStintInput[],
): string {
  return stints
    .map(
      (stint) =>
        `${stint.compound}:${stint.startLap}-${stint.endLap}`,
    )
    .join(">");
}
