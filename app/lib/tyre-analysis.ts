import type {
  Compound,
  CompoundModel,
  TrackPresetId,
} from "./strategy.ts";

export type CalibrationDecision = "learned" | "project-fallback";

export interface FastF1FilterStage {
  readonly key: string;
  readonly label: string;
  readonly remaining: number;
  readonly excluded: number;
}

export interface FastF1CompoundEstimate {
  readonly compound: Compound;
  readonly label: string;
  readonly absoluteCompound: string;
  readonly laps: number;
  readonly stints: number;
  readonly offsetSeconds: number;
  /** Observed linear pace-loss effect after fixed-effect controls. */
  readonly alphaSecondsPerLap: number;
  readonly ci95Low: number;
  readonly ci95High: number;
  readonly maxObservedTyreLife: number;
  readonly decision: CalibrationDecision;
  readonly decisionReason: string;
}

export interface FastF1TyreAnalysis {
  readonly id: string;
  readonly title: string;
  readonly event: string;
  readonly circuit: string;
  readonly trackId: TrackPresetId;
  readonly profile: string;
  readonly studyRole: string;
  readonly season: 2025;
  readonly session: "Race";
  readonly scope: string;
  readonly classification: "processed-fastf1-aggregate";
  readonly isLive: false;
  readonly isOfficialF1TimingProduct: false;
  readonly generatedBy: string;
  readonly source: {
    readonly library: string;
    readonly retrievedAt: string;
    readonly documentationUrl: string;
    readonly compoundAllocation: string;
    readonly compoundSourceUrl: string;
    readonly raceSourceUrl: string;
    readonly researchUrl: string;
  };
  readonly methodology: {
    readonly estimator: string;
    readonly formula: string;
    readonly validation: string;
    readonly quickLapFilterUsed: false;
    readonly randomLapSplitUsed: false;
  };
  readonly funnel: readonly FastF1FilterStage[];
  readonly summary: {
    readonly drivers: number;
    readonly stints: number;
    readonly rawLaps: number;
    readonly modelLaps: number;
    readonly outliersRemoved: number;
    readonly trackTempMinC: number;
    readonly trackTempMaxC: number;
  };
  readonly coefficients: readonly FastF1CompoundEstimate[];
  readonly validation: {
    readonly trainLaps: number;
    readonly testLaps: number;
    readonly maeSeconds: number;
    readonly rmseSeconds: number;
  };
  readonly caveats: readonly string[];
}

export interface HistoricalTyreCalibration {
  readonly id: string;
  readonly label: string;
  readonly analysisId: string;
  readonly applicableTrackId: TrackPresetId;
  readonly fallbackCompounds: readonly Compound[];
  readonly compoundModels: Readonly<
    Partial<Record<Compound, Partial<CompoundModel>>>
  >;
  readonly note: string;
}

const COMMON_METHODOLOGY = Object.freeze({
  estimator: "고정효과 회귀 + 잔차 IQR 강건 정제",
  formula:
    "LapTime ~ Driver + RaceLap + RaceLap² + TrackTemp + Compound + Compound×TyreLife",
  validation: "각 스틴트 앞 75% 학습 → 뒤 25% 예측",
  quickLapFilterUsed: false as const,
  randomLapSplitUsed: false as const,
});

const COMMON_CAVEATS = Object.freeze([
  "타이어 센서의 물리적 마모율이 아니라 공개 랩타임에서 추정한 실전 페이스 저하 효과입니다.",
  "드라이버와 경기 진행 추세를 통제했지만 교통·타이어 관리·실제 연료량은 완전히 분리할 수 없습니다.",
  "2025 경기 사례이며 규격이 달라진 2026 타이어의 직접 보정값으로 해석하지 않습니다.",
  "실제 피트 전략은 경쟁·팀 지시를 포함하므로 정답 전략으로 취급하지 않습니다.",
]);

const COMMON_SOURCE = Object.freeze({
  library: "FastF1 3.8.3",
  retrievedAt: "2026-07-30",
  documentationUrl: "https://docs.fastf1.dev/",
  researchUrl:
    "https://journals.sagepub.com/doi/full/10.1177/22150218261446170",
});

const FUNNEL_LABELS = Object.freeze([
  ["raw", "전체 기록 랩"],
  ["dry", "건식 S·M·H"],
  ["accurate", "정확도 조건 통과"],
  ["green", "녹색기"],
  ["race", "피트·첫 랩 제외"],
  ["stints", "회귀 사용 가능"],
  ["robust", "강건 회귀 최종"],
] as const);

