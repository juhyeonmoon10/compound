import { raceGridFrameAt, type RaceGrid, type RaceGridCar, type RaceGridFrame, type RaceGridCarFrame } from "./race-grid.ts";
import { replayFrameAt, type ReplaySegment } from "./race-replay.ts";
import { elapsedAtRaceDistance, raceDistanceAtFrame } from "./strategy-race.ts";

export type IncidentFlag = "YELLOW" | "VSC" | "SC" | "RED";
export interface IncidentSettings {
  readonly enabled: boolean;
  /** Probability per driver per race, NOT per lap or animation frame. */
  readonly playerPercent: number;
  readonly othersPercent: number;
  readonly seed: number;
  readonly response: "auto" | IncidentFlag;
}
export const DEFAULT_INCIDENT_SETTINGS: IncidentSettings = Object.freeze({
  enabled: false, playerPercent: 5, othersPercent: 3, seed: 20260918, response: "auto",
});
export const INCIDENT_RULES_SOURCE = "https://www.fia.com/system/files/documents/fia_2026_f1_regulations_-_section_b_sporting_-_iss_08_-_2026-08-05_7.pdf";
export const FLAG_LABELS = { GREEN: "그린 · 정상 주행", YELLOW: "옐로우 · 구간 감속", VSC: "VSC · 전 구간 감속", SC: "SC · 세이프티 카", RED: "레드 · 레이스 중단" } as const;
/** Educational assumptions, not FIA prescribed speeds/durations or measured risks. */
export const INCIDENT_MODEL = Object.freeze({ stepSeconds: 0.5, yellowSeconds: 30, vscSeconds: 60, scSeconds: 150,
  redSeconds: 90, restartSeconds: 60, recoverySeconds: 12, yellowFactor: 0.65, vscFactor: 0.7,
  scLeaderFactor: 0.45, scCatchupFactor: 0.65, scGapLaps: 0.006 });
export interface VirtualIncident {
  readonly id: string; readonly driverId: string; readonly label: string;
  readonly flag: IncidentFlag; readonly startSeconds: number; readonly endSeconds: number;
  readonly restartEndSeconds: number; readonly distance: number; readonly lap: number;
  readonly sector: number; readonly retired: boolean;
}
export interface VirtualRaceControl {
  readonly flag: IncidentFlag | "GREEN";
  readonly remainingSeconds: number;
  readonly incidents: readonly VirtualIncident[];
  readonly restart: boolean;
}
interface CarClock {
  readonly car: RaceGridCar;
  readonly samples: Float64Array;
  readonly finishSeconds: number | null;
  readonly incident?: VirtualIncident;
}
export interface VirtualRace {
  readonly grid: RaceGrid; readonly settings: IncidentSettings; readonly playerId: string;
  readonly durationSeconds: number; readonly incidents: readonly VirtualIncident[];
  readonly clocks: readonly CarClock[];
}
function random(seed: number, key: string): number {
  let hash = seed >>> 0;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x21f0aaad);
  hash = Math.imul(hash ^ (hash >>> 15), 0x735a2d97);
  return ((hash ^ (hash >>> 15)) >>> 0) / 4294967296;
}
export function validateIncidentSettings(settings: IncidentSettings): void {
  if (typeof settings.enabled !== "boolean" || !Number.isInteger(settings.seed) || settings.seed < 0 || settings.seed > 0xffffffff ||
      !["auto", "YELLOW", "VSC", "SC", "RED"].includes(settings.response) ||
      [settings.playerPercent, settings.othersPercent].some(p => !Number.isFinite(p) || p < 0 || p > 100)) {
    throw new RangeError("Accident settings require 0–100% per-race probabilities and an unsigned 32-bit seed.");
  }
}
function segmentAt(car: RaceGridCar, seconds: number): ReplaySegment {
  const segments = car.replay.segments;
  let low = 0, high = segments.length - 1;
  while (low < high) { const mid = (low + high) >>> 1; if (seconds < segments[mid].endSeconds) high = mid; else low = mid + 1; }
  return segments[low];
}
function distanceAt(car: RaceGridCar, seconds: number): number {
  if (seconds >= car.totalSeconds) return car.lapTimings.length;
  const segment = segmentAt(car, seconds);
  return segment.kind === "pit-loss" ? segment.beforeLap - 1
    : segment.lap - 1 + Math.max(0, (seconds - segment.startSeconds) / segment.modelSeconds);
}
function sectorAt(distance: number): number { return Math.min(3, Math.floor((distance % 1) * 3) + 1); }

