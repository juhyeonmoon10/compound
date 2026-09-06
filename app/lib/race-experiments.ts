import { MODEL_PARAMS } from "../model/params.ts";
import type { StrategyEvaluation } from "./strategy.ts";

const P = MODEL_PARAMS.race;
const EPSILON = MODEL_PARAMS.validation.toleranceSeconds;

export type NeutralisationKind = "SC" | "VSC";

export interface RaceExperimentEvent {
  readonly kind: NeutralisationKind;
  readonly startLap: number;
  readonly endLap: number;
}

export interface RaceExperimentTimeline {
  readonly id: string;
  readonly trial: number;
  readonly events: readonly RaceExperimentEvent[];
}

export interface RaceEventPrior {
  /** Per-race probability of generating one event, NOT a per-lap hazard. */
  readonly scProbability: number;
  readonly vscProbability: number;
  readonly sourceType: "observed" | "project-estimate";
  readonly sourceLabel: string;
  readonly sourceUrl?: string;
  readonly sampleRaces?: number;
}

export interface RaceExperimentOptions {
  readonly seed?: number;
  readonly trials?: number;
  readonly trackLaps?: number;
  /** Overrides the green-flag loss only at an existing scheduled stop. */
  readonly pitLossSeconds?: number;
  readonly racecraft?: number;
  readonly startingGridPosition?: number;
  readonly eventPrior?: RaceEventPrior;
  /** Fixed rival plan pool, shared by all tested candidates. */
  readonly rivalStrategies?: readonly StrategyEvaluation[];
  /** Same roster/plans as 3D; adjusted for entry coefficients, NEVER traffic. */
  readonly fixedRivals?: readonly RaceExperimentRival[];
  readonly playerId?: string;
  readonly gridSlotOffsetSeconds?: number;
}

export interface RaceExperimentRival {
  readonly driverId: string;
  readonly gridPosition: number;
  readonly strategy: StrategyEvaluation;
  readonly racecraft: number;
  readonly costBasis: "entry-adjusted-no-traffic";
}

export interface CandidateTrialResult {
  readonly trial: number;
  readonly eventTimelineId: string;
  readonly totalSeconds: number;
  readonly trafficLossSeconds: number;
  readonly pitSavingSeconds: number;
  readonly finishPosition: number;
  readonly overtakes: number;
}

export interface CandidateExperimentResult {
  readonly candidateIndex: number;
  readonly signature: string;
  readonly meanSeconds: number;
  readonly p10Seconds: number;
  readonly p90Seconds: number;
  /** Chance of being quickest among the supplied candidates; ties split credit. */
  readonly winRate: number;
  readonly gridWinRate: number;
  readonly meanFinishPosition: number;
  readonly meanTrafficLossSeconds: number;
  readonly meanPitSavingSeconds: number;
  readonly meanOvertakes: number;
  readonly trials: readonly CandidateTrialResult[];
}

export interface RaceExperimentResult {
  readonly method: "fixed-candidate-monte-carlo";
  readonly seed: number;
  readonly trials: number;
  readonly gridSize: number;
  readonly prior: RaceEventPrior;
  readonly gridModel: {
    readonly kind: "shared-replay-entries" | "generic-fixed-pack";
    readonly playerId: string;
    readonly gridSlotOffsetSeconds: number;
    readonly rivals: readonly { readonly driverId: string; readonly gridPosition: number; readonly racecraft: number; readonly strategySignature: string }[];
  };
  readonly candidates: readonly CandidateExperimentResult[];
  readonly eventTimelines: readonly RaceExperimentTimeline[];
  readonly eventSummary: {
    readonly scTrials: number;
    readonly vscTrials: number;
    readonly noEventTrials: number;
    readonly meanScLaps: number;
    readonly meanVscLaps: number;
  };
  readonly limitations: readonly string[];
}

function validateNumber(value: number, label: string, low: number, high = Infinity): void {
  if (!Number.isFinite(value) || value < low || value > high) {
    throw new RangeError(`${label} must be between ${low} and ${high}`);
  }
}

