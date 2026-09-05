/**
 * Deterministic dry-race tyre strategy optimiser.
 *
 * The dynamic-programming state is:
 *   DP[lap][compound][tyreAge][usedMask][stops]
 *
 * `tyreAge` is zero-based: a new tyre's first racing lap has age 0.
 * A pit stop is recorded after the previous stint's final lap, while its
 * time loss is charged to the first lap on the new set.
 */

import {
  TYRE_STATE_MODEL_VERSION,
  calculateTyreState,
  type TyreStateSnapshot,
} from "./tyre-state.ts";

export const COMPOUNDS = ["S", "M", "H"] as const;

export type Compound = (typeof COMPOUNDS)[number];
export type StopCount = 1 | 2;

/**
 * Original 2026 calendar order. Bahrain and Jeddah remain available as
 * historical/what-if analysis presets even though their 2026 events were
 * subsequently called off.
 */
export const TRACK_PRESET_IDS = [
  "melbourne",
  "shanghai",
  "suzuka",
  "bahrain",
  "jeddah",
  "miami",
  "montreal",
  "monaco",
  "barcelona",
  "spielberg",
  "silverstone",
  "spa",
  "hungaroring",
  "zandvoort",
  "monza",
  "madrid",
  "baku",
  "singapore",
  "austin",
  "mexico-city",
  "sao-paulo",
  "las-vegas",
  "lusail",
  "yas-marina",
] as const;

export type TrackPresetId = (typeof TRACK_PRESET_IDS)[number];
export type TyreSeverity = 2 | 3 | 4 | 5;
export type CalendarStatus = "scheduled" | "called-off";

export interface CompoundModel {
  readonly label: string;
  readonly color: string;
  /** Constant delta to the track baseline, in seconds per lap. */
  readonly offsetSeconds: number;
  /** Linear degradation coefficient, in seconds per tyre-age lap. */
  readonly alpha: number;
  /** Quadratic degradation coefficient. */
  readonly beta: number;
  /** Hard upper bound for a stint on this compound. */
  readonly maxStintLaps: number;
}

export interface TrackModel {
  readonly id?: string;
  readonly name: string;
  readonly country?: string;
  readonly laps: number;
  /** B in the documented lap-time equation. */
  readonly baseLapTimeSeconds: number;
  readonly pitLossSeconds: number;
  /** Seconds gained per race lap as fuel burns off. */
  readonly fuelGainSecondsPerLap: number;
  /** Project tyre-load classification. Custom tracks default to 3. */
  readonly tyreSeverity?: TyreSeverity;
  /** Dry track temperature used by the closed-form tyre-state proxy. */
  readonly trackTemperatureC?: number;
  readonly compounds: Readonly<Record<Compound, CompoundModel>>;
}

export interface TrackPreset extends TrackModel {
  readonly id: TrackPresetId;
  readonly country: string;
  readonly shortCode: string;
  readonly koreanName: string;
  readonly trait: string;
  /** Official circuit length published for the 2026 calendar, in km. */
  readonly circuitLengthKm: number;
  readonly turns: number;
  /** Project classification used to select transparent degradation seeds. */
  readonly tyreSeverity: TyreSeverity;
  readonly calendarStatus: CalendarStatus;
}

export interface RaceModelInput {
  /** Defaults to Melbourne. A complete custom track model is also accepted. */
  readonly track?: TrackPresetId | TrackModel;
  readonly laps?: number;
  readonly baseLapTimeSeconds?: number;
  readonly pitLossSeconds?: number;
  readonly fuelGainSecondsPerLap?: number;
  readonly trackTemperatureC?: number;
  readonly compoundModels?: Partial<
    Record<Compound, Partial<CompoundModel>>
  >;
}

export interface StrategyRules {
  /** The optimiser intentionally supports one- and two-stop races. */
  readonly minStops: StopCount;
  readonly maxStops: StopCount;
  /** Standard dry-race rule: use at least two distinct dry compounds. */
  readonly requireTwoDryCompounds: boolean;
  readonly minStintLaps: number;
}

export interface StrategyOptimizerInput extends RaceModelInput {
  readonly rules?: Partial<StrategyRules>;
  /** Number of globally unique strategies to return. Defaults to 3. */
  readonly topK?: number;
  readonly allowedStartingCompounds?: readonly Compound[];
}

export interface StrategyStintInput {
  readonly compound: Compound;
  readonly startLap: number;
  readonly endLap: number;
}

export interface StrategyStint extends StrategyStintInput {
  readonly laps: number;
  readonly tyreAgeStart: 0;
  readonly tyreAgeEnd: number;
}

export interface StrategyCostInput extends RaceModelInput {
  readonly stints: readonly StrategyStintInput[];
  readonly rules?: Partial<StrategyRules>;
}

export interface CostBreakdown {
  readonly baselineSeconds: number;
  readonly compoundOffsetSeconds: number;
  readonly linearDegradationSeconds: number;
  readonly quadraticDegradationSeconds: number;
  readonly tyreStateLossSeconds: number;
  /** Positive number subtracted from the gross lap time. */
  readonly fuelGainSeconds: number;
  readonly pitLossSeconds: number;
  readonly totalSeconds: number;
}

export interface LapCostBreakdown {
  readonly lap: number;
  readonly compound: Compound;
  readonly tyreAge: number;
  readonly baselineSeconds: number;
  readonly compoundOffsetSeconds: number;
  readonly linearDegradationSeconds: number;
  readonly quadraticDegradationSeconds: number;
  readonly tyreState: TyreStateSnapshot;
  readonly fuelGainSeconds: number;
  readonly pitLossSeconds: number;
  readonly lapTimeSeconds: number;
  readonly cumulativeSeconds: number;
}

export interface StrategyEvaluation {
  /** Canonical identity of the resolved model and rules used for evaluation. */
  readonly scenarioSignature: string;
  readonly totalSeconds: number;
  readonly formattedTime: string;
  readonly stopCount: number;
  readonly pitAfterLaps: readonly number[];
  readonly compoundsUsed: readonly Compound[];
  readonly stints: readonly StrategyStint[];
  readonly breakdown: CostBreakdown;
  readonly lapCosts: readonly LapCostBreakdown[];
  readonly isLegal: boolean;
  readonly violations: readonly string[];
}

