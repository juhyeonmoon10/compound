import assert from "node:assert/strict";
import test from "node:test";
import { evaluateStrategy } from "../app/lib/strategy.ts";
import { createRaceGrid, raceGridFrameAt } from "../app/lib/race-grid.ts";
import { createVirtualRace, DEFAULT_INCIDENT_SETTINGS, INCIDENT_MODEL, validateIncidentSettings,
  virtualModelSecondsAt, virtualWallSecondsAt, virtualRaceFrameAt, virtualRaceControlAt, virtualPlayerEndSeconds } from "../app/lib/virtual-incidents.ts";

function grid(laps = 12) {
  const pit = Math.floor(laps / 2);
  const strategy = evaluateStrategy({ laps, pitLossSeconds: 20, stints: [
    { compound: "S", startLap: 1, endLap: pit }, { compound: "H", startLap: pit + 1, endLap: laps },
  ] });
  return createRaceGrid(Array.from({ length: 20 }, (_, i) => ({ id: `car-${i}`, label: `C${i}`,
    gridPosition: i + 1, pitGroup: `team-${Math.floor(i / 2)}`, strategy })));
}
const base = grid();
const settings = (extra = {}) => ({ ...DEFAULT_INCIDENT_SETTINGS, enabled: true, playerPercent: 100, othersPercent: 0, ...extra });
const at = (race, time, id = "car-9") => virtualRaceFrameAt(race, time).cars.find(car => car.id === id);

