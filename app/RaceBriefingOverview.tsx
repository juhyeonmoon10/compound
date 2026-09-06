"use client";

import { useId, type CSSProperties } from "react";
import { MODEL_PARAMS, TYRE_COLORS, TYRE_LABELS } from "./model/params";
import "./strategy-board.css";
import { circuitLayoutUrl } from "./lib/circuit-layouts";
import { uiLabel } from "./ui-labels";
import { publicAsset } from "./lib/public-assets";
import type {
  DriverProfile,
  TeamProfile,
} from "./lib/participants";
import type {
  StrategyResult,
  TrackPreset,
} from "./lib/strategy";
import type { RaceTrafficLevel } from "./RaceReplay";
import type { StrategyPitWindow } from "./lib/pit-windows";

export type { StrategyPitWindow } from "./lib/pit-windows";

export type StrategyWorkspace = "board" | "manual" | "detail" | "replay" | "notebook";
const WORKSPACES: readonly { id: StrategyWorkspace; label: string; number: string }[] = [
  { id: "board", label: "추천 전략", number: "01" },
  { id: "manual", label: "직접 설계", number: "02" },
  { id: "detail", label: "상세 분석", number: "03" },
  { id: "replay", label: "3D 리플레이", number: "04" },
  { id: "notebook", label: "실험 노트", number: "05" },
];

const TRAFFIC_LABELS: Readonly<Record<RaceTrafficLevel, string>> = {
  low: "적음", medium: "보통", high: "많음",
};

type BoardCompound = keyof typeof TYRE_COLORS;

function strategySequence(strategy: StrategyResult): string {
  return strategy.stints.map((stint) => TYRE_LABELS[stint.compound]).join(" → ");
}

function formatDelta(seconds: number): string {
  return `${seconds > 0 ? "+" : seconds < 0 ? "−" : ""}${Math.abs(seconds).toFixed(3)}초`;
}

/** Pixel geometry is expressed in the user's 1500 × 844 reference coordinates. */
export function strategyBoardRowGeometry(
  strategy: Pick<StrategyResult, "stints">,
  pitWindows: readonly StrategyPitWindow[],
  totalLaps: number,
  rowIndex: number,
) {
  if (!Number.isInteger(totalLaps) || totalLaps < 1 || !Number.isInteger(rowIndex) || rowIndex < 0) {
    throw new RangeError("Board geometry requires positive laps and a non-negative row index.");
  }
  const board = MODEL_PARAMS.board;
  const y = board.firstRowY + rowIndex * board.rowGap;
  const lapToX = (lap: number) => board.lineStart + (lap / totalLaps) * (board.lineEnd - board.lineStart);
  const pits = strategy.stints.slice(0, -1).map((stint, index) => {
    const window = pitWindows[index];
    const startLap = Math.max(1, Math.min(totalLaps, window?.startLap ?? stint.endLap));
    const endLap = Math.max(startLap, Math.min(totalLaps, window?.endLap ?? stint.endLap));
    const midpointLap = (startLap + endLap) / 2;
    const x = lapToX(midpointLap);
    const text = startLap === endLap ? `${startLap}랩` : `${startLap} ~ ${endLap}랩`;
    const estimatedTextWidth = text.length * board.windowFont / 2;
    const leftX = x - board.pitWheel / 2 - board.windowGap;
    const placeRight = leftX - estimatedTextWidth < board.lineStart;
    return {
      compound: stint.compound,
      nextCompound: strategy.stints[index + 1].compound,
      x, y, startLap, endLap, midpointLap, text,
      labelX: placeRight ? x + board.pitWheel / 2 + board.windowGap : leftX,
      labelY: y - board.windowGap,
      labelAnchor: placeRight ? "start" as const : "end" as const,
      estimatedTextWidth,
    };
  });
  for (let index = 1; index < pits.length; index += 1) {
    const current = pits[index];
    const previous = pits[index - 1];
    const currentLeft = current.labelAnchor === "end" ? current.labelX - current.estimatedTextWidth : current.labelX;
    const previousRight = previous.labelAnchor === "end" ? previous.labelX : previous.labelX + previous.estimatedTextWidth;
    if (currentLeft < previousRight + board.windowGap || currentLeft < previous.x + board.pitWheel / 2 + board.windowGap) {
      current.labelY = y + board.pitWheel / 2 + board.windowGap + board.windowFont;
    }
  }
  const boundaries = [board.lineStart, ...pits.map((pit) => pit.x), board.lineEnd];
  return {
    y,
    pits,
    segments: strategy.stints.map((stint, index) => ({
      compound: stint.compound, color: TYRE_COLORS[stint.compound],
      startX: boundaries[index], endX: boundaries[index + 1],
    })),
    finishX: board.finishX,
    finalCompound: strategy.stints.at(-1)?.compound ?? "H" as BoardCompound,
  };
}

