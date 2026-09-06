/** 새 모델 계수의 단일 출처. 실측 계수는 별도 원자료 JSON에 저장한다. */
export const MODEL_PARAMS = {
  // 단위: 수막/랩 및 무차원. 출처: 사용자 제공 모델 명세, 프로젝트 추정.
  weather: {
    lightRainRate: 0.04, heavyRainRate: 0.10, dryRate: 0.035,
    carDryingFactor: 0.5, referenceCars: 20, hotTrackC: 35, hotDryingFactor: 1.3,
    defaultStartFraction: 0.35, defaultEndFraction: 0.7, defaultInitialWater: 0,
    slickLimit: 0.10, interLower: 0.15, interUpper: 0.55,
    // 단위: 초 및 초/수막. 출처: 사용자 명세, 프로젝트 추정. 불연속 식을 그대로 보존.
    slickDampPenalty: 0.3, slickWetBase: 8, slickWetSlope: 30,
    interBase: 3.5, interDeepBase: 6, interDeepSlope: 20, wetBase: 7,
    // 단위: 초/타이어 나이 랩. 출처: 사용자 명세, 프로젝트 추정.
    interWear: 0.045, interDryWear: 0.12, wetWear: 0.035,
    interHeatPerDryLap: 0.25, wetHeatPerDryLap: 0.4,
    // 단위: °C 및 %. 온도/그립은 연출용이며 페이스 계산에 재투입하지 않음. 프로젝트 추정.
    wetDisplayTemperatureC: 65, wetDisplayMinC: 50, wetDisplayMaxC: 80,
    maxPercent: 100,
    // 단위: 스톱. 출처: 요청된 탐색 범위(스포츠 규정상 최대 횟수가 아님).
    maxStops: 3,
  },
  performance: {
    // 단위: 레이팅 점수. 출처: EA F1 공식 게임 레이팅 척도.
    ratingMin: 0, ratingMax: 100,
    // 단위: 레이팅 점수 및 초/점. EA 공식 점수를 시간으로 변환하는 프로젝트 규칙.
    paceReference: 88, paceSecondsPerPoint: 0.03,
    experienceReference: 80, wearPerExperiencePoint: 0.0015,
    wetOverallWeight: 0.6, wetAwarenessWeight: 0.4,
    wetReference: 85, wetPenaltyPerPoint: 0.01,
    teamDegMin: 0.9, teamDegMax: 1.15,
    // 단위: 무차원. 검증되지 않은 팀/피트 데이터는 보정 0, 마모 배수 1로 대체.
    neutralPaceSeconds: 0, neutralDeg: 1, neutralPitDeltaSeconds: 0,
  },
  historical: {
    // 단위: 랩/스틴트/표준정규배수. 기존 프로젝트 최소 표본 게이트 및 양측 95% CI.
    minLaps: 40, minStints: 4, confidenceZ: 1.96, minTeamEvents: 2,
    // 단위: 비율/초. 관측 프록시를 보수적으로 반영하는 프로젝트 추정. 원 관측치는 보존한다.
    teamPaceShrink: 0.25, maxTeamPaceSeconds: 0.6, teamDegShrink: 0.25,
    // 단위: 초. 사용자 명세의 피트 손실 고정값 교체 최소 차이.
    pitAdoptionDifferenceSeconds: 3,
  },
  wetVisual: {
    // 단위: 무차원/개/m. 젖은 노면 광택과 물보라는 계산에 영향을 주지 않는 프로젝트 연출값.
    roughnessDry: 0.91, roughnessWet: 0.22, metalnessDry: 0.01, metalnessWet: 0.12,
    sprayCount: 48, sprayOpacity: 0.18, spraySizeMeters: 0.3, sprayLengthMeters: 10,
    sprayStartMeters: 3, sprayWidthMeters: 2, sprayHeightMeters: 1.4, phaseFrequency: 1.7,
  },
  race: {
    // 단위: 횟수/시드/대수. 사용자 명세에 따른 재현 가능한 프로젝트 실험 설정.
    trials: 300, defaultSeed: 20260906, gridSize: 20,
    // 단위: 비율/초/랩. SC 피트 할인·교통·정산 규칙은 프로젝트 추정.
    scPitFactor: 0.55, vscPitFactor: 0.7, followingGapSeconds: 1,
    trafficLossFraction: 0.4, undercutSettlingLaps: 3,
    minimumDistinctSeconds: 0.5,
    // 단위: 확률/랩. 공식 2018–2025 통계 미확보 시 명시적으로 사용하는 실험용 사전값.
    fallbackScProbability: 0.35, fallbackVscProbability: 0.25,
    scDurations: [2, 3, 4, 5] as readonly number[], vscDurations: [1, 2] as readonly number[],
    eventStartFraction: 0.08, eventEndFraction: 0.9,
    overtakeBase: 0.15, racecraftReference: 80, overtakePerRating: 0.008,
    overtakePerPaceSecond: 0.2, overtakeMin: 0.02, overtakeMax: 0.85,
    gridGapSeconds: 0.3, rivalPaceStepSeconds: 0.08,
    // 단위: uint32. 출처: Mulberry32 / Tommy Ettinger, 퍼블릭 도메인 난수 생성기.
    seedIncrement: 0x6D2B79F5, uintRange: 4294967296,
  },
  validation: {
    // 단위: 초/비율/랩. 사용자 요구의 회귀 검사 허용 범위(실측 주장이 아님).
    toleranceSeconds: 1e-7, fuelMinSeconds: 1.2, fuelMaxSeconds: 3,
    cliffMinimumSeconds: 2, cliffOldAge: 24, cliffNewAge: 4,
    pitSensitivitySeconds: 0.3, bruteForceLaps: 8,
    crossoverStep: 0.0001,
  },
  board: {
    // 단위: px, 출처: 사용자 제공 Pirelli 2026 그래픽 실측 명세 (1500×844 기준).
    width: 1500, height: 844, rowGap: 127, lineWidth: 3, lineStart: 31, lineEnd: 1410,
    pitWheel: 66, finishX: 1441, fadeWidth: 120, windowGap: 16, windowFont: 24,
    stopLabelGap: 18, dividerY: 709, legendWheel: 72,
    // 단위: px. 제공된 실측 외 여백/글꼴 배치는 프로젝트 디자인 선택.
    firstRowY: 240, headerY: 32, titleY: 72, headerRuleY: 112, headerFont: 18,
    titleFont: 40, brandFont: 32, legendY: 770, legendStart: 31, legendStep: 195,
    legendLabelFont: 20, footerFont: 16, factsX: 1060, trackFactX: 1300, selectionPadding: 16,
  },
} as const;

/** 색상: 사용자 제공 Pirelli 그래픽 명세. 의미 색상은 팀 테마와 독립. */
export const TYRE_COLORS = { S: "#d81d21", M: "#f6c847", H: "#ebebeb", INTER: "#43b02a", WET: "#0067ad" } as const;
export const TYRE_LABELS = { S: "소프트", M: "미디엄", H: "하드", INTER: "인터미디어트", WET: "웨트" } as const;
export const RAIN_LABELS = { none: "없음", light: "약한 비", heavy: "강한 비", "dry-to-rain": "마른 뒤 비", "rain-to-dry": "비 뒤 마름" } as const;
