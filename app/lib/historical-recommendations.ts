import examples from "../data/strategy-examples.json" with { type: "json" };
import type { Compound, StrategyStintInput, TrackPresetId } from "./strategy.ts";
import type { WeatherInput } from "./weather.ts";
import { MODEL_PARAMS } from "../model/params.ts";

export interface StrategyExampleDriver {
  code: string; name: string; team: string; gridPosition: number; finishPosition: number;
  stints: readonly (StrategyStintInput & { tyreLifeStart: number | null })[];
}
export interface StrategyExampleEvent {
  id: string; season: number; trackId: string; name: string; date: string; raceLaps: number;
  trackTemperatureC: number | null; airTemperatureC: number | null; humidityPercent: number | null;
  weatherKind: string; wetLapStart: number | null; wetLapEnd: number | null;
  raceControl: { sc: boolean; vsc: boolean; red: boolean }; timingUrl: string;
  drivers: readonly StrategyExampleDriver[];
}
export interface RecommendationConditions {
  trackId: TrackPresetId; startingGridPosition: number; trackTemperatureC: number;
  airTemperatureC: number; humidityPercent: number; maxStops: number; laps: number; weather: WeatherInput;
}
export interface HistoricalMatch {
  id: string; event: StrategyExampleEvent; driver: StrategyExampleDriver; distance: number;
  differences: { grid: number; trackC: number; airC: number; humidity: number | null };
  importable: boolean; adaptation: string | null;
}
export const STRATEGY_EXAMPLES = examples as unknown as { generatedAt: string; events: readonly StrategyExampleEvent[] };
export const MATCH_LIMITS = Object.freeze({ grid: 5, trackC: 10, airC: 7, humidity: 25, wetPhase: 0.2, lapAdjustment: 3 });
export const WEATHER_KIND_LABELS: Readonly<Record<string, string>> = { dry: "건식", wet: "우천 지속", "wet-to-dry": "우천 → 건조", "dry-to-wet": "건조 → 우천", mixed: "혼합", unknown: "미확인" };

function targetWeather(input: WeatherInput, laps: number) {
  const start = input.startLap ?? (input.preset === "dry-to-rain" ? Math.round(laps * MODEL_PARAMS.weather.defaultStartFraction) : 1);
  const end = input.endLap ?? (input.preset === "rain-to-dry" ? Math.round(laps * MODEL_PARAMS.weather.defaultEndFraction) : laps);
  if (input.preset === "none") return { kind: (input.initialWater ?? 0) > 0 ? "unknown" : "dry", start, end };
  return { kind: start > 3 ? end < laps - 2 ? "mixed" : "dry-to-wet" : end < laps - 2 ? "wet-to-dry" : "wet", start, end };
}

function validPlan(driver: StrategyExampleDriver, laps: number): boolean {
  if (!Number.isInteger(driver.gridPosition) || driver.gridPosition < 1 || !driver.stints.length) return false;
  const compounds: readonly Compound[] = ["S", "M", "H", "INTER", "WET"];
  return driver.stints.every((stint, i) => compounds.includes(stint.compound) && Number.isInteger(stint.startLap)
    && Number.isInteger(stint.endLap) && stint.endLap >= stint.startLap
    && stint.startLap === (i ? driver.stints[i - 1].endLap + 1 : 1)) && driver.stints.at(-1)!.endLap === laps;
}

