import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runInThisContext } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

// Exercise production TSX and model imports. Only styles are omitted; worker
// URLs are made CommonJS-compatible without starting workers or a browser.
const moduleCache = new Map();
const loadedModules = new Set();
function loadComponent(filename) {
  if (filename.endsWith(".css")) return {};
  if (moduleCache.has(filename)) return moduleCache.get(filename).exports;
  loadedModules.add(filename);
  if (filename.endsWith(".json")) return JSON.parse(readFileSync(filename, "utf8"));
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    },
  }).outputText.replaceAll("import.meta.url", JSON.stringify(pathToFileURL(filename).href));
  const loaded = { exports: {} };
  moduleCache.set(filename, loaded);
  const nativeRequire = createRequire(filename);
  const localRequire = specifier => {
    if (specifier.endsWith(".css")) return {};
    if (!specifier.startsWith(".")) return nativeRequire(specifier);
    const target = resolve(dirname(filename), specifier);
    const dependency = [target, `${target}.ts`, `${target}.tsx`].find(existsSync);
    if (!dependency) throw new Error(`Missing component dependency: ${specifier}`);
    return loadComponent(dependency);
  };
  runInThisContext(`(function(exports, require, module) {${compiled}\n})`, { filename })(loaded.exports, localRequire, loaded);
  return loaded.exports;
}

const componentUrl = new URL("../app/StrategyLab.tsx", import.meta.url);
const source = readFileSync(componentUrl, "utf8");
const { default: StrategyLab } = loadComponent(fileURLToPath(componentUrl));
const markup = renderToStaticMarkup(createElement(StrategyLab));

// A small markup index is sufficient for order and hidden-ancestor checks.
// This intentionally does not pretend to test CSS geometry or browser focus.
const voidElements = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const elements = [], stack = [];
for (const match of markup.matchAll(/<(\/?)([a-z][\w-]*)([^>]*)>/gi)) {
  const [, closing, tag, attributes] = match;
  if (closing) {
    const element = stack.pop();
    assert.equal(element?.tag, tag, `balanced markup for ${tag}`);
    element.end = match.index + match[0].length;
  } else {
    const element = { tag, attributes, parent: stack.at(-1), start: match.index, end: match.index + match[0].length };
    elements.push(element);
    if (!voidElements.has(tag) && !attributes.endsWith("/")) stack.push(element);
  }
}
const attribute = (element, name) => element.attributes.match(new RegExp(`(?:^|\\s)${name}(?:="([^"]*)")?(?=\\s|$)`));
const hasClass = (element, className) => (attribute(element, "class")?.[1] ?? "").split(/\s+/).includes(className);
const byClass = className => elements.find(element => hasClass(element, className));
const html = element => markup.slice(element.start, element.end);
const ancestors = element => {
  const parents = [];
  for (let parent = element.parent; parent; parent = parent.parent) parents.push(parent);
  return parents;
};
const isVisible = element => ![element, ...ancestors(element)].some(parent =>
  attribute(parent, "hidden") || attribute(parent, "aria-hidden")?.[1] === "true"
  || (parent !== element && parent.tag === "details" && !attribute(parent, "open")));

test("the initial strategy page shows labelled example conditions without an active setup dialog", () => {
  const header = byClass("strategy-home-header");
  const context = byClass("strategy-context");
  assert.ok(header && isVisible(header), "a single visible home heading should orient the user");
  assert.ok(context && isVisible(context), "example conditions should be visible without opening setup");
  assert.match(html(header) + html(context), /예시 조건/);
  assert.equal(elements.filter(element => hasClass(element, "strategy-home-header")).length, 1);
  assert.equal(elements.some(element => attribute(element, "role")?.[1] === "dialog" && isVisible(element)), false);
  assert.equal(byClass("manual-entry"), undefined);
  assert.equal(byClass("manual-flow"), undefined);
  assert.match(source, /\[raceSetupOpen, setRaceSetupOpen\] = useState\(false\)/);
  assert.match(source, /\[isExampleScenario, setIsExampleScenario\] = useState\(true\)/);
  assert.match(source, /\[draftSelections, setDraftSelections\] = useState\(\{\s*track: true,\s*team: true,\s*driver: true,/);
});

test("the actual initial DOM puts the strategy overview before the editing controls", () => {
  const overview = byClass("strategy-overview");
  const editor = byClass("manual-editor");
  assert.ok(overview && editor);
  assert.ok(hasClass(overview, "manual-preview"));
  assert.ok(isVisible(overview) && isVisible(editor));
  assert.ok(overview.end <= editor.start, "screen-reader and keyboard order must match the overview-first design");
  assert.match(html(overview), /내 전략|전략 요약/);
  assert.doesNotMatch(html(overview), /NaN|Infinity|undefined/);
});

test("the legal example has an enabled race action before collapsed analysis details", () => {
  const overview = byClass("strategy-overview");
  assert.ok(overview);
  const details = elements.find(element => element.tag === "details"
    && hasClass(element, "strategy-overview__details") && ancestors(element).includes(overview));
  assert.ok(details, "secondary analysis belongs in a disclosure");
  assert.equal(attribute(details, "open"), null, "analysis should start collapsed");
  const resultsAction = elements.find(element => element.tag === "button"
    && ancestors(element).includes(overview) && /이 전략으로 레이스/.test(html(element)));
  assert.ok(resultsAction, "the strategy overview should expose the race action");
  assert.ok(isVisible(resultsAction));
  assert.equal(attribute(resultsAction, "disabled"), null);
  assert.ok(resultsAction.end <= details.start, "opening analysis is not a prerequisite for viewing results");
});

test("workspace navigation remains available without loading the 3D replay on entry", () => {
  const navigation = byClass("strategy-workspaces");
  assert.ok(navigation && isVisible(navigation));
  assert.equal(navigation.tag, "nav");
  assert.ok(elements.some(element => element.tag === "button" && ancestors(element).includes(navigation)
    && /실제 경기 전략/.test(html(element))));
  assert.ok(elements.some(element => element.tag === "button" && ancestors(element).includes(navigation)
    && /레이스|리플레이/.test(html(element))));
  assert.equal([...loadedModules].some(filename => /[\\/]RaceReplay\.tsx$/.test(filename)), false,
    "the replay module must remain lazy until a replay workspace is opened");
  assert.doesNotMatch(markup, /class="replay-loading"/);
  assert.match(source, /pageView === "strategy" && workspace === "replay" &&/);
});
