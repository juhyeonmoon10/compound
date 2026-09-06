"""Collect recent same-compound team observations, not official pace-chart values.

Run from the repository with FastF1 installed:
  python tools/collect_recent_team_evidence.py --cache-dir ../fastf1-cache

The defaults are the latest two races confirmed complete in the official
calendar snapshot of 2026-09-06 14:42:50 UTC, plus their 2025 counterparts.
This collector does not alter the 21-event historical dataset or runtime model.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
from pathlib import Path
import sys

os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("OMP_NUM_THREADS", "1")
import fastf1
import numpy as np
import pandas as pd

from collect_historical_evidence import clean_dry, design_matrix, fit, number, weather_laps

ROOT = Path(__file__).resolve().parents[1]
EVENTS = (("zandvoort", "Dutch Grand Prix"), ("hungaroring", "Hungarian Grand Prix"))
YEARS = (2026, 2025)
# Retained from the first uncached acquisition (2026-09-06 UTC). Cached replays
# may not repeat parser warnings, so these are dated provenance, not new errors.
FIRST_COLLECTION_WARNINGS = {
    "2026-zandvoort": [
        "Driver 41: one timing integrity error near lap 5; core marked one inaccurate lap.",
        "Failed to align laps for driver 87.",
        "Driver 1 completed race distance 1.577 seconds before recorded session end.",
    ],
    "2026-hungaroring": ["FastF1 fixed incorrect tyre stint information for driver 11."],
}
LIMITS = {
    "minimumEventLaps": 50, "minimumStintLaps": 5,
    "minimumTeamLaps": 20, "minimumPaceStints": 2, "minimumDegradationStints": 4,
    "minimumDistinctTyreLives": 4, "confidenceCriticalValue": 1.96,
    "minimumSlopeDenominator": 1e-9,
}
TEAM_IDS = {
    "Mercedes": "mercedes", "Ferrari": "ferrari", "McLaren": "mclaren",
    "Red Bull Racing": "red-bull", "Racing Bulls": "racing-bulls", "RB": "racing-bulls",
    "Alpine": "alpine", "Haas F1 Team": "haas", "Haas": "haas", "Williams": "williams",
    "Aston Martin": "aston-martin", "Audi": "audi", "Audi F1 Team": "audi",
    "Cadillac": "cadillac", "Cadillac F1 Team": "cadillac",
    "Kick Sauber": "kick-sauber", "Sauber": "kick-sauber",
}
METHOD = {
    "classification": "official-timing-derived-project-observational-analysis",
    "notOfficialRaceSimulationPaceChart": True,
    "baseFilterImplementation": "tools/collect_historical_evidence.py clean_dry / fit / design_matrix (read-only reuse)",
    "cleanRules": [
        "SOFT/MEDIUM/HARD only; complete LapTime, TyreLife, Stint",
        "IsAccurate=True; Deleted!=True; FastF1Generated=False",
        "TrackStatus exactly 1; exclude pit-in, pit-out and race lap 1",
        "Rainfall explicitly False; finite TrackTemp and Team; missing weather is excluded, not assumed dry",
        "exclude first lap immediately after non-green or pit-out lap",
        "before residual IQR trimming, at least 5 retained laps per driver-stint; one compound; monotonic tyre life",
        "up to 3 residual IQR passes, Q1-3*IQR to Q3+3*IQR, minimum IQR 0.05 seconds",
    ],
    "eventRegression": "LapTime ~ Driver + RaceLap + RaceLap^2 + TrackTemp + Compound + Compound*TyreLife + Compound*TyreLife^2",
    "pace": "Remove fitted event race-progress, track-temperature and compound-age terms; compare team lap median with same-event same-compound field median.",
    "paceUncertainty": "IQR and range of driver-stint median deltas describe dispersion; these are NOT confidence intervals. No predictive validation claim.",
    "degradation": "Remove only event race-progress and track-temperature terms; regress within-driver-stint demeaned lap time on demeaned tyre life (driver-stint fixed intercepts).",
    "degradationUncertainty": "Asymptotic 95% cluster-robust interval over driver-stint groups; few clusters and estimated environmental nuisance terms make this exploratory.",
    "thresholds": {key: {"value": value, "source": "project quality/numerical rule, not observed F1 performance"} for key, value in LIMITS.items()},
    "units": {"paceDeltaSeconds": "seconds per lap relative to event-compound median", "degradationSecondsPerLap": "seconds per additional tyre-age lap", "pitStationarySeconds": "seconds, unavailable"},
    "seasonPooling": "Never pool raw 2025/2026 lap times or degradation coefficients. 2025 is a separate descriptive comparison only.",
    "limitations": [
        "Drivers, traffic, fuel, deployment, tyre management, pit strategy, weather and setup remain confounded with team/car ability.",
        "EA driver adjustments must not be interpreted as independent causal additions to team observations; double counting is possible.",
        "Relative S/M/H names do not guarantee the same absolute C compound across events or seasons.",
        "Rainfall=False does not prove a dry road; residual surface water and local rain may remain, especially Zandvoort 2026.",
        "No tyre sensors, fuel masses, clean-air labels or controlled equal-driver tests were available.",
        "No forecast error/holdout claim; displayed fitted residuals are in-sample diagnostics only.",
        "PitInTime/PitOutTime measure timing-line passage, not stationary wheel-change duration; stationary times remain null.",
        "Confidence intervals condition on estimated event adjustment; they do not include all model-selection/nuisance-parameter uncertainty.",
        "Kick Sauber 2025 is not relabelled as a measured Audi 2026 car; Cadillac has no 2025 counterpart.",
    ],
}


def final_filter(laps):
    cleaned, funnel = clean_dry(laps)
    before = len(cleaned)
    cleaned = cleaned.loc[cleaned.Rainfall.eq(False) & cleaned.TrackTemp.notna() & np.isfinite(cleaned.TrackTemp) & cleaned.Team.notna()].copy()
    funnel.append({"key": "known-weather-team", "remaining": len(cleaned), "excluded": before - len(cleaned)})
    # Source lap numbers let us reject restart/out-lap transients without telemetry.
    excluded = set()
    for driver, rows in laps.groupby("Driver"):
        ordered = rows.sort_values("LapNumber")
        for _, row in ordered.iterrows():
            if row.TrackStatus != "1" or pd.notna(row.PitOutTime):
                excluded.add((str(driver), int(row.LapNumber) + 1))
    before = len(cleaned)
    keep = [(str(row.Driver), int(row.LapNumber)) not in excluded for row in cleaned.itertuples()]
    cleaned = cleaned.loc[keep].copy()
    funnel.append({"key": "restart-transient", "remaining": len(cleaned), "excluded": before - len(cleaned)})
    before = len(cleaned)
    valid = []
    for _, group in cleaned.groupby(["Driver", "Stint"]):
        if len(group) >= LIMITS["minimumStintLaps"] and group.Compound.nunique() == 1 and group.TyreLife.is_monotonic_increasing:
            valid.extend(group.index)
    cleaned = cleaned.loc[valid].reset_index(drop=True)
    funnel.append({"key": "recheck-stints", "remaining": len(cleaned), "excluded": before - len(cleaned)})
    return cleaned, funnel


def within_stint_slope(group):
    groups = group.groupby(["Driver", "Stint"])
    x = group.TyreLife - groups.TyreLife.transform("mean")
    y = group.EnvironmentalPace - groups.EnvironmentalPace.transform("mean")
    denominator = float(np.dot(x, x))
    count = groups.ngroups
    enough = len(group) >= LIMITS["minimumTeamLaps"] and count >= LIMITS["minimumDegradationStints"] and group.TyreLife.nunique() >= LIMITS["minimumDistinctTyreLives"] and denominator > LIMITS["minimumSlopeDenominator"]
    if not enough:
        return {"estimate": None, "ci95": None, "status": "insufficient-stints-or-age-spread"}
    slope = float(np.dot(x, y) / denominator)
    residual = y - slope * x
    working = group[["Driver", "Stint"]].copy()
    working["score"] = np.asarray(x * residual)
    scores = working.groupby(["Driver", "Stint"]).score.sum()
    correction = count / (count - 1) * (len(group) - 1) / max(1, len(group) - count - 1)
    se = math.sqrt(max(0, correction * float(np.dot(scores, scores)) / denominator ** 2))
    radius = LIMITS["confidenceCriticalValue"] * se
    return {"estimate": number(slope), "ci95": [number(slope - radius), number(slope + radius)], "status": "exploratory-cluster-interval"}


def build_rows(result, event_id, year):
    frame = result["frame"].copy()
    x, names, _ = design_matrix(frame, result["spec"])
    environmental = [names.index(name) for name in ("race", "race2", "temperature")]
    frame["EnvironmentalPace"] = frame.LapTimeSeconds.to_numpy(float) - x[:, environmental] @ result["coef"][environmental]
    ages = [i for i, name in enumerate(names) if name.startswith(("alpha:", "beta:"))]
    frame["AdjustedPace"] = frame.EnvironmentalPace.to_numpy(float) - x[:, ages] @ result["coef"][ages]
    environment_identified = bool(all(result["identifiable"][i] for i in environmental))
    rows = []
    for (team, compound), group in frame.groupby(["Team", "Compound"]):
        reference = frame[frame.Compound == compound]
        stint_count = int(group.groupby(["Driver", "Stint"]).ngroups)
        age_columns = [names.index("alpha:" + compound), names.index("beta:" + compound)]
        identified = environment_identified and bool(all(result["identifiable"][i] for i in age_columns))
        enough = len(group) >= LIMITS["minimumTeamLaps"] and stint_count >= LIMITS["minimumPaceStints"]
        pace_available = identified and enough
        reference_median = float(reference.AdjustedPace.median())
        stint_medians = group.groupby(["Driver", "Stint"]).AdjustedPace.median() - reference_median
        slope = within_stint_slope(group) if environment_identified else {"estimate": None, "ci95": None, "status": "environment-not-identifiable"}
        pace = number(group.AdjustedPace.median() - reference_median) if pace_available else None
        rows.append({
            "eventId": event_id, "season": year, "team": str(team), "teamId": TEAM_IDS.get(str(team)),
            "compound": compound[0], "laps": len(group), "stints": stint_count,
            "drivers": sorted(str(d) for d in group.Driver.unique()),
            "raceLapRange": [int(group.LapNumber.min()), int(group.LapNumber.max())],
            "tyreLifeRange": [number(group.TyreLife.min()), number(group.TyreLife.max())],
            "referenceLaps": len(reference), "referenceTeams": int(reference.Team.nunique()),
            "paceDeltaSeconds": pace,
            "paceStintDeltaIQRSeconds": [number(stint_medians.quantile(.25)), number(stint_medians.quantile(.75))] if pace_available else None,
            "paceStintDeltaRangeSeconds": [number(stint_medians.min()), number(stint_medians.max())] if pace_available else None,
            "paceStatus": "observational-proxy" if pace_available else "not-identifiable" if not identified else "insufficient-samples",
            "degradationSecondsPerLap": slope["estimate"], "degradationCI95": slope["ci95"],
            "degradationStatus": slope["status"],
            "referencePositiveTeamSlopeMedian": None, "referencePositiveTeamCount": 0,
            "pitStationarySeconds": None, "pitStationaryStatus": "not-measured",
        })
    for row in rows:
        candidates = [other["degradationSecondsPerLap"] for other in rows if other["compound"] == row["compound"] and other["degradationCI95"] is not None and other["degradationCI95"][0] > 0]
        row["referencePositiveTeamSlopeMedian"] = number(np.median(candidates)) if candidates else None
        row["referencePositiveTeamCount"] = len(candidates)
    return rows


def collect(year, track_id, name):
    key = f"{year}-{track_id}"
    record = {"id": key, "season": year, "trackId": track_id, "requestedEventName": name, "status": "unavailable", "rawLaps": None, "modelLaps": None, "teamEstimates": [], "failure": None, "firstAcquisitionWarnings": FIRST_COLLECTION_WARNINGS.get(key, []), "warningInterpretation": "Recorded on first uncached acquisition. IsAccurate/Generated/TrackStatus filters are applied, but do not establish perfect timing quality."}
    stage = "get-session"
    try:
        session = fastf1.get_session(year, name, "R")
        if str(session.event.EventName) != name:
            raise ValueError("Exact event name mismatch")
        record.update({"eventName": str(session.event.EventName), "eventDate": str(session.event.EventDate), "timingSourceUrl": "https://livetiming.formula1.com" + session.api_path, "sourceFiles": ["TimingData.jsonStream", "TimingAppData.jsonStream", "WeatherData.jsonStream", "TrackStatus.jsonStream", "SessionStatus.jsonStream", "DriverList.jsonStream"]})
        stage = "load-laps-weather-status"
        session.load(laps=True, telemetry=False, weather=True, messages=True)
        statuses = sorted(str(value) for value in session.session_status.Status.dropna().unique())
        record["sessionStatusValues"] = statuses
        if not any(value in statuses for value in ("Finished", "Finalised", "Ends")):
            raise ValueError("Session has no completed status")
        stage = "filter"
        laps = weather_laps(session)
        record.update({"rawLaps": len(laps), "rawTeams": sorted(str(x) for x in laps.Team.dropna().unique()), "rawDrivers": int(laps.Driver.nunique()), "rainfallKnownLaps": int(laps.Rainfall.notna().sum()), "rainfallTrueLaps": int(laps.Rainfall.eq(True).sum()), "wetTyreLaps": int(laps.Compound.isin(["INTERMEDIATE", "WET"]).sum())})
        cleaned, funnel = final_filter(laps)
        record["funnel"] = funnel
        record["status"] = "collected"
        if len(cleaned) < LIMITS["minimumEventLaps"]:
            record.update({"analysisStatus": "insufficient-clean-laps", "modelLaps": len(cleaned), "stints": int(cleaned.groupby(["Driver", "Stint"]).ngroups)})
            return record
        stage = "fit-observational-adjustment"
        result = fit(cleaned)
        retained = result["frame"]
        record["funnel"].append({"key": "robust-iqr", "remaining": len(retained), "excluded": len(cleaned) - len(retained)})
        x, _, _ = design_matrix(retained, result["spec"])
        residual = retained.LapTimeSeconds.to_numpy(float) - x @ result["coef"]
        rows = build_rows(result, key, year)
        record.update({
            "analysisStatus": "estimated", "modelLaps": len(retained), "stints": int(retained.groupby(["Driver", "Stint"]).ngroups),
            "modelTeams": int(retained.Team.nunique()), "modelDrivers": int(retained.Driver.nunique()),
            "matrixRank": result["rank"], "matrixColumns": len(result["names"]),
            "eventCoefficients": [{"name": term, "value": number(result["coef"][i]) if result["identifiable"][i] else None, "identifiable": bool(result["identifiable"][i])} for i, term in enumerate(result["names"])],
            "inSampleResidualMAESeconds": number(np.abs(residual).mean()), "notHoldoutMetric": True,
            "teamEstimates": rows,
        })
        print(f"COLLECTED {key}: raw={len(laps)} model={len(retained)} teams={record['modelTeams']} rows={len(rows)}", flush=True)
        return record
    except Exception as error:
        # Do not leak workspace paths or pretend a failed download contained 0 laps.
        record.update({"status": "unavailable", "analysisStatus": "unavailable", "failure": {"stage": stage, "type": type(error).__name__, "message": str(error).replace(str(ROOT), "[project]").replace(str(Path.home()), "[user]")[:400]}})
        print(f"FAILED {key}: {type(error).__name__}: {error}", file=sys.stderr, flush=True)
        return record


def payload(events):
    rows = [row for event in events for row in event["teamEstimates"]]
    by_year = []
    for year in YEARS:
        subset = [event for event in events if event["season"] == year]
        by_year.append({
            "season": year, "requestedEvents": len(subset), "collectedEvents": sum(event["status"] == "collected" for event in subset),
            "analysedEvents": sum(event.get("analysisStatus") == "estimated" for event in subset),
            "rawLaps": sum(event["rawLaps"] or 0 for event in subset), "modelLaps": sum(event["modelLaps"] or 0 for event in subset),
            "sourceTeamNames": sorted({row["team"] for row in rows if row["season"] == year}),
            "paceTeamIds": sorted({row["teamId"] for row in rows if row["season"] == year and row["teamId"] and row["paceDeltaSeconds"] is not None}),
        })
    return {
        "schemaVersion": 1, "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "generatedBy": "tools/collect_recent_team_evidence.py", "libraryVersion": fastf1.__version__,
        "source": {"name": "FastF1 access to official F1 public timing", "documentationUrl": "https://docs.fastf1.dev/", "timingBaseUrl": "https://livetiming.formula1.com", "classification": METHOD["classification"]},
        "selection": {"snapshotUtc": "2026-09-06T14:42:50Z", "scheduleUrl": "https://www.formula1.com/en/racing/2026", "currentSeason": 2026, "latestConfirmedEvents": ["2026-zandvoort", "2026-hungaroring"], "comparisonSeason": 2025, "excludedAtSnapshot": {"eventName": "Italian Grand Prix", "reason": "2026-09-06 calendar snapshot had no race-result summary; do not treat current event as complete by date alone"}},
        "methodology": METHOD, "summary": {"bySeason": by_year, "teamCompoundRows": len(rows), "paceRows": sum(row["paceDeltaSeconds"] is not None for row in rows), "degradationRows": sum(row["degradationSecondsPerLap"] is not None for row in rows), "stationaryPitMeasured": False},
        "events": events, "teams": rows, "pitStationarySeconds": None,
        "adoption": {"collectorModifiesRuntime": False, "requiresExplicitConsumerGates": True, "sameSeasonPreferred": True, "note": "Do not merge 2025 comparison with 2026 observations by default. Non-positive or imprecise degradation estimates remain descriptive, not tyre-wear parameters."},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path, default=ROOT.parent / "fastf1-cache")
    parser.add_argument("--output", type=Path, default=ROOT / "app/data/recent-team-evidence.json")
    args = parser.parse_args()
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    fastf1.Cache.enable_cache(str(args.cache_dir))
    events = []
    for year in YEARS:
        for track_id, name in EVENTS:
            events.append(collect(year, track_id, name))
            # Save completed/failed observations after each event for resumability.
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(payload(events), ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps(payload(events)["summary"], ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