type EstimateInput = Omit<
  FastF1CompoundEstimate,
  "label" | "decisionReason"
>;

function estimate(input: EstimateInput): FastF1CompoundEstimate {
  const label = input.compound === "S"
    ? "Soft"
    : input.compound === "M"
      ? "Medium"
      : "Hard";
  const decisionReason =
    input.decision === "learned"
      ? `${input.stints}개 스틴트·${input.laps}랩에서 양의 효과와 0을 벗어난 95% 신뢰구간을 확인했습니다.`
      : "표본 수, 기울기 방향 또는 95% 신뢰구간 기준을 충족하지 않아 프로젝트값을 유지합니다.";
  return Object.freeze({ ...input, label, decisionReason });
}

function funnel(
  remaining: readonly number[],
): readonly FastF1FilterStage[] {
  return Object.freeze(
    FUNNEL_LABELS.map(([key, label], index) =>
      Object.freeze({
        key,
        label,
        remaining: remaining[index],
        excluded: index === 0
          ? 0
          : remaining[index - 1] - remaining[index],
      }),
    ),
  );
}

type AnalysisInput = Pick<
  FastF1TyreAnalysis,
  | "id"
  | "title"
  | "event"
  | "circuit"
  | "trackId"
  | "profile"
  | "studyRole"
  | "summary"
  | "coefficients"
  | "validation"
> & {
  readonly funnelRemaining: readonly number[];
  readonly compoundAllocation: string;
  readonly compoundSourceUrl: string;
  readonly raceSourceUrl: string;
};

function analysis(input: AnalysisInput): FastF1TyreAnalysis {
  return Object.freeze({
    id: input.id,
    title: input.title,
    event: input.event,
    circuit: input.circuit,
    trackId: input.trackId,
    profile: input.profile,
    studyRole: input.studyRole,
    season: 2025,
    session: "Race",
    scope: "건식·녹색기 정상 랩",
    classification: "processed-fastf1-aggregate",
    isLive: false,
    isOfficialF1TimingProduct: false,
    generatedBy: "analysis/fastf1_multi_event_2025.py",
    source: Object.freeze({
      ...COMMON_SOURCE,
      compoundAllocation: input.compoundAllocation,
      compoundSourceUrl: input.compoundSourceUrl,
      raceSourceUrl: input.raceSourceUrl,
    }),
    methodology: COMMON_METHODOLOGY,
    funnel: funnel(input.funnelRemaining),
    summary: Object.freeze(input.summary),
    coefficients: Object.freeze(input.coefficients),
    validation: Object.freeze(input.validation),
    caveats: COMMON_CAVEATS,
  });
}

/**
 * Processed aggregates generated by `analysis/fastf1_multi_event_2025.py`.
 * Raw timing data is not bundled. Every race uses the same cleaning,
 * fixed-effect model and time-ordered holdout.
 */
