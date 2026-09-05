from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass

import numpy as np  # type: ignore

from fastf1_austria_2025 import (
    COMPOUNDS,
    adjusted_points,
    clean_session,
    coefficient_se,
    coefficient_value,
    fastf1,
    fit_ols,
    make_design,
)


@dataclass(frozen=True)
class EventConfig:
    key: str
    fastf1_event: str
    title: str
    event: str
    circuit: str
    track_id: str
    profile: str
    absolute_compounds: dict[str, str]
    compound_source_url: str
    race_source_url: str


EVENTS = (
    EventConfig(
        key="bahrain",
        fastf1_event="Bahrain",
        title="2025 바레인 GP",
        event="Bahrain Grand Prix",
        circuit="Bahrain International Circuit",
        track_id="bahrain",
        profile="고열화 · 열적 부하",
        absolute_compounds={"SOFT": "C3", "MEDIUM": "C2", "HARD": "C1"},
        compound_source_url=(
            "https://press.pirelli.com/in-bahrain-with-prior-knowledge/"
        ),
        race_source_url=(
            "https://www.formula1.com/en/latest/article/"
            "what-the-teams-said-race-day-in-bahrain-2025."
            "6hmWOxPeTgdGYgSMFu7hSN"
        ),
    ),
    EventConfig(
        key="spain",
        fastf1_event="Spain",
        title="2025 스페인 GP",
        event="Spanish Grand Prix",
        circuit="Circuit de Barcelona-Catalunya",
        track_id="barcelona",
        profile="고열화 · 고속 횡하중",
        absolute_compounds={"SOFT": "C3", "MEDIUM": "C2", "HARD": "C1"},
        compound_source_url=(
            "https://press.pirelli.com/the-hardest-tyres-are-back-for-spain/"
        ),
        race_source_url=(
            "https://www.formula1.com/en/latest/article/"
            "what-the-teams-said-race-day-in-spain-2025."
            "4r3Fv2xLllXetsv79itYEQ"
        ),
    ),
    EventConfig(
        key="austria",
        fastf1_event="Austria",
        title="2025 오스트리아 GP",
        event="Austrian Grand Prix",
        circuit="Red Bull Ring",
        track_id="spielberg",
        profile="중간 열화 · 짧은 랩",
        absolute_compounds={"SOFT": "C5", "MEDIUM": "C4", "HARD": "C3"},
        compound_source_url=(
            "https://press.pirelli.com/"
            "both-new-and-familiar-for-spielberg-to-budapest/"
        ),
        race_source_url=(
            "https://www.formula1.com/en/latest/article/"
            "what-the-teams-said-race-day-in-austria-2025."
            "7inpE3O5kFlUaPMcI5dxx8"
        ),
    ),
    EventConfig(
        key="hungary",
        fastf1_event="Hungary",
        title="2025 헝가리 GP",
        event="Hungarian Grand Prix",
        circuit="Hungaroring",
        track_id="hungaroring",
        profile="전략 경계 · 1스톱 vs 2스톱",
        absolute_compounds={"SOFT": "C5", "MEDIUM": "C4", "HARD": "C3"},
        compound_source_url=(
            "https://press.pirelli.com/"
            "hungary-hits-40-before-the-summer-break/"
        ),
        race_source_url=(
            "https://www.formula1.com/en/latest/article/"
            "norris-holds-of-piastri-in-thrilling-battle-to-win-"
            "hungarian-grand-prix.3nguaFMU2JVNsT9QWopwzK"
        ),
    ),
    EventConfig(
        key="italy",
        fastf1_event="Italy",
        title="2025 이탈리아 GP",
        event="Italian Grand Prix",
        circuit="Autodromo Nazionale di Monza",
        track_id="monza",
        profile="저열화 · 음성 대조군",
        absolute_compounds={"SOFT": "C5", "MEDIUM": "C4", "HARD": "C3"},
        compound_source_url=(
            "https://press.pirelli.com/"
            "art-history-and-speed-monza-gets-ever-more-special/"
        ),
        race_source_url=(
            "https://www.formula1.com/en/latest/article/"
            "what-the-teams-said-race-day-in-italy-2025."
            "2lj5NmrwbAdbZekiI39SLL"
        ),
    ),
)


def estimate_is_reliable(
    *,
    slope: float,
    ci_low: float,
    ci_high: float,
    laps: int,
    stints: int,
) -> bool:
    return (
        slope > 0
        and ci_low > 0
        and ci_high > ci_low
        and laps >= 40
        and stints >= 4
    )


