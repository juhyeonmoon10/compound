import type { Compound } from "./strategy.ts";
import { buildWeatherTimeline, type WeatherInput } from "./weather.ts";
import { MODEL_PARAMS, RAIN_LABELS, TYRE_LABELS } from "../model/params.ts";

export const EXPERIMENT_STORAGE_KEY = "apex:experiment-notebook:v1";
// Retain the existing key so older records remain discoverable. Reads support
// v1 and v2; a normal, user-requested save upgrades the envelope without deletion.
export const EXPERIMENT_STORAGE_VERSION = 2;
export const MAX_EXPERIMENTS = 20;

export interface ExperimentStint {
  readonly compound: Compound;
  readonly startLap: number;
  readonly endLap: number;
}

export interface ExperimentResearchInfo {
  readonly weather: WeatherInput;
  readonly seed: number;
  readonly scTimelineSummary: string;
  readonly teamId: string;
  readonly driverId: string;
  readonly performanceEnabled: boolean;
  readonly mc?: {
    readonly trials: number;
    /** Win rate among the compared candidates, not a real-world race forecast. */
    readonly winRate: number;
    readonly p10Seconds: number;
    readonly p90Seconds: number;
  };
  readonly eaRatings?: {
    readonly sourceUrl: string;
    readonly checkedAt: string;
    readonly iteration: string;
    readonly ratings: { readonly OVR: number; readonly EXP: number; readonly RAC: number; readonly AWA: number; readonly PAC: number };
  };
}

export interface ExperimentSnapshot {
  readonly trackId: string;
  readonly trackName: string;
  readonly laps: number;
  readonly modelSource: string;
  readonly pitLossSeconds: number;
  readonly degradationPercent: number;
  readonly trackTemperatureC: number;
  readonly maxStops: number;
  readonly modeLabel?: string;
  /** Absent on v1 records; do not invent historical weather or seed settings. */
  readonly research?: ExperimentResearchInfo;
  readonly strategy: {
    readonly formattedTime: string;
    readonly totalSeconds: number;
    readonly stints: readonly ExperimentStint[];
    readonly pitAfterLaps: readonly number[];
    /** Include the evaluator's signature to compare all model parameters. */
    readonly scenarioSignature?: string;
  };
}

