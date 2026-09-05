import {
  buildReplaySegments,
  replayFrameAt,
  type ReplayFrame,
  type ReplaySegment,
} from "./race-replay.ts";
import type {
  StrategyEvaluation,
  StrategyResult,
} from "./strategy";

export interface PreparedStrategyReplay {
  readonly strategy: StrategyEvaluation;
  readonly segments: readonly ReplaySegment[];
}

export interface StrategyRaceFrame {
  readonly elapsedSeconds: number;
  readonly durationSeconds: number;
  readonly primary: ReplayFrame;
  readonly reference: ReplayFrame;
  readonly primaryDistanceLaps: number;
  readonly referenceDistanceLaps: number;
  /**
   * Primary minus reference time at the primary car's current race distance.
   * Positive means the primary strategy has lost model time.
   */
  readonly deltaAtDistanceSeconds: number;
  readonly completed: boolean;
}

export type StrategyComparisonReason =
  | "primary-illegal"
  | "reference-illegal"
  | "scenario-mismatch"
  | "reference-not-optimal"
  | "invalid-score-scale";

export type StrategyComparisonEvaluation =
  | {
      readonly eligible: true;
      readonly reason: null;
      readonly deltaSeconds: number;
      readonly deltaPercent: number;
      readonly score: number;
    }
  | {
      readonly eligible: false;
      readonly reason: StrategyComparisonReason;
      readonly deltaSeconds: null;
      readonly deltaPercent: null;
      readonly score: null;
    };

const COMPARISON_EPSILON = 1e-9;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function hasMatchingScenario(
  primary: StrategyEvaluation,
  reference: StrategyEvaluation,
): boolean {
  return (
    primary.scenarioSignature.length > 0 &&
    primary.scenarioSignature === reference.scenarioSignature
  );
}

function assertReplayPairIsComparable(
  primary: StrategyEvaluation,
  reference: StrategyEvaluation,
): void {
  if (!primary.isLegal || !reference.isLegal) {
    throw new RangeError(
      "Strategy race replays require two legal strategies.",
    );
  }
  if (!hasMatchingScenario(primary, reference)) {
    throw new RangeError(
      "Compared strategies must use the same resolved scenario.",
    );
  }
  if (primary.lapCosts.length !== reference.lapCosts.length) {
    throw new RangeError(
      "Compared strategies must cover the same race distance.",
    );
  }
}

function ineligibleComparison(
  reason: StrategyComparisonReason,
): StrategyComparisonEvaluation {
  return {
    eligible: false,
    reason,
    deltaSeconds: null,
    deltaPercent: null,
    score: null,
  };
}

export function prepareStrategyReplay(
  strategy: StrategyEvaluation,
): PreparedStrategyReplay {
  return {
    strategy,
    segments: buildReplaySegments(strategy),
  };
}

export function raceDistanceAtFrame(frame: ReplayFrame): number {
  if (frame.completed) return frame.totalLaps;
  if (frame.isPitting) return Math.max(0, frame.lap - 1);
  return Math.max(
    0,
    Math.min(
      frame.totalLaps,
      frame.lap - 1 + frame.trackProgress,
    ),
  );
}

/**
 * Returns the earliest model time at which a strategy reaches a race distance.
 * The distance is expressed in completed laps, so 12.5 is halfway through L13.
 */
export function elapsedAtRaceDistance(
  strategy: StrategyEvaluation,
  requestedDistanceLaps: number,
): number {
  const totalLaps = strategy.lapCosts.length;
  const distanceLaps = clamp(requestedDistanceLaps, 0, totalLaps);

  if (distanceLaps <= 0) return 0;
  if (distanceLaps >= totalLaps) return strategy.totalSeconds;

  const completedLaps = Math.floor(distanceLaps);
  const lapProgress = distanceLaps - completedLaps;
  if (lapProgress <= Number.EPSILON) {
    return strategy.lapCosts[completedLaps - 1]?.cumulativeSeconds ?? 0;
  }

  const lapCost = strategy.lapCosts[completedLaps];
  const beforeLapSeconds =
    completedLaps === 0
      ? 0
      : strategy.lapCosts[completedLaps - 1].cumulativeSeconds;
  const onTrackSeconds =
    lapCost.lapTimeSeconds - lapCost.pitLossSeconds;

  return (
    beforeLapSeconds +
    lapCost.pitLossSeconds +
    onTrackSeconds * lapProgress
  );
}

