import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { HISTORICAL_EVIDENCE, OBSERVED_TRACK_IDS, PIT_LOSS_EVIDENCE, PIT_LOSS_COVERAGE, getHistoricalCalibration, adoptHistoricalPitLoss, loadPitLossRawEvidence } from "../app/lib/historical-calibration.ts";
import { TRACK_PRESET_IDS, TRACK_PRESETS } from "../app/lib/strategy.ts";
import { MODEL_PARAMS } from "../app/model/params.ts";

test("24 circuits are checked, 23 have pit observations, and tyre coefficient coverage remains seven", () => {
  assert.deepEqual(PIT_LOSS_COVERAGE.map(row => row.trackId), TRACK_PRESET_IDS);
  assert.equal(PIT_LOSS_COVERAGE.filter(row => row.status === "observational-estimate").length, 23);
  assert.equal(OBSERVED_TRACK_IDS.length, 7);
  assert.equal(PIT_LOSS_EVIDENCE.summary.completedTracks, 24);
  const madrid = PIT_LOSS_COVERAGE.find(row => row.trackId === "madrid");
  assert.equal(madrid.status, "no-historical-event");
  assert.equal(madrid.medianSeconds, null);
  assert.equal(madrid.samples, 0);
  assert.deepEqual(madrid.events, []);
  assert.equal(getHistoricalCalibration("madrid").pitLossSeconds, undefined);
});

test("existing pooled seven-circuit estimates retain their larger sample and source records", () => {
  const original = HISTORICAL_EVIDENCE.pitLossCoverage.filter(row => row.status === "observational-estimate");
  assert.equal(original.length, 7);
  for (const row of original) {
    const selected = PIT_LOSS_COVERAGE.find(item => item.trackId === row.trackId);
    const single = PIT_LOSS_EVIDENCE.tracks.find(item => item.trackId === row.trackId);
    assert.equal(selected.sourceKind, "pooled-historical");
    assert.equal(selected.medianSeconds, row.medianSeconds);
    assert.equal(selected.samples, row.samples);
    assert.ok(selected.samples >= single.retainedSamples);
    assert.deepEqual(selected.events, row.events);
    assert.equal(selected.sourceUrls.length, row.events.length);
    assert.equal(selected.sourceDocument, "historical-dry-2023-2025.json");
    assert.equal(getHistoricalCalibration(row.trackId).coverage.observedPitLossSeconds, row.medianSeconds);
  }
});

test("new observations stay on their own circuit and expose selected year, fallback and units", () => {
  const added = PIT_LOSS_COVERAGE.filter(row => row.sourceKind === "single-historical-event");
  assert.equal(added.length, 16);
  for (const row of added) {
    const source = PIT_LOSS_EVIDENCE.tracks.find(item => item.trackId === row.trackId);
    assert.equal(row.sourceTrackId, row.trackId);
    assert.equal(row.samples, source.retainedSamples);
    assert.equal(row.medianSeconds, source.medianSeconds);
    assert.equal(row.selectedSeason, source.selectedSeason);
    assert.equal(row.fallbackReason, source.fallbackReason);
    assert.equal(row.unit, "seconds");
    assert.match(row.interpretation, /정차.*실측이 아님/);
    assert.match(row.sourceUrls[0], /^https:\/\/livetiming\.formula1\.com\/static\//);
  }
  const melbourne = added.find(row => row.trackId === "melbourne");
  assert.equal(melbourne.selectedSeason, 2024);
  assert.match(melbourne.fallbackReason, /2025: insufficient-samples/);
  assert.equal(PIT_LOSS_EVIDENCE.summary.fallbackTracks, 3, "raw collection fallback count is distinct from merged pooled source selection");
});

test("adoption uses the exact >=3-second boundary and never fills missing estimates", () => {
  const threshold = MODEL_PARAMS.historical.pitAdoptionDifferenceSeconds;
  const epsilon = MODEL_PARAMS.validation.toleranceSeconds;
  const preset = TRACK_PRESETS.melbourne.pitLossSeconds;
  assert.equal(adoptHistoricalPitLoss(preset + threshold, preset), preset + threshold);
  assert.equal(adoptHistoricalPitLoss(preset - threshold, preset), preset - threshold);
  assert.equal(adoptHistoricalPitLoss(preset + threshold - epsilon, preset), undefined);
  for (const missing of [null, undefined, NaN, Infinity, 0, -1]) assert.equal(adoptHistoricalPitLoss(missing, preset), undefined);
  for (const row of PIT_LOSS_COVERAGE) {
    assert.equal(getHistoricalCalibration(row.trackId).pitLossSeconds, adoptHistoricalPitLoss(row.medianSeconds, TRACK_PRESETS[row.trackId].pitLossSeconds));
  }
});

test("raw and compact sources agree, with raw samples loaded only on explicit request", async () => {
  const raw = await loadPitLossRawEvidence();
  const rawText = readFileSync(new URL("../app/data/pit-loss-evidence.json", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.equal(PIT_LOSS_EVIDENCE.sourceSha256, createHash("sha256").update(rawText).digest("hex"));
  assert.deepEqual(PIT_LOSS_EVIDENCE.summary, raw.summary);
  assert.equal(PIT_LOSS_EVIDENCE.tracks.length, raw.tracks.length);
  for (const row of PIT_LOSS_EVIDENCE.tracks) {
    const complete = raw.tracks.find(item => item.trackId === row.trackId);
    assert.equal(row.medianSeconds, complete.medianSeconds);
    assert.equal(row.retainedSamples, complete.retainedSamples);
    assert.equal(row.attempts.length, complete.attempts.length);
    row.attempts.forEach((attempt, index) => {
      const source = complete.attempts[index];
      assert.equal(attempt.status, source.status);
      assert.equal(attempt.pitLoss?.retainedSamples, source.pitLoss?.retainedSamples);
      assert.equal(attempt.pitLoss?.samples, undefined, "raw pairs must not be in hot-path metadata");
    });
  }
});
