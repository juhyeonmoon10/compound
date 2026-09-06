import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { Worker as NodeWorker } from "node:worker_threads";
import { MODEL_PARAMS } from "../app/model/params.ts";
import { evaluateStrategy } from "../app/lib/strategy.ts";
import { runRaceExperiments } from "../app/lib/race-experiments.ts";
import { buildSharedRaceGrid } from "../app/lib/shared-race-grid.ts";
import { getNeutralisationPrior } from "../app/lib/neutralisation-prior.ts";

const workerUrl = new URL("../app/workers/race-experiment.worker.ts", import.meta.url);
const require = createRequire(import.meta.url);
const ts = require("typescript");

function candidates() {
  return [10, 15, 20].map((pit, index) => ({ ...evaluateStrategy({ laps: 30, pitLossSeconds: 20,
    stints: [{ compound: "M", startLap: 1, endLap: pit }, { compound: "H", startLap: pit + 1, endLap: 30 }] }),
    rank: index + 1, signature: `test-${pit}` }));
}

async function openWorker() {
  const bridge = `import {parentPort} from 'node:worker_threads';
    globalThis.self = {postMessage: value => parentPort.postMessage(value)};
    await import(${JSON.stringify(workerUrl.href)});
    parentPort.on('message', data => self.onmessage({data}));
    parentPort.postMessage({ready:true});`;
  const worker = new NodeWorker(new URL(`data:text/javascript,${encodeURIComponent(bridge)}`), { execArgv: ["--experimental-strip-types"] });
  await new Promise((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject); });
  return worker;
}

function workerRequest(worker, request) {
  return new Promise((resolve, reject) => {
    worker.once("message", resolve); worker.once("error", reject); worker.postMessage(request);
  });
}

test("the actual TypeScript worker returns reproducible 300-trial results and shared SC/VSC timelines", async () => {
  const worker = await openWorker();
  try {
    const plans = candidates();
    const options = { seed: 20260906, trials: MODEL_PARAMS.race.trials, trackLaps: 30, racecraft: 96,
      startingGridPosition: 10, pitLossSeconds: 20, rivalStrategies: plans };
    const first = await workerRequest(worker, { requestId: 7, candidates: plans, options });
    assert.equal(first.requestId, 7);
    assert.equal(first.error, undefined);
    assert.equal(first.result.trials, 300);
    assert.equal(first.result.seed, 20260906);
    assert.deepEqual(first.result, runRaceExperiments(plans, options));
    for (const timeline of first.result.eventTimelines) {
      for (const candidate of first.result.candidates) assert.equal(candidate.trials[timeline.trial].eventTimelineId, timeline.id);
    }
    assert.equal(first.result.eventSummary.scTrials, first.result.eventTimelines.filter((timeline) => timeline.events.some((event) => event.kind === "SC")).length);
    assert.equal(first.result.eventSummary.vscTrials, first.result.eventTimelines.filter((timeline) => timeline.events.some((event) => event.kind === "VSC")).length);
    const repeated = await workerRequest(worker, { requestId: 8, candidates: plans, options });
    assert.equal(repeated.requestId, 8);
    assert.deepEqual(repeated.result, first.result);
    const changed = await workerRequest(worker, { requestId: 9, candidates: plans, options: { ...options, seed: 20260907 } });
    assert.notDeepEqual(changed.result.eventTimelines, first.result.eventTimelines);
  } finally { await worker.terminate(); }
});

test("worker errors echo their request ID instead of terminating the channel", async () => {
  const worker = await openWorker();
  try {
    const bad = await workerRequest(worker, { requestId: 20, candidates: [], options: {} });
    assert.equal(bad.requestId, 20);
    assert.match(bad.error, /candidate/i);
    const invalidId = await workerRequest(worker, { requestId: 0, candidates: candidates(), options: {} });
    assert.equal(invalidId.requestId, 0);
    assert.match(invalidId.error, /요청 ID/);
    const good = await workerRequest(worker, { requestId: 21, candidates: candidates(), options: { trials: 1 } });
    assert.equal(good.result.trials, 1);
  } finally { await worker.terminate(); }
});