/** Retrieval, not an optimizer: never synthesizes laps/compounds or ranks by finish position. */
export function recommendHistoricalStrategies(conditions: RecommendationConditions, events = STRATEGY_EXAMPLES.events) {
  const circuitEvents = events.filter(event => event.trackId === conditions.trackId);
  const target = targetWeather(conditions.weather, conditions.laps);
  const weatherKind = target.kind;
  const compatibleWeather = circuitEvents.filter(event => {
    if (weatherKind === "unknown") return false;
    if (event.weatherKind !== weatherKind) return false;
    const closeStart = event.wetLapStart !== null && Math.abs(event.wetLapStart / event.raceLaps - target.start / conditions.laps) <= MATCH_LIMITS.wetPhase;
    const closeEnd = event.wetLapEnd !== null && Math.abs(event.wetLapEnd / event.raceLaps - target.end / conditions.laps) <= MATCH_LIMITS.wetPhase;
    if (weatherKind === "dry-to-wet") return closeStart;
    if (weatherKind === "wet-to-dry") return closeEnd;
    if (weatherKind === "mixed") return closeStart && closeEnd;
    return true;
  });
  const candidates: HistoricalMatch[] = [];
  for (const event of compatibleWeather) {
    if (event.trackTemperatureC === null || event.airTemperatureC === null) continue;
    for (const driver of event.drivers) {
      if (!validPlan(driver, event.raceLaps) || driver.stints.length - 1 > conditions.maxStops) continue;
      const differences = { grid: Math.abs(driver.gridPosition - conditions.startingGridPosition), trackC: Math.abs(event.trackTemperatureC - conditions.trackTemperatureC), airC: Math.abs(event.airTemperatureC - conditions.airTemperatureC), humidity: event.humidityPercent === null ? null : Math.abs(event.humidityPercent - conditions.humidityPercent) };
      if (differences.grid > MATCH_LIMITS.grid || differences.trackC > MATCH_LIMITS.trackC || differences.airC > MATCH_LIMITS.airC || (differences.humidity !== null && differences.humidity > MATCH_LIMITS.humidity)) continue;
      // Missing humidity gets no match bonus; the UI explicitly marks it unknown.
      const distance = 0.5 * differences.grid / MATCH_LIMITS.grid + 0.3 * differences.trackC / MATCH_LIMITS.trackC + 0.15 * differences.airC / MATCH_LIMITS.airC + 0.05 * (differences.humidity === null ? 1 : differences.humidity / MATCH_LIMITS.humidity);
      const lapDifference = conditions.laps - event.raceLaps;
      const importable = driver.stints.length >= 2 && driver.stints.length <= 4 && Math.abs(lapDifference) <= MATCH_LIMITS.lapAdjustment && driver.stints.at(-1)!.startLap <= conditions.laps;
      candidates.push({ id: `${event.id}-${driver.code}`, event, driver, differences, distance, importable,
        adaptation: lapDifference === 0 ? null : `실제 ${event.raceLaps}랩 → 현재 ${conditions.laps}랩. 가져오면 마지막 스틴트만 ${lapDifference > 0 ? `${lapDifference}랩 연장` : `${-lapDifference}랩 단축`}합니다. 교체 랩은 그대로 유지합니다.` });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance || b.event.season - a.event.season || a.id.localeCompare(b.id));
  const signatures = new Set<string>();
  const matches = candidates.filter(row => {
    const signature = row.driver.stints.map(s => `${s.compound}:${s.startLap}-${s.endLap}`).join("|");
    if (signatures.has(signature)) return false;
    signatures.add(signature); return true;
  }).slice(0, 3);
  const reason = !circuitEvents.length ? "이 서킷의 실제 전략 자료를 아직 확보하지 못했습니다. 다른 서킷의 전략으로 대체하지 않습니다."
    : !compatibleWeather.length ? "이 서킷에서 선택한 건식·우천 흐름과 비슷한 실제 경기 기록이 없습니다."
    : !matches.length ? "출발 순위·온도·습도·교체 횟수 조건을 만족하는 실제 전략이 없습니다. 조건을 바꾸면 다시 찾습니다."
    : matches.length < 3 ? `조건에 맞는 서로 다른 실제 전략은 ${matches.length}개입니다. 임의의 전략으로 3개를 채우지 않습니다.` : null;
  return { matches, circuitEvents: circuitEvents.length, weatherEvents: compatibleWeather.length, candidateCount: candidates.length, weatherKind, reason };
}

/** Explicit adaptation for simulation only. The source record is never mutated. */
export function importHistoricalStints(match: HistoricalMatch, targetLaps: number): StrategyStintInput[] | null {
  if (!match.importable || !Number.isInteger(targetLaps) || Math.abs(targetLaps - match.event.raceLaps) > MATCH_LIMITS.lapAdjustment || match.driver.stints.at(-1)!.startLap > targetLaps) return null;
  return match.driver.stints.map((stint, index) => ({ compound: stint.compound, startLap: stint.startLap, endLap: index === match.driver.stints.length - 1 ? targetLaps : stint.endLap }));
}
