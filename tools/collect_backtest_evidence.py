"""Extract seven 2025 races' podium strategies, official elapsed times and weather.

Re-run from the project root with Python 3.11+ and FastF1 3.8.3 installed:
    python tools/collect_backtest_evidence.py --cache-dir ./work/fastf1-cache

An existing FastF1 cache can be passed instead; at most three sessions load in
parallel. Missing cache entries are read from FastF1's upstream public sources.
Output: app/data/backtest-evidence.json. No calibration is fitted here.

Official time semantics:
https://docs.fastf1.dev/core.html#fastf1.core.SessionResults
Winner Time is race duration; classified finishers' Time is the gap to winner.
The script preserves both values and does not sum lap times as official duration.
"""
from __future__ import annotations
import argparse
import concurrent.futures
import datetime as dt
import json
from pathlib import Path

import fastf1
import pandas as pd

ROOT=Path(__file__).resolve().parents[1]
EVENTS=[("austria-2025","spielberg","Austrian Grand Prix","2025 오스트리아 GP"), ("hungary-2025","hungaroring","Hungarian Grand Prix","2025 헝가리 GP"), ("italy-2025","monza","Italian Grand Prix","2025 이탈리아 GP"), ("bahrain-2025","bahrain","Bahrain Grand Prix","2025 바레인 GP"), ("spain-2025","barcelona","Spanish Grand Prix","2025 스페인 GP"), ("belgium-2025","spa","Belgian Grand Prix","2025 벨기에 GP"), ("britain-2025","silverstone","British Grand Prix","2025 영국 GP")]
COMPOUNDS={"SOFT":"S","MEDIUM":"M","HARD":"H","INTERMEDIATE":"INTER","WET":"WET"}


def finite(value,digits=3):
    return round(float(value),digits) if pd.notna(value) else None