test("actual worker accepts the same entry-only roster as replay, preserving all 19 IDs and common events", async () => {
  const worker = await openWorker();
  try {
    const plans = candidates();
    const shared = buildSharedRaceGrid({ teamId: "red-bull", driverId: "max-verstappen", equalPerformance: true,
      playerStrategy: plans[0], strategyPool: plans, startingGridPosition: 10 });
    const options = { seed: 20260907, trials: 300, trackLaps: 30, racecraft: shared.racecraft,
      playerId: shared.playerId, startingGridPosition: 10, fixedRivals: shared.fixedRivals, gridSlotOffsetSeconds: shared.gridSlotOffsetSeconds };
    const response = await workerRequest(worker, { requestId: 30, candidates: plans, options });
    assert.deepEqual(response.result, runRaceExperiments(plans, options));
    assert.equal(response.result.gridModel.kind, "shared-replay-entries");
    assert.deepEqual(response.result.gridModel.rivals.map((rival) => rival.driverId).sort(), shared.fixedRivals.map((rival) => rival.driverId).sort());
  } finally { await worker.terminate(); }
});

test("actual worker carries sourced observations and empirical durations without changing deterministic output", async () => {
  const worker = await openWorker();
  try {
    const plans = candidates();
    const options = { seed: 20260906, trials: MODEL_PARAMS.race.trials, trackLaps: 30, eventPrior: getNeutralisationPrior("bahrain") };
    const response = await workerRequest(worker, { requestId: 31, candidates: plans, options });
    assert.equal(response.error, undefined);
    assert.deepEqual(response.result.prior, options.eventPrior);
    assert.deepEqual(response.result, runRaceExperiments(plans, options));
    assert.equal(response.result.prior.sourceType, "observed");
    assert.ok(response.result.prior.scDurations.length >= MODEL_PARAMS.race.minDurationEpisodes);
  } finally { await worker.terminate(); }
});

// Compile the real component with a deterministic hook harness. No browser,
// copied lifecycle implementation, package installation, or network is needed.
const harnessKey = "__compoundWorkerPanelTestHooks";
const reactHooksUrl = `data:text/javascript,${encodeURIComponent(`export const useRef=(...a)=>globalThis.${harnessKey}.useRef(...a);
  export const useState=(...a)=>globalThis.${harnessKey}.useState(...a);
  export const useLayoutEffect=(...a)=>globalThis.${harnessKey}.useLayoutEffect(...a);`)}`;
