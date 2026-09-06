import { ALL_COMPOUNDS, TRACK_PRESETS, type Compound, type CompoundModel, type StrategyOptimizerInput } from "./strategy.ts";
import { TEAM_PROFILES, type TeamId } from "./participants.ts";
import { getObservedTeamPerformance } from "./historical-calibration.ts";
import { resolveDriverPerformance } from "./driver-ratings.ts";
import { MODEL_PARAMS } from "../model/params.ts";

const observedTeams = TEAM_PROFILES.map(team => ({ id: team.id, ...getObservedTeamPerformance(team.id) }));
const fastestObservedPace = Math.min(...observedTeams.filter(team => team.source.kind !== "unavailable").map(team => team.paceSeconds));
export function resolveEntryPerformance(teamId: TeamId, driverId: string, equalPerformance = false) {
  const driver = resolveDriverPerformance(driverId, equalPerformance);
  const observed = observedTeams.find(team => team.id === teamId)!;
  const teamPaceSeconds = equalPerformance || observed.source.kind === "unavailable" ? MODEL_PARAMS.performance.neutralPaceSeconds : observed.paceSeconds - fastestObservedPace;
  const teamDeg = equalPerformance ? MODEL_PARAMS.performance.neutralDeg : observed.degMultiplier;
  return { driver, team: observed, teamPaceSeconds, teamDeg, paceSeconds: driver.paceSeconds + teamPaceSeconds, wearMultiplier: driver.wearMultiplier * teamDeg, wetPenaltyMultiplier: driver.wetPenaltyMultiplier, racecraft: driver.racecraft, equalPerformance };
}

/** Apply explicit time coefficients before DP, identically for every candidate. */
export function applyEntryPerformance(input: StrategyOptimizerInput, teamId: TeamId, driverId: string, equalPerformance = false): StrategyOptimizerInput {
  if (equalPerformance) return input;
  const profile = resolveEntryPerformance(teamId, driverId);
  const track = typeof input.track === "object" ? input.track : TRACK_PRESETS[input.track ?? "melbourne"];
  const compoundModels = {} as Record<Compound, Partial<CompoundModel>>;
  for (const compound of ALL_COMPOUNDS) {
    const parameters = { ...track.compounds[compound], ...input.compoundModels?.[compound] };
    compoundModels[compound] = { ...parameters, alpha: parameters.alpha * profile.wearMultiplier, beta: parameters.beta * profile.wearMultiplier };
  }
  return { ...input, baseLapTimeSeconds: (input.baseLapTimeSeconds ?? track.baseLapTimeSeconds) + profile.paceSeconds, wetPenaltyMultiplier: profile.wetPenaltyMultiplier, compoundModels };
}
