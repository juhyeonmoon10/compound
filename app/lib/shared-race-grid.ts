import { TEAM_PROFILES, type TeamId, type TeamProfile, type DriverProfile } from "./participants.ts";
import { resolveEntryPerformance } from "./entry-performance.ts";
import { createRaceGrid, relativeEntryModelAdjustment, DEFAULT_RACE_GRID_PARAMETERS, RACE_GRID_SIZE, type RaceGridEntry } from "./race-grid.ts";
import type { StrategyEvaluation } from "./strategy.ts";
import type { RaceExperimentRival } from "./race-experiments.ts";

export interface SharedRaceParticipant { readonly team: TeamProfile; readonly driver: DriverProfile }
export interface SharedRaceGridInput {
  readonly teamId: TeamId;
  readonly driverId: string;
  readonly playerStrategy: StrategyEvaluation;
  readonly strategyPool: readonly StrategyEvaluation[];
  readonly startingGridPosition: number;
  readonly equalPerformance: boolean;
}

/** The same selected driver + ordered 19 participants for replay and experiments. */
export function sharedRaceParticipants(teamId: TeamId, driverId: string): readonly SharedRaceParticipant[] {
  const team = TEAM_PROFILES.find((candidate) => candidate.id === teamId);
  const driver = team?.drivers.find((candidate) => candidate.id === driverId);
  if (!team || !driver) throw new RangeError("The selected driver must belong to the selected team.");
  return [{ team, driver }, ...TEAM_PROFILES.flatMap((entry) => entry.drivers.map((person) => ({ team: entry, driver: person })))
    .filter((entry) => entry.driver.id !== driverId)].slice(0, RACE_GRID_SIZE);
}

/**
 * Shared roster, grid slots and opponent plans. Input plans already include the
 * primary driver's DP coefficients. Relative mappings must be applied once only.
 * For MC, zero race losses guarantee these are NOT traffic-adjusted replay times.
 */
export function buildSharedRaceGrid(input: SharedRaceGridInput) {
  const participants = sharedRaceParticipants(input.teamId, input.driverId);
  const primary = resolveEntryPerformance(input.teamId, input.driverId, input.equalPerformance);
  const startingGridPosition = Math.min(RACE_GRID_SIZE, Math.max(1, Math.round(input.startingGridPosition)));
  const slots = [startingGridPosition, ...Array.from({ length: RACE_GRID_SIZE }, (_, index) => index + 1).filter((slot) => slot !== startingGridPosition)];
  const pool = input.strategyPool.length ? input.strategyPool : [input.playerStrategy];
  const profiles = participants.map(({ team, driver }) => driver.id === input.driverId
    ? primary : resolveEntryPerformance(team.id, driver.id, input.equalPerformance));
  const entries: readonly RaceGridEntry[] = participants.map(({ team, driver }, index) => ({
    id: driver.id, label: driver.code, gridPosition: slots[index], pitGroup: team.id,
    // Preserve the original replay assignment; changing the tested candidate
    // does not change the fixed opponent pool or its assignments.
    strategy: index === 0 ? input.playerStrategy : pool[(index * 7 + slots[index]) % pool.length],
    entryModelAdjustment: relativeEntryModelAdjustment(input.driverId, primary, profiles[index]),
  }));
  const entryOnlyGrid = createRaceGrid(entries, { performanceMode: "equal", gridSlotOffsetSeconds: 0,
    trafficWindowSeconds: 0, maximumTrafficLossSeconds: 0, pitStackWindowSeconds: 0, pitStackLossSeconds: 0 });
  const byId = new Map(entryOnlyGrid.cars.map((car) => [car.id, car]));
  const fixedRivals: readonly RaceExperimentRival[] = participants.slice(1).map(({ driver }, index) => {
    const car = byId.get(driver.id)!;
    return { driverId: driver.id, gridPosition: car.gridPosition,
      strategy: car.replay.strategy, racecraft: profiles[index + 1].racecraft,
      costBasis: "entry-adjusted-no-traffic" };
  });
  return { entries, participants, fixedRivals, playerId: input.driverId, racecraft: primary.racecraft,
    startingGridPosition, gridSlotOffsetSeconds: DEFAULT_RACE_GRID_PARAMETERS.gridSlotOffsetSeconds };
}