test("disabled and zero risk preserve the original replay exactly, without mutating inputs", () => {
  const original = JSON.stringify(base);
  for (const input of [settings({ enabled: false }), settings({ playerPercent: 0 })]) {
    const race = createVirtualRace(base, "car-9", input);
    assert.equal(race.incidents.length, 0);
    for (const time of [0, 35, 200, base.durationSeconds]) assert.deepEqual(virtualRaceFrameAt(race, time), raceGridFrameAt(base, time));
  }
  assert.equal(JSON.stringify(base), original);
});
test("player and other-driver probabilities have independent scope and 100% always triggers", () => {
  const selected = createVirtualRace(base, "car-9", settings({ response: "SC" }));
  assert.deepEqual(selected.incidents.map(event => event.driverId), ["car-9"]);
  const others = createVirtualRace(base, "car-9", settings({ playerPercent: 0, othersPercent: 100, response: "VSC" }));
  assert.equal(others.incidents.length, 19);
  assert.ok(others.incidents.every(event => event.driverId !== "car-9"));
  assert.equal(at(others, others.durationSeconds).completed, true);
});
test("seeded incidents are reproducible, independent of frame order and playback rate", () => {
  const input = settings({ othersPercent: 20 });
  const a = createVirtualRace(base, "car-9", input), b = createVirtualRace(base, "car-9", input);
  assert.deepEqual(a.incidents, b.incidents);
  for (const time of [800, 3, 650, 800, 0, a.durationSeconds]) assert.deepEqual(virtualRaceFrameAt(a, time), virtualRaceFrameAt(b, time));
  assert.notDeepEqual(a.incidents, createVirtualRace(base, "car-9", { ...input, seed: input.seed + 1 }).incidents);
  const reversed = createVirtualRace({ ...base, cars: [...base.cars].reverse() }, "car-9", input);
  assert.deepEqual([...a.incidents].sort((x, y) => x.id.localeCompare(y.id)), [...reversed.incidents].sort((x, y) => x.id.localeCompare(y.id)));
});
test("no future accident or final classification leaks into the starting grid", () => {
  const race = createVirtualRace(base, "car-9", settings({ response: "RED", othersPercent: 50 }));
  const frame = virtualRaceFrameAt(race, 0);
  assert.deepEqual(frame.cars.map(car => car.gridPosition), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.ok(frame.cars.every(car => !car.retired && !car.incidentStopped));
  assert.equal(virtualRaceControlAt(race, 0).flag, "GREEN");
});
test("yellow incident stops only the affected car, then recovers without DNF", () => {
  const race = createVirtualRace(base, "car-9", settings({ response: "YELLOW" }));
  const event = race.incidents[0];
  assert.equal(virtualRaceControlAt(race, event.startSeconds).flag, "YELLOW");
  assert.equal(at(race, event.startSeconds + 2).speedFactor, 0);
  assert.equal(at(race, event.startSeconds + 2).progressLaps, at(race, event.startSeconds + 8).progressLaps);
  assert.ok(at(race, event.startSeconds + INCIDENT_MODEL.recoverySeconds + 2).progressLaps > event.distance);
  assert.equal(at(race, race.durationSeconds).retired, false);
  assert.equal(at(race, race.durationSeconds).completed, true);
  assert.ok(at(race, race.durationSeconds).totalSeconds > base.cars[9].totalSeconds);
});
test("red freezes all movement and pit clocks, then SC restart and green resume", () => {
  const race = createVirtualRace(base, "car-9", settings({ response: "RED" }));
  const event = race.incidents[0];
  const a = virtualRaceFrameAt(race, event.startSeconds + 1), b = virtualRaceFrameAt(race, event.endSeconds - 1);
  for (const car of a.cars) {
    const other = b.cars.find(item => item.id === car.id);
    assert.equal(car.modelElapsedSeconds, other.modelElapsedSeconds);
    assert.equal(car.progressLaps, other.progressLaps);
    assert.equal(car.speedFactor, 0);
  }
  assert.equal(virtualRaceControlAt(race, event.endSeconds).flag, "SC");
  assert.equal(virtualRaceControlAt(race, event.endSeconds).restart, true);
  assert.equal(virtualRaceControlAt(race, event.restartEndSeconds).flag, "GREEN");
  assert.ok(at(race, event.endSeconds + 5, "car-0").progressLaps > at(race, event.endSeconds, "car-0").progressLaps);
});
test("SC and VSC actually slow the field and prevent on-track overtakes", () => {
  for (const response of ["SC", "VSC"]) {
    const race = createVirtualRace(base, "car-9", settings({ response }));
    const event = race.incidents[0];
    const before = virtualRaceFrameAt(race, event.startSeconds);
    const after = virtualRaceFrameAt(race, event.startSeconds + 10);
    const ids = before.cars.filter(car => !car.retired).map(car => car.id);
    assert.deepEqual(after.cars.filter(car => !car.retired).map(car => car.id), ids);
    assert.ok(after.cars.filter(car => !car.retired && !car.isPitting).every(car => car.speedFactor <= 0.7 + 1e-6));
    const initialSpread = before.cars[0].progressLaps - before.cars[18].progressLaps;
    const laterSpread = after.cars[0].progressLaps - after.cars[18].progressLaps;
    if (response === "VSC") assert.ok(Math.abs(initialSpread - laterSpread) < 0.005);
  }
});
test("DNF is not a finish, no future pit markers or laps are reachable after retirement", () => {
  const race = createVirtualRace(base, "car-9", settings({ response: "SC" }));
  const event = race.incidents[0];
  assert.equal(at(race, event.startSeconds - 0.01).retired, false);
  const retired = at(race, race.durationSeconds);
  assert.equal(retired.retired, true); assert.equal(retired.completed, false); assert.equal(retired.pitState, "retired");
  assert.equal(retired.progressLaps, event.distance); assert.equal(retired.speedFactor, 0);
  assert.equal(virtualWallSecondsAt(race, "car-9", base.cars[9].totalSeconds), null);
  assert.equal(virtualPlayerEndSeconds(race), event.startSeconds + 4);
  assert.equal(virtualRaceFrameAt(race, race.durationSeconds).cars.at(-1).id, "car-9");
});
test("all cars retiring terminates safely and sorts DNF by distance", () => {
  const race = createVirtualRace(base, "car-9", settings({ othersPercent: 100, response: "SC" }));
  assert.equal(race.incidents.length, 20);
  const frame = virtualRaceFrameAt(race, race.durationSeconds);
  assert.equal(frame.completed, true);
  assert.ok(frame.cars.every(car => car.retired && !car.completed));
  assert.ok(frame.cars.every((car, i) => !i || frame.cars[i - 1].progressLaps >= car.progressLaps));
});
test("flag precedence is RED > SC > VSC > YELLOW with correct end boundaries", () => {
  const incidents = ["YELLOW", "VSC", "SC", "RED"].map((flag, i) => ({ flag, startSeconds: 10 * i, endSeconds: 100 - 10 * i, restartEndSeconds: 100 - 10 * i }));
  for (const [time, flag] of [[0, "YELLOW"], [10, "VSC"], [20, "SC"], [30, "RED"], [70, "SC"], [80, "VSC"], [90, "YELLOW"], [100, "GREEN"]]) {
    assert.equal(virtualRaceControlAt({ incidents }, time).flag, flag);
  }
});
test("virtual timeline conversion round-trips pits and finishes; progress never reverses", () => {
  const race = createVirtualRace(base, "car-9", settings({ response: "RED" }));
  for (const car of base.cars.filter(item => item.id !== "car-9")) {
    for (const segment of car.replay.segments) {
      const wall = virtualWallSecondsAt(race, car.id, segment.startSeconds);
      assert.ok(Math.abs(virtualModelSecondsAt(race, car.id, wall) - segment.startSeconds) < 1e-5);
    }
    let last = 0;
    for (let wall = 0; wall < race.durationSeconds; wall += 13) {
      const next = virtualModelSecondsAt(race, car.id, wall);
      assert.ok(next >= last); last = next;
    }
  }
});
test("settings validation rejects malformed probabilities, seeds and flags", () => {
  for (const invalid of [{ playerPercent: NaN }, { othersPercent: 101 }, { playerPercent: -1 }, { seed: 2.5 }, { seed: -1 }, { seed: 2 ** 32 }, { response: "BLUE" }]) {
    assert.throws(() => validateIncidentSettings(settings(invalid)), RangeError);
  }
  assert.throws(() => createVirtualRace(base, "absent", settings()), RangeError);
  assert.throws(() => virtualRaceFrameAt(createVirtualRace(base, "car-9", settings()), NaN), RangeError);
});
