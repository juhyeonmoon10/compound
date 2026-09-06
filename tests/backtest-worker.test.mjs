import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Worker } from "node:worker_threads";
import ts from "typescript";

// Extract the actual React-independent controller, not a reimplementation.
// This keeps lifecycle tests fast without adding a DOM or React test dependency.
const panelUrl = new URL("../app/StrategyBacktestPanel.tsx", import.meta.url);
const source = readFileSync(panelUrl, "utf8");
const tree = ts.createSourceFile(panelUrl.pathname, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
const controllerDeclaration = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "createBacktestController");
assert.ok(controllerDeclaration);
const compiled = ts.transpileModule(controllerDeclaration.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText;
const { createBacktestController } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

class FakeWorker {
  onmessage = null;
  onerror = null;
  onmessageerror = null;
  terminated = false;
  request = null;
  postMessage(request) { this.request = request; }
  terminate() { this.terminated = true; }
  reply(results) { this.onmessage?.({ data: { ...this.request, status: "ready", results } }); }
}

function harness() {
  const workers = [];
  const controller = createBacktestController(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  });
  return { controller, workers };
}

test("background results cache all drivers and revisiting an event never restarts it", () => {
  const { controller, workers } = harness();
  let updates = 0;
  const unsubscribe = controller.subscribe(() => { updates += 1; });
  controller.selectEvent("a");
  assert.equal(controller.getSnapshot().phase, "running");
  const results = { NOR: { total: 1 }, PIA: { total: 2 }, LEC: { total: 3 } };
  workers[0].reply(results);
  assert.equal(controller.getSnapshot().phase, "ready");
  assert.equal(controller.getSnapshot().results.PIA.total, 2);
  assert.equal(workers[0].terminated, true);
  controller.selectEvent("a");
  assert.equal(workers.length, 1);
  assert.equal(controller.getSnapshot().results, results);
  assert.equal(updates, 3);
  unsubscribe();
  controller.selectEvent("a");
  assert.equal(updates, 3);
});

test("rapid event changes reject stale replies and mismatched request ids", () => {
  const { controller, workers } = harness();
  controller.selectEvent("a");
  const late = workers[0].onmessage;
  const oldRequest = workers[0].request;
  controller.selectEvent("b");
  assert.equal(workers[0].terminated, true);
  late({ data: { ...oldRequest, status: "ready", results: { OLD: {} } } });
  assert.equal(controller.getSnapshot().eventId, "b");
  assert.equal(controller.getSnapshot().phase, "running");
  workers[1].onmessage({ data: { ...oldRequest, eventId: "b", status: "ready", results: { WRONG: {} } } });
  assert.equal(controller.getSnapshot().phase, "running");
  workers[1].reply({ CURRENT: {} });
  late({ data: { ...oldRequest, status: "ready", results: { OLD: {} } } });
  assert.deepEqual(Object.keys(controller.getSnapshot().results), ["CURRENT"]);
  controller.selectEvent("a");
  assert.equal(workers.length, 3, "stale response must not populate the cache");
  controller.dispose();
});

test("cancel, retry and unmount terminate work and ignore queued callbacks", () => {
  const { controller, workers } = harness();
  controller.selectEvent("wet");
  const late = workers[0].onmessage;
  controller.cancel();
  assert.equal(controller.getSnapshot().phase, "cancelled");
  assert.equal(workers[0].terminated, true);
  controller.retry();
  assert.equal(workers.length, 2);
  late({ data: { ...workers[0].request, status: "ready", results: { STALE: {} } } });
  assert.equal(controller.getSnapshot().phase, "running");
  const unmounted = workers[1].onmessage;
  controller.dispose();
  unmounted({ data: { ...workers[1].request, status: "ready", results: { STALE: {} } } });
  assert.equal(controller.getSnapshot().results, null);
  assert.equal(workers[1].terminated, true);
});

test("worker errors, malformed results and construction failures are explicit and retryable", () => {
  const { controller, workers } = harness();
  controller.selectEvent("a");
  workers[0].onmessageerror();
  assert.equal(controller.getSnapshot().phase, "error");
  assert.equal(workers[0].terminated, true);
  controller.retry();
  let prevented = false;
  workers[1].onerror({ message: "network error", preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(controller.getSnapshot().message, "network error");
  controller.retry();
  workers[2].reply({});
  assert.equal(controller.getSnapshot().phase, "error");
  controller.retry();
  workers[3].onmessage({ data: { ...workers[3].request, status: "error", message: "calculation failed" } });
  assert.equal(controller.getSnapshot().message, "calculation failed");
  controller.retry();
  workers[4].onmessage({ data: null });
  assert.equal(controller.getSnapshot().phase, "error");
  const broken = createBacktestController(() => { throw new Error("CSP denied"); });
  broken.selectEvent("a");
  assert.equal(broken.getSnapshot().phase, "error");
  assert.equal(broken.getSnapshot().message, "CSP denied");
});

test("unsupported browsers never run a blocking synchronous fallback", () => {
  const controller = createBacktestController(() => null);
  controller.selectEvent("wet");
  assert.equal(controller.getSnapshot().phase, "unsupported");
  assert.match(controller.getSnapshot().message, /동기 계산은 실행하지 않습니다/);
  assert.doesNotMatch(source, /\brunStrategyBacktest\s*\(/);
  assert.match(source, /snapshot\.eventId === event\.id/);
  assert.match(source, /results\?\.\[driver\.code\]/);
});

test("the real worker entry returns all podium drivers without blocking its caller", async () => {
  const entry = new URL("../app/workers/backtest.worker.ts", import.meta.url).href;
  const adapter = `import { parentPort } from 'node:worker_threads'; globalThis.postMessage = data => parentPort.postMessage(data); await import(${JSON.stringify(entry)}); parentPort.on('message', data => globalThis.onmessage({ data }));`;
  const worker = new Worker(new URL(`data:text/javascript;base64,${Buffer.from(adapter).toString("base64")}`), { execArgv: ["--experimental-strip-types"] });
  try {
    const result = new Promise((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject); });
    worker.postMessage({ requestId: 42, eventId: "austria-2025" });
    const callerResponsive = await Promise.race([result.then(() => false), new Promise(resolve => setTimeout(() => resolve(true), 0))]);
    assert.equal(callerResponsive, true);
    const response = await result;
    assert.equal(response.status, "ready");
    assert.equal(response.requestId, 42);
    assert.equal(response.eventId, "austria-2025");
    assert.deepEqual(Object.keys(response.results), ["NOR", "PIA", "LEC"]);
    assert.equal(response.results.NOR.actualRaceElapsedSeconds, 5027.693);
    assert.equal(response.results.NOR.alternatives.length, 20);
  } finally {
    await worker.terminate();
  }
});
