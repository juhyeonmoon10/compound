import evidence from "../data/calibration-summary.json" with { type: "json" };
import pitEvidence from "../data/pit-loss-summary.json" with { type: "json" };
import { MODEL_PARAMS } from "../model/params.ts";
import { TRACK_PRESETS, TRACK_PRESET_IDS, type Compound, type CompoundModel, type TrackPresetId } from "./strategy.ts";
import type { TeamId } from "./participants.ts";

export interface HistoricalCoefficient {
  readonly compound: string;
  readonly laps: number;
  readonly stints: number;
  readonly identifiable: boolean;
  readonly alphaSecondsPerLap: number | null;
  readonly betaSecondsPerLapSquared: number | null;
  readonly alphaCI95: readonly number[] | null;
  readonly betaCI95: readonly number[] | null;
  readonly model?: string;
  readonly accepted?: boolean;
  readonly reason?: string;
}

export interface CoefficientGate {
  readonly accepted: boolean;
  readonly reason: string;
  readonly alpha0: number | null;
  readonly beta: number | null;
  readonly offsetCorrectionSeconds: number | null;
}

export const HISTORICAL_EVIDENCE = evidence;
/** Compact metadata; raw per-pair laps are loaded only on explicit audit/download. */
export const PIT_LOSS_EVIDENCE = pitEvidence;
export async function loadPitLossRawEvidence() {
  return (await import("../data/pit-loss-evidence.json", { with: { type: "json" } })).default;
}

export interface PitLossCoverage {
  readonly trackId: TrackPresetId;
  readonly status: "observational-estimate" | "no-historical-event" | "unavailable-or-insufficient";
  readonly sourceKind: "pooled-historical" | "single-historical-event" | "unavailable";
  readonly sourceTrackId: TrackPresetId;
  readonly sourceDocument: string;
  readonly sourceLabel: string;
  readonly samples: number;
  readonly medianSeconds: number | null;
  readonly selectedSeason: number | null;
  readonly seasons: readonly number[];
  readonly events: readonly string[];
  readonly sourceUrls: readonly string[];
  readonly fallbackReason: string | null;
  readonly unit: "seconds";
  readonly interpretation: string;
}

/** The existing larger pooled samples win over a new single-event estimate. */
export const PIT_LOSS_COVERAGE: readonly PitLossCoverage[] = Object.freeze(TRACK_PRESET_IDS.map((trackId): PitLossCoverage => {
  const pooled = evidence.pitLossCoverage.find(row => row.trackId === trackId);
  const single = pitEvidence.tracks.find(row => row.trackId === trackId);
  const common = { trackId, sourceTrackId: trackId, unit: "seconds" as const, interpretation: "프로젝트 관측 추정: 인·아웃랩의 정상랩 대비 손실. 정차 교체 시간이나 2026 정밀 피트 통과 시간의 실측이 아님." };
  if (pooled?.status === "observational-estimate" && pooled.medianSeconds !== null && pooled.samples >= pitEvidence.method.thresholds.minimumPairs.value) {
    const sourceEvents = evidence.events.filter(event => pooled.events.includes(event.id));
    const seasons = [...new Set(sourceEvents.map(event => event.season))].sort();
    return Object.freeze({ ...common, status: "observational-estimate", sourceKind: "pooled-historical", sourceDocument: "historical-dry-2023-2025.json", sourceLabel: `${seasons.join("·")} 같은 서킷 관측 풀링 · 기존 다경기 표본 유지`, samples: pooled.samples, medianSeconds: pooled.medianSeconds, selectedSeason: null, seasons: Object.freeze(seasons), events: Object.freeze([...pooled.events]), sourceUrls: Object.freeze(sourceEvents.map(event => event.timingSourceUrl)), fallbackReason: null });
  }
  if (single?.status === "observational-estimate" && single.medianSeconds !== null && single.selectedSeason !== null && single.selectedAttemptIndex !== null) {
    const attempt = single.attempts[single.selectedAttemptIndex];
    return Object.freeze({ ...common, status: "observational-estimate", sourceKind: "single-historical-event", sourceDocument: pitEvidence.sourceDocument, sourceLabel: `${single.selectedSeason} 단일 경기 관측${single.fallbackReason ? " · 2025 표본 부족으로 이전 시즌 사용" : ""}`, samples: single.retainedSamples, medianSeconds: single.medianSeconds, selectedSeason: single.selectedSeason, seasons: Object.freeze([single.selectedSeason]), events: Object.freeze([`${single.selectedSeason}-${trackId}`]), sourceUrls: Object.freeze(attempt?.timingSourceUrl ? [attempt.timingSourceUrl] : []), fallbackReason: single.fallbackReason });
  }
  return Object.freeze({ ...common, status: single?.status === "no-historical-event" ? "no-historical-event" : "unavailable-or-insufficient", sourceKind: "unavailable", sourceDocument: pitEvidence.sourceDocument, sourceLabel: single?.status === "no-historical-event" ? "2023–2025 해당 서킷 역사 경기 없음" : "관측 자료 또는 최소 표본 미확보", samples: 0, medianSeconds: null, selectedSeason: null, seasons: Object.freeze([]), events: Object.freeze([]), sourceUrls: Object.freeze([]), fallbackReason: single?.reason ?? null });
}));