let compiled = ts.transpileModule(readFileSync(new URL("../app/RaceExperimentPanel.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
compiled = compiled.replaceAll('from "react"', `from ${JSON.stringify(reactHooksUrl)}`)
  .replaceAll('from "react/jsx-runtime"', `from ${JSON.stringify(pathToFileURL(require.resolve("react/jsx-runtime")).href)}`)
  .replaceAll('from "./model/params"', `from ${JSON.stringify(new URL("../app/model/params.ts", import.meta.url).href)}`)
  .replaceAll('from "./lib/strategy"', `from ${JSON.stringify(new URL("../app/lib/strategy.ts", import.meta.url).href)}`)
  .replace('import "./race-experiment.css";', "")
  .replaceAll("import.meta.url", JSON.stringify(new URL("../app/RaceExperimentPanel.tsx", import.meta.url).href));
const { default: Panel } = await import(`data:text/javascript,${encodeURIComponent(compiled)}`);

function createHarness(overrides = {}) {
  let cursor = 0;
  const hooks = [], effects = [], results = [], trials = [];
  const created = [];
  class FakeWorker {
    constructor(url, options) { this.url = url; this.options = options; this.terminated = false; created.push(this); }
    postMessage(message) { this.message = message; if (FakeWorker.failPost) throw new Error("clone failed"); }
    terminate() { this.terminated = true; }
    emit(data) { this.onmessage?.({ data }); }
  }
  let props = { candidates: candidates(), seed: 42, onSeedChange: () => {}, result: null,
    onResult: (value) => results.push(value), racecraft: 96, startingGridPosition: 10, pitLossSeconds: 20,
    trialIndex: 0, onTrialChange: (value) => trials.push(value), ...overrides };
  const harness = {
    useRef(initial) { const index = cursor++; return hooks[index] ??= { current: initial }; },
    useState(initial) { const index = cursor++; hooks[index] ??= { value: initial }; return [hooks[index].value, (value) => { hooks[index].value = typeof value === "function" ? value(hooks[index].value) : value; }]; },
    useLayoutEffect(callback, deps) { const index = cursor++; const previous = hooks[index];
      if (!previous || deps.some((value, at) => !Object.is(value, previous.deps[at]))) effects.push(() => {
        previous?.cleanup?.(); hooks[index] = { deps, cleanup: callback() };
      }); },
  };
  function render(next = {}) { props = { ...props, ...next }; cursor = 0; globalThis[harnessKey] = harness;
    globalThis.Worker = FakeWorker; const tree = Panel(props); while (effects.length) effects.shift()(); return tree; }
  function elements(node, type) { if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap((item) => elements(item, type));
    return [...(node.type === type ? [node] : []), ...elements(node.props?.children, type)]; }
  function text(node) { if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(text).join(""); return node?.props ? text(node.props.children) : ""; }
  function click(label) { const button = elements(render(), "button").find((node) => text(node) === label);
    assert.ok(button, label); button.props.onClick(); }
  function dispose() { hooks.forEach((hook) => hook?.cleanup?.()); delete globalThis[harnessKey]; delete globalThis.Worker; }
  render();
  return { render, click, dispose, created, results, trials, FakeWorker, text };
}

test("panel opens the real module worker URL and cancellation blocks a late response", () => {
  const harness = createHarness();
  try {
    harness.click("300회 확률 실험");
    const worker = harness.created[0];
    assert.equal(worker.url.href, workerUrl.href);
    assert.equal(existsSync(worker.url), true);
    assert.deepEqual(worker.options, { type: "module" });
    assert.equal(worker.message.options.trackLaps, 30);
    assert.equal(worker.message.options.trials, 300);
    assert.equal(worker.message.options.seed, 42);
    harness.click("취소");
    assert.equal(worker.terminated, true);
    worker.emit({ requestId: worker.message.requestId, result: runRaceExperiments(worker.message.candidates, worker.message.options) });
    assert.ok(harness.results.every((result) => result === null));
    assert.match(harness.text(harness.render()), /계산을 취소/);
  } finally { harness.dispose(); }
});

test("seed, candidate, RAC, grid, pit and observation-prior changes terminate the active job before accepting results", () => {
  for (const next of [{ seed: 43 }, { candidates: candidates().slice(0, 2) }, { racecraft: 80 }, { startingGridPosition: 3 }, { pitLossSeconds: 24 },
    { playerId: "max-verstappen" }, { gridSlotOffsetSeconds: 0.12 }, { fixedRivals: [] }, { eventPrior: getNeutralisationPrior("spa") }]) {
    const harness = createHarness();
    try {
      harness.click("300회 확률 실험"); const old = harness.created[0];
      harness.render(next);
      assert.equal(old.terminated, true);
      old.emit({ requestId: old.message.requestId, result: { seed: 42 } });
      assert.ok(harness.results.every((value) => value === null));
      harness.click("300회 확률 실험");
      assert.ok(harness.created[1].message.requestId > old.message.requestId);
    } finally { harness.dispose(); }
  }
});

test("successful current response is accepted once, mismatched response is not applied", () => {
  const harness = createHarness();
  try {
    harness.click("300회 확률 실험"); const worker = harness.created[0];
    const result = runRaceExperiments(worker.message.candidates, worker.message.options);
    worker.emit({ requestId: worker.message.requestId - 1, result });
    assert.ok(harness.results.every((value) => value === null));
    worker.emit({ requestId: worker.message.requestId, result });
    assert.deepEqual(harness.results.at(-1), result);
    assert.deepEqual(harness.trials, [0]);
    assert.equal(worker.terminated, true);
    worker.emit({ requestId: worker.message.requestId, result });
    assert.deepEqual(harness.trials, [0]);
    harness.click("300회 확률 실험"); const next = harness.created[1];
    next.emit({ requestId: next.message.requestId, result: { ...result, seed: 999 } });
    assert.equal(harness.results.at(-1), null);
    assert.match(harness.text(harness.render()), /응답이 일치하지 않아/);
  } finally { harness.dispose(); }
});

test("panel posts the selected circuit prior and rejects a response carrying another prior", () => {
  const prior = getNeutralisationPrior("bahrain");
  const harness = createHarness({ eventPrior: prior });
  try {
    harness.click("300회 확률 실험");
    const worker = harness.created[0];
    assert.deepEqual(worker.message.options.eventPrior, prior);
    const result = runRaceExperiments(worker.message.candidates, worker.message.options);
    worker.emit({ requestId: worker.message.requestId, result: { ...result, prior: getNeutralisationPrior("madrid") } });
    assert.ok(harness.results.every(value => value === null));
    assert.match(harness.text(harness.render()), /응답이 일치하지 않아/);
  } finally { harness.dispose(); }
});

test("post failure, decode errors and unmount all release the worker", () => {
  const harness = createHarness();
  try {
    harness.FakeWorker.failPost = true;
    harness.click("300회 확률 실험");
    assert.equal(harness.created[0].terminated, true);
    assert.match(harness.text(harness.render()), /계산기를 열지 못했습니다/);
    harness.FakeWorker.failPost = false;
    harness.click("300회 확률 실험");
    harness.created[1].onmessageerror();
    assert.equal(harness.created[1].terminated, true);
    harness.click("300회 확률 실험");
  } finally { harness.dispose(); }
  assert.equal(harness.created.at(-1).terminated, true);
});
