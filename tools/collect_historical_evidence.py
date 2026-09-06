"""Reproducible FastF1 evidence collection; never invent unavailable estimates.

Run from the repository: python tools/collect_historical_evidence.py --workers 3
Optional --cache-dir reuses an existing FastF1 cache. See --help for resumability.
"""
from __future__ import annotations

import argparse
import concurrent.futures
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

ROOT = Path(__file__).resolve().parents[1]
COMPOUNDS = ("SOFT", "MEDIUM", "HARD")
EVENTS = (
    ("bahrain", "Bahrain Grand Prix"), ("barcelona", "Spanish Grand Prix"),
    ("spielberg", "Austrian Grand Prix"), ("hungaroring", "Hungarian Grand Prix"),
    ("monza", "Italian Grand Prix"), ("silverstone", "British Grand Prix"), ("spa", "Belgian Grand Prix"),
)
WET_EVENTS = {"melbourne", "silverstone", "spa"}
TRACK_IDS = (
    "melbourne", "shanghai", "suzuka", "bahrain", "jeddah", "miami",
    "montreal", "monaco", "barcelona", "spielberg", "silverstone", "spa",
    "hungaroring", "zandvoort", "monza", "madrid", "baku", "singapore",
    "austin", "mexico-city", "sao-paulo", "las-vegas", "lusail", "yas-marina",
)
METHOD = {
    "formula": "LapTime ~ Driver + RaceLap + RaceLap² + TrackTemp + Compound + Compound×TyreLife + Compound×TyreLife²",
    "units": {"lapTime": "seconds", "alpha": "seconds / tyre-life lap", "beta": "seconds / tyre-life lap²", "pitLoss": "seconds", "temperature": "°C", "humidity": "%", "rainfall": "boolean weather-station flag, NOT intensity"},
    "filter": ["S/M/H; complete LapTime, TyreLife, Stint", "IsAccurate=True; Deleted!=True; FastF1Generated=False", "TrackStatus exactly 1", "exclude pit in/out and race lap 1", "at least 5 normal laps per single-compound monotonic-life stint", "up to 3 residual IQR passes, fences Q1−3IQR / Q3+3IQR"],
    "validation": "First 75% of each qualifying stint trains; final 25% tests. IQR trimming is fitted on training only for holdout; test rows are not trimmed.",
    "intervals": "Asymptotic 95% intervals from driver-stint cluster-robust covariance; exploratory, not a causal tyre-wear measurement.",
    "thresholds": {"minimumStintLaps": {"value": 5, "unit": "laps", "source": "project quality filter, unchanged from analysis/fastf1_austria_2025.py"}, "iqrMultiplier": {"value": 3, "unit": "IQR", "source": "project robust filter"}, "minimumReliableLaps": {"value": 40, "unit": "laps", "source": "project confidence gate"}, "minimumReliableStints": {"value": 4, "unit": "stints", "source": "project confidence gate"}, "holdoutFraction": {"value": 0.25, "unit": "fraction of each stint", "source": "project temporal validation design"}},
    "limitations": ["Relative SOFT/MEDIUM/HARD labels are event-specific; absolute C1–C5 allocations are not inferred or pooled.", "Driver effects, race progress and temperature do not fully identify fuel, traffic, tyre management or team ability.", "No 2026 calibration claim: 2023–2025 tyre regulations and cars differ.", "Pit-loss and wet same-lap differences are observational proxies, not pit-lane telemetry or wetness sensors."],
}
METHOD["thresholds"].update({
    "minimumDistinctTyreLives": {"value": 4, "unit": "distinct age values", "source": "project quadratic identifiability gate"},
    "minimumTeamLaps": {"value": 20, "unit": "laps per team and compound", "source": "project exploratory team proxy gate"},
    "minimumTeamStints": {"value": 2, "unit": "driver-stint groups", "source": "project exploratory team proxy gate; not a reliability guarantee"},
    "pitLocalWindow": {"value": 4, "unit": "race laps before in-lap / after out-lap", "source": "project local baseline estimator"},
    "minimumPitBaselineLaps": {"value": 4, "unit": "normal same-driver laps", "source": "project pit-loss quality gate"},
    "minimumPitSamples": {"value": 3, "unit": "retained pit pairs per event", "source": "project pit-loss reporting gate"},
    "pitIqrMultiplier": {"value": 1.5, "unit": "IQR", "source": "project outlier filter, applied with at least four pairs"},
    "minimumIqr": {"value": 0.05, "unit": "seconds", "source": "project numerical floor for residual and pit IQR filters"},
    "confidenceCriticalValue": {"value": 1.96, "unit": "standard errors", "source": "asymptotic two-sided 95% normal approximation"},
})


