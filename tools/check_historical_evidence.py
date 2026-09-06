"""Read-only invariants for generated historical evidence; standard library only."""
import json
import math
from pathlib import Path

root = Path(__file__).resolve().parents[1]
data = root / "app" / "data"
dry = json.loads((data / "historical-dry-2023-2025.json").read_text(encoding="utf-8"))
wet = json.loads((data / "wet-weather-2025.json").read_text(encoding="utf-8"))
manifest = json.loads((data / "dataset-manifest.json").read_text(encoding="utf-8"))
events = dry["events"]
assert len({event["id"] for event in events}) == len(events)
for key in ("rawLaps", "modelLaps", "stints"):
    assert dry["summary"][key] == sum(event[key] for event in events)
    assert dry["summary"][key] == sum(year[key] for year in dry["summary"]["byYear"])
assert dry["summary"] == manifest["summary"]
expected_events = {"bahrain": "Bahrain Grand Prix", "barcelona": "Spanish Grand Prix", "spielberg": "Austrian Grand Prix", "hungaroring": "Hungarian Grand Prix", "monza": "Italian Grand Prix", "silverstone": "British Grand Prix", "spa": "Belgian Grand Prix"}
for event in events:
    if event["status"] != "collected":
        continue
    assert event["eventName"] == expected_events[event["trackId"]]
    assert event["timingSourceUrl"].startswith("https://livetiming.formula1.com/static/")
    assert 0 <= event["modelLaps"] <= event["rawLaps"]
    previous = event["rawLaps"]
    for stage in event["funnel"]:
        assert stage["remaining"] <= previous
        assert stage["excluded"] == previous - stage["remaining"]
        previous = stage["remaining"]
    if event["analysisStatus"] != "estimated":
        continue
    assert sum(row["laps"] for row in event["coefficients"]) == event["modelLaps"]
    assert sum(row["stints"] for row in event["coefficients"]) == event["stints"]
    validation = event["validation"]
    assert validation["testLaps"] > 0
    assert validation["trainLaps"] + validation["testLaps"] <= event["rawLaps"]
    assert abs(validation["maeSeconds"] - validation["absoluteErrorSumSeconds"] / validation["testLaps"]) < 1e-5
    for row in event["coefficients"]:
        if row["identifiable"]:
            assert row["alphaCI95"][0] <= row["alphaSecondsPerLap"] <= row["alphaCI95"][1]
            assert row["betaCI95"][0] <= row["betaSecondsPerLapSquared"] <= row["betaCI95"][1]
        else:
            assert row["alphaSecondsPerLap"] is None and row["betaSecondsPerLapSquared"] is None
            assert not row["reliable"]
        if row["reliable"]:
            assert row["laps"] >= 40 and row["stints"] >= 4
            assert row["marginalDegradationCI95"][0] > 0
    pits = event["pitLoss"]
    assert pits["retainedSamples"] == len(pits["samples"])
    assert pits["retainedSamples"] <= pits["rawSamples"]
    for pit in pits["samples"]:
        assert abs(pit["estimatedLossSeconds"] - (pit["inLapSeconds"] + pit["outLapSeconds"] - 2 * pit["localBaselineSeconds"])) < .004
assert len(manifest["pitLossCoverage"]) == 24
for row in manifest["pitLossCoverage"]:
    if row["status"] != "observational-estimate":
        assert row["medianSeconds"] is None
for event in wet["events"]:
    assert event["season"] == 2025
    for pair in event["sameLapComparisons"]:
        assert pair["firstSamples"] > 0 and pair["secondSamples"] > 0
        assert math.isfinite(pair["firstMinusSecondSeconds"])
    assert event["intermediateWetMatchedLaps"] == sum(pair["firstCompound"] == "INTERMEDIATE" and pair["secondCompound"] == "WET" for pair in event["sameLapComparisons"])
assert not manifest["unverifiedUserFiguresUsed"]
print("Historical evidence checks passed.")
print(json.dumps(dry["summary"], ensure_ascii=False))