/** A measured proxy is adopted only across the explicitly declared >= boundary. */
export function adoptHistoricalPitLoss(observedSeconds: number | null | undefined, presetSeconds: number): number | undefined {
  return observedSeconds !== null && observedSeconds !== undefined && Number.isFinite(observedSeconds) && observedSeconds > 0 && Number.isFinite(presetSeconds)
    && Math.abs(observedSeconds - presetSeconds) >= MODEL_PARAMS.historical.pitAdoptionDifferenceSeconds ? observedSeconds : undefined;
}

export const OBSERVED_TRACK_IDS = [...new Set(evidence.events.map((event) => event.trackId))] as TrackPresetId[];
const DRY_COMPOUNDS = ["S", "M", "H"] as const;

/** Recheck the training-only nested selection; holdout error is never part of this gate. */
export function evaluateHistoricalCoefficient(row: HistoricalCoefficient): CoefficientGate {
  const rejected = (reason: string): CoefficientGate => ({ accepted: false, reason, alpha0: null, beta: null, offsetCorrectionSeconds: null });
  if (!row.identifiable || row.alphaSecondsPerLap === null || row.betaSecondsPerLapSquared === null) return rejected("계수를 독립적으로 식별할 수 없음");
  if (row.accepted !== true) return rejected("학습자료의 모델 선택 기준을 통과하지 못함");
  if (row.laps < MODEL_PARAMS.historical.minLaps || row.stints < MODEL_PARAMS.historical.minStints) return rejected("최소 랩·스틴트 표본 미달");
  const alpha = row.alphaSecondsPerLap;
  const beta = row.betaSecondsPerLapSquared;
  if (![alpha, beta, ...(row.alphaCI95 ?? []), ...(row.betaCI95 ?? [])].every(Number.isFinite)) return rejected("유한한 추정치·구간이 필요함");
  if (!row.alphaCI95 || row.alphaCI95.length !== 2 || !row.betaCI95 || row.betaCI95.length !== 2) return rejected("95% 신뢰구간 미확보");
  if (row.model === "quadratic" && row.betaCI95[0] <= 0) return rejected("2차항 β의 학습 95% 구간이 0을 포함하거나 음수임");
  if (row.model === "linear" && (row.alphaCI95[0] <= 0 || beta !== 0)) return rejected("재적합한 선형 α의 학습 95% 구간이 양수가 아님");
  if (row.model !== "quadratic" && row.model !== "linear") return rejected("학습자료 모델 선택 기록 미확보");
  const alpha0 = alpha + 2 * beta;
  if (alpha0 < 0 || beta < 0) return rejected("0기준 수명 변환 후 엔진의 비음수 조건 위반");
  return { accepted: true, reason: row.model === "quadratic" ? "학습 β의 양의 95% 구간·비음수 변환 기준 통과" : "제곱항 제거 후 재적합한 학습 선형 α의 양의 95% 구간 통과", alpha0, beta, offsetCorrectionSeconds: alpha + beta };
}

/** Preserve alpha*l + beta*l² exactly when l = age + 1. No coefficient clipping. */
export function poolHistoricalCompound(rows: readonly HistoricalCoefficient[], prior: CompoundModel): Partial<CompoundModel> | undefined {
  const passed = rows.map((row) => ({ row, gate: evaluateHistoricalCoefficient(row) })).filter((item) => item.gate.accepted);
  const weight = passed.reduce((sum, item) => sum + item.row.laps, 0);
  if (!weight) return undefined;
  const mean = (key: "alpha0" | "beta" | "offsetCorrectionSeconds") => passed.reduce((sum, item) => sum + (item.gate[key] as number) * item.row.laps, 0) / weight;
  return { alpha: mean("alpha0"), beta: mean("beta"), offsetSeconds: prior.offsetSeconds + mean("offsetCorrectionSeconds") };
}

function compoundOverrides(sourceTrackId: TrackPresetId, targetTrackId: TrackPresetId) {
  const events = evidence.events.filter((event) => event.trackId === sourceTrackId);
  const overrides: Partial<Record<Compound, Partial<CompoundModel>>> = {};
  for (const compound of DRY_COMPOUNDS) {
    const result = poolHistoricalCompound(events.flatMap((event) => (event.modelSelection?.coefficients ?? []).filter((row) => row.compound === compound)), TRACK_PRESETS[targetTrackId].compounds[compound]);
    if (result) overrides[compound] = result;
  }
  return overrides;
}