/** Mulberry32, with key hashing so branch/iteration order cannot shift draws. */
function keyedRandom(seed: number, key: string): number {
  let state = seed >>> 0;
  for (const character of key) state = ((state << 5) - state + character.charCodeAt(0)) >>> 0;
  state = (state + P.seedIncrement) >>> 0;
  let value = Math.imul(state ^ (state >>> 15), 1 | state);
  value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
  return ((value ^ (value >>> 14)) >>> 0) / P.uintRange;
}

/** Public for auditing common random numbers across counterfactual candidates. */
export function trafficRandomDraw(
  seed: number, trial: number, lap: number, followerId: string, rivalId: string,
): number {
  return keyedRandom(seed, `traffic/${trial}/${lap}/${followerId}/${rivalId}`);
}

export function followingTrafficLoss(gapSeconds: number, paceAdvantageSeconds: number): number {
  return gapSeconds >= 0 && gapSeconds <= P.followingGapSeconds
    ? P.trafficLossFraction * Math.max(0, paceAdvantageSeconds) : 0;
}

export function overtakeProbability(racecraft: number, paceAdvantageSeconds: number): number {
  return Math.max(P.overtakeMin, Math.min(P.overtakeMax,
    P.overtakeBase + (racecraft - P.racecraftReference) * P.overtakePerRating
    + Math.max(0, paceAdvantageSeconds) * P.overtakePerPaceSecond));
}

function strategySignature(strategy: StrategyEvaluation): string {
  return `${strategy.scenarioSignature}|${strategy.stints.map((stint) =>
    `${stint.compound}:${stint.startLap}-${stint.endLap}`).join("|")}`;
}

function eventAt(timeline: RaceExperimentTimeline, lap: number): NeutralisationKind | null {
  return timeline.events.find((event) => lap >= event.startLap && lap <= event.endLap)?.kind ?? null;
}

function makeTimeline(seed: number, trial: number, laps: number, prior: RaceEventPrior): RaceExperimentTimeline {
  const events: RaceExperimentEvent[] = [];
  for (const kind of ["SC", "VSC"] as const) {
    const probability = kind === "SC" ? prior.scProbability : prior.vscProbability;
    if (keyedRandom(seed, `event/${trial}/${kind}/occurs`) >= probability) continue;
    const durations = kind === "SC" ? P.scDurations : P.vscDurations;
    const duration = durations[Math.floor(keyedRandom(seed, `event/${trial}/${kind}/duration`) * durations.length)];
    const first = Math.max(1, Math.ceil(laps * P.eventStartFraction));
    const last = Math.min(laps, Math.floor(laps * P.eventEndFraction));
    const available = Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => first + index)
      .filter((start) => events.every((event) => start > event.endLap || Math.min(laps, start + duration - 1) < event.startLap));
    if (available.length === 0) continue;
    const startLap = available[Math.floor(keyedRandom(seed, `event/${trial}/${kind}/start`) * available.length)];
    events.push(Object.freeze({ kind, startLap, endLap: Math.min(laps, startLap + duration - 1) }));
  }
  return Object.freeze({
    id: `${seed >>> 0}:${trial}`, trial,
    events: Object.freeze(events.sort((a, b) => a.startLap - b.startLap)),
  });
}

interface LapPlan {
  readonly freeSeconds: number;
  readonly pitSeconds: number;
  readonly pitSavingSeconds: number;
  readonly isPitting: boolean;
}

function lapPlan(
  strategy: StrategyEvaluation, lapIndex: number, paceDelta: number,
  timeline: RaceExperimentTimeline, pitLossOverride: number | undefined,
): LapPlan {
  const lap = strategy.lapCosts[lapIndex];
  const isPitting = strategy.pitAfterLaps.includes(lapIndex);
  const greenLoss = isPitting ? pitLossOverride ?? lap.pitLossSeconds : 0;
  // A stop after L20 is charged in L21 by the deterministic evaluator, but
  // its discount belongs to the event active at the end of L20, not L21.
  const kind = isPitting ? eventAt(timeline, lapIndex) : null;
  const factor = kind === "SC" ? P.scPitFactor : kind === "VSC" ? P.vscPitFactor : 1;
  return {
    freeSeconds: lap.lapTimeSeconds - lap.pitLossSeconds + paceDelta,
    pitSeconds: greenLoss * factor,
    pitSavingSeconds: greenLoss * (1 - factor), isPitting,
  };
}

