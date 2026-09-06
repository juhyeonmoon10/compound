"use client";

import { useId, useMemo, useState, useSyncExternalStore } from "react";
import {
  EXPERIMENT_STORAGE_KEY,
  MAX_EXPERIMENTS,
  compareExperiments,
  createExperiment,
  experimentsToCsv,
  parseExperiments,
  serializeExperiments,
  type ExperimentRecord,
  type ExperimentSnapshot,
} from "./lib/experiment-notebook";
import "./experiment-notebook.css";

const CHANGE_EVENT = "apex:experiment-notebook-change";

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === EXPERIMENT_STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, listener);
  };
}

function getStorageSnapshot() {
  try { return window.localStorage.getItem(EXPERIMENT_STORAGE_KEY); }
  catch { return null; }
}

function getServerSnapshot() { return null; }

function writeRecords(records: readonly ExperimentRecord[]) {
  window.localStorage.setItem(EXPERIMENT_STORAGE_KEY, serializeExperiments(records));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function formatSavedAt(iso: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function TyreSequence({ record }: { record: ExperimentSnapshot }) {
  return <span className="experiment-sequence" aria-label={record.strategy.stints.map((stint) => stint.compound).join(" 다음 ")}>
    {record.strategy.stints.map((stint, index) => <span className="experiment-sequence-step" key={`${stint.compound}-${stint.startLap}`}>
      {index > 0 && <span className="experiment-sequence-arrow" aria-hidden="true">→</span>}
      <b className={`experiment-tyre experiment-tyre-${stint.compound.toLowerCase()}`}>{stint.compound}</b>
    </span>)}
  </span>;
}

export default function ExperimentNotebook({ currentSnapshot }: { currentSnapshot: ExperimentSnapshot | null }) {
  const nameId = useId();
  const headingId = useId();
  const raw = useSyncExternalStore(subscribe, getStorageSnapshot, getServerSnapshot);
  const storage = useMemo(() => parseExperiments(raw), [raw]);
  const records = storage.records;
  const [name, setName] = useState("");
  const [status, setStatus] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selected = selectedIds.map((id) => records.find((record) => record.id === id)).filter((record): record is ExperimentRecord => Boolean(record));
  const comparison = selected.length === 2 ? compareExperiments(selected[0], selected[1]) : null;
  const defaultName = currentSnapshot ? `${currentSnapshot.trackName} · ${currentSnapshot.modeLabel ?? "전략 실험"}` : "";
  const storageNeedsRecovery = storage.status === "invalid" || storage.status === "incompatible" || storage.discardedCount > 0;

  function saveCurrent() {
    if (!currentSnapshot) return;
    try {
      const latest = parseExperiments(getStorageSnapshot());
      if (latest.status === "invalid" || latest.status === "incompatible" || latest.discardedCount > 0) {
        setStatus("기존 기록 형식을 읽을 수 없어 덮어쓰지 않았습니다. 다른 브라우저에서 새 기록을 시작해 주세요.");
        return;
      }
      if (latest.records.length >= MAX_EXPERIMENTS) { setStatus("기록은 최대 20개입니다. 필요 없는 기록을 개별 삭제한 후 저장해 주세요."); return; }
      const record = createExperiment(currentSnapshot, name.trim() || defaultName, {
        id: window.crypto.randomUUID(), createdAt: new Date().toISOString(),
      });
      writeRecords([record, ...latest.records]);
      setName("");
      setStatus(`‘${record.name}’ 실험을 이 브라우저에 저장했습니다.`);
    } catch { setStatus("저장하지 못했습니다. 브라우저 저장소 사용 권한이나 남은 용량을 확인해 주세요."); }
  }

  function deleteRecord(id: string) {
    try {
      const latest = parseExperiments(getStorageSnapshot());
      if (latest.status !== "ok" || latest.discardedCount > 0) { setStatus("기록 일부를 읽지 못해 원본 보호를 위해 삭제하지 않았습니다."); return; }
      const record = latest.records.find((item) => item.id === id);
      if (!record) { setStatus("이미 삭제된 기록입니다."); return; }
      writeRecords(latest.records.filter((item) => item.id !== id));
      setSelectedIds((previous) => previous.filter((item) => item !== id));
      setStatus(`‘${record.name}’ 기록 1개를 삭제했습니다. 내보낸 CSV 파일은 유지됩니다.`);
    } catch { setStatus("기록을 삭제하지 못했습니다. 브라우저 저장소 권한을 확인해 주세요."); }
  }

  function toggleComparison(id: string) {
    if (selectedIds.includes(id)) { setSelectedIds((previous) => previous.filter((item) => item !== id)); return; }
    if (selected.length >= 2) { setStatus("두 기록까지 비교할 수 있습니다. 선택한 기록 하나를 해제해 주세요."); return; }
    setSelectedIds([...selected.map((record) => record.id), id]);
    setStatus("");
  }

  function exportCsv() {
    if (records.length === 0) return;
    try {
      const blob = new Blob([experimentsToCsv(records)], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `compound-experiments-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(`실험 ${records.length}개를 CSV로 내보냈습니다. 예측값과 실제 경기 기록은 구분해 사용하세요.`);
    } catch { setStatus("CSV 파일을 만들지 못했습니다. 다시 시도해 주세요."); }
  }

  return <section className="experiment-notebook" aria-labelledby={headingId}>
    <header className="experiment-header">
      <div><span className="experiment-eyebrow">실험 기록</span><h3 id={headingId}>전략을 바꾸고, 근거를 남기세요.</h3><p>조건과 모델 추정 결과를 함께 저장하고 이전 전략과 비교할 수 있습니다.</p></div>
      <span className="experiment-count">{records.length}<span> / {MAX_EXPERIMENTS}</span></span>
    </header>

    <form className="experiment-save" onSubmit={(event) => { event.preventDefault(); saveCurrent(); }}>
      <div className="experiment-current"><span>현재 선택한 전략 · 추정</span>{currentSnapshot ? <><strong>{currentSnapshot.trackName}</strong><TyreSequence record={currentSnapshot} /><b>{currentSnapshot.strategy.formattedTime}</b><small>{currentSnapshot.modeLabel ?? "전략 실험"} · 모델 예측</small></> : <p>전략을 계산하거나 유효한 직접 전략을 완성해 주세요.</p>}</div>
      <div className="experiment-name-field"><label htmlFor={nameId}>실험 이름 <span>선택</span></label><input id={nameId} value={name} onChange={(event) => setName(event.target.value)} maxLength={100} placeholder={defaultName || "예: 피트 손실 22초 실험"} autoComplete="off" /></div>
      <button className="experiment-primary" type="submit" disabled={!currentSnapshot || records.length >= MAX_EXPERIMENTS || storageNeedsRecovery}>현재 결과 저장 <span aria-hidden="true">＋</span></button>
    </form>

    {storageNeedsRecovery && <p className="experiment-notice">기존 기록 일부를 읽을 수 없습니다. 원본 보호를 위해 저장·삭제를 잠시 막았습니다. 읽을 수 있는 기록은 CSV로 내보낼 수 있습니다.{storage.discardedCount > 0 && ` 형식이 맞지 않거나 중복된 기록 ${storage.discardedCount}개는 표시하지 않았습니다.`}</p>}

    <div className="experiment-list-heading"><p>{records.length > 0 ? <>체크박스로 <strong>두 실험</strong>을 선택해 비교하세요.</> : "아직 저장한 실험이 없습니다."}</p><button type="button" className="experiment-export" disabled={records.length === 0} onClick={exportCsv}>CSV 내보내기 <span aria-hidden="true">↗</span></button></div>
    {records.length === 0 ? <div className="experiment-empty"><span aria-hidden="true">01 / 02</span><div><strong>한 가지 조건을 바꿔 두 결과를 저장해 보세요.</strong><p>예를 들어 피트 손실만 20초 → 25초로 바꾸면, 최적 전략이 어떻게 달라지는지 비교할 수 있습니다.</p></div></div> : <ul className="experiment-list">
      {records.map((record) => <li className={`experiment-record${selectedIds.includes(record.id) ? " is-selected" : ""}`} key={record.id}>
        <label className="experiment-record-label"><input type="checkbox" checked={selectedIds.includes(record.id)} onChange={() => toggleComparison(record.id)} aria-label={`${record.name} 비교 선택`} /><span><strong>{record.name}</strong><small>{record.trackName} · {record.laps}랩 · <time dateTime={record.createdAt}>{formatSavedAt(record.createdAt)}</time></small></span></label>
        <TyreSequence record={record} /><span className="experiment-record-time"><b>{record.strategy.formattedTime}</b><small>피트 {record.strategy.pitAfterLaps.map((lap) => `L${lap}`).join(" / ") || "없음"}</small></span><button type="button" className="experiment-delete" onClick={() => deleteRecord(record.id)} disabled={storageNeedsRecovery} aria-label={`${record.name} 기록 삭제`}>삭제</button>
      </li>)}
    </ul>}

    {comparison && <div className="experiment-comparison" aria-label="선택한 두 실험 비교">
      <div className="experiment-comparison-summary"><div><span>두 번째 선택 − 첫 번째 선택</span><strong>{Math.abs(comparison.deltaSeconds) < 0.0005 ? "동일한 예측 시간" : `${comparison.deltaSeconds > 0 ? "+" : "−"}${Math.abs(comparison.deltaSeconds).toFixed(3)}초`}</strong></div><p>{comparison.sameConditions ? "같은 모델 조건의 전략 비교입니다." : comparison.differences.length > 0 ? `서로 다른 조건: ${comparison.differences.join(" · ")}. 시간 차이를 전략만의 효과로 해석하면 안 됩니다.` : "전체 모델 조건 서명이 없어 동일 조건인지 확정할 수 없습니다."}</p></div>
      <div className="experiment-comparison-table-wrap"><table className="experiment-comparison-table"><caption>저장된 모델 예측 결과이며, 실제 레이스 성적이 아닙니다.</caption><thead><tr><th scope="col">비교 항목</th>{selected.map((record, index) => <th scope="col" key={record.id}><small>실험 {index + 1}</small>{record.name}</th>)}</tr></thead><tbody>
        <tr><th scope="row">타이어 순서</th>{selected.map((record) => <td key={record.id}><TyreSequence record={record} /></td>)}</tr>
        <tr><th scope="row">피트 진입</th>{selected.map((record) => <td key={record.id}>{record.strategy.pitAfterLaps.map((lap) => `L${lap} 종료 후`).join(" / ") || "없음"}</td>)}</tr>
        <tr><th scope="row">노면 / 피트 손실 · 설정</th>{selected.map((record) => <td key={record.id}>{record.trackTemperatureC}°C / {record.pitLossSeconds}초</td>)}</tr>
        <tr><th scope="row">마모 / 최대 피트 · 설정</th>{selected.map((record) => <td key={record.id}>{record.degradationPercent}% / {record.maxStops}회</td>)}</tr>
        <tr><th scope="row">계수 모델</th>{selected.map((record) => <td key={record.id}>{record.modelSource === "project" ? "가정 기반 계수" : record.modelSource === "fastf1-2025" ? "FastF1 2025 학습 계수" : record.modelSource}</td>)}</tr>
        <tr><th scope="row">예측 총시간</th>{selected.map((record) => <td key={record.id}><strong>{record.strategy.formattedTime}</strong></td>)}</tr>
      </tbody></table></div>
    </div>}
    <p className="experiment-status" role="status" aria-live="polite" aria-atomic="true">{status}</p>
    <footer className="experiment-footer">이 브라우저에만 저장됩니다. 브라우저 데이터 삭제 시 기록도 사라지므로 다시 확인할 기록은 CSV로 보관하세요.</footer>
  </section>;
}
