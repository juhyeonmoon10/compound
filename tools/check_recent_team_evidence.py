"""Read-only data invariants and synthetic estimator checks for recent evidence."""
from __future__ import annotations
import json
import math
from pathlib import Path

from collect_recent_team_evidence import LIMITS, final_filter, within_stint_slope
import numpy as np
import pandas as pd


def estimator_checks():
    # Distinct stint intercepts must not change a within-stint degradation slope.
    values = []
    for stint in range(4):
        for age in range(1, 11):
            values.append({"Driver": "A" if stint < 2 else "B", "Stint": stint, "TyreLife": age, "EnvironmentalPace": 70 + 10 * stint + 0.12 * age})
    frame = pd.DataFrame(values)
    result = within_stint_slope(frame)
    assert abs(result["estimate"] - 0.12) < 1e-6
    assert result["ci95"][0] <= 0.12 <= result["ci95"][1]
    shifted = frame.copy()
    shifted.loc[shifted.Stint == 0, "EnvironmentalPace"] += 100
    assert abs(within_stint_slope(shifted)["estimate"] - result["estimate"]) < 1e-6
    assert within_stint_slope(frame[frame.Stint < 3])["estimate"] is None
    constant_age = frame.assign(TyreLife=1)
    assert within_stint_slope(constant_age)["ci95"] is None
    negative = frame.assign(EnvironmentalPace=100 - frame.TyreLife)
    assert within_stint_slope(negative)["estimate"] == -1, "observed negative slope must not be clamped into positive wear"

    source = pd.DataFrame({
        "Driver": ["A"] * 12, "Stint": [1] * 12, "Team": ["Example"] * 12,
        "Compound": ["MEDIUM"] * 12, "LapTime": pd.to_timedelta([90] * 12, unit="s"),
        "TyreLife": list(range(1, 13)), "LapNumber": list(range(1, 13)),
        "IsAccurate": [True] * 12, "Deleted": [False] * 12, "FastF1Generated": [False] * 12,
        "TrackStatus": ["1"] * 12, "PitInTime": [pd.NaT] * 12, "PitOutTime": [pd.NaT] * 12,
        "Rainfall": pd.Series([False] * 12, dtype="boolean"), "TrackTemp": [30.] * 12,
    })
    source.loc[1, "Rainfall"] = None
    source.loc[2, "Rainfall"] = True
    source.loc[3, "TrackTemp"] = np.nan
    clean, funnel = final_filter(source)
    assert set(clean.LapNumber) == set(range(5, 13)), "unknown/rainy weather and first race lap must be excluded"
    previous = len(source)
    for row in funnel:
        assert row["remaining"] + row["excluded"] == previous
        previous = row["remaining"]


def data_checks():
    path = Path(__file__).resolve().parents[1] / "app/data/recent-team-evidence.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    events = data["events"]
    assert len(events) == 4
    assert len({event["id"] for event in events}) == 4
    assert len([event for event in events if event["season"] == 2026]) == 2
    assert data["pitStationarySeconds"] is None
    assert data["summary"]["stationaryPitMeasured"] is False
    assert data["adoption"]["collectorModifiesRuntime"] is False
    assert data["methodology"]["notOfficialRaceSimulationPaceChart"] is True
    assert data["teams"] == [row for event in events for row in event["teamEstimates"]]
    for event in events:
        if event["status"] != "collected":
            assert event["failure"] is not None
            continue
        assert event["eventName"] == event["requestedEventName"]
        assert event["timingSourceUrl"].startswith("https://livetiming.formula1.com/static/")
        assert any(value in event["sessionStatusValues"] for value in ("Finished", "Finalised", "Ends"))
        assert event["rawLaps"] >= event["modelLaps"] >= 0
        remaining = event["rawLaps"]
        for stage in event["funnel"]:
            assert stage["remaining"] + stage["excluded"] == remaining
            assert stage["remaining"] <= remaining
            remaining = stage["remaining"]
        assert remaining == event["modelLaps"]
        if event["analysisStatus"] != "estimated":
            continue
        assert sum(row["laps"] for row in event["teamEstimates"]) == event["modelLaps"]
        assert event["notHoldoutMetric"] is True
        for row in event["teamEstimates"]:
            assert row["pitStationarySeconds"] is None
            assert row["laps"] <= row["referenceLaps"]
            assert row["eventId"] == event["id"]
            if row["paceDeltaSeconds"] is not None:
                assert math.isfinite(row["paceDeltaSeconds"])
                assert row["laps"] >= LIMITS["minimumTeamLaps"]
                assert row["stints"] >= LIMITS["minimumPaceStints"]
                assert row["paceStintDeltaRangeSeconds"][0] <= row["paceStintDeltaIQRSeconds"][0] <= row["paceStintDeltaIQRSeconds"][1] <= row["paceStintDeltaRangeSeconds"][1]
            else:
                assert row["paceStatus"] != "observational-proxy"
            if row["degradationSecondsPerLap"] is not None:
                assert row["stints"] >= LIMITS["minimumDegradationStints"]
                assert row["degradationCI95"][0] <= row["degradationSecondsPerLap"] <= row["degradationCI95"][1]
            else:
                assert row["degradationCI95"] is None
            if row["team"] in ("Kick Sauber", "Sauber"):
                assert row["teamId"] == "kick-sauber", "2025 Sauber is not a 2026 Audi observation"
            if row["teamId"] == "cadillac":
                assert row["season"] == 2026
    for summary in data["summary"]["bySeason"]:
        subset = [event for event in events if event["season"] == summary["season"]]
        assert summary["rawLaps"] == sum(event["rawLaps"] or 0 for event in subset)
        assert summary["modelLaps"] == sum(event["modelLaps"] or 0 for event in subset)
    assert data["summary"]["paceRows"] == sum(row["paceDeltaSeconds"] is not None for row in data["teams"])
    assert data["summary"]["degradationRows"] == sum(row["degradationSecondsPerLap"] is not None for row in data["teams"])
    print(json.dumps(data["summary"], ensure_ascii=False))


if __name__ == "__main__":
    estimator_checks()
    data_checks()
    print("Recent-team evidence invariants and synthetic estimator checks passed.")
