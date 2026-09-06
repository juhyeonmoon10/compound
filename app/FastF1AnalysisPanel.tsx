"use client";

import { uiLabel } from "./ui-labels";
import { TYRE_COLORS } from "./model/params";

import { useMemo, useState, type CSSProperties } from "react";
import {
  FASTF1_ANALYSIS_SUMMARY,
  FASTF1_TYRE_ANALYSES,
  historicalCalibrationForTrack,
  type FastF1TyreAnalysis,
} from "./lib/tyre-analysis";
import type { TrackPresetId } from "./lib/strategy";

const COMPOUND_COLORS = TYRE_COLORS;

const SLOPE_CHART_MAX = 0.15;

function formatSigned(value: number, digits = 4) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(digits)}`;
}

function compactNumber(value: number) {
  return value.toLocaleString("ko-KR");
}

function SlopeChart({
  analysis,
}: {
  analysis: FastF1TyreAnalysis;
}) {
  const ticks = [0, 0.05, 0.1, 0.15];

  return (
    <div className="fastf1-slope-chart">
      <div className="fastf1-slope-chart__scale" aria-hidden="true">
        {ticks.map((tick) => (
          <span
            key={tick}
            style={{ left: `${(tick / SLOPE_CHART_MAX) * 100}%` }}
          >
            {tick.toFixed(2)}
          </span>
        ))}
      </div>
      <div className="fastf1-slope-chart__plot">
        {analysis.coefficients.map((estimate) => {
          const displaySlope =
            estimate.decision === "learned"
              ? Math.max(0, estimate.alphaSecondsPerLap)
              : 0;
          const width = Math.min(
            100,
            (displaySlope / SLOPE_CHART_MAX) * 100,
          );
          return (
            <div className="fastf1-slope-row" key={estimate.compound}>
              <span
                className={`compound compound--${estimate.compound.toLowerCase()}`}
              >
                {estimate.compound}
              </span>
              <div className="fastf1-slope-row__track">
                {estimate.decision === "learned" ? (
                  <span
                    className="fastf1-slope-row__bar"
                    style={
                      {
                        "--slope-width": `${Math.max(2, width)}%`,
                        "--slope-color":
                          COMPOUND_COLORS[estimate.compound],
                      } as CSSProperties
                    }
                  />
                ) : (
                  <span className="fastf1-slope-row__fallback">
                    표본 기준 미달
                  </span>
                )}
              </div>
              <div className="fastf1-slope-row__value">
                <strong>
                  {estimate.decision === "learned"
                    ? estimate.alphaSecondsPerLap.toFixed(4)
                    : "가정값"}
                </strong>
                <small>
                  {estimate.decision === "learned"
                    ? `95% ${estimate.ci95Low.toFixed(4)}–${estimate.ci95High.toFixed(4)}`
                    : `${estimate.laps}랩 · ${estimate.stints}스틴트`}
                </small>
              </div>
            </div>
          );
        })}
      </div>
      <p className="fastf1-chart__note">
        막대는 회귀로 추정한 랩당 페이스 저하량(초/랩)입니다. 신뢰 기준을
        통과하지 못한 컴파운드는 막대를 그리지 않고 가정값을
        사용합니다.
      </p>
    </div>
  );
}

export default function FastF1AnalysisPanel({
  appliedTrackId,
  isApplied,
  onApply,
}: {
  appliedTrackId: TrackPresetId;
  isApplied: boolean;
  onApply: (trackId: TrackPresetId) => void;
}) {
  const initialAnalysis =
    FASTF1_TYRE_ANALYSES.find(
      (analysis) => analysis.trackId === appliedTrackId,
    ) ??
    FASTF1_TYRE_ANALYSES.find(
      (analysis) => analysis.trackId === "spielberg",
    ) ??
    FASTF1_TYRE_ANALYSES[0];
  const [selectedAnalysisId, setSelectedAnalysisId] = useState(
    initialAnalysis.id,
  );
  const selected =
    FASTF1_TYRE_ANALYSES.find(
      (analysis) => analysis.id === selectedAnalysisId,
    ) ?? initialAnalysis;
  const calibration = historicalCalibrationForTrack(selected.trackId);
  const selectedIsApplied =
    isApplied && appliedTrackId === selected.trackId;
  const learnedCount = selected.coefficients.filter(
    (estimate) => estimate.decision === "learned",
  ).length;
  const comparisonRange = useMemo(() => {
    const learned = FASTF1_TYRE_ANALYSES.flatMap((analysis) =>
      analysis.coefficients.filter(
        (estimate) => estimate.decision === "learned",
      ),
    );
    return {
      min: Math.min(
        ...learned.map((estimate) => estimate.alphaSecondsPerLap),
      ),
      max: Math.max(
        ...learned.map((estimate) => estimate.alphaSecondsPerLap),
      ),
    };
  }, []);

  return (
    <>
      <div className="section-heading">
        <div>
          <p className="eyebrow">02 · FastF1 다중 경기 분석</p>
          <h2 id="data-analysis-title">
            한 경기의 우연이 아닌지 비교했습니다
          </h2>
        </div>
        <p>
          2025년 건식 레이스 5개를 같은 정제식과 같은 회귀식으로
          분석했습니다. 고열화 바레인부터 저열화 몬차까지 비교하고,
          신뢰 기준을 통과한 계수만 해당 서킷의 전략 계산에 넣습니다.
        </p>
      </div>

      <div className="fastf1-study-summary" aria-label="다중 레이스 분석 요약">
        <div>
          <span>분석 레이스</span>
          <strong>{FASTF1_ANALYSIS_SUMMARY.races}</strong>
          <small>2025 건식 경기 · 관측</small>
        </div>
        <div>
          <span>원본 기록 랩</span>
          <strong>{compactNumber(FASTF1_ANALYSIS_SUMMARY.rawLaps)}</strong>
          <small>FastF1 공개 랩 기록 · 실측</small>
        </div>
        <div>
          <span>최종 모델 랩</span>
          <strong>{compactNumber(FASTF1_ANALYSIS_SUMMARY.modelLaps)}</strong>
          <small>동일 정제식 통과</small>
        </div>
        <div>
          <span>분석 스틴트</span>
          <strong>{compactNumber(FASTF1_ANALYSIS_SUMMARY.stints)}</strong>
          <small>드라이버×스틴트</small>
        </div>
        <div>
          <span>적용 계수</span>
          <strong>{FASTF1_ANALYSIS_SUMMARY.learnedCoefficients}/15</strong>
          <small>나머지는 가정값 사용</small>
        </div>
      </div>

      <div
        className="fastf1-event-tabs"
        role="tablist"
        aria-label="분석할 레이스 선택"
      >
        {FASTF1_TYRE_ANALYSES.map((analysis) => {
          const active = analysis.id === selected.id;
          const learned = analysis.coefficients.filter(
            (estimate) => estimate.decision === "learned",
          );
          return (
            <button
              type="button"
              role="tab"
              aria-selected={active}
              className={active ? "is-active" : undefined}
              key={analysis.id}
              onClick={() => setSelectedAnalysisId(analysis.id)}
            >
              <span>{uiLabel(analysis.title.replace("2025 ", ""))}</span>
              <strong>{analysis.profile}</strong>
              <small>
                {learned.map((estimate) => estimate.compound).join("·") ||
                  "보정 없음"}{" "}
                추정 오차 · MAE {analysis.validation.maeSeconds.toFixed(3)}초
              </small>
            </button>
          );
        })}
      </div>

      <div className="fastf1-comparison-callout">
        <span>실측 기반 추정 범위</span>
        <strong>
          {comparisonRange.min.toFixed(4)}–{comparisonRange.max.toFixed(4)}
          초/랩
        </strong>
        <p>
          같은 공식으로도 몬차 하드와 바레인 하드의 학습 기울기가 약{" "}
          {(comparisonRange.max / comparisonRange.min).toFixed(1)}배
          달랐습니다. 따라서 하나의 고정 열화값을 모든 서킷에
          적용하지 않습니다.
        </p>
      </div>

      <div className="fastf1-source-strip">
        <div>
          <span className="fastf1-source-strip__badge">
            실측 자료 {FASTF1_TYRE_ANALYSES.indexOf(selected) + 1}/
            {FASTF1_TYRE_ANALYSES.length}
          </span>
          <strong>{uiLabel(selected.title)} · 결승</strong>
          <small>
            {selected.source.library} ·{" "}
            {uiLabel(selected.source.compoundAllocation)} · 수집{" "}
            {selected.source.retrievedAt}
          </small>
        </div>
        <p>{uiLabel(selected.studyRole)}</p>
      </div>

      <ol className="fastf1-funnel" aria-label="랩 데이터 정제 과정">
        {selected.funnel.map((stage, index) => (
          <li key={stage.key}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{stage.remaining.toLocaleString()}랩</strong>
            <small>{stage.label}</small>
            <em>
              {index === 0
                ? "원본 세션"
                : `이 단계에서 −${stage.excluded.toLocaleString()}`}
            </em>
          </li>
        ))}
      </ol>

      <div className="fastf1-analysis-grid">
        <article className="fastf1-panel fastf1-panel--chart">
          <header>
            <div>
              <span className="detail-label">실측 기반 열화 추정</span>
              <h3>컴파운드별 관측 페이스 저하율</h3>
            </div>
            <b>
              {selected.summary.drivers}명 ·{" "}
              {selected.summary.stints}스틴트
            </b>
          </header>
          <SlopeChart analysis={selected} />
        </article>

        <aside className="fastf1-panel fastf1-validation">
          <span className="detail-label">시간순 분리 검증</span>
          <h3>미래 랩을 미리 보지 않았습니다</h3>
          <p>{selected.methodology.validation}</p>
          <div className="fastf1-validation__metrics">
            <div>
              <span>평균 절대 오차</span>
              <strong>{selected.validation.maeSeconds.toFixed(3)}</strong>
              <small>초 / 랩</small>
            </div>
            <div>
              <span>제곱평균제곱근 오차</span>
              <strong>{selected.validation.rmseSeconds.toFixed(3)}</strong>
              <small>초 / 랩</small>
            </div>
          </div>
          <div className="fastf1-validation__split">
            <div>
              <span>학습</span>
              <strong>{selected.validation.trainLaps}랩</strong>
            </div>
            <div>
              <span>검증</span>
              <strong>{selected.validation.testLaps}랩</strong>
            </div>
          </div>
          <p className="fastf1-validation__note">
            무작위 분할을 쓰지 않아 같은 스틴트의 미래 정보가 학습
            데이터로 섞이는 문제를 줄였습니다. MAE는 모델 선택 기준이
            아니라 예측 오차의 투명한 보고값입니다.
          </p>
        </aside>
      </div>

      <article className="fastf1-panel fastf1-coefficients">
        <header>
          <div>
            <span className="detail-label">회귀 추정 계수</span>
            <h3>확실한 값만 전략 계산에 사용</h3>
          </div>
          <code>{selected.methodology.formula}</code>
        </header>
        <div className="table-scroll">
          <table>
            <caption className="sr-only">
              {uiLabel(selected.title)} 컴파운드별 열화 효과 추정치
            </caption>
            <thead>
              <tr>
                <th>타이어</th>
                <th>표본</th>
                <th>관측 열화 효과</th>
                <th>95% 신뢰구간</th>
                <th>전략 적용</th>
              </tr>
            </thead>
            <tbody>
              {selected.coefficients.map((estimate) => (
                <tr key={estimate.compound}>
                  <td>
                    <span
                      className={`compound compound--${estimate.compound.toLowerCase()}`}
                    >
                      {estimate.compound}
                    </span>
                    <strong>
                      {estimate.absoluteCompound} {uiLabel(estimate.label)}
                    </strong>
                  </td>
                  <td>
                    {estimate.laps}랩 · {estimate.stints}스틴트
                  </td>
                  <td>
                    {formatSigned(estimate.alphaSecondsPerLap)}초/랩
                  </td>
                  <td>
                    {formatSigned(estimate.ci95Low)} –{" "}
                    {formatSigned(estimate.ci95High)}
                  </td>
                  <td>
                    <span
                      className={`calibration-decision calibration-decision--${estimate.decision}`}
                    >
                      {estimate.decision === "learned"
                        ? "실측 기반 추정값 사용"
                        : "가정값 유지"}
                    </span>
                    <small>{uiLabel(estimate.decisionReason)}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <div className="fastf1-apply-card">
        <div>
          <span className="detail-label">해당 서킷에만 보정</span>
          <h3>
            {uiLabel(selected.circuit)}에서만 선택 적용 · {learnedCount}/3 계수
          </h3>
          <p>{uiLabel(calibration?.note ?? "")}</p>
        </div>
        <button
          type="button"
          className="fastf1-apply-button"
          onClick={() => onApply(selected.trackId)}
          aria-pressed={selectedIsApplied}
        >
          {selectedIsApplied
            ? "적용됨 · 전략 화면 보기"
            : `${uiLabel(selected.title.replace("2025 ", ""))} 보정 적용`}
          <span aria-hidden="true">→</span>
        </button>
      </div>

      <div className="fastf1-caveat">
        <div>
          <span aria-hidden="true">!</span>
          <strong>이 수치가 말해 주는 범위</strong>
        </div>
        <ul>
          {selected.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      </div>

      <div className="fastf1-sources">
        <span>자료 및 방법</span>
        <a
          href={selected.source.documentationUrl}
          target="_blank"
          rel="noreferrer"
        >
          FastF1 문서 ↗
        </a>
        <a
          href={selected.source.compoundSourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          피렐리 배정·특성 ↗
        </a>
        <a
          href={selected.source.raceSourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          공식 경기 자료 ↗
        </a>
        <a
          href={selected.source.researchUrl}
          target="_blank"
          rel="noreferrer"
        >
          열화 추정 연구 ↗
        </a>
      </div>
    </>
  );
}
