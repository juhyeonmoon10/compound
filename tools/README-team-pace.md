# 팀 페이스 근거·재현·실행 모델 연결

## 결론

2026-09-06 조사에서 **최근 완료 확인된 5개 GP의 공식 팀별 Race Simulation Pace 숫자는 확보하지 못했다.** 따라서 `app/data/official-team-pace.json`의 11팀 × 5경기 값은 모두 `null`이다. 이는 팀 간 차이가 0이라는 뜻도, 해당 자료가 어디에도 없다는 뜻도 아니다.

별도의 FastF1 수집은 완료했다. `app/data/recent-team-evidence.json`에는 **2026 네덜란드·헝가리의 공식 타이밍 기반 프로젝트 관측 분석**과, 섞지 않은 2025 같은 두 경기 비교가 있다. 현재 실행 모델은 이 관측을 소비하지만, 이를 확보하지 못한 공식 Race Simulation Pace 차트 값이라고 부르지 않는다. 아래 ‘최근’은 기록된 조사 기준 시각의 스냅샷이며 자동 갱신되는 최신 자료가 아니다.

오스트리아·영국의 Formula1.com 전략 가이드는 발견했지만 도입부 이후 F1 Unlocked 로그인이 필요했다. 다른 세 경기에서는 공식 Pirelli 전략 설명을 확인했으나 공개 본문에 팀별 페이스 차트의 숫자 표가 없었다. 로그인 제한은 우회하지 않았다.

## 최근 5경기의 정의

