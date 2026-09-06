import assert from "node:assert/strict";
import test from "node:test";
import {
  ALL_COMPOUNDS, TRACK_PRESET_IDS, evaluateStrategy, optimizeTyreStrategies,
} from "../app/lib/strategy.ts";
import { MODEL_PARAMS } from "../app/model/params.ts";
import {
  buildRepresentativeStrategies, selectDistinctStrategies, stintMultisetKey, representativeGroupKey,
} from "../app/lib/representative-strategies.ts";

const EPSILON = MODEL_PARAMS.validation.toleranceSeconds;
const sig = (stints) => stints.map((stint) => `${stint.compound}:${stint.startLap}-${stint.endLap}`).join(">");
function checkSelection(selection) {
  const results = selection.strategies;
  assert.equal(selection.missingCount, 3 - results.length);
  assert.equal(new Set(results.map((result) => stintMultisetKey(result.stints))).size, results.length);
  for (let index = 0; index < results.length; index += 1) {
    assert.equal(results[index].rank, index + 1);
    assert.equal(results[index].isLegal, true);
    if (index) assert.ok(results[index].totalSeconds + EPSILON >= results[index - 1].totalSeconds);
    for (let before = 0; before < index; before += 1) {
      const differentGroup = representativeGroupKey(results[index].stints) !== representativeGroupKey(results[before].stints);
      const differentTime = Math.abs(results[index].totalSeconds - results[before].totalSeconds) + EPSILON >= MODEL_PARAMS.race.minimumDistinctSeconds;
      assert.ok(differentGroup || differentTime);
    }
  }
}

test("dry representative selection preserves the exact original global winner without altering K-best", () => {
  const input = { track: "melbourne", rules: { minStops: 1, maxStops: 3 }, topK: 3 };
  const global = optimizeTyreStrategies(input);
  const original = structuredClone(global);
  const selected = buildRepresentativeStrategies(input, { globalBest: global[0] });
  assert.equal(selected.strategies.length, 3);
  assert.deepEqual(selected.strategies[0], global[0]);
  assert.deepEqual(global, original);
  assert.deepEqual(optimizeTyreStrategies(input), original);
  checkSelection(selected);
  assert.equal(selected.status, "complete");
  assert.equal(selected.method, "grouped-stint-dp-and-single-pit-neighbours");
  assert.match(selected.explanation, /전역 K-best 2·3위는 아닙니다/);
});

test("all 24 actual venues produce three legal and distinct dry representatives", () => {
  for (const track of TRACK_PRESET_IDS) {
    const selected = buildRepresentativeStrategies({ track, rules: { minStops: 1, maxStops: 3 } });
    assert.equal(selected.strategies.length, 3, track);
    checkSelection(selected);
  }
});

test("all five rain presets produce a deterministic actual Top 3 with a bounded oracle budget", () => {
  for (const preset of ["none", "light", "heavy", "dry-to-rain", "rain-to-dry"]) {
    const input = { track: "melbourne", weather: { preset }, rules: { minStops: 1, maxStops: 3 } };
    const selected = buildRepresentativeStrategies(input);
    assert.equal(selected.strategies.length, 3, preset);
    assert.deepEqual(selected, buildRepresentativeStrategies(input));
    assert.ok(selected.diagnostics.oracleEvaluations <= ALL_COMPOUNDS.length * 58 + 3);
    assert.ok(selected.diagnostics.permutationCollapsedCount > 0);
    checkSelection(selected);
  }
});

test("wet global winner agrees with unchanged lap-state DP and can be retained verbatim", () => {
  const input = { track: "melbourne", weather: { preset: "dry-to-rain" }, rules: { minStops: 1, maxStops: 3 } };
  const best = optimizeTyreStrategies({ ...input, topK: 1 })[0];
  const selection = buildRepresentativeStrategies(input, { globalBest: best });
  assert.deepEqual(selection.strategies[0], best);
  assert.ok(selection.strategies[0].compoundsUsed.includes("INTER"));
  checkSelection(selection);
});

test("segment-group global minima agree with exhaustive dry and changing-wet 5-lap searches", () => {
  for (const preset of ["none", "heavy"]) {
    const input = { laps: 5, weather: { preset, startLap: 2, endLap: 4 }, pitLossSeconds: 1,
      allowedCompounds: preset === "none" ? ["S", "M", "H"] : ALL_COMPOUNDS,
      rules: { minStops: 0, maxStops: 3 } };
    let best = Infinity;
    function visit(previous, start) {
      for (const compound of input.allowedCompounds) for (let end = start; end <= 5; end += 1) {
        const stints = [...previous, { compound, startLap: start, endLap: end }];
        if (end === 5) {
          const evaluated = evaluateStrategy({ ...input, stints });
          if (evaluated.isLegal) best = Math.min(best, evaluated.totalSeconds);
        } else if (stints.length < 4) visit(stints, end + 1);
      }
    }
    visit([], 1);
    const selection = buildRepresentativeStrategies(input);
    assert.ok(Math.abs(selection.strategies[0].totalSeconds - best) < EPSILON, preset);
    checkSelection(selection);
  }
});