export interface ExperimentRecord extends ExperimentSnapshot {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function isNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function isInteger(value: unknown, min: number, max: number): value is number {
  return isNumber(value, min, max) && Number.isInteger(value);
}

function isResearchInfo(value: unknown, laps: number, trackTemperatureC: number): value is ExperimentResearchInfo {
  if (!isObject(value) || !isObject(value.weather) || typeof value.weather.preset !== "string" ||
    !Object.hasOwn(RAIN_LABELS, String(value.weather.preset)) ||
    !isInteger(value.seed, 0, MODEL_PARAMS.race.uintRange - 1) ||
    !isText(value.scTimelineSummary, 100_000) || !isText(value.teamId, 100) ||
    !isText(value.driverId, 100) || typeof value.performanceEnabled !== "boolean") return false;
  for (const key of ["startLap", "endLap"] as const) {
    if (value.weather[key] !== undefined && !isInteger(value.weather[key], 1, laps)) return false;
  }
  if ((value.weather.initialWater !== undefined && !isNumber(value.weather.initialWater, 0, 1)) ||
    (value.weather.carsOnTrack !== undefined && !isInteger(value.weather.carsOnTrack, 0, Number.MAX_SAFE_INTEGER))) return false;
  try {
    // Share the weather model's exact input validation and default resolution.
    buildWeatherTimeline(laps, trackTemperatureC, value.weather as unknown as WeatherInput);
  } catch { return false; }
  if (value.mc !== undefined && (!isObject(value.mc) || !isInteger(value.mc.trials, 1, 1_000_000) ||
    !isNumber(value.mc.winRate, 0, 1) || !isNumber(value.mc.p10Seconds, 0.001, 1_000_000) ||
    !isNumber(value.mc.p90Seconds, value.mc.p10Seconds, 1_000_000))) return false;
  if (value.eaRatings !== undefined) {
    const ea = value.eaRatings;
    if (!isObject(ea) || !isText(ea.sourceUrl, 2000) || !isText(ea.checkedAt, 40) ||
      !Number.isFinite(Date.parse(ea.checkedAt)) || !isText(ea.iteration, 200) || !isObject(ea.ratings)) return false;
    const ratings = ea.ratings;
    if (!["OVR", "EXP", "RAC", "AWA", "PAC"].every((key) => isInteger(ratings[key], 0, 100))) return false;
  }
  return true;
}

function copyResearch(research: ExperimentResearchInfo): ExperimentResearchInfo {
  const { weather, eaRatings, mc } = research;
  return {
    weather: { preset: weather.preset,
      ...(weather.startLap !== undefined ? { startLap: weather.startLap } : {}),
      ...(weather.endLap !== undefined ? { endLap: weather.endLap } : {}),
      ...(weather.initialWater !== undefined ? { initialWater: weather.initialWater } : {}),
      ...(weather.carsOnTrack !== undefined ? { carsOnTrack: weather.carsOnTrack } : {}) },
    seed: research.seed, scTimelineSummary: research.scTimelineSummary,
    teamId: research.teamId, driverId: research.driverId, performanceEnabled: research.performanceEnabled,
    ...(mc ? { mc: { trials: mc.trials, winRate: mc.winRate, p10Seconds: mc.p10Seconds, p90Seconds: mc.p90Seconds } } : {}),
    ...(eaRatings ? { eaRatings: { sourceUrl: eaRatings.sourceUrl, checkedAt: eaRatings.checkedAt,
      iteration: eaRatings.iteration, ratings: { OVR: eaRatings.ratings.OVR, EXP: eaRatings.ratings.EXP,
        RAC: eaRatings.ratings.RAC, AWA: eaRatings.ratings.AWA, PAC: eaRatings.ratings.PAC } } } : {}),
  };
}

export function isExperimentSnapshot(value: unknown): value is ExperimentSnapshot {
  if (!isObject(value) || !isText(value.trackId, 100) || !isText(value.trackName, 200) ||
    !isInteger(value.laps, 1, 1000) || !isText(value.modelSource, 100) ||
    !isNumber(value.pitLossSeconds, 0, 600) || !isNumber(value.degradationPercent, 0, 1000) ||
    !isNumber(value.trackTemperatureC, -50, 100) || !isInteger(value.maxStops, 0, 20) ||
    (value.modeLabel !== undefined && !isText(value.modeLabel, 100)) || !isObject(value.strategy)) {
    return false;
  }
  if (value.research !== undefined && !isResearchInfo(value.research, value.laps, value.trackTemperatureC)) return false;
  const strategy = value.strategy;
  if (!isText(strategy.formattedTime, 100) || !isNumber(strategy.totalSeconds, 0.001, 1_000_000) ||
    !Array.isArray(strategy.stints) || strategy.stints.length < 1 || strategy.stints.length > 21 ||
    !Array.isArray(strategy.pitAfterLaps) || strategy.pitAfterLaps.length !== strategy.stints.length - 1 ||
    strategy.pitAfterLaps.length > value.maxStops ||
    (strategy.scenarioSignature !== undefined && !isText(strategy.scenarioSignature, 100_000))) {
    return false;
  }
  let nextLap = 1;
  for (let index = 0; index < strategy.stints.length; index += 1) {
    const stint: unknown = strategy.stints[index];
    if (!isObject(stint) || typeof stint.compound !== "string" || !Object.hasOwn(TYRE_LABELS, stint.compound) ||
      !isInteger(stint.startLap, 1, value.laps) || !isInteger(stint.endLap, stint.startLap, value.laps) ||
      stint.startLap !== nextLap) return false;
    if (index < strategy.stints.length - 1 && strategy.pitAfterLaps[index] !== stint.endLap) return false;
    nextLap = stint.endLap + 1;
  }
  return nextLap === value.laps + 1;
}

export function isExperimentRecord(value: unknown): value is ExperimentRecord {
  return isExperimentSnapshot(value) && isObject(value) && isText(value.id, 100) &&
    isText(value.name, 100) && isText(value.createdAt, 40) &&
    /^\d{4}-\d{2}-\d{2}T/.test(value.createdAt) && Number.isFinite(Date.parse(value.createdAt));
}

export function createExperiment(
  snapshot: ExperimentSnapshot,
  name: string,
  identity: { readonly id: string; readonly createdAt: string },
): ExperimentRecord {
  if (!isExperimentSnapshot(snapshot)) throw new Error("Invalid experiment snapshot");
  const record: ExperimentRecord = {
    trackId: snapshot.trackId,
    trackName: snapshot.trackName,
    laps: snapshot.laps,
    modelSource: snapshot.modelSource,
    pitLossSeconds: snapshot.pitLossSeconds,
    degradationPercent: snapshot.degradationPercent,
    trackTemperatureC: snapshot.trackTemperatureC,
    maxStops: snapshot.maxStops,
    ...(snapshot.modeLabel ? { modeLabel: snapshot.modeLabel } : {}),
    ...(snapshot.research ? { research: copyResearch({ ...snapshot.research,
      // Freeze resolved weather defaults on save, rather than letting a later
      // change to default onset/cars/water rewrite the meaning of this record.
      weather: buildWeatherTimeline(snapshot.laps, snapshot.trackTemperatureC, snapshot.research.weather).input,
    }) } : {}),
    strategy: {
      formattedTime: snapshot.strategy.formattedTime,
      totalSeconds: snapshot.strategy.totalSeconds,
      stints: snapshot.strategy.stints.map(({ compound, startLap, endLap }) => ({ compound, startLap, endLap })),
      pitAfterLaps: [...snapshot.strategy.pitAfterLaps],
      ...(snapshot.strategy.scenarioSignature ? { scenarioSignature: snapshot.strategy.scenarioSignature } : {}),
    },
    id: identity.id,
    createdAt: identity.createdAt,
    name: name.trim().slice(0, 100),
  };
  if (!isExperimentRecord(record)) throw new Error("Invalid experiment snapshot");
  return record;
}

export interface ExperimentStorageResult {
  readonly records: readonly ExperimentRecord[];
  readonly status: "empty" | "ok" | "invalid" | "incompatible";
  readonly discardedCount: number;
}

export function parseExperiments(raw: string | null): ExperimentStorageResult {
  if (raw === null) return { records: [], status: "empty", discardedCount: 0 };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed) || (parsed.version !== 1 && parsed.version !== EXPERIMENT_STORAGE_VERSION)) {
      return { records: [], status: "incompatible", discardedCount: 0 };
    }
    if (!Array.isArray(parsed.records)) return { records: [], status: "invalid", discardedCount: 0 };
    const ids = new Set<string>();
    const records: ExperimentRecord[] = [];
    for (const item of parsed.records) {
      if (!isExperimentRecord(item) || ids.has(item.id) || records.length >= MAX_EXPERIMENTS) continue;
      ids.add(item.id);
      records.push(createExperiment(item, item.name, item));
    }
    return { records, status: "ok", discardedCount: parsed.records.length - records.length };
  } catch {
    return { records: [], status: "invalid", discardedCount: 0 };
  }
}