function BoardTyre({ compound, x, y, size, clipId }: {
  compound: BoardCompound; x: number; y: number; size: number; clipId: string;
}) {
  return <g aria-hidden="true" className="strategy-board-tyre" data-compound={compound}>
    <image href={publicAsset("/ui/tyre-compound-icon.png")} x={x - size / 2} y={y - size / 2} width={size} height={size}
      preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clipId})`} />
    <circle cx={x} cy={y} r={(size - MODEL_PARAMS.board.lineWidth) / 2} fill="none"
      stroke={TYRE_COLORS[compound]} strokeWidth={MODEL_PARAMS.board.lineWidth} />
  </g>;
}

function StrategyBoardGraphic({ track, results, pitWindows, selectedRank, topThreeActive, pitLossSeconds, pitSource, onSelectStrategy }: {
  track: TrackPreset; results: readonly StrategyResult[]; pitWindows: readonly (readonly StrategyPitWindow[])[];
  selectedRank: number; topThreeActive: boolean; pitLossSeconds: number; onSelectStrategy: (index: number) => void;
  pitSource: string;
}) {
  const id = useId().replaceAll(":", "");
  const board = MODEL_PARAMS.board;
  const clipId = `${id}-tyre-clip`;
  const rows = results.slice(0, 3).map((strategy, index) => ({
    strategy, geometry: strategyBoardRowGeometry(strategy, pitWindows[index] ?? [], track.laps, index),
  }));
  const legend: readonly BoardCompound[] = ["H", "M", "S", "INTER", "WET"];
  return <section className="strategy-board" aria-labelledby="briefing-board-title">
    <h2 className="sr-only" id="briefing-board-title">{track.koreanName} 추천 타이어 전략</h2>
    <p className="sr-only">타이어 범례: {legend.map((compound) => TYRE_LABELS[compound]).join(", ")}.</p>
    <p className="strategy-board__scroll-note">전략선을 눌러 선택하세요. 작은 화면에서는 좌우로 움직여 전체 구간을 볼 수 있습니다.</p>
    <div className="strategy-board__scroll" tabIndex={0} role="region" aria-label="타이어 전략 차트, 좌우 스크롤 가능">
      <div className="strategy-board__canvas" style={{
        "--board-width": board.width, "--board-height": board.height,
        aspectRatio: `${board.width} / ${board.height}`,
      } as CSSProperties}>
        <svg viewBox={`0 0 ${board.width} ${board.height}`} className="strategy-board__svg" aria-hidden="true">
          <defs>
            <clipPath id={clipId} clipPathUnits="objectBoundingBox"><circle cx=".5" cy=".5" r=".5" /></clipPath>
            {rows.flatMap(({ geometry }, rowIndex) => geometry.pits.map((pit, pitIndex) => (
              <linearGradient id={`${id}-fade-${rowIndex}-${pitIndex}`} key={`${rowIndex}-${pitIndex}`} gradientUnits="userSpaceOnUse"
                x1={pit.x - board.fadeWidth / 2} x2={pit.x + board.fadeWidth / 2}>
                <stop offset="0%" stopColor={TYRE_COLORS[pit.compound]} />
                <stop offset="50%" stopColor="#030507" />
                <stop offset="100%" stopColor={TYRE_COLORS[pit.nextCompound]} />
              </linearGradient>
            )))}
          </defs>
          <text x={board.lineStart} y={board.headerY} fontSize={board.headerFont} className="strategy-board__eyebrow"><tspan fontWeight="800">{uiLabel(track.country)}</tspan> | F1 그랑프리 · {track.koreanName} · {track.laps}랩</text>
          <text x={board.lineStart} y={board.titleY} fontSize={board.titleFont} className="strategy-board__title">{track.koreanName} | 추천 타이어 전략</text>
          <text x={board.width - board.lineStart} y={board.titleY} textAnchor="end" fontSize={board.brandFont} className="strategy-board__brand">compound</text>
          <line x1={board.lineStart} x2={board.width - board.lineStart} y1={board.headerRuleY} y2={board.headerRuleY} className="strategy-board__rule" />
          {rows.map(({ strategy, geometry }, rowIndex) => <g key={strategy.signature} data-strategy-index={rowIndex}>
            {geometry.segments.map((segment, index) => <line key={index} x1={segment.startX} x2={segment.endX} y1={geometry.y} y2={geometry.y} stroke={segment.color} strokeWidth={board.lineWidth} />)}
            {geometry.pits.map((pit, pitIndex) => <g key={pitIndex}>
              <line x1={Math.max(board.lineStart, pit.x - board.fadeWidth / 2)} x2={Math.min(board.lineEnd, pit.x + board.fadeWidth / 2)}
                y1={geometry.y} y2={geometry.y} stroke={`url(#${id}-fade-${rowIndex}-${pitIndex})`} strokeWidth={board.lineWidth} />
              <text x={pit.labelX} y={pit.labelY} textAnchor={pit.labelAnchor} fontSize={board.windowFont} className="strategy-board__window"><tspan fontWeight="800">{pit.startLap}</tspan>{pit.startLap !== pit.endLap && <> ~ <tspan fontWeight="800">{pit.endLap}</tspan></>}랩</text>
              <BoardTyre compound={pit.compound} x={pit.x} y={geometry.y} size={board.pitWheel} clipId={clipId} />
            </g>)}
            <text x={board.finishX - board.pitWheel / 2 - board.stopLabelGap} y={geometry.y - board.windowGap} textAnchor="end" fontSize={board.windowFont} className="strategy-board__stop-label">{strategy.stopCount}스톱</text>
            <BoardTyre compound={geometry.finalCompound} x={board.finishX} y={geometry.y} size={board.pitWheel} clipId={clipId} />
          </g>)}
          <text x={board.lineStart} y={board.dividerY - board.windowGap} fontSize={board.footerFont} className="strategy-board__note">교체 구간은 각 전략의 민감도 추정치이며, 실제 경기 예보가 아닙니다.</text>
          <line x1={board.lineStart} x2={board.width - board.lineStart} y1={board.dividerY} y2={board.dividerY} className="strategy-board__rule" />
          {legend.map((compound, index) => {
            const x = board.legendStart + index * board.legendStep;
            const labelX = x + board.legendWheel + board.windowGap;
            return <g key={compound} data-legend-compound={compound}>
              <BoardTyre compound={compound} x={x + board.legendWheel / 2} y={board.legendY} size={board.legendWheel} clipId={clipId} />
              <text x={labelX} y={board.legendY - board.windowGap / 2} fontSize={compound === "INTER" ? board.footerFont : board.legendLabelFont} fill={TYRE_COLORS[compound]} className="strategy-board__legend-name">{TYRE_LABELS[compound]}</text>
              <text x={labelX} y={board.legendY + board.windowFont} fontSize={board.windowFont} fill={TYRE_COLORS[compound]} className="strategy-board__legend-code">{compound === "INTER" ? "I" : compound === "WET" ? "W" : compound}</text>
            </g>;
          })}
          <text x={board.factsX} y={board.legendY - board.windowGap} fontSize={board.footerFont} className="strategy-board__fact-label">피트 손실 · {pitSource}</text>
          <text x={board.factsX} y={board.legendY + board.windowFont} fontSize={board.brandFont} className="strategy-board__fact-value">{pitLossSeconds.toFixed(1)}초</text>
          <image href={circuitLayoutUrl(track.id)} x={board.trackFactX} y={board.legendY - board.legendWheel / 2}
            width={board.width - board.lineStart - board.trackFactX - board.legendWheel} height={board.legendWheel} className="strategy-board__track-map" />
          <text x={board.width - board.lineStart} y={board.legendY + board.windowFont} textAnchor="end" fontSize={board.legendLabelFont} className="strategy-board__fact-value">{track.laps}랩</text>
        </svg>
        {rows.map(({ strategy, geometry }, index) => <button type="button" key={strategy.signature}
          className="strategy-board__row-hit" aria-pressed={topThreeActive && selectedRank === index}
          aria-label={`전략 ${index + 1}, ${strategySequence(strategy)}, ${strategy.stopCount}회 교체, 피트 ${geometry.pits.map((pit) => `${pit.startLap}랩부터 ${pit.endLap}랩`).join(', ') || '없음'}`}
          style={{ left: `${(board.lineStart - board.selectionPadding) / board.width * 100}%`,
            right: `${(board.width - board.finishX - board.pitWheel / 2 - board.selectionPadding) / board.width * 100}%`,
            top: `${(geometry.y - board.rowGap / 2) / board.height * 100}%`,
            height: `${board.rowGap / board.height * 100}%` }}
          onClick={() => onSelectStrategy(index)}><span className="sr-only">전략 {index + 1} 선택</span></button>)}
      </div>
    </div>
    <div className="strategy-board__mobile-options" role="group" aria-label="전략 선택">
      {rows.map(({ strategy }, index) => <button type="button" key={strategy.signature}
        aria-pressed={topThreeActive && selectedRank === index} onClick={() => onSelectStrategy(index)}>
        <strong>전략 {index + 1}</strong><span>{strategySequence(strategy)}</span><small>{strategy.stopCount}회 교체</small>
      </button>)}
    </div>
  </section>;
}

