"""Collect 2018-2025 race SC/VSC observations from small official timing streams.

No lap, car telemetry, or driver timing load is performed. Frequencies describe
the archived TrackStatus feed, not a published FIA/Pirelli probability table.
Run: python tools/collect_neutralisation_evidence.py --workers 4
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import re
import sys
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
CHANNELS = ("TrackStatus", "LapCount", "SessionStatus", "WeatherData", "RaceControlMessages")
YEARS = tuple(range(2018, 2026))
CURRENT_TRACKS = (
    "melbourne", "shanghai", "suzuka", "bahrain", "jeddah", "miami", "montreal", "monaco",
    "barcelona", "spielberg", "silverstone", "spa", "hungaroring", "zandvoort", "monza", "madrid",
    "baku", "singapore", "austin", "mexico-city", "sao-paulo", "las-vegas", "lusail", "yas-marina",
)
LOCATION_IDS = {
    "melbourne": "melbourne", "shanghai": "shanghai", "suzuka": "suzuka", "sakhir": "bahrain",
    "jeddah": "jeddah", "miami gardens": "miami", "miami": "miami", "montreal": "montreal",
    "monte carlo": "monaco", "monaco": "monaco", "barcelona": "barcelona", "spielberg": "spielberg",
    "silverstone": "silverstone", "spa-francorchamps": "spa", "budapest": "hungaroring",
    "zandvoort": "zandvoort", "monza": "monza", "baku": "baku", "singapore": "singapore",
    "marina bay": "singapore", "austin": "austin", "mexico city": "mexico-city",
    "sao paulo": "sao-paulo", "las vegas": "las-vegas", "lusail": "lusail", "losail": "lusail",
    "yas marina": "yas-marina", "yas island": "yas-marina", "abu dhabi": "yas-marina",
    "le castellet": "historical-paul-ricard", "hockenheim": "historical-hockenheim",
    "sochi": "historical-sochi", "mugello": "historical-mugello", "nurburg": "historical-nurburgring",
    "nurburgring": "historical-nurburgring", "portimao": "historical-portimao",
    "imola": "historical-imola", "istanbul": "historical-istanbul",
}
QUALITY = {
    "minimumRacesForSuggestedAdoption": 5,
    "minimumEpisodesForSuggestedDurationAdoption": 3,
    "weatherMaximumCarrySeconds": 180,
    "wilsonCriticalValue95": 1.959963984540054,
}


def normalize(value):
    return "".join(c for c in unicodedata.normalize("NFKD", value) if not unicodedata.combining(c)).lower()


def track_id(location, event_name):
    # Same location, materially different circuit layout: never pool the outer loop.
    if event_name == "Sakhir Grand Prix":
        return "historical-sakhir-outer"
    return LOCATION_IDS.get(normalize(location))


def parse_stream(raw):
    records, errors = [], []
    for line_no, line in enumerate(raw.lstrip("\ufeff").splitlines(), 1):
        if not line.strip():
            continue
        match = re.match(r"^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)(\{.*)$", line.strip())
        if not match:
            errors.append({"line": line_no, "reason": "unrecognised timestamp/JSON record"})
            continue
        try:
            body = json.loads(match[4])
            if not isinstance(body, dict):
                raise ValueError("payload must be an object")
            records.append({"time": int(match[1]) * 3600 + int(match[2]) * 60 + float(match[3]), "data": body})
        except (ValueError, TypeError) as error:
            errors.append({"line": line_no, "reason": str(error)})
    return sorted(records, key=lambda row: row["time"]), errors


def scalar_transitions(records, key):
    result = []
    for row in records:
        if key in row["data"]:
            item = (row["time"], str(row["data"][key]))
            if result and result[-1][0] == item[0]:
                result[-1] = item
            elif not result or result[-1][1] != item[1]:
                result.append(item)
    return result


def intersect(a, b):
    start, end = max(a[0], b[0]), min(a[1], b[1])
    return (start, end) if end > start else None


def active_race_intervals(session_records):
    transitions = scalar_transitions(session_records, "Status")
    starts = [time for time, value in transitions if value == "Started"]
    if not starts:
        return [], None, "no Started session status"
    start = min(starts)
    finishes = [time for time, value in transitions if value == "Finished" and time > start]
    # Aborted -> Finalised without Finished includes 2021 Belgium. Do not label
    # its absence of TrackStatus code 4 as an observed zero-SC normal race.
    if not finishes:
        return [], None, "no Finished status; exceptional/aborted race excluded from normal-race frequency"
    finish = min(finishes)
    active, pending = [], None
    for time, value in transitions:
        if time > finish:
            break
        if value == "Started" and pending is None:
            pending = time
        elif value in ("Aborted", "Finished", "Inactive", "Finalised", "Ends") and pending is not None:
            if time > pending:
                active.append((pending, time))
            pending = None
    if pending is not None and pending < finish:
        active.append((pending, finish))
    return active, (start, finish), None


def state_intervals(transitions, span):
    result = []
    for index, (start, value) in enumerate(transitions):
        end = transitions[index + 1][0] if index + 1 < len(transitions) else span[1]
        overlap = intersect((start, end), span)
        if overlap:
            result.append((overlap[0], overlap[1], value))
    return result


def lap_boundaries(records, span):
    transitions = scalar_transitions(records, "CurrentLap")
    values, problems = [], []
    for time, raw in transitions:
        try:
            lap = int(raw)
        except ValueError:
            problems.append("noninteger CurrentLap")
            continue
        if lap < 1 or time > span[1]:
            continue
        time = max(span[0], time)
        if values and lap <= values[-1][1]:
            problems.append("CurrentLap reset/non-increase")
            continue
        if values and lap > values[-1][1] + 1:
            problems.append("CurrentLap gap")
        if values and time <= values[-1][0]:
            problems.append("multiple racing laps before the first Started status")
            continue
        values.append((time, lap))
    if not values or values[0][1] != 1:
        problems.append("first racing lap is not mapped")
    return values, sorted(set(problems))


def weather_overlap(start, end, weather):
    rainy, known = 0.0, 0.0
    for index, (time, rain) in enumerate(weather):
        next_time = weather[index + 1][0] if index + 1 < len(weather) else end
        stop = min(next_time, time + QUALITY["weatherMaximumCarrySeconds"])
        part = intersect((start, end), (time, stop))
        if part and rain in ("0", "1", "False", "True", "false", "true"):
            duration = part[1] - part[0]
            known += duration
            if rain in ("1", "True", "true"):
                rainy += duration
    return {"rainfallSeconds": round(rainy, 3), "unknownWeatherSeconds": round(max(0, end - start - known), 3)}


def annotate_period(period, laps, span, weather, track_transitions):
    start, end = period["startSeconds"], period["endSeconds"]
    affected, equivalent = [], 0.0
    for index, (lap_start, lap) in enumerate(laps):
        lap_end = laps[index + 1][0] if index + 1 < len(laps) else span[1]
        overlap = intersect((start, end), (lap_start, lap_end))
        if overlap:
            affected.append(lap)
            equivalent += (overlap[1] - overlap[0]) / (lap_end - lap_start)
    end_state = next((value for time, value in track_transitions if abs(time - end) < 0.001), None)
    return {**period, "durationSeconds": round(end - start, 3),
            "startLap": min(affected) if affected else None, "endLap": max(affected) if affected else None,
            "affectedLeaderLaps": len(affected) if affected else None,
            "leaderLapEquivalent": round(equivalent, 6) if affected else None,
            "endsWithRedFlag": end_state == "5", **weather_overlap(start, end, weather)}


def control_deployments(records, active):
    result = []
    for row in records:
        if not any(start <= row["time"] < end for start, end in active):
            continue
        messages = row["data"].get("Messages", {})
        for message in messages.values() if isinstance(messages, dict) else messages:
            if not isinstance(message, dict):
                continue
            text = str(message.get("Message", ""))
            upper = text.upper()
            if "SAFETY CAR DEPLOYED" in upper:
                result.append({"timeSeconds": row["time"], "kind": "VSC" if "VIRTUAL" in upper else "SC", "message": text})
    return result


def analyse_streams(streams):
    active, span, error = active_race_intervals(streams.get("SessionStatus", []))
    result = {"analysisStatus": "unavailable", "frequencyEligible": False,
              "scOccurred": None, "vscOccurred": None, "periods": [], "exclusions": [], "warnings": []}
    if error:
        result["exclusions"].append(error)
        return result
    transitions = scalar_transitions(streams.get("TrackStatus", []), "Status")
    if not transitions:
        result["exclusions"].append("TrackStatus unavailable")
        return result
    if transitions[0][0] > span[0]:
        result["exclusions"].append("TrackStatus state unavailable at race start")
    unknown = sorted({value for _, value in transitions if value not in ("1", "2", "4", "5", "6", "7")})
    if unknown:
        result["exclusions"].append(f"unrecognised TrackStatus codes: {unknown}")
        return result
    states = state_intervals(transitions, span)
    laps, lap_problems = lap_boundaries(streams.get("LapCount", []), span)
    result["warnings"].extend(lap_problems)
    # WeatherData is sampled every minute. Preserve every sample, including
    # repeated values; collapsing it would incorrectly turn known weather stale.
    weather = [(row["time"], str(row["data"]["Rainfall"])) for row in streams.get("WeatherData", []) if "Rainfall" in row["data"]]
    periods = []
    for race_part in active:
        ongoing = None
        for start, end, status in states:
            part = intersect((start, end), race_part)
            if not part:
                continue
            kind = "SC" if status == "4" else "VSC" if status in ("6", "7") else None
            if ongoing and (kind != ongoing["kind"] or abs(part[0] - ongoing["endSeconds"]) > 0.001):
                periods.append(ongoing)
                ongoing = None
            if kind:
                if ongoing is None:
                    ongoing = {"kind": kind, "startSeconds": part[0], "endSeconds": part[1], "statusCodes": [status]}
                else:
                    ongoing["endSeconds"] = part[1]
                    if status not in ongoing["statusCodes"]:
                        ongoing["statusCodes"].append(status)
        if ongoing:
            periods.append(ongoing)
    if any(row["kind"] == "VSC" and "6" not in row["statusCodes"] for row in periods):
        result["exclusions"].append("orphan VSC-ending code 7 without code 6 inside this race segment")
    deployments = control_deployments(streams.get("RaceControlMessages", []), active)
    for kind in ("SC", "VSC"):
        if any(row["kind"] == kind for row in deployments) and not any(row["kind"] == kind for row in periods):
            result["exclusions"].append(f"race control deployed {kind} but corresponding TrackStatus period is absent")
    annotated = [annotate_period(row, laps if not lap_problems else [], span, weather, transitions) for row in periods]
    race_weather = [weather_overlap(start, end, weather) for start, end in active]
    rainfall = round(sum(row["rainfallSeconds"] for row in race_weather), 3)
    unknown_weather = round(sum(row["unknownWeatherSeconds"] for row in race_weather), 3)
    red = [(start, end) for start, end, status in states if status == "5"]
    eligible = not result["exclusions"]
    result.update({"analysisStatus": "observed" if eligible else "conflicting-or-incomplete",
                   "frequencyEligible": eligible, "scOccurred": any(row["kind"] == "SC" for row in periods) if eligible else None,
                   "vscOccurred": any(row["kind"] == "VSC" for row in periods) if eligible else None,
                   "raceWindowSeconds": list(span), "activeRaceIntervalsSeconds": [list(row) for row in active],
                   "observedLastLeaderLap": laps[-1][1] if laps else None,
                   "lapMappingAvailable": bool(laps) and not lap_problems, "periods": annotated,
                   "rainfallRecorded": rainfall > 0 if unknown_weather == 0 or rainfall > 0 else None,
                   "rainfallSeconds": rainfall, "unknownWeatherSeconds": unknown_weather,
                   "redFlagOccurred": bool(red), "redFlagSeconds": round(sum(end - start for start, end in red), 3),
                   "redFlagIntervalsSeconds": [list(row) for row in red], "raceControlDeployments": deployments,
                   "scVscOverlapSeconds": sum(max(0, min(left["endSeconds"], right["endSeconds"]) - max(left["startSeconds"], right["startSeconds"]))
                       for left in annotated if left["kind"] == "SC" for right in annotated if right["kind"] == "VSC")})
    return result


def wilson_interval(numerator, denominator):
    if not denominator:
        return None
    z, n, p = QUALITY["wilsonCriticalValue95"], denominator, numerator / denominator
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    margin = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    # Exact boundary observations have exact 0/1 bounds; avoid floating-point
    # cancellation making a 0/n lower bound slightly greater than zero.
    return [0 if numerator == 0 else max(0, centre - margin),
            1 if numerator == denominator else min(1, centre + margin)]


def summarize_kind(events, kind):
    observed = [event for event in events if event["frequencyEligible"]]
    numerator = sum(event["scOccurred" if kind == "SC" else "vscOccurred"] for event in observed)
    periods = [period for event in observed for period in event["periods"] if period["kind"] == kind]
    mapped = [period for period in periods if period["affectedLeaderLaps"] is not None]
    histogram = {}
    for period in mapped:
        key = str(period["affectedLeaderLaps"])
        histogram[key] = histogram.get(key, 0) + 1
    enough = len(observed) >= QUALITY["minimumRacesForSuggestedAdoption"]
    return {"racesWithEvent": numerator, "eligibleRaces": len(observed),
            "perRaceProbability": numerator / len(observed) if observed else None,
            "binomialWilsonCI95": wilson_interval(numerator, len(observed)),
            "suggestedFrequencyAdoption": "observed" if enough else "project-estimate-fallback-required",
            "episodeCount": len(periods), "mappedEpisodes": len(mapped),
            "durationLeaderLaps": [period["affectedLeaderLaps"] for period in mapped],
            "durationLapHistogram": dict(sorted(histogram.items(), key=lambda pair: int(pair[0]))),
            "durationSeconds": [period["durationSeconds"] for period in periods],
            "durationLapEquivalent": [period["leaderLapEquivalent"] for period in mapped],
            "rainOverlappingEpisodes": sum(period["rainfallSeconds"] > 0 for period in periods),
            "unknownWeatherEpisodes": sum(period["unknownWeatherSeconds"] > 0 for period in periods),
            "redFlagTerminatedEpisodes": sum(period["endsWithRedFlag"] for period in periods),
            "suggestedDurationAdoption": "observed" if len(mapped) >= QUALITY["minimumEpisodesForSuggestedDurationAdoption"] else "project-estimate-fallback-required"}


def summarize_venue(identifier, events):
    rows = [event for event in events if event["trackId"] == identifier]
    observed = [event for event in rows if event["frequencyEligible"]]
    return {"trackId": identifier, "sourcePeriod": {"fromYear": min(YEARS), "toYear": max(YEARS)},
            "scheduledRaces": len(rows), "eligibleRaces": len(observed), "missingOrExcludedRaces": len(rows) - len(observed),
            "eventIds": [event["id"] for event in rows], "eligibleEventIds": [event["id"] for event in observed],
            "missingEventIds": [event["id"] for event in rows if not event["frequencyEligible"]],
            "sc": summarize_kind(rows, "SC"), "vsc": summarize_kind(rows, "VSC"),
            "rainfallRecordedRaces": sum(event.get("rainfallRecorded") is True for event in observed),
            "weatherUnknownRaces": sum(event.get("unknownWeatherSeconds", 1) > 0 for event in observed),
            "redFlagRaces": sum(event.get("redFlagOccurred", False) for event in observed),
            "dryWeatherSubset": {"definition": "no Rainfall=1 and complete sampled Rainfall coverage during active race; NOT proof of dry track",
                                 "sc": summarize_kind([event for event in observed if event.get("rainfallRecorded") is False], "SC"),
                                 "vsc": summarize_kind([event for event in observed if event.get("rainfallRecorded") is False], "VSC")}}


def fetch_channel(base_url, channel, cache_dir):
    import requests
    url = f"{base_url}{channel}.jsonStream"
    path = cache_dir / f"{hashlib.sha256(url.encode()).hexdigest()}.txt"
    try:
        if path.exists():
            raw = path.read_text(encoding="utf-8")
            origin = "local raw-response cache"
        else:
            response = requests.get(url, timeout=35)
            response.raise_for_status()
            raw = response.content.decode("utf-8-sig")
            path.write_text(raw, encoding="utf-8")
            origin = "official HTTP response"
        records, errors = parse_stream(raw)
        return records, {"url": url, "status": "collected" if records else "empty", "recordCount": len(records),
                         "parseErrors": errors, "sha256": hashlib.sha256(raw.encode()).hexdigest(), "origin": origin}
    except Exception as error:
        return [], {"url": url, "status": "unavailable", "errorType": type(error).__name__, "error": str(error)[:350], "recordCount": None}


def collect_event(event, cache_dir, previous_sources=None):
    streams, sources = {}, {}
    for channel in CHANNELS:
        if previous_sources is None:
            streams[channel], sources[channel] = fetch_channel(event["timingBaseUrl"], channel, cache_dir)
        else:
            source = previous_sources[channel]
            path = cache_dir / f"{hashlib.sha256(source['url'].encode()).hexdigest()}.txt"
            if source["status"] == "collected" and path.exists():
                streams[channel], errors = parse_stream(path.read_text(encoding="utf-8"))
                sources[channel] = {**source, "parseErrors": errors, "analysisReadFrom": "local raw-response cache"}
            else:
                streams[channel], sources[channel] = [], source
    analysis = analyse_streams(streams)
    required_bad = [channel for channel in ("TrackStatus", "SessionStatus")
                    if sources[channel]["status"] != "collected" or sources[channel].get("parseErrors")]
    if required_bad:
        analysis.update({"frequencyEligible": False, "scOccurred": None, "vscOccurred": None, "analysisStatus": "unavailable"})
        analysis["exclusions"].append(f"required stream unavailable/malformed: {required_bad}")
    if sources["LapCount"].get("parseErrors"):
        analysis["warnings"].append("LapCount parse errors: duration mapping excluded")
        analysis["lapMappingAvailable"] = False
        for period in analysis["periods"]:
            period.update({"startLap": None, "endLap": None, "affectedLeaderLaps": None, "leaderLapEquivalent": None})
    for optional in ("WeatherData", "RaceControlMessages"):
        if sources[optional]["status"] != "collected" or sources[optional].get("parseErrors"):
            analysis["warnings"].append(f"{optional} unavailable/incomplete: no complete cross-check claimed")
    return {**event, **analysis, "sources": sources}


def build_document(events, schedules, library_version):
    venues = [summarize_venue(identifier, events) for identifier in CURRENT_TRACKS]
    historical_ids = sorted({event["trackId"] for event in events if event["trackId"] and event["trackId"] not in CURRENT_TRACKS})
    return {"schemaVersion": 1, "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
            "generatedBy": "tools/collect_neutralisation_evidence.py", "fastf1Version": library_version,
            "classification": "official-timing-derived-project-observational-frequency",
            "source": {"timingBaseUrl": "https://livetiming.formula1.com/static/", "statusDocumentationUrl": "https://docs.fastf1.dev/api.html#fastf1.api.track_status_data"},
            "sourcePeriod": {"fromYear": min(YEARS), "toYear": max(YEARS), "session": "Race; sprint/testing excluded"},
            "methodology": {"codes": {"4": "SC", "6": "VSC", "7": "VSC ending; merged with preceding 6", "5": "red; separate"},
                "raceWindow": "first SessionStatus Started through first Finished, excluding Aborted-to-restarted pauses; no Finished means exceptional/excluded",
                "frequency": "races with >=1 eligible period / eligible races; NOT incidents per lap; includes rain-affected normal races",
                "duration": "count of leader LapCount intervals intersected by an active status period; seconds retained; fractional lap-equivalent uses adjacent leader updates",
                "lapLimitations": "partly covered laps count as touched; last lap ends at first Finished; this is not every car's distance or stationary duration",
                "weather": "Rainfall samples, capped carry of 180 s. Unknown stays unknown; no rain does not establish dry surface. Rain/red intersections retained separately.",
                "crossCheck": "official RaceControlMessages DEPLOYED without any corresponding period excludes that race; no message channel is flagged but does not create synthetic periods",
                "qualityRules": {key: {"value": value, "classification": "project sampling/statistical convention"} for key, value in QUALITY.items()},
                "limitations": ["Archive flags may omit special safety-car starts; excluded races are not zeros.", "2018-2025 layout, rule, weather and race-control differences are not adjusted; observed frequency is not a 2026 prediction.", "Small samples have wide binomial intervals; no-rain subset is not a tyre-compound analysis.", "Leader-lap duration distributions include partial laps and can be biased by red flags; preserve seconds and overlap metadata.", "SC/VSC are mutually exclusive in a single TrackStatus channel; transition between them creates separate periods.", "No FIA/Pirelli-published probability value is claimed. No model fallback probability is inserted into observed fields."]},
            "schedules": schedules,
            "summary": {"scheduledRaces": len(events), "eligibleRaces": sum(event["frequencyEligible"] for event in events),
                        "excludedRaces": sum(not event["frequencyEligible"] for event in events),
                        "currentVenues": len(venues), "venuesWithObservedFrequency": sum(venue["sc"]["suggestedFrequencyAdoption"] == "observed" for venue in venues),
                        "unmappedEventIds": [event["id"] for event in events if event["trackId"] is None]},
            "venues": venues, "historicalVenues": [summarize_venue(identifier, events) for identifier in historical_ids], "events": events}


def build_compact_summary(document):
    """Runtime metadata only; full event periods/channel responses stay lazy."""
    result = {key: document[key] for key in ("schemaVersion", "generatedAt", "classification", "sourcePeriod", "summary")}
    result["rawEvidenceFile"] = "neutralisation-evidence.json"
    result["qualityRules"] = document["methodology"]["qualityRules"]
    result["source"] = document["source"]
    result["venues"] = []
    by_id = {event["id"]: event for event in document["events"]}
    for venue in document["venues"]:
        row = {key: venue[key] for key in ("trackId", "scheduledRaces", "eligibleRaces", "missingOrExcludedRaces", "rainfallRecordedRaces", "weatherUnknownRaces", "redFlagRaces")}
        source_event = next((by_id[event_id] for event_id in venue["eligibleEventIds"]), None)
        row["sourceUrl"] = source_event["timingBaseUrl"] + "TrackStatus.jsonStream" if source_event else None
        for kind in ("sc", "vsc"):
            row[kind] = {key: venue[kind][key] for key in ("racesWithEvent", "eligibleRaces", "perRaceProbability", "binomialWilsonCI95", "mappedEpisodes", "durationLeaderLaps")}
        exclusions = {}
        for event_id in venue["missingEventIds"]:
            for reason in by_id[event_id]["exclusions"]:
                exclusions[reason] = exclusions.get(reason, 0) + 1
        row["exclusionReasons"] = exclusions
        result["venues"].append(row)
    return result


def write_documents(document, output):
    output.write_text(json.dumps(document, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    compact_path = output.with_name("neutralisation-summary.json")
    compact_path.write_text(json.dumps(build_compact_summary(document), ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--cache-dir", type=Path, default=ROOT.parent / "neutralisation-cache")
    parser.add_argument("--output", type=Path, default=ROOT / "app/data/neutralisation-evidence.json")
    parser.add_argument("--limit", type=int, default=None, help="diagnostic subset only; omit for the full 2018-2025 study")
    parser.add_argument("--offline-rebuild", action="store_true", help="reanalyse saved successful responses; preserve actual unavailable-source errors without refetching")
    args = parser.parse_args()
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    if args.offline_rebuild:
        previous = json.loads(args.output.read_text(encoding="utf-8"))
        keys = ("id", "season", "round", "eventName", "eventDate", "location", "trackId", "timingBaseUrl")
        collected = [collect_event({key: event[key] for key in keys}, args.cache_dir, event["sources"]) for event in previous["events"]]
        document = build_document(collected, previous["schedules"], previous["fastf1Version"])
        document["diagnosticSubset"] = previous["diagnosticSubset"]
        document["originalCollectionAt"] = previous.get("originalCollectionAt", previous["generatedAt"])
        document["reanalysisMode"] = "offline; failed requests not retried or bypassed"
        write_documents(document, args.output)
        print(json.dumps(document["summary"], ensure_ascii=False), flush=True)
        return
    import fastf1
    fastf1.Cache.enable_cache(str(ROOT.parent / "fastf1-cache"))
    events, schedules = [], []
    for year in YEARS:
        try:
            schedule = fastf1.get_event_schedule(year, include_testing=False)
            schedules.append({"season": year, "status": "collected", "rounds": len(schedule), "provider": "FastF1 event schedule; each official API path recorded below"})
            for _, row in schedule.iterrows():
                session = fastf1.get_session(year, int(row["RoundNumber"]), "R")
                identifier = track_id(str(row["Location"]), str(row["EventName"]))
                events.append({"id": f"{year}-r{int(row['RoundNumber']):02d}", "season": year, "round": int(row["RoundNumber"]),
                               "eventName": str(row["EventName"]), "eventDate": str(row["EventDate"].date()), "location": str(row["Location"]),
                               "trackId": identifier, "timingBaseUrl": "https://livetiming.formula1.com" + session.api_path})
        except Exception as error:
            schedules.append({"season": year, "status": "unavailable", "errorType": type(error).__name__, "error": str(error)[:350]})
    if args.limit is not None:
        events = events[:args.limit]
    collected = []
    with ThreadPoolExecutor(max_workers=max(1, min(args.workers, 4))) as executor:
        futures = {executor.submit(collect_event, event, args.cache_dir): event for event in events}
        for future in as_completed(futures):
            row = future.result()
            collected.append(row)
            print(f"{len(collected)}/{len(events)} {row['id']} {row['eventName']}: {row['analysisStatus']} SC={row['scOccurred']} VSC={row['vscOccurred']} periods={len(row['periods'])}", flush=True)
    collected.sort(key=lambda row: (row["season"], row["round"]))
    document = build_document(collected, schedules, fastf1.__version__)
    document["diagnosticSubset"] = args.limit is not None
    write_documents(document, args.output)
    print(json.dumps(document["summary"], ensure_ascii=False), flush=True)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