export const FASTF1_TYRE_ANALYSES = Object.freeze([
  analysis({
    id: "fastf1-2025-bahrain-race-v1",
    title: "2025 바레인 GP",
    event: "Bahrain Grand Prix",
    circuit: "Bahrain International Circuit",
    trackId: "bahrain",
    profile: "고열화 · 열적 부하",
    studyRole: "세 컴파운드가 모두 충분히 관측된 고열화 기준 사례",
    funnelRemaining: [1128, 1115, 924, 924, 924, 913, 904],
    summary: {
      drivers: 20,
      stints: 57,
      rawLaps: 1128,
      modelLaps: 904,
      outliersRemoved: 9,
      trackTempMinC: 30.2,
      trackTempMaxC: 32,
    },
    coefficients: [
      estimate({
        compound: "S",
        absoluteCompound: "C3",
        laps: 206,
        stints: 17,
        offsetSeconds: -0.3217,
        alphaSecondsPerLap: 0.1282,
        ci95Low: 0.115,
        ci95High: 0.1414,
        maxObservedTyreLife: 28,
        decision: "learned",
      }),
      estimate({
        compound: "M",
        absoluteCompound: "C2",
        laps: 442,
        stints: 26,
        offsetSeconds: 0,
        alphaSecondsPerLap: 0.1062,
        ci95Low: 0.0973,
        ci95High: 0.1151,
        maxObservedTyreLife: 31,
        decision: "learned",
      }),
      estimate({
        compound: "H",
        absoluteCompound: "C1",
        laps: 256,
        stints: 14,
        offsetSeconds: -0.237,
        alphaSecondsPerLap: 0.1304,
        ci95Low: 0.1197,
        ci95High: 0.1411,
        maxObservedTyreLife: 30,
        decision: "learned",
      }),
    ],
    validation: {
      trainLaps: 694,
      testLaps: 210,
      maeSeconds: 0.439,
      rmseSeconds: 0.594,
    },
    compoundAllocation: "C1 Hard · C2 Medium · C3 Soft",
    compoundSourceUrl:
      "https://press.pirelli.com/in-bahrain-with-prior-knowledge/",
    raceSourceUrl:
      "https://www.formula1.com/en/latest/article/what-the-teams-said-race-day-in-bahrain-2025.6hmWOxPeTgdGYgSMFu7hSN",
  }),
  analysis({
    id: "fastf1-2025-spain-race-v1",
    title: "2025 스페인 GP",
    event: "Spanish Grand Prix",
    circuit: "Circuit de Barcelona-Catalunya",
    trackId: "barcelona",
    profile: "고열화 · 고속 횡하중",
    studyRole: "고속 횡하중에서 Soft·Medium 열화를 비교하는 사례",
    funnelRemaining: [1203, 1202, 981, 980, 980, 965, 960],
    summary: {
      drivers: 19,
      stints: 68,
      rawLaps: 1203,
      modelLaps: 960,
      outliersRemoved: 5,
      trackTempMinC: 46.5,
      trackTempMaxC: 49.9,
    },
    coefficients: [
      estimate({
        compound: "S",
        absoluteCompound: "C3",
        laps: 503,
        stints: 46,
        offsetSeconds: -0.511,
        alphaSecondsPerLap: 0.0955,
        ci95Low: 0.0842,
        ci95High: 0.1068,
        maxObservedTyreLife: 25,
        decision: "learned",
      }),
      estimate({
        compound: "M",
        absoluteCompound: "C2",
        laps: 452,
        stints: 21,
        offsetSeconds: 0,
        alphaSecondsPerLap: 0.063,
        ci95Low: 0.0551,
        ci95High: 0.0709,
        maxObservedTyreLife: 35,
        decision: "learned",
      }),
      estimate({
        compound: "H",
        absoluteCompound: "C1",
        laps: 5,
        stints: 1,
        offsetSeconds: -1.9461,
        alphaSecondsPerLap: 0.3162,
        ci95Low: -0.0568,
        ci95High: 0.6893,
        maxObservedTyreLife: 11,
        decision: "project-fallback",
      }),
    ],
    validation: {
      trainLaps: 748,
      testLaps: 214,
      maeSeconds: 0.512,
      rmseSeconds: 0.698,
    },
    compoundAllocation: "C1 Hard · C2 Medium · C3 Soft",
    compoundSourceUrl:
      "https://press.pirelli.com/the-hardest-tyres-are-back-for-spain/",
    raceSourceUrl:
      "https://www.formula1.com/en/latest/article/what-the-teams-said-race-day-in-spain-2025.4r3Fv2xLllXetsv79itYEQ",
  }),
  analysis({
    id: "fastf1-2025-austria-race-v1",
    title: "2025 오스트리아 GP",
    event: "Austrian Grand Prix",
    circuit: "Red Bull Ring",
    trackId: "spielberg",
    profile: "중간 열화 · 짧은 랩",
    studyRole: "중간 수준 열화와 짧은 랩 특성을 보는 기준 사례",
    funnelRemaining: [1126, 1124, 999, 984, 984, 984, 974],
    summary: {
      drivers: 17,
      stints: 47,
      rawLaps: 1126,
      modelLaps: 974,
      outliersRemoved: 10,
      trackTempMinC: 45.9,
      trackTempMaxC: 50.4,
    },
    coefficients: [
      estimate({
        compound: "S",
        absoluteCompound: "C5",
        laps: 51,
        stints: 6,
        offsetSeconds: 0.41,
        alphaSecondsPerLap: -0.0162,
        ci95Low: -0.0519,
        ci95High: 0.0196,
        maxObservedTyreLife: 16,
        decision: "project-fallback",
      }),
      estimate({
        compound: "M",
        absoluteCompound: "C4",
        laps: 524,
        stints: 25,
        offsetSeconds: 0,
        alphaSecondsPerLap: 0.0558,
        ci95Low: 0.0501,
        ci95High: 0.0615,
        maxObservedTyreLife: 33,
        decision: "learned",
      }),
      estimate({
        compound: "H",
        absoluteCompound: "C3",
        laps: 399,
        stints: 16,
        offsetSeconds: 0.0193,
        alphaSecondsPerLap: 0.0473,
        ci95Low: 0.042,
        ci95High: 0.0526,
        maxObservedTyreLife: 41,
        decision: "learned",
      }),
    ],
    validation: {
      trainLaps: 750,
      testLaps: 228,
      maeSeconds: 0.38,
      rmseSeconds: 0.54,
    },
    compoundAllocation: "C3 Hard · C4 Medium · C5 Soft",
    compoundSourceUrl:
      "https://press.pirelli.com/both-new-and-familiar-for-spielberg-to-budapest/",
    raceSourceUrl:
      "https://www.formula1.com/en/latest/article/what-the-teams-said-race-day-in-austria-2025.7inpE3O5kFlUaPMcI5dxx8",
  }),
  analysis({
    id: "fastf1-2025-hungary-race-v1",
    title: "2025 헝가리 GP",
    event: "Hungarian Grand Prix",
    circuit: "Hungaroring",
    trackId: "hungaroring",
    profile: "전략 경계 · 1스톱 vs 2스톱",
    studyRole: "실제 1스톱과 2스톱이 우승을 다툰 전략 경계 사례",
    funnelRemaining: [1368, 1368, 1275, 1275, 1275, 1273, 1262],
    summary: {
      drivers: 20,
      stints: 48,
      rawLaps: 1368,
      modelLaps: 1262,
      outliersRemoved: 11,
      trackTempMinC: 30.6,
      trackTempMaxC: 32.3,
    },
    coefficients: [
      estimate({
        compound: "S",
        absoluteCompound: "C5",
        laps: 40,
        stints: 3,
        offsetSeconds: -0.4856,
        alphaSecondsPerLap: 0.1009,
        ci95Low: 0.0545,
        ci95High: 0.1473,
        maxObservedTyreLife: 16,
        decision: "project-fallback",
      }),
      estimate({
        compound: "M",
        absoluteCompound: "C4",
        laps: 514,
        stints: 21,
        offsetSeconds: 0,
        alphaSecondsPerLap: 0.0562,
        ci95Low: 0.0494,
        ci95High: 0.063,
        maxObservedTyreLife: 39,
        decision: "learned",
      }),
      estimate({
        compound: "H",
        absoluteCompound: "C3",
        laps: 708,
        stints: 24,
        offsetSeconds: 0.1851,
        alphaSecondsPerLap: 0.0387,
        ci95Low: 0.0337,
        ci95High: 0.0437,
        maxObservedTyreLife: 55,
        decision: "learned",
      }),
    ],
    validation: {
      trainLaps: 967,
      testLaps: 299,
      maeSeconds: 0.64,
      rmseSeconds: 0.827,
    },
    compoundAllocation: "C3 Hard · C4 Medium · C5 Soft",
    compoundSourceUrl:
      "https://press.pirelli.com/hungary-hits-40-before-the-summer-break/",
    raceSourceUrl:
      "https://www.formula1.com/en/latest/article/norris-holds-of-piastri-in-thrilling-battle-to-win-hungarian-grand-prix.3nguaFMU2JVNsT9QWopwzK",
  }),
  analysis({
    id: "fastf1-2025-italy-race-v1",
    title: "2025 이탈리아 GP",
    event: "Italian Grand Prix",
    circuit: "Autodromo Nazionale di Monza",
    trackId: "monza",
    profile: "저열화 · 음성 대조군",
    studyRole: "낮은 열화와 긴 피트 손실을 확인하는 대조 사례",
    funnelRemaining: [974, 974, 895, 878, 878, 872, 858],
    summary: {
      drivers: 19,
      stints: 34,
      rawLaps: 974,
      modelLaps: 858,
      outliersRemoved: 14,
      trackTempMinC: 40.2,
      trackTempMaxC: 44.7,
    },
    coefficients: [
      estimate({
        compound: "S",
        absoluteCompound: "C5",
        laps: 19,
        stints: 3,
        offsetSeconds: 0.1831,
        alphaSecondsPerLap: 0.0175,
        ci95Low: -0.0376,
        ci95High: 0.0725,
        maxObservedTyreLife: 11,
        decision: "project-fallback",
      }),
      estimate({
        compound: "M",
        absoluteCompound: "C4",
        laps: 384,
        stints: 15,
        offsetSeconds: 0,
        alphaSecondsPerLap: 0.027,
        ci95Low: 0.023,
        ci95High: 0.0309,
        maxObservedTyreLife: 45,
        decision: "learned",
      }),
      estimate({
        compound: "H",
        absoluteCompound: "C3",
        laps: 455,
        stints: 16,
        offsetSeconds: 0.1871,
        alphaSecondsPerLap: 0.0163,
        ci95Low: 0.0134,
        ci95High: 0.0192,
        maxObservedTyreLife: 50,
        decision: "learned",
      }),
    ],
    validation: {
      trainLaps: 658,
      testLaps: 203,
      maeSeconds: 0.246,
      rmseSeconds: 0.354,
    },
    compoundAllocation: "C3 Hard · C4 Medium · C5 Soft",
    compoundSourceUrl:
      "https://press.pirelli.com/art-history-and-speed-monza-gets-ever-more-special/",
    raceSourceUrl:
      "https://www.formula1.com/en/latest/article/what-the-teams-said-race-day-in-italy-2025.2lj5NmrwbAdbZekiI39SLL",
  }),
] satisfies readonly FastF1TyreAnalysis[]);

