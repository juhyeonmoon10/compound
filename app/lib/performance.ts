import type {
  DriverProfile,
  TeamId,
  TeamProfile,
} from "./participants";

export type RacePerformanceMode = "equal" | "realistic";

export interface RacePerformanceRatings {
  readonly carPace: number;
  readonly driverPace: number;
  readonly tyreManagement: number;
  readonly consistency: number;
  readonly racecraft: number;
  readonly pitCrew: number;
}

export interface RacePerformanceProfile {
  readonly ratings: RacePerformanceRatings;
  readonly teamPoints: number;
  readonly driverPoints: number;
  readonly fastestPitStopWins: number;
}

export const PERFORMANCE_MODEL_VERSION =
  "APEX Performance Proxy 2026.07";

export const PERFORMANCE_DATA_SOURCES = {
  checkedAt: "2026-07-30",
  teams: "https://www.formula1.com/en/results/2026/team",
  drivers: "https://www.formula1.com/en/results/2026/drivers",
  pitStops:
    "https://www.formula1.com/en/results/2026/awards/fastest-pit-stops",
} as const;

const TEAM_POINTS: Readonly<Record<TeamId, number>> = {
  mercedes: 379,
  ferrari: 307,
  mclaren: 220,
  "red-bull": 177,
  "racing-bulls": 66,
  alpine: 61,
  haas: 21,
  audi: 12,
  williams: 11,
  "aston-martin": 1,
  cadillac: 0,
};

const DRIVER_POINTS: Readonly<Record<string, number>> = {
  "kimi-antonelli": 219,
  "lewis-hamilton": 169,
  "george-russell": 160,
  "charles-leclerc": 138,
  "lando-norris": 128,
  "max-verstappen": 109,
  "oscar-piastri": 92,
  "isack-hadjar": 68,
  "liam-lawson": 43,
  "pierre-gasly": 42,
  "arvid-lindblad": 23,
  "franco-colapinto": 19,
  "oliver-bearman": 18,
  "gabriel-bortoleto": 10,
  "carlos-sainz": 6,
  "alexander-albon": 5,
  "esteban-ocon": 3,
  "nico-hulkenberg": 2,
  "fernando-alonso": 1,
  "lance-stroll": 0,
  "valtteri-bottas": 0,
  "sergio-perez": 0,
};

const FASTEST_PIT_STOP_WINS: Readonly<Record<TeamId, number>> = {
  mercedes: 3,
  ferrari: 3,
  mclaren: 1,
  "red-bull": 0,
  "racing-bulls": 4,
  alpine: 0,
  haas: 0,
  audi: 0,
  williams: 0,
  "aston-martin": 0,
  cadillac: 0,
};

function clampRating(value: number): number {
  return Math.min(100, Math.max(60, Math.round(value)));
}

function squareRootShare(value: number, maximum: number): number {
  return Math.sqrt((value + 1) / (maximum + 1));
}

/**
 * Transparent, deliberately conservative ratings derived from the official
 * 2026 points tables and fastest-pit-stop winners. They are research proxies,
 * not official F1 skill ratings or predictions.
 */
export function racePerformanceProfile(
  team: TeamProfile,
  driver: DriverProfile,
): RacePerformanceProfile {
  const teamPoints = TEAM_POINTS[team.id];
  const driverPoints = DRIVER_POINTS[driver.id] ?? 0;
  const fastestPitStopWins = FASTEST_PIT_STOP_WINS[team.id];
  const teamStrength = squareRootShare(teamPoints, 379);
  const driverStrength = squareRootShare(driverPoints, 219);
  const teammateShare =
    teamPoints > 0 ? driverPoints / teamPoints : 0.5;
  const teammateEdge = Math.min(
    0.5,
    Math.max(-0.5, (teammateShare - 0.5) * 2),
  );

  return {
    teamPoints,
    driverPoints,
    fastestPitStopWins,
    ratings: {
      carPace: clampRating(72 + teamStrength * 28),
      driverPace: clampRating(
        74 + driverStrength * 20 + teammateEdge * 8,
      ),
      tyreManagement: clampRating(
        78 + driverStrength * 17 + teammateEdge * 5,
      ),
      consistency: clampRating(
        80 + driverStrength * 15 + teammateEdge * 4,
      ),
      racecraft: clampRating(
        77 + driverStrength * 18 + teammateEdge * 7,
      ),
      pitCrew: clampRating(84 + fastestPitStopWins * 4),
    },
  };
}

export function neutralPerformanceRatings(): RacePerformanceRatings {
  return {
    carPace: 80,
    driverPace: 80,
    tyreManagement: 80,
    consistency: 80,
    racecraft: 80,
    pitCrew: 80,
  };
}