def number(value, digits=6):
    return round(float(value), digits) if pd.notna(value) and np.isfinite(value) else None


def save_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def weather_laps(session):
    laps = session.laps.copy()
    weather = laps.get_weather_data()
    for field in ("TrackTemp", "AirTemp", "Humidity", "Rainfall"):
        laps[field] = weather[field].to_numpy() if field in weather else np.nan
    laps["LapTimeSeconds"] = laps["LapTime"].dt.total_seconds()
    return pd.DataFrame(laps)


def clean_dry(laps):
    frame = laps.copy()
    funnel = [{"key": "raw", "remaining": len(frame), "excluded": 0}]
    filters = [
        ("dry", lambda d: d.Compound.isin(COMPOUNDS) & d.LapTime.notna() & d.TyreLife.notna() & d.Stint.notna()),
        ("accurate", lambda d: d.IsAccurate.fillna(False) & d.Deleted.ne(True) & ~d.FastF1Generated.fillna(False)),
        ("green", lambda d: d.TrackStatus.eq("1")),
        ("racing", lambda d: d.PitInTime.isna() & d.PitOutTime.isna() & d.LapNumber.gt(1)),
    ]
    for name, predicate in filters:
        before = len(frame)
        frame = frame.loc[predicate(frame)].copy()
        funnel.append({"key": name, "remaining": len(frame), "excluded": before-len(frame)})
    before = len(frame)
    valid = []
    for _, group in frame.groupby(["Driver", "Stint"]):
        if len(group) >= 5 and group.Compound.nunique() == 1 and group.TyreLife.is_monotonic_increasing:
            valid.extend(group.index)
    frame = frame.loc[valid].reset_index(drop=True)
    funnel.append({"key": "stints", "remaining": len(frame), "excluded": before-len(frame)})
    return frame, funnel


def design_matrix(frame, spec=None, quadratic_compounds=COMPOUNDS):
    if spec is None:
        spec = {"drivers": sorted(frame.Driver.unique()), "raceMean": float(frame.LapNumber.mean()), "raceScale": max(1., float(frame.LapNumber.std(ddof=0))), "tempMean": number(frame.TrackTemp.mean()) or 0., "quadraticCompounds":list(quadratic_compounds)}
    race = (frame.LapNumber.to_numpy(float)-spec["raceMean"])/spec["raceScale"]
    temp = pd.to_numeric(frame.TrackTemp, errors="coerce").fillna(spec["tempMean"]).to_numpy(float)-spec["tempMean"]
    names = ["intercept", "race", "race2", "temperature"]
    columns = [np.ones(len(frame)), race, race**2, temp]
    for driver in spec["drivers"][1:]:
        names.append("driver:"+driver)
        columns.append((frame.Driver == driver).to_numpy(float))
    for compound in ("SOFT", "HARD"):
        names.append("offset:"+compound)
        columns.append((frame.Compound == compound).to_numpy(float))
    life = frame.TyreLife.to_numpy(float)
    for compound in COMPOUNDS:
        mask = (frame.Compound == compound).to_numpy(float)
        columns.append(mask*life)
        names.append("alpha:"+compound)
        if compound in spec["quadraticCompounds"]:
            columns.append(mask*life**2)
            names.append("beta:"+compound)
    return np.column_stack(columns), names, spec