function calibrationFromAnalysis(
  item: FastF1TyreAnalysis,
): HistoricalTyreCalibration {
  const learned = item.coefficients.filter(
    (coefficient) => coefficient.decision === "learned",
  );
  const fallback = item.coefficients
    .filter((coefficient) => coefficient.decision === "project-fallback")
    .map((coefficient) => coefficient.compound);
  const compoundModels = Object.fromEntries(
    learned.map((coefficient) => [
      coefficient.compound,
      Object.freeze({
        alpha: coefficient.alphaSecondsPerLap,
        beta: 0,
      }),
    ]),
  ) as Partial<Record<Compound, Partial<CompoundModel>>>;
  const learnedLabels = learned.map((coefficient) => coefficient.label);
  const fallbackLabels = item.coefficients
    .filter((coefficient) => coefficient.decision === "project-fallback")
    .map((coefficient) => coefficient.label);

  return Object.freeze({
    id: `${item.trackId}-2025-reliable-slopes`,
    label: `${item.title} 실데이터 보정`,
    analysisId: item.id,
    applicableTrackId: item.trackId,
    fallbackCompounds: Object.freeze(fallback),
    compoundModels: Object.freeze(compoundModels),
    note: `${learnedLabels.join("·")} 선형 기울기만 적용${
      fallbackLabels.length > 0
        ? `하고 ${fallbackLabels.join("·")}는 표본 기준에 따라 프로젝트 모델을 유지`
        : ""
    }합니다. 초기 성능 차이와 성능 절벽은 프로젝트 모델을 유지합니다.`,
  });
}

