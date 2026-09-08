"use client";

import type { CSSProperties } from "react";
import type { RaceGridCar } from "./lib/race-grid";
import { CAMERA_MODES, PLAYBACK_RATES, replayActionLabel, type ReplayCamera, type ReplayPhase } from "./lib/replay-controls";
import { TYRE_COLORS, TYRE_LABELS } from "./model/params";

interface Props {
  phase: ReplayPhase; ready: boolean; rate: number; camera: ReplayCamera; reducedMotion: boolean;
  fullscreen: boolean; elapsed: number; lap: number; car: RaceGridCar;
  onPlay: () => void; onRate: (rate: number) => void; onCamera: (camera: ReplayCamera) => void;
  onFullscreen: () => void; onReset: () => void; onLap: (direction: -1 | 1) => void;
  onSeek: (seconds: number) => void;
}

export default function RaceReplayControls(props: Props) {
  const { phase, ready, rate, camera, reducedMotion, fullscreen, elapsed, lap, car } = props;
  const totalLaps = car.strategy.lapCosts.length;
  const active = phase === "running" || phase === "countdown";
  return <div className="replay-controls" aria-label="시뮬레이션 조작">
    <div className="replay-controls__bar">
      <div className="replay-controls__transport" role="group" aria-label="재생 제어">
        <button type="button" onClick={() => props.onLap(-1)} disabled={!ready || elapsed <= 0} aria-label="이전 랩 시작">−1랩</button>
        <button type="button" className="replay-controls__play" onClick={props.onPlay} disabled={!ready && !active}
          aria-keyshortcuts="Space"><span aria-hidden="true">{active ? "Ⅱ" : "▶"}</span>{ready || active ? replayActionLabel(phase) : "준비 중"}</button>
        <button type="button" onClick={() => props.onLap(1)} disabled={!ready || elapsed >= car.totalSeconds} aria-label="다음 랩 시작">+1랩</button>
      </div>
      <div className="replay-controls__rates" role="group" aria-label="재생 배속">
        {PLAYBACK_RATES.map(value => <button key={value} type="button" aria-pressed={rate === value}
          onClick={() => props.onRate(value)}>{value}×</button>)}
      </div>
      <label className="replay-controls__camera"><span className="sr-only">주행 카메라</span>
        <select aria-label="주행 카메라" value={camera} onChange={event => props.onCamera(event.target.value as ReplayCamera)}>
          {CAMERA_MODES.map(item => <option key={item.id} value={item.id} disabled={reducedMotion && item.id !== "map"}>{item.label}</option>)}
        </select>
      </label>
      <button type="button" className="replay-controls__fullscreen" onClick={props.onFullscreen} aria-pressed={fullscreen}
        aria-keyshortcuts="F" aria-label={fullscreen ? "주행 전체화면 나가기" : "3D 주행 화면 전체 화면"}>
        <span aria-hidden="true">{fullscreen ? "↙" : "⛶"}</span>{fullscreen ? "나가기" : "전체화면"}</button>
      <button type="button" className="replay-controls__reset" onClick={props.onReset} disabled={!ready || phase === "ready"}>처음부터</button>
    </div>
    <div className="replay-controls__seek">
      <div className="replay-controls__time"><strong>{lap}<span> / {totalLaps}랩</span></strong>
        <span>{Math.floor(elapsed / 60)}:{String(Math.floor(elapsed % 60)).padStart(2, "0")}</span>
      </div>
      <div className="replay-controls__track">
        <div className="replay-controls__stints" aria-hidden="true">{car.strategy.stints.map(stint => {
          const start = car.lapTimings[stint.startLap - 2]?.cumulativeSeconds ?? 0;
          const end = car.lapTimings[stint.endLap - 1].cumulativeSeconds;
          return <span key={stint.startLap} style={{ width: `${(end - start) / car.totalSeconds * 100}%`, background: TYRE_COLORS[stint.compound], color: stint.compound === "S" || stint.compound === "WET" ? "white" : "#101215" }}
            title={`${TYRE_LABELS[stint.compound]} · ${stint.startLap}–${stint.endLap}랩`}>{stint.compound === "INTER" ? "I" : stint.compound === "WET" ? "W" : stint.compound}</span>;
        })}</div>
        <input type="range" min={0} max={car.totalSeconds} step="any" value={Math.min(elapsed, car.totalSeconds)} disabled={!ready}
          aria-label="전략 레이스 모델 시간 탐색" aria-valuetext={`${lap}랩 / ${totalLaps}랩, ${Math.floor(elapsed)}초`}
          onChange={event => props.onSeek(Number(event.target.value))} />
        <div className="replay-controls__pits">{car.replay.segments.filter(segment => segment.kind === "pit-loss").map(segment =>
          <button type="button" key={segment.pitAfterLap} disabled={!ready} style={{ "--pit-position": `${segment.startSeconds / car.totalSeconds * 100}%` } as CSSProperties}
            aria-label={`${segment.pitAfterLap}랩 종료 후 피트로 이동`} title={`${segment.pitAfterLap}랩 종료 후 피트 · ${TYRE_LABELS[segment.toCompound]}`}
            onClick={() => props.onSeek(segment.startSeconds)}>◆ <span>L{segment.pitAfterLap}</span></button>)}</div>
      </div>
    </div>
    <p className="replay-controls__help"><span><kbd>Space</kbd> 재생·정지 <kbd>C</kbd> 카메라 <kbd>F</kbd> 전체화면</span><span>막대·피트 표식을 선택하면 해당 시점에서 일시정지</span></p>
  </div>;
}
