# 최근 5경기 공식 팀 페이스 자료 확인

## 결론

2026-09-06 조사에서 **최근 완료 확인된 5개 GP의 공식 팀별 Race Simulation Pace 숫자는 확보하지 못했다.** 따라서 `app/data/official-team-pace.json`의 11팀 × 5경기 값은 모두 `null`이다. 이는 팀 간 차이가 0이라는 뜻도, 해당 자료가 어디에도 없다는 뜻도 아니다.

오스트리아·영국의 Formula1.com 전략 가이드는 발견했지만 도입부 이후 F1 Unlocked 로그인이 필요했다. 다른 세 경기에서는 공식 Pirelli 전략 설명을 확인했으나 공개 본문에 팀별 페이스 차트의 숫자 표가 없었다. 로그인 제한은 우회하지 않았다.

## 최근 5경기의 정의

기준 시각은 **2026-09-06 14:42:50 UTC**이다. [현재 공식 F1 캘린더](https://www.formula1.com/en/racing/2026)에서 종료일이 지난 GP 중 레이스 순위 요약이 확인되는 경기만 최신순으로 선정했다. 스프린트는 별도 GP로 중복 집계하지 않았다.

| 대상 GP | 레이스 날짜 | 현재 캘린더 라운드 | 확인한 공식 자료 |
| --- | --- | --- | --- |
| 네덜란드 | 2026-08-23 | 12 | [F1의 예선·스프린트 정리와 Pirelli 사전 전략 설명](https://www.formula1.com/en/latest/article/what-the-teams-said-sprint-day-and-qualifying-in-the-netherlands-2026.1vJ9dLmIstL3qivbyY0OEu) |
| 헝가리 | 2026-07-26 | 11 | [F1의 예선 정리와 Pirelli 사전 전략 설명](https://www.formula1.com/en/latest/article/what-the-teams-said-qualifying-in-hungary-2026.3feA3778bfyv3miQvTeRha) |
| 벨기에 | 2026-07-19 | 10 | [F1의 예선 정리와 Pirelli 사전 전략 설명](https://www.formula1.com/en/latest/article/what-the-teams-said-qualifying-in-belgium-2026.2zTZf4gN1Db4YuqMTTMZhO) |
| 영국 | 2026-07-05 | 9 | [F1 공식 전략 가이드 — 로그인 이후 본문 미열람](https://www.formula1.com/en/latest/article/strategy-guide-what-are-the-tactical-options-for-the-british-gp.361P7x4M10QJA3Dyuj5aNb) |
| 오스트리아 | 2026-06-28 | 8 | [F1 공식 전략 가이드 — 로그인 이후 본문 미열람](https://www.formula1.com/en/latest/article/strategy-guide-what-are-the-options-for-the-2026-austrian-grnad-prix.4oSu1owWYz8ZtHv79KW3zv.4oSu1owWYz8ZtHv79KW3zv.4oSu1owWYz8ZtHv79KW3zv) |

[이탈리아 GP](https://www.formula1.com/en/racing/2026/italy)는 2026-09-06 경기지만 조사 기준 시각에 캘린더에서 Current로만 표시되고 레이스 결과 요약이 없었다. **미래 경기라고 단정한 것이 아니라 완료 확인이 안 되어 이번 창에서 제외했다.** 공식 종료 결과가 확인되면 이탈리아를 포함하고 오스트리아를 제외하는 재조사가 필요하다. 레이스가 진행 중인 날의 스냅샷이므로 날짜만으로 자동 교체하면 안 된다.

초기 발표 일정과 현재 캘린더의 라운드 번호가 다를 수 있다. 날짜와 대회명으로 식별하며, 초기 24경기 발표의 번호를 그대로 합치지 않는다.

## 확인 결과와 채택하지 않은 정보

- **네덜란드:** 공개 Pirelli 설명은 컴파운드 선택과 피트 구간을 다룬다. 이는 특정 팀의 랩당 상대 페이스 수치가 아니다. 팀별 차트 값은 미확보다. 별도의 [공식 타이어 배정 기사](https://www.formula1.com/en/latest/article/what-tyres-will-the-teams-and-drivers-have-for-the-2026-dutch-grand-prix.402ufleb78rXrqaispof9U)도 확인했지만 같은 이유로 페이스 숫자로 사용하지 않았다.
- **헝가리:** 1스톱·2스톱 선택과 타이어 재고에 관한 Pirelli 설명은 있지만, 팀별 레이스 페이스 표는 확보하지 못했다. [공식 타이어 배정 기사](https://www.formula1.com/en/latest/article/what-tyres-will-the-teams-and-drivers-have-for-the-2026-hungarian-grand-prix.RikSxOCPXMkPloK0RRmqQ)의 컴파운드·노면 설명도 팀 능력치로 환산하지 않았다.
- **벨기에:** 공개 기사에 있는 예선 랩타임과 전략 간 총시간 차이는 팀별 Race Simulation Pace와 지표가 달라 제외했다. [Pirelli 공식 인포그래픽 페이지](https://www.pirelli.com/global/en-ww/emotions-and-numbers/formula-1-moet-chandon-belgian-grand-prix-2026-195553/)는 PREVIEW / RACE / PIT STOPS를 제공한다. RACE·PIT STOPS 이미지 요청은 사용한 웹 도구에서 Internal Error로 실패했으며, 이 접근 실패를 미공개나 0초로 해석하지 않았다.
- **영국·오스트리아:** F1 Unlocked 안내까지 공개 접근을 확인했다. 로그인 이후에 요청한 차트가 실제로 있는지, 숫자가 무엇인지는 확인하지 못했다. 따라서 단정적인 `chart-published` 또는 `chart-absent`가 아니라 `article-found-content-gated` 상태다.

검색에서 나온 [2025 네덜란드 전략 가이드](https://www.formula1.com/en/latest/article/strategy-guide-what-are-the-tactical-options-for-the-dutch-grand-prix.6wROSudsWbMzzIFvkSK2rh.6wROSudsWbMzzIFvkSK2rh)는 2025-08-30 기사여서 제외했다. [Strategy Guide 태그 페이지](https://www.formula1.com/en/latest/tags/strategy-guide.1gNf1yTbtu1b9tQ5F93lLH)는 검색 도구에서 영국 GP까지의 오래된 목록으로 반환되었다. 이것만으로 이후 기사가 존재하지 않는다고 결론 내릴 수 없다.

`publishedAt: null`은 기사 공개 시각을 이번 열람으로 확정하지 못했다는 뜻이다. 경기 날짜나 확인일로 이를 채우지 않는다.

## 숫자 전사·소비 규칙

1. 팀 이름과 대응 숫자 라벨 또는 표 셀, 단위, 기준팀/기준값을 함께 확인한 경우만 채택한다. 차트 이미지 URL과 해당 경기 날짜도 기록한다.
2. 막대 픽셀 길이·색상·순위를 눈대중으로 초 단위로 바꾸지 않는다. 명시 라벨이 없는 값은 `null`을 유지한다.
3. FP 최고기록, 예선 기록, 순위표, “빠르다” 같은 인터뷰 표현, 타이어 전략 간 총시간 차이는 이 차트의 팀별 페이스 값이 아니다.
4. 검증된 상대 차트의 기준팀 0초와 누락 `null`을 구분한다. `Number(null)`, `value || 0`로 결측을 채우면 안 된다.
5. 5경기 평균을 나중에 만들 때는 유효 경기 수와 결측 수를 노출한다. 서로 다른 단위·기준의 값을 바로 평균 내지 않는다. 드라이버 능력치 보정과 결합할 때 중복 설명 가능성도 따로 검토한다.
6. Formula1.com의 분석 차트도 실제 차량 텔레메트리나 팀 엔지니어의 내부 물리 계수와 동일하다고 표현하지 않는다. 관측치와 공식 분석·프로젝트 변환을 구분한다.

현재 JSON은 `modelUse.available: false`다. 실행 모형이 중립 페이스 보정을 사용하더라도 그것은 **프로젝트 fallback**이며, 공식 원자료가 0초라는 뜻이 아니다. 이 파일은 원자료 수치를 채우기 전까지 누락 근거로만 사용한다.

## FastF1 2026 최근 2경기 접근 확인

실행 환경의 FastF1 **3.8.3**을 사용해 경기명과 `session.api_path`를 얻고, **2026-09-06 14:47:52 UTC**에 공식 `SessionInfo.json`만 GET 요청했다.

| 경기 | 세션 메타데이터 URL | 실제 응답 |
| --- | --- | --- |
| Dutch Grand Prix | [공식 SessionInfo](https://livetiming.formula1.com/static/2026/2026-08-23_Dutch_Grand_Prix/2026-08-23_Race/SessionInfo.json) | HTTP 200 · Meeting.Name 일치 · Name=Race |
| Hungarian Grand Prix | [공식 SessionInfo](https://livetiming.formula1.com/static/2026/2026-07-26_Hungarian_Grand_Prix/2026-07-26_Race/SessionInfo.json) | HTTP 200 · Meeting.Name 일치 · Name=Race |

`session.load()`, 랩·기상 데이터 수집, 분석, 계수 계산은 진행하지 않았다. 원래 요청의 다른 데이터 수집 작업과 중복하지 않기 위해 세션 존재 여부만 확인했다. 기본 샌드박스에서는 패키지·네트워크 접근이 실패하여 승인된 읽기 전용 확인으로 재시도했다. 라이브러리는 기본 임시 캐시 초기화 경고를 출력했지만 분석용 캐시를 새로 수집하지 않았다.

**HTTP 200은 전체 랩 데이터의 완전성·품질·분석 가능성을 보장하지 않는다.** 그러나 “2026 자료가 모두 미래여서 존재하지 않는다”는 설명은 틀리다. 최신 실제 타이밍 분석을 채택하려면 별도 수집에서 결측·타이어 수명·SC/VSC·기상·운전자/팀 혼재를 검증해야 한다.

FastF1에서 계산한 팀별 평균이나 회귀 잔차를 나중에 쓰더라도 출처는 **공식 타이밍 기반 프로젝트 분석**이다. 이를 **공식 Race Simulation Pace 차트 전사값**으로 이름만 바꾸어 넣어서는 안 된다.

## 파일 범위

이번 조사에서 추가한 파일은 `app/data/official-team-pace.json`과 이 문서다. UI·팀 성능 모형·기존 분석 데이터는 변경하지 않았다.
