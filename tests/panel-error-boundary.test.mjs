import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url), ts = require("typescript");
const url = new URL("../app/PanelErrorBoundary.tsx", import.meta.url);
let compiled = ts.transpileModule(readFileSync(url, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText.replace(/import "\.\/panel-error-boundary.css";/, "");
for (const name of ["react", "react/jsx-runtime"]) {
  compiled = compiled.replaceAll(`from "${name}"`, `from ${JSON.stringify(pathToFileURL(require.resolve(name)).href)}`);
}
const { default: PanelErrorBoundary } = await import(`data:text/javascript,${encodeURIComponent(compiled)}`);

test("panel boundary returns its children unchanged while healthy", () => {
  const child = createElement("div", null, "관측 데이터");
  const boundary = new PanelErrorBoundary({ label: "관측 자료", children: child });
  assert.equal(boundary.state.failed, false);
  assert.equal(boundary.render(), child);
  assert.equal(renderToStaticMarkup(createElement(PanelErrorBoundary, { label: "관측 자료" }, child)), "<div>관측 데이터</div>");
});

test("chunk and render errors produce an accessible local fallback with honest reload warning", () => {
  for (const error of [new TypeError("Failed to fetch dynamically imported module"), new Error("render failed")]) {
    const boundary = new PanelErrorBoundary({ label: "계산 검증", children: createElement("div", null, "broken") });
    boundary.state = PanelErrorBoundary.getDerivedStateFromError(error);
    assert.deepEqual(boundary.state, { failed: true });
    const html = renderToStaticMarkup(boundary.render());
    assert.match(html, /role="alert"/);
    assert.match(html, /계산 검증 불러오기에 실패했습니다/);
    assert.match(html, /다른 탭은 계속 사용할 수 있습니다/);
    assert.match(html, /저장하지 않은 조건과 전략 입력이 초기화됩니다/);
    assert.match(html, /페이지 새로고침/);
    assert.doesNotMatch(html, /broken|Failed to fetch|render failed/);
  }
});

test("failure remains panel-local and does not mutate a sibling boundary", () => {
  const healthyChild = createElement("div", null, "직접 만든 전략 유지");
  const failed = new PanelErrorBoundary({ label: "관측 자료", children: null });
  const healthy = new PanelErrorBoundary({ label: "주행", children: healthyChild });
  failed.state = PanelErrorBoundary.getDerivedStateFromError(new Error("chunk missing"));
  assert.equal(failed.state.failed, true);
  assert.equal(healthy.state.failed, false);
  assert.equal(healthy.render(), healthyChild);
});

test("error rendering never auto-reloads; only the explicit button reloads once per click", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let reloads = 0;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { reload() { reloads += 1; } } },
  });
  try {
    const boundary = new PanelErrorBoundary({ label: "주행 화면", children: null });
    boundary.state = PanelErrorBoundary.getDerivedStateFromError(new Error("missing chunk"));
    const view = boundary.render();
    renderToStaticMarkup(view);
    boundary.render();
    assert.equal(reloads, 0);
    const button = view.props.children.find(child => child.type === "button");
    assert.ok(button);
    assert.equal(button.props.type, "button");
    button.props.onClick();
    assert.equal(reloads, 1);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
  }
});