export function serializeExperiments(records: readonly ExperimentRecord[]): string {
  if (records.length > MAX_EXPERIMENTS || records.some((record) => !isExperimentRecord(record)) ||
    new Set(records.map((record) => record.id)).size !== records.length) {
    throw new Error("Invalid experiment collection");
  }
  return JSON.stringify({ version: EXPERIMENT_STORAGE_VERSION, records });
}

const COMPARABLE_FIELDS = [
  ["trackId", "서킷"], ["laps", "레이스 랩 수"], ["modelSource", "계수 모델"],
  ["pitLossSeconds", "피트 손실"], ["degradationPercent", "마모 배율"],
  ["trackTemperatureC", "노면 온도"], ["maxStops", "최대 피트 횟수"],
] as const;

export function compareExperiments(first: ExperimentRecord, second: ExperimentRecord) {
  const differences: string[] = COMPARABLE_FIELDS.filter(([key]) => first[key] !== second[key]).map(([, label]) => label);
  const firstSignature = first.strategy.scenarioSignature;
  const secondSignature = second.strategy.scenarioSignature;
  const firstResearch = first.research, secondResearch = second.research;
  const researchCoverageMatches = Boolean(firstResearch) === Boolean(secondResearch);
  if (!researchCoverageMatches) differences.push("연구 조건 기록 유무");
  if (firstResearch && secondResearch) {
    const normalizeWeather = (record: ExperimentRecord, research: ExperimentResearchInfo) => {
      const input = buildWeatherTimeline(record.laps, record.trackTemperatureC, research.weather).input;
      return JSON.stringify([input.preset, input.startLap, input.endLap, input.initialWater, input.carsOnTrack]);
    };
    if (normalizeWeather(first, firstResearch) !== normalizeWeather(second, secondResearch)) differences.push("강수 조건");
    for (const [key, label] of [["seed", "난수 시드"], ["scTimelineSummary", "SC/VSC 시나리오"],
      ["teamId", "팀"], ["driverId", "선수"], ["performanceEnabled", "능력치 적용"]] as const) {
      if (firstResearch[key] !== secondResearch[key]) differences.push(label);
    }
    if (firstResearch.mc?.trials !== secondResearch.mc?.trials) differences.push("확률 실험 시행 수");
    const eaIdentity = (research: ExperimentResearchInfo) => research.eaRatings
      ? JSON.stringify([research.eaRatings.iteration, research.eaRatings.ratings.OVR, research.eaRatings.ratings.EXP,
        research.eaRatings.ratings.RAC, research.eaRatings.ratings.AWA, research.eaRatings.ratings.PAC]) : null;
    if (eaIdentity(firstResearch) !== eaIdentity(secondResearch)) differences.push("EA 레이팅 스냅샷");
  }
  const verified = Boolean(firstSignature && secondSignature) && researchCoverageMatches;
  if (verified && firstSignature !== secondSignature && differences.length === 0) differences.push("기타 모델 조건");
  return {
    deltaSeconds: second.strategy.totalSeconds - first.strategy.totalSeconds,
    differences,
    sameConditions: differences.length === 0 && verified,
    verificationMissing: !verified,
  };
}