export function virtualRaceControlAt(race: Pick<VirtualRace, "incidents">, seconds: number): VirtualRaceControl {
  const incidents = race.incidents.filter(event => seconds >= event.startSeconds && seconds < event.restartEndSeconds);
  const rank = { GREEN: 0, YELLOW: 1, VSC: 2, SC: 3, RED: 4 };
  let flag: VirtualRaceControl["flag"] = "GREEN", end = seconds, restart = false;
  for (const event of incidents) {
    const restarting = event.flag === "RED" && seconds >= event.endSeconds;
    const next = restarting ? "SC" : event.flag;
    if (rank[next] > rank[flag]) { flag = next; end = restarting ? event.restartEndSeconds : event.endSeconds; restart = restarting; }
    else if (next === flag) { end = Math.max(end, restarting ? event.restartEndSeconds : event.endSeconds); restart ||= restarting; }
  }
  return { flag, remainingSeconds: Math.max(0, end - seconds), incidents, restart };
}

/** Precompute once, independently of rendering, seeking and playback speed. Never changes the DP or historical data. */
export function createVirtualRace(grid: RaceGrid, playerId: string, settings: IncidentSettings): VirtualRace {
  validateIncidentSettings(settings);
  if (!grid.cars.some(car => car.id === playerId)) throw new RangeError("Unknown selected driver.");
  const plans = new Map(grid.cars.flatMap(car => {
    const probability = (car.id === playerId ? settings.playerPercent : settings.othersPercent) / 100;
    if (!settings.enabled || random(settings.seed, `${car.id}:occurrence`) >= probability) return [];
    const severity = random(settings.seed, `${car.id}:severity`);
    const flag: IncidentFlag = settings.response !== "auto" ? settings.response : severity < 0.45 ? "YELLOW" : severity < 0.7 ? "VSC" : severity < 0.95 ? "SC" : "RED";
    const distance = grid.totalLaps * (0.04 + 0.90 * random(settings.seed, `${car.id}:distance`));
    return [[car.id, { flag, modelSeconds: elapsedAtRaceDistance(car.replay.strategy, distance) }] as const];
  }));
  // Exact compatibility, no discretisation when no incidents were drawn.
  if (plans.size === 0) return { grid, playerId, settings: { ...settings }, durationSeconds: grid.durationSeconds, incidents: [], clocks: [] };
  const cars = grid.cars.map(car => ({ car, time: 0, samples: [0], finishSeconds: null as number | null,
    incident: undefined as VirtualIncident | undefined }));
  const incidents: VirtualIncident[] = [];
  const dt = INCIDENT_MODEL.stepSeconds;
  // Bounded even at 100% risk: one incident per car, finite suspensions and min SC pace.
  const limit = Math.ceil(grid.durationSeconds / INCIDENT_MODEL.scLeaderFactor + cars.length * 400 + 100);
  let wall = 0;
  while (wall < limit) {
    // Trigger only when this car reaches its own sampled on-track position, never during a red suspension.
    if (virtualRaceControlAt({ incidents }, wall).flag !== "RED") {
      for (const state of cars) {
        const plan = plans.get(state.car.id);
        if (!plan || state.incident || state.time < plan.modelSeconds || state.finishSeconds !== null) continue;
        const distance = distanceAt(state.car, state.time);
        const duration = plan.flag === "YELLOW" ? INCIDENT_MODEL.yellowSeconds : plan.flag === "VSC" ? INCIDENT_MODEL.vscSeconds : plan.flag === "SC" ? INCIDENT_MODEL.scSeconds : INCIDENT_MODEL.redSeconds;
        const incident: VirtualIncident = { id: `${settings.seed}:${state.car.id}`, driverId: state.car.id, label: state.car.label,
          flag: plan.flag, startSeconds: wall, endSeconds: wall + duration,
          restartEndSeconds: wall + duration + (plan.flag === "RED" ? INCIDENT_MODEL.restartSeconds : 0),
          distance, lap: Math.floor(distance) + 1, sector: sectorAt(distance), retired: plan.flag !== "YELLOW" };
        state.incident = incident;
        incidents.push(incident);
      }
    }
    const control = virtualRaceControlAt({ incidents }, wall);
    const order = [...cars].sort((a, b) => distanceAt(b.car, b.time) - distanceAt(a.car, a.time) || a.car.gridPosition - b.car.gridPosition);
    let ahead: { distance: number; sector: number } | undefined;
    for (const state of order) {
      const stopped = state.incident && (state.incident.retired || wall < state.incident.startSeconds + INCIDENT_MODEL.recoverySeconds);
      if (state.finishSeconds !== null || stopped) continue;
      const previousDistance = distanceAt(state.car, state.time);
      const sector = sectorAt(previousDistance);
      const pit = segmentAt(state.car, state.time).kind === "pit-loss";
      const yellow = control.incidents.some(event => event.flag === "YELLOW" && event.sector === sector && wall < event.endSeconds);
      const factor = control.flag === "RED" ? 0 : pit ? 1 : control.flag === "SC" ? (ahead ? INCIDENT_MODEL.scCatchupFactor : INCIDENT_MODEL.scLeaderFactor)
        : control.flag === "VSC" ? INCIDENT_MODEL.vscFactor : yellow ? INCIDENT_MODEL.yellowFactor : 1;
      let next = Math.min(state.car.totalSeconds, state.time + dt * factor);
      const nextPit = segmentAt(state.car, next).kind === "pit-loss";
      const noOvertake = control.flag === "SC" || control.flag === "VSC" || (yellow && ahead?.sector === sector);
      // Pit lane and visibly stopped cars are exempt. Cars never teleport backwards to form the SC queue.
      if (ahead && noOvertake && !pit && !nextPit && factor > 0) {
        const gap = control.flag === "SC" ? INCIDENT_MODEL.scGapLaps : 0.000001;
        const maxDistance = Math.max(previousDistance, ahead.distance - gap);
        if (distanceAt(state.car, next) > maxDistance) next = Math.max(state.time, elapsedAtRaceDistance(state.car.replay.strategy, maxDistance));
      }
      if (next >= state.car.totalSeconds) {
        state.finishSeconds = wall + (factor > 0 ? (state.car.totalSeconds - state.time) / factor : dt);
      }
      state.time = next;
      if (!pit && !nextPit) ahead = { distance: distanceAt(state.car, next), sector };
    }
    wall += dt;
    for (const state of cars) state.samples.push(state.time);
    if (cars.every(state => state.finishSeconds !== null || state.incident?.retired)) break;
  }
  if (wall >= limit) throw new Error("Virtual race exceeded the bounded simulation horizon.");
  return { grid, playerId, settings: { ...settings }, durationSeconds: wall, incidents,
    clocks: cars.map(state => ({ car: state.car, samples: Float64Array.from(state.samples), finishSeconds: state.finishSeconds, incident: state.incident })) };
}