def analyse_event(config: EventConfig) -> dict[str, object]:
    session = fastf1.get_session(2025, config.fastf1_event, "R")
    session.load(
        laps=True,
        telemetry=False,
        weather=True,
        messages=True,
    )
    cleaned, funnel = clean_session(session.laps)

    stint_keys = ["Driver", "Stint"]
    train_indices: list[int] = []
    test_indices: list[int] = []
    for _, group in cleaned.groupby(stint_keys):
        ordered = group.sort_values("LapNumber")
        split = min(
            len(ordered) - 1,
            max(4, math.ceil(len(ordered) * 0.75)),
        )
        train_indices.extend(ordered.index[:split].tolist())
        test_indices.extend(ordered.index[split:].tolist())

    training = cleaned.loc[sorted(train_indices)].copy()
    validation = cleaned.loc[sorted(test_indices)].copy()
    train_coef, _, train_design, robust_training = fit_ols(training)
    validation_x, _ = make_design(validation, train_design)
    validation_error = (
        validation["LapTimeSeconds"].to_numpy(dtype=float)
        - validation_x @ train_coef
    )
    mae = float(np.mean(np.abs(validation_error)))
    rmse = float(np.sqrt(np.mean(validation_error**2)))

    coefficients, standard_errors, design, robust_full = fit_ols(cleaned)
    compound_results: list[dict[str, object]] = []
    for compound in COMPOUNDS:
        offset_name = f"offset:{compound}"
        offset = (
            coefficient_value(coefficients, design, offset_name)
            if compound != "MEDIUM"
            else 0.0
        )
        age_name = f"age:{compound}"
        slope = coefficient_value(coefficients, design, age_name)
        se = coefficient_se(standard_errors, design, age_name)
        ci_low = slope - 1.96 * se
        ci_high = slope + 1.96 * se
        subset = robust_full[robust_full["Compound"] == compound]
        laps = int(len(subset))
        stints = int(subset.groupby(stint_keys).ngroups)
        reliable = estimate_is_reliable(
            slope=slope,
            ci_low=ci_low,
            ci_high=ci_high,
            laps=laps,
            stints=stints,
        )
        compound_results.append(
            {
                "compound": compound[0],
                "label": compound.title(),
                "absoluteCompound": config.absolute_compounds[compound],
                "laps": laps,
                "stints": stints,
                "offsetSeconds": round(offset, 4),
                "alphaSecondsPerLap": round(slope, 4),
                "ci95Low": round(ci_low, 4),
                "ci95High": round(ci_high, 4),
                "maxObservedTyreLife": (
                    int(subset["TyreLife"].max()) if laps else 0
                ),
                "decision": (
                    "learned" if reliable else "project-fallback"
                ),
                "decisionReason": (
                    f"{stints}개 스틴트·{laps}랩에서 양의 효과와 "
                    "0을 벗어난 95% 신뢰구간을 확인했습니다."
                    if reliable
                    else "표본 수, 기울기 방향 또는 95% 신뢰구간 기준을 "
                    "충족하지 않아 프로젝트값을 유지합니다."
                ),
            }
        )

    fitted_outliers = len(cleaned) - len(robust_full)
    funnel.append(
        {
            "key": "robust",
            "label": "강건 회귀 최종",
            "remaining": len(robust_full),
            "excluded": fitted_outliers,
        }
    )

    return {
        "id": f"fastf1-2025-{config.key}-race-v1",
        "title": config.title,
        "event": config.event,
        "circuit": config.circuit,
        "trackId": config.track_id,
        "profile": config.profile,
        "season": 2025,
        "session": "Race",
        "scope": "건식·녹색기 정상 랩",
        "classification": "processed-fastf1-aggregate",
        "isLive": False,
        "isOfficialF1TimingProduct": False,
        "generatedBy": "analysis/fastf1_multi_event_2025.py",
        "source": {
            "library": "FastF1 3.8.3",
            "retrievedAt": "2026-07-30",
            "documentationUrl": "https://docs.fastf1.dev/",
            "compoundAllocation": " · ".join(
                (
                    f"{config.absolute_compounds['HARD']} Hard",
                    f"{config.absolute_compounds['MEDIUM']} Medium",
                    f"{config.absolute_compounds['SOFT']} Soft",
                )
            ),
            "compoundSourceUrl": config.compound_source_url,
            "raceSourceUrl": config.race_source_url,
            "researchUrl": (
                "https://journals.sagepub.com/doi/full/"
                "10.1177/22150218261446170"
            ),
        },
        "methodology": {
            "estimator": "고정효과 회귀 + 잔차 IQR 강건 정제",
            "formula": (
                "LapTime ~ Driver + RaceLap + RaceLap² + TrackTemp + "
                "Compound + Compound×TyreLife"
            ),
            "validation": "각 스틴트 앞 75% 학습 → 뒤 25% 예측",
            "quickLapFilterUsed": False,
            "randomLapSplitUsed": False,
        },
        "funnel": funnel,
        "summary": {
            "drivers": int(robust_full["Driver"].nunique()),
            "stints": int(robust_full.groupby(stint_keys).ngroups),
            "rawLaps": int(len(session.laps)),
            "modelLaps": int(len(robust_full)),
            "outliersRemoved": fitted_outliers,
            "trackTempMinC": round(
                float(robust_full["TrackTemp"].min()),
                1,
            ),
            "trackTempMaxC": round(
                float(robust_full["TrackTemp"].max()),
                1,
            ),
        },
        "coefficients": compound_results,
        "plotPoints": adjusted_points(
            robust_full,
            coefficients,
            design,
        ),
        "validation": {
            "trainLaps": int(len(robust_training)),
            "testLaps": int(len(validation)),
            "maeSeconds": round(mae, 3),
            "rmseSeconds": round(rmse, 3),
        },
        "caveats": [
            "타이어 센서의 물리적 마모율이 아니라 공개 랩타임에서 "
            "추정한 실전 페이스 저하 효과입니다.",
            "드라이버와 경기 진행 추세를 통제했지만 교통·타이어 관리·"
            "실제 연료량은 완전히 분리할 수 없습니다.",
            "2025 경기 사례이며 규격이 달라진 2026 타이어의 직접 "
            "보정값으로 해석하지 않습니다.",
            "실제 피트 전략은 경쟁·팀 지시를 포함하므로 정답 전략으로 "
            "취급하지 않습니다.",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--event",
        choices=[event.key for event in EVENTS] + ["all"],
        default="all",
    )
    parser.add_argument(
        "--summary",
        action="store_true",
        help="Omit chart points and repeated prose for a compact audit output.",
    )
    arguments = parser.parse_args()
    selected = (
        EVENTS
        if arguments.event == "all"
        else tuple(
            event for event in EVENTS if event.key == arguments.event
        )
    )
    results = [analyse_event(event) for event in selected]
    if arguments.summary:
        for result in results:
            result.pop("plotPoints", None)
            result.pop("caveats", None)
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