/** Spreadsheet strings cannot be interpreted as formulas; all cells are quoted. */
export function csvCell(value: string | number): string {
  const text = String(value);
  const safe = typeof value === "string" && (/^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function experimentsToCsv(records: readonly ExperimentRecord[]): string {
  const header = ["실험 이름", "저장 시각(UTC)", "서킷 ID", "서킷", "랩 수", "전략 출처", "계수 모델", "피트 손실(초)", "마모 배율(%)", "노면 온도(°C)", "최대 피트 횟수", "타이어 순서", "피트 진입(랩 종료 후)", "스틴트", "예측 총시간(초)", "예측 총시간", "모델 조건 서명",
    "연구 조건 기록", "강수 프리셋", "비 시작 랩", "비 종료 랩", "초기 수막", "노면 건조 차량 수", "난수 시드", "SC/VSC 시나리오 요약", "팀 ID", "선수 ID", "능력치 적용",
    "MC 시행 수", "후보 중 승률(0~1)", "MC P10(초)", "MC P90(초)", "EA iteration", "EA 확인일", "EA 출처", "EA OVR", "EA EXP", "EA RAC", "EA AWA", "EA PAC"];
  const rows: (string | number)[][] = records.map((record) => [
    record.name, record.createdAt, record.trackId, record.trackName, record.laps,
    record.modeLabel ?? "", record.modelSource, record.pitLossSeconds, record.degradationPercent,
    record.trackTemperatureC, record.maxStops, record.strategy.stints.map((stint) => stint.compound).join(" → "),
    record.strategy.pitAfterLaps.join(" / "),
    record.strategy.stints.map((stint) => `${stint.compound}:L${stint.startLap}–${stint.endLap}`).join(" / "),
    record.strategy.totalSeconds, record.strategy.formattedTime, record.strategy.scenarioSignature ?? "",
    ...(record.research ? (() => {
      const info = record.research;
      const weather = buildWeatherTimeline(record.laps, record.trackTemperatureC, info.weather).input;
      return ["있음", RAIN_LABELS[weather.preset], weather.startLap ?? "", weather.endLap ?? "", weather.initialWater ?? "", weather.carsOnTrack ?? "",
        info.seed, info.scTimelineSummary, info.teamId, info.driverId, info.performanceEnabled ? "적용" : "미적용",
        info.mc?.trials ?? "", info.mc?.winRate ?? "", info.mc?.p10Seconds ?? "", info.mc?.p90Seconds ?? "",
        info.eaRatings?.iteration ?? "", info.eaRatings?.checkedAt ?? "", info.eaRatings?.sourceUrl ?? "", info.eaRatings?.ratings.OVR ?? "", info.eaRatings?.ratings.EXP ?? "", info.eaRatings?.ratings.RAC ?? "", info.eaRatings?.ratings.AWA ?? "", info.eaRatings?.ratings.PAC ?? ""];
    })() : ["미기록(v1)", ...Array(header.length - 18).fill("")]),
  ]);
  return `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
