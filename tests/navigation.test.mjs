import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../app/StrategyLab.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("StrategyLab.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes = [];
function visit(node) { nodes.push(node); ts.forEachChild(node, visit); }
visit(ast);
const visible = nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === "raceSetupVisible");
const effect = nodes.find(node => ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[0]?.getText(ast).includes("if (!raceSetupVisible)"));
const transpile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

test("setup only covers the strategy page, including before a scenario is configured", () => {
  assert.ok(visible, "setup visibility must be scoped to the current page");
  for (const raceSetupOpen of [false, true]) {
    for (const pageView of ["strategy", "data", "method", "research"]) {
      const result = runInNewContext(visible.initializer.getText(ast), { raceSetupOpen, pageView });
      assert.equal(result, raceSetupOpen && pageView === "strategy", `${pageView}/${raceSetupOpen}`);
    }
  }
  assert.match(source, /\{raceSetupVisible && \(/);
  const navigation = nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === "selectPageView");
  assert.doesNotMatch(navigation.initializer.getText(ast), /setDraft|setManualPlan|setRaceSetupOpen/,
    "browsing reference pages must preserve the pending setup and manual strategy");
});

test("leaving setup unlocks page scrolling and removes its keyboard handler without stealing nav focus", () => {
  assert.ok(effect, "the side-effect must follow actual visibility, not just the open flag");
  assert.match(effect.arguments[1].getText(ast), /raceSetupVisible/);
  let focused = 0, restored = 0;
  const listeners = new Map();
  const context = {
    raceSetupVisible: true,
    setupPanelRef: { current: { querySelectorAll: () => [{ focus() { focused++; } }] } },
    setupTriggerRef: { current: { focus() { restored++; } } },
    closeScenarioSetup() {},
    document: { body: { style: { overflow: "auto" } }, activeElement: { closest: () => ({}) } },
    window: {
      addEventListener: (type, fn) => listeners.set(type, fn),
      removeEventListener: (type, fn) => { assert.equal(listeners.get(type), fn); listeners.delete(type); },
    },
  };
  const execute = () => runInNewContext(transpile(`(${effect.arguments[0].getText(ast)})()`), context);
  const cleanup = execute();
  assert.equal(context.document.body.style.overflow, "hidden");
  assert.equal(listeners.size, 1);
  assert.equal(focused, 1);
  cleanup();
  assert.equal(context.document.body.style.overflow, "auto");
  assert.equal(listeners.size, 0);
  assert.equal(restored, 0, "selected nav button keeps focus");
  context.raceSetupVisible = false;
  assert.equal(execute(), undefined);
  assert.equal(context.document.body.style.overflow, "auto");
  assert.equal(listeners.size, 0);
});
