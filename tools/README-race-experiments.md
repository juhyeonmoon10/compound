# 후보 전략 확률 평가

`app/lib/race-experiments.ts`의 `runRaceExperiments(candidates, options)`는 **이미 계산된 합법 전략**을 기본 300개의 재현 가능한 가상 경기에서 비교한다. 교통 상태와 SC/VSC를 포함한 새로운 DP 최적화기가 아니다.

## 사용

```ts
const experiment = runRaceExperiments(topThree, {
  seed: 20260906,
  trackLaps: 58,
  pitLossSeconds: 20.5,
  racecraft: 93,
});
```

- `candidates`: 같은 랩 수를 완전히 포함한 `StrategyEvaluation[]`.
- `rivalStrategies`: 모든 후보에 공통 적용할 상대 전략 풀. 생략하면 후보들을 정규 식별자로 정렬해 사용한다. 후보 순서를 바꾸어도 상대 배정은 같다.
- `startingGridPosition`: 20대 중 시작 위치. 기본 10위. 나머지 19대의 슬롯·기본 페이스 차이는 고정이다.
- `eventPrior`: 경기당 SC/VSC 한 구간 발생 확률. 기본 0.35/0.25는 공식 2018–2025 전 서킷 통계를 확보하지 못해 쓰는 **프로젝트 추정**이다. 랩당 발생확률이 아니다. 실측 사전확률로 표시하려면 출처 URL과 표본 경기 수를 반드시 제공한다.
- `trials`, `seed`: 결과 재현 및 경량 테스트용 설정. 기본 시행 수는 300이다.

## 공정한 반사실 비교

각 시행의 SC/VSC 타임라인을 **후보 평가 전에 한 번만 생성**하여 모든 후보가 공유한다. 교통·추월 난수는 `seed / trial / lap / followerId / rivalId` 키를 사용한다. 후보별 분기 또는 난수 호출 횟수가 달라도 동일한 상대·랩의 추첨은 변하지 않는다. 난수계산은 `trafficRandomDraw`로 직접 검수할 수 있다.

앞차와 이전 랩 종료 간격이 1초 이내이고 추격차가 더 빠를 때 `0.4 × 양의 페이스 차이`의 추종 손실을 더한다. 같은 랩에 앞차를 따라잡으면 RAC와 페이스 차이로 산출한 확률로 추월을 시도한다. 실패하면 앞차 뒤에 남아 생기는 추가 대기 손실을 집계한다. 피트 진입으로 인한 순위 변화는 온트랙 추월로 세지 않는다. SC/VSC 중에는 온트랙 추월을 허용하지 않는다.

피트 할인은 **진입 랩 종료 시점의 이벤트**에 적용한다. 예를 들어 L20 뒤 피트 손실이 결정론 원장에서는 L21에 청구되어도, L20까지 SC이고 L21부터 녹기이면 SC 할인이다. 할인 계수는 `MODEL_PARAMS.race`의 추정치다.

## 결과 읽기

- `winRate`: 입력 후보 중 최단 총시간이었던 비율. 동률은 승점을 분할하므로 후보들의 합은 1이다.
- `gridWinRate`: 20대 가상 경기에서 1위였던 비율. `winRate`와 다른 값이다.
- `p10Seconds`, `p90Seconds`: 가상 시행 총시간의 선형 보간 분위수. 실제 경기 예측 정확도나 통계적 신뢰구간으로 부르면 안 된다.
- 평균 총시간·교통 손실·피트 절감·순위·추월 횟수 및 시행별 기록을 반환한다.
- 각 시행 기록의 `eventTimelineId`는 공통 `eventTimelines`의 항목을 가리킨다.

## 언더컷

`assessUndercut(attacker, defender, initialGapSeconds)`는 양수가 후행임을 뜻한다. 후행차가 먼저 같은 순번의 피트를 한 경우만 대상이다. 상대 피트 후 3랩 시점에 **양쪽이 완료한 스톱 수가 동일**하고 추격차가 0.5초 넘게 앞서야 성공이다. 정산 전에 경기가 끝나거나 스톱 수가 다르면 판정 보류다. 피트 직후의 임시 순위 상승만으로 성공이라고 하지 않는다.

## 한계와 출처

이 모형은 랩 단위 근사이고 한 시행에 SC/VSC 각각 최대 한 구간이다. 실제 SC 감속, 대열 압축, 랩다운 해제, 적기, 팀별 피트박스 큐, 모든 실차 상호작용은 구현하지 않는다. 이벤트 사전값과 지속시간·교통·추월 계수는 실측 보정 전 추정이다. EA RAC를 넣어도 EA 게임의 공식 물리식이 되는 것은 아니다.

- [FIA 2026 Sporting Regulations Issue 08](https://www.fia.com/system/files/documents/fia_2026_f1_regulations_-_section_b_sporting_-_iss_08_-_2026-08-05_7.pdf): B5.12/B5.13은 VSC/SC 절차, B6.3.6은 실제 I/W 사용에 따른 건식 2종 의무 예외다. 수막 0.10 임계값은 FIA 면제 규정이 아니다.
- [F1 2024 Australian GP 보고](https://www.formula1.com/en/latest/article/sainz-storms-to-victory-amid-drama-in-australia-as-verstappen-retires-and.4ZVm82EhKLMcVIHurBPr8N): Alonso의 VSC 피트가 약 10초를 절약한 개별 사례. 범용 할인 배수의 근거로 사용할 수 없다.
- [McLaren 2026 일본 GP 전략 분석](https://www.mclaren.com/racing/formula-1/2026/japanese-grand-prix/strategy-debrief/): 녹기 대비 SC/VSC 피트 손실 차이 약 12초라는 개별 사례. 2018–2025 집계가 아니다.
- [F1 2025 중국 GP 프리뷰](https://www.formula1.com/en/latest/article/need-to-know-the-most-important-facts-stats-and-trivia-ahead-of-the-2025-Chinese-Grand-Prix.6GEncmIqVxHd6TyKdEQElz): SC/VSC 확률 각 75%와 일반 피트 손실 23.9초 제시. 이 페이지는 확률의 집계 기간/분모를 명시하지 않으므로 2018–2025 실측치로 재표기하지 않는다.
- [FastF1 공식 구현](https://github.com/theOehrly/Fast-F1/blob/main/fastf1/_api.py): TrackStatus는 상태 변화마다 기록하며 `4=SC`, `6=VSC 시작`, `7=VSC 종료 예고`, `1=실제 해제`다. 실측 발생률은 해당 기간의 실제 개최 경기를 모아 상태 기록이 유효한 경기만 분모로 삼아 별도로 산출해야 한다. 결측을 무사건 경기로 세면 안 된다.

검증: `node --experimental-strip-types --test --test-isolation=none tests/race-experiments.test.mjs`
