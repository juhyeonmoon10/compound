import type { RaceGridCar, RaceGridCarFrame } from "./race-grid";

export const PLAYBACK_RATES = [1, 10, 30, 60] as const;
export const CAMERA_MODES = [
  { id: "map", label: "지도", description: "서킷 전체 지도" },
  { id: "chase", label: "추적", description: "차량 뒤 3인칭 모델 시점" },
  { id: "cockpit", label: "운전석", description: "운전석 1인칭 모델 시점" },
  { id: "broadcast", label: "중계", description: "서킷 옆 중계 카메라" },
] as const;
export type ReplayCamera = typeof CAMERA_MODES[number]["id"];
export type ReplayPhase = "ready" | "countdown" | "running" | "paused" | "finished" | "results";

export function replayActionLabel(phase: ReplayPhase): string {
  return phase === "ready" ? "시작" : phase === "running" || phase === "countdown"
    ? "일시정지" : phase === "finished" || phase === "results" ? "다시 시작" : "계속";
}

export function nextReplayCamera(current: ReplayCamera, reducedMotion: boolean): ReplayCamera {
  return reducedMotion ? "map" : CAMERA_MODES[(CAMERA_MODES.findIndex(item => item.id === current) + 1) % CAMERA_MODES.length].id;
}

export function replayShortcut(input: {
  code: string; inReplay: boolean; interactive: boolean; repeat?: boolean; isComposing?: boolean;
  altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; dialogOpen?: boolean;
}): "play" | "camera" | "fullscreen" | null {
  if (!input.inReplay || input.interactive || input.dialogOpen || input.repeat || input.isComposing ||
    input.altKey || input.ctrlKey || input.metaKey || input.shiftKey) return null;
  return input.code === "Space" ? "play" : input.code === "KeyC" ? "camera" : input.code === "KeyF" ? "fullscreen" : null;
}

export function canHideReplayControls(phase: ReplayPhase, focused: boolean, confirmation: boolean): boolean {
  return phase === "running" && !focused && !confirmation;
}

/** Canceled countdown timers cannot resume; completed races retain their results. */
export function phaseAfterResetCancel(previous: ReplayPhase, canResume: boolean): ReplayPhase {
  if (previous === "finished") return "results";
  if (previous === "countdown" || (previous === "running" && !canResume)) return "paused";
  return previous;
}

/** Always retain the player's row, even at P20; row order remains race order. */
export function nearbyReplayCars(cars: readonly RaceGridCarFrame[], playerId: string): readonly RaceGridCarFrame[] {
  const index = cars.findIndex(car => car.id === playerId);
  if (index < 0) return cars.slice(0, 3);
  const start = Math.max(0, Math.min(index - 1, cars.length - 3));
  return cars.slice(start, start + 3);
}

/** Use the grid-adjusted clock, not the standalone tyre strategy clock. */
export function replayLapSeconds(car: RaceGridCar, lap: number): number {
  if (!Number.isFinite(lap) || lap <= 1) return 0;
  const target = Math.floor(lap);
  const segment = car.replay.segments.find(item => item.kind === "track" && item.lap === target);
  return segment?.startSeconds ?? car.totalSeconds;
}

export function clampReplaySeconds(seconds: number, total: number): number {
  return Number.isFinite(seconds) ? Math.max(0, Math.min(total, seconds)) : 0;
}