interface GridCar {
  readonly id: string;
  readonly strategy: StrategyEvaluation;
  readonly paceDelta: number;
  readonly racecraft: number;
  elapsed: number;
  trafficLoss: number;
  pitSaving: number;
  overtakes: number;
}

function simulateCandidate(
  candidate: StrategyEvaluation, rivals: readonly StrategyEvaluation[],
  timeline: RaceExperimentTimeline, seed: number, laps: number,
  racecraft: number, gridPosition: number, pitLossOverride: number | undefined,
  fixedRivals: readonly RaceExperimentRival[] | undefined, playerId: string, gridSlotOffset: number,
): CandidateTrialResult {
  const cars: GridCar[] = [{
    id: playerId, strategy: candidate, paceDelta: 0, racecraft,
    elapsed: (gridPosition - 1) * gridSlotOffset, trafficLoss: 0, pitSaving: 0, overtakes: 0,
  }];
  const rivalCount = P.gridSize - 1;
  for (let index = 0; index < rivalCount; index += 1) {
    const fixed = fixedRivals?.[index];
    const slot = fixed?.gridPosition ?? (index + 1 >= gridPosition ? index + 2 : index + 1);
    cars.push({
      id: fixed?.driverId ?? `rival-${index}`, strategy: fixed?.strategy ?? rivals[index % rivals.length],
      paceDelta: fixed ? 0 : (index - (rivalCount - 1) / 2) * P.rivalPaceStepSeconds,
      racecraft: fixed?.racecraft ?? P.racecraftReference, elapsed: (slot - 1) * gridSlotOffset,
      trafficLoss: 0, pitSaving: 0, overtakes: 0,
    });
  }
  for (let lapIndex = 0; lapIndex < laps; lapIndex += 1) {
    const ordered = [...cars].sort((a, b) => a.elapsed - b.elapsed || a.id.localeCompare(b.id));
    const oldElapsed = new Map(cars.map((car) => [car.id, car.elapsed]));
    const plans = new Map(cars.map((car) => [car.id, lapPlan(car.strategy, lapIndex, car.paceDelta, timeline, pitLossOverride)]));
    for (let order = 0; order < ordered.length; order += 1) {
      const car = ordered[order];
      const plan = plans.get(car.id)!;
      const previous = oldElapsed.get(car.id)!;
      let next = previous + plan.freeSeconds + plan.pitSeconds;
      let traffic = 0;
      const ahead = ordered[order - 1];
      if (ahead) {
        const aheadPlan = plans.get(ahead.id)!;
        const gap = previous - oldElapsed.get(ahead.id)!;
        const paceGap = Math.max(0, aheadPlan.freeSeconds - plan.freeSeconds);
        if (!plan.isPitting && !aheadPlan.isPitting) {
          traffic = followingTrafficLoss(gap, paceGap);
          next += traffic;
          if (next < ahead.elapsed) {
            const probability = overtakeProbability(car.racecraft, paceGap);
            const allowed = eventAt(timeline, lapIndex + 1) === null;
            const succeeds = allowed && trafficRandomDraw(seed, timeline.trial, lapIndex + 1, car.id, ahead.id) < probability;
            if (succeeds) car.overtakes += 1;
            else {
              const blocked = ahead.elapsed + P.minimumDistinctSeconds - next;
              traffic += blocked;
              next += blocked;
            }
          }
        }
      }
      car.elapsed = next;
      car.trafficLoss += traffic;
      car.pitSaving += plan.pitSavingSeconds;
    }
  }
  const player = cars[0];
  const finishPosition = cars.filter((car) => car.elapsed < player.elapsed - EPSILON).length + 1;
  return {
    trial: timeline.trial, eventTimelineId: timeline.id,
    totalSeconds: player.elapsed, trafficLossSeconds: player.trafficLoss,
    pitSavingSeconds: player.pitSaving, finishPosition, overtakes: player.overtakes,
  };
}

