"""Produce the small runtime view of collected evidence, without changing estimates."""
import json
import statistics
from pathlib import Path

root = Path(__file__).resolve().parents[1]
data = root / "app" / "data"
dry = json.loads((data / "historical-dry-2023-2025.json").read_text(encoding="utf-8"))
wet = json.loads((data / "wet-weather-2025.json").read_text(encoding="utf-8"))
manifest = json.loads((data / "dataset-manifest.json").read_text(encoding="utf-8"))
events = []
team_rows = []
for event in dry["events"]:
    if event["status"] != "collected":
        continue
    events.append({
        key: event[key] for key in ("id", "season", "trackId", "eventName", "timingSourceUrl", "rawLaps", "modelLaps", "stints", "coefficients", "validation", "analysisStatus")
    } | {"pitLoss": {key: event["pitLoss"][key] for key in ("status", "retainedSamples", "medianSeconds", "iqrSeconds")}, "modelSelection":event.get("modelSelection")})
    for row in event["teamEstimates"]:
        if row["status"] != "observational-proxy":
            continue
        reference_slopes = [item["linearDegradationSecondsPerLap"] for item in event["teamEstimates"] if item["compound"] == row["compound"] and item["status"] == "observational-proxy" and item["linearDegradationSecondsPerLap"] is not None and item["linearDegradationSecondsPerLap"] > 0]
        reference = statistics.median(reference_slopes) if reference_slopes else None
        team_rows.append({
            "eventId": event["id"], "season": event["season"], "trackId": event["trackId"],
            "team": row["team"], "compound": row["compound"], "laps": row["laps"],
            "stints": row["stints"], "paceDeltaSeconds": row["adjustedPaceDeltaToCompoundMedianSeconds"],
            "degradationSecondsPerLap": row["linearDegradationSecondsPerLap"],
            "degradationCI95": row["linearDegradationCI95"],
            "referencePositiveTeamSlopeMedian": reference,
        })
summary = {
    "schemaVersion": 1, "generatedAt": dry["generatedAt"], "source": dry["source"],
    "libraryVersion": dry["libraryVersion"], "summary": dry["summary"],
    "events": events, "teams": team_rows, "pitLossCoverage": manifest["pitLossCoverage"],
    "wet": [{"trackId": event["trackId"], "rawCompoundCounts": event["rawCompoundCounts"], "retainedCompoundSummary": event["retainedCompoundSummary"], "sameLapPairs": len(event["sameLapComparisons"]), "intermediateWetMatchedLaps": event["intermediateWetMatchedLaps"]} for event in wet["events"]],
    "limitations": dry["methodology"]["limitations"],
}
selected_events=[event for event in events if event.get("modelSelection")]
selected_holdout=sum(event["modelSelection"]["validation"]["testLaps"] for event in selected_events)
summary["selectedModelSummary"]={"events":len(selected_events),"holdoutLaps":selected_holdout,"weightedHoldoutMaeSeconds":sum(event["modelSelection"]["validation"]["absoluteErrorSumSeconds"] for event in selected_events)/selected_holdout if selected_holdout else None,"acceptedCoefficients":sum(row["accepted"] for event in selected_events for row in event["modelSelection"]["coefficients"]),"acceptedQuadraticCoefficients":sum(row["accepted"] and row["model"]=="quadratic" for event in selected_events for row in event["modelSelection"]["coefficients"])}
(data / "calibration-summary.json").write_text(json.dumps(summary, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")
print(f"Wrote calibration-summary.json: {len(events)} events, {len(team_rows)} team/compound observations")