export function nearestHistoricalTrack(trackId: TrackPresetId): TrackPresetId | null {
  const target = TRACK_PRESETS[trackId];
  return [...OBSERVED_TRACK_IDS]
    .filter((id) => id !== trackId && TRACK_PRESETS[id].tyreSeverity === target.tyreSeverity)
    .sort((a, b) => Math.abs(TRACK_PRESETS[a].circuitLengthKm - target.circuitLengthKm) - Math.abs(TRACK_PRESETS[b].circuitLengthKm - target.circuitLengthKm) || a.localeCompare(b))[0] ?? null;
}

export function getHistoricalCalibration(trackId: TrackPresetId) {
  const hasDirectData = OBSERVED_TRACK_IDS.includes(trackId);
  let sourceTrackId: TrackPresetId | null = hasDirectData ? trackId : nearestHistoricalTrack(trackId);
  let compoundModels = sourceTrackId ? compoundOverrides(sourceTrackId, trackId) : {};
  if (!Object.keys(compoundModels).length) {
    const eligibleFallbacks = OBSERVED_TRACK_IDS.filter((id) => id !== trackId && TRACK_PRESETS[id].tyreSeverity === TRACK_PRESETS[trackId].tyreSeverity && Object.keys(compoundOverrides(id, trackId)).length > 0);
    eligibleFallbacks.sort((a, b) => Math.abs(TRACK_PRESETS[a].circuitLengthKm - TRACK_PRESETS[trackId].circuitLengthKm) - Math.abs(TRACK_PRESETS[b].circuitLengthKm - TRACK_PRESETS[trackId].circuitLengthKm) || a.localeCompare(b));
    if (eligibleFallbacks[0]) {
      sourceTrackId = eligibleFallbacks[0];
      compoundModels = compoundOverrides(sourceTrackId, trackId);
    }
  }
  const appliedCompounds = Object.keys(compoundModels) as Compound[];
  const pit = PIT_LOSS_COVERAGE.find((row) => row.trackId === trackId)!;
  const observedPitLossSeconds = pit?.status === "observational-estimate" && pit.medianSeconds !== null ? pit.medianSeconds : undefined;
  const pitDifferenceSeconds = observedPitLossSeconds === undefined ? undefined : observedPitLossSeconds - TRACK_PRESETS[trackId].pitLossSeconds;
  const pitLossSeconds = adoptHistoricalPitLoss(observedPitLossSeconds, TRACK_PRESETS[trackId].pitLossSeconds);
  const events = sourceTrackId ? evidence.events.filter((event) => event.trackId === sourceTrackId) : [];
  const borrowed = sourceTrackId !== null && sourceTrackId !== trackId;
  const note = appliedCompounds.length
    ? `${appliedCompounds.join("·")}에 ${TRACK_PRESETS[sourceTrackId!].koreanName}의 기준 통과 항을 랩수 가중 적용${borrowed ? "(같은 열화 등급·가까운 길이의 대체 서킷)" : ""}`
    : "학습자료에서 선형/2차 모델의 신뢰 기준을 통과한 항이 없어 타이어 가정값 유지";
  return {
    compoundModels: appliedCompounds.length ? compoundModels : undefined,
    pitLossSeconds,
    sourceTrackId,
    summaryKorean: `${note}. 피트 손실은 ${pitLossSeconds !== undefined ? `관측 ${pit.samples}쌍의 중앙값 ${pitLossSeconds.toFixed(2)}초 채택` : observedPitLossSeconds === undefined ? "이 서킷 관측 미확보로 가정값 유지" : `관측 차이가 ${MODEL_PARAMS.historical.pitAdoptionDifferenceSeconds}초 미만이므로 기존값 유지`}. ${pit.sourceLabel}; 정차 시간 아닌 인·아웃랩 손실의 프로젝트 관측 추정입니다.`,
    provenance: { mode: appliedCompounds.length ? borrowed ? "same-severity-fallback" : "same-circuit-observational" : "prior-retained", borrowed, eventIds: events.map((event) => event.id), sourceUrls: events.map((event) => event.timingSourceUrl), currentSeasonCollected: false, pitSource: pit, note: "2023–2025 경기별 상대 S/M/H 관측을 이용한 프로젝트 초깃값이며 절대 배합 동일성·2026 타이어 물성을 주장하지 않음" },
    coverage: { hasDirectData, appliedCompounds, retainedCompounds: DRY_COMPOUNDS.filter((compound) => !appliedCompounds.includes(compound)), observedCircuits: OBSERVED_TRACK_IDS.length, totalCircuits: TRACK_PRESET_IDS.length, observedPitCircuits: PIT_LOSS_COVERAGE.filter(row => row.status === "observational-estimate").length, pitSamples: pit.samples, pitStatus: pitLossSeconds === undefined ? "prior" : "observational-estimate", pitObservationStatus: pit.status, pitSourceKind: pit.sourceKind, observedPitLossSeconds, pitDifferenceSeconds },
  };
}

