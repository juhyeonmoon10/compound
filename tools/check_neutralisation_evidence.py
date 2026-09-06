"""Check parser, race-window/SC/VSC mapping and every collected denominator.

Uses only the standard library and the pure functions in the collector.
  python tools/check_neutralisation_evidence.py
"""
import copy
import json
from pathlib import Path

from collect_neutralisation_evidence import (
    CHANNELS, CURRENT_TRACKS, QUALITY, YEARS, analyse_streams,
    parse_stream, summarize_venue, track_id, wilson_interval, build_compact_summary,
)

ROOT = Path(__file__).resolve().parents[1]


def record(time, **data):
    return {"time": time, "data": data}


def fixture():
    return {
        "SessionStatus": [record(0, Status="Inactive"), record(10, Status="Started"), record(85, Status="Aborted"), record(90, Status="Started"), record(110, Status="Finished"), record(130, Status="Finalised")],
        "TrackStatus": [record(0, Status="1"), record(20, Status="4"), record(50, Status="1"), record(60, Status="6"), record(75, Status="7"), record(80, Status="1"), record(85, Status="5"), record(90, Status="1"), record(120, Status="4")],
        "LapCount": [record(0, CurrentLap=1, TotalLaps=5), record(30, CurrentLap=2), record(50, CurrentLap=3), record(70, CurrentLap=4), record(90, CurrentLap=5)],
        "WeatherData": [record(0, Rainfall="0"), record(50, Rainfall="1"), record(65, Rainfall="0")],
        "RaceControlMessages": [record(60, Messages={"0": {"Message": "VIRTUAL SAFETY CAR DEPLOYED"}})],
    }


def check_synthetic():
    rows, errors = parse_stream('\ufeff00:00:00.000{"Status":"1"}\r\r\n00:01:03.500{"Status":"4"}\ninvalid\n')
    assert [row["time"] for row in rows] == [0, 63.5]
    assert len(errors) == 1
    result = analyse_streams(fixture())
    assert result["frequencyEligible"] and result["scOccurred"] and result["vscOccurred"]
    assert result["activeRaceIntervalsSeconds"] == [[10, 85], [90, 110]]
    assert len(result["periods"]) == 2, "VSC 6->7 must be one episode; post-Finished SC ignored"
    sc, vsc = result["periods"]
    assert sc["affectedLeaderLaps"] == 2 and sc["endLap"] == 2, "ending exactly at a lap boundary must not touch next lap"
    assert sc["durationSeconds"] == 30 and sc["leaderLapEquivalent"] == 1.5
    assert vsc["statusCodes"] == ["6", "7"] and vsc["durationSeconds"] == 20
    assert vsc["rainfallSeconds"] == 5 and vsc["unknownWeatherSeconds"] == 0
    assert result["redFlagSeconds"] == 5 and result["scVscOverlapSeconds"] == 0

    absent = fixture()
    absent["TrackStatus"] = absent["TrackStatus"][1:]
    missing = analyse_streams(absent)
    assert not missing["frequencyEligible"] and missing["scOccurred"] is None
    assert len(missing["periods"]) == 2, "known partial observations remain auditable even when race frequency is censored"
    aborted = fixture()
    aborted["SessionStatus"] = [record(10, Status="Started"), record(85, Status="Aborted"), record(130, Status="Finalised")]
    assert analyse_streams(aborted)["scOccurred"] is None

    orphan = fixture()
    orphan["TrackStatus"] = [row for row in orphan["TrackStatus"] if row["data"]["Status"] != "6"]
    assert not analyse_streams(orphan)["frequencyEligible"]
    mismatch = fixture()
    mismatch["TrackStatus"] = [record(0, Status="1")]
    assert not analyse_streams(mismatch)["frequencyEligible"], "RC deployment cannot be counted as a no-event zero"
    bad_lap = fixture()
    bad_lap["LapCount"][2]["data"]["CurrentLap"] = 7
    bad_lap_result = analyse_streams(bad_lap)
    assert bad_lap_result["frequencyEligible"]
    assert not bad_lap_result["lapMappingAvailable"]
    assert all(period["affectedLeaderLaps"] is None for period in bad_lap_result["periods"])
    unknown_weather = fixture()
    unknown_weather["WeatherData"] = []
    assert analyse_streams(unknown_weather)["rainfallRecorded"] is None
    assert analyse_streams(unknown_weather)["unknownWeatherSeconds"] == 95

    event = {"id": "one", "trackId": "melbourne", **result}
    excluded = {"id": "two", "trackId": "melbourne", **missing}
    summary = summarize_venue("melbourne", [event, excluded])
    assert summary["sc"]["racesWithEvent"] == summary["sc"]["eligibleRaces"] == 1
    assert summary["scheduledRaces"] == 2 and summary["missingOrExcludedRaces"] == 1
    assert summary["sc"]["perRaceProbability"] == 1
    assert summary["sc"]["suggestedFrequencyAdoption"] == "project-estimate-fallback-required"
    madrid = summarize_venue("madrid", [event])
    assert madrid["sc"]["perRaceProbability"] is None and madrid["sc"]["binomialWilsonCI95"] is None
    assert madrid["sc"]["durationLeaderLaps"] == []
    assert wilson_interval(0, 5)[0] == 0 and 0 < wilson_interval(0, 5)[1] < 1
    assert track_id("Sakhir", "Sakhir Grand Prix") != "bahrain"
    assert track_id("Montréal", "Canadian Grand Prix") == "montreal"
    print("Synthetic checks passed: parsing, boundaries, VSC merging, rain/red, partial/missing data and denominators.")