test("permutations of compound-and-length pairs collapse even when rain makes their costs different", () => {
  const input = { laps: 8, weather: { preset: "heavy", startLap: 3, endLap: 5 }, rules: { minStops: 1, maxStops: 1 } };
  const plans = [
    [{ compound: "M", startLap: 1, endLap: 3 }, { compound: "INTER", startLap: 4, endLap: 8 }],
    [{ compound: "INTER", startLap: 1, endLap: 5 }, { compound: "M", startLap: 6, endLap: 8 }],
    [{ compound: "H", startLap: 1, endLap: 3 }, { compound: "INTER", startLap: 4, endLap: 8 }],
  ];
  const candidates = plans.map((stints, index) => ({ ...evaluateStrategy({ ...input, stints }), signature: sig(stints), rank: index + 1 }));
  assert.equal(stintMultisetKey(plans[0]), stintMultisetKey(plans[1]));
  assert.notEqual(stintMultisetKey(plans[0]), stintMultisetKey(plans[2]));
  assert.ok(Math.abs(candidates[0].totalSeconds - candidates[1].totalSeconds) > EPSILON);
  const filtered = selectDistinctStrategies(candidates);
  assert.equal(filtered.length, 2);
  const keptPermutation = filtered.find((candidate) => stintMultisetKey(candidate.stints) === stintMultisetKey(plans[0]));
  assert.equal(keptPermutation.totalSeconds, Math.min(candidates[0].totalSeconds, candidates[1].totalSeconds));
  assert.deepEqual(filtered, selectDistinctStrategies([...candidates].reverse()));
});

test("multiset keys retain multiplicity, and same-group alternatives need a half-second separation", () => {
  const input = { laps: 8, rules: { minStops: 1, maxStops: 2 } };
  function candidate(stints, seconds) { return { ...evaluateStrategy({ ...input, stints }), totalSeconds: seconds, signature: sig(stints), rank: 1 }; }
  const items = [
    candidate([{ compound: "M", startLap: 1, endLap: 3 }, { compound: "H", startLap: 4, endLap: 8 }], 100),
    candidate([{ compound: "M", startLap: 1, endLap: 4 }, { compound: "H", startLap: 5, endLap: 8 }], 100.499),
    candidate([{ compound: "M", startLap: 1, endLap: 5 }, { compound: "H", startLap: 6, endLap: 8 }], 100.5),
    candidate([{ compound: "S", startLap: 1, endLap: 3 }, { compound: "H", startLap: 4, endLap: 8 }], 100.6),
  ];
  assert.deepEqual(selectDistinctStrategies(items).map((item) => item.totalSeconds), [100, 100.5, 100.6]);
  assert.equal(stintMultisetKey([{ compound: "S", startLap: 1, endLap: 2 }, { compound: "S", startLap: 3, endLap: 4 }]), "S:2|S:2");
});

test("restricted tiny scenarios report fewer than three instead of fabricating repeated rows", () => {
  const input = { laps: 2, allowedCompounds: ["M", "H"], rules: { minStops: 1, maxStops: 1 } };
  const selection = buildRepresentativeStrategies(input);
  assert.equal(selection.status, "insufficient-distinct-candidates");
  assert.equal(selection.strategies.length, 1);
  assert.equal(selection.missingCount, 2);
  assert.match(selection.explanation, /2칸을 채우지 않았습니다/);
  const none = buildRepresentativeStrategies({ ...input, allowedCompounds: ["H"] });
  assert.equal(none.strategies.length, 0);
  assert.equal(none.missingCount, 3);
  assert.equal(none.globalBestSignature, null);
});

test("starting restrictions, original scenario identity and minimum stint lengths are preserved", () => {
  const input = { laps: 18, weather: { preset: "light" }, allowedStartingCompounds: ["M"],
    allowedCompounds: ["M", "H", "INTER"], rules: { minStops: 1, maxStops: 3, minStintLaps: 3 } };
  const best = optimizeTyreStrategies({ ...input, topK: 1 })[0];
  const selected = buildRepresentativeStrategies(input, { globalBest: best });
  for (const candidate of selected.strategies) {
    assert.equal(candidate.stints[0].compound, "M");
    assert.ok(candidate.stints.every((stint) => stint.laps >= 3 && input.allowedCompounds.includes(stint.compound)));
    assert.equal(candidate.scenarioSignature, best.scenarioSignature);
  }
  assert.throws(() => buildRepresentativeStrategies({ ...input, pitLossSeconds: 30 }, { globalBest: best }), /same restricted scenario/);
  assert.throws(() => buildRepresentativeStrategies({ ...input, allowedStartingCompounds: ["WET"] }), /restrictions/);
});

test("restricted one-group wet plans use pit neighbours to obtain genuinely different alternatives", () => {
  const input = { laps: 58, weather: { preset: "heavy", initialWater: 1 }, allowedCompounds: ["WET"], rules: { minStops: 1, maxStops: 1 } };
  const selected = buildRepresentativeStrategies(input);
  assert.equal(selected.diagnostics.groupCount, 1);
  assert.equal(selected.strategies.length, 3);
  checkSelection(selected);
});
