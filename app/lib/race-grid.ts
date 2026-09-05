import { replayFrameAt, type ReplayFrame } from "./race-replay.ts";
import {
  elapsedAtRaceDistance,
  prepareStrategyReplay,
  raceDistanceAtFrame,
  type PreparedStrategyReplay,
} from "./strategy-race.ts";
import {
  formatRaceTime,
  type Compound,
  type StrategyEvaluation,
} from "./strategy.ts";
import {
  neutralPerformanceRatings,
  type RacePerformanceMode,
  type RacePerformanceRatings,
} from "./performance.ts";

export const RACE_GRID_SIZE = 20;

export interface RaceGridEntry {
  readonly id: string;
  readonly label?: string;
  readonly gridPosition: number;
  /** Cars sharing a pit group can incur a deterministic stack delay. */
  readonly pitGroup: string;
  readonly strategy: StrategyEvaluation;
  readonly performance?: RacePerformanceRatings;
}

export interface RaceGridParameters {
  /** One-time first-lap model-time offset per grid slot. */
  readonly gridSlotOffsetSeconds: number;
  /** Previous-lap gap inside which the following car receives traffic loss. */
  readonly trafficWindowSeconds: number;
  /** Maximum deterministic traffic loss applied to one lap. */
  readonly maximumTrafficLossSeconds: number;
  /** Arrival gap inside which two cars sharing a pit group stack. */
  readonly pitStackWindowSeconds: number;
  /** Fixed model-time loss for the queued car in a pit stack. */
  readonly pitStackLossSeconds: number;
}

export type RaceGridOptions = Partial<RaceGridParameters> & {
  readonly performanceMode?: RacePerformanceMode;
};

export interface RaceGridLapTiming {
  readonly lap: number;
  readonly compound: Compound;
  readonly tyreAge: number;
  readonly baseLapTimeSeconds: number;
  readonly gridOffsetSeconds: number;
  readonly trafficLossSeconds: number;
  readonly pitStackLossSeconds: number;
  readonly carPaceAdjustmentSeconds: number;
  readonly driverPaceAdjustmentSeconds: number;
  readonly tyreManagementAdjustmentSeconds: number;
  readonly consistencyAdjustmentSeconds: number;
  readonly racecraftAdjustmentSeconds: number;
  readonly pitCrewAdjustmentSeconds: number;
  readonly performanceAdjustmentSeconds: number;
  readonly pitLossSeconds: number;
  readonly adjustedLapTimeSeconds: number;
  readonly cumulativeSeconds: number;
}

export interface RaceGridCar {
  readonly id: string;
  readonly label: string;
  readonly gridPosition: number;
  readonly pitGroup: string;
  readonly strategy: StrategyEvaluation;
  readonly performance: RacePerformanceRatings;
  readonly lapTimings: readonly RaceGridLapTiming[];
  readonly totalSeconds: number;
  readonly replay: PreparedStrategyReplay;
}

export interface RaceGrid {
  readonly scenarioSignature: string;
  readonly totalLaps: number;
  readonly durationSeconds: number;
  readonly performanceMode: RacePerformanceMode;
  readonly parameters: Readonly<RaceGridParameters>;
  /** Stable grid-position order. */
  readonly cars: readonly RaceGridCar[];
}

export type RaceGridPitState = "track" | "pit" | "finished";

export interface RaceGridCarFrame {
  readonly id: string;
  readonly label: string;
  readonly gridPosition: number;
  readonly position: number;
  readonly gapToLeaderSeconds: number;
  readonly elapsedSeconds: number;
  readonly totalSeconds: number;
  readonly progressLaps: number;
  readonly lap: number;
  readonly lapProgress: number;
  readonly compound: Compound;
  readonly tyreAge: number;
  readonly pitState: RaceGridPitState;
  readonly isPitting: boolean;
  readonly completed: boolean;
}

export interface RaceGridFrame {
  readonly elapsedSeconds: number;
  readonly durationSeconds: number;
  readonly completed: boolean;
  /** Live race order, from P1 to P20. */
  readonly cars: readonly RaceGridCarFrame[];
}

