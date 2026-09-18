import type { Compound } from "./strategy.ts";
import { elapsedAtRaceDistance } from "./strategy-race.ts";
import { virtualModelSecondsAt, virtualRaceFrameAt, virtualWallSecondsAt, type VirtualRace } from "./virtual-incidents.ts";

export interface RaceResultStint { compound: Compound; startLap: number; endLap: number; distanceLaps: number }
export interface RaceResultRow {
  id: string; label: string; position: number; gridPosition: number; positionChange: number | null;
  retired: boolean; completedLaps: number; finishSeconds: number | null; gapSeconds: number | null;
  stops: number; pitLaps: number[]; stints: RaceResultStint[]; contacts: number;
  fastestLap: { lap: number; seconds: number } | null;
}

/** End-of-simulation statistics from the same clocks as the replay, never from planned-but-unrun laps. */
export function buildRaceClassification(race: VirtualRace) {
  const final = virtualRaceFrameAt(race, race.durationSeconds);
  const winner = final.cars.find(car => car.completed && !car.retired);
  const rows: RaceResultRow[] = final.cars.map(frame => {
    const car = race.grid.cars.find(entry => entry.id === frame.id)!;
    const modelEnd = virtualModelSecondsAt(race, car.id, race.durationSeconds);
    const completedLaps = Math.min(race.grid.totalLaps, Math.floor(frame.progressLaps + 1e-7));
    const pits = car.replay.segments.filter(segment => segment.kind === "pit-loss" && segment.endSeconds <= modelEnd + 1e-7);
    let fastestLap: RaceResultRow["fastestLap"] = null;
    for (let lap = 1; lap <= completedLaps; lap++) {
      const start = virtualWallSecondsAt(race, car.id, elapsedAtRaceDistance(car.replay.strategy, lap - 1));
      const end = virtualWallSecondsAt(race, car.id, elapsedAtRaceDistance(car.replay.strategy, lap));
      if (start === null || end === null || end <= start) continue;
      const seconds = end - start;
      if (!fastestLap || seconds < fastestLap.seconds) fastestLap = { lap, seconds };
    }
    return {
      id: car.id, label: car.label, position: frame.position, gridPosition: car.gridPosition,
      positionChange: frame.retired ? null : car.gridPosition - frame.position, retired: !!frame.retired,
      completedLaps, finishSeconds: frame.completed ? frame.totalSeconds : null,
      gapSeconds: frame.completed && winner ? Math.max(0, frame.totalSeconds - winner.totalSeconds) : null,
      stops: pits.length, pitLaps: pits.map(segment => segment.kind === "pit-loss" ? segment.pitAfterLap : 0),
      stints: car.strategy.stints.flatMap(stint => {
        const end = Math.min(stint.endLap, frame.progressLaps), distanceLaps = end - (stint.startLap - 1);
        return distanceLaps > 1e-7 ? [{ compound: stint.compound, startLap: stint.startLap, endLap: Math.ceil(end), distanceLaps }] : [];
      }),
      contacts: race.collisions.filter(event => event.frontId === car.id || event.rearId === car.id).length,
      fastestLap,
    };
  });
  const fastest = rows.filter(row => row.fastestLap).sort((a, b) => a.fastestLap!.seconds - b.fastestLap!.seconds || a.position - b.position)[0] ?? null;
  return { rows, podium: rows.filter(row => !row.retired && row.finishSeconds !== null).slice(0, 3), fastest,
    finishers: rows.filter(row => row.finishSeconds !== null).length,
    totalStops: rows.reduce((sum, row) => sum + row.stops, 0), totalContacts: race.collisions.length };
}
