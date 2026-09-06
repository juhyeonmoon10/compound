import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExperimentResearch } from '../app/lib/notebook-research.ts';
import { evaluateStrategy, TRACK_PRESETS } from '../app/lib/strategy.ts';
import { resolveDriverPerformance } from '../app/lib/driver-ratings.ts';
import { runRaceExperiments } from '../app/lib/race-experiments.ts';
import { createExperiment, serializeExperiments, parseExperiments } from '../app/lib/experiment-notebook.ts';

const strategy = evaluateStrategy({track: TRACK_PRESETS.melbourne, laps: 8,
  stints:[{compound:'S',startLap:1,endLap:4},{compound:'H',startLap:5,endLap:8}]});
const experiment = runRaceExperiments([strategy], {seed:123,trials:3});
const input = {weather:{preset:'none'},seed:123,teamId:'red-bull',driverId:'max-verstappen',performanceEnabled:true,
  driver:resolveDriverPerformance('max-verstappen'),strategy,isManual:false,experiment,trialIndex:0};
test('notebook snapshots the exact candidate, seed, timeline and official rating metadata',()=>{
  const research=buildExperimentResearch(input);
  assert.equal(research.mc.winRate,experiment.candidates[0].winRate);
  assert.equal(research.mc.trials,3);
  assert.match(research.scTimelineSummary,/선택 시행 1/);
  assert.equal(research.eaRatings.ratings.PAC,input.driver.ratings.PAC);
});
test('manual plans, stale seeds and unmatched strategies cannot inherit candidate win rates',()=>{
  assert.equal(buildExperimentResearch({...input,isManual:true}).mc,undefined);
  assert.equal(buildExperimentResearch({...input,seed:124}).mc,undefined);
  const other=evaluateStrategy({track:TRACK_PRESETS.melbourne,laps:8,stints:[{compound:'M',startLap:1,endLap:4},{compound:'H',startLap:5,endLap:8}]});
  assert.equal(buildExperimentResearch({...input,strategy:other}).mc,undefined);
});
test('fully integrated notebook research survives saved-record serialization',()=>{
  const research=buildExperimentResearch(input);
  const record=createExperiment({trackId:'melbourne',trackName:'앨버트 파크',laps:8,modelSource:'fastf1-2025',pitLossSeconds:20.5,
    degradationPercent:100,trackTemperatureC:34,maxStops:2,research,strategy},'통합 검증',{id:'integration',createdAt:'2026-09-07T00:00:00Z'});
  const parsed=parseExperiments(serializeExperiments([record]));
  assert.equal(parsed.records.length,1);
  assert.equal(parsed.records[0].research.seed,123);
  assert.equal(parsed.records[0].research.mc.winRate,research.mc.winRate);
});