export function virtualModelSecondsAt(race: VirtualRace, carId: string, seconds: number): number {
  if (!Number.isFinite(seconds)) throw new RangeError("Race time must be finite.");
  const clock = race.clocks.find(item => item.car.id === carId);
  if (!clock) return Math.max(0, Math.min(race.grid.cars.find(car => car.id === carId)?.totalSeconds ?? 0, seconds));
  if (clock.finishSeconds !== null && seconds >= clock.finishSeconds) return clock.car.totalSeconds;
  const sample = Math.max(0, Math.min(seconds, race.durationSeconds)) / INCIDENT_MODEL.stepSeconds;
  const index = Math.min(Math.floor(sample), clock.samples.length - 1);
  return clock.samples[index] + ((clock.samples[index + 1] ?? clock.samples[index]) - clock.samples[index]) * (sample - index);
}
/** First wall-clock time at which a base replay timestamp was reached; null after retirement. */
export function virtualWallSecondsAt(race: VirtualRace, carId: string, modelSeconds: number): number | null {
  const clock = race.clocks.find(item => item.car.id === carId);
  if (!clock) return modelSeconds;
  if (modelSeconds > clock.samples[clock.samples.length - 1] + 1e-8) return null;
  if (modelSeconds <= 0) return 0;
  if (modelSeconds >= clock.car.totalSeconds && clock.finishSeconds !== null) return clock.finishSeconds;
  let low = 0, high = clock.samples.length - 1;
  while (low < high) { const mid = (low + high) >>> 1; if (clock.samples[mid] >= modelSeconds) high = mid; else low = mid + 1; }
  const previous = clock.samples[Math.max(0, low - 1)], current = clock.samples[low];
  return (Math.max(0, low - 1) + (current > previous ? (modelSeconds - previous) / (current - previous) : 0)) * INCIDENT_MODEL.stepSeconds;
}
export function virtualPlayerEndSeconds(race: VirtualRace): number {
  const clock = race.clocks.find(item => item.car.id === race.playerId);
  return clock ? clock.incident?.retired ? Math.min(race.durationSeconds, clock.incident.startSeconds + 4) : clock.finishSeconds ?? race.durationSeconds
    : race.grid.cars.find(car => car.id === race.playerId)!.totalSeconds;
}
export function virtualRaceFrameAt(race: VirtualRace, requestedSeconds: number): RaceGridFrame {
  if (!Number.isFinite(requestedSeconds)) throw new RangeError("Race time must be finite.");
  if (!race.clocks.length) return raceGridFrameAt(race.grid, requestedSeconds);
  const seconds = Math.max(0, Math.min(requestedSeconds, race.durationSeconds));
  const cars = race.clocks.map((clock): RaceGridCarFrame => {
    const modelSeconds = virtualModelSecondsAt(race, clock.car.id, seconds);
    const frame = replayFrameAt(clock.car.replay.strategy, clock.car.replay.segments, modelSeconds);
    const event = clock.incident;
    const affected = event !== undefined && seconds >= event.startSeconds;
    const retired = affected && event.retired;
    const incidentStopped = affected && (retired || seconds < event.startSeconds + INCIDENT_MODEL.recoverySeconds);
    const sampleIndex = Math.min(Math.floor(seconds / INCIDENT_MODEL.stepSeconds), clock.samples.length - 2);
    const speedFactor = retired || incidentStopped || frame.completed ? 0
      : (clock.samples[sampleIndex + 1] - clock.samples[sampleIndex]) / INCIDENT_MODEL.stepSeconds;
    return { id: clock.car.id, label: clock.car.label, gridPosition: clock.car.gridPosition, position: 0, gapToLeaderSeconds: 0,
      elapsedSeconds: seconds, totalSeconds: clock.finishSeconds ?? race.durationSeconds, progressLaps: raceDistanceAtFrame(frame),
      lap: frame.lap, lapProgress: frame.lapProgress, compound: frame.compound, tyreAge: frame.tyreAge,
      pitState: retired ? "retired" : frame.completed ? "finished" : frame.isPitting ? "pit" : "track",
      isPitting: !retired && frame.isPitting, completed: frame.completed && !retired, retired, incidentStopped,
      modelElapsedSeconds: modelSeconds, speedFactor };
  });
  cars.sort((a, b) => Number(!!a.retired) - Number(!!b.retired) || b.progressLaps - a.progressLaps ||
    (a.completed && b.completed ? a.totalSeconds - b.totalSeconds : 0) || a.gridPosition - b.gridPosition);
  const leader = cars[0];
  return { elapsedSeconds: seconds, durationSeconds: race.durationSeconds, completed: seconds >= race.durationSeconds,
    cars: cars.map((car, index) => {
      const leaderCar = race.grid.cars.find(item => item.id === leader.id)!;
      const crossed = virtualWallSecondsAt(race, leader.id, elapsedAtRaceDistance(leaderCar.replay.strategy, car.progressLaps));
      return { ...car, position: index + 1, gapToLeaderSeconds: index === 0 ? 0 : Math.max(0, (car.completed ? car.totalSeconds : seconds) - (crossed ?? seconds)) };
    }) };
}
