"use client";

import { circuitLayoutUrl } from "./lib/circuit-layouts";
import { uiLabel } from "./ui-labels";
import { publicAsset } from "./lib/public-assets";
import type {
  DriverProfile,
  TeamProfile,
} from "./lib/participants";
import type {
  Compound,
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

const COMPOUND_NAMES: Readonly<Record<Compound, string>> = {
  S: "소프트",
  M: "미디엄",
  H: "하드",
  INTER: "인터미디어트",
  WET: "웨트",
};

const COMPOUND_DISPLAY: Readonly<
  Record<Compound, { readonly colour: string; readonly descriptor: string }>
> = {
  S: { colour: "빨강", descriptor: "소프트" },
  M: { colour: "노랑", descriptor: "미디엄" },
  H: { colour: "흰색", descriptor: "하드" },
  INTER: { colour: "초록", descriptor: "인터미디어트" },
  WET: { colour: "파랑", descriptor: "웨트" },
};

const TRAFFIC_LABELS: Readonly<Record<RaceTrafficLevel, string>> = {
  low: "적음",
  medium: "보통",
  high: "많음",
};

const DISPLAY_TIE_EPSILON_SECONDS = 0.0005;

function strategySequence(strategy: StrategyResult): string {
  return strategy.stints
    .map((stint) => COMPOUND_NAMES[stint.compound])
    .join(" → ");
}

function formatDelta(seconds: number): string {
  return `+${Math.max(0, seconds).toFixed(3)}초`;
}

function tiesDisplayedTime(
  strategy: StrategyResult,
  best: StrategyResult,
): boolean {
  return (
    Math.abs(strategy.totalSeconds - best.totalSeconds) <
    DISPLAY_TIE_EPSILON_SECONDS
  );
}

function strategyReason(
  best: StrategyResult,
  runnerUp: StrategyResult | undefined,
): string {
  const stopLaps = best.pitAfterLaps.map((lap) => `L${lap}`).join(" · ");
  const gap = runnerUp
    ? `${(runnerUp.totalSeconds - best.totalSeconds).toFixed(3)}초`
    : "계산 범위 내 최소값";

  if (runnerUp && tiesDisplayedTime(runnerUp, best)) {
    return `${stopLaps} 피트 조합이 현재 비용식에서 공동 최단 총시간으로 계산되었습니다. 동률 후보는 결과를 재현할 수 있도록 결정론적 내부 순서로 표시합니다.`;
  }

  return `${stopLaps} 피트 조합이 현재 열화·연료·피트 손실의 합을 가장 작게 만들며, 다음 후보보다 ${gap} 빠릅니다.`;
}

function StrategyStrip({
  strategy,
  totalLaps,
  pitWindows,
  rank,
  tied,
}: {
  strategy: StrategyResult;
  totalLaps: number;
  pitWindows: readonly StrategyPitWindow[];
  rank: number;
  tied: boolean;
}) {
  const finalCompound =
    strategy.stints[strategy.stints.length - 1]?.compound ?? "H";
  const stopLabel = strategy.stopCount === 1 ? "1회 교체" : strategy.stopCount === 2 ? "2회 교체" : `${strategy.stopCount}회 교체`;
  const resultKicker =
    tied ? "공동 최단" : rank === 0
      ? "최단 예측"
      : rank === 1
        ? "대안 전략"
        : "세 번째 후보";

  return (
    <div
      className="briefing-strip"
      role="img"
      aria-label={`${strategySequence(strategy)}. ${pitWindows
        .map(
          (window) =>
            `선택 피트 ${window.optimalLap}랩, 민감도 구간 ${window.startLap}랩부터 ${window.endLap}랩`,
        )
        .join(", ")}`}
    >
      <div className="briefing-strip__bar">
        {strategy.stints.map((stint, index) => {
          const pitWindow = pitWindows[index];
          const isLast = index === strategy.stints.length - 1;

          return (
            <span
              className={`briefing-strip__stint is-${stint.compound.toLowerCase()}`}
              key={`${stint.compound}-${stint.startLap}`}
              style={{ width: `${(stint.laps / totalLaps) * 100}%` }}
              title={`${COMPOUND_NAMES[stint.compound]} · L${stint.startLap}–L${stint.endLap}`}
            >
              <span className="briefing-strip__line" aria-hidden="true" />
              <small className="briefing-strip__compound" aria-hidden="true">{stint.compound} <span>· {stint.laps}랩</span></small>
              {!isLast && pitWindow && (
                <span
                  className="briefing-strip__window"
                  title={`피트 윈도우 L${pitWindow.startLap}–L${pitWindow.endLap} · 선택 L${pitWindow.optimalLap} · 기준 +${pitWindow.thresholdSeconds.toFixed(1)}초 이내`}
                >
                  <b>{pitWindow.startLap}</b>–<b>{pitWindow.endLap}</b>랩
                </span>
              )}
              {!isLast && (
                <span
                  className={`briefing-tyre is-${stint.compound.toLowerCase()}`}
                  aria-hidden="true"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={publicAsset("/ui/tyre-compound-icon.png")} alt="" />
                </span>
              )}
            </span>
          );
        })}
        <span className="briefing-strip__result" aria-hidden="true">
          <small>{resultKicker}</small>
          <strong>{stopLabel}</strong>
        </span>
        <span
          className={`briefing-tyre briefing-tyre--finish is-${finalCompound.toLowerCase()}`}
          aria-hidden="true"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={publicAsset("/ui/tyre-compound-icon.png")} alt="" />
        </span>
      </div>
    </div>
  );
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
}: RaceBriefingOverviewProps) {
  const best = results[0];
  const runnerUp = results[1];
  const selected = results[selectedRank] ?? best;

  if (!best) return null;

  const tiedBestCount = results.filter((strategy) =>
    tiesDisplayedTime(strategy, best),
  ).length;
  const hasBestTie = tiedBestCount > 1;
  const selectedTiesBest = tiesDisplayedTime(selected, best);

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
            <dt>피트 손실 · 가정</dt>
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
        <span className="workspace-nav__model">{modelSource === "fastf1-2025" ? "2025 데이터 보정" : "가정 기반 계수"} · 건식</span>
      </nav>

      <div className="race-briefing__main" hidden={workspace !== "board"}>
        <section className="briefing-board" aria-labelledby="briefing-board-title">
          <header className="briefing-board__header">
            <div className="briefing-board__heading">
              <span>
                {track.shortCode} · {uiLabel(track.country)} · {track.laps}랩
              </span>
              <h2 id="briefing-board-title">
                {track.koreanName} <em>추천 타이어 전략</em>
              </h2>
            </div>
            <div className="briefing-board__model-mark">
              <span>상위 3개 / 모델 추정</span>
              <strong>타이어 전략 분석</strong>
            </div>
          </header>

          <div className="briefing-board__viewport">
            <div className="briefing-board__plot">
              <div className="briefing-board__rows">
                {results.slice(0, 3).map((strategy, index) => (
                  <button
                    type="button"
                    className={`briefing-row ${
                      topThreeActive && selectedRank === index
                        ? "is-selected"
                        : ""
                    }`}
                    aria-pressed={topThreeActive && selectedRank === index}
                    aria-label={`후보 ${index + 1}, ${strategySequence(strategy)}, ${strategy.formattedTime}, ${tiesDisplayedTime(strategy, best) ? "공동 최단" : formatDelta(strategy.totalSeconds - best.totalSeconds)}`}
                    onClick={() => onSelectStrategy(index)}
                    key={strategy.signature}
                  >
                    <span className="briefing-row__rank" aria-hidden="true">
                      전략 0{index + 1}
                    </span>
                    <span className="briefing-row__timing">
                      <strong>{strategy.formattedTime}</strong>
                      <small>{tiesDisplayedTime(strategy, best) ? hasBestTie ? "공동 최단" : "기준 전략" : formatDelta(strategy.totalSeconds - best.totalSeconds)}</small>
                    </span>
                    <StrategyStrip
                      strategy={strategy}
                      totalLaps={track.laps}
                      pitWindows={pitWindows[index] ?? []}
                      rank={index}
                      tied={hasBestTie && tiesDisplayedTime(strategy, best)}
                    />
                  </button>
                ))}
              </div>
            </div>
          </div>

          <footer className="briefing-board__legend">
            <div
              className="briefing-board__compounds"
              aria-label="드라이 타이어 컴파운드"
            >
              {(["H", "M", "S", "INTER", "WET"] as const).map((compound) => (
                <span
                  className={`briefing-compound is-${compound.toLowerCase()}`}
                  key={compound}
                >
                  <span
                    className={`briefing-tyre is-${compound.toLowerCase()}`}
                    aria-hidden="true"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={publicAsset("/ui/tyre-compound-icon.png")} alt="" />
                  </span>
                  <span>
                    <small>{COMPOUND_DISPLAY[compound].colour}</small>
                    <strong>{COMPOUND_DISPLAY[compound].descriptor}</strong>
                  </span>
                  <b>{compound}</b>
                </span>
              ))}
            </div>
            <div className="briefing-board__facts">
              <span>
                <small>
                  설정값
                  <br />
                  피트 손실
                </small>
                <strong>{pitLossSeconds.toFixed(1)}초</strong>
              </span>
              <span className="briefing-board__lap-fact">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={circuitLayoutUrl(track.id)} alt="" />
                <strong>{track.laps}랩</strong>
              </span>
            </div>
          </footer>
          <p className="briefing-board__note">
            후보를 눌러 비교 · 피트 윈도우: 해당 후보 대비 +1.0초 이내, 다른 피트랩 고정 · 모든 후보는 같은 랩 축 사용
          </p>
        </section>

        <aside className="briefing-recommendation" aria-label="추천 전략 설명">
          <div className="briefing-recommendation__identity"><span>
            {selectedTiesBest && hasBestTie
              ? `공동 최단 후보 · ${selected.rank}`
              : selectedRank === 0
                ? "추천 1위"
                : `선택 전략 · ${selected.rank}위`}
          </span>
          <h2>{strategySequence(selected)}</h2>
          </div>
          <div className="briefing-recommendation__time">
            <small>예상 총시간 · 추정</small>
            <strong>{selected.formattedTime}</strong>
          </div>
          <dl>
            <div>
              <dt>피트랩</dt>
              <dd>{selected.pitAfterLaps.map((lap) => `L${lap}`).join(" · ")}</dd>
            </div>
            <div>
              <dt>규칙 판정</dt>
              <dd>{selected.isLegal ? "모델 제약 통과" : "확인 필요"}</dd>
            </div>
          </dl>
          <details className="briefing-recommendation__reason">
            <summary>
              {selectedTiesBest && hasBestTie
                ? "동률 판정"
                : selectedRank === 0
                  ? "추천 이유"
                  : "1위 대비"}
            </summary>
            <p>
              {selectedTiesBest && hasBestTie
                ? selectedRank === 0
                  ? strategyReason(best, runnerUp)
                  : `${strategySequence(selected)}은 현재 비용식에서 1번 후보와 동일한 예상 총시간 · 추정입니다. 번호는 우열이 아니라 재현 가능한 내부 표시 순서입니다.`
                : selectedRank === 0
                ? strategyReason(best, runnerUp)
                : `${strategySequence(selected)}은 1위와 같은 조건을 통과한 대안이며 예상 총시간 · 추정 차이는 ${formatDelta(selected.totalSeconds - best.totalSeconds)}입니다.`}
            </p>
          </details>
          <div className="briefing-provenance" aria-label="결과 출처">
            <span>
              {modelSource === "fastf1-2025" ? "실제 데이터 보정" : "가정 기반 계수"}
            </span>
            <span>모델 추정</span>
            <span>동적계획법 최적화</span>
          </div>
          <div className="briefing-recommendation__actions">
            <button type="button" className="is-primary" onClick={onOpenManual}>
              이 전략 직접 편집
            </button>
            <button type="button" onClick={onOpenReplay}>
              3D 리플레이
            </button>
          </div>
        </aside>
      </div>
      <footer className="race-briefing__disclaimer" hidden={workspace !== "board"}>
        피트 윈도우는 다른 피트랩을 고정한 채 해당 피트랩만 이동했을 때,
        선택 전략 대비 예상 손실이 1.0초 이내인 연속 구간입니다. 예측값은 실제
        레이스 결과와 다를 수 있습니다.
      </footer>
    </section>
  );
}