export interface StrategyResult extends StrategyEvaluation {
  readonly rank: number;
  /** Stable identity for UI keys and result de-duplication. */
  readonly signature: string;
}

export const DEFAULT_TOP_K = 3;
export const STRATEGY_MODEL_VERSION = "APEX DP v3.0";

export const DEFAULT_STRATEGY_RULES: Readonly<StrategyRules> = {
  minStops: 1,
  maxStops: 2,
  requireTwoDryCompounds: true,
  minStintLaps: 1,
};

export const DEFAULT_COMPOUND_MODELS: Readonly<
  Record<Compound, CompoundModel>
> = {
  S: {
    label: "Soft",
    color: "#e10600",
    offsetSeconds: -0.62,
    alpha: 0.045,
    beta: 0.003,
    maxStintLaps: 26,
  },
  M: {
    label: "Medium",
    color: "#ffd12e",
    offsetSeconds: 0,
    alpha: 0.026,
    beta: 0.00155,
    maxStintLaps: 42,
  },
  H: {
    label: "Hard",
    color: "#f2f2f2",
    offsetSeconds: 0.54,
    alpha: 0.016,
    beta: 0.0009,
    maxStintLaps: 60,
  },
};

function compoundSet(
  overrides: Partial<Record<Compound, Partial<CompoundModel>>> = {},
): Readonly<Record<Compound, CompoundModel>> {
  const result = {} as Record<Compound, CompoundModel>;

  for (const compound of COMPOUNDS) {
    result[compound] = {
      ...DEFAULT_COMPOUND_MODELS[compound],
      ...overrides[compound],
    };
  }

  return result;
}

const SEVERITY_MODELS: Readonly<
  Record<
    TyreSeverity,
    Readonly<
      Record<
        Compound,
        Readonly<
          Pick<
            CompoundModel,
            "offsetSeconds" | "alpha" | "beta" | "maxStintLaps"
          >
        >
      >
    >
  >
> = {
  2: {
    S: {
      offsetSeconds: -0.48,
      alpha: 0.032,
      beta: 0.0019,
      maxStintLaps: 34,
    },
    M: {
      offsetSeconds: 0,
      alpha: 0.019,
      beta: 0.00105,
      maxStintLaps: 54,
    },
    H: {
      offsetSeconds: 0.43,
      alpha: 0.012,
      beta: 0.00062,
      maxStintLaps: Number.POSITIVE_INFINITY,
    },
  },
  3: {
    S: {
      offsetSeconds: -0.54,
      alpha: 0.041,
      beta: 0.0026,
      maxStintLaps: 29,
    },
    M: {
      offsetSeconds: 0,
      alpha: 0.024,
      beta: 0.0014,
      maxStintLaps: 46,
    },
    H: {
      offsetSeconds: 0.47,
      alpha: 0.015,
      beta: 0.0008,
      maxStintLaps: Number.POSITIVE_INFINITY,
    },
  },
  4: {
    S: {
      offsetSeconds: -0.6,
      alpha: 0.049,
      beta: 0.00315,
      maxStintLaps: 25,
    },
    M: {
      offsetSeconds: 0,
      alpha: 0.0285,
      beta: 0.00172,
      maxStintLaps: 40,
    },
    H: {
      offsetSeconds: 0.52,
      alpha: 0.018,
      beta: 0.001,
      maxStintLaps: Number.POSITIVE_INFINITY,
    },
  },
  5: {
    S: {
      offsetSeconds: -0.66,
      alpha: 0.056,
      beta: 0.00375,
      maxStintLaps: 22,
    },
    M: {
      offsetSeconds: 0,
      alpha: 0.033,
      beta: 0.00205,
      maxStintLaps: 35,
    },
    H: {
      offsetSeconds: 0.57,
      alpha: 0.021,
      beta: 0.00115,
      maxStintLaps: Number.POSITIVE_INFINITY,
    },
  },
};

function compoundsForSeverity(
  severity: TyreSeverity,
  raceLaps: number,
): Readonly<Record<Compound, CompoundModel>> {
  const model = SEVERITY_MODELS[severity];
  return compoundSet({
    S: {
      ...model.S,
      maxStintLaps: Math.min(model.S.maxStintLaps, raceLaps),
    },
    M: {
      ...model.M,
      maxStintLaps: Math.min(model.M.maxStintLaps, raceLaps),
    },
    H: {
      ...model.H,
      maxStintLaps: raceLaps,
    },
  });
}

/**
 * The venue, lap-count, length and corner-count fields follow the original
 * 2026 calendar specification. Performance coefficients, pit losses and tyre
 * severity are transparent project estimates, not team telemetry.
 */