const TEAM_ALIASES: Readonly<Record<TeamId, readonly string[]>> = {
  mercedes: ["Mercedes"], ferrari: ["Ferrari"], mclaren: ["McLaren"], "red-bull": ["Red Bull Racing"],
  "racing-bulls": ["Racing Bulls", "RB", "AlphaTauri"], alpine: ["Alpine"], haas: ["Haas F1 Team"],
  williams: ["Williams"], "aston-martin": ["Aston Martin"], audi: [], cadillac: [],
};

export interface ObservedTeamPerformance {
  readonly paceSeconds: number;
  readonly degMultiplier: number;
  readonly pitCrewDeltaSeconds: number;
  readonly observedPaceSeconds: number | null;
  readonly observedDegRatio: number | null;
  readonly source: { readonly kind: "historical-observational" | "unavailable"; readonly seasons: readonly number[]; readonly sourceTeamNames: readonly string[]; readonly events: number; readonly laps: number; readonly currentSeasonCollected: false; readonly stationaryPitCollected: false };
  readonly explanation: string;
}

export function getObservedTeamPerformance(teamId: TeamId): ObservedTeamPerformance {
  const aliases = TEAM_ALIASES[teamId];
  const rows = evidence.teams.filter((row) => aliases.includes(row.team));
  const events = new Set(rows.map((row) => row.eventId));
  const laps = rows.reduce((sum, row) => sum + row.laps, 0);
  const available = events.size >= MODEL_PARAMS.historical.minTeamEvents && laps > 0;
  const paceRows = rows.filter((row) => row.paceDeltaSeconds !== null);
  const paceLaps = paceRows.reduce((sum, row) => sum + row.laps, 0);
  const observedPaceSeconds = available && paceLaps ? paceRows.reduce((sum, row) => sum + row.paceDeltaSeconds! * row.laps, 0) / paceLaps : null;
  const degRows = rows.filter((row) => row.degradationSecondsPerLap !== null && row.degradationCI95 !== null && row.degradationCI95[0] > 0 && row.referencePositiveTeamSlopeMedian !== null && row.referencePositiveTeamSlopeMedian > 0);
  const degLaps = degRows.reduce((sum, row) => sum + row.laps, 0);
  const observedDegRatio = available && degLaps ? degRows.reduce((sum, row) => sum + row.degradationSecondsPerLap! / row.referencePositiveTeamSlopeMedian! * row.laps, 0) / degLaps : null;
  const cap = MODEL_PARAMS.historical.maxTeamPaceSeconds;
  const paceSeconds = observedPaceSeconds === null ? MODEL_PARAMS.performance.neutralPaceSeconds : Math.min(cap, Math.max(-cap, observedPaceSeconds * MODEL_PARAMS.historical.teamPaceShrink));
  const degMultiplier = observedDegRatio === null ? MODEL_PARAMS.performance.neutralDeg : Math.min(MODEL_PARAMS.performance.teamDegMax, Math.max(MODEL_PARAMS.performance.teamDegMin, 1 + (observedDegRatio - 1) * MODEL_PARAMS.historical.teamDegShrink));
  return {
    paceSeconds, degMultiplier, pitCrewDeltaSeconds: MODEL_PARAMS.performance.neutralPitDeltaSeconds,
    observedPaceSeconds, observedDegRatio,
    source: { kind: available ? "historical-observational" : "unavailable", seasons: [...new Set(rows.map((row) => row.season))].sort(), sourceTeamNames: [...new Set(rows.map((row) => row.team))], events: events.size, laps, currentSeasonCollected: false, stationaryPitCollected: false },
    explanation: available ? `2023–2025 동컴파운드 관측 ${events.size}경기·${laps.toLocaleString("ko-KR")}랩을 프로젝트 축소율로 제한해 사용합니다. 선수·교통·운영 차이가 남으며 2026 실측은 미수집입니다. 정차 교체 시간을 분리할 자료가 없어 피트크루 보정은 0초입니다.` : "이 팀 이름의 과거 관측을 확보하지 못했습니다. 2026 실측도 미수집이므로 페이스 0초·열화 1배·피트크루 0초 중립값을 사용합니다.",
  };
}
