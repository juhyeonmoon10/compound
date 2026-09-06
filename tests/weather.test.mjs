import test from "node:test";
import assert from "node:assert/strict";
import { buildWeatherTimeline, wetPenalty, calculatedCrossovers } from "../app/lib/weather.ts";
import { ALL_COMPOUNDS, evaluateStrategy, optimizeTyreStrategies } from "../app/lib/strategy.ts";
import { MODEL_PARAMS } from "../app/model/params.ts";
import { calculateTyreState } from "../app/lib/tyre-state.ts";
import { buildManualStints, manualPlanFromStrategy } from "../app/lib/manual-strategy.ts";

test("rain accumulation, dry temperature effect and boundaries follow the declared equation", () => {
  assert.equal(buildWeatherTimeline(5, 30, {preset:"light"}).laps[0].water, 0.04);
  assert.equal(buildWeatherTimeline(30, 30, {preset:"heavy"}).laps.at(-1).water, 1);
  const cool=buildWeatherTimeline(4,30,{preset:"heavy",endLap:2});
  const hot=buildWeatherTimeline(4,35,{preset:"heavy",endLap:2});
  assert.ok(hot.laps[2].water<cool.laps[2].water);
  assert.equal(buildWeatherTimeline(4,30).wetRace,false);
  assert.throws(()=>buildWeatherTimeline(4,30,{preset:"light",startLap:4,endLap:2}));
});
test("crossovers are computed: discontinuity at 0.10, INTER/WET equality at 0.60, not asserted examples", () => {
  const cross=calculatedCrossovers();
  assert.ok(Math.abs(cross.slickInter-0.10)<MODEL_PARAMS.validation.crossoverStep*2);
  assert.ok(Math.abs(cross.interWet-0.60)<MODEL_PARAMS.validation.crossoverStep);
  assert.equal(wetPenalty("M",0.1),0.3);
  assert.ok(wetPenalty("M",0.1001)>wetPenalty("INTER",0.1001));
  assert.ok(Math.abs(wetPenalty("INTER",0.6)-wetPenalty("WET",0.6))<1e-9);
});
test("wet tyres have no warmup or cliff; dry heat accumulates and resets on a fresh set", () => {
  for(const compound of ["INTER","WET"]) {
    const state=calculateTyreState({compound,tyreAge:25,maxStintLaps:58,tyreSeverity:3,trackTemperatureC:34,degradationSeconds:1});
    assert.equal(state.warmupLossSeconds,0); assert.equal(state.cliffLossSeconds,0);
  }
  const plan=evaluateStrategy({laps:8,rules:{minStops:1,maxStops:1},stints:[{compound:"INTER",startLap:1,endLap:4},{compound:"INTER",startLap:5,endLap:8}]});
  assert.equal(plan.lapCosts[3].wetPenaltySeconds,3.5+3*0.25);
  assert.equal(plan.lapCosts[4].wetPenaltySeconds,3.5);
  assert.equal(plan.lapCosts[3].linearDegradationSeconds,3*0.12);
  assert.equal(plan.isLegal,true);
});
test("rain alone does not waive FIA dry compound rule; actually using wet tyres does", () => {
  const common={laps:8,weather:{preset:"heavy"},rules:{minStops:0,maxStops:3}};
  assert.equal(evaluateStrategy({...common,stints:[{compound:"M",startLap:1,endLap:8}]}).isLegal,false);
  const wet=evaluateStrategy({...common,stints:[{compound:"INTER",startLap:1,endLap:8}]});
  assert.equal(wet.isLegal,true); assert.match(wet.ruleExplanation,/실제 사용/);
});
test("wet 8-lap K-best DP matches exhaustive enumeration through three stops", () => {
  const input={laps:8,weather:{preset:"heavy",startLap:3,endLap:5},pitLossSeconds:1,rules:{minStops:0,maxStops:3},topK:3};
  const candidates=[];
  function visit(stints,start) {
    for (const compound of ALL_COMPOUNDS) for(let end=start;end<=8;end++) {
      const next=[...stints,{compound,startLap:start,endLap:end}];
      if(end===8) {
        const v=evaluateStrategy({...input,stints:next});
        if(v.isLegal)candidates.push({v,key:next.map(s=>s.compound.repeat(s.endLap-s.startLap+1)).join("|")});
      } else if(next.length<4)visit(next,end+1);
    }
  }
  visit([],1);
  candidates.sort((a,b)=>Math.abs(a.v.totalSeconds-b.v.totalSeconds)>1e-9?a.v.totalSeconds-b.v.totalSeconds:a.key.localeCompare(b.key));
  const dp=optimizeTyreStrategies(input);
  assert.equal(dp.length,3);
  for(let i=0;i<3;i++) {assert.ok(Math.abs(dp[i].totalSeconds-candidates[i].v.totalSeconds)<1e-7);assert.deepEqual(dp[i].stints,candidates[i].v.stints);}
  assert.deepEqual(dp,optimizeTyreStrategies(input));
});
test("three-stop manual plans round-trip without dropping a wet stint",()=>{
  const stints=[{compound:"M",startLap:1,endLap:2},{compound:"INTER",startLap:3,endLap:4},{compound:"WET",startLap:5,endLap:6},{compound:"H",startLap:7,endLap:8}];
  assert.deepEqual(buildManualStints(manualPlanFromStrategy({stints,stopCount:3},8),8),stints);
});
