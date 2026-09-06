import {
  ALL_COMPOUNDS, COMPOUNDS, DEFAULT_COMPOUND_MODELS, DEFAULT_STRATEGY_RULES,
  DEFAULT_TOP_K, TRACK_PRESETS, evaluateStrategy,
  type Compound, type StrategyOptimizerInput, type StrategyResult, type StrategyStintInput,
} from "./strategy.ts";
import { MODEL_PARAMS } from "../model/params.ts";

const EPSILON = MODEL_PARAMS.validation.toleranceSeconds;
const BITS = Object.fromEntries(ALL_COMPOUNDS.map((compound, index) => [compound, 1 << index])) as Record<Compound, number>;

interface Candidate {
  readonly stints: readonly StrategyStintInput[];
  readonly totalSeconds: number;
  readonly signature: string;
  readonly pathKey: string;
}

interface SegmentNode {
  readonly totalSeconds: number;
  readonly pathKey: string;
  readonly stint: StrategyStintInput | null;
  readonly previous: SegmentNode | null;
}

export interface RepresentativeStrategySelection {
  readonly strategies: readonly StrategyResult[];
  readonly requestedCount: number;
  readonly missingCount: number;
  readonly status: "complete" | "insufficient-distinct-candidates";
  readonly method: "grouped-stint-dp-and-single-pit-neighbours";
  readonly globalBestSignature: string | null;
  readonly minimumDistinctSeconds: number;
  readonly diagnostics: {
    readonly groupCount: number;
    readonly candidateCount: number;
    readonly permutationCollapsedCount: number;
    readonly oracleEvaluations: number;
    readonly stateCount: number;
  };
  readonly explanation: string;
}

/** Order-independent multiset; repeated identical stints retain multiplicity. */
export function stintMultisetKey(stints: readonly StrategyStintInput[]): string {
  return stints.map((stint) => `${stint.compound}:${stint.endLap - stint.startLap + 1}`).sort().join("|");
}

export function representativeGroupKey(stints: readonly StrategyStintInput[]): string {
  return `${stints.length - 1}:${[...new Set(stints.map((stint) => stint.compound))].sort().join("+")}`;
}

function signature(stints: readonly StrategyStintInput[]): string {
  return stints.map((stint) => `${stint.compound}:${stint.startLap}-${stint.endLap}`).join(">");
}

function pathKey(stints: readonly StrategyStintInput[]): string {
  return stints.map((stint) => stint.compound.repeat(stint.endLap - stint.startLap + 1)).join("|");
}

function compareCandidates(left: Candidate, right: Candidate): number {
  const delta = left.totalSeconds - right.totalSeconds;
  return Math.abs(delta) > EPSILON ? delta : left.pathKey.localeCompare(right.pathKey);
}

function candidateFor(node: SegmentNode): Candidate {
  const stints: StrategyStintInput[] = [];
  let current: SegmentNode | null = node;
  while (current?.stint) { stints.push(current.stint); current = current.previous; }
  stints.reverse();
  return { stints, totalSeconds: node.totalSeconds, signature: signature(stints), pathKey: node.pathKey };
}

function selectCandidates(candidates: readonly Candidate[], preferred?: Candidate) {
  const byBag = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const bag = stintMultisetKey(candidate.stints);
    const previous = byBag.get(bag);
    if (!previous || compareCandidates(candidate, previous) < 0) byBag.set(bag, candidate);
  }
  if (preferred) byBag.set(stintMultisetKey(preferred.stints), preferred);
  const sorted = [...byBag.values()].sort(compareCandidates);
  const chosen: Candidate[] = preferred ? [preferred] : [];
  for (const candidate of sorted) {
    if (chosen.some((item) => item.signature === candidate.signature)) continue;
    if (chosen.every((item) => representativeGroupKey(item.stints) !== representativeGroupKey(candidate.stints)
      || Math.abs(item.totalSeconds - candidate.totalSeconds) + EPSILON >= MODEL_PARAMS.race.minimumDistinctSeconds)) {
      chosen.push(candidate);
      if (chosen.length >= DEFAULT_TOP_K) break;
    }
  }
  return { chosen, collapsed: candidates.length - byBag.size };
}

/** Standalone display filter. This does not claim to search beyond its input. */
export function selectDistinctStrategies(candidates: readonly StrategyResult[]): readonly StrategyResult[] {
  if (!candidates.length) return [];
  if (candidates.some((candidate) => !candidate.isLegal || candidate.scenarioSignature !== candidates[0].scenarioSignature)) {
    throw new RangeError("Representative candidates must be legal strategies from one scenario.");
  }
  const items = candidates.map((candidate) => ({ ...candidate, pathKey: pathKey(candidate.stints) }));
  const bySignature = new Map(candidates.map((candidate) => [candidate.signature, candidate]));
  return selectCandidates(items).chosen.map((item, index) => ({ ...bySignature.get(item.signature)!, rank: index + 1 }));
}

