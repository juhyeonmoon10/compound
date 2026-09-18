import { F1_CAR_LENGTH_METERS, F1_CAR_WIDTH_METERS, GRID_LANE_OFFSET_METERS, startGridVisualOffsetMeters } from "./race-scene-dimensions.ts";

/** Track-relative educational collision model, not rigid-body F1 physics. */
export const COLLISION_MODEL = Object.freeze({
  length: F1_CAR_LENGTH_METERS + 0.25, width: F1_CAR_WIDTH_METERS + 0.12,
  laneSpeed: 1.8, laneLimit: 4.5, lookAhead: 35, cooldownSeconds: 8,
  brakingSeconds: 2, brakingFactor: 0.45, yellowSeconds: 12, minimumImpactMps: 1.5,
});
export interface CollisionOptions { readonly enabled: boolean; readonly circuitLengthMeters: number }
export interface CollisionBody {
  id: string; previous: number; next: number; lane: number; nextLane: number;
  active: boolean; canChangeLane: boolean;
}
export interface CollisionContact { rearId: string; frontId: string; closingSpeedMps: number }
export interface RaceCollision extends CollisionContact { id: string; time: number; lap: number; sector: number }
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
export const wrappedSeparation = (a: number, b: number, length: number) => ((a - b + length / 2) % length + length) % length - length / 2;

export function collisionTrackMeters(gridPosition: number, distanceLaps: number, length: number): number {
  return distanceLaps * length - startGridVisualOffsetMeters(gridPosition, distanceLaps, length);
}
/** Inverts the same monotone grid-release mapping used by the renderer. */
export function collisionRaceDistance(gridPosition: number, meters: number, length: number, low: number, high: number): number {
  for (let i = 0; i < 32; i++) {
    const mid = (low + high) / 2;
    if (collisionTrackMeters(gridPosition, mid, length) <= meters) low = mid; else high = mid;
  }
  return low;
}
export function initialCollisionLane(gridPosition: number): number { return (gridPosition % 2 ? 1 : -1) * GRID_LANE_OFFSET_METERS; }

/** Continuous relative AABB test: fast cars cannot tunnel through each other between samples. */
export function sweptCarContact(a: CollisionBody, b: CollisionBody, length: number): number | null {
  if (!a.active || !b.active) return null;
  let enter = 0, leave = 1;
  const axes = [
    [wrappedSeparation(a.previous, b.previous, length), (a.next - a.previous) - (b.next - b.previous), COLLISION_MODEL.length],
    [a.lane - b.lane, (a.nextLane - a.lane) - (b.nextLane - b.lane), COLLISION_MODEL.width],
  ];
  for (const [start, velocity, extent] of axes) {
    if (Math.abs(velocity) < 1e-9) { if (Math.abs(start) >= extent) return null; continue; }
    const t0 = (-extent - start) / velocity, t1 = (extent - start) / velocity;
    enter = Math.max(enter, Math.min(t0, t1)); leave = Math.min(leave, Math.max(t0, t1));
    if (enter > leave) return null;
  }
  return leave < 0 || enter > 1 ? null : clamp(enter, 0, 1);
}

export function solveCollisionStep(input: readonly CollisionBody[], length: number, dt: number) {
  if (!Number.isFinite(length) || length <= 100 || !Number.isFinite(dt) || dt <= 0) throw new RangeError("Invalid collision geometry or timestep");
  const bodies = input.map(body => ({ ...body })).sort((a, b) => a.id.localeCompare(b.id));
  const contacts: CollisionContact[] = [];
  for (const body of bodies) {
    if (!body.active) continue;
    body.nextLane = clamp(body.nextLane, -COLLISION_MODEL.laneLimit, COLLISION_MODEL.laneLimit);
    const obstacle = bodies.filter(other => other.active && other.id !== body.id &&
      Math.abs(other.lane - body.lane) < COLLISION_MODEL.width &&
      wrappedSeparation(other.previous, body.previous, length) > 0 &&
      wrappedSeparation(other.previous, body.previous, length) < COLLISION_MODEL.lookAhead &&
      body.next - body.previous > other.next - other.previous + 0.03)
      .sort((a, b) => wrappedSeparation(a.previous, body.previous, length) - wrappedSeparation(b.previous, body.previous, length))[0];
    if (body.canChangeLane && obstacle) {
      const lanes = [-3.3, -1.08, 1.08, 3.3].sort((a, b) => Math.abs(a - body.lane) - Math.abs(b - body.lane));
      const free = lanes.find(lane => Math.abs(lane - obstacle.lane) > COLLISION_MODEL.width + 0.1 && !bodies.some(other => {
        if (!other.active || other.id === body.id) return false;
        const gap = wrappedSeparation(other.previous, body.previous, length);
        const crosses = other.lane > Math.min(lane, body.lane) - COLLISION_MODEL.width && other.lane < Math.max(lane, body.lane) + COLLISION_MODEL.width;
        return (crosses && Math.abs(gap) < COLLISION_MODEL.length + 0.5) ||
          (Math.abs(lane - other.lane) < COLLISION_MODEL.width && Math.abs(gap) < COLLISION_MODEL.lookAhead);
      }));
      if (free !== undefined) body.nextLane = body.lane + clamp(free - body.lane, -COLLISION_MODEL.laneSpeed * dt, COLLISION_MODEL.laneSpeed * dt);
    }
  }
  // Cascades use several monotone passes; only forward distance can be reduced.
  for (let pass = 0; pass < bodies.length; pass++) {
    let changed = false;
    for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j];
      const time = sweptCarContact(a, b, length);
      if (time === null) continue;
      const separation = wrappedSeparation(a.previous, b.previous, length);
      const rear = separation < 0 || (separation === 0 && a.id > b.id) ? a : b;
      const front = rear === a ? b : a;
      const closingSpeedMps = Math.max(0, (rear.next - rear.previous - (front.next - front.previous)) / dt);
      // Abort an unsafe sideways merge first. A clear adjacent lane remains a legal pass.
      if (Math.abs(a.lane - b.lane) >= COLLISION_MODEL.width) {
        a.nextLane = a.lane; b.nextLane = b.lane;
        changed = true;
        continue; // Prevented lane change, not an impact.
      } else {
        const gap = wrappedSeparation(front.previous, rear.previous, length);
        const maximum = rear.previous + gap + (front.next - front.previous) - COLLISION_MODEL.length - 0.01;
        const next = Math.max(rear.previous, Math.min(rear.next, maximum));
        if (next < rear.next - 1e-8) { rear.next = next; changed = true; }
      }
      if (Math.abs(separation) > COLLISION_MODEL.length + 0.15 && closingSpeedMps >= COLLISION_MODEL.minimumImpactMps && !contacts.some(contact => contact.rearId === rear.id && contact.frontId === front.id)) {
        contacts.push({ rearId: rear.id, frontId: front.id, closingSpeedMps });
      }
    }
    if (!changed) break;
  }
  return { bodies, contacts };
}
