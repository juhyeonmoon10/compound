import test from "node:test";
import assert from "node:assert/strict";
import {
  FASTF1_ANALYSIS_SUMMARY,
  FASTF1_TYRE_ANALYSES,
  HISTORICAL_TYRE_CALIBRATIONS,
  analysisForTrack,
  historicalCalibrationForTrack,
} from "../app/lib/tyre-analysis.ts";
import {
  TRACK_PRESETS,
  optimizeTyreStrategies,
} from "../app/lib/strategy.ts";

const CALIBRATED_TRACKS = [
  "bahrain",
  "barcelona",
  "spielberg",
  "hungaroring",
  "monza",
];

test("five real race aggregates expose a shared auditable funnel", () => {
  assert.equal(FASTF1_TYRE_ANALYSES.length, 5);
  assert.equal(FASTF1_ANALYSIS_SUMMARY.races, 5);
  assert.equal(FASTF1_ANALYSIS_SUMMARY.rawLaps, 5799);
  assert.equal(FASTF1_ANALYSIS_SUMMARY.modelLaps, 4958);
  assert.equal(FASTF1_ANALYSIS_SUMMARY.stints, 254);
  assert.equal(FASTF1_ANALYSIS_SUMMARY.learnedCoefficients, 11);

  for (const analysis of FASTF1_TYRE_ANALYSES) {
    assert.equal(
      analysis.classification,
      "processed-fastf1-aggregate",
    );
    assert.equal(analysis.isLive, false);
    assert.equal(analysis.methodology.quickLapFilterUsed, false);
    assert.equal(analysis.methodology.randomLapSplitUsed, false);
    assert.equal(analysis.funnel[0].remaining, analysis.summary.rawLaps);
    assert.equal(
      analysis.funnel.at(-1).remaining,
      analysis.summary.modelLaps,
    );
    assert.ok(analysis.validation.trainLaps > 0);
    assert.ok(analysis.validation.testLaps > 0);

    for (let index = 1; index < analysis.funnel.length; index += 1) {
      assert.ok(
        analysis.funnel[index].remaining <=
          analysis.funnel[index - 1].remaining,
      );
    }
  }
});

test("calibration lookup is strictly scoped to analysed circuits", () => {
  assert.deepEqual(
    HISTORICAL_TYRE_CALIBRATIONS.map(
      (calibration) => calibration.applicableTrackId,
    ),
    CALIBRATED_TRACKS,
  );

  for (const trackId of CALIBRATED_TRACKS) {
    assert.equal(analysisForTrack(trackId)?.trackId, trackId);
    assert.equal(
      historicalCalibrationForTrack(trackId)?.applicableTrackId,
      trackId,
    );
  }

  assert.equal(analysisForTrack("melbourne"), null);
  assert.equal(historicalCalibrationForTrack("melbourne"), null);
});

test("only statistically supported compound slopes enter each calibration", () => {
  for (const analysis of FASTF1_TYRE_ANALYSES) {
    const calibration = historicalCalibrationForTrack(analysis.trackId);
    assert.ok(calibration);

    for (const coefficient of analysis.coefficients) {
      if (coefficient.decision === "learned") {
        assert.ok(coefficient.alphaSecondsPerLap > 0);
        assert.ok(coefficient.ci95Low > 0);
        assert.equal(
          calibration.compoundModels[coefficient.compound].alpha,
          coefficient.alphaSecondsPerLap,
        );
      } else {
        assert.equal(
          calibration.compoundModels[coefficient.compound],
          undefined,
        );
        assert.ok(
          calibration.fallbackCompounds.includes(coefficient.compound),
        );
      }
    }
  }
});

test("the same model detects high Bahrain and low Monza degradation", () => {
  const bahrainHard = analysisForTrack("bahrain").coefficients.find(
    (coefficient) => coefficient.compound === "H",
  );
  const monzaHard = analysisForTrack("monza").coefficients.find(
    (coefficient) => coefficient.compound === "H",
  );

  assert.equal(bahrainHard.decision, "learned");
  assert.equal(monzaHard.decision, "learned");
  assert.ok(
    bahrainHard.alphaSecondsPerLap >
      monzaHard.alphaSecondsPerLap * 7,
  );
});

test("every learned hybrid calibration plugs into the existing DP engine", () => {
  for (const calibration of HISTORICAL_TYRE_CALIBRATIONS) {
    const trackId = calibration.applicableTrackId;
    const preset = TRACK_PRESETS[trackId];
    const compoundModel = (compound) => ({
      alpha:
        calibration.compoundModels[compound]?.alpha ??
        preset.compounds[compound].alpha,
      beta:
        calibration.compoundModels[compound]?.beta ??
        preset.compounds[compound].beta,
    });
    const results = optimizeTyreStrategies({
      track: trackId,
      compoundModels: {
        S: compoundModel("S"),
        M: compoundModel("M"),
        H: compoundModel("H"),
      },
      topK: 3,
    });

    assert.equal(results.length, 3);
    assert.ok(results.every((strategy) => strategy.isLegal));
    assert.ok(
      results.every((strategy) =>
        strategy.lapCosts.every((lap) =>
          Number.isFinite(lap.lapTimeSeconds),
        ),
      ),
    );
  }
});