def fit(frame, quadratic_compounds=COMPOUNDS):
    current = frame.copy()
    _, _, spec = design_matrix(current, quadratic_compounds=quadratic_compounds)
    for _ in range(3):
        x, names, _ = design_matrix(current, spec)
        coef = np.linalg.lstsq(x, current.LapTimeSeconds.to_numpy(float), rcond=None)[0]
        residual = current.LapTimeSeconds.to_numpy(float)-x@coef
        q1, q3 = np.quantile(residual, [.25, .75])
        iqr = max(.05, q3-q1)
        keep = (residual >= q1-3*iqr) & (residual <= q3+3*iqr)
        if keep.all():
            break
        current = current.loc[keep].copy()
    x, names, _ = design_matrix(current, spec)
    coef = np.linalg.lstsq(x, current.LapTimeSeconds.to_numpy(float), rcond=None)[0]
    residual = current.LapTimeSeconds.to_numpy(float)-x@coef
    bread = np.linalg.pinv(x.T@x)
    meat = np.zeros((x.shape[1], x.shape[1]))
    groups = current.groupby(["Driver", "Stint"]).indices
    for indices in groups.values():
        score = x[indices].T@residual[indices]
        meat += np.outer(score, score)
    rank = int(np.linalg.matrix_rank(x))
    group_count = len(groups)
    correction = group_count/max(1, group_count-1)*(len(x)-1)/max(1, len(x)-rank)
    covariance = correction*bread@meat@bread
    se = np.sqrt(np.maximum(0, np.diag(covariance)))
    identifiable = np.max(np.abs(np.linalg.pinv(x)@x-np.eye(x.shape[1])), axis=0) < 1e-6
    return {"coef": coef, "se": se, "cov": covariance, "names": names, "spec": spec, "frame": current, "rank": rank, "identifiable": identifiable, "clusters": group_count}


def select_nested_model(training, validation):
    """Select complexity only on training; never inspect holdout to choose a term."""
    active=set(COMPOUNDS)
    selected=fit(training)
    while active:
        remove=[]
        for compound in active:
            a=selected["names"].index("alpha:"+compound)
            b=selected["names"].index("beta:"+compound)
            subset=selected["frame"][selected["frame"].Compound==compound]
            enough=len(subset)>=40 and subset.groupby(["Driver","Stint"]).ngroups>=4
            supported=bool(enough and selected["identifiable"][a] and selected["identifiable"][b] and selected["coef"][b]-1.96*selected["se"][b]>0 and selected["coef"][a]+2*selected["coef"][b]>=0)
            if not supported:
                remove.append(compound)
        if not remove:
            break
        active.difference_update(remove)
        selected=fit(training,active)
    rows=[]
    for compound in COMPOUNDS:
        names=selected["names"]
        a=names.index("alpha:"+compound)
        b=names.index("beta:"+compound) if compound in active else None
        alpha=float(selected["coef"][a]); beta=float(selected["coef"][b]) if b is not None else 0.
        alpha_ci=[alpha-1.96*selected["se"][a],alpha+1.96*selected["se"][a]]
        beta_ci=[beta-1.96*selected["se"][b],beta+1.96*selected["se"][b]] if b is not None else [0.,0.]
        subset=selected["frame"][selected["frame"].Compound==compound]
        stints=int(subset.groupby(["Driver","Stint"]).ngroups)
        identified=bool(selected["identifiable"][a] and (b is None or selected["identifiable"][b]))
        enough=len(subset)>=40 and stints>=4
        positive=alpha+2*beta>=0 and beta>=0
        significant=beta_ci[0]>0 if b is not None else alpha_ci[0]>0
        accepted=bool(identified and enough and positive and significant)
        reason="training-beta-significant" if accepted and b is not None else "training-linear-alpha-significant" if accepted else "not-identifiable" if not identified else "insufficient-training-samples" if not enough else "negative-engine-coefficient" if not positive else "training-confidence-interval-includes-zero"
        rows.append({"compound":compound[0],"model":"quadratic" if b is not None else "linear","accepted":accepted,"reason":reason,"laps":len(subset),"stints":stints,"identifiable":identified,"alphaSecondsPerLap":number(alpha) if identified else None,"betaSecondsPerLapSquared":number(beta) if identified else None,"alphaCI95":[number(x) for x in alpha_ci] if identified else None,"betaCI95":[number(x) for x in beta_ci] if identified else None,"alpha0SecondsPerLap":number(alpha+2*beta) if identified else None,"offsetCorrectionSeconds":number(alpha+beta) if identified else None})
    vx,_,_=design_matrix(validation,selected["spec"])
    errors=validation.LapTimeSeconds.to_numpy(float)-vx@selected["coef"]
    by_compound=[]
    for row in rows:
        full_name={"S":"SOFT","M":"MEDIUM","H":"HARD"}[row["compound"]]
        e=errors[(validation.Compound==full_name).to_numpy()]
        by_compound.append({"compound":row["compound"],"accepted":row["accepted"],"testLaps":len(e),"maeSeconds":number(np.abs(e).mean()) if len(e) else None,"rmseSeconds":number(np.sqrt((e**2).mean())) if len(e) else None})
    return {"method":"Training-only backward removal of unsupported quadratic tyre-life terms, followed by refit; linear alpha must have positive 95% CI. Published calibration coefficients use training only.","coefficients":rows,"validation":{"trainLaps":len(selected["frame"]),"testLaps":len(validation),"maeSeconds":number(np.abs(errors).mean()),"rmseSeconds":number(np.sqrt((errors**2).mean())),"absoluteErrorSumSeconds":number(np.abs(errors).sum()),"squaredErrorSum":number((errors**2).sum()),"byCompound":by_compound},"quadraticCompounds":[c[0] for c in COMPOUNDS if c in active],"note":"Holdout measures the selected statistical regression, not the complete strategy simulator including project fallback intercepts and tyre-state penalties. Holdout values never choose the model."}