export const TRACK_PRESETS: Readonly<Record<TrackPresetId, TrackPreset>> = {
  melbourne: {
    id: "melbourne",
    name: "Albert Park Grand Prix Circuit",
    country: "Australia",
    shortCode: "AUS",
    koreanName: "앨버트 파크",
    trait: "빠른 임시 코스 · 노면 진화와 그립 변화",
    laps: 58,
    circuitLengthKm: 5.278,
    turns: 14,
    tyreSeverity: 3,
    calendarStatus: "scheduled",
    baseLapTimeSeconds: 83.1,
    pitLossSeconds: 20.5,
    fuelGainSecondsPerLap: 0.05,
    compounds: compoundsForSeverity(3, 58),
  },
  shanghai: {
    id: "shanghai",
    name: "Shanghai International Circuit",
    country: "China",
    shortCode: "CHN",
    koreanName: "상하이",
    trait: "긴 1–2번 코너와 직선이 공존하는 혼합형",
    laps: 56,
    circuitLengthKm: 5.451,
    turns: 16,
    tyreSeverity: 4,
    calendarStatus: "scheduled",
    baseLapTimeSeconds: 95.5,
    pitLossSeconds: 22,
    fuelGainSecondsPerLap: 0.055,
    compounds: compoundsForSeverity(4, 56),
  },
  suzuka: {
    id: "suzuka",
    name: "Suzuka International Racing Course",
    country: "Japan",
    shortCode: "JPN",
    koreanName: "스즈카",
    trait: "S 커브와 130R의 지속적인 고속 횡하중",
    laps: 53,
    circuitLengthKm: 5.807,
    turns: 18,
    tyreSeverity: 5,
    calendarStatus: "scheduled",
    baseLapTimeSeconds: 94.1,
    pitLossSeconds: 22.1,
    fuelGainSecondsPerLap: 0.057,
    compounds: compoundsForSeverity(5, 53),
  },
  bahrain: {
    id: "bahrain",
    name: "Bahrain International Circuit",
    country: "Bahrain",
    shortCode: "BHR",
    koreanName: "바레인",
    trait: "거친 노면 · 강한 제동과 후륜 열화",
    laps: 57,
    circuitLengthKm: 5.412,
    turns: 15,
    tyreSeverity: 4,
    calendarStatus: "called-off",
    baseLapTimeSeconds: 95.2,
    pitLossSeconds: 22.4,
    fuelGainSecondsPerLap: 0.055,
    compounds: compoundsForSeverity(4, 57),
  },
  jeddah: {
    id: "jeddah",
    name: "Jeddah Corniche Circuit",
    country: "Saudi Arabia",
    shortCode: "SAU",
    koreanName: "제다",
    trait: "초고속 시가지 · 연속 코너와 낮은 항력",
    laps: 50,
    circuitLengthKm: 6.174,
    turns: 27,
    tyreSeverity: 3,
    calendarStatus: "called-off",
    baseLapTimeSeconds: 94,
    pitLossSeconds: 20.5,
    fuelGainSecondsPerLap: 0.057,
    compounds: compoundsForSeverity(3, 50),
  },
  miami: {
    id: "miami",
    name: "Miami International Autodrome",
    country: "United States",
    shortCode: "MIA",
    koreanName: "마이애미",
    trait: "긴 직선과 저속 구간의 제동·트랙션 혼합형",
    laps: 57,
    circuitLengthKm: 5.412,
    turns: 19,
    tyreSeverity: 3,
    calendarStatus: "scheduled",
    baseLapTimeSeconds: 93,
    pitLossSeconds: 21.5,
    fuelGainSecondsPerLap: 0.054,
    compounds: compoundsForSeverity(3, 57),
  },
  montreal: {
    id: "montreal",
    name: "Circuit Gilles-Villeneuve",
    country: "Canada",
    shortCode: "CAN",
    koreanName: "질 빌뇌브",
    trait: "강한 제동과 재가속이 반복되는 스톱앤고",
    laps: 70,
    circuitLengthKm: 4.361,
    turns: 14,
    tyreSeverity: 2,
    calendarStatus: "scheduled",
    baseLapTimeSeconds: 76.4,
    pitLossSeconds: 19,
    fuelGainSecondsPerLap: 0.046,
    compounds: compoundsForSeverity(2, 70),
  },
  monaco: {
    id: "monaco",
    name: "Circuit de Monaco",
    country: "Monaco",
    shortCode: "MCO",
    koreanName: "모나코",
    trait: "극저속 시가지 · 타이어보다 트랙 포지션 우선",
    laps: 78,
    circuitLengthKm: 3.337,
    turns: 19,
    tyreSeverity: 2,
    calendarStatus: "scheduled",
    baseLapTimeSeconds: 76.4,
    pitLossSeconds: 19.8,
    fuelGainSecondsPerLap: 0.043,
    compounds: compoundsForSeverity(2, 78),
  },
  barcelona: {
    id: "barcelona",
    name: "Circuit de Barcelona-Catalunya",
    country: "Spain",
    shortCode: "BCN",
    koreanName: "바르셀로나",
    trait: "고속·저속 코너가 고르게 섞인 고부하 코스",
    laps: 66,
    circuitLengthKm: 4.657,
    turns: 14,
    tyreSeverity: 5,
    calendarStatus: "scheduled",
    baseLapTimeSeconds: 79,
    pitLossSeconds: 22.5,
    fuelGainSecondsPerLap: 0.051,
    compounds: compoundsForSeverity(5, 66),
  },
  spielberg: {
    id: "spielberg",
    name: "Red Bull Ring",
    country: "Austria",
    shortCode: "AUT",
    koreanName: "레드불 링",
    trait: "짧은 랩 · 오르막 제동과 빠른 내리막 코너",
    laps: 71,
    circuitLengthKm: 4.326,
    turns: 10,
    tyreSeverity: 3,
    calendarStatus: "scheduled",
    baseLapTimeSeconds: 71.2,
    pitLossSeconds: 20,
    fuelGainSecondsPerLap: 0.044,
    compounds: compoundsForSeverity(3, 71),
  },
  silverstone: {
    id: "silverstone",
    name: "Silverstone Circuit",
    country: "United Kingdom",
    shortCode: "GBR",
    koreanName: "실버스톤",
    trait: "초고속 연속 코너 · 높은 타이어 에너지",
    laps: 52,
    circuitLengthKm: 5.891,
    turns: 18,
    tyreSeverity: 5,
    calendarStatus: "scheduled",
    baseLapTimeSeconds: 90.5,
    pitLossSeconds: 20.6,
    fuelGainSecondsPerLap: 0.056,
    compounds: compoundsForSeverity(5, 52),
  },
  spa: {
    id: "spa",
    name: "Circuit de Spa-Francorchamps",
    country: "Belgium",
    shortCode: "BEL",
    koreanName: "스파",
    trait: "긴 랩과 고도 변화 · 구간별 날씨 변수",
    laps: 44,
    circuitLengthKm: 7.004,
    turns: 19,
    tyreSeverity: 4,
    calendarStatus: "scheduled",
    baseLapTimeSeconds: 108,
    pitLossSeconds: 22.5,
    fuelGainSecondsPerLap: 0.06,
    compounds: compoundsForSeverity(4, 44),
  },
  hungaroring: {
    id: "hungaroring",
    name: "Hungaroring",
    country: "Hungary",
    shortCode: "HUN",
    koreanName: "헝가로링",
    trait: "연속 기술 코너 · 리듬과 과열 관리",
    laps: 70,
    circuitLengthKm: 4.381,
    turns: 14,
    tyreSeverity: 4,
    calendarStatus: "scheduled",
    baseLapTimeSeconds: 79.9,
    pitLossSeconds: 21,
    fuelGainSecondsPerLap: 0.046,
    compounds: compoundsForSeverity(4, 70),
  },
  zandvoort: {
    id: "zandvoort",
    name: "Circuit Zandvoort",
    country: "Netherlands",
    shortCode: "NED",
    koreanName: "잔드보르트",
    trait: "뱅킹과 기복 · 지속적인 고속 횡하중",
    laps: 72,
    circuitLengthKm: 4.259,
    turns: 14,
    tyreSeverity: 4,
    calendarStatus: "scheduled",
    baseLapTimeSeconds: 74.4,
    pitLossSeconds: 20.5,
    fuelGainSecondsPerLap: 0.045,
    compounds: compoundsForSeverity(4, 72),
  },
  monza: {
    id: "monza",
    name: "Autodromo Nazionale di Monza",
    country: "Italy",
    shortCode: "ITA",
    koreanName: "몬차",
    trait: "초저다운포스 · 긴 직선과 강한 치케인 제동",
    laps: 53,
    circuitLengthKm: 5.793,
    turns: 11,
    tyreSeverity: 2,
    calendarStatus: "scheduled",
    baseLapTimeSeconds: 84.2,
    pitLossSeconds: 24,
    fuelGainSecondsPerLap: 0.054,
    compounds: compoundsForSeverity(2, 53),
  },
  madrid: {
    id: "madrid",
    name: "Madring",
    country: "Spain",
    shortCode: "MAD",
    koreanName: "마드링",
    trait: "신설 혼합형 코스 · 24% 뱅킹, 실측 전",
    laps: 57,
    circuitLengthKm: 5.416,
    turns: 22,
    tyreSeverity: 3,
    calendarStatus: "scheduled",
    baseLapTimeSeconds: 95.4,
    pitLossSeconds: 22,
    fuelGainSecondsPerLap: 0.055,
    compounds: compoundsForSeverity(3, 57),
  },
  baku: {
    id: "baku",
    name: "Baku City Circuit",
    country: "Azerbaijan",
    shortCode: "AZE",
    koreanName: "바쿠",
    trait: "초장거리 직선과 좁은 구시가지의 타협",
    laps: 51,
    circuitLengthKm: 6.003,
    turns: 20,
    tyreSeverity: 2,
    calendarStatus: "scheduled",
    baseLapTimeSeconds: 106.3,
    pitLossSeconds: 21,
    fuelGainSecondsPerLap: 0.06,
    compounds: compoundsForSeverity(2, 51),
  },
  singapore: {
    id: "singapore",
    name: "Marina Bay Street Circuit",
    country: "Singapore",
    shortCode: "SGP",
    koreanName: "싱가포르",
    trait: "고온 시가지 · 제동, 트랙션과 열 관리",
    laps: 62,
    circuitLengthKm: 4.927,
    turns: 19,
    tyreSeverity: 3,
    calendarStatus: "scheduled",
    baseLapTimeSeconds: 97.1,
    pitLossSeconds: 28,
    fuelGainSecondsPerLap: 0.055,
    compounds: compoundsForSeverity(3, 62),
  },
  austin: {
    id: "austin",
    name: "Circuit of the Americas",
    country: "United States",
    shortCode: "USA",
    koreanName: "COTA",
    trait: "고속 에세스와 저속 구간이 섞인 복합 코스",
    laps: 56,
    circuitLengthKm: 5.513,
    turns: 20,
    tyreSeverity: 4,
    calendarStatus: "scheduled",
    baseLapTimeSeconds: 99.5,
    pitLossSeconds: 20.5,
    fuelGainSecondsPerLap: 0.056,
    compounds: compoundsForSeverity(4, 56),
  },
  "mexico-city": {
    id: "mexico-city",
    name: "Autodromo Hermanos Rodriguez",
    country: "Mexico",
    shortCode: "MEX",
    koreanName: "멕시코시티",
    trait: "고지대 · 냉각과 다운포스 효율이 핵심",
    laps: 71,
    circuitLengthKm: 4.304,
    turns: 17,
    tyreSeverity: 3,
    calendarStatus: "scheduled",
    baseLapTimeSeconds: 81.1,
    pitLossSeconds: 21,
    fuelGainSecondsPerLap: 0.047,
    compounds: compoundsForSeverity(3, 71),
  },
  "sao-paulo": {
    id: "sao-paulo",
    name: "Autodromo Jose Carlos Pace",
    country: "Brazil",
    shortCode: "BRA",
    koreanName: "인터라고스",
    trait: "짧고 기복 큰 반시계 코스 · 날씨 변수",
    laps: 71,
    circuitLengthKm: 4.309,
    turns: 15,
    tyreSeverity: 3,
    calendarStatus: "scheduled",
    baseLapTimeSeconds: 73.8,
    pitLossSeconds: 22,
    fuelGainSecondsPerLap: 0.044,
    compounds: compoundsForSeverity(3, 71),
  },
  "las-vegas": {
    id: "las-vegas",
    name: "Las Vegas Strip Circuit",
    country: "United States",
    shortCode: "LVG",
    koreanName: "라스베이거스",
    trait: "저온 야간 시가지 · 긴 직선과 낮은 초기 그립",
    laps: 50,
    circuitLengthKm: 6.201,
    turns: 17,
    tyreSeverity: 2,
    calendarStatus: "scheduled",
    baseLapTimeSeconds: 96.7,
    pitLossSeconds: 20.5,
    fuelGainSecondsPerLap: 0.059,
    compounds: compoundsForSeverity(2, 50),
  },
  lusail: {
    id: "lusail",
    name: "Lusail International Circuit",
    country: "Qatar",
    shortCode: "QAT",
    koreanName: "루사일",
    trait: "연속 중·고속 코너 · 매우 높은 횡하중",
    laps: 57,
    circuitLengthKm: 5.419,
    turns: 16,
    tyreSeverity: 5,
    calendarStatus: "scheduled",
    baseLapTimeSeconds: 85.7,
    pitLossSeconds: 25,
    fuelGainSecondsPerLap: 0.052,
    compounds: compoundsForSeverity(5, 57),
  },
  "yas-marina": {
    id: "yas-marina",
    name: "Yas Marina Circuit",
    country: "United Arab Emirates",
    shortCode: "UAE",
    koreanName: "야스 마리나",
    trait: "긴 직선과 저속 코너 · 강한 제동과 후륜 트랙션",
    laps: 58,
    circuitLengthKm: 5.281,
    turns: 16,
    tyreSeverity: 3,
    calendarStatus: "scheduled",
    baseLapTimeSeconds: 88.9,
    pitLossSeconds: 22,
    fuelGainSecondsPerLap: 0.052,
    compounds: compoundsForSeverity(3, 58),
  },
};

