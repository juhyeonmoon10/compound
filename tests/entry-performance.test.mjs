import test from "node:test";
import assert from "node:assert/strict";
import { applyEntryPerformance, resolveEntryPerformance } from "../app/lib/entry-performance.ts";
import { TEAM_PROFILES } from "../app/lib/participants.ts";
import { evaluateStrategy, optimizeTyreStrategies } from "../app/lib/strategy.ts";
test("equal performance bypasses every entry adjustment exactly",()=>{
  const input={track:"melbourne",laps:8};
  assert.equal(applyEntryPerformance(input,"red-bull","max-verstappen",true),input);
  assert.deepEqual(optimizeTyreStrategies(input),optimizeTyreStrategies(applyEntryPerformance(input,"ferrari","lewis-hamilton",true)));
});
test("known-team pace has a zero fastest baseline and missing teams remain explicitly neutral",()=>{
  const profiles=TEAM_PROFILES.map(t=>resolveEntryPerformance(t.id,t.drivers[0].id));
  assert.equal(Math.min(...profiles.filter(p=>p.team.source.kind!=="unavailable").map(p=>p.teamPaceSeconds)),0);
  assert.ok(profiles.every(p=>p.teamPaceSeconds>=0));
  assert.equal(profiles.find(p=>p.team.id==="cadillac").teamPaceSeconds,0);
});
test("entry coefficients alter DP input and wet time without double application",()=>{
  const input={track:"melbourne",laps:8,weather:{preset:"heavy"}};
  const adjusted=applyEntryPerformance(input,"red-bull","max-verstappen");
  const results=optimizeTyreStrategies(adjusted);
  for(const r of results) assert.ok(Math.abs(evaluateStrategy({...adjusted,stints:r.stints}).totalSeconds-r.totalSeconds)<1e-7);
  assert.notEqual(results[0].totalSeconds,optimizeTyreStrategies(input)[0].totalSeconds);
  assert.deepEqual(results,optimizeTyreStrategies(adjusted));
});