/**
 * Display-oriented Top 3, separate from optimizeTyreStrategies' global K-best.
 *
 * The segment oracle uses the unchanged evaluator. A new stint resets tyre age,
 * so its cost depends only on start/end lap and compound (including wet heat).
 * At each (completed lap, stint count, used-compound mask) we retain ONE shortest
 * path. This yields an exact shortest plan for every stop/compound-set group,
 * including a global optimum, without increasing global K or copying lap-cost
 * formulas. Single-pit-boundary neighbours add cheap within-group alternatives.
 * The displayed alternatives are representative candidates, NOT global 2nd/3rd.
 */
export function buildRepresentativeStrategies(
  input: StrategyOptimizerInput = {}, options: { readonly globalBest?: StrategyResult } = {},
): RepresentativeStrategySelection {
  const track = typeof input.track === "object" ? input.track : TRACK_PRESETS[input.track ?? "melbourne"];
  const laps = input.laps ?? track.laps;
  const rules = { ...DEFAULT_STRATEGY_RULES, ...input.rules };
  const weather = input.weather ?? track.weather;
  const active = [...new Set(input.allowedCompounds ?? ((weather?.preset ?? "none") !== "none" || (weather?.initialWater ?? 0) > 0 ? ALL_COMPOUNDS : COMPOUNDS))];
  const starts = [...new Set(input.allowedStartingCompounds ?? active)];
  if (!active.length || active.some((compound) => !ALL_COMPOUNDS.includes(compound)) || !starts.length
    || starts.some((compound) => !active.includes(compound))) throw new RangeError("Invalid representative compound restrictions.");
  const maxStint = Object.fromEntries(active.map((compound) => [compound,
    input.compoundModels?.[compound]?.maxStintLaps ?? track.compounds[compound]?.maxStintLaps
      ?? DEFAULT_COMPOUND_MODELS[compound].maxStintLaps])) as Record<Compound, number>;
  const costs = new Map<Compound, Float64Array[]>();
  let oracleEvaluations = 0;
  let scenarioSignature = "";

  for (const compound of active) {
    const compoundCosts: Float64Array[] = [];
    for (let start = 1; start <= laps; start += 1) {
      // A prefix makes the oracle charge exactly one pit loss at `start`.
      // Its legality is immaterial: only the following stint's costs are read.
      const stints: StrategyStintInput[] = start === 1 ? [{ compound, startLap: 1, endLap: laps }]
        : [{ compound: starts[0], startLap: 1, endLap: start - 1 }, { compound, startLap: start, endLap: laps }];
      const evaluated = evaluateStrategy({ ...input, stints });
      oracleEvaluations += 1;
      scenarioSignature = evaluated.scenarioSignature;
      const row = new Float64Array(laps + 1).fill(Infinity);
      let seconds = 0;
      for (let end = start; end <= laps; end += 1) {
        seconds += evaluated.lapCosts[end - 1].lapTimeSeconds;
        if (end - start + 1 >= rules.minStintLaps && end - start + 1 <= maxStint[compound]) row[end] = seconds;
      }
      compoundCosts[start] = row;
    }
    costs.set(compound, compoundCosts);
  }
  // Invalid 0/NaN race lengths would otherwise skip the oracle loops entirely.
  if (!Number.isInteger(laps) || laps < 1) throw new RangeError("laps must be a positive integer.");

  const maxStints = rules.maxStops + 1;
  const layers = Array.from({ length: maxStints + 1 }, () => Array.from({ length: laps + 1 }, () => new Map<number, SegmentNode>()));
  layers[0][0].set(0, { totalSeconds: 0, pathKey: "", stint: null, previous: null });
  let stateCount = 1;
  for (let count = 1; count <= maxStints; count += 1) {
    for (let start = 1; start <= laps; start += 1) {
      for (const [mask, previous] of layers[count - 1][start - 1]) {
        for (const compound of count === 1 ? starts : active) {
          const nextMask = mask | BITS[compound];
          const row = costs.get(compound)![start];
          const maximumEnd = Math.min(laps, start + maxStint[compound] - 1);
          for (let end = start + rules.minStintLaps - 1; end <= maximumEnd; end += 1) {
            const totalSeconds = previous.totalSeconds + row[end];
            const incumbent = layers[count][end].get(nextMask);
            if (incumbent && totalSeconds > incumbent.totalSeconds + EPSILON) continue;
            const key = `${previous.pathKey}${count > 1 ? "|" : ""}${compound.repeat(end - start + 1)}`;
            if (incumbent && Math.abs(totalSeconds - incumbent.totalSeconds) <= EPSILON && key.localeCompare(incumbent.pathKey) >= 0) continue;
            if (!incumbent) stateCount += 1;
            layers[count][end].set(nextMask, { totalSeconds, pathKey: key,
              stint: { compound, startLap: start, endLap: end }, previous });
          }
        }
      }
    }
  }
  const groupBest: Candidate[] = [];
  for (let count = rules.minStops + 1; count <= maxStints; count += 1) {
    for (const [mask, node] of layers[count][laps]) {
      const usedWet = (mask & (BITS.INTER | BITS.WET)) !== 0;
      const dryCount = COMPOUNDS.filter((compound) => (mask & BITS[compound]) !== 0).length;
      if (!rules.requireTwoDryCompounds || usedWet || dryCount >= 2) groupBest.push(candidateFor(node));
    }
  }
  groupBest.sort(compareCandidates);
  let globalBest = groupBest[0];
  if (options.globalBest) {
    const existing = options.globalBest;
    const checked = evaluateStrategy({ ...input, stints: existing.stints });
    oracleEvaluations += 1;
    if (!checked.isLegal || checked.scenarioSignature !== existing.scenarioSignature || checked.scenarioSignature !== scenarioSignature
      || !globalBest || Math.abs(checked.totalSeconds - globalBest.totalSeconds) > EPSILON
      || Math.abs(existing.totalSeconds - checked.totalSeconds) > EPSILON
      || !starts.includes(existing.stints[0].compound) || existing.stints.some((stint) => !active.includes(stint.compound))) {
      throw new RangeError("The supplied globalBest must be an actual optimum of the same restricted scenario.");
    }
    globalBest = { stints: existing.stints, totalSeconds: checked.totalSeconds,
      signature: signature(existing.stints), pathKey: pathKey(existing.stints) };
  }

  const pool = new Map<string, Candidate>(groupBest.map((candidate) => [candidate.signature, candidate]));
  if (globalBest) pool.set(globalBest.signature, globalBest);
  // Bounded neighbourhood: one pit boundary changes; no exhaustive combinations
  // of pit laps and no global K expansion. Matrix lookup avoids new oracle calls.
  for (const base of [...pool.values()]) {
    for (let pit = 0; pit < base.stints.length - 1; pit += 1) {
      const before = base.stints[pit], after = base.stints[pit + 1];
      const minimum = Math.max(before.startLap + rules.minStintLaps - 1, after.endLap - maxStint[after.compound]);
      const maximum = Math.min(after.endLap - rules.minStintLaps, before.startLap + maxStint[before.compound] - 1);
      for (let boundary = minimum; boundary <= maximum; boundary += 1) {
        if (boundary === before.endLap) continue;
        const stints = base.stints.map((stint, index) => index === pit ? { ...stint, endLap: boundary }
          : index === pit + 1 ? { ...stint, startLap: boundary + 1 } : stint);
        const key = signature(stints);
        if (pool.has(key)) continue;
        const totalSeconds = stints.reduce((sum, stint) => sum + costs.get(stint.compound)![stint.startLap][stint.endLap], 0);
        pool.set(key, { stints, totalSeconds, signature: key, pathKey: pathKey(stints) });
      }
    }
  }
  const selected = selectCandidates([...pool.values()], globalBest);
  const strategies = selected.chosen.map((candidate, index): StrategyResult => {
    const evaluated = evaluateStrategy({ ...input, stints: candidate.stints });
    oracleEvaluations += 1;
    if (!evaluated.isLegal || Math.abs(evaluated.totalSeconds - candidate.totalSeconds) > EPSILON) {
      throw new Error("Representative segment costs no longer agree with the strategy evaluator.");
    }
    return { ...evaluated, rank: index + 1, signature: candidate.signature };
  });
  const missingCount = DEFAULT_TOP_K - strategies.length;
  return {
    strategies, requestedCount: DEFAULT_TOP_K, missingCount,
    status: missingCount ? "insufficient-distinct-candidates" : "complete",
    method: "grouped-stint-dp-and-single-pit-neighbours", globalBestSignature: globalBest?.signature ?? null,
    minimumDistinctSeconds: MODEL_PARAMS.race.minimumDistinctSeconds,
    diagnostics: { groupCount: groupBest.length, candidateCount: pool.size,
      permutationCollapsedCount: selected.collapsed, oracleEvaluations, stateCount },
    explanation: `전역 최단 전략을 유지하고, 스톱 수·컴파운드 집합 또는 ${MODEL_PARAMS.race.minimumDistinctSeconds}초 이상 차이로 대표 대안을 구분합니다. 순서만 다른 동일 컴파운드·길이 조합은 하나로 묶습니다. 대안은 그룹별 최단과 피트 1개 이동 이웃에서 고른 대표 후보이며 전역 K-best 2·3위는 아닙니다.${missingCount ? ` 현재 제한 후보풀에서 구분 가능한 전략이 ${strategies.length}개여서 ${missingCount}칸을 채우지 않았습니다.` : ""}`,
  };
}
