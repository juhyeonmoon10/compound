# 후보 전략 확률 평가

`app/lib/race-experiments.ts`의 `runRaceExperiments(candidates, options)`는 **이미 계산된 합법 전략**을 기본 300개의 재현 가능한 가상 경기에서 비교한다. 교통 상태와 SC/VSC를 포함한 새로운 DP 최적화기가 아니다.

## 현재 화면의 공유 그리드 API

`buildSharedRaceGrid`는 선택 선수+고정된 다른 19명, 출발 슬롯, 상대 전략 배정과 능력치 상대 보정을 3D와 공유한다. 입력 후보는 **이미 내 차의 능력치를 적용한 DP 결과**여야 한다. 해당 후보를 다시 `applyEntryPerformance`에 넣거나, 이미 교통 손실이 붙은 최종 리플레이 랩을 MC에 전달하면 안 된다.

아래는 저장소 루트 상대 경로를 사용하는 독립 실행 예시다. 가정 기반 서킷 계수와 명시한 피트 손실 20.5초를 쓰므로, 관측 계수를 선택한 UI와 같은 결과라는 뜻은 아니다. Node.js 22.13 이상에서 `--experimental-strip-types`로 실행할 수 있다.

```js
import { applyEntryPerformance } from "./app/lib/entry-performance.ts";
import { buildRepresentativeStrategies } from "./app/lib/representative-strategies.ts";
import { buildSharedRaceGrid } from "./app/lib/shared-race-grid.ts";
import { getNeutralisationPrior } from "./app/lib/neutralisation-prior.ts";
import { runRaceExperiments } from "./app/lib/race-experiments.ts";

const trackId = "melbourne", teamId = "red-bull", driverId = "max-verstappen";
const equalPerformance = false;
const input = applyEntryPerformance({
  track: trackId, weather: { preset: "none" }, pitLossSeconds: 20.5,
}, teamId, driverId, equalPerformance);
const candidates = buildRepresentativeStrategies(input).strategies;
const shared = buildSharedRaceGrid({
  teamId, driverId, equalPerformance,
  playerStrategy: candidates[0], strategyPool: candidates, startingGridPosition: 10,
});
const experiment = runRaceExperiments(candidates, {
  seed: 20260906,
  trials: 300,
  trackLaps: candidates[0].lapCosts.length,
  pitLossSeconds: input.pitLossSeconds,
  playerId: shared.playerId,
  startingGridPosition: shared.startingGridPosition,
  gridSlotOffsetSeconds: shared.gridSlotOffsetSeconds,
  racecraft: shared.racecraft,
  fixedRivals: shared.fixedRivals,
  eventPrior: getNeutralisationPrior(trackId),
});
console.log(experiment.seed, experiment.gridModel.kind, experiment.eventSummary);
```

- `candidates`: 같은 원래 모델 조건 서명과 랩 수를 가진 합법 `StrategyEvaluation[]`. 화면의 1번은 전역 최단 해, 2·3번은 구별되는 대표 대안이며 전역 K-best 2·3위가 아니다.
- `fixedRivals`: 정확히 19개의 `{driverId, gridPosition, strategy, racecraft, costBasis}`. `costBasis`는 `entry-adjusted-no-traffic`이다. 공유 helper는 상대 능력치 차이만 반영하고 그리드 지연·교통·피트박스 대기를 0으로 둔 기초 랩을 반환한다. `costBasis` 문자열만 바꾼다고 기존 최종 랩이 기초 랩으로 복원되는 것은 아니다.
- `playerId`, `startingGridPosition`, `gridSlotOffsetSeconds`, `racecraft`: 공유 helper가 반환한 값을 사용한다. 이 경로에서는 선수별 RAC와 능력치 기초 비용을 쓰며 generic 상대팩의 인위적 페이스 간격을 추가하지 않는다. 현재 공유 슬롯 간격은 0.12초, 기본 시작 위치는 10위다.
- `rivalStrategies`: `fixedRivals`가 없는 **호환 모드**의 일반 상대 전략 풀. 생략하면 후보들을 정규 식별자로 정렬한다. 이 경로는 기존 일반 상대 ID·일정한 페이스 간격·기본 출발 간격 0.3초를 유지하며 실제 팀/선수 공유 그리드가 아니다.
- `eventPrior`: 선택 서킷의 `getNeutralisationPrior(trackId)` 반환값. 경기당 적어도 한 구간을 생성할 확률이지 랩당 위험률이 아니다. 관측·대체값·기간 출처는 아래 기준대로 구분한다.
- `trials`, `seed`: 결과 재현 및 경량 테스트용 설정. 기본 시행 수는 300이다.

