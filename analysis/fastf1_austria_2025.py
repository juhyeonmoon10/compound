from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

import fastf1  # type: ignore  # noqa: E402
import numpy as np  # type: ignore  # noqa: E402
import pandas as pd  # type: ignore  # noqa: E402


ROOT = Path(__file__).resolve().parents[1]
CACHE_DIR = ROOT / "work" / "fastf1-cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
fastf1.Cache.enable_cache(str(CACHE_DIR))

COMPOUNDS = ("SOFT", "MEDIUM", "HARD")


@dataclass(frozen=True)
class Design:
    names: list[str]
    drivers: list[str]
    race_lap_mean: float
    race_lap_scale: float
    track_temp_mean: float


def clean_session(laps: pd.DataFrame) -> tuple[pd.DataFrame, list[dict[str, int | str]]]:
    working = laps.copy()
    funnel: list[dict[str, int | str]] = [
        {"key": "raw", "label": "전체 기록 랩", "remaining": len(working), "excluded": 0}
    ]

    def apply_stage(key: str, label: str, mask: pd.Series) -> None:
        nonlocal working
        before = len(working)
        working = working[mask.loc[working.index]].copy()
        funnel.append(
            {
                "key": key,
                "label": label,
                "remaining": len(working),
                "excluded": before - len(working),
            }
        )

    apply_stage(
        "dry",
        "건식 S·M·H",
        laps["Compound"].isin(COMPOUNDS)
        & laps["LapTime"].notna()
        & laps["TyreLife"].notna()
        & laps["Stint"].notna(),
    )
    apply_stage(
        "accurate",
        "정확도 조건 통과",
        laps["IsAccurate"].fillna(False)
        & laps["Deleted"].ne(True)
        & ~laps["FastF1Generated"].fillna(False),
    )
    apply_stage(
        "green",
        "녹색기",
        laps["TrackStatus"].eq("1"),
    )
    apply_stage(
        "race",
        "피트·첫 랩 제외",
        laps["PitInTime"].isna()
        & laps["PitOutTime"].isna()
        & laps["LapNumber"].gt(1),
    )

    working["LapTimeSeconds"] = working["LapTime"].dt.total_seconds()
    weather = working.get_weather_data()
    if "TrackTemp" in weather:
        working["TrackTemp"] = pd.to_numeric(
            weather["TrackTemp"], errors="coerce"
        ).to_numpy()
    else:
        working["TrackTemp"] = np.nan
    working["TrackTemp"] = working["TrackTemp"].fillna(
        working["TrackTemp"].median()
    )

    group_columns = ["Driver", "Stint"]
    valid_groups: list[tuple[str, float]] = []
    for key, group in working.groupby(group_columns):
        if (
            len(group) >= 5
            and group["Compound"].nunique() == 1
            and group["TyreLife"].is_monotonic_increasing
        ):
            valid_groups.append(key)

    group_index = pd.MultiIndex.from_tuples(valid_groups, names=group_columns)
    row_group_index = pd.MultiIndex.from_frame(working[group_columns])
    valid_stint_mask = row_group_index.isin(group_index)
    before = len(working)
    working = working[valid_stint_mask].copy()
    funnel.append(
        {
            "key": "stints",
            "label": "회귀 사용 랩",
            "remaining": len(working),
            "excluded": before - len(working),
        }
    )
    return working.reset_index(drop=True), funnel