def check_dataset(path):
    document = json.loads(path.read_text(encoding="utf-8"))
    assert document["schemaVersion"] == 1 and document["diagnosticSubset"] is False
    assert document["sourcePeriod"]["fromYear"] == min(YEARS) and document["sourcePeriod"]["toYear"] == max(YEARS)
    assert {row["trackId"] for row in document["venues"]} == set(CURRENT_TRACKS)
    assert all(row["status"] == "collected" for row in document["schedules"])
    assert sum(row["rounds"] for row in document["schedules"]) == len(document["events"])
    assert len({row["id"] for row in document["events"]}) == len(document["events"])
    assert all(row["season"] in YEARS for row in document["events"])
    for event in document["events"]:
        assert set(event["sources"]) == set(CHANNELS)
        for channel, source in event["sources"].items():
            assert source["url"] == event["timingBaseUrl"] + channel + ".jsonStream"
            assert source["url"].startswith("https://livetiming.formula1.com/static/")
        if not event["frequencyEligible"]:
            assert event["scOccurred"] is None and event["vscOccurred"] is None
            assert event["exclusions"], event["id"]
            continue
        assert not event["exclusions"]
        assert isinstance(event["scOccurred"], bool) and isinstance(event["vscOccurred"], bool)
        assert event["scVscOverlapSeconds"] == 0
        for period in event["periods"]:
            assert period["kind"] in ("SC", "VSC") and period["endSeconds"] > period["startSeconds"]
            assert any(start <= period["startSeconds"] < period["endSeconds"] <= end for start, end in event["activeRaceIntervalsSeconds"])
            assert period["rainfallSeconds"] + period["unknownWeatherSeconds"] <= period["durationSeconds"] + 0.002
            if period["affectedLeaderLaps"] is not None:
                assert period["affectedLeaderLaps"] == period["endLap"] - period["startLap"] + 1
                assert 0 < period["leaderLapEquivalent"] <= period["affectedLeaderLaps"] + 0.000001
    for venue in document["venues"] + document["historicalVenues"]:
        actual = summarize_venue(venue["trackId"], document["events"])
        assert actual == venue, venue["trackId"]
        for kind in ("sc", "vsc"):
            value = venue[kind]
            assert value["racesWithEvent"] <= value["eligibleRaces"] <= venue["scheduledRaces"]
            if value["eligibleRaces"]:
                assert value["perRaceProbability"] == value["racesWithEvent"] / value["eligibleRaces"]
            else:
                assert value["perRaceProbability"] is None
            if value["suggestedFrequencyAdoption"] == "observed":
                assert value["eligibleRaces"] >= QUALITY["minimumRacesForSuggestedAdoption"]
            assert sum(value["durationLapHistogram"].values()) == value["mappedEpisodes"]
    summary = document["summary"]
    assert summary["scheduledRaces"] == len(document["events"])
    assert summary["eligibleRaces"] + summary["excludedRaces"] == summary["scheduledRaces"]
    spa2021 = next(event for event in document["events"] if event["season"] == 2021 and event["trackId"] == "spa")
    assert spa2021["frequencyEligible"] is False, "exceptional 2021 Spa archive cannot become an observed zero SC"
    saved = copy.deepcopy(document)
    summarize_venue("madrid", document["events"])
    assert document == saved
    compact = json.loads(path.with_name("neutralisation-summary.json").read_text(encoding="utf-8"))
    assert compact == build_compact_summary(document), "runtime compact summary must reproduce raw observations exactly"
    assert "events" not in compact and "periods" not in compact
    print("Collected data checks passed:", json.dumps(summary))


if __name__ == "__main__":
    check_synthetic()
    check_dataset(ROOT / "app/data/neutralisation-evidence.json")
