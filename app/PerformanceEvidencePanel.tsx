"use client";

import { useId } from "react";
import {
  DRIVER_RATING_FIELDS,
  DRIVER_RATING_RECORDS,
  DRIVER_RATINGS_COVERAGE,
  DRIVER_RATINGS_ITERATION,
  DRIVER_RATINGS_METADATA_DISCREPANCIES,
  DRIVER_RATINGS_SOURCE,
  resolveDriverPerformance,
  type DriverRatingField,
} from "./lib/driver-ratings";
import { MODEL_PARAMS } from "./model/params";
import { uiLabel } from "./ui-labels";
import "./performance-evidence.css";

const FIELD_LABELS: Readonly<Record<DriverRatingField, string>> = {
  OVR: "종합", EXP: "경험", RAC: "레이스 운영", AWA: "상황 인식", PAC: "주행 페이스",
};

function localName(name: string) {
  return uiLabel(name.replace("Hülkenberg", "Hulkenberg"));
}

function signedSeconds(seconds: number) {
  return `${seconds > 0 ? "+" : seconds < 0 ? "−" : ""}${Math.abs(seconds).toFixed(3)}초/랩`;
}

export default function PerformanceEvidencePanel({ selectedDriverId, equalPerformance = false }: {
  selectedDriverId?: string;
  equalPerformance?: boolean;
}) {
  const headingId = useId();
  const selected = DRIVER_RATING_RECORDS.find((record) => record.driverId === selectedDriverId);
  const resolved = selectedDriverId ? resolveDriverPerformance(selectedDriverId, equalPerformance) : null;
  const P = MODEL_PARAMS.performance;
  const coverageMismatch = DRIVER_RATINGS_COVERAGE.sourceDriverCount !== DRIVER_RATING_RECORDS.length ||
    DRIVER_RATINGS_COVERAGE.matchedDriverCount !== new Set(DRIVER_RATING_RECORDS.map((record) => record.driverId)).size;

  return <section className="performance-evidence" aria-labelledby={headingId}>
    <header className="performance-evidence__header">
      <div><span>드라이버 능력치의 근거</span><h3 id={headingId}>게임 평가점수와 모델 보정을 구분합니다.</h3><p>EA 공식 게임 점수는 실제 주행 능력을 측정한 값이 아닙니다. 점수를 랩타임·마모·우천 손실로 바꾸는 규칙은 프로젝트 추정입니다.</p></div>
      <a href={DRIVER_RATINGS_SOURCE.url} target="_blank" rel="noreferrer">EA 공식 원문 보기 ↗</a>
    </header>

    <dl className="performance-evidence__source">
      <div><dt>점수 제공</dt><dd>{DRIVER_RATINGS_SOURCE.publisher}</dd></div>
      <div><dt>원문 평가 버전</dt><dd>{DRIVER_RATINGS_ITERATION.label}</dd></div>
      <div><dt>자료 확인일</dt><dd><time dateTime={DRIVER_RATINGS_SOURCE.checkedAt}>{DRIVER_RATINGS_SOURCE.checkedAt}</time></dd></div>
      <div><dt>선수 매칭</dt><dd>{DRIVER_RATINGS_COVERAGE.matchedDriverCount} / {DRIVER_RATINGS_COVERAGE.expectedDriverCount}명</dd></div>
    </dl>
    <p className="performance-evidence__note">확인일은 자료를 조회한 날짜이며, 평가 버전의 공개일이 아닙니다. 원본 점수를 임의로 재평가하거나 누락값을 채우지 않습니다.</p>
    {coverageMismatch && <p className="performance-evidence__warning" role="status">수록된 선수 수와 자료 메타데이터가 일치하지 않습니다. 원본 자료를 다시 확인해야 합니다.</p>}
    {(DRIVER_RATINGS_COVERAGE.missingDriverIds.length > 0 || DRIVER_RATINGS_COVERAGE.unexpectedSourceDriverIds.length > 0) && <p className="performance-evidence__warning">매칭하지 못한 현재 선수: {DRIVER_RATINGS_COVERAGE.missingDriverIds.join(", ") || "없음"}. 현재 참가 명단에 없는 원문 선수: {DRIVER_RATINGS_COVERAGE.unexpectedSourceDriverIds.join(", ") || "없음"}.</p>}

    {selectedDriverId && <section className="performance-evidence__selected" aria-label="선택한 드라이버의 점수와 모델 보정">
      <div className="performance-evidence__driver"><span>선택한 드라이버</span><h4>{selected ? localName(selected.name) : "자료 없는 드라이버"}</h4><p>{selected ? `${selected.projectMetadata.code} · EA 원문 점수` : `${selectedDriverId} · 점수 없음`}</p></div>
      {selected && <dl className="performance-evidence__ratings">{DRIVER_RATING_FIELDS.map((field) => <div key={field}><dt>{FIELD_LABELS[field]} <small>{field}</small></dt><dd>{selected.ratings[field]}</dd></div>)}</dl>}
      {resolved && <div className="performance-evidence__mapping">
        <p>{!resolved.available ? "자료가 없어 모든 성능 보정을 중립값으로 적용합니다. EA 점수를 새로 만들지 않습니다." : equalPerformance ? "동일 성능 모드: 원문 점수는 표시하되 모델에는 보정을 적용하지 않습니다." : "아래 값은 공식 게임 점수를 변환한 프로젝트 추정치입니다. 실제 관측 랩타임이나 마모율이 아닙니다."}</p>
        <dl>
          <div><dt>기본 페이스 보정</dt><dd>{signedSeconds(resolved.paceSeconds)}</dd></div>
          <div><dt>마모 배수</dt><dd>×{resolved.wearMultiplier.toFixed(3)}</dd></div>
          <div><dt>우천 손실 배수</dt><dd>×{resolved.wetPenaltyMultiplier.toFixed(3)}</dd></div>
          <div><dt>레이스 운영 입력</dt><dd>{resolved.racecraft}<small>{equalPerformance || !resolved.available ? "모델 중립값" : "EA RAC 원점수"}</small></dd></div>
        </dl>
      </div>}
    </section>}

    <details className="performance-evidence__details">
      <summary>EA 원문 능력치 {DRIVER_RATING_RECORDS.length}명 전체 확인<span>종합 · 경험 · 레이스 운영 · 상황 인식 · 페이스</span></summary>
      <div className="performance-evidence__table-scroll" tabIndex={0} role="region" aria-label="EA 원문 능력치 전체 표, 좌우 스크롤 가능">
        <table><caption>출처: EA 공식 게임 평가. 점수는 원문 그대로이며 실측 주행 성능을 뜻하지 않습니다.</caption><thead><tr><th scope="col">선수</th>{DRIVER_RATING_FIELDS.map((field) => <th scope="col" key={field}>{FIELD_LABELS[field]}<small>{field}</small></th>)}<th scope="col">원문 메타정보</th></tr></thead>
          <tbody>{DRIVER_RATING_RECORDS.map((record) => <tr key={record.driverId} className={record.driverId === selectedDriverId ? "is-selected" : undefined} aria-current={record.driverId === selectedDriverId ? "true" : undefined}>
            <th scope="row">{localName(record.name)}<small>{record.name} · {record.projectMetadata.code}</small></th>
            {DRIVER_RATING_FIELDS.map((field) => <td key={field}>{record.ratings[field]}</td>)}
            <td>{record.eaMetadata.teamName}<small>차량 번호 {record.eaMetadata.carNumber}</small></td>
          </tr>)}</tbody>
        </table>
      </div>
    </details>

    <details className="performance-evidence__details">
      <summary>점수를 시간으로 바꾸는 규칙<span>프로젝트 추정 · 공식 시간 변환식 아님</span></summary>
      <div className="performance-evidence__formulas">
        <div><strong>기본 페이스</strong><code>({P.paceReference} − PAC) × {P.paceSecondsPerPoint} 초/랩</code><p>페이스 점수가 기준보다 높으면 기본 랩타임을 줄입니다.</p></div>
        <div><strong>마모 배수</strong><code>{P.neutralDeg} − (EXP − {P.experienceReference}) × {P.wearPerExperiencePoint}</code><p>경험 점수를 마모 관리의 간접 지표로 사용하는 가정입니다. 실제 타이어 센서 데이터가 아닙니다.</p></div>
        <div><strong>우천 손실 배수</strong><code>{P.neutralDeg} + [{P.wetReference} − ({P.wetOverallWeight} × OVR + {P.wetAwarenessWeight} × AWA)] × {P.wetPenaltyPerPoint}</code><p>우천 페널티에만 곱합니다. 종합·상황 인식 점수를 실제 우천 실력으로 검증했다는 의미는 아닙니다.</p></div>
        <div><strong>레이스 운영</strong><code>RAC 원점수</code><p>추월·교통 모형의 입력으로 전달합니다. 점수가 실제 추월 성공 확률과 같다는 뜻은 아닙니다.</p></div>
      </div>
    </details>

    {DRIVER_RATINGS_METADATA_DISCREPANCIES.length > 0 && <details className="performance-evidence__details">
      <summary>원문과 현재 참가자 정보의 차이 {DRIVER_RATINGS_METADATA_DISCREPANCIES.length}건<span>점수만 사용 · 팀과 차량 번호는 현재 참가자 정보 유지</span></summary>
      <div className="performance-evidence__table-scroll" tabIndex={0} role="region" aria-label="EA 원문과 현재 참가자 정보 차이, 좌우 스크롤 가능"><table className="performance-evidence__metadata"><caption>EA 원문 메타정보를 현재 참가자 명단에 덮어쓰지 않습니다.</caption><thead><tr><th scope="col">선수</th><th scope="col">항목</th><th scope="col">EA 원문</th><th scope="col">현재 참가자 정보</th></tr></thead><tbody>
        {DRIVER_RATINGS_METADATA_DISCREPANCIES.map((item) => <tr key={`${item.driverId}-${item.field}`}><th scope="row">{localName(DRIVER_RATING_RECORDS.find((record) => record.driverId === item.driverId)?.name ?? item.driverId)}</th><td>{item.field === "carNumber" ? "차량 번호" : item.field === "team" ? "팀" : item.field}</td><td>{item.eaValue}</td><td>{item.projectValue}</td></tr>)}
      </tbody></table></div>
    </details>}
    <footer className="performance-evidence__footer">능력치는 선수의 실제 우열에 대한 객관적 측정값이 아닙니다. 같은 전략을 비교할 때에는 적용한 능력치 모드와 평가 버전을 함께 확인하세요.</footer>
  </section>;
}