interface PathCost {
  readonly baselineSeconds: number;
  readonly compoundOffsetSeconds: number;
  readonly linearDegradationSeconds: number;
  readonly quadraticDegradationSeconds: number;
  readonly tyreStateLossSeconds: number;
  readonly fuelGainSeconds: number;
  readonly pitLossSeconds: number;
}

interface PathNode {
  readonly lap: number;
  readonly compound: Compound;
  readonly tyreAge: number;
  readonly usedMask: number;
  readonly stops: number;
  readonly totalSeconds: number;
  readonly cost: PathCost;
  readonly previous: PathNode | null;
  readonly pittedBeforeLap: boolean;
  readonly pathKey: string;
}

interface ResolvedProblem {
  readonly model: TrackModel;
  readonly rules: StrategyRules;
}

/**
 * Produces a deterministic identity for every input that can change strategy
 * legality or model time. Object properties and compound entries are emitted
 * in a fixed order so equivalent resolved problems share the same signature.
 */
function createScenarioSignature(
  model: TrackModel,
  rules: StrategyRules,
): string {
  return JSON.stringify({
    modelVersion: STRATEGY_MODEL_VERSION,
    tyreStateModelVersion: TYRE_STATE_MODEL_VERSION,
    track: {
      id: model.id ?? null,
      name: model.name,
      laps: model.laps,
      baseLapTimeSeconds: model.baseLapTimeSeconds,
      pitLossSeconds: model.pitLossSeconds,
      fuelGainSecondsPerLap: model.fuelGainSecondsPerLap,
      tyreSeverity: model.tyreSeverity ?? 3,
      trackTemperatureC: model.trackTemperatureC ?? 34,
    },
    compounds: COMPOUNDS.map((compound) => {
      const parameters = model.compounds[compound];
      return {
        compound,
        offsetSeconds: parameters.offsetSeconds,
        alpha: parameters.alpha,
        beta: parameters.beta,
        maxStintLaps: parameters.maxStintLaps,
      };
    }),
    rules: {
      minStops: rules.minStops,
      maxStops: rules.maxStops,
      requireTwoDryCompounds: rules.requireTwoDryCompounds,
      minStintLaps: rules.minStintLaps,
    },
  });
}

