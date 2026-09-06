import { ALL_COMPOUNDS, TRACK_PRESETS, type Compound, type CompoundModel, type StrategyOptimizerInput } from "./strategy.ts";
import { TEAM_PROFILES, type TeamId } from "./participants.ts";
import { getRecentTeamPerformance } from "./recent-team-performance.ts";
import { resolveDriverPerformance } from "./driver-ratings.ts";
import { MODEL_PARAMS } from "../model/params.ts";

const observedTeams = TEAM_PROFILES.map(team => getRecentTeamPerformance(team.id));
const availablePaces = observedTeams.filter(team => team.source.kind !== "unavailable").map(team => team.paceSeconds);
const fastestObservedPace = availablePaces.length ? Math.min(...availablePaces) : MODEL_PARAMS.performance.neutralPaceSeconds;
export function getAdoptedTeamPerformance(teamId: string) {
  const observed = observedTeams.find(team => team.id === teamId) ?? getRecentTeamPerformance(teamId);
  return { ...observed, adoptedPaceSeconds: observed.source.kind === "unavailable" ? MODEL_PARAMS.performance.neutralPaceSeconds : observed.paceSeconds - fastestObservedPace };
}
export function resolveEntryPerformance(teamId: TeamId, driverId: string, equalPerformance = false) {
  const driver = resolveDriverPerformance(driverId, equalPerformance);
  const observed = getAdoptedTeamPerformance(teamId);
  const teamPaceSeconds = equalPerformance ? MODEL_PARAMS.performance.neutralPaceSeconds : observed.adoptedPaceSeconds;
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