def make_design(frame: pd.DataFrame, design: Design | None = None) -> tuple[np.ndarray, Design]:
    if design is None:
        drivers = sorted(frame["Driver"].unique().tolist())
        race_lap_mean = float(frame["LapNumber"].mean())
        race_lap_scale = max(1.0, float(frame["LapNumber"].std(ddof=0)))
        track_temp_mean = float(frame["TrackTemp"].mean())
    else:
        drivers = design.drivers
        race_lap_mean = design.race_lap_mean
        race_lap_scale = design.race_lap_scale
        track_temp_mean = design.track_temp_mean

    race_centered = (
        frame["LapNumber"].to_numpy(dtype=float) - race_lap_mean
    ) / race_lap_scale
    temp_centered = frame["TrackTemp"].to_numpy(dtype=float) - track_temp_mean

    columns: list[np.ndarray] = [np.ones(len(frame))]
    names = ["intercept"]
    columns.extend([race_centered, race_centered**2, temp_centered])
    names.extend(["race_progress", "race_progress_sq", "track_temp"])

    for driver in drivers[1:]:
        columns.append((frame["Driver"].to_numpy() == driver).astype(float))
        names.append(f"driver:{driver}")

    for compound in ("SOFT", "HARD"):
        columns.append((frame["Compound"].to_numpy() == compound).astype(float))
        names.append(f"offset:{compound}")

    tyre_life = frame["TyreLife"].to_numpy(dtype=float)
    for compound in COMPOUNDS:
        columns.append(
            tyre_life
            * (frame["Compound"].to_numpy() == compound).astype(float)
        )
        names.append(f"age:{compound}")

    return np.column_stack(columns), Design(
        names=names,
        drivers=drivers,
        race_lap_mean=race_lap_mean,
        race_lap_scale=race_lap_scale,
        track_temp_mean=track_temp_mean,
    )


def fit_ols(
    frame: pd.DataFrame,
    design: Design | None = None,
    robust: bool = True,
) -> tuple[np.ndarray, np.ndarray, Design, pd.DataFrame]:
    current = frame.copy()
    base_design = design
    coefficients: np.ndarray | None = None
    x: np.ndarray | None = None
    fitted_design: Design | None = None

    for _ in range(3 if robust else 1):
        x, fitted_design = make_design(current, base_design)
        y = current["LapTimeSeconds"].to_numpy(dtype=float)
        coefficients = np.linalg.lstsq(x, y, rcond=None)[0]
        residual = y - x @ coefficients
        if not robust:
            break
        q1, q3 = np.quantile(residual, [0.25, 0.75])
        iqr = max(0.05, q3 - q1)
        keep = (residual >= q1 - 3 * iqr) & (residual <= q3 + 3 * iqr)
        if keep.all():
            break
        current = current.loc[keep].copy()
        base_design = fitted_design

    assert coefficients is not None and x is not None and fitted_design is not None
    # The final IQR pass may still remove rows. Refit once on the exact final
    # frame so the design matrix, coefficients and residuals always align.
    x, fitted_design = make_design(current, base_design)
    y = current["LapTimeSeconds"].to_numpy(dtype=float)
    coefficients = np.linalg.lstsq(x, y, rcond=None)[0]
    residual = y - x @ coefficients
    dof = max(1, len(y) - x.shape[1])
    sigma_sq = float(residual @ residual) / dof
    covariance = sigma_sq * np.linalg.pinv(x.T @ x)
    standard_errors = np.sqrt(np.maximum(0, np.diag(covariance)))
    return coefficients, standard_errors, fitted_design, current


def coefficient_value(
    coefficients: np.ndarray, design: Design, name: str
) -> float:
    return float(coefficients[design.names.index(name)])


def coefficient_se(
    standard_errors: np.ndarray, design: Design, name: str
) -> float:
    return float(standard_errors[design.names.index(name)])


def adjusted_points(
    frame: pd.DataFrame,
    coefficients: np.ndarray,
    design: Design,
) -> list[dict[str, float | str]]:
    x, _ = make_design(frame, design)
    prediction = x @ coefficients
    result = frame[["Compound", "TyreLife", "LapTimeSeconds"]].copy()
    result["Adjusted"] = (
        result["LapTimeSeconds"].to_numpy()
        - prediction
        + np.array(
            [
                coefficient_value(coefficients, design, f"offset:{compound}")
                if compound != "MEDIUM"
                else 0.0
                for compound in result["Compound"]
            ]
        )
        + np.array(
            [
                coefficient_value(coefficients, design, f"age:{compound}") * age
                for compound, age in zip(result["Compound"], result["TyreLife"])
            ]
        )
    )

    points: list[dict[str, float | str]] = []
    for compound, group in result.groupby("Compound"):
        ages = sorted(group["TyreLife"].unique())
        if not ages:
            continue
        target_ages = np.linspace(min(ages), max(ages), min(12, len(ages)))
        for target in target_ages:
            nearest_age = min(ages, key=lambda age: abs(age - target))
            bucket = group[group["TyreLife"] == nearest_age]
            points.append(
                {
                    "compound": compound[0],
                    "tyreLife": round(float(nearest_age), 1),
                    "adjustedSeconds": round(float(bucket["Adjusted"].median()), 3),
                    "samples": int(len(bucket)),
                }
            )
    return points


