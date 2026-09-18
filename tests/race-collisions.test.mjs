import assert from "node:assert/strict";
import test from "node:test";
import { COLLISION_MODEL, collisionTrackMeters, collisionRaceDistance, solveCollisionStep, sweptCarContact, wrappedSeparation } from "../app/lib/race-collisions.ts";
import { createRaceGrid, raceGridFrameAt } from "../app/lib/race-grid.ts";
import { evaluateStrategy } from "../app/lib/strategy.ts";
import { createVirtualRace, DEFAULT_INCIDENT_SETTINGS, virtualRaceFrameAt, virtualRaceControlAt, virtualPlayerEndSeconds } from "../app/lib/virtual-incidents.ts";

const body = (id, previous, next, lane = 0, extra = {}) => ({ id, previous, next, lane, nextLane: lane, active: true, canChangeLane: false, ...extra });
const length = 5300;

test("continuous detection prevents tunnelling, includes lapped traffic and leaves adjacent/pit cars alone", () => {
  for (const offset of [0, length]) {
    const rear = body("rear", offset, offset + 80), front = body("front", 20, 30);
    assert.ok(sweptCarContact(rear, front, length) !== null);
    const solved = solveCollisionStep([rear, front], length, 0.5);
    const r = solved.bodies.find(car => car.id === "rear"), f = solved.bodies.find(car => car.id === "front");
    assert.ok(wrappedSeparation(f.next, r.next, length) >= COLLISION_MODEL.length);
    assert.equal(solved.contacts.length, 1);
  }
  assert.equal(sweptCarContact(body("a", 0, 80, -2), body("b", 20, 30, 2), length), null);
  assert.equal(sweptCarContact(body("a", 0, 80), body("b", 20, 30, 0, { active: false }), length), null);
});

test("queue corrections cascade without reversing cars or mutating input; unsafe merges are avoided, not logged as impacts", () => {
  const input = [body("a", 0, 60), body("b", 10, 50), body("c", 20, 25)];
  const before = JSON.stringify(input), result = solveCollisionStep(input, length, 0.5);
  assert.equal(JSON.stringify(input), before);
  for (let i = 0; i < 2; i++) assert.ok(result.bodies[i + 1].next - result.bodies[i].next >= COLLISION_MODEL.length);
  assert.ok(result.bodies.every(car => car.next >= car.previous));
  const merging = solveCollisionStep([body("a", 0, 20, -2, { nextLane: 0 }), body("b", 4, 10, 2, { nextLane: 0 })], length, 0.5);
  assert.equal(merging.contacts.length, 0);
  assert.equal(sweptCarContact(...merging.bodies, length), null);
});

test("a faster car moves toward clear space; grid-release mapping round trips", () => {
  const result = solveCollisionStep([body("a", 0, 20, 2.35, { canChangeLane: true }), body("b", 15, 30, 2.35)], length, 0.5);
  assert.ok(result.bodies[0].nextLane < 2.35);
  for (const position of [1, 10, 20]) for (const distance of [0.001, 0.04, 0.2, 5.1]) {
    const meters = collisionTrackMeters(position, distance, length);
    assert.ok(Math.abs(collisionRaceDistance(position, meters, length, 0, 6) - distance) < 1e-8);
  }
});

const laps = 6;
const strategy = evaluateStrategy({ laps, pitLossSeconds: 20, stints: [{ compound: "S", startLap: 1, endLap: 3 }, { compound: "H", startLap: 4, endLap: laps }] });
const grid = createRaceGrid(Array.from({ length: 20 }, (_, i) => ({ id: `c${String(i).padStart(2, "0")}`, label: `C${i}`, gridPosition: i + 1, pitGroup: `t${i}`, strategy })));
const options = { enabled: true, circuitLengthMeters: length };
const race = createVirtualRace(grid, "c09", DEFAULT_INCIDENT_SETTINGS, options);