React에서는 공유 그리드·사전값·후보 배열의 참조를 `useMemo` 등으로 안정적으로 유지한다. 값이 같아도 매 렌더마다 새 객체를 만들면 계산 조건 변경으로 처리되어 실행 중인 Worker가 취소된다.

## 관측 SC/VSC 사전값과 fallback

`app/data/neutralisation-evidence.json`은 2018–2025년의 `TrackStatus`, `LapCount`, `SessionStatus`, `WeatherData`, `RaceControlMessages`를 수집한 프로젝트 집계다. 현재 173개 일정 중 유효 137경기·제외 36경기이며, 24개 현재 서킷 중 관측 빈도 15개를 확보했다. 공식 FIA/Pirelli 확률표 전사값이 아니다.

`getNeutralisationPrior`는 약 30.5KB의 `neutralisation-summary.json`을 읽는다. 약 853KB의 경기별 원자료는 UI의 출처 다운로드 버튼을 누를 때만 불러온다. 원시·요약 일치는 Python 검사기가 검증한다.

- SC/VSC 각각 유효 경기 수가 `MODEL_PARAMS.race.minObservedRaces=5` 이상이면 관측 빈도 `racesWithEvent / eligibleRaces`를 채택한다. 관측 0/n은 0이며 결측 `null`과 다르다. 누락/특수 경기는 무사건으로 분모에 넣지 않는다.
- 기간은 종류별 `minDurationEpisodes=3`개 이상일 때 `durationLeaderLaps` 경험 분포에서 추출한다. 반복된 랩 수를 보존해 실제 관측 빈도를 유지한다. 이 수치는 구간이 걸친 선두 차량의 랩 수로, 부분 랩도 포함하며 모든 차량의 정확한 SC 주행시간은 아니다.
- 표본이 부족하면 빈도 기본 0.35/0.25, SC 기간 2·3·4·5랩 / VSC 1·2랩의 **프로젝트 추정**을 쓴다. 빈도와 기간의 게이트는 독립적이므로 빈도 fallback+관측 기간이 함께 적용될 수도 있다.
- 반환 `prior.evidence.sc/vsc`에 원래 확률·분자·분모·Wilson 95% 구간·`frequencyApplied`·`durationSource`가 남는다. 상위 `sourceType`만 보고 모든 숫자가 관측이라고 해석하지 않는다. Wilson 구간은 과거 발생 비율의 표본 불확실성이며 완주시간 P10/P90과 다른 통계다.
- 시행당 각 종류 최대 한 구간, 발생 시점 분포, SC/VSC 비중복 배치 및 자리가 없는 구간 생략은 프로젝트 운영 규칙이다. 과거에 여러 번 발생한 실제 사건열을 그대로 재연하는 것이 아니다.

재수집·검사는 다음과 같다. 첫 명령은 원격 자료와 출력 JSON을 갱신한다. `--offline-rebuild`를 추가하면 동일 캐시·기존 출력의 응답만 재분석하며 실패 요청을 다시 하지 않는다.

```sh
python tools/collect_neutralisation_evidence.py --workers 4 --cache-dir work/neutralisation-cache
python tools/check_neutralisation_evidence.py
```

## 공정한 반사실 비교