def analyse() -> dict[str, object]:
    session = fastf1.get_session(2025, "Austria", "R")
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
        split = min(len(ordered) - 1, max(4, math.ceil(len(ordered) * 0.75)))
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
    absolute_map = {"SOFT": "C5", "MEDIUM": "C4", "HARD": "C3"}
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
        subset = robust_full[robust_full["Compound"] == compound]
        compound_results.append(
            {
                "compound": compound[0],
                "label": compound.title(),
                "absoluteCompound": absolute_map[compound],
                "laps": int(len(subset)),
                "stints": int(subset.groupby(stint_keys).ngroups),
                "offsetSeconds": round(offset, 4),
                "alphaSecondsPerLap": round(max(0.0, slope), 4),
                "rawSlopeSecondsPerLap": round(slope, 4),
                "ci95Low": round(slope - 1.96 * se, 4),
                "ci95High": round(slope + 1.96 * se, 4),
                "maxObservedTyreLife": int(subset["TyreLife"].max()),
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
        "id": "2025-austria-race",
        "title": "2025 오스트리아 GP",
        "event": "Austrian Grand Prix",
        "circuit": "Red Bull Ring",
        "season": 2025,
        "session": "Race",
        "scope": "완전 건식·녹색기 정상 랩",
        "source": {
            "name": "FastF1 3.8.3",
            "url": "https://docs.fastf1.dev/",
            "compoundAllocation": "C3 Hard · C4 Medium · C5 Soft",
            "compoundSourceUrl": "https://press.pirelli.com/both-new-and-familiar-for-spielberg-to-budapest/",
            "retrievedAt": "2026-07-30",
        },
        "funnel": funnel,
        "summary": {
            "drivers": int(robust_full["Driver"].nunique()),
            "stints": int(robust_full.groupby(stint_keys).ngroups),
            "rawLaps": int(len(session.laps)),
            "modelLaps": int(len(robust_full)),
            "outliersRemoved": fitted_outliers,
            "trackTempMinC": round(float(robust_full["TrackTemp"].min()), 1),
            "trackTempMaxC": round(float(robust_full["TrackTemp"].max()), 1),
        },
        "model": {
            "name": "설명 가능한 고정효과 강건 회귀",
            "formula": "LapTime ~ Driver + RaceLap + RaceLap² + TrackTemp + Compound + Compound×TyreLife",
            "coefficients": compound_results,
            "plotPoints": adjusted_points(robust_full, coefficients, design),
        },
        "validation": {
            "method": "각 스틴트 앞 75% 학습 → 뒤 25% 예측",
            "trainLaps": int(len(robust_training)),
            "testLaps": int(len(validation)),
            "maeSeconds": round(mae, 3),
            "rmseSeconds": round(rmse, 3),
            "randomSplitUsed": False,
        },
        "caveats": [
            "공개 랩타임에서 추정한 실전 페이스 효과이며 타이어 센서의 물리적 마모율이 아닙니다.",
            "드라이버 고정효과와 경기 진행 추세를 통제했지만 교통·타이어 관리·실제 연료량은 완전히 분리할 수 없습니다.",
            "2025 C3·C4·C5 사례이며 규격이 달라진 2026 타이어의 직접 보정값으로 해석하지 않습니다.",
            "실제 피트 전략은 교통·경쟁·팀 지시를 포함하므로 정답 전략으로 취급하지 않습니다.",
        ],
    }


if __name__ == "__main__":
    print(json.dumps(analyse(), ensure_ascii=False, indent=2))
