import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const replaySource = readFileSync(
  new URL("../app/RaceReplay.tsx", import.meta.url),
  "utf8",
);

test("replay starts at 1x and retains all four playback rates", () => {
  assert.match(
    replaySource,
    /const \[playbackRate, setPlaybackRate\] = useState\(1\);/,
  );
  assert.match(
    replaySource,
    /const PLAYBACK_RATES = \[1, 10, 30, 60\] as const;/,
  );
});
