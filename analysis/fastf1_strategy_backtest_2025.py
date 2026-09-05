from __future__ import annotations

import json

import pandas as pd  # type: ignore

from fastf1_austria_2025 import fastf1


CASES = (
    {
        "event": "Austria",
        "trackId": "spielberg",
        "title": "2025 오스트리아 GP",
        "drivers": ("NOR", "PIA", "LEC"),
    },
    {
        "event": "Hungary",
        "trackId": "hungaroring",
        "title": "2025 헝가리 GP",
        "drivers": ("NOR", "PIA", "RUS"),
    },
    {
        "event": "Italy",
        "trackId": "monza",
        "title": "2025 이탈리아 GP",
        "drivers": ("VER", "NOR", "PIA"),
    },
)


def integer(value: object) -> int:
    return int(round(float(value)))


def extract_driver_strategy(
    session: object,
    driver: str,
) -> dict[str, object]:
    driver_laps = (
        session.laps.pick_drivers(driver)
        .sort_values("LapNumber")
        .copy()
    )
    result_rows = session.results[
        session.results["Abbreviation"].eq(driver)
    ]
    if result_rows.empty:
        raise RuntimeError(f"No result row for {driver}")
    result = result_rows.iloc[0]

    stints: list[dict[str, object]] = []
    grouped = driver_laps.dropna(
        subset=["Stint", "Compound", "LapNumber"]
    ).groupby("Stint", sort=True)
    for _, group in grouped:
        compound_values = group["Compound"].dropna()
        if compound_values.empty:
            continue
        compound = str(compound_values.mode().iloc[0])
        if compound not in {"SOFT", "MEDIUM", "HARD"}:
            continue
        tyre_life = pd.to_numeric(
            group["TyreLife"],
            errors="coerce",
        ).dropna()
        stints.append(
            {
                "compound": compound[0],
                "startLap": integer(group["LapNumber"].min()),
                "endLap": integer(group["LapNumber"].max()),
                "observedTyreLifeStart": (
                    integer(tyre_life.iloc[0]) if not tyre_life.empty else None
                ),
                "observedTyreLifeEnd": (
                    integer(tyre_life.iloc[-1]) if not tyre_life.empty else None
                ),
            }
        )

    expected_laps = integer(result["Laps"])
    if not stints or stints[0]["startLap"] != 1:
        raise RuntimeError(f"Invalid first stint for {driver}")
    if stints[-1]["endLap"] != expected_laps:
        raise RuntimeError(
            f"Incomplete strategy for {driver}: "
            f"{stints[-1]['endLap']} != {expected_laps}"
        )

    return {
        "driver": driver,
        "driverName": str(result["FullName"]),
        "teamName": str(result["TeamName"]),
        "finishPosition": integer(result["Position"]),
        "classifiedLaps": expected_laps,
        "stints": stints,
    }


def main() -> None:
    output: list[dict[str, object]] = []
    for case in CASES:
        session = fastf1.get_session(2025, case["event"], "R")
        session.load(
            laps=True,
            telemetry=False,
            weather=False,
            messages=True,
        )
        output.append(
            {
                "event": case["event"],
                "trackId": case["trackId"],
                "title": case["title"],
                "drivers": [
                    extract_driver_strategy(session, driver)
                    for driver in case["drivers"]
                ],
            }
        )
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