const COMPOUND_BITS: Readonly<Record<Compound, number>> = {
  S: 1,
  M: 2,
  H: 4,
};

const EMPTY_PATH_COST: PathCost = {
  baselineSeconds: 0,
  compoundOffsetSeconds: 0,
  linearDegradationSeconds: 0,
  quadraticDegradationSeconds: 0,
  tyreStateLossSeconds: 0,
  fuelGainSeconds: 0,
  pitLossSeconds: 0,
};

function assertFiniteNumber(
  value: number,
  name: string,
  minimum?: number,
): void {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number.`);
  }
  if (minimum !== undefined && value < minimum) {
    throw new RangeError(`${name} must be at least ${minimum}.`);
  }
}

function isCompound(value: string): value is Compound {
  return (COMPOUNDS as readonly string[]).includes(value);
}

function resolveProblem(
  input: RaceModelInput & { readonly rules?: Partial<StrategyRules> },
): ResolvedProblem {
  const selectedTrack =
    typeof input.track === "object"
      ? input.track
      : TRACK_PRESETS[input.track ?? "melbourne"];

  const compounds = {} as Record<Compound, CompoundModel>;
  for (const compound of COMPOUNDS) {
    compounds[compound] = {
      ...selectedTrack.compounds[compound],
      ...input.compoundModels?.[compound],
    };
  }

  const model: TrackModel = {
    ...selectedTrack,
    laps: input.laps ?? selectedTrack.laps,
    baseLapTimeSeconds:
      input.baseLapTimeSeconds ?? selectedTrack.baseLapTimeSeconds,
    pitLossSeconds: input.pitLossSeconds ?? selectedTrack.pitLossSeconds,
    fuelGainSecondsPerLap:
      input.fuelGainSecondsPerLap ?? selectedTrack.fuelGainSecondsPerLap,
    tyreSeverity: selectedTrack.tyreSeverity ?? 3,
    trackTemperatureC:
      input.trackTemperatureC ?? selectedTrack.trackTemperatureC ?? 34,
    compounds,
  };

  const rules: StrategyRules = {
    ...DEFAULT_STRATEGY_RULES,
    ...input.rules,
  };

  validateModel(model);
  validateRules(rules);

  return { model, rules };
}

function validateModel(model: TrackModel): void {
  if (!Number.isInteger(model.laps) || model.laps < 1) {
    throw new RangeError("laps must be a positive integer.");
  }
  assertFiniteNumber(model.baseLapTimeSeconds, "baseLapTimeSeconds", 0);
  assertFiniteNumber(model.pitLossSeconds, "pitLossSeconds", 0);
  assertFiniteNumber(
    model.fuelGainSecondsPerLap,
    "fuelGainSecondsPerLap",
    0,
  );
  assertFiniteNumber(
    model.trackTemperatureC ?? 34,
    "trackTemperatureC",
    10,
  );
  if ((model.trackTemperatureC ?? 34) > 60) {
    throw new RangeError("trackTemperatureC must be at most 60.");
  }
  if (
    !Number.isInteger(model.tyreSeverity ?? 3) ||
    (model.tyreSeverity ?? 3) < 2 ||
    (model.tyreSeverity ?? 3) > 5
  ) {
    throw new RangeError("tyreSeverity must be an integer from 2 to 5.");
  }

  for (const compound of COMPOUNDS) {
    const parameters = model.compounds[compound];
    assertFiniteNumber(
      parameters.offsetSeconds,
      `${compound}.offsetSeconds`,
    );
    assertFiniteNumber(parameters.alpha, `${compound}.alpha`, 0);
    assertFiniteNumber(parameters.beta, `${compound}.beta`, 0);
    if (
      !Number.isInteger(parameters.maxStintLaps) ||
      parameters.maxStintLaps < 1
    ) {
      throw new RangeError(
        `${compound}.maxStintLaps must be a positive integer.`,
      );
    }
  }
}

function validateRules(rules: StrategyRules): void {
  if (rules.minStops !== 1 && rules.minStops !== 2) {
    throw new RangeError("minStops must be 1 or 2.");
  }
  if (rules.maxStops !== 1 && rules.maxStops !== 2) {
    throw new RangeError("maxStops must be 1 or 2.");
  }
  if (rules.minStops > rules.maxStops) {
    throw new RangeError("minStops cannot be greater than maxStops.");
  }
  if (!Number.isInteger(rules.minStintLaps) || rules.minStintLaps < 1) {
    throw new RangeError("minStintLaps must be a positive integer.");
  }
}

function lapCost(
  model: TrackModel,
  lap: number,
  compound: Compound,
  tyreAge: number,
  includePitLoss: boolean,
): PathCost & {
  readonly tyreState: TyreStateSnapshot;
  readonly totalSeconds: number;
} {
  const parameters = model.compounds[compound];
  const linearDegradationSeconds = parameters.alpha * tyreAge;
  const quadraticDegradationSeconds =
    parameters.beta * tyreAge * tyreAge;
  const tyreState = calculateTyreState({
    compound,
    tyreAge,
    maxStintLaps: parameters.maxStintLaps,
    tyreSeverity: model.tyreSeverity ?? 3,
    trackTemperatureC: model.trackTemperatureC ?? 34,
    degradationSeconds:
      linearDegradationSeconds + quadraticDegradationSeconds,
  });
  const cost = {
    baselineSeconds: model.baseLapTimeSeconds,
    compoundOffsetSeconds: parameters.offsetSeconds,
    linearDegradationSeconds,
    quadraticDegradationSeconds,
    tyreStateLossSeconds: tyreState.totalStateLossSeconds,
    fuelGainSeconds: model.fuelGainSecondsPerLap * (lap - 1),
    pitLossSeconds: includePitLoss ? model.pitLossSeconds : 0,
  };
  const totalSeconds =
    cost.baselineSeconds +
    cost.compoundOffsetSeconds +
    cost.linearDegradationSeconds +
    cost.quadraticDegradationSeconds +
    cost.tyreStateLossSeconds -
    cost.fuelGainSeconds +
    cost.pitLossSeconds;

  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    throw new RangeError(
      `The model produced an invalid lap time on lap ${lap} (${compound}).`,
    );
  }

  return { ...cost, tyreState, totalSeconds };
}

function addPathCost(left: PathCost, right: PathCost): PathCost {
  return {
    baselineSeconds: left.baselineSeconds + right.baselineSeconds,
    compoundOffsetSeconds:
      left.compoundOffsetSeconds + right.compoundOffsetSeconds,
    linearDegradationSeconds:
      left.linearDegradationSeconds + right.linearDegradationSeconds,
    quadraticDegradationSeconds:
      left.quadraticDegradationSeconds +
      right.quadraticDegradationSeconds,
    tyreStateLossSeconds:
      left.tyreStateLossSeconds + right.tyreStateLossSeconds,
    fuelGainSeconds: left.fuelGainSeconds + right.fuelGainSeconds,
    pitLossSeconds: left.pitLossSeconds + right.pitLossSeconds,
  };
}

function compareCandidates(left: PathNode, right: PathNode): number {
  const delta = left.totalSeconds - right.totalSeconds;
  return Math.abs(delta) > 1e-9
    ? delta
    : left.pathKey.localeCompare(right.pathKey);
}

function stateKey(
  compound: Compound,
  tyreAge: number,
  usedMask: number,
  stops: number,
): string {
  return `${compound}:${tyreAge}:${usedMask}:${stops}`;
}

function insertKBest(
  layer: Map<string, PathNode[]>,
  key: string,
  candidate: PathNode,
  topK: number,
): void {
  const bucket = layer.get(key) ?? [];
  const duplicateIndex = bucket.findIndex(
    (entry) => entry.pathKey === candidate.pathKey,
  );

  if (duplicateIndex >= 0) {
    if (compareCandidates(candidate, bucket[duplicateIndex]) >= 0) {
      return;
    }
    bucket.splice(duplicateIndex, 1);
  }

  bucket.push(candidate);
  bucket.sort(compareCandidates);
  if (bucket.length > topK) {
    bucket.length = topK;
  }
  layer.set(key, bucket);
}

function countUsedCompounds(mask: number): number {
  let count = 0;
  for (const compound of COMPOUNDS) {
    if ((mask & COMPOUND_BITS[compound]) !== 0) {
      count += 1;
    }
  }
  return count;
}

function reconstructStints(finalNode: PathNode): StrategyStint[] {
  const nodes: PathNode[] = [];
  let cursor: PathNode | null = finalNode;

  while (cursor !== null) {
    nodes.push(cursor);
    cursor = cursor.previous;
  }
  nodes.reverse();

  const rawStints: Array<{
    compound: Compound;
    startLap: number;
    endLap: number;
  }> = [];

  for (const node of nodes) {
    const current = rawStints[rawStints.length - 1];
    if (
      current === undefined ||
      node.pittedBeforeLap ||
      current.compound !== node.compound
    ) {
      rawStints.push({
        compound: node.compound,
        startLap: node.lap,
        endLap: node.lap,
      });
    } else {
      current.endLap = node.lap;
    }
  }

  return rawStints.map((stint) => {
    const laps = stint.endLap - stint.startLap + 1;
    return {
      ...stint,
      laps,
      tyreAgeStart: 0,
      tyreAgeEnd: laps - 1,
    };
  });
}

function strategySignature(stints: readonly StrategyStintInput[]): string {
  return stints
    .map(
      (stint) =>
        `${stint.compound}:${stint.startLap}-${stint.endLap}`,
    )
    .join(">");
}

function normalizeStints(
  stints: readonly StrategyStintInput[],
  totalLaps: number,
): StrategyStint[] {
  if (stints.length === 0) {
    throw new RangeError("A strategy must contain at least one stint.");
  }

  const normalized: StrategyStint[] = [];
  let expectedStart = 1;

  for (const stint of stints) {
    if (!isCompound(stint.compound)) {
      throw new TypeError(`Unknown compound: ${String(stint.compound)}.`);
    }
    if (
      !Number.isInteger(stint.startLap) ||
      !Number.isInteger(stint.endLap)
    ) {
      throw new RangeError("Stint lap numbers must be integers.");
    }
    if (stint.startLap !== expectedStart) {
      throw new RangeError(
        `Stints must be contiguous; expected lap ${expectedStart}.`,
      );
    }
    if (stint.endLap < stint.startLap || stint.endLap > totalLaps) {
      throw new RangeError(
        `Invalid stint range ${stint.startLap}-${stint.endLap}.`,
      );
    }

    const laps = stint.endLap - stint.startLap + 1;
    normalized.push({
      ...stint,
      laps,
      tyreAgeStart: 0,
      tyreAgeEnd: laps - 1,
    });
    expectedStart = stint.endLap + 1;
  }

  if (expectedStart !== totalLaps + 1) {
    throw new RangeError(
      `The strategy must cover all ${totalLaps} race laps.`,
    );
  }

  return normalized;
}

function uniqueCompounds(
  stints: readonly StrategyStintInput[],
): Compound[] {
  const used = new Set<Compound>();
  for (const stint of stints) {
    used.add(stint.compound);
  }
  return COMPOUNDS.filter((compound) => used.has(compound));
}

/**
 * Formats a duration after rounding the complete value first. This prevents
 * displays such as `1:22:60.000` at minute/hour boundaries.
 */
export function formatRaceTime(
  seconds: number,
  fractionalDigits = 3,
): string {
  if (!Number.isFinite(seconds)) {
    return "—";
  }

  const precision = Number.isFinite(fractionalDigits)
    ? Math.min(6, Math.max(0, Math.trunc(fractionalDigits)))
    : 3;
  const factor = 10 ** precision;
  const absoluteUnits = Math.round(Math.abs(seconds) * factor);
  const sign = seconds < 0 && absoluteUnits !== 0 ? "-" : "";
  const unitsPerMinute = 60 * factor;
  const unitsPerHour = 60 * unitsPerMinute;
  const hours = Math.floor(absoluteUnits / unitsPerHour);
  const afterHours = absoluteUnits % unitsPerHour;
  const minutes = Math.floor(afterHours / unitsPerMinute);
  const secondUnits = afterHours % unitsPerMinute;
  const wholeSeconds = Math.floor(secondUnits / factor);
  const fractionalUnits = secondUnits % factor;
  const fraction =
    precision === 0
      ? ""
      : `.${String(fractionalUnits).padStart(precision, "0")}`;
  const secondText = `${String(wholeSeconds).padStart(2, "0")}${fraction}`;

  if (hours > 0) {
    return `${sign}${hours}:${String(minutes).padStart(2, "0")}:${secondText}`;
  }
  return `${sign}${minutes}:${secondText}`;
}

export function getTrackPreset(id: TrackPresetId): TrackPreset {
  return TRACK_PRESETS[id];
}

/**
 * Evaluates a supplied strategy with the same equation used by the optimiser.
 * Structural errors throw; sporting-rule errors are returned as violations so
 * a UI can still display the plan and its cost.
 */
export function evaluateStrategy(
  input: StrategyCostInput,
): StrategyEvaluation {
  const { model, rules } = resolveProblem(input);
  const scenarioSignature = createScenarioSignature(model, rules);
  const stints = normalizeStints(input.stints, model.laps);
  const lapCosts: LapCostBreakdown[] = [];
  let cumulativeSeconds = 0;
  let aggregate: PathCost = EMPTY_PATH_COST;

  for (const [stintIndex, stint] of stints.entries()) {
    for (let lap = stint.startLap; lap <= stint.endLap; lap += 1) {
      const tyreAge = lap - stint.startLap;
      const components = lapCost(
        model,
        lap,
        stint.compound,
        tyreAge,
        stintIndex > 0 && lap === stint.startLap,
      );
      cumulativeSeconds += components.totalSeconds;
      aggregate = addPathCost(aggregate, components);
      lapCosts.push({
        lap,
        compound: stint.compound,
        tyreAge,
        baselineSeconds: components.baselineSeconds,
        compoundOffsetSeconds: components.compoundOffsetSeconds,
        linearDegradationSeconds:
          components.linearDegradationSeconds,
        quadraticDegradationSeconds:
          components.quadraticDegradationSeconds,
        tyreState: components.tyreState,
        fuelGainSeconds: components.fuelGainSeconds,
        pitLossSeconds: components.pitLossSeconds,
        lapTimeSeconds: components.totalSeconds,
        cumulativeSeconds,
      });
    }
  }

  const totalSeconds =
    aggregate.baselineSeconds +
    aggregate.compoundOffsetSeconds +
    aggregate.linearDegradationSeconds +
    aggregate.quadraticDegradationSeconds +
    aggregate.tyreStateLossSeconds -
    aggregate.fuelGainSeconds +
    aggregate.pitLossSeconds;
  const breakdown: CostBreakdown = {
    ...aggregate,
    totalSeconds,
  };

  const violations: string[] = [];
  const stopCount = stints.length - 1;
  if (stopCount < rules.minStops || stopCount > rules.maxStops) {
    violations.push(
      `Pit-stop count must be between ${rules.minStops} and ${rules.maxStops}.`,
    );
  }

  const compoundsUsed = uniqueCompounds(stints);
  if (rules.requireTwoDryCompounds && compoundsUsed.length < 2) {
    violations.push(
      "A dry race must use at least two distinct compounds.",
    );
  }

  for (const stint of stints) {
    if (stint.laps < rules.minStintLaps) {
      violations.push(
        `${stint.compound} stint on laps ${stint.startLap}-${stint.endLap} is shorter than ${rules.minStintLaps} laps.`,
      );
    }
    const maximum = model.compounds[stint.compound].maxStintLaps;
    if (stint.laps > maximum) {
      violations.push(
        `${stint.compound} stint on laps ${stint.startLap}-${stint.endLap} exceeds its ${maximum}-lap limit.`,
      );
    }
  }

  return {
    scenarioSignature,
    totalSeconds,
    formattedTime: formatRaceTime(totalSeconds),
    stopCount,
    pitAfterLaps: stints.slice(0, -1).map((stint) => stint.endLap),
    compoundsUsed,
    stints,
    breakdown,
    lapCosts,
    isLegal: violations.length === 0,
    violations,
  };
}

/** Returns only the aggregate cost fields for compact cards/charts. */
export function calculateCostBreakdown(
  input: StrategyCostInput,
): CostBreakdown {
  return evaluateStrategy(input).breakdown;
}

/**
 * Finds the globally fastest K unique legal strategies (Top 3 by default).
 *
 * Each DP state retains its K cheapest distinct histories. Because future
 * transition costs depend only on the state tuple, this is sufficient to
 * recover the global K-best complete paths.
 */
export function optimizeTyreStrategies(
  input: StrategyOptimizerInput = {},
): StrategyResult[] {
  const { model, rules } = resolveProblem(input);
  const requestedTopK = input.topK ?? DEFAULT_TOP_K;
  if (
    !Number.isInteger(requestedTopK) ||
    requestedTopK < 1 ||
    requestedTopK > 20
  ) {
    throw new RangeError("topK must be an integer between 1 and 20.");
  }

  const startingCompounds =
    input.allowedStartingCompounds === undefined
      ? COMPOUNDS
      : [...new Set(input.allowedStartingCompounds)];
  if (startingCompounds.length === 0) {
    throw new RangeError(
      "allowedStartingCompounds must contain at least one compound.",
    );
  }
  for (const compound of startingCompounds) {
    if (!isCompound(compound)) {
      throw new TypeError(`Unknown starting compound: ${String(compound)}.`);
    }
  }

  // Outer array is the explicit `lap` axis of
  // DP[lap][compound][tyreAge][usedMask][stops].
  const dp: Array<Map<string, PathNode[]>> = Array.from(
    { length: model.laps + 1 },
    () => new Map<string, PathNode[]>(),
  );

  for (const compound of startingCompounds) {
    const components = lapCost(model, 1, compound, 0, false);
    const node: PathNode = {
      lap: 1,
      compound,
      tyreAge: 0,
      usedMask: COMPOUND_BITS[compound],
      stops: 0,
      totalSeconds: components.totalSeconds,
      cost: addPathCost(EMPTY_PATH_COST, components),
      previous: null,
      pittedBeforeLap: false,
      pathKey: compound,
    };
    insertKBest(
      dp[1],
      stateKey(compound, 0, node.usedMask, 0),
      node,
      requestedTopK,
    );
  }

  for (let lap = 1; lap < model.laps; lap += 1) {
    const currentLayer = dp[lap];
    const nextLayer = dp[lap + 1];
    const nextLap = lap + 1;

    for (const candidates of currentLayer.values()) {
      for (const candidate of candidates) {
        const nextAge = candidate.tyreAge + 1;
        const currentParameters =
          model.compounds[candidate.compound];

        if (nextAge < currentParameters.maxStintLaps) {
          const components = lapCost(
            model,
            nextLap,
            candidate.compound,
            nextAge,
            false,
          );
          const continued: PathNode = {
            lap: nextLap,
            compound: candidate.compound,
            tyreAge: nextAge,
            usedMask: candidate.usedMask,
            stops: candidate.stops,
            totalSeconds:
              candidate.totalSeconds + components.totalSeconds,
            cost: addPathCost(candidate.cost, components),
            previous: candidate,
            pittedBeforeLap: false,
            pathKey: `${candidate.pathKey}${candidate.compound}`,
          };
          insertKBest(
            nextLayer,
            stateKey(
              continued.compound,
              continued.tyreAge,
              continued.usedMask,
              continued.stops,
            ),
            continued,
            requestedTopK,
          );
        }

        const currentStintLaps = candidate.tyreAge + 1;
        if (
          candidate.stops >= rules.maxStops ||
          currentStintLaps < rules.minStintLaps
        ) {
          continue;
        }

        for (const nextCompound of COMPOUNDS) {
          const components = lapCost(
            model,
            nextLap,
            nextCompound,
            0,
            true,
          );
          const pitted: PathNode = {
            lap: nextLap,
            compound: nextCompound,
            tyreAge: 0,
            usedMask:
              candidate.usedMask | COMPOUND_BITS[nextCompound],
            stops: candidate.stops + 1,
            totalSeconds:
              candidate.totalSeconds + components.totalSeconds,
            cost: addPathCost(candidate.cost, components),
            previous: candidate,
            pittedBeforeLap: true,
            pathKey: `${candidate.pathKey}|${nextCompound}`,
          };
          insertKBest(
            nextLayer,
            stateKey(
              pitted.compound,
              pitted.tyreAge,
              pitted.usedMask,
              pitted.stops,
            ),
            pitted,
            requestedTopK,
          );
        }
      }
    }
  }

  const finalCandidates: PathNode[] = [];
  for (const candidates of dp[model.laps].values()) {
    for (const candidate of candidates) {
      if (
        candidate.stops < rules.minStops ||
        candidate.stops > rules.maxStops ||
        candidate.tyreAge + 1 < rules.minStintLaps ||
        (rules.requireTwoDryCompounds &&
          countUsedCompounds(candidate.usedMask) < 2)
      ) {
        continue;
      }
      finalCandidates.push(candidate);
    }
  }
  finalCandidates.sort(compareCandidates);

  const seen = new Set<string>();
  const results: StrategyResult[] = [];

  for (const candidate of finalCandidates) {
    const stints = reconstructStints(candidate);
    const signature = strategySignature(stints);
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);

    const evaluation = evaluateStrategy({
      track: model,
      stints,
      rules,
    });
    if (!evaluation.isLegal) {
      continue;
    }

    results.push({
      ...evaluation,
      rank: results.length + 1,
      signature,
    });
    if (results.length === requestedTopK) {
      break;
    }
  }

  return results;
}

/** Concise alias for UI/server callers. */
export const solveStrategy = optimizeTyreStrategies;
