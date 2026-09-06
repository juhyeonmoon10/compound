"""Collect auditable pit-loss proxies for all 24 project circuits.

Python 3.11+, FastF1 3.8.3, pandas and numpy are required.
  python tools/collect_pit_loss_evidence.py --cache-dir ./work/fastf1-cache
  python tools/collect_pit_loss_evidence.py --resume --cache-dir ./work/fastf1-cache
  python tools/collect_pit_loss_evidence.py --check
  python tools/collect_pit_loss_evidence.py --self-test

2025 is preferred. If unavailable or fewer than three valid dry/green pairs
survive, 2024 then 2023 is attempted and every failed/insufficient attempt stays
in the output. Madrid has no 2023-2025 event; it is NOT replaced with Barcelona.
Only source sessions/cache and this script's generated JSON are written.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import hashlib
import json
import re
from pathlib import Path

import fastf1
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "app" / "data" / "pit-loss-evidence.json"
SUMMARY_OUTPUT = ROOT / "app" / "data" / "pit-loss-summary.json"
SEASONS = (2025, 2024, 2023)
EVENTS = (
    ("melbourne", "Australian Grand Prix"), ("shanghai", "Chinese Grand Prix"),
    ("suzuka", "Japanese Grand Prix"), ("bahrain", "Bahrain Grand Prix"),
    ("jeddah", "Saudi Arabian Grand Prix"), ("miami", "Miami Grand Prix"),
    ("montreal", "Canadian Grand Prix"), ("monaco", "Monaco Grand Prix"),
    ("barcelona", "Spanish Grand Prix"), ("spielberg", "Austrian Grand Prix"),
    ("silverstone", "British Grand Prix"), ("spa", "Belgian Grand Prix"),
    ("hungaroring", "Hungarian Grand Prix"), ("zandvoort", "Dutch Grand Prix"),
    ("monza", "Italian Grand Prix"), ("madrid", None),
    ("baku", "Azerbaijan Grand Prix"), ("singapore", "Singapore Grand Prix"),
    ("austin", "United States Grand Prix"), ("mexico-city", "Mexico City Grand Prix"),
    ("sao-paulo", "São Paulo Grand Prix"), ("las-vegas", "Las Vegas Grand Prix"),
    ("lusail", "Qatar Grand Prix"), ("yas-marina", "Abu Dhabi Grand Prix"),
)
DRY = ("SOFT", "MEDIUM", "HARD")
# Same numeric quality gates as collect_historical_evidence.py, now with
# individual baseline laps and excluded-pair reasons retained for auditing.
LOCAL_WINDOW = 4
MIN_BASELINE = 4
MIN_PAIRS = 3
IQR_MULTIPLIER = 1.5
IQR_FLOOR = 0.05
FORMULA = "(in-lap + next out-lap) - 2 * median(same-driver normal laps within 4 laps either side)"


def numeric(value, digits=6):
    return round(float(value), digits) if pd.notna(value) and np.isfinite(value) else None


def pit_loss_samples(laps):
    samples, excluded = [], []
    for driver, group in laps.groupby("Driver"):
        ordered = group.sort_values("LapNumber")
        for _, in_lap in ordered[ordered.PitInTime.notna()].iterrows():
            identity = {"driver": str(driver), "pitAfterLap": int(in_lap.LapNumber)}
            out_rows = ordered[ordered.LapNumber.eq(in_lap.LapNumber + 1) & ordered.PitOutTime.notna()]
            reason = None
            if len(out_rows) != 1:
                reason = "no-unique-following-outlap"
            else:
                out_lap = out_rows.iloc[0]
                if pd.isna(in_lap.LapTimeSeconds) or pd.isna(out_lap.LapTimeSeconds):
                    reason = "missing-lap-duration"
                elif in_lap.TrackStatus != "1" or out_lap.TrackStatus != "1":
                    reason = "non-green-pair"
                elif in_lap.Compound not in DRY or out_lap.Compound not in DRY:
                    reason = "wet-tyre-or-unknown-compound-pair"
                elif bool(in_lap.get("FastF1Generated", False)) or bool(out_lap.get("FastF1Generated", False)):
                    reason = "generated-lap"
            if reason:
                excluded.append({**identity, "reason": reason})
                continue
            normal = ordered[
                ordered.LapNumber.ge(in_lap.LapNumber - LOCAL_WINDOW)
                & ordered.LapNumber.le(out_lap.LapNumber + LOCAL_WINDOW)
                & ordered.LapNumber.gt(1)
                & ordered.PitInTime.isna() & ordered.PitOutTime.isna()
                & ordered.TrackStatus.eq("1") & ordered.IsAccurate.fillna(False)
                & ordered.Compound.isin(DRY) & ordered.LapTimeSeconds.notna()
                & ordered.Deleted.ne(True) & ~ordered.FastF1Generated.fillna(False)
            ]
            if len(normal) < MIN_BASELINE:
                excluded.append({**identity, "reason": "insufficient-normal-baseline", "baselineLaps": len(normal)})
                continue
            baseline = float(normal.LapTimeSeconds.median())
            loss = float(in_lap.LapTimeSeconds + out_lap.LapTimeSeconds - 2 * baseline)
            if loss <= 0 or not np.isfinite(loss):
                excluded.append({**identity, "reason": "nonpositive-loss", "estimatedLossSeconds": numeric(loss)})
                continue
            samples.append({
                **identity, "inCompound": str(in_lap.Compound), "outCompound": str(out_lap.Compound),
                "inLapSeconds": numeric(in_lap.LapTimeSeconds), "outLapSeconds": numeric(out_lap.LapTimeSeconds),
                "localBaselineSeconds": numeric(baseline), "estimatedLossSeconds": numeric(loss),
                "baselineLaps": [{"lap": int(row.LapNumber), "seconds": numeric(row.LapTimeSeconds)} for _, row in normal.iterrows()],
            })
    retained, bounds = samples, None
    if len(samples) >= MIN_BASELINE:
        q1, q3 = np.quantile([sample["estimatedLossSeconds"] for sample in samples], [.25, .75])
        iqr = max(IQR_FLOOR, q3 - q1)
        low, high = q1 - IQR_MULTIPLIER * iqr, q3 + IQR_MULTIPLIER * iqr
        bounds = [numeric(low), numeric(high)]
        retained = [sample for sample in samples if low <= sample["estimatedLossSeconds"] <= high]
        excluded.extend({"driver": sample["driver"], "pitAfterLap": sample["pitAfterLap"], "reason": "iqr-outlier", "estimatedLossSeconds": sample["estimatedLossSeconds"]} for sample in samples if not low <= sample["estimatedLossSeconds"] <= high)
    values = [sample["estimatedLossSeconds"] for sample in retained]
    reliable = len(values) >= MIN_PAIRS
    return {
        "status": "observational-estimate" if reliable else "insufficient-samples",
        "rawSamples": len(samples), "retainedSamples": len(values),
        "medianSeconds": numeric(np.median(values), 3) if reliable else None,
        "sampleMedianSeconds": numeric(np.median(values), 3) if values else None,
        "iqrSeconds": [numeric(value, 3) for value in np.quantile(values, [.25, .75])] if values else None,
        "outlierBoundsSeconds": bounds, "samples": retained, "excludedPairs": excluded,
    }


def safe_error(error):
    # Do not publish local absolute paths from dependency/cache exception text.
    message = re.sub(r"[A-Za-z]:[\\/][^\r\n]*", "<local-path omitted>", str(error))
    return {"type": type(error).__name__, "message": message[:300]}


def collect_track(config):
    track_id, event_name = config
    if event_name is None:
        return {"trackId": track_id, "status": "no-historical-event", "selectedSeason": None, "selectedAttemptIndex": None, "medianSeconds": None, "retainedSamples": 0, "fallbackReason": None, "attempts": [], "reason": "Madrid has no race in the 2023-2025 collection range. Barcelona is a different circuit and is not substituted. No 2026 result is inferred."}
    attempts = []
    for season in SEASONS:
        print(f"START {track_id} {season}", flush=True)
        attempt = {"season": season, "requestedEventName": event_name}
        try:
            session = fastf1.get_session(season, event_name, "R")
            if str(session.event.EventName) != event_name:
                raise ValueError(f"Resolved wrong event: {session.event.EventName}")
            attempt.update({"eventName": event_name, "eventDate": str(session.event.EventDate), "timingSourceUrl": "https://livetiming.formula1.com" + session.api_path, "libraryVersion": fastf1.__version__})
            session.load(laps=True, telemetry=False, weather=False, messages=False)
            laps = pd.DataFrame(session.laps.copy())
            laps["LapTimeSeconds"] = laps.LapTime.dt.total_seconds()
            estimate = pit_loss_samples(laps)
            attempt.update({"status": estimate["status"], "rawLaps": len(laps), "pitLoss": estimate})
        except Exception as error:
            attempt.update({"status": "unavailable", "error": safe_error(error)})
        attempts.append(attempt)
        print(f"DONE {track_id} {season}: {attempt['status']} / n={attempt.get('pitLoss', {}).get('retainedSamples', 0)} / median={attempt.get('pitLoss', {}).get('medianSeconds')}", flush=True)
        if attempt["status"] == "observational-estimate":
            return {"trackId": track_id, "status": "observational-estimate", "selectedSeason": season, "selectedAttemptIndex": len(attempts) - 1, "medianSeconds": estimate["medianSeconds"], "retainedSamples": estimate["retainedSamples"], "fallbackReason": None if season == SEASONS[0] else "; ".join(f"{row['season']}: {row['status']}" for row in attempts[:-1]), "attempts": attempts}
    return {"trackId": track_id, "status": "unavailable-or-insufficient", "selectedSeason": None, "selectedAttemptIndex": None, "medianSeconds": None, "retainedSamples": 0, "fallbackReason": None, "attempts": attempts, "reason": "No attempt met the minimum retained green/dry pit-pair gate."}


def document(rows):
    return {
        "schemaVersion": 1, "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "generatedBy": "tools/collect_pit_loss_evidence.py", "preferredSeason": SEASONS[0],
        "fallbackSeasons": list(SEASONS[1:]), "formula": FORMULA,
        "method": {
            "units": "seconds", "source": "F1 official live timing through FastF1 3.8.3", "documentationUrl": "https://docs.fastf1.dev/core.html",
            "pairFilter": "Consecutive in-lap/out-lap, complete duration, both TrackStatus exactly 1, S/M/H only, no FastF1-generated laps. PitInTime/PitOutTime identify laps only; their difference is NEVER used.",
            "baselineFilter": "Same driver, within four race laps either side; no pit in/out, green, accurate, not deleted/generated, dry compound, complete duration, exclude race lap 1.",
            "thresholds": {
                "localWindow": {"value": LOCAL_WINDOW, "unit": "race laps", "source": "existing project pit-loss estimator"},
                "minimumBaselineLaps": {"value": MIN_BASELINE, "unit": "normal laps", "source": "existing project quality gate"},
                "minimumPairs": {"value": MIN_PAIRS, "unit": "pit pairs", "source": "existing project reporting gate"},
                "iqrMultiplier": {"value": IQR_MULTIPLIER, "unit": "IQR", "source": "existing project outlier filter"},
                "iqrFloorSeconds": {"value": IQR_FLOOR, "unit": "seconds", "source": "existing project numerical floor"},
            },
            "changeFromOriginalSevenCircuitCollector": "Same formula and numeric gates; raw baseline laps and rejection reasons are now auditable. Generated pit laps and deleted/generated/first-race-lap baseline rows are explicitly excluded.",
        },
        "summary": {"requiredTracks": len(EVENTS), "completedTracks": sum(row["status"] != "pending" for row in rows), "estimatedTracks": sum(row["status"] == "observational-estimate" for row in rows), "fallbackTracks": sum(row.get("selectedSeason") is not None and row["selectedSeason"] != SEASONS[0] for row in rows), "noHistoryTracks": sum(row["status"] == "no-historical-event" for row in rows)},
        "tracks": rows,
        "limitations": [
            "Observational in/out-lap time-loss proxy, not stationary wheel-change duration or pit-lane telemetry.",
            "Tyre compound change, warm-up, fuel progression and traffic can bias the local-baseline estimator.",
            "A reported estimate requires three retained green/dry pairs. Wet/SC stops are excluded rather than treated as equivalent green pit losses.",
            "Selected historical season is explicit and is not a claim about 2026 pit-lane rules, speed limits, tyre rules or car performance.",
            "Single-event estimates are kept separate from the existing 2023-2025 pooled seven-circuit calibration.",
        ],
    }


def summary_document(data, source_digest):
    tracks = []
    for row in data["tracks"]:
        attempts = []
        for attempt in row.get("attempts", []):
            compact = {**attempt}
            if "pitLoss" in attempt:
                compact["pitLoss"] = {key: value for key, value in attempt["pitLoss"].items() if key not in ("samples", "excludedPairs")}
            attempts.append(compact)
        tracks.append({**row, "attempts": attempts})
    return {**data, "tracks": tracks, "sourceDocument": OUTPUT.name, "sourceSha256": source_digest, "sourceHashNormalization": "UTF-8 text with LF line endings (portable across Git CRLF conversion)", "note": "Compact metadata only. Individual in/out and baseline laps remain in the source document, loaded only for audit/download."}


def save(rows):
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    data = document(rows)
    raw_text = json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    temporary = OUTPUT.with_suffix(".tmp")
    temporary.write_bytes(raw_text.encode("utf-8"))
    temporary.replace(OUTPUT)
    compact = summary_document(data, hashlib.sha256(OUTPUT.read_text(encoding="utf-8").encode("utf-8")).hexdigest())
    temporary_summary = SUMMARY_OUTPUT.with_suffix(".tmp")
    temporary_summary.write_bytes((json.dumps(compact, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8"))
    temporary_summary.replace(SUMMARY_OUTPUT)


def check_output():
    data = json.loads(OUTPUT.read_text(encoding="utf-8"))
    compact = json.loads(SUMMARY_OUTPUT.read_text(encoding="utf-8"))
    assert compact == summary_document(data, hashlib.sha256(OUTPUT.read_text(encoding="utf-8").encode("utf-8")).hexdigest()), "raw/compact metadata or source hash mismatch"
    assert [row["trackId"] for row in data["tracks"]] == [row[0] for row in EVENTS]
    for row in data["tracks"]:
        assert row["status"] != "pending", row["trackId"]
        if row["status"] != "observational-estimate":
            assert row["medianSeconds"] is None and row["selectedSeason"] is None
            continue
        selected = row["attempts"][row["selectedAttemptIndex"]]
        assert selected["season"] == row["selectedSeason"]
        assert selected["timingSourceUrl"].startswith("https://livetiming.formula1.com/static/")
        estimate = selected["pitLoss"]
        assert len(estimate["samples"]) == row["retainedSamples"] >= MIN_PAIRS
        assert estimate["medianSeconds"] == row["medianSeconds"]
        if row["selectedSeason"] != SEASONS[0]:
            assert row["fallbackReason"] and row["attempts"][0]["season"] == SEASONS[0]
        for sample in estimate["samples"]:
            baseline = np.median([item["seconds"] for item in sample["baselineLaps"]])
            assert len(sample["baselineLaps"]) >= MIN_BASELINE
            assert abs(baseline - sample["localBaselineSeconds"]) < 1e-6
            recalculated = sample["inLapSeconds"] + sample["outLapSeconds"] - 2 * baseline
            assert abs(recalculated - sample["estimatedLossSeconds"]) < 1e-6
            assert recalculated > 0
        assert numeric(np.median([item["estimatedLossSeconds"] for item in estimate["samples"]]), 3) == row["medianSeconds"]
    madrid = next(row for row in data["tracks"] if row["trackId"] == "madrid")
    assert madrid["status"] == "no-historical-event" and madrid["attempts"] == []
    assert data["summary"] == document(data["tracks"])["summary"]
    print("PASS: raw/compact metadata + SHA256, 24-circuit identities, explicit missing/fallback status, sample formula, baseline medians, quality gates and summary counts", flush=True)


def self_test():
    def fixture(losses):
        rows = []
        for driver, loss in enumerate(losses):
            for lap in range(1, 11):
                rows.append({"Driver": str(driver), "LapNumber": lap, "LapTimeSeconds": 80 + loss / 2 if lap in (5, 6) else 80,
                    "PitInTime": 100 if lap == 5 else np.nan, "PitOutTime": 900 if lap == 6 else np.nan,
                    "TrackStatus": "1", "Compound": "MEDIUM", "IsAccurate": lap not in (5, 6), "Deleted": False, "FastF1Generated": False})
        return pd.DataFrame(rows)
    normal = pit_loss_samples(fixture([22, 22, 22]))
    assert normal["status"] == "observational-estimate" and normal["medianSeconds"] == 22
    assert normal["medianSeconds"] != 900 - 100, "pit timestamp difference must not be used"
    outlier = pit_loss_samples(fixture([22, 22, 22, 22, 100]))
    assert outlier["retainedSamples"] == 4 and outlier["excludedPairs"][0]["reason"] == "iqr-outlier"
    sc = fixture([22, 22, 22])
    sc.loc[(sc.Driver == "0") & (sc.LapNumber == 5), "TrackStatus"] = "4"
    insufficient = pit_loss_samples(sc)
    assert insufficient["retainedSamples"] == 2 and insufficient["medianSeconds"] is None
    assert insufficient["excludedPairs"][0]["reason"] == "non-green-pair"
    negative = pit_loss_samples(fixture([-2, -2, -2]))
    assert negative["retainedSamples"] == 0 and negative["medianSeconds"] is None
    print("PASS: known formula, pit timestamp exclusion, IQR outlier, SC exclusion, insufficient-sample null and nonpositive loss", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", type=Path, default=ROOT / "work" / "fastf1-cache")
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if args.check:
        check_output()
        return
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    fastf1.Cache.enable_cache(str(args.cache_dir))
    previous = json.loads(OUTPUT.read_text(encoding="utf-8"))["tracks"] if args.resume and OUTPUT.exists() else []
    rows = [next((item for item in previous if item["trackId"] == track_id and item["status"] != "pending"), {"trackId": track_id, "status": "pending", "selectedSeason": None, "medianSeconds": None}) for track_id, _ in EVENTS]
    save(rows)
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(3, args.workers))) as pool:
        pending = {pool.submit(collect_track, config): index for index, config in enumerate(EVENTS) if rows[index]["status"] == "pending"}
        for future in concurrent.futures.as_completed(pending):
            index = pending[future]
            rows[index] = future.result()
            save(rows)
            print("PROGRESS " + json.dumps(document(rows)["summary"]), flush=True)
    check_output()


if __name__ == "__main__":
    main()