export const DEFAULT_RACE_GRID_PARAMETERS: Readonly<RaceGridParameters> = {
  gridSlotOffsetSeconds: 0.12,
  trafficWindowSeconds: 1.5,
  maximumTrafficLossSeconds: 0.18,
  pitStackWindowSeconds: 3,
  pitStackLossSeconds: 2.4,
};

const ORDER_EPSILON = 1e-9;

interface MutableGridCar {
  readonly entry: RaceGridEntry;
  readonly performance: RacePerformanceRatings;
  readonly consistencyAdjustments: readonly number[];
  readonly lapTimings: RaceGridLapTiming[];
  cumulativeSeconds: number;
}

interface WorkingCarFrame {
  readonly car: RaceGridCar;
  readonly frame: ReplayFrame;
  readonly progressLaps: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizedRating(rating: number): number {
  return clamp((rating - 80) / 20, -1, 1);
}

function stableUnitValue(key: string): number {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function consistencyAdjustments(
  id: string,
  laps: number,
  rating: number,
  mode: RacePerformanceMode,
): readonly number[] {
  if (mode === "equal") return Array.from({ length: laps }, () => 0);
  const amplitude =
    (0.05 * (1 - normalizedRating(rating))) / 2;
  const raw = Array.from(
    { length: laps },
    (_, index) => stableUnitValue(`${id}:${index + 1}`) * 2 - 1,
  );
  const average =
    raw.reduce((total, value) => total + value, 0) /
    Math.max(1, raw.length);
  const centered = raw.map((value) => value - average);
  const maximum = Math.max(
    Number.EPSILON,
    ...centered.map((value) => Math.abs(value)),
  );
  return centered.map((value) => (value / maximum) * amplitude);
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative finite number.`);
  }
}

function resolveParameters(
  options: RaceGridOptions,
): Readonly<RaceGridParameters> {
  const { performanceMode, ...parameterOverrides } = options;
  void performanceMode;
  const parameters = {
    ...DEFAULT_RACE_GRID_PARAMETERS,
    ...parameterOverrides,
  };

  for (const [name, value] of Object.entries(parameters)) {
    assertNonNegativeFinite(value, name);
  }

  return parameters;
}

function resolvePerformanceMode(
  options: RaceGridOptions,
): RacePerformanceMode {
  const mode = options.performanceMode ?? "equal";
  if (mode !== "equal" && mode !== "realistic") {
    throw new RangeError(
      "performanceMode must be either equal or realistic.",
    );
  }
  return mode;
}

function compareEntryOrder(
  left: RaceGridEntry,
  right: RaceGridEntry,
): number {
  return (
    left.gridPosition - right.gridPosition ||
    left.id.localeCompare(right.id)
  );
}

const PERFORMANCE_RATING_KEYS = [
  "carPace",
  "driverPace",
  "tyreManagement",
  "consistency",
  "racecraft",
  "pitCrew",
] as const satisfies readonly (keyof RacePerformanceRatings)[];

function validatePerformanceRatings(
  ratings: RacePerformanceRatings | undefined,
): void {
  if (!ratings) return;
  for (const key of PERFORMANCE_RATING_KEYS) {
    const value = ratings[key];
    if (
      !Number.isInteger(value) ||
      value < 0 ||
      value > 100
    ) {
      throw new RangeError(
        `Performance rating ${key} must be an integer from 0 to 100.`,
      );
    }
  }
}

function validateEntries(entries: readonly RaceGridEntry[]): void {
  if (entries.length !== RACE_GRID_SIZE) {
    throw new RangeError(
      `A strategy grid requires exactly ${RACE_GRID_SIZE} cars.`,
    );
  }

  const ids = new Set<string>();
  const gridPositions = new Set<number>();
  const pitGroupCounts = new Map<string, number>();
  const scenarioSignature = entries[0]?.strategy.scenarioSignature;
  const totalLaps = entries[0]?.strategy.lapCosts.length;

  for (const entry of entries) {
    if (entry.id.trim().length === 0 || ids.has(entry.id)) {
      throw new RangeError("Race-grid car ids must be non-empty and unique.");
    }
    ids.add(entry.id);

    if (
      !Number.isInteger(entry.gridPosition) ||
      entry.gridPosition < 1 ||
      entry.gridPosition > RACE_GRID_SIZE ||
      gridPositions.has(entry.gridPosition)
    ) {
      throw new RangeError(
        `Grid positions must uniquely cover 1-${RACE_GRID_SIZE}.`,
      );
    }
    gridPositions.add(entry.gridPosition);

    const pitGroup = entry.pitGroup.trim();
    if (pitGroup.length === 0) {
      throw new RangeError("Every race-grid car requires a pit group.");
    }
    const pitGroupCount = (pitGroupCounts.get(pitGroup) ?? 0) + 1;
    if (pitGroupCount > 2) {
      throw new RangeError(
        "A pit group can contain at most two cars.",
      );
    }
    pitGroupCounts.set(pitGroup, pitGroupCount);
    validatePerformanceRatings(entry.performance);

    if (!entry.strategy.isLegal) {
      throw new RangeError(
        `Race-grid strategy for ${entry.id} must be legal.`,
      );
    }
    if (
      scenarioSignature === undefined ||
      scenarioSignature.length === 0 ||
      entry.strategy.scenarioSignature !== scenarioSignature
    ) {
      throw new RangeError(
        "All race-grid strategies must use the same resolved scenario.",
      );
    }
    if (entry.strategy.lapCosts.length !== totalLaps) {
      throw new RangeError(
        "All race-grid strategies must cover the same race distance.",
      );
    }
  }
}

function gridOffsetSeconds(
  gridPosition: number,
  parameters: RaceGridParameters,
): number {
  return (gridPosition - 1) * parameters.gridSlotOffsetSeconds;
}

interface TrafficAdjustment {
  readonly lossSeconds: number;
  readonly racecraftAdjustmentSeconds: number;
}

function trafficLossesForLap(
  orderedCars: readonly MutableGridCar[],
  previousTimes: ReadonlyMap<string, number>,
  parameters: RaceGridParameters,
  performanceMode: RacePerformanceMode,
): ReadonlyMap<string, TrafficAdjustment> {
  const losses = new Map<string, TrafficAdjustment>();

  orderedCars.forEach((car, index) => {
    if (
      index === 0 ||
      parameters.trafficWindowSeconds <= 0 ||
      parameters.maximumTrafficLossSeconds <= 0
    ) {
      losses.set(car.entry.id, {
        lossSeconds: 0,
        racecraftAdjustmentSeconds: 0,
      });
      return;
    }

    const carAhead = orderedCars[index - 1];
    const gapSeconds = Math.max(
      0,
      (previousTimes.get(car.entry.id) ?? 0) -
        (previousTimes.get(carAhead.entry.id) ?? 0),
    );
    const proximity =
      gapSeconds >= parameters.trafficWindowSeconds
        ? 0
        : 1 - gapSeconds / parameters.trafficWindowSeconds;
    const baseLoss =
      parameters.maximumTrafficLossSeconds * proximity;
    const lossSeconds =
      performanceMode === "realistic"
        ? baseLoss *
          (1 -
            0.12 *
              normalizedRating(car.performance.racecraft))
        : baseLoss;
    losses.set(car.entry.id, {
      lossSeconds,
      racecraftAdjustmentSeconds: lossSeconds - baseLoss,
    });
  });

  return losses;
}

function pitStackLossesForLap(
  cars: readonly MutableGridCar[],
  lap: number,
  previousTimes: ReadonlyMap<string, number>,
  parameters: RaceGridParameters,
): ReadonlyMap<string, number> {
  const losses = new Map<string, number>(
    cars.map((car) => [car.entry.id, 0]),
  );
  if (
    parameters.pitStackWindowSeconds <= 0 ||
    parameters.pitStackLossSeconds <= 0
  ) {
    return losses;
  }

  const pittersByGroup = new Map<string, MutableGridCar[]>();
  for (const car of cars) {
    if (car.entry.strategy.lapCosts[lap - 1].pitLossSeconds <= 0) {
      continue;
    }
    const group = pittersByGroup.get(car.entry.pitGroup) ?? [];
    group.push(car);
    pittersByGroup.set(car.entry.pitGroup, group);
  }

  for (const group of pittersByGroup.values()) {
    const ordered = [...group].sort(
      (left, right) =>
        (previousTimes.get(left.entry.id) ?? 0) -
          (previousTimes.get(right.entry.id) ?? 0) ||
        compareEntryOrder(left.entry, right.entry),
    );
    for (let index = 1; index < ordered.length; index += 1) {
      const previousArrival =
        previousTimes.get(ordered[index - 1].entry.id) ?? 0;
      const arrival = previousTimes.get(ordered[index].entry.id) ?? 0;
      if (
        arrival - previousArrival <=
        parameters.pitStackWindowSeconds
      ) {
        losses.set(
          ordered[index].entry.id,
          parameters.pitStackLossSeconds,
        );
      }
    }
  }

  return losses;
}

function buildAdjustedStrategy(
  strategy: StrategyEvaluation,
  lapTimings: readonly RaceGridLapTiming[],
): StrategyEvaluation {
  const onTrackAdjustment = lapTimings.reduce(
    (total, lap) =>
      total +
      lap.gridOffsetSeconds +
      lap.trafficLossSeconds +
      lap.carPaceAdjustmentSeconds +
      lap.driverPaceAdjustmentSeconds +
      lap.tyreManagementAdjustmentSeconds +
      lap.consistencyAdjustmentSeconds,
    0,
  );
  const pitStackAdjustment = lapTimings.reduce(
    (total, lap) =>
      total +
      lap.pitStackLossSeconds +
      lap.pitCrewAdjustmentSeconds,
    0,
  );
  const totalSeconds =
    lapTimings[lapTimings.length - 1]?.cumulativeSeconds ?? 0;

  return {
    ...strategy,
    totalSeconds,
    formattedTime: formatRaceTime(totalSeconds),
    breakdown: {
      ...strategy.breakdown,
      baselineSeconds:
        strategy.breakdown.baselineSeconds + onTrackAdjustment,
      pitLossSeconds:
        strategy.breakdown.pitLossSeconds + pitStackAdjustment,
      totalSeconds,
    },
    lapCosts: strategy.lapCosts.map((lapCost, index) => {
      const timing = lapTimings[index];
      return {
        ...lapCost,
        baselineSeconds:
          lapCost.baselineSeconds +
          timing.gridOffsetSeconds +
          timing.trafficLossSeconds +
          timing.carPaceAdjustmentSeconds +
          timing.driverPaceAdjustmentSeconds +
          timing.tyreManagementAdjustmentSeconds +
          timing.consistencyAdjustmentSeconds,
        pitLossSeconds:
          lapCost.pitLossSeconds +
          timing.pitStackLossSeconds +
          timing.pitCrewAdjustmentSeconds,
        lapTimeSeconds: timing.adjustedLapTimeSeconds,
        cumulativeSeconds: timing.cumulativeSeconds,
      };
    }),
  };
}

/**
 * Builds a locked, deterministic 20-car race from already evaluated
 * strategies. No driver, control, reaction-time, or random input exists.
 */
export function createRaceGrid(
  entries: readonly RaceGridEntry[],
  options: RaceGridOptions = {},
): RaceGrid {
  validateEntries(entries);
  const parameters = resolveParameters(options);
  const performanceMode = resolvePerformanceMode(options);
  const orderedEntries = [...entries].sort(compareEntryOrder);
  const totalLaps = orderedEntries[0].strategy.lapCosts.length;
  const mutableCars: MutableGridCar[] = orderedEntries.map((entry) => ({
    entry: {
      ...entry,
      label: entry.label ?? entry.id,
      pitGroup: entry.pitGroup.trim(),
    },
    performance:
      performanceMode === "realistic"
        ? (entry.performance ?? neutralPerformanceRatings())
        : neutralPerformanceRatings(),
    consistencyAdjustments: consistencyAdjustments(
      entry.id,
      totalLaps,
      entry.performance?.consistency ?? 80,
      performanceMode,
    ),
    lapTimings: [],
    cumulativeSeconds: 0,
  }));
  let previousTimes = new Map<string, number>(
    mutableCars.map((car) => [
      car.entry.id,
      gridOffsetSeconds(car.entry.gridPosition, parameters),
    ]),
  );

  for (let lap = 1; lap <= totalLaps; lap += 1) {
    const previousOrder = [...mutableCars].sort(
      (left, right) =>
        (previousTimes.get(left.entry.id) ?? 0) -
          (previousTimes.get(right.entry.id) ?? 0) ||
        compareEntryOrder(left.entry, right.entry),
    );
    const trafficLosses = trafficLossesForLap(
      previousOrder,
      previousTimes,
      parameters,
      performanceMode,
    );
    const pitStackLosses = pitStackLossesForLap(
      mutableCars,
      lap,
      previousTimes,
      parameters,
    );

    for (const car of mutableCars) {
      const lapCost = car.entry.strategy.lapCosts[lap - 1];
      const oneTimeGridOffset =
        lap === 1
          ? gridOffsetSeconds(car.entry.gridPosition, parameters)
          : 0;
      const trafficAdjustment = trafficLosses.get(
        car.entry.id,
      ) ?? {
        lossSeconds: 0,
        racecraftAdjustmentSeconds: 0,
      };
      const trafficLoss = trafficAdjustment.lossSeconds;
      const pitStackLoss = pitStackLosses.get(car.entry.id) ?? 0;
      const realistic = performanceMode === "realistic";
      const carPaceAdjustmentSeconds = realistic
        ? -lapCost.baselineSeconds *
          0.00028 *
          normalizedRating(car.performance.carPace)
        : 0;
      const driverPaceAdjustmentSeconds = realistic
        ? -lapCost.baselineSeconds *
          0.00008 *
          normalizedRating(car.performance.driverPace)
        : 0;
      const degradationSeconds =
        lapCost.linearDegradationSeconds +
        lapCost.quadraticDegradationSeconds +
        lapCost.tyreState.grainingLossSeconds +
        lapCost.tyreState.overheatLossSeconds +
        lapCost.tyreState.cliffLossSeconds;
      const tyreManagementAdjustmentSeconds = realistic
        ? -degradationSeconds *
          0.04 *
          normalizedRating(car.performance.tyreManagement)
        : 0;
      const consistencyAdjustmentSeconds = realistic
        ? car.consistencyAdjustments[lap - 1]
        : 0;
      const pitCrewAdjustmentSeconds =
        realistic && lapCost.pitLossSeconds > 0
          ? -0.25 *
            normalizedRating(car.performance.pitCrew)
          : 0;
      const performanceAdjustmentSeconds =
        carPaceAdjustmentSeconds +
        driverPaceAdjustmentSeconds +
        tyreManagementAdjustmentSeconds +
        consistencyAdjustmentSeconds +
        trafficAdjustment.racecraftAdjustmentSeconds +
        pitCrewAdjustmentSeconds;
      const adjustedLapTimeSeconds =
        lapCost.lapTimeSeconds +
        oneTimeGridOffset +
        trafficLoss +
        pitStackLoss +
        carPaceAdjustmentSeconds +
        driverPaceAdjustmentSeconds +
        tyreManagementAdjustmentSeconds +
        consistencyAdjustmentSeconds +
        pitCrewAdjustmentSeconds;
      car.cumulativeSeconds += adjustedLapTimeSeconds;
      car.lapTimings.push({
        lap,
        compound: lapCost.compound,
        tyreAge: lapCost.tyreAge,
        baseLapTimeSeconds: lapCost.lapTimeSeconds,
        gridOffsetSeconds: oneTimeGridOffset,
        trafficLossSeconds: trafficLoss,
        pitStackLossSeconds: pitStackLoss,
        carPaceAdjustmentSeconds,
        driverPaceAdjustmentSeconds,
        tyreManagementAdjustmentSeconds,
        consistencyAdjustmentSeconds,
        racecraftAdjustmentSeconds:
          trafficAdjustment.racecraftAdjustmentSeconds,
        pitCrewAdjustmentSeconds,
        performanceAdjustmentSeconds,
        pitLossSeconds:
          lapCost.pitLossSeconds +
          pitStackLoss +
          pitCrewAdjustmentSeconds,
        adjustedLapTimeSeconds,
        cumulativeSeconds: car.cumulativeSeconds,
      });
    }

    previousTimes = new Map(
      mutableCars.map((car) => [
        car.entry.id,
        car.cumulativeSeconds,
      ]),
    );
  }

  const cars: RaceGridCar[] = mutableCars.map((car) => {
    const adjustedStrategy = buildAdjustedStrategy(
      car.entry.strategy,
      car.lapTimings,
    );
    return {
      id: car.entry.id,
      label: car.entry.label ?? car.entry.id,
      gridPosition: car.entry.gridPosition,
      pitGroup: car.entry.pitGroup,
      strategy: car.entry.strategy,
      performance: car.performance,
      lapTimings: car.lapTimings,
      totalSeconds: adjustedStrategy.totalSeconds,
      replay: prepareStrategyReplay(adjustedStrategy),
    };
  });

  return {
    scenarioSignature: cars[0].strategy.scenarioSignature,
    totalLaps,
    durationSeconds: Math.max(...cars.map((car) => car.totalSeconds)),
    performanceMode,
    parameters,
    cars,
  };
}

function compareWorkingFrames(
  left: WorkingCarFrame,
  right: WorkingCarFrame,
): number {
  const progressDelta = right.progressLaps - left.progressLaps;
  if (Math.abs(progressDelta) > ORDER_EPSILON) {
    return progressDelta;
  }

  const leftTime = elapsedAtRaceDistance(
    left.car.replay.strategy,
    left.progressLaps,
  );
  const rightTime = elapsedAtRaceDistance(
    right.car.replay.strategy,
    right.progressLaps,
  );
  const timeDelta = leftTime - rightTime;
  if (Math.abs(timeDelta) > ORDER_EPSILON) {
    return timeDelta;
  }

  return (
    left.car.gridPosition - right.car.gridPosition ||
    left.car.id.localeCompare(right.car.id)
  );
}

/**
 * Samples all twenty autonomous cars at one shared model time.
 */
export function raceGridFrameAt(
  grid: RaceGrid,
  requestedSeconds: number,
): RaceGridFrame {
  if (!Number.isFinite(requestedSeconds)) {
    throw new RangeError("Race-grid time must be finite.");
  }
  const elapsedSeconds = clamp(
    requestedSeconds,
    0,
    grid.durationSeconds,
  );
  const workingFrames: WorkingCarFrame[] = grid.cars.map((car) => {
    const frame = replayFrameAt(
      car.replay.strategy,
      car.replay.segments,
      elapsedSeconds,
    );
    return {
      car,
      frame,
      progressLaps: raceDistanceAtFrame(frame),
    };
  });
  workingFrames.sort(compareWorkingFrames);
  const leader = workingFrames[0];

  const cars = workingFrames.map((working, index): RaceGridCarFrame => {
    const referenceTimeAtDistance =
      index === 0
        ? working.frame.elapsedSeconds
        : elapsedAtRaceDistance(
            leader.car.replay.strategy,
            working.progressLaps,
          );
    const gapToLeaderSeconds =
      index === 0
        ? 0
        : Math.max(
            0,
            working.frame.elapsedSeconds - referenceTimeAtDistance,
          );
    const pitState: RaceGridPitState = working.frame.completed
      ? "finished"
      : working.frame.isPitting
        ? "pit"
        : "track";

    return {
      id: working.car.id,
      label: working.car.label,
      gridPosition: working.car.gridPosition,
      position: index + 1,
      gapToLeaderSeconds,
      elapsedSeconds: working.frame.elapsedSeconds,
      totalSeconds: working.car.totalSeconds,
      progressLaps: working.progressLaps,
      lap: working.frame.lap,
      lapProgress: working.frame.lapProgress,
      compound: working.frame.compound,
      tyreAge: working.frame.tyreAge,
      pitState,
      isPitting: working.frame.isPitting,
      completed: working.frame.completed,
    };
  });

  return {
    elapsedSeconds,
    durationSeconds: grid.durationSeconds,
    completed: elapsedSeconds >= grid.durationSeconds,
    cars,
  };
}

export function raceGridCar(
  grid: RaceGrid,
  carId: string,
): RaceGridCar {
  const car = grid.cars.find((candidate) => candidate.id === carId);
  if (car === undefined) {
    throw new RangeError(`Unknown race-grid car: ${carId}.`);
  }
  return car;
}