def collect(config):
    event_id,track_id,name,label=config
    session=fastf1.get_session(2025,name,"R")
    if session.event.EventName!=name:
        raise ValueError("Wrong event resolved")
    session.load(laps=True,telemetry=False,weather=True,messages=True)
    results=session.results.sort_values("Position").head(3)
    winner=results.iloc[0]
    if winner.Position!=1 or pd.isna(winner.Time):
        raise ValueError("Winner race duration unavailable")
    winner_elapsed=float(winner.Time.total_seconds())
    drivers=[]
    for _,row in results.iterrows():
        code=str(row.Abbreviation)
        laps=session.laps.pick_drivers(code).sort_values("LapNumber")
        known=laps.dropna(subset=["Stint","Compound","TyreLife","LapNumber"])
        stints=[]
        for _,group in known.groupby("Stint",sort=True):
            values=group.Compound.unique()
            if len(values)!=1 or values[0] not in COMPOUNDS:
                raise ValueError(f"Unsupported or ambiguous compound for {code}")
            ordered=group.sort_values("LapNumber")
            stints.append({"compound":COMPOUNDS[values[0]],"startLap":int(ordered.LapNumber.min()),"endLap":int(ordered.LapNumber.max()),"observedTyreLifeStart":int(ordered.TyreLife.iloc[0]),"observedTyreLifeEnd":int(ordered.TyreLife.iloc[-1])})
        last=0
        for stint in stints:
            if stint["startLap"]!=last+1:
                raise ValueError(f"Missing observed compound coverage for {code}")
            last=stint["endLap"]
        gap=0. if row.Position==1 else float(row.Time.total_seconds()) if pd.notna(row.Time) and row.Status=="Finished" else None
        drivers.append({"code":code,"name":str(row.FullName),"team":str(row.TeamName),"finish":int(row.Position),"stints":stints,"raceLaps":last,"raceElapsedSeconds":round(winner_elapsed+gap,3) if gap is not None else None,"gapToWinnerSeconds":finite(gap),"resultTimeSeconds":finite(row.Time.total_seconds()) if pd.notna(row.Time) else None,"resultStatus":str(row.Status),"lapTimeSumSeconds":finite(laps.LapTime.dt.total_seconds().sum()),"elapsedMethod":"winner official race Time + classified driver's Time gap; not sum of lap times"})
    all_laps=session.laps.copy()
    weather=all_laps.get_weather_data()
    for field in ["TrackTemp","AirTemp","Humidity","Rainfall"]:
        all_laps[field]=weather[field].to_numpy() if field in weather else None
    lap_weather=[]
    for lap,group in all_laps.groupby("LapNumber"):
        lap_weather.append({"lap":int(lap),"rainfallTrue":bool(group.Rainfall.eq(True).any()),"rainfallKnown":bool(group.Rainfall.notna().any()),"trackTemperatureC":finite(group.TrackTemp.mean(),2),"humidityPercent":finite(group.Humidity.mean(),2)})
    wet_rows=all_laps.Compound.isin(["INTERMEDIATE","WET"])
    signals=session.track_status
    signal_counts={code:int(((signals.Status==code)&signals.Status.shift().ne(code)).sum()) for code in ["4","5","6","7"]}
    statuses=[{"timeSeconds":finite(row.Time.total_seconds()),"status":str(row.Status)} for _,row in session.session_status.iterrows()]
    result={"id":event_id,"trackId":track_id,"eventName":name,"label":label,"season":2025,"raceLaps":max(driver["raceLaps"] for driver in drivers),"drivers":drivers,"source":{"timingUrl":"https://livetiming.formula1.com"+session.api_path,"resultsUrl":"https://www.formula1.com/en/results/2025/races","libraryVersion":fastf1.__version__,"raceElapsedMeaning":"Official winner race duration plus podium driver's finish gap, as provided by FastF1 SessionResults.Time"},"weather":{"meanTrackTemperatureC":finite(all_laps.TrackTemp.mean(),2),"meanAirTemperatureC":finite(all_laps.AirTemp.mean(),2),"meanHumidityPercent":finite(all_laps.Humidity.mean(),2),"rainfallLapNumbers":[row["lap"] for row in lap_weather if row["rainfallTrue"]],"wetTyreLaps":int(wet_rows.sum()),"allDriverLaps":len(all_laps),"wetTyreLapFraction":finite(wet_rows.mean(),5),"perLap":lap_weather},"raceControl":{"trackStatusLapCounts":{str(key):int(value) for key,value in all_laps.TrackStatus.value_counts().items()},"scSignalStarts":signal_counts["4"],"redFlagSignalStarts":signal_counts["5"],"vscSignalStarts":signal_counts["6"],"vscEndingSignals":signal_counts["7"],"sessionStatusChanges":statuses,"note":"Counts are observed timing status transitions, not a model of their duration or race-time effect."}}
    print(f"Extracted {event_id}: {len(drivers)} drivers / {result['raceLaps']} laps / wet={result['weather']['wetTyreLapFraction']}",flush=True)
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir",type=Path,default=ROOT/"work"/"fastf1-cache")
    parser.add_argument("--workers",type=int,default=3)
    args=parser.parse_args()
    args.cache_dir.mkdir(parents=True,exist_ok=True)
    fastf1.Cache.enable_cache(str(args.cache_dir))
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1,min(3,args.workers))) as pool:
        events=list(pool.map(collect,EVENTS))
    output={"schemaVersion":1,"generatedAt":dt.datetime.now(dt.timezone.utc).isoformat(),"generatedBy":"tools/collect_backtest_evidence.py","events":events,"limitations":["Observed used-tyre life is retained, but the existing strategy engine normalises every stint to a fresh set.","Observed in/out laps and race-control periods stay in official elapsed times. The clean-air model does not reproduce SC/VSC/red flags, restart gaps or driver pace.","Weather presets are project approximations of recorded rainfall/tyre use, not a reconstruction of measured track water.","No baseline lap time is back-solved from observed race duration."]}
    path=ROOT/"app"/"data"/"backtest-evidence.json"
    path.write_text(json.dumps(output,ensure_ascii=False,indent=2,allow_nan=False)+"\n",encoding="utf-8")


if __name__=="__main__":
    main()
