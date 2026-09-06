import test from "node:test";
import assert from "node:assert/strict";
import { applyEntryPerformance, resolveEntryPerformance, getAdoptedTeamPerformance } from "../app/lib/entry-performance.ts";
import { TEAM_PROFILES } from "../app/lib/participants.ts";
import { evaluateStrategy, optimizeTyreStrategies } from "../app/lib/strategy.ts";
test("equal performance bypasses every entry adjustment exactly",()=>{
  const input={track:"melbourne",laps:8};
  assert.equal(applyEntryPerformance(input,"red-bull","max-verstappen",true),input);
  assert.deepEqual(optimizeTyreStrategies(input),optimizeTyreStrategies(applyEntryPerformance(input,"ferrari","lewis-hamilton",true)));
});
test("all current teams use recent 2026 evidence with a zero fastest baseline; genuinely missing teams stay neutral",()=>{
  const profiles=TEAM_PROFILES.map(t=>resolveEntryPerformance(t.id,t.drivers[0].id));
  assert.equal(Math.min(...profiles.filter(p=>p.team.source.kind!=="unavailable").map(p=>p.teamPaceSeconds)),0);
  assert.ok(profiles.every(p=>p.teamPaceSeconds>=0));
  assert.ok(profiles.every(p=>p.team.source.currentSeasonCollected && p.team.source.events >= 2));
  assert.ok(profiles.find(p=>p.team.id==="cadillac").teamPaceSeconds > 0);
  assert.ok(profiles.find(p=>p.team.id==="audi").team.observedPaceSeconds !== null);
  const missing=getAdoptedTeamPerformance("unknown-team");
  assert.equal(missing.adoptedPaceSeconds,0);
  assert.equal(missing.degMultiplier,1);
  assert.equal(missing.observedPaceSeconds,null);
  assert.equal(missing.source.kind,"unavailable");
});
test("entry coefficients alter DP input and wet time without double application",()=>{
  const input={track:"melbourne",laps:8,weather:{preset:"heavy"}};
  const adjusted=applyEntryPerformance(input,"red-bull","max-verstappen");
  const results=optimizeTyreStrategies(adjusted);
  for(const r of results) assert.ok(Math.abs(evaluateStrategy({...adjusted,stints:r.stints}).totalSeconds-r.totalSeconds)<1e-7);
  assert.notEqual(results[0].totalSeconds,optimizeTyreStrategies(input)[0].totalSeconds);
  assert.deepEqual(results,optimizeTyreStrategies(adjusted));
});