기준 시각은 **2026-09-06 14:42:50 UTC**이다. [공식 F1 캘린더](https://www.formula1.com/en/racing/2026)의 당시 상태에서 종료일이 지난 GP 중 레이스 순위 요약이 확인되는 경기만 최신순으로 선정했다. 스프린트는 별도 GP로 중복 집계하지 않았다.

| 대상 GP | 레이스 날짜 | 현재 캘린더 라운드 | 확인한 공식 자료 |
| --- | --- | --- | --- |
| 네덜란드 | 2026-08-23 | 12 | [F1의 예선·스프린트 정리와 Pirelli 사전 전략 설명](https://www.formula1.com/en/latest/article/what-the-teams-said-sprint-day-and-qualifying-in-the-netherlands-2026.1vJ9dLmIstL3qivbyY0OEu) |
| 헝가리 | 2026-07-26 | 11 | [F1의 예선 정리와 Pirelli 사전 전략 설명](https://www.formula1.com/en/latest/article/what-the-teams-said-qualifying-in-hungary-2026.3feA3778bfyv3miQvTeRha) |
| 벨기에 | 2026-07-19 | 10 | [F1의 예선 정리와 Pirelli 사전 전략 설명](https://www.formula1.com/en/latest/article/what-the-teams-said-qualifying-in-belgium-2026.2zTZf4gN1Db4YuqMTTMZhO) |
| 영국 | 2026-07-05 | 9 | [F1 공식 전략 가이드 — 로그인 이후 본문 미열람](https://www.formula1.com/en/latest/article/strategy-guide-what-are-the-tactical-options-for-the-british-gp.361P7x4M10QJA3Dyuj5aNb) |
| 오스트리아 | 2026-06-28 | 8 | [F1 공식 전략 가이드 — 로그인 이후 본문 미열람](https://www.formula1.com/en/latest/article/strategy-guide-what-are-the-options-for-the-2026-austrian-grnad-prix.4oSu1owWYz8ZtHv79KW3zv.4oSu1owWYz8ZtHv79KW3zv.4oSu1owWYz8ZtHv79KW3zv) |

[이탈리아 GP](https://www.formula1.com/en/racing/2026/italy)는 2026-09-06 경기지만 조사 기준 시각에 캘린더에서 Current로만 표시되고 레이스 결과 요약이 없었다. **미래 경기라고 단정한 것이 아니라 완료 확인이 안 되어 이번 창에서 제외했다.** 공식 종료 결과가 확인되면 이탈리아를 포함하고 오스트리아를 제외하는 재조사가 필요하다. 레이스가 진행 중인 날의 스냅샷이므로 날짜만으로 자동 교체하면 안 된다.

초기에 공지된 일정과 조사 시점 캘린더의 라운드 번호가 다를 수 있다. 날짜와 대회명으로 식별하며, 최초 24경기 일정의 번호를 그대로 합치지 않는다.

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

## 1차 접근 확인과 후속 실제 수집

실행 환경의 FastF1 **3.8.3**을 사용해 경기명과 `session.api_path`를 얻고, **2026-09-06 14:47:52 UTC**에 공식 `SessionInfo.json`만 GET 요청했다.

| 경기 | 세션 메타데이터 URL | 실제 응답 |
| --- | --- | --- |
| Dutch Grand Prix | [공식 SessionInfo](https://livetiming.formula1.com/static/2026/2026-08-23_Dutch_Grand_Prix/2026-08-23_Race/SessionInfo.json) | HTTP 200 · Meeting.Name 일치 · Name=Race |
| Hungarian Grand Prix | [공식 SessionInfo](https://livetiming.formula1.com/static/2026/2026-07-26_Hungarian_Grand_Prix/2026-07-26_Race/SessionInfo.json) | HTTP 200 · Meeting.Name 일치 · Name=Race |

위 표는 **14:47:52 UTC의 1차 메타데이터 확인만** 기록한 것이다. 이 단계에서는 `session.load()`를 호출하지 않았다. 이후 별도 수집기가 랩·기상 자료를 읽고 분석했으며, 최신 저장 산출물의 `generatedAt`은 `2026-09-06T15:18:16.865466+00:00`이다. 메타데이터 HTTP 200과 분석 완료를 같은 확인으로 취급하지 않는다.

| 시즌 | 대회 | 원시 랩 | 정제 랩 | 용도 |
| --- | --- | ---: | ---: | --- |
| 2026 | 네덜란드·헝가리 2경기 | 2,799 | 1,978 | 현재 팀 관측 입력 |
| 2025 | 같은 두 대회 2경기 | 2,732 | 2,116 | 별도 비교, 2026 값과 혼합하지 않음 |

현재 JSON의 팀·컴파운드 행은 103개, 페이스 유효 행은 76개, 열화 값이 있는 행은 15개다. 이들은 서로 다른 품질 게이트를 쓰므로 전부 실행 능력치가 되는 것은 아니다. 2026의 11개 팀 모두 현재 페이스 최소 2경기 게이트를 통과하지만, 열화 채택 게이트를 통과한 팀은 메르세데스·페라리뿐이다. 다른 팀의 열화 1배는 관측 결과가 정확히 1이라는 뜻이 아니라 중립 fallback이다.

**HTTP 200은 전체 랩 데이터의 품질을 보장하지 않는다.** 수집기는 타이어·랩타임·수명 결측, `IsAccurate`, 삭제/합성 랩, 녹기 상태, 피트 인/아웃, 첫 랩, 상태 전환 직후 랩, `Rainfall=False`, 유효 노면 온도, 스틴트 단일 컴파운드·단조 수명·최소 길이와 잔차 IQR을 검사한다. `Rainfall=False`도 실제 노면이 말랐다는 보장은 아니다.

## 관측에서 실행 계수까지

1. 각 경기에서 랩 진행·온도·컴파운드 수명항을 조정하고, 같은 컴파운드 전체 중앙값 대비 팀 페이스 차이를 구한다. 팀·선수·교통·연료·운영 효과가 완전히 분리되지는 않는다.
2. 팀·컴파운드 페이스는 최소 20랩·2스틴트인 유효 관측만 쓴다. 경기 안에서는 유효 랩 수로 가중하고, 경기를 합칠 때는 경기별 동등 가중을 쓴다. 2026과 2025를 섞지 않는다.
3. `getRecentTeamPerformance`는 최소 2경기가 있어야 페이스를 채택한다. 관측 차이에 프로젝트 축소율 0.25를 곱하고 ±0.6초/랩 범위로 제한한다.
4. `getAdoptedTeamPerformance`는 확보된 팀 중 가장 빠른 위 값을 기준 0초로 옮긴다. 이 상대 기준 이동도 프로젝트 규칙이다. 관측 미확보 팀은 다른 팀의 값으로 채우지 않고 0초 중립으로 둔다.
5. 열화는 최소 20랩·4스틴트, 양수 추정과 양의 95% 구간, 양의 동컴파운드 기준 기울기, 최소 2경기가 필요하다. 관측 비율에 축소율 0.25를 적용하고 0.9–1.15배로 제한한다. 게이트 미달은 1배다. 원래 회귀 계수를 음수라는 이유만으로 0에 잘라 ‘실측’으로 쓰지 않는다.
6. `resolveEntryPerformance`가 팀 관측의 프로젝트 변환과 EA 점수 변환을 결합한다. `applyEntryPerformance`가 DP 전에 내 차에 한 번 적용하고, 20대 그리드에는 상대와 내 차의 차이만 더한다. 동일 성능 모드에서는 페이스 0초·마모/우천 배수 1로 중립화한다.

수집·품질 상수는 JSON의 `methodology.thresholds`, 실행 축소·범위·최소 경기 수는 `app/model/params.ts`의 `historical`·`performance`가 기준이다. 관측의 IQR은 산포이며 예측 신뢰구간이 아니다. 열화 95% 구간도 소수 스틴트와 이미 추정한 환경 보정에 조건부인 탐색적 구간이다. β나 팀 열화를 보정했다고 클리프 시작 랩을 학습한 것은 아니다.

정차 교체 시간은 `null`, 피트크루 추가 비용은 0초다. `PitInTime`/`PitOutTime`을 바퀴 교체 정지시간으로 오인하지 않는다. 2025 Kick Sauber는 별도 ID로 보존하며 2026 Audi 관측으로 바꾸지 않는다. Cadillac에는 2025 대응 팀을 만들어 넣지 않는다. EA 보정과 팀 관측에는 같은 선수 영향이 중복 설명될 가능성도 남는다.

## 실제 재실행 명령

저장소 루트에서 Python 3.11 이상을 사용한다. 네트워크가 필요한 수집과, 저장된 자료·합성 입력을 검사하는 명령을 구분한다.

```sh
python -m pip install -r analysis/requirements.txt
python tools/collect_recent_team_evidence.py --help
python tools/collect_recent_team_evidence.py --cache-dir work/fastf1-cache --output app/data/recent-team-evidence.json
python tools/check_recent_team_evidence.py
node --experimental-strip-types --test --test-isolation=none tests/recent-team-performance.test.mjs tests/entry-performance.test.mjs tests/entry-grid-performance.test.mjs
```

- 실제 CLI 옵션은 `--cache-dir`, `--output` 두 개다. `--season`, `--years`, `--workers` 옵션은 없다. 대회 `EVENTS`와 연도 `YEARS=(2026, 2025)`는 수집기 상수이며 최신 두 경기를 자동 선택하지 않는다.
- 캐시 기본값은 저장소 바깥 `../fastf1-cache`다. 위 명령은 위치를 명확히 하려고 저장소 안 `work/fastf1-cache`를 지정한다. 누락 캐시는 원격에서 읽으며 오프라인을 보장하지 않는다.
- 각 경기 처리 뒤 JSON을 저장하지만 완료 여부로 경기 계산을 건너뛰는 `--resume` 모드는 없다. 다시 실행하면 4경기를 다시 분석하고 FastF1 캐시만 재사용한다. 출력 파일은 덮어쓰므로 원본을 보존할 때는 `--output work/recent-team-evidence-review.json` 같은 별도 경로를 사용한다. 검사기는 기본 `app/data/recent-team-evidence.json`을 읽는다.
- 수집기를 실행해도 `official-team-pace.json`의 차트 결측은 채워지지 않는다. 공식 숫자가 확보되면 단위·기준팀·출처·기사 시점과 실제 숫자 라벨을 별도로 검증해야 한다. 유료 콘텐츠·로그인 제한을 우회하지 않는다.

## 파일과 검증 범위

- 원자료·확인 이력: `app/data/recent-team-evidence.json`, `app/data/official-team-pace.json`.
- 수집·검사: `tools/collect_recent_team_evidence.py`, `tools/check_recent_team_evidence.py`. 역사 수집기의 전처리·회귀 함수를 재사용한다.
- 소비: `app/lib/recent-team-performance.ts`, `app/lib/entry-performance.ts`, `app/lib/shared-race-grid.ts`, `app/lib/race-grid.ts`.
- 회귀 검사: 결측 null 보존, 2025/2026 분리, 최소 표본·양의 구간, 기준 이동, 동일 성능 중립, 내 차 중복 보정 방지. 실제 화면 QA와 예측 정확도 검증은 별개다.

2026-09-07 문서 검수에서 수집기 `--help`, 기존 JSON의 Python 불변식/합성 검사,
위 Node 명령의 팀·능력치·그리드 18개 테스트를 재실행해 모두 통과했다.
이번 검수에서는 원격 자료 재수집·수치 갱신·브라우저 조작을 하지 않았다.

위 자료는 수집 시점의 관측 스냅샷이다. 최신 두 경기 예측의 홀드아웃 정확도나 차량 고유 물리 성능을 검증한 자료로 사용하면 안 된다.
