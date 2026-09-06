import type { Compound } from "./strategy.ts";
import type { RaceGrid, RaceGridFrame } from "./race-grid.ts";
import { elapsedAtRaceDistance } from "./strategy-race.ts";
import { assessUndercut, type UndercutAssessment } from "./race-experiments.ts";

const DRIVER_NAMES_KO: Readonly<Record<string, string>> = {
  "george-russell": "조지 러셀", "kimi-antonelli": "키미 안토넬리",
  "charles-leclerc": "샤를 르클레르", "lewis-hamilton": "루이스 해밀턴",
  "lando-norris": "랜도 노리스", "oscar-piastri": "오스카 피아스트리",
  "max-verstappen": "막스 베르스타펜", "isack-hadjar": "이삭 하자르",
  "liam-lawson": "리암 로슨", "arvid-lindblad": "아르비드 린드블라드",
  "pierre-gasly": "피에르 가슬리", "franco-colapinto": "프랑코 콜라핀토",
  "esteban-ocon": "에스테반 오콘", "oliver-bearman": "올리버 베어먼",
  "nico-hulkenberg": "니코 휠켄베르크", "gabriel-bortoleto": "가브리엘 보르톨레토",
  "carlos-sainz": "카를로스 사인츠", "alexander-albon": "알렉산더 알본",
  "fernando-alonso": "페르난도 알론소", "lance-stroll": "랜스 스트롤",
  "sergio-perez": "세르히오 페레스", "valtteri-bottas": "발테리 보타스",
};

export function telemetryDriverName(id: string, fallback: string): string {
  return DRIVER_NAMES_KO[id] ?? fallback;
}

export interface ReplayTimingRow {
  readonly id: string;
  readonly name: string;
  readonly position: number;
  readonly positionChange: number;
  readonly compound: Compound;
  /** Completed laps on this set; the current partial lap is excluded. */
  readonly tyreAgeLaps: number;
  readonly leaderGapSeconds: number;
  readonly intervalSeconds: number | null;
  readonly state: "track" | "pit" | "finished";
  readonly isPlayer: boolean;
}

/** Uses the same grid frame and adjusted race clocks as the driving view. */
export function buildReplayTimingRows(
  grid: RaceGrid, frame: RaceGridFrame, playerId: string,
): readonly ReplayTimingRow[] {
  const cars = new Map(grid.cars.map((car) => [car.id, car]));
  return frame.cars.map((car, index) => {
    const ahead = frame.cars[index - 1];
    const aheadPlan = ahead && cars.get(ahead.id)?.replay.strategy;
    // Leader gaps refer to different distances, so subtracting them would not
    // reliably give an interval. Sample the preceding car at THIS car's distance.
    const interval = aheadPlan ? Math.max(0, car.elapsedSeconds
      - elapsedAtRaceDistance(aheadPlan, car.progressLaps)) : null;
    return {
      id: car.id, name: telemetryDriverName(car.id, car.label),
      position: car.position, positionChange: car.gridPosition - car.position,
      compound: car.compound,
      tyreAgeLaps: car.tyreAge + (car.completed ? 1 : 0),
      leaderGapSeconds: car.gapToLeaderSeconds, intervalSeconds: interval,
      state: car.pitState, isPlayer: car.id === playerId,
    };
  });
}

export interface ReplayTelemetryEvent {
  readonly id: string;
  readonly kind: "start" | "pit-entry" | "pit-exit" | "cliff" | "finish";
  readonly driverId: string | null;
  readonly driverName: string;
  readonly lap: number;
  readonly atSeconds: number;
  readonly compound?: Compound;
  readonly fromCompound?: Compound;
}

/** Precompute once per grid. No randomness, timers, or synthetic SC events. */
export function buildReplayTelemetryEvents(grid: RaceGrid): readonly ReplayTelemetryEvent[] {
  const events: ReplayTelemetryEvent[] = [{
    id: "race:start", kind: "start", driverId: null, driverName: "전체 차량",
    lap: 1, atSeconds: 0,
  }];
  for (const car of grid.cars) {
    const driverName = telemetryDriverName(car.id, car.label);
    for (const segment of car.replay.segments) {
      if (segment.kind === "pit-loss") {
        const common = { driverId: car.id, driverName, lap: segment.pitAfterLap,
          compound: segment.toCompound, fromCompound: segment.fromCompound };
        events.push({ ...common, id: `${car.id}:pit-in:${segment.pitAfterLap}`,
          kind: "pit-entry", atSeconds: segment.startSeconds });
        events.push({ ...common, id: `${car.id}:pit-out:${segment.pitAfterLap}`,
          kind: "pit-exit", atSeconds: segment.endSeconds });
      } else {
        const lap = car.replay.strategy.lapCosts[segment.lap - 1];
        const previous = car.replay.strategy.lapCosts[segment.lap - 2];
        if (lap.tyreState.condition === "cliff"
          && (previous?.tyreState.condition !== "cliff" || lap.tyreAge === 0)) {
          events.push({ id: `${car.id}:cliff:${segment.lap}`, kind: "cliff",
            driverId: car.id, driverName, lap: segment.lap,
            atSeconds: segment.startSeconds, compound: segment.compound });
        }
      }
    }
    events.push({ id: `${car.id}:finish`, kind: "finish", driverId: car.id,
      driverName, lap: grid.totalLaps, atSeconds: car.totalSeconds });
  }
  return events.sort((left, right) => left.atSeconds - right.atSeconds
    || left.id.localeCompare(right.id));
}

export function occurredReplayEvents(
  events: readonly ReplayTelemetryEvent[], elapsedSeconds: number, driverId?: string,
): readonly ReplayTelemetryEvent[] {
  return events.filter((event) => event.atSeconds <= elapsedSeconds
    && (!driverId || event.driverId === null || event.driverId === driverId));
}

export interface ReplayUndercutSettlement extends UndercutAssessment {
  readonly opponentId: string;
  readonly opponentName: string;
  /** Both cars must have completed the settlement lap before showing a verdict. */
  readonly resolvedAtSeconds: number;
}

export function prepareReplayUndercuts(
  grid: RaceGrid, playerId: string, comparisonDriverId?: string,
): readonly ReplayUndercutSettlement[] {
  const player = grid.cars.find((car) => car.id === playerId);
  if (!player) return [];
  // Default comparison remains stable across changing live positions.
  const opponent = comparisonDriverId
    ? grid.cars.find((car) => car.id === comparisonDriverId && car.id !== playerId)
    : grid.cars.find((car) => car.gridPosition === player.gridPosition - 1);
  if (!opponent) return [];
  return assessUndercut(player.replay.strategy, opponent.replay.strategy)
    .filter((assessment) => assessment.status !== "not-applicable")
    .map((assessment) => {
      const playerLap = player.lapTimings[assessment.settlementLap - 1];
      const rivalLap = opponent.lapTimings[assessment.settlementLap - 1];
      return { ...assessment, opponentId: opponent.id,
        opponentName: telemetryDriverName(opponent.id, opponent.label),
        resolvedAtSeconds: playerLap && rivalLap
          ? Math.max(playerLap.cumulativeSeconds, rivalLap.cumulativeSeconds) : Infinity };
    });
}

export function settledReplayUndercuts(
  assessments: readonly ReplayUndercutSettlement[], elapsedSeconds: number,
): readonly ReplayUndercutSettlement[] {
  return assessments.filter((assessment) => Number.isFinite(assessment.resolvedAtSeconds)
    && assessment.resolvedAtSeconds <= elapsedSeconds);
}
