import summary from "../data/neutralisation-summary.json" with { type: "json" };
import { MODEL_PARAMS } from "../model/params.ts";
import type { RaceEventKindEvidence, RaceEventPrior } from "./race-experiments.ts";

export const NEUTRALISATION_SUMMARY = summary;
const P = MODEL_PARAMS.race;
type KindSummary = (typeof summary.venues)[number]["sc"];

function resolveKind(raw: KindSummary | undefined, fallbackProbability: number) {
  const denominator = raw?.eligibleRaces ?? 0;
  const numerator = raw?.racesWithEvent ?? 0;
  const probability = raw?.perRaceProbability;
  const validObservation = Number.isInteger(denominator) && denominator > 0
    && Number.isInteger(numerator) && numerator >= 0 && numerator <= denominator
    && probability != null && Number.isFinite(probability) && probability >= 0 && probability <= 1
    && Math.abs(probability - numerator / denominator) < MODEL_PARAMS.validation.toleranceSeconds;
  const frequencyApplied = validObservation && denominator >= P.minObservedRaces;
  const validDurations = raw?.durationLeaderLaps.filter(value => Number.isInteger(value) && value >= 1) ?? [];
  const durationAvailable = validDurations.length >= P.minDurationEpisodes;
  const interval = raw?.binomialWilsonCI95;
  const probabilityCI95: readonly [number, number] | null = validObservation && interval?.length === 2
    && interval.every(value => Number.isFinite(value) && value >= 0 && value <= 1)
    && interval[0] <= probability! && interval[1] >= probability!
    ? [interval[0], interval[1]] : null;
  const evidence: RaceEventKindEvidence = {
    observedProbability: validObservation ? probability! : null,
    numerator, denominator, probabilityCI95, frequencyApplied,
    durationEpisodes: validDurations.length,
    durationSource: durationAvailable ? "observed" : "project-estimate",
  };
  return {
    probability: frequencyApplied ? probability! : fallbackProbability,
    durations: durationAvailable ? Object.freeze([...validDurations]) : undefined,
    evidence: Object.freeze(evidence),
  };
}

/** Missing values stay null in evidence; the execution fallback is separately labelled. */
export function getNeutralisationPrior(trackId: string): RaceEventPrior {
  const row = summary.venues.find(venue => venue.trackId === trackId);
  const sc = resolveKind(row?.sc, P.fallbackScProbability);
  const vsc = resolveKind(row?.vsc, P.fallbackVscProbability);
  const observed = sc.evidence.frequencyApplied && vsc.evidence.frequencyApplied;
  const period = `${summary.sourcePeriod.fromYear}–${summary.sourcePeriod.toYear}`;
  const notes = [
    `빈도는 최소 ${P.minObservedRaces}경기, 지속 랩은 종류별 최소 ${P.minDurationEpisodes}구간일 때 채택합니다. 이 기준은 프로젝트 표본 규칙입니다.`,
    row ? `${row.scheduledRaces}경기 중 누락·예외 ${row.missingOrExcludedRaces}경기는 발생률의 분모에서 제외했습니다.`
      : "이 서킷에 대응하는 관측 자료가 없습니다. 다른 서킷의 빈도를 대신 넣지 않습니다.",
    ...([["SC", sc], ["VSC", vsc]] as const).flatMap(([kind, value]) => [
      ...(value.evidence.frequencyApplied ? [] : [`${kind} 빈도: ${value.evidence.denominator}경기 표본으로 최소 기준 미달 · 프로젝트 사전값 적용.`]),
      value.evidence.durationSource === "observed"
        ? `${kind} 지속 랩: 관측 ${value.evidence.durationEpisodes}구간의 경험 분포에서 추출합니다.`
        : `${kind} 지속 랩: 관측 ${value.evidence.durationEpisodes}구간으로 표본 미달 · 프로젝트 지속 랩 사용.`,
    ]),
    "과거 관측 빈도를 넣더라도 SC·VSC는 종류별 최대 한 구간만 생성하는 프로젝트 운영 모형입니다. 실제 다중 사고·발생 시점·상호 의존을 재현하지 않습니다.",
    "지속 랩은 상태가 걸친 선두 차량의 랩 수이며 부분 랩도 포함합니다. 강수·레드플래그 및 시대별 규정·레이아웃 차이가 남아 미래 확률을 보장하지 않습니다.",
  ];
  return Object.freeze({
    scProbability: sc.probability, vscProbability: vsc.probability,
    scDurations: sc.durations, vscDurations: vsc.durations,
    sourceType: observed ? "observed" : "project-estimate",
    sourceLabel: observed ? `${period} 공식 타이밍 상태 기반 관측 빈도 · ${row!.eligibleRaces}경기`
      : `${period} 관측 ${row?.eligibleRaces ?? 0}경기 · 표본 미달로 프로젝트 사전값 사용`,
    sourceUrl: row?.sourceUrl ?? undefined,
    sampleRaces: row?.eligibleRaces ?? 0,
    evidence: Object.freeze({ sourcePeriod: period, scheduledRaces: row?.scheduledRaces ?? 0,
      excludedRaces: row?.missingOrExcludedRaces ?? 0, sc: sc.evidence, vsc: vsc.evidence,
      notes: Object.freeze(notes), rawDataAvailable: true }),
  });
}