export function strategyRaceFrameAt(
  primaryReplay: PreparedStrategyReplay,
  referenceReplay: PreparedStrategyReplay,
  requestedSeconds: number,
): StrategyRaceFrame {
  if (!Number.isFinite(requestedSeconds)) {
    throw new RangeError("Strategy race time must be finite.");
  }
  assertReplayPairIsComparable(
    primaryReplay.strategy,
    referenceReplay.strategy,
  );

  const durationSeconds = Math.max(
    primaryReplay.strategy.totalSeconds,
    referenceReplay.strategy.totalSeconds,
  );
  const elapsedSeconds = clamp(
    requestedSeconds,
    0,
    durationSeconds,
  );
  const primary = replayFrameAt(
    primaryReplay.strategy,
    primaryReplay.segments,
    elapsedSeconds,
  );
  const reference = replayFrameAt(
    referenceReplay.strategy,
    referenceReplay.segments,
    elapsedSeconds,
  );
  const primaryDistanceLaps = raceDistanceAtFrame(primary);
  const referenceDistanceLaps = raceDistanceAtFrame(reference);
  const referenceTimeAtDistance = elapsedAtRaceDistance(
    referenceReplay.strategy,
    primaryDistanceLaps,
  );

  return {
    elapsedSeconds,
    durationSeconds,
    primary,
    reference,
    primaryDistanceLaps,
    referenceDistanceLaps,
    deltaAtDistanceSeconds:
      primary.elapsedSeconds - referenceTimeAtDistance,
    completed: elapsedSeconds >= durationSeconds,
  };
}

export function finalStrategyDeltaSeconds(
  primary: StrategyEvaluation,
  reference: StrategyEvaluation,
): number {
  return primary.totalSeconds - reference.totalSeconds;
}

/**
 * Scores a legal candidate against the rank-one DP result from the exact same
 * resolved scenario. One track pit-loss of model-time regret halves the score.
 * Invalid comparisons remain explicitly unscored rather than receiving zero.
 */
export function evaluateStrategyComparison(
  primary: StrategyEvaluation,
  optimalReference: StrategyResult,
): StrategyComparisonEvaluation {
  if (!primary.isLegal) {
    return ineligibleComparison("primary-illegal");
  }
  if (!optimalReference.isLegal) {
    return ineligibleComparison("reference-illegal");
  }
  if (!hasMatchingScenario(primary, optimalReference)) {
    return ineligibleComparison("scenario-mismatch");
  }
  if (optimalReference.rank !== 1) {
    return ineligibleComparison("reference-not-optimal");
  }

  const rawDeltaSeconds =
    primary.totalSeconds - optimalReference.totalSeconds;
  if (rawDeltaSeconds < -COMPARISON_EPSILON) {
    return ineligibleComparison("reference-not-optimal");
  }

  const deltaSeconds =
    Math.abs(rawDeltaSeconds) <= COMPARISON_EPSILON
      ? 0
      : rawDeltaSeconds;
  const pitLossSeconds =
    optimalReference.stopCount > 0
      ? optimalReference.breakdown.pitLossSeconds /
        optimalReference.stopCount
      : Number.NaN;

  if (
    deltaSeconds > 0 &&
    (!Number.isFinite(pitLossSeconds) || pitLossSeconds <= 0)
  ) {
    return ineligibleComparison("invalid-score-scale");
  }

  const deltaPercent =
    (deltaSeconds / optimalReference.totalSeconds) * 100;
  const score =
    deltaSeconds === 0
      ? 100
      : Math.max(
          0,
          Math.min(
            100,
            Math.round(
              100 * 2 ** (-deltaSeconds / pitLossSeconds),
            ),
          ),
        );

  return {
    eligible: true,
    reason: null,
    deltaSeconds,
    deltaPercent,
    score,
  };
}
