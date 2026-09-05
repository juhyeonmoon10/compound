import type {
  Compound,
  StrategyEvaluation,
} from "./strategy";

interface ReplaySegmentBase {
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly modelSeconds: number;
}

export interface TrackReplaySegment extends ReplaySegmentBase {
  readonly kind: "track";
  readonly lap: number;
  readonly compound: Compound;
  readonly tyreAge: number;
  readonly lapTimeSeconds: number;
}

export interface PitReplaySegment extends ReplaySegmentBase {
  readonly kind: "pit-loss";
  readonly beforeLap: number;
  readonly pitAfterLap: number;
  readonly fromCompound: Compound;
  readonly toCompound: Compound;
  readonly tyreAge: 0;
}

export type ReplaySegment = TrackReplaySegment | PitReplaySegment;

export interface ReplayFrame {
  readonly elapsedSeconds: number;
  readonly totalSeconds: number;
  readonly lap: number;
  readonly totalLaps: number;
  readonly lapProgress: number;
  readonly trackProgress: number;
  readonly compound: Compound;
  readonly tyreAge: number;
  readonly lapTimeSeconds: number;
  readonly isPitting: boolean;
  readonly pitLossSeconds: number;
  readonly completed: boolean;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function buildReplaySegments(
  strategy: StrategyEvaluation,
): readonly ReplaySegment[] {
  if (strategy.lapCosts.length === 0) {
    throw new RangeError("A replay requires at least one lap.");
  }

  const segments: ReplaySegment[] = [];
  let cursor = 0;

  strategy.lapCosts.forEach((lapCost, index) => {
    const previousCompound =
      strategy.lapCosts[Math.max(0, index - 1)].compound;

    if (lapCost.pitLossSeconds > 0) {
      const endSeconds = cursor + lapCost.pitLossSeconds;
      segments.push({
        kind: "pit-loss",
        beforeLap: lapCost.lap,
        pitAfterLap: lapCost.lap - 1,
        fromCompound: previousCompound,
        toCompound: lapCost.compound,
        tyreAge: 0,
        startSeconds: cursor,
        endSeconds,
        modelSeconds: lapCost.pitLossSeconds,
      });
      cursor = endSeconds;
    }

    const trackSeconds =
      lapCost.lapTimeSeconds - lapCost.pitLossSeconds;
    if (trackSeconds <= 0) {
      throw new RangeError(
        `Lap ${lapCost.lap} must retain positive on-track time.`,
      );
    }

    const endSeconds = cursor + trackSeconds;
    segments.push({
      kind: "track",
      lap: lapCost.lap,
      compound: lapCost.compound,
      tyreAge: lapCost.tyreAge,
      lapTimeSeconds: lapCost.lapTimeSeconds,
      startSeconds: cursor,
      endSeconds,
      modelSeconds: trackSeconds,
    });
    cursor = endSeconds;
  });

  return segments;
}

export function replayFrameAt(
  strategy: StrategyEvaluation,
  segments: readonly ReplaySegment[],
  requestedSeconds: number,
): ReplayFrame {
  if (segments.length === 0 || strategy.lapCosts.length === 0) {
    throw new RangeError("A replay frame requires replay segments.");
  }
  if (!Number.isFinite(requestedSeconds)) {
    throw new RangeError("Replay time must be finite.");
  }

  const totalSeconds = strategy.totalSeconds;
  const elapsedSeconds = clamp(requestedSeconds, 0, totalSeconds);
  const completed = elapsedSeconds >= totalSeconds;
  const activeSegment =
    segments.find((segment) => elapsedSeconds < segment.endSeconds) ??
    segments[segments.length - 1];

  if (activeSegment.kind === "pit-loss") {
    const lapCost =
      strategy.lapCosts[activeSegment.beforeLap - 1] ??
      strategy.lapCosts[strategy.lapCosts.length - 1];
    return {
      elapsedSeconds,
      totalSeconds,
      lap: activeSegment.beforeLap,
      totalLaps: strategy.lapCosts.length,
      lapProgress: 0,
      trackProgress: 0,
      compound: activeSegment.toCompound,
      tyreAge: 0,
      lapTimeSeconds: lapCost.lapTimeSeconds,
      isPitting: true,
      pitLossSeconds: activeSegment.modelSeconds,
      completed: false,
    };
  }

  const segmentProgress = completed
    ? 1
    : clamp(
        (elapsedSeconds - activeSegment.startSeconds) /
          activeSegment.modelSeconds,
        0,
        1,
      );

  return {
    elapsedSeconds,
    totalSeconds,
    lap: activeSegment.lap,
    totalLaps: strategy.lapCosts.length,
    lapProgress: segmentProgress,
    trackProgress: segmentProgress,
    compound: activeSegment.compound,
    tyreAge: activeSegment.tyreAge,
    lapTimeSeconds: activeSegment.lapTimeSeconds,
    isPitting: false,
    pitLossSeconds: 0,
    completed,
  };
}

export function lapStartSeconds(
  strategy: StrategyEvaluation,
  lap: number,
): number {
  if (lap <= 1) return 0;
  if (lap > strategy.lapCosts.length) return strategy.totalSeconds;
  return strategy.lapCosts[lap - 2].cumulativeSeconds;
}
