import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { publicAsset } from "../app/lib/public-assets.ts";

test("manual tyre selector uses the deployment base for all five bundled tyre images", () => {
  const source = readFileSync(new URL("../app/StrategyLab.tsx", import.meta.url), "utf8");
  // The helper alone can pass while a UI consumer still bypasses it.
  assert.match(source, /<img\s+src=\{publicAsset\(COMPOUND_IMAGES\[compound\]\)\}/);
  assert.doesNotMatch(source, /src=\{COMPOUND_IMAGES\[compound\]\}/);
  const paths = [...source.matchAll(/\"(\/ui\/tyres\/[^\"]+\.webp)\"/g)].map(match => match[1]);
  assert.equal(new Set(paths).size, 5);
  for (const path of paths) {
    const bytes = readFileSync(new URL(`../public${path}`, import.meta.url));
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF", path);
    assert.equal(bytes.toString("ascii", 8, 12), "WEBP", path);
    assert.ok(bytes.length > 100, path);
  }
});

test("assets work at root and at a GitHub Pages repository subpath", () => {
  const previous = process.env.NEXT_PUBLIC_BASE_PATH;
  try {
    delete process.env.NEXT_PUBLIC_BASE_PATH;
    assert.equal(publicAsset("/models/formula-car.glb"), "/models/formula-car.glb");
    process.env.NEXT_PUBLIC_BASE_PATH = "/compound/";
    for (const path of [
      "/models/formula-car.glb",
      "/cars/ferrari-sf26.webp",
      "/circuits/melbourne-2.svg",
      "/ui/tyres/hard.webp",
      "/ui/tyres/intermediate.webp",
      "/ui/tyres/medium.webp",
      "/ui/tyres/soft.webp",
      "/ui/tyres/wet.webp",
    ]) {
      assert.equal(publicAsset(path), `/compound${path}`);
    }
    assert.equal(publicAsset("https://example.com/car.webp"), "https://example.com/car.webp");
    assert.equal(publicAsset("//example.com/car.webp"), "//example.com/car.webp");
    assert.equal(publicAsset("#manual-strategy"), "#manual-strategy");
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
    else process.env.NEXT_PUBLIC_BASE_PATH = previous;
  }
});
