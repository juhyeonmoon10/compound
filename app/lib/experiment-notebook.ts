import type { Compound } from "./strategy.ts";

export const EXPERIMENT_STORAGE_KEY = "apex:experiment-notebook:v1";
export const EXPERIMENT_STORAGE_VERSION = 1;
export const MAX_EXPERIMENTS = 20;

export interface ExperimentStint {
  readonly compound: Compound;
  readonly startLap: number;
  readonly endLap: number;
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

export function isExperimentSnapshot(value: unknown): value is ExperimentSnapshot {
  if (!isObject(value) || !isText(value.trackId, 100) || !isText(value.trackName, 200) ||
    !isInteger(value.laps, 1, 1000) || !isText(value.modelSource, 100) ||
    !isNumber(value.pitLossSeconds, 0, 600) || !isNumber(value.degradationPercent, 0, 1000) ||
    !isNumber(value.trackTemperatureC, -50, 100) || !isInteger(value.maxStops, 0, 20) ||
    (value.modeLabel !== undefined && !isText(value.modeLabel, 100)) || !isObject(value.strategy)) {
    return false;
  }
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
    if (!isObject(stint) || !["S", "M", "H"].includes(String(stint.compound)) ||
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
    if (!isObject(parsed) || parsed.version !== EXPERIMENT_STORAGE_VERSION) {
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
  const verified = Boolean(firstSignature && secondSignature);
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
  const header = ["실험 이름", "저장 시각(UTC)", "서킷 ID", "서킷", "랩 수", "전략 출처", "계수 모델", "피트 손실(초)", "마모 배율(%)", "노면 온도(°C)", "최대 피트 횟수", "타이어 순서", "피트 진입(랩 종료 후)", "스틴트", "예측 총시간(초)", "예측 총시간", "모델 조건 서명"];
  const rows: (string | number)[][] = records.map((record) => [
    record.name, record.createdAt, record.trackId, record.trackName, record.laps,
    record.modeLabel ?? "", record.modelSource, record.pitLossSeconds, record.degradationPercent,
    record.trackTemperatureC, record.maxStops, record.strategy.stints.map((stint) => stint.compound).join(" → "),
    record.strategy.pitAfterLaps.join(" / "),
    record.strategy.stints.map((stint) => `${stint.compound}:L${stint.startLap}–${stint.endLap}`).join(" / "),
    record.strategy.totalSeconds, record.strategy.formattedTime, record.strategy.scenarioSignature ?? "",
  ]);
  return `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
