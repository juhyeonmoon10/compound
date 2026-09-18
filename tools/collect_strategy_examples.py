"""Export observed full-distance strategies for condition-based retrieval.

Uses only cached 2023-2025 race sessions by default; never fills missing data.
python tools/collect_strategy_examples.py --cache-dir ../fastf1-cache
Requires FastF1 3.8.3. Output is independent of fitted/validation datasets.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import sys
from pathlib import Path

import fastf1
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
TRACKS = {
    "Australian": "melbourne", "Chinese": "shanghai", "Japanese": "suzuka",
    "Bahrain": "bahrain", "Saudi_Arabian": "jeddah", "Miami": "miami",
    "Canadian": "montreal", "Monaco": "monaco", "Spanish": "barcelona",
    "Austrian": "spielberg", "British": "silverstone", "Belgian": "spa",
    "Hungarian": "hungaroring", "Dutch": "zandvoort", "Italian": "monza",
    "Azerbaijan": "baku", "Singapore": "singapore", "United_States": "austin",
    "Mexico_City": "mexico-city", "São_Paulo": "sao-paulo",
    "Las_Vegas": "las-vegas", "Qatar": "lusail", "Abu_Dhabi": "yas-marina",
}
COMPOUNDS = {"SOFT": "S", "MEDIUM": "M", "HARD": "H", "INTERMEDIATE": "INTER", "WET": "WET"}


def finite(value):
    return round(float(value), 2) if pd.notna(value) and math.isfinite(float(value)) else None


def collect(season, name, track_id):
    session = fastf1.get_session(season, name, "R")
    if session.event.EventName != name:
        raise ValueError("Event name mismatch")
    session.load(laps=True, telemetry=False, weather=True, messages=False)
    results = session.results
    race_laps = int(results.Laps.max())
    # One weather sample per race lap: leader only, not all-driver duplication.
    winner = results.loc[results.Position.eq(1)].iloc[0]
    leader_laps = session.laps.pick_drivers(str(winner.Abbreviation)).sort_values("LapNumber")
    weather = leader_laps.get_weather_data()
    rain = weather.Rainfall
    wet_laps = sorted(int(lap) for lap in session.laps.loc[session.laps.Compound.isin(["INTERMEDIATE", "WET"]), "LapNumber"].unique())
    weather_known = len(weather) > 0 and bool(rain.notna().all())
    if not weather_known:
        weather_kind = "unknown"
    elif not wet_laps and not rain.eq(True).any():
        weather_kind = "dry"
    elif wet_laps and min(wet_laps) <= 3 and max(wet_laps) >= race_laps - 2:
        weather_kind = "wet" if len(wet_laps) / race_laps >= 0.85 else "mixed"
    elif wet_laps and min(wet_laps) <= 3:
        weather_kind = "wet-to-dry"
    elif wet_laps and max(wet_laps) >= race_laps - 2:
        weather_kind = "dry-to-wet"
    else:
        weather_kind = "mixed"
    drivers, excluded = [], []
    for _, driver in results.sort_values("Position").iterrows():
        code = str(driver.Abbreviation)
        if driver.Status != "Finished" or pd.isna(driver.Laps) or int(driver.Laps) != race_laps:
            excluded.append({"code": code, "reason": "not-full-distance-finisher"})
            continue
        laps = session.laps.pick_drivers(code).sort_values("LapNumber")
        if len(laps) != race_laps or laps.LapNumber.tolist() != list(range(1, race_laps + 1)) or laps[["Compound", "Stint"]].isna().any().any():
            excluded.append({"code": code, "reason": "incomplete-lap-or-tyre-coverage"})
            continue
        stints, valid = [], True
        for _, group in laps.groupby("Stint", sort=True):
            values = group.Compound.unique()
            if len(values) != 1 or values[0] not in COMPOUNDS:
                valid = False
                break
            stints.append({"compound": COMPOUNDS[values[0]], "startLap": int(group.LapNumber.min()), "endLap": int(group.LapNumber.max()), "tyreLifeStart": finite(group.TyreLife.iloc[0])})
        if not valid or any(s["startLap"] != (stints[i-1]["endLap"] + 1 if i else 1) for i, s in enumerate(stints)) or not stints or stints[-1]["endLap"] != race_laps:
            excluded.append({"code": code, "reason": "ambiguous-stint"})
            continue
        grid = finite(driver.GridPosition)
        if grid is None or grid < 1:
            excluded.append({"code": code, "reason": "pit-lane-or-unknown-grid"})
            continue
        drivers.append({"code": code, "name": str(driver.FullName), "team": str(driver.TeamName), "gridPosition": int(grid), "finishPosition": int(driver.Position), "stints": stints})
    signals = session.track_status
    result = {
        "id": f"{season}-{track_id}", "season": season, "trackId": track_id,
        "name": name, "date": str(session.event.EventDate.date()), "raceLaps": race_laps,
        "trackTemperatureC": finite(weather.TrackTemp.mean()), "airTemperatureC": finite(weather.AirTemp.mean()),
        "humidityPercent": finite(weather.Humidity.mean()), "weatherKind": weather_kind,
        "wetLapStart": min(wet_laps) if wet_laps else None, "wetLapEnd": max(wet_laps) if wet_laps else None,
        "raceControl": {"sc": bool(signals.Status.eq("4").any()), "vsc": bool(signals.Status.eq("6").any()), "red": bool(signals.Status.eq("5").any())},
        "timingUrl": "https://livetiming.formula1.com" + session.api_path,
        "drivers": drivers, "excluded": excluded,
    }
    print(f"{result['id']}: {len(drivers)} complete strategies ({weather_kind})", flush=True)
    return result


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    fastf1.set_log_level("ERROR")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path, required=True)
    parser.add_argument("--online", action="store_true")
    args = parser.parse_args()
    fastf1.Cache.enable_cache(str(args.cache_dir.resolve()))
    if not args.online:
        fastf1.Cache.offline_mode(True)
    events, failures = [], []
    for season in (2023, 2024, 2025):
        for folder in sorted((args.cache_dir / str(season)).glob("*_Grand_Prix")):
            key = folder.name[11:].removesuffix("_Grand_Prix")
            if key not in TRACKS:
                continue
            name = key.replace("_", " ") + " Grand Prix"
            try:
                events.append(collect(season, name, TRACKS[key]))
            except Exception as exc:
                failures.append({"season": season, "event": name, "reason": str(exc)})
                print(f"Unavailable: {season} {name}: {exc}", flush=True)
    if not events:
        raise RuntimeError("No verified sessions; existing output left untouched")
    output = {
        "schemaVersion": 1, "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "generatedBy": "tools/collect_strategy_examples.py", "libraryVersion": fastf1.__version__,
        "source": "F1 public timing and results via FastF1", "events": events, "unavailable": failures,
        "method": {
            "temperature": "Mean of weather samples aligned to winner laps; race average, not a forecast or starting temperature.",
            "selection": "All full-distance finishers with contiguous known compound/stint data and a known grid position; not restricted to podium.",
            "weather": "Observed wet-tyre lap coverage plus rainfall boolean; rainfall intensity is not available.",
            "stints": "Actual stint boundaries, including red-flag tyre changes. Not every tyre change is a pit-lane stop.",
            "limitations": "Survivorship bias; not evidence of optimality. Cars, rules, circuit layouts and actual C-compound allocations can differ across seasons.",
        },
    }
    path = ROOT / "app/data/strategy-examples.json"
    path.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")
    print(f"Exported {len(events)} races / {sum(len(e['drivers']) for e in events)} strategies; {len(failures)} unavailable", flush=True)


if __name__ == "__main__":
    main()
