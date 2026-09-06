# 0절 — 공통 한국어화

검증일: 2026-09-06. 대상: juhyeonmoon10/compound 전용 체크아웃. 팀 저장소 변경 없음.

## 변경 파일
StrategyLab, RaceBriefingOverview, RaceReplay, FastF1AnalysisPanel, StrategyBacktestPanel, ExperimentNotebook, layout, pages/index.html, README, 표시 전용 app/ui-labels.ts. 테스트의 이전 영문/메뉴명 기대값만 한국어로 변경.

## 상수·출처
계산 상수 변경 없음. 원자료 값은 실측, 공식 서킷 제원은 공식 자료, 계산 결과는 모델 추정으로 구분. 출처·라이브러리 고유명, 차량명, S/M/H, FIA·CSV·MAE 등 기술 약어는 유지.

## 검사
- 전체 기존 테스트: **53 PASS / 0 FAIL**.
- 8랩 DP ↔ 완전탐색 Top 3: **PASS**.
- TypeScript: **PASS**.
- 변경 UI ESLint: **PASS**.
- 프로덕션 빌드: **PASS**. 3D 지연 로드 번들 707.6 kB 경고는 남아 있음.

## 실제 DOM 확인
로컬 `/compound/`에서 확인: `타이어 전략 분석 / 홈 / 전략 설계 / 데이터 분석 / 알고리즘·검증 / 정보·출처`, `앨버트 파크`, `막스 베르스타펜`, `선택한 드라이버`, `추천 타이어 전략`, `모델 제약 통과`, `동적계획법 최적화`.

## 남은 문제
날씨·능력치·확률 모델·보드 변경은 후속 절. 예측 값의 표시는 기존 화면에 따라 ‘추정/가정/설정’ 표현이 혼재하므로 새 데이터 카드에서는 ‘실측/프로젝트 추정/공식 자료’를 명시한다. 현재 Top 3 동률은 사실 그대로 유지하며 4절에서 후보 다양화를 처리한다.