def coefficients(result):
    frame, names = result["frame"], result["names"]
    rows = []
    for compound in COMPOUNDS:
        subset = frame[frame.Compound == compound]
        stints = subset.groupby(["Driver", "Stint"]).ngroups
        a, b = names.index("alpha:"+compound), names.index("beta:"+compound)
        identified = bool(result["identifiable"][a] and result["identifiable"][b] and subset.TyreLife.nunique() >= 4)
        alpha, beta = result["coef"][[a,b]]
        alpha_ci = [alpha-1.96*result["se"][a], alpha+1.96*result["se"][a]]
        beta_ci = [beta-1.96*result["se"][b], beta+1.96*result["se"][b]]
        age = float(subset.TyreLife.median()) if len(subset) else 0
        derivative = alpha+2*beta*age
        gradient = np.array([1., 2*age])
        derivative_se = math.sqrt(max(0, gradient@result["cov"][[a,b]][:,[a,b]]@gradient))
        derivative_ci = [derivative-1.96*derivative_se, derivative+1.96*derivative_se]
        reliable = bool(identified and len(subset) >= 40 and stints >= 4 and derivative_ci[0] > 0)
        rows.append({"compound": compound[0], "laps": len(subset), "stints": stints, "tyreLifeMin": number(subset.TyreLife.min(),0), "tyreLifeMax": number(subset.TyreLife.max(),0), "identifiable": identified, "alphaSecondsPerLap": number(alpha) if identified else None, "betaSecondsPerLapSquared": number(beta) if identified else None, "alphaCI95": [number(x) for x in alpha_ci] if identified else None, "betaCI95": [number(x) for x in beta_ci] if identified else None, "referenceTyreLife": number(age,1), "marginalDegradationSecondsPerLap": number(derivative) if identified else None, "marginalDegradationCI95": [number(x) for x in derivative_ci] if identified else None, "reliable": reliable, "status": "observed-reliable" if reliable else "insufficient-confidence" if identified else "not-identifiable"})
    return rows