export interface RaceBriefingOverviewProps {
  readonly track: TrackPreset;
  readonly team: TeamProfile;
  readonly driver: DriverProfile;
  readonly trackTemperatureC: number;
  readonly startingGridPosition: number;
  readonly trafficLevel: RaceTrafficLevel;
  readonly maxStops: number;
  readonly pitLossSeconds: number;
  readonly modelSource: "project" | "fastf1-2025";
  readonly results: readonly StrategyResult[];
  readonly pitWindows: readonly (readonly StrategyPitWindow[])[];
  readonly selectedRank: number;
  readonly topThreeActive: boolean;
  readonly onOpenSetup: () => void;
  readonly onSelectStrategy: (index: number) => void;
  readonly onOpenManual: () => void;
  readonly onOpenReplay: () => void;
  readonly workspace: StrategyWorkspace;
  readonly onWorkspaceChange: (view: StrategyWorkspace) => void;
  readonly weatherSummary?: string;
  readonly pitSource?: string;
  readonly modelSummary?: string;
  readonly ruleExplanation?: string;
  readonly performanceSummary?: string;
}

export default function RaceBriefingOverview({
  track,
  team,
  driver,
  trackTemperatureC,
  startingGridPosition,
  trafficLevel,
  maxStops,
  pitLossSeconds,
  modelSource,
  results,
  pitWindows,
  selectedRank,
  topThreeActive,
  onOpenSetup,
  onSelectStrategy,
  onOpenManual,
  onOpenReplay,
  workspace,
  onWorkspaceChange,
  weatherSummary,
  pitSource = "프로젝트 추정",
  modelSummary,
  ruleExplanation,
  performanceSummary,
}: RaceBriefingOverviewProps) {
  const best = results[0];
  const selected = results[selectedRank] ?? best;

  if (!best) return null;

  return (
    <section className="race-briefing" aria-labelledby="briefing-title">
      <div className="race-briefing__stage">
        <div className="race-briefing__track">
          <span>레이스 전략 / 2026</span>
          <h1 id="briefing-title">{track.koreanName}</h1>
          <strong>{track.laps}랩</strong>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={circuitLayoutUrl(track.id)}
            alt={`${track.koreanName} 서킷 윤곽`}
          />
          <small>
            {uiLabel(track.country)} · {track.circuitLengthKm.toFixed(3)} km · 공식 제원
          </small>
        </div>

        <div className="race-briefing__driver">
          <span>선택한 드라이버</span>
          <h2>
            {uiLabel(driver.firstName)} <strong>{uiLabel(driver.lastName)}</strong>
          </h2>
          <p>{uiLabel(team.name)}</p>
          <dl>
            <div>
              <dt>출발 위치</dt>
              <dd>P{startingGridPosition}</dd>
            </div>
            <div>
              <dt>차량</dt>
              <dd>{team.carModel}</dd>
            </div>
          </dl>
        </div>

        <div className="race-briefing__car">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={publicAsset(team.carImage.src)} alt={`${uiLabel(team.name)} ${team.carModel} 공식 차량 이미지`} />
          <span>{team.code} · 2026</span>
        </div>
      </div>

      <div className="race-briefing__conditions" aria-label="적용된 경기 조건">
        <dl>
          <div>
            <dt>노면 온도 · 설정</dt>
            <dd>{trackTemperatureC}°C</dd>
          </div>
          <div>
            <dt>피트 손실 · {pitSource}</dt>
            <dd>{pitLossSeconds.toFixed(1)}초</dd>
          </div>
          <div>
            <dt>타이어 부하 · 추정</dt>
            <dd>{track.tyreSeverity}/5</dd>
          </div>
          <div>
            <dt>교통</dt>
            <dd>{TRAFFIC_LABELS[trafficLevel]}</dd>
          </div>
          <div>
            <dt>탐색 범위</dt>
            <dd>최대 {maxStops}스톱</dd>
          </div>
        </dl>
        <button type="button" onClick={onOpenSetup}>
          레이스 조건 변경
        </button>
      </div>

      <nav className="workspace-nav" aria-label="전략 작업 공간">
        {WORKSPACES.map((item) => (
          <button type="button" key={item.id} aria-current={workspace === item.id ? "step" : undefined}
            className={workspace === item.id ? "is-active" : ""} onClick={() => onWorkspaceChange(item.id)}>
            <span>{item.number}</span>{item.label}
          </button>
        ))}
        <span className="workspace-nav__model">{modelSource === "fastf1-2025" ? "2023–2025 관측 보정" : "가정 기반 계수"} · 프로젝트 추정</span>
      </nav>

      <div className="race-briefing__main strategy-board-layout" hidden={workspace !== "board"}>
        <StrategyBoardGraphic track={track} results={results} pitWindows={pitWindows} selectedRank={selectedRank}
          topThreeActive={topThreeActive} pitLossSeconds={pitLossSeconds} pitSource={pitSource} onSelectStrategy={onSelectStrategy} />

        <aside className="strategy-board-result" aria-label="선택한 전략의 모델 추정 결과">
          <header className="strategy-board-result__identity">
            <span>선택한 전략 {results.indexOf(selected) + 1}</span>
            <h3>{strategySequence(selected)}</h3>
            <p>{selected.pitAfterLaps.length > 0 ? selected.pitAfterLaps.map((lap) => `L${lap} 종료 후 교체`).join(" · ") : "피트 교체 없음"}</p>
          </header>
          <dl className="strategy-board-result__metrics">
            <div><dt>타이어 모델 총시간 · 추정</dt><dd>{selected.formattedTime}</dd></div>
            <div><dt>첫 번째 후보 대비 · 같은 비용식</dt><dd>{formatDelta(selected.totalSeconds - best.totalSeconds)}</dd></div>
          </dl>
          <div className="strategy-board-result__actions">
            <button type="button" className="is-primary" onClick={onOpenManual}>이 전략 직접 편집</button>
            <button type="button" onClick={onOpenReplay}>3D 리플레이</button>
          </div>
          <div className="strategy-board-result__context">
            {weatherSummary && <p><strong>날씨 조건</strong>{weatherSummary}</p>}
            <p><strong>규칙 판정</strong>{ruleExplanation ?? (selected.isLegal ? "선택한 전략은 현재 모델의 제약조건을 만족합니다." : "선택한 전략의 제약조건을 확인해 주세요.")}</p>
            {performanceSummary && <p><strong>성능 가정</strong>{performanceSummary}</p>}
          </div>
        </aside>
        <footer className="strategy-board-provenance">
          {modelSummary && <p><strong>채택 근거</strong>{modelSummary}</p>}
          <p><strong>프로젝트 추정</strong>{modelSource === "fastf1-2025" ? "2023–2025 실측 자료로 일부 계수를 보정했습니다. 미수집 서킷은 대체값이며 전략 시간과 교체 구간은 모델 추정입니다." : "타이어·피트 비용의 가정 계수로 계산한 결과이며 실제 경기 기록이 아닙니다."}</p>
          <p>휠은 교체 구간의 중간 지점에 표시합니다. 실제로 선택된 교체 랩은 결과 설명에서 확인하세요. 교체 구간은 다른 피트랩을 고정했을 때의 개별 민감도이며 여러 구간을 동시에 움직여도 같은 결과가 보장되는 것은 아닙니다.</p>
        </footer>
      </div>
    </section>
  );
}