function quantile(sorted: readonly number[], fraction: number): number {
  const index = (sorted.length - 1) * fraction;
  const low = Math.floor(index), high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

/** Evaluate existing deterministic candidates; this is NOT joint-state DP. */
export function runRaceExperiments(
  candidates: readonly StrategyEvaluation[], options: RaceExperimentOptions = {},
): RaceExperimentResult {
  if (candidates.length === 0) throw new RangeError("At least one candidate is required");
  const seed = options.seed ?? P.defaultSeed;
  const trials = options.trials ?? P.trials;
  const laps = options.trackLaps ?? candidates[0].lapCosts.length;
  const racecraft = options.racecraft ?? P.racecraftReference;
  const gridPosition = options.startingGridPosition ?? Math.ceil(P.gridSize / 2);
  const playerId = options.playerId ?? "player";
  const gridSlotOffset = options.gridSlotOffsetSeconds ?? P.gridGapSeconds;
  if (!playerId.trim()) throw new RangeError("playerId must not be empty");
  validateNumber(gridSlotOffset, "gridSlotOffsetSeconds", 0);
  for (const [value, label, minimum, maximum] of [
    [seed, "seed", 0, P.uintRange - 1], [trials, "trials", 1, Infinity],
    [laps, "trackLaps", 1, Infinity], [gridPosition, "startingGridPosition", 1, P.gridSize],
  ] as const) {
    validateNumber(value, label, minimum, maximum);
    if (!Number.isInteger(value)) throw new RangeError(`${label} must be an integer`);
  }
  validateNumber(racecraft, "racecraft", 0, 100);
  if (options.pitLossSeconds !== undefined) validateNumber(options.pitLossSeconds, "pitLossSeconds", 0);
  const prior: RaceEventPrior = options.eventPrior ?? {
    scProbability: P.fallbackScProbability, vscProbability: P.fallbackVscProbability,
    sourceType: "project-estimate",
    sourceLabel: "2018–2025 전 서킷 공식 발생률 미확보 · 프로젝트 사전확률(경기당)",
  };
  validateNumber(prior.scProbability, "scProbability", 0, 1);
  validateNumber(prior.vscProbability, "vscProbability", 0, 1);
  if (prior.sourceType === "observed" && (!prior.sourceUrl || !prior.sampleRaces || prior.sampleRaces < 1)) {
    throw new RangeError("Observed priors require sourceUrl and a positive sampleRaces");
  }
  const fixedRivals = options.fixedRivals ? [...options.fixedRivals].sort((left, right) => left.gridPosition - right.gridPosition) : undefined;
  if (fixedRivals) {
    if (fixedRivals.length !== P.gridSize - 1) throw new RangeError("A shared grid requires exactly 19 fixed rivals");
    const ids = new Set([playerId]), slots = new Set([gridPosition]);
    for (const rival of fixedRivals) {
      if (!rival.driverId.trim() || ids.has(rival.driverId) || !Number.isInteger(rival.gridPosition)
        || rival.gridPosition < 1 || rival.gridPosition > P.gridSize || slots.has(rival.gridPosition)
        || rival.costBasis !== "entry-adjusted-no-traffic") throw new RangeError("Fixed rivals require unique drivers/grid slots and entry-only cost basis");
      validateNumber(rival.racecraft, "rival.racecraft", 0, 100);
      ids.add(rival.driverId); slots.add(rival.gridPosition);
    }
  }
  const rivalPool = [...(fixedRivals?.map((rival) => rival.strategy) ?? options.rivalStrategies ?? candidates)]
    .sort((a, b) => strategySignature(a).localeCompare(strategySignature(b)));
  if (rivalPool.length === 0) throw new RangeError("Rival strategy pool cannot be empty");
  for (const strategy of [...candidates, ...rivalPool]) {
    if (!strategy.isLegal || strategy.lapCosts.length !== laps) throw new RangeError("All candidates and rivals must be legal and cover the same race");
    if (strategy.scenarioSignature !== candidates[0].scenarioSignature) throw new RangeError("All candidates and rivals must share one deterministic scenario");
    if (strategy.pitAfterLaps.some((lap, index) => !Number.isInteger(lap) || lap < 1 || lap >= laps
      || (index > 0 && lap <= strategy.pitAfterLaps[index - 1]))) throw new RangeError("Pit laps must be ordered, unique and inside the race");
    const maximumRivalPaceGain = fixedRivals ? 0 : (P.gridSize - 2) / 2 * P.rivalPaceStepSeconds;
    if (strategy.lapCosts.some((lap, index) => lap.lap !== index + 1 || !Number.isFinite(lap.lapTimeSeconds)
      || !Number.isFinite(lap.pitLossSeconds) || lap.pitLossSeconds < 0
      || lap.lapTimeSeconds - lap.pitLossSeconds <= maximumRivalPaceGain)) {
      throw new RangeError("Lap costs must be ordered, finite and positive");
    }
  }
  const timelines = Array.from({ length: trials }, (_, trial) => makeTimeline(seed, trial, laps, prior));
  const trialResults = candidates.map((candidate) => timelines.map((timeline) =>
    simulateCandidate(candidate, rivalPool, timeline, seed, laps, racecraft, gridPosition, options.pitLossSeconds,
      fixedRivals, playerId, gridSlotOffset)));
  const wins = candidates.map(() => 0);
  for (let trial = 0; trial < trials; trial += 1) {
    const best = Math.min(...trialResults.map((rows) => rows[trial].totalSeconds));
    const tied = trialResults.map((rows, index) => ({ index, time: rows[trial].totalSeconds }))
      .filter(({ time }) => Math.abs(time - best) <= EPSILON);
    for (const { index } of tied) wins[index] += 1 / tied.length;
  }
  const results = candidates.map((candidate, index): CandidateExperimentResult => {
    const rows = trialResults[index];
    const mean = (key: "totalSeconds" | "finishPosition" | "trafficLossSeconds" | "pitSavingSeconds" | "overtakes") =>
      rows.reduce((sum, row) => sum + row[key], 0) / trials;
    const times = rows.map((row) => row.totalSeconds).sort((a, b) => a - b);
    return {
      candidateIndex: index, signature: strategySignature(candidate), meanSeconds: mean("totalSeconds"),
      p10Seconds: quantile(times, 0.1), p90Seconds: quantile(times, 0.9),
      winRate: wins[index] / trials, gridWinRate: rows.filter((row) => row.finishPosition === 1).length / trials,
      meanFinishPosition: mean("finishPosition"), meanTrafficLossSeconds: mean("trafficLossSeconds"),
      meanPitSavingSeconds: mean("pitSavingSeconds"), meanOvertakes: mean("overtakes"), trials: rows,
    };
  });
  const eventsOf = (kind: NeutralisationKind) => timelines.flatMap((timeline) => timeline.events.filter((event) => event.kind === kind));
  return {
    method: "fixed-candidate-monte-carlo", seed, trials, gridSize: P.gridSize, prior, candidates: results,
    gridModel: { kind: fixedRivals ? "shared-replay-entries" : "generic-fixed-pack", playerId,
      gridSlotOffsetSeconds: gridSlotOffset, rivals: fixedRivals ? fixedRivals.map((rival) => ({
        driverId: rival.driverId, gridPosition: rival.gridPosition, racecraft: rival.racecraft,
        strategySignature: strategySignature(rival.strategy),
      })) : Array.from({ length: P.gridSize - 1 }, (_, index) => ({ driverId: `rival-${index}`,
        gridPosition: index + 1 >= gridPosition ? index + 2 : index + 1, racecraft: P.racecraftReference,
        strategySignature: strategySignature(rivalPool[index % rivalPool.length]) })) },
    eventTimelines: timelines,
    eventSummary: {
      scTrials: eventsOf("SC").length, vscTrials: eventsOf("VSC").length,
      noEventTrials: timelines.filter((timeline) => timeline.events.length === 0).length,
      meanScLaps: eventsOf("SC").reduce((sum, event) => sum + event.endLap - event.startLap + 1, 0) / trials,
      meanVscLaps: eventsOf("VSC").reduce((sum, event) => sum + event.endLap - event.startLap + 1, 0) / trials,
    },
    limitations: [
      "결정론 DP가 이미 만든 후보의 확률 평가이며 교통·SC/VSC를 공동 상태로 최적화하지 않습니다.",
      "기본 발생률, 피트 할인, 교통·추월 계수는 프로젝트 추정이며 실측 F1 확률 또는 EA 게임 물리식이 아닙니다.",
      "한 시행에 SC/VSC 각각 최대 한 구간입니다. 피트 할인과 추월 제한만 반영하며 실제 SC 속도·대열 압축·랩다운 해제는 재현하지 않습니다.",
      "승률은 입력한 후보 중 최단시간일 비율(동률 분할)입니다. P10/P90은 실험 총시간 분포이며 실제 경기 예측의 신뢰구간이 아닙니다.",
      "모든 후보는 동일 이벤트 일정과 고정 19대 상대팩을 공유합니다. 교통 난수는 시행·랩·추격차·상대차 키로 고정됩니다.",
      fixedRivals ? "3D와 참가자·그리드 순번·상대 전략·상대 능력치 기초 랩 비용을 공유합니다. MC는 여기에 자체 확률 교통을 한 번 적용하며, 3D의 이미 계산된 교통 손실이나 팀 피트 대기열을 가져오지 않으므로 최종 순위·시간까지 동일하지는 않습니다."
        : "공유 그리드가 없는 호환 모드입니다. 상대는 일반 고정 전략팩이며 3D의 개별 팀·선수 배치와 다릅니다.",
    ],
  };
}

export interface UndercutAssessment {
  readonly stopNumber: number;
  readonly attackerPitAfterLap: number;
  readonly defenderPitAfterLap: number | null;
  readonly settlementLap: number;
  readonly gapBeforeSeconds: number | null;
  readonly gapAfterSeconds: number | null;
  readonly equalCompletedStops: boolean;
  readonly status: "success" | "failed" | "inconclusive" | "not-applicable";
  readonly reason: string;
}

/** Positive gap means attacker is behind. Compare only after both have stopped. */
export function assessUndercut(
  attacker: StrategyEvaluation, defender: StrategyEvaluation, initialGapSeconds = 0,
): readonly UndercutAssessment[] {
  if (!Number.isFinite(initialGapSeconds) || attacker.lapCosts.length !== defender.lapCosts.length) {
    throw new RangeError("Undercut plans require equal race lengths and a finite initial gap");
  }
  return attacker.pitAfterLaps.map((attackerPit, index) => {
    const defenderPit = defender.pitAfterLaps[index];
    const settlementLap = (defenderPit ?? attackerPit) + P.undercutSettlingLaps;
    const before = attacker.lapCosts[attackerPit - 1], defenderBefore = defender.lapCosts[attackerPit - 1];
    const after = attacker.lapCosts[settlementLap - 1], defenderAfter = defender.lapCosts[settlementLap - 1];
    const gapBefore = before && defenderBefore ? before.cumulativeSeconds - defenderBefore.cumulativeSeconds + initialGapSeconds : null;
    const gapAfter = after && defenderAfter ? after.cumulativeSeconds - defenderAfter.cumulativeSeconds + initialGapSeconds : null;
    const equalStops = attacker.pitAfterLaps.filter((lap) => lap < settlementLap).length
      === defender.pitAfterLaps.filter((lap) => lap < settlementLap).length;
    let status: UndercutAssessment["status"] = "failed";
    let reason = "후행차가 먼저 피트했지만 정산 시점에 앞서지 못했습니다.";
    if (defenderPit === undefined || attackerPit >= defenderPit || gapBefore === null || gapBefore <= EPSILON) {
      status = "not-applicable"; reason = "후행차의 선행 피트라는 언더컷 조건이 아닙니다.";
    } else if (gapAfter === null || !equalStops) {
      status = "inconclusive"; reason = "상대 피트 후 3랩 또는 동일 완료 스톱 수를 확보하지 못했습니다.";
    } else if (gapAfter < -P.minimumDistinctSeconds) {
      status = "success"; reason = `동일 스톱 수로 상대 피트 후 ${P.undercutSettlingLaps}랩을 정산했을 때 ${P.minimumDistinctSeconds}초 넘게 앞섰습니다.`;
    }
    return {
      stopNumber: index + 1, attackerPitAfterLap: attackerPit,
      defenderPitAfterLap: defenderPit ?? null, settlementLap,
      gapBeforeSeconds: gapBefore, gapAfterSeconds: gapAfter,
      equalCompletedStops: equalStops, status, reason,
    };
  });
}