def team_estimates(result):
    frame = result["frame"]
    x, names, _ = design_matrix(frame, result["spec"])
    remove = [names.index(name) for name in ("race", "race2", "temperature")]
    adjusted = frame.copy()
    adjusted["EnvironmentalPace"] = frame.LapTimeSeconds.to_numpy(float)-x[:,remove]@result["coef"][remove]
    age_columns = [index for index, name in enumerate(names) if name.startswith(("alpha:", "beta:"))]
    adjusted["AdjustedPace"] = adjusted.EnvironmentalPace.to_numpy(float)-x[:,age_columns]@result["coef"][age_columns]
    rows = []
    for (team, compound), group in adjusted.groupby(["Team", "Compound"]):
        comp_reference = adjusted[adjusted.Compound == compound]
        centered = group.TyreLife.to_numpy(float)-group.TyreLife.mean()
        xx = np.column_stack([np.ones(len(group)), centered])
        yy = group.EnvironmentalPace.to_numpy(float)
        parameters = np.linalg.lstsq(xx, yy, rcond=None)[0]
        residual = yy-xx@parameters
        bread=np.linalg.pinv(xx.T@xx)
        meat=np.zeros((2,2))
        clusters=group.groupby(["Driver","Stint"]).indices
        for indices in clusters.values():
            score=xx[indices].T@residual[indices]
            meat+=np.outer(score,score)
        correction=len(clusters)/max(1,len(clusters)-1)*(len(group)-1)/max(1,len(group)-2)
        cov=correction*bread@meat@bread
        se = math.sqrt(max(0,cov[1,1]))
        stints = group.groupby(["Driver","Stint"]).ngroups
        usable = len(group) >= 20 and stints >= 2 and group.TyreLife.nunique() >= 4
        rows.append({"team": str(team), "compound": compound[0], "laps": len(group), "stints": stints, "drivers": sorted(group.Driver.unique()), "adjustedPaceDeltaToCompoundMedianSeconds": number(group.AdjustedPace.median()-comp_reference.AdjustedPace.median()) if usable else None, "paceAdjustment": "race progress, track temperature and fitted event compound tyre-life terms removed; same-compound median reference", "linearDegradationSecondsPerLap": number(parameters[1]) if usable else None, "linearDegradationCI95": [number(parameters[1]-1.96*se),number(parameters[1]+1.96*se)] if usable else None, "status": "observational-proxy" if usable else "insufficient-samples"})
    return rows


def pit_losses(laps):
    samples = []
    for driver, group in laps.groupby("Driver"):
        ordered = group.sort_values("LapNumber")
        for _, in_lap in ordered[ordered.PitInTime.notna()].iterrows():
            out_rows = ordered[(ordered.LapNumber == in_lap.LapNumber+1) & ordered.PitOutTime.notna()]
            if out_rows.empty:
                continue
            out_lap = out_rows.iloc[0]
            if not (pd.notna(in_lap.LapTimeSeconds) and pd.notna(out_lap.LapTimeSeconds)):
                continue
            if in_lap.TrackStatus != "1" or out_lap.TrackStatus != "1" or in_lap.Compound not in COMPOUNDS or out_lap.Compound not in COMPOUNDS:
                continue
            surrounding = ordered[(ordered.LapNumber >= in_lap.LapNumber-4) & (ordered.LapNumber <= out_lap.LapNumber+4) & ordered.PitInTime.isna() & ordered.PitOutTime.isna() & ordered.TrackStatus.eq("1") & ordered.IsAccurate.fillna(False) & ordered.Compound.isin(COMPOUNDS) & ordered.LapTimeSeconds.notna()]
            if len(surrounding) < 4:
                continue
            baseline = float(surrounding.LapTimeSeconds.median())
            loss = float(in_lap.LapTimeSeconds+out_lap.LapTimeSeconds-2*baseline)
            if loss <= 0:
                continue
            samples.append({"driver": str(driver), "pitAfterLap": int(in_lap.LapNumber), "inLapSeconds": number(in_lap.LapTimeSeconds,3), "outLapSeconds": number(out_lap.LapTimeSeconds,3), "localBaselineSeconds": number(baseline,3), "estimatedLossSeconds": number(loss,3)})
    retained = samples
    if len(samples) >= 4:
        values = [item["estimatedLossSeconds"] for item in samples]
        q1,q3 = np.quantile(values,[.25,.75])
        iqr=max(.05,q3-q1)
        retained = [item for item in samples if q1-1.5*iqr <= item["estimatedLossSeconds"] <= q3+1.5*iqr]
    values = [item["estimatedLossSeconds"] for item in retained]
    return {"status": "observational-estimate" if len(values) >= 3 else "insufficient-samples", "formula": "(in-lap + next out-lap) − 2 × median of same-driver normal laps within ±4 laps", "rawSamples": len(samples), "retainedSamples": len(values), "medianSeconds": number(np.median(values),3) if values else None, "iqrSeconds": [number(x,3) for x in np.quantile(values,[.25,.75])] if values else None, "samples": retained, "caveat": "Includes tyre pace change, fuel progression and traffic; excludes non-green in/out pairs. Not stationary pit-stop duration. Positive samples use 1.5-IQR rejection only when at least four exist."}


