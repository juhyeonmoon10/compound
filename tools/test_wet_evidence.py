"""Synthetic wet-summary checks; no cache/session/network calls are made."""
import math
import pandas as pd
from collect_historical_evidence import wet_distribution, wet_rainfall, wet_tyre_changes, enrich_wet_comparisons


assert wet_distribution([1, 2, 3, 4]) == {"count": 4, "min": 1.0, "q1": 1.75, "median": 2.5, "q3": 3.25, "max": 4.0}
assert wet_distribution([3])["q1"] == wet_distribution([3])["q3"] == 3
assert wet_distribution([None, math.nan, math.inf])["median"] is None
assert wet_distribution([None, 0])["median"] == 0
for values in ([], [None, None], [False, None]):
    assert wet_rainfall(values) is None
assert wet_rainfall([False, False]) is False
assert wet_rainfall([None, True]) is True


def pair(lap, delta, first="DRY", second="INTERMEDIATE"):
    return {"lap": lap, "firstMinusSecondSeconds": delta, "firstCompound": first, "secondCompound": second,
            "firstSamples": 2, "secondSamples": 3, "rainfallTrue": None}


result = enrich_wet_comparisons({"sameLapComparisons": [pair(9, -6), pair(40, 2), pair(10, 100, "DRY", "WET")]})
assert len(result["sameLapDifferenceDistributions"]) == 2
assert len(result["observedSignChangeIntervals"]) == 1
change = result["observedSignChangeIntervals"][0]
assert change["fromLap"] == 9 and change["toLap"] == 40 and change["unobservedLapsBetween"] == 30
assert change["exactCrossoverLap"] is None
assert not result["supportsWetCrossoverCalibration"]
assert enrich_wet_comparisons({"sameLapComparisons": [pair(1, -2)]})["observedSignChangeIntervals"] == []
assert enrich_wet_comparisons({"sameLapComparisons": [pair(1, 2)]})["observedSignChangeIntervals"] == []


def lap(driver, number, compound, stint, pit_in=None, pit_out=None):
    return {"Driver": driver, "LapNumber": number, "Compound": compound, "Stint": stint,
            "FastF1Generated": False, "PitInTime": pit_in, "PitOutTime": pit_out,
            "TrackStatus": "1", "Rainfall": None, "TrackTemp": 20, "Humidity": 70}


frame = pd.DataFrame([
    lap("A", 1, "MEDIUM", 1, pit_in=90.0), lap("A", 2, "INTERMEDIATE", 2),
    lap("B", 1, "INTERMEDIATE", 1), lap("B", 2, "HARD", 2),
    lap("C", 1, "MEDIUM", 1), lap("C", 4, "INTERMEDIATE", 2),
    lap("D", 1, "MEDIUM", 1), lap("D", 2, "INTERMEDIATE", 1),
])
changes, gaps = wet_tyre_changes(frame)
assert len(changes) == 2 and len(gaps) == 2
assert changes[0]["afterLap"] == 1 and changes[0]["firstLapOnNewTyre"] == 2
assert changes[0]["pitTimingRecorded"] is True
assert changes[1]["pitTimingRecorded"] is False
assert all(row["rainfall"] is None for row in changes)
print("Wet synthetic checks passed: quantiles, missing rainfall, race/pair separation, bracketed signs and actual-change gaps.")