각 시행의 SC/VSC 타임라인을 **후보 평가 전에 한 번만 생성**하여 모든 후보가 공유한다. 교통·추월 난수는 `seed / trial / lap / followerId / rivalId` 키를 사용한다. 후보별 분기 또는 난수 호출 횟수가 달라도 동일한 상대·랩의 추첨은 변하지 않는다. 난수계산은 `trafficRandomDraw`로 직접 검수할 수 있다.

앞차와 이전 랩 종료 간격이 1초 이내이고 추격차가 더 빠를 때 `0.4 × 양의 페이스 차이`의 추종 손실을 더한다. 같은 랩에 앞차를 따라잡으면 RAC와 페이스 차이로 산출한 확률로 추월을 시도한다. 실패하면 앞차 뒤에 남아 생기는 추가 대기 손실을 집계한다. 피트 진입으로 인한 순위 변화는 온트랙 추월로 세지 않는다. SC/VSC 중에는 온트랙 추월을 허용하지 않는다.

피트 할인은 **진입 랩 종료 시점의 이벤트**에 적용한다. 예를 들어 L20 뒤 피트 손실이 결정론 원장에서는 L21에 청구되어도, L20까지 SC이고 L21부터 녹기이면 SC 할인이다. `MODEL_PARAMS.race`의 SC 0.55 / VSC 0.70은 정상 피트 비용에 곱하는 추정 배수다. 즉 정상 손실의 55% / 70%를 지불하며 절감률은 45% / 30%다.

## 결과 읽기

- `winRate`: 입력 후보 중 최단 총시간이었던 비율. 동률은 승점을 분할하므로 후보들의 합은 1이다.
- `gridWinRate`: 20대 가상 경기에서 1위였던 비율. `winRate`와 다른 값이다.
- `p10Seconds`, `p90Seconds`: 가상 시행 총시간의 선형 보간 분위수. 실제 경기 예측 정확도나 통계적 신뢰구간으로 부르면 안 된다.
- 평균 총시간·교통 손실·피트 절감·순위·추월 횟수 및 시행별 기록을 반환한다.
- 각 시행 기록의 `eventTimelineId`는 공통 `eventTimelines`의 항목을 가리킨다.
- `gridModel.kind`는 공유 20대 경로 `shared-replay-entries`와 호환 경로 `generic-fixed-pack`을 구별한다. 상대 ID·출발 위치·RAC·전략 서명도 반환해 배정을 확인할 수 있다.

## Worker 수명과 3D의 경계

UI는 `app/workers/race-experiment.worker.ts`의 실제 모듈 Worker에서 계산한다. 요청은 `{requestId,candidates,options}`, 응답은 같은 요청 ID와 `result` 또는 `error`다. 계산 중 취소, 시드·후보·참가자·피트·관측 사전값 변경, 컴포넌트 해제 시 이전 Worker를 종료한다. 이미 큐에 들어온 오래된 응답도 세대/요청 ID 검사로 막고, 결과의 시드·시행 수·후보 수·사전값이 현재 입력과 맞아야 채택한다.

**참가자·전략·기초 비용 공유는 최종 레이스 시계 공유가 아니다.** MC는 랩 단위 확률 교통과 피트 할인, 3D는 기존 결정론 그리드·교통·피트 원장을 사용한다. MC에 이미 3D 교통이 적용된 최종 비용을 주지 않는다. 선택한 MC 회차를 ReplayTelemetry에 전달하면 SC/VSC 띠·요약만 표시하며 3D 시각·순위에 할인·감속을 반영하지 않는다. 이 오버레이를 실제 해당 회차의 3D 재생이라고 부르지 않는다.

## 언더컷

`assessUndercut(attacker, defender, initialGapSeconds)`는 양수가 후행임을 뜻한다. 후행차가 먼저 같은 순번의 피트를 한 경우만 대상이다. 상대 피트 후 3랩 시점에 **양쪽이 완료한 스톱 수가 동일**하고 추격차가 0.5초 넘게 앞서야 성공이다. 정산 전에 경기가 끝나거나 스톱 수가 다르면 판정 보류다. 피트 직후의 임시 순위 상승만으로 성공이라고 하지 않는다.

