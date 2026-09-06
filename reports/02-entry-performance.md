# 2절 · 팀·드라이버 성능

- 변경: StrategyLab, RaceReplay, race-grid, entry-performance, driver-ratings, PerformanceEvidencePanel, params, strategy, weather.css. EA 원본 점수 JSON과 역사 관측의 소형 집계/계수 소비자를 추가했다. 수집기는 tools/fetch_ea_ratings.py.
- 상수/출처: params.performance의 PAC→초, EXP→마모, OVR/AWA→우천, 중립값과 팀 열화 범위. EA 공식 점수와 이를 시간으로 바꾸는 프로젝트 규칙을 분리한다. EA https://www.ea.com/games/f1/ratings / iteration 2026june / 확인 2026-09-06.
- 검사: 커밋할 index를 별도 폴더로 추출해 전체 79 PASS, 0 FAIL. TypeScript PASS. 기존 건식 DP↔완전탐색 PASS, 젖은 5종·3스톱 완전탐색 PASS. 내 차 중복 적용 방지, 상대 계수 차이만 적용, 동일 성능의 정확한 중립성 PASS.
- DOM: 헤더 ‘동일 성능 모드’ 기본 해제. 데이터 화면 ‘게임 평가점수와 모델 보정을 구분합니다.’ 및 ‘현재 팀 페이스 +0.022초/랩 … 팀·선수 합산 열화 1.0182배’ 확인. 브라우저는 병렬 작업 중인 5절 보드를 포함한 통합 빌드이며 index 자체 검사는 위 별도 폴더 결과다.
- 남은 문제: 팀 성능은 동컴파운드 관측을 축소 반영한 프록시로 차량 고유 성능의 실측이 아니다. 2026 랩 추가 수집은 진행 중. 피트레인 시간을 정지시간으로 오인하지 않도록 피트크루는 미분리/0초 중립. 공식 최신 5경기 시뮬레이션 페이스 차트에서 수치를 확보하지 못한 값은 만들지 않는다.
