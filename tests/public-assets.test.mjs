import test from "node:test";
import assert from "node:assert/strict";
import { publicAsset } from "../app/lib/public-assets.ts";

test("assets work at root and at a GitHub Pages repository subpath", () => {
  const previous = process.env.NEXT_PUBLIC_BASE_PATH;
  try {
    delete process.env.NEXT_PUBLIC_BASE_PATH;
    assert.equal(publicAsset("/models/formula-car.glb"), "/models/formula-car.glb");
    process.env.NEXT_PUBLIC_BASE_PATH = "/compound/";
    for (const path of ["/models/formula-car.glb", "/cars/ferrari-sf26.webp", "/circuits/melbourne-2.svg", "/ui/tyre-compound-icon.png"]) {
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