## 한계와 출처

이 모형은 랩 단위 근사이고 한 시행에 SC/VSC 각각 최대 한 구간이다. MC에는 실제 SC 감속, 대열 압축, 랩다운 해제, 적기, 팀별 피트박스 큐, 모든 실차 상호작용을 구현하지 않는다. 관측 빈도·기간을 채택해도 교통·추월·피트 할인·발생 시점은 프로젝트 추정이며 2026 경기 확률로 검증된 것이 아니다. EA RAC를 넣어도 EA 게임의 공식 물리식이 되는 것은 아니다.

- [FIA 2026 Sporting Regulations Issue 08](https://www.fia.com/system/files/documents/fia_2026_f1_regulations_-_section_b_sporting_-_iss_08_-_2026-08-05_7.pdf): B5.12/B5.13은 VSC/SC 절차, B6.3.6은 실제 I/W 사용에 따른 건식 2종 의무 예외다. 수막 0.10 임계값은 FIA 면제 규정이 아니다.
- [F1 2024 Australian GP 보고](https://www.formula1.com/en/latest/article/sainz-storms-to-victory-amid-drama-in-australia-as-verstappen-retires-and.4ZVm82EhKLMcVIHurBPr8N): Alonso의 VSC 피트가 약 10초를 절약한 개별 사례. 범용 할인 배수의 근거로 사용할 수 없다.
- [McLaren 2026 일본 GP 전략 분석](https://www.mclaren.com/racing/formula-1/2026/japanese-grand-prix/strategy-debrief/): 녹기 대비 SC/VSC 피트 손실 차이 약 12초라는 개별 사례. 2018–2025 집계가 아니다.
- [F1 2025 중국 GP 프리뷰](https://www.formula1.com/en/latest/article/need-to-know-the-most-important-facts-stats-and-trivia-ahead-of-the-2025-Chinese-Grand-Prix.6GEncmIqVxHd6TyKdEQElz): SC/VSC 확률 각 75%와 일반 피트 손실 23.9초 제시. 이 페이지는 확률의 집계 기간/분모를 명시하지 않으므로 2018–2025 실측치로 재표기하지 않는다.
- [FastF1 공식 구현](https://github.com/theOehrly/Fast-F1/blob/main/fastf1/_api.py): TrackStatus는 상태 변화마다 기록하며 `4=SC`, `6=VSC 시작`, `7=VSC 종료 예고`, `1=실제 해제`다. 실측 발생률은 해당 기간의 실제 개최 경기를 모아 상태 기록이 유효한 경기만 분모로 삼아 별도로 산출해야 한다. 결측을 무사건 경기로 세면 안 된다.

## 검증

```sh
node --experimental-strip-types --test --test-isolation=none tests/race-experiments.test.mjs tests/shared-race-grid.test.mjs tests/race-experiment-worker.test.mjs tests/neutralisation-prior.test.mjs
```

공통 타임라인·동일 시드, 후보/상대 입력 순서 불변, 내 차 성능 중복 없음, 상대 기초 비용에 3D 교통 없음, 19대 ID/슬롯 검증, 실제 Worker 모듈·취소·오래된 응답 차단, 관측0/결측/표본 게이트·출처·기간 분리를 검사한다. Node의 실제 Worker 및 컴포넌트 훅/SSR 검사는 브라우저 DOM·GPU 검증과 별개다. 시드만 같고 코드·자료·상대 전략 풀이 다르면 같은 실험이 아니다.

2026-09-07 현재 작업 트리에서 위 명령의 32개 테스트가 모두 통과했다. 이 문서의 공유 그리드 API 예시도 실제로 실행해 300회 결과를 확인했다. 문서 검수 중 관측 원자료를 새로 수집하거나 계수를 변경하지 않았다.