export const HISTORICAL_TYRE_CALIBRATIONS = Object.freeze(
  FASTF1_TYRE_ANALYSES.map(calibrationFromAnalysis),
);

export const FASTF1_ANALYSIS_SUMMARY = Object.freeze({
  races: FASTF1_TYRE_ANALYSES.length,
  rawLaps: FASTF1_TYRE_ANALYSES.reduce(
    (sum, item) => sum + item.summary.rawLaps,
    0,
  ),
  modelLaps: FASTF1_TYRE_ANALYSES.reduce(
    (sum, item) => sum + item.summary.modelLaps,
    0,
  ),
  stints: FASTF1_TYRE_ANALYSES.reduce(
    (sum, item) => sum + item.summary.stints,
    0,
  ),
  learnedCoefficients: FASTF1_TYRE_ANALYSES.reduce(
    (sum, item) =>
      sum +
      item.coefficients.filter(
        (coefficient) => coefficient.decision === "learned",
      ).length,
    0,
  ),
});

export function analysisForTrack(
  trackId: TrackPresetId,
): FastF1TyreAnalysis | null {
  return (
    FASTF1_TYRE_ANALYSES.find((item) => item.trackId === trackId) ?? null
  );
}

export function historicalCalibrationForTrack(
  trackId: TrackPresetId,
): HistoricalTyreCalibration | null {
  return (
    HISTORICAL_TYRE_CALIBRATIONS.find(
      (item) => item.applicableTrackId === trackId,
    ) ?? null
  );
}

// Backwards-compatible names for existing imports and external references.
export const AUSTRIA_2025_TYRE_ANALYSIS =
  analysisForTrack("spielberg") as FastF1TyreAnalysis;
export const AUSTRIA_2025_STRATEGY_CALIBRATION =
  historicalCalibrationForTrack("spielberg") as HistoricalTyreCalibration;