test("collision replay is repeatable, costs time, reports yellow/contact feedback and preserves source strategy", () => {
  const baseline = JSON.stringify(grid);
  const again = createVirtualRace({ ...grid, cars: [...grid.cars].reverse() }, "c09", DEFAULT_INCIDENT_SETTINGS, options);
  assert.deepEqual(again.collisions, race.collisions);
  for (const time of [0, 300, 10, 300, race.durationSeconds]) assert.deepEqual(virtualRaceFrameAt(race, time), virtualRaceFrameAt(again, time));
  assert.equal(JSON.stringify(grid), baseline);
  assert.ok(race.collisions.length > 0);
  const event = race.collisions[0];
  assert.equal(virtualRaceControlAt(race, event.time).flag, "YELLOW");
  assert.ok(virtualRaceFrameAt(race, event.time).cars.find(car => car.id === event.rearId).contactPulse > 0);
  assert.ok(virtualRaceFrameAt(race, race.durationSeconds).cars.every(car => car.completed && !car.retired));
  assert.ok(virtualPlayerEndSeconds(race) > grid.cars[9].totalSeconds);
  assert.equal(virtualRaceControlAt(race, 0).flag, "GREEN");
});

test("every sampled on-track pair remains separated, including start, pit exits and interpolated frames", () => {
  const previous = new Map();
  for (let time = 0; time < race.durationSeconds; time += 0.25) {
    const cars = virtualRaceFrameAt(race, time).cars;
    for (const car of cars) {
      assert.ok(car.progressLaps >= (previous.get(car.id) ?? 0), `${car.id} reversed at ${time}`);
      previous.set(car.id, car.progressLaps);
    }
    const active = cars.filter(car => !car.isPitting && !car.completed && !car.retired && !car.incidentStopped && Math.abs(car.lateralOffsetMeters) <= COLLISION_MODEL.laneLimit);
    for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
      const a = active[i], b = active[j];
      const gap = Math.abs(wrappedSeparation(collisionTrackMeters(a.gridPosition, a.progressLaps, length), collisionTrackMeters(b.gridPosition, b.progressLaps, length), length));
      assert.ok(gap >= COLLISION_MODEL.length - 0.025 || Math.abs(a.lateralOffsetMeters - b.lateralOffsetMeters) >= COLLISION_MODEL.width - 0.001,
        `overlap ${a.id}/${b.id} at ${time}: ${gap}m, lateral ${Math.abs(a.lateralOffsetMeters - b.lateralOffsetMeters)}`);
    }
  }
});

test("collision OFF restores the original race and malformed circuit lengths are rejected", () => {
  const off = createVirtualRace(grid, "c09", DEFAULT_INCIDENT_SETTINGS, { ...options, enabled: false });
  assert.deepEqual(virtualRaceFrameAt(off, 100), raceGridFrameAt(grid, 100));
  for (const circuitLengthMeters of [NaN, 0, -20]) assert.throws(() => createVirtualRace(grid, "c09", DEFAULT_INCIDENT_SETTINGS, { ...options, circuitLengthMeters }), RangeError);
});

test("collision processing coexists with RED suspension and pit/recovery clocks", () => {
  const red = createVirtualRace(grid, "c09", { ...DEFAULT_INCIDENT_SETTINGS, enabled: true, playerPercent: 100, response: "RED", othersPercent: 0 }, options);
  const event = red.incidents.find(item => item.kind !== "collision");
  const a = virtualRaceFrameAt(red, event.startSeconds + 1), b = virtualRaceFrameAt(red, event.endSeconds - 1);
  for (const car of a.cars) {
    const other = b.cars.find(item => item.id === car.id);
    assert.equal(car.progressLaps, other.progressLaps);
    assert.equal(car.lateralOffsetMeters, other.lateralOffsetMeters);
    assert.equal(car.speedFactor, 0);
  }
  assert.equal(red.collisions.some(item => item.time > event.startSeconds && item.time < event.endSeconds), false);
});
