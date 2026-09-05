import {
  evaluateStrategy,
  type StrategyEvaluation,
  type StrategyOptimizerInput,
  type StrategyStintInput,
} from "./strategy.ts";

export const DEFAULT_PIT_WINDOW_THRESHOLD_SECONDS = 1;
const COST_TOLERANCE_SECONDS = 1e-9;

export interface StrategyPitWindow {
  readonly startLap: number;
  /** The displayed reference plan's pit lap, not a newly optimised pit lap. */
  readonly optimalLap: number;
  readonly endLap: number;
  readonly thresholdSeconds: number;
}

function stintsForPitLaps(
  strategy: StrategyEvaluation,
  pitAfterLaps: readonly number[],
  totalLaps: number,
): StrategyStintInput[] {
  let startLap = 1;

  return strategy.stints.map((stint, index) => {
    const endLap = pitAfterLaps[index] ?? totalLaps;
    const shiftedStint = { compound: stint.compound, startLap, endLap };
    startLap = endLap + 1;
    return shiftedStint;
  });
}

/**
 * Returns a contiguous, one-stop-at-a-time sensitivity interval around each
 * pit lap in a displayed plan. A lap belongs to the interval only when that
 * shifted plan is legal and costs no more than reference + thresholdSeconds.
 *
 * The tyre sequence and every other pit stop stay fixed. These are not weather
 * forecasts, confidence intervals, or permission to move all stops together.
 * A Top 3 row need not be optimal for its tyre sequence, so the comparison is
 * deliberately relative to that row, not to a claimed sequence optimum.
 */
export function calculatePitWindows(
  strategy: StrategyEvaluation,
  optimizerInput: StrategyOptimizerInput,
  totalLaps: number,
  thresholdSeconds = DEFAULT_PIT_WINDOW_THRESHOLD_SECONDS,
): StrategyPitWindow[] {
  if (!Number.isInteger(totalLaps) || totalLaps < 1) {
    throw new RangeError("totalLaps must be a positive integer.");
  }
  if (!Number.isFinite(thresholdSeconds) || thresholdSeconds < 0) {
    throw new RangeError("thresholdSeconds must be a finite, non-negative number.");
  }
  if (strategy.stints.at(-1)?.endLap !== totalLaps) {
    throw new RangeError("The reference strategy must cover totalLaps exactly.");
  }

  const referencePitLaps = strategy.stints.slice(0, -1).map((stint) => stint.endLap);
  if (
    referencePitLaps.length !== strategy.pitAfterLaps.length ||
    referencePitLaps.some((lap, index) => lap !== strategy.pitAfterLaps[index])
  ) {
    throw new RangeError("Reference pit laps must match the reference stints.");
  }
  if (referencePitLaps.length === 0) return [];

  // Re-evaluate rather than trusting a cached/rounded total from the UI.
  const reference = evaluateStrategy({
    ...optimizerInput,
    stints: strategy.stints,
  });
  if (reference.scenarioSignature !== strategy.scenarioSignature) {
    throw new RangeError("Pit windows and their reference strategy must use the same scenario.");
  }
  if (!reference.isLegal) {
    throw new RangeError("Cannot calculate pit windows for an illegal reference strategy.");
  }

  const threshold = reference.totalSeconds + thresholdSeconds;
  const minimumStintLaps = optimizerInput.rules?.minStintLaps ?? 1;

  return referencePitLaps.map((optimalLap, pitIndex) => {
    const previousPit = referencePitLaps[pitIndex - 1] ?? 0;
    const nextPit = referencePitLaps[pitIndex + 1] ?? totalLaps;
    const minimumLap = previousPit + minimumStintLaps;
    const maximumLap = nextPit - minimumStintLaps;

    const isWithinWindow = (candidateLap: number): boolean => {
      const shiftedPitLaps = [...referencePitLaps];
      shiftedPitLaps[pitIndex] = candidateLap;
      const evaluation = evaluateStrategy({
        ...optimizerInput,
        stints: stintsForPitLaps(strategy, shiftedPitLaps, totalLaps),
      });
      return (
        evaluation.isLegal &&
        evaluation.totalSeconds <= threshold + COST_TOLERANCE_SECONDS
      );
    };

    let startLap = optimalLap;
    for (let lap = optimalLap - 1; lap >= minimumLap; lap -= 1) {
      if (!isWithinWindow(lap)) break;
      startLap = lap;
    }

    let endLap = optimalLap;
    for (let lap = optimalLap + 1; lap <= maximumLap; lap += 1) {
      if (!isWithinWindow(lap)) break;
      endLap = lap;
    }

    return { startLap, optimalLap, endLap, thresholdSeconds };
  });
}