def wet_evidence(laps, track_id, year):
    valid = laps[laps.LapTimeSeconds.notna() & laps.IsAccurate.fillna(False) & laps.Deleted.ne(True) & ~laps.FastF1Generated.fillna(False) & laps.TrackStatus.eq("1") & laps.PitInTime.isna() & laps.PitOutTime.isna() & laps.LapNumber.gt(1)].copy()
    valid["TyreGroup"] = valid.Compound.map(lambda x: "DRY" if x in COMPOUNDS else "INTERMEDIATE" if x=="INTERMEDIATE" else "WET" if x=="WET" else "OTHER")
    summaries=[]
    for compound, group in valid[valid.TyreGroup.ne("OTHER")].groupby("TyreGroup"):
        summaries.append({"compound": compound,"laps":len(group),"drivers":int(group.Driver.nunique()),"rainfallTrueLaps":int(group.Rainfall.eq(True).sum()),"rainfallKnownLaps":int(group.Rainfall.notna().sum()),"meanTrackTempC":number(group.TrackTemp.mean(),2),"meanHumidityPercent":number(group.Humidity.mean(),2),"medianLapSeconds":number(group.LapTimeSeconds.median(),3)})
    comparisons=[]
    for lap_number, group in valid.groupby("LapNumber"):
        for first,second in (("INTERMEDIATE","WET"),("DRY","INTERMEDIATE"),("DRY","WET")):
            left=group[group.TyreGroup==first]; right=group[group.TyreGroup==second]
            if left.empty or right.empty:
                continue
            comparisons.append({"lap":int(lap_number),"firstCompound":first,"secondCompound":second,"firstSamples":len(left),"secondSamples":len(right),"firstMinusSecondSeconds":number(left.LapTimeSeconds.median()-right.LapTimeSeconds.median(),3),"rainfallTrue":bool(group.Rainfall.eq(True).any()),"trackTempC":number(group.TrackTemp.mean(),2),"humidityPercent":number(group.Humidity.mean(),2)})
    return {"trackId":track_id,"season":year,"rawCompoundCounts":{str(k):int(v) for k,v in laps.Compound.value_counts().items()},"retainedCompoundSummary":summaries,"sameLapComparisons":comparisons,"intermediateWetMatchedLaps":sum(x["firstCompound"]=="INTERMEDIATE" and x["secondCompound"]=="WET" for x in comparisons),"status":"matched-observations" if comparisons else "no-same-lap-comparison", "caveat":"Different drivers/teams on the same race lap are observational comparisons, not controlled tyre tests. Rainfall is a weather-station boolean; it does not measure road water or grip. Wet crossover is not estimated without adequate simultaneous samples."}


