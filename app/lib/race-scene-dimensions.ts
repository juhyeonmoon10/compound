export interface PlanarPoint {
  readonly x: number;
  readonly y: number;
}

export const F1_CAR_WIDTH_METERS = 1.9;
export const F1_CAR_LENGTH_METERS = 5.6;
export const FIA_STANDARD_TRACK_WIDTH_METERS = 12;
export const FIA_START_GRID_WIDTH_METERS = 15;
export const FIA_GRID_SLOT_LENGTH_METERS = 8;
export const GRID_LANE_OFFSET_METERS = 2.35;
export const GRID_FRONT_OFFSET_METERS = 4;

const START_GRID_WIDE_BEFORE_METERS = 170;
const START_GRID_WIDE_AFTER_METERS = 250;
const START_GRID_WIDTH_TAPER_METERS = 40;
const START_GRID_RELEASE_METERS = 250;

function normalizeUnitProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return ((progress % 1) + 1) % 1;
}

function mix(start: number, end: number, amount: number): number {
  return start + (end - start) * Math.max(0, Math.min(1, amount));
}

export function closedPolylineLength(
  points: readonly PlanarPoint[],
): number {
  if (points.length < 2) return 0;

  let length = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    length += Math.hypot(next.x - current.x, next.y - current.y);
  }
  return length;
}

export function circuitScaleForPolyline(
  points: readonly PlanarPoint[],
  circuitLengthKm: number,
): number {
  const sourceLength = closedPolylineLength(points);
  const targetLength = circuitLengthKm * 1_000;
  if (
    !Number.isFinite(sourceLength) ||
    sourceLength <= 0 ||
    !Number.isFinite(targetLength) ||
    targetLength <= 0
  ) {
    return 1;
  }
  return targetLength / sourceLength;
}

export function trackHalfWidthMetersAt(
  progress: number,
  circuitLengthMeters: number,
): number {
  const normalHalfWidth = FIA_STANDARD_TRACK_WIDTH_METERS / 2;
  const startHalfWidth = FIA_START_GRID_WIDTH_METERS / 2;
  if (
    !Number.isFinite(circuitLengthMeters) ||
    circuitLengthMeters <=
      START_GRID_WIDE_BEFORE_METERS +
        START_GRID_WIDE_AFTER_METERS +
        START_GRID_WIDTH_TAPER_METERS * 2
  ) {
    return normalHalfWidth;
  }

  const distance =
    normalizeUnitProgress(progress) * circuitLengthMeters;
  if (
    distance <= START_GRID_WIDE_AFTER_METERS ||
    distance >=
      circuitLengthMeters - START_GRID_WIDE_BEFORE_METERS
  ) {
    return startHalfWidth;
  }

  if (
    distance <
    START_GRID_WIDE_AFTER_METERS + START_GRID_WIDTH_TAPER_METERS
  ) {
    return mix(
      startHalfWidth,
      normalHalfWidth,
      (distance - START_GRID_WIDE_AFTER_METERS) /
        START_GRID_WIDTH_TAPER_METERS,
    );
  }

  const wideningStart =
    circuitLengthMeters -
    START_GRID_WIDE_BEFORE_METERS -
    START_GRID_WIDTH_TAPER_METERS;
  if (distance > wideningStart) {
    return mix(
      normalHalfWidth,
      startHalfWidth,
      (distance - wideningStart) / START_GRID_WIDTH_TAPER_METERS,
    );
  }

  return normalHalfWidth;
}

export function gridSlotOffsetMeters(gridPosition: number): number {
  const position = Number.isFinite(gridPosition)
    ? Math.max(1, Math.floor(gridPosition))
    : 1;
  return (position - 1) * FIA_GRID_SLOT_LENGTH_METERS;
}

export function startGridVisualOffsetMeters(
  gridPosition: number,
  progressLaps: number,
  circuitLengthMeters: number,
): number {
  if (
    !Number.isFinite(circuitLengthMeters) ||
    circuitLengthMeters <= 0
  ) {
    return 0;
  }
  const distanceTravelled = Math.max(0, progressLaps) *
    circuitLengthMeters;
  const blend = Math.max(
    0,
    Math.min(1, 1 - distanceTravelled / START_GRID_RELEASE_METERS),
  );
  return (
    (GRID_FRONT_OFFSET_METERS +
      gridSlotOffsetMeters(gridPosition)) *
    blend
  );
}