def collect_one(year, track_id, event_name, cache_dir, checkpoint_dir):
    key=f"{year}-{track_id}"
    checkpoint=checkpoint_dir/(key+".json")
    if checkpoint.exists():
        prior=json.loads(checkpoint.read_text(encoding="utf-8"))
        if prior.get("collectorVersion")==3 and prior.get("eventName")==event_name:
            if not prior.get("timingSourceUrl"):
                source_session=fastf1.get_session(year,event_name,"R")
                if str(source_session.event.EventName)!=event_name:
                    raise ValueError("FastF1 resolved a different event than requested")
                prior["timingSourceUrl"]="https://livetiming.formula1.com"+source_session.api_path
                save_json(checkpoint,prior)
            return prior
    try:
        fastf1.Cache.enable_cache(str(cache_dir))
        session=fastf1.get_session(year,event_name,"R")
        if str(session.event.EventName)!=event_name:
            raise ValueError("FastF1 resolved a different event than requested")
        session.load(laps=True, telemetry=False, weather=True, messages=True)
        laps=weather_laps(session)
        cleaned,funnel=clean_dry(laps)
        result={"id":key,"collectorVersion":3,"season":year,"trackId":track_id,"eventName":str(session.event.EventName),"session":"Race","eventDate":str(session.event.EventDate),"status":"collected","sourceUrl":"https://docs.fastf1.dev/","timingSourceUrl":"https://livetiming.formula1.com"+session.api_path,"rawLaps":len(laps),"funnel":funnel,"weatherAvailable":bool(laps.TrackTemp.notna().any()),"pitLoss":pit_losses(laps)}
        if len(cleaned) < 50:
            result.update({"analysisStatus":"insufficient-clean-dry-laps","modelLaps":0,"stints":0,"coefficients":[],"teamEstimates":[],"validation":None})
        else:
            train_ids=[];test_ids=[]
            for _,group in cleaned.groupby(["Driver","Stint"]):
                group=group.sort_values("LapNumber")
                split=min(len(group)-1,max(4,math.ceil(len(group)*.75)))
                train_ids.extend(group.index[:split]);test_ids.extend(group.index[split:])
            train=fit(cleaned.loc[train_ids]); validation=cleaned.loc[test_ids]
            vx,_,_=design_matrix(validation,train["spec"])
            errors=validation.LapTimeSeconds.to_numpy(float)-vx@train["coef"]
            full=fit(cleaned)
            robust=full["frame"]
            result["funnel"].append({"key":"robust","remaining":len(robust),"excluded":len(cleaned)-len(robust)})
            result.update({"analysisStatus":"estimated","modelLaps":len(robust),"stints":int(robust.groupby(["Driver","Stint"]).ngroups),"drivers":int(robust.Driver.nunique()),"matrixRank":full["rank"],"matrixColumns":len(full["names"]),"coefficients":coefficients(full),"teamEstimates":team_estimates(full),"validation":{"trainLaps":len(train["frame"]),"testLaps":len(validation),"maeSeconds":number(np.abs(errors).mean(),6),"rmseSeconds":number(np.sqrt((errors**2).mean()),6),"absoluteErrorSumSeconds":number(np.abs(errors).sum(),6),"squaredErrorSum":number((errors**2).sum(),6)}})
            result["modelSelection"]=select_nested_model(cleaned.loc[train_ids],validation)
        if year==2025 and track_id in WET_EVENTS:
            result["wetEvidence"]=wet_evidence(laps,track_id,year)
        save_json(checkpoint,result)
        print(f"COLLECTED {key}: raw={len(laps)} model={result['modelLaps']} stints={result['stints']}",flush=True)
        return result
    except Exception as error:
        print(f"FAILED {key}: {type(error).__name__}: {error}",file=sys.stderr,flush=True)
        # Failure details can include local paths, so public manifest uses only type.
        return {"id":key,"season":year,"trackId":track_id,"eventName":event_name,"status":"unavailable","failureType":type(error).__name__,"rawLaps":0,"modelLaps":0,"stints":0}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir",type=Path,default=ROOT/"work"/"fastf1-cache")
    parser.add_argument("--workers",type=int,default=3)
    parser.add_argument("--output-dir",type=Path,default=ROOT/"app"/"data")
    parser.add_argument("--checkpoint-dir",type=Path,default=ROOT/"work"/"evidence-checkpoints")
    parser.add_argument("--years",nargs="+",type=int,default=[2023,2024,2025])
    parser.add_argument("--tracks",nargs="+",default=[item[0] for item in EVENTS])
    args=parser.parse_args()
    args.cache_dir.mkdir(parents=True,exist_ok=True)
    args.checkpoint_dir.mkdir(parents=True,exist_ok=True)
    fastf1.Cache.enable_cache(str(args.cache_dir))
    tasks=[(year,tid,name) for year in args.years for tid,name in EVENTS if tid in args.tracks]
    if 2025 in args.years:
        tasks.append((2025,"melbourne","Australian Grand Prix"))
    results=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1,min(3,args.workers))) as executor:
        futures=[executor.submit(collect_one,*task,args.cache_dir,args.checkpoint_dir) for task in tasks]
        for future in concurrent.futures.as_completed(futures):
            results.append(future.result())
    results.sort(key=lambda item:(item["season"],item["trackId"]))
    collected=[x for x in results if x["status"]=="collected"]
    dry=[x for x in results if x["trackId"]!="melbourne"]
    analysed=[x for x in dry if x.get("analysisStatus")=="estimated"]
    validation_laps=sum(x["validation"]["testLaps"] for x in analysed)
    summary={"requestedDryEvents":len(dry),"collectedDryEvents":sum(x["status"]=="collected" for x in dry),"analysedDryEvents":len(analysed),"circuits":len(set(x["trackId"] for x in analysed)),"rawLaps":sum(x["rawLaps"] for x in dry),"modelLaps":sum(x["modelLaps"] for x in dry),"stints":sum(x["stints"] for x in dry),"holdoutLaps":validation_laps,"weightedHoldoutMaeSeconds":number(sum(x["validation"]["absoluteErrorSumSeconds"] for x in analysed)/validation_laps) if validation_laps else None,"weightedHoldoutRmseSeconds":number(math.sqrt(sum(x["validation"]["squaredErrorSum"] for x in analysed)/validation_laps)) if validation_laps else None,"byYear":[{"season":year,"events":sum(x["season"]==year and x["status"]=="collected" for x in dry),"rawLaps":sum(x["rawLaps"] for x in dry if x["season"]==year),"modelLaps":sum(x["modelLaps"] for x in dry if x["season"]==year),"stints":sum(x["stints"] for x in dry if x["season"]==year)} for year in args.years]}
    metadata={"schemaVersion":1,"generatedAt":dt.datetime.now(dt.timezone.utc).isoformat(),"libraryVersion":fastf1.__version__,"generatedBy":"tools/collect_historical_evidence.py","source":"FastF1 public timing data","isLive":False,"methodology":METHOD}
    save_json(args.output_dir/"historical-dry-2023-2025.json",{**metadata,"summary":summary,"events":[{k:v for k,v in x.items() if k!="wetEvidence"} for x in dry]})
    wet=[x["wetEvidence"] for x in collected if "wetEvidence" in x]
    save_json(args.output_dir/"wet-weather-2025.json",{**metadata,"events":wet,"requestedEvents":["2025-melbourne","2025-silverstone","2025-spa"],"missingEvents":[tid for tid in WET_EVENTS if not any(x["trackId"]==tid for x in wet)],"supportsWetCrossoverCalibration":False,"reason":"Same-lap comparisons are descriptive; no water-depth/intensity sensor and sparse/no full-wet overlaps."})
    pit_coverage=[]
    for tid in TRACK_IDS:
        event_estimates=[x for x in collected if x["trackId"]==tid and x["pitLoss"]["status"]=="observational-estimate"]
        all_samples=[s["estimatedLossSeconds"] for x in event_estimates for s in x["pitLoss"]["samples"]]
        pit_coverage.append({"trackId":tid,"status":"observational-estimate" if all_samples else "not-collected-or-insufficient","samples":len(all_samples),"medianSeconds":number(np.median(all_samples),3) if all_samples else None,"events":[x["id"] for x in event_estimates]})
    save_json(args.output_dir/"dataset-manifest.json",{**metadata,"summary":summary,"events":[{"id":x["id"],"status":x["status"],"rawLaps":x["rawLaps"],"modelLaps":x["modelLaps"]} for x in results],"pitLossCoverage":pit_coverage,"reproduce":"python -m pip install -r analysis/requirements.txt && python tools/collect_historical_evidence.py --workers 3","unverifiedUserFiguresUsed":False})
    print(json.dumps(summary,ensure_ascii=False),flush=True)


if __name__=="__main__":
    main()
