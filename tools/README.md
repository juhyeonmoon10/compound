# 실제 경기 근거 데이터 재현

```sh
python -m pip install -r analysis/requirements.txt
python tools/collect_historical_evidence.py --workers 3
python tools/build_calibration_summary.py
python tools/check_historical_evidence.py
python tools/test_historical_selection.py
```

기존 FastF1 캐시가 있다면 `--cache-dir <캐시 경로>`를 지정합니다.
동시 작업은 최대 3개이며, 경기별 중간 집계는 `work/evidence-checkpoints`에
저장합니다. 재실행은 같은 수집기 버전의 완료된 경기를 재사용합니다.
분석식을 수정했다면 체크포인트 버전도 올려야 합니다.

## 산출물

- `app/data/historical-dry-2023-2025.json`: 7개 서킷 × 2023–2025년,
  실제 성공한 경기와 정제 단계별 표본 수, TyreLife 및 제곱항 회귀,
  계수별 식별 가능성·95% 구간, 스틴트 시간순 홀드아웃 오차,
  동컴파운드 팀별 관측 페이스/열화 프록시, 피트 손실 추정.
- `app/data/wet-weather-2025.json`: 2025 호주·영국·벨기에의
  Rainfall·TrackTemp·Humidity를 랩에 조인한 집계와 같은 경기/같은 랩의
  서로 다른 타이어 그룹 중앙값 비교. 전체 wet 원시 랩 수와 품질 필터 후
  표본 수는 구분됩니다.
- `app/data/dataset-manifest.json`: 수집 상태, 실제 합산 표본과 검증 오차,
  24개 서킷의 피트 추정 확보/미확보 상태, 출처·단위·가정값 메타데이터.
- `app/data/calibration-summary.json`: 초기 화면에서 전체 회귀 첨부 JSON을
  읽지 않도록 만든 경량 런타임 요약. 원시 전체자료 2차 추정과 별도로,
  학습구간에서 선택한 선형/2차 계수·홀드아웃 오차를 포함합니다.

실패 경기는 0랩·`unavailable`로 기록하고 숫자를 보간하지 않습니다.
`dataset-manifest.json`의 피트 표는 역사 수집기와 호주 우천 보조 세션에서
얻은 표본만 담은 초기 단계의 결과이며 24서킷 전용 수집 결과가 아닙니다.
후속 전용 수집기는 별도 `pit-loss-evidence.json`·`pit-loss-summary.json`에
현 24서킷 중 23개 관측 프록시를 확보했습니다. 역사 manifest의 결측을
프로젝트 전체의 현재 미수집 상태로 해석하면 안 됩니다.
호주 우천 사례는 건식 21경기 합계에 포함하지 않습니다.
`--years`에 2025가 있으면 `--tracks`와 별개로 호주 우천 세션이 추가됩니다.

## 해석상의 제한

1. TyreLife는 FastF1의 실제 타이어 사용 랩 수입니다. 새 타이어를 0부터
   세는 시뮬레이터 tyreAge와 기준이 다릅니다. `TyreLife = age + 1`인
   새 세트의 경우 계수 변환은 `alpha_engine = alpha + 2 beta`,
   `beta_engine = beta`이며 상수항도 `alpha + beta`만큼 달라집니다.
   사용한 타이어는 초기 수명값을 별도로 처리해야 합니다.
2. 2차 회귀의 alpha/beta는 음수가 될 수 있습니다. 식별 불가 항은
   null로 내보내며, 개별 계수의 부호를 임의로 뒤집거나 0으로 잘라서
   실측값처럼 사용하면 안 됩니다. `reliable`은 관측 중간 수명에서의
   미분 기울기와 표본 수에 대한 프로젝트 기준입니다. 전 구간의 양의
   열화 또는 2026 예측 정확성을 보장하지 않습니다.
3. 95% 구간은 드라이버-스틴트 단위 군집 강건 표준오차의 점근 구간입니다.
   팀 추정도 군집 구간이나 표본이 작을 수 있어 능력치 정답이 아닙니다.
   팀 페이스는 경기 진행·온도·경기별 컴파운드 수명항을 제거한 뒤
   같은 컴파운드 중앙값 대비 차이입니다. 선수·운영·교통은 남습니다.
4. 피트 손실은 `(인랩+아웃랩)−2×주변 정상랩 중앙값`으로 계산한 관측
   프록시입니다. 차가 멈춰 있던 교체 시간과 다르며, 연료·교통·신품
   타이어 차이가 남습니다. 공식 녹색기인 연속 인/아웃랩만 사용합니다.
5. Rainfall은 강수 여부 boolean이며 강수량·노면 물 깊이가 아닙니다.
   실제 같은 랩에서 INTER/WET가 공존하지 않으면 둘의 전환점이나
   우천 그립을 학습했다고 주장하지 않습니다.
6. 상대 SOFT/MEDIUM/HARD는 경기마다 다른 절대 배합일 수 있습니다.
   C1–C5 배정을 확인하지 않고 여러 경기의 계수를 같은 물성으로 합치지
   않습니다. 파일에 절대 배합을 추측해 넣지 않습니다.

## 학습 전용 중첩 모델 선택

`modelSelection`은 전체자료 2차 진단 `coefficients`와 구분됩니다.
앞 75% 학습자료에서 β의 95% 구간이 양수이고 `alpha + 2 beta >= 0`인
식별 가능한 항을 검사합니다. 지원되지 않는 제곱항을 제거해 혼합
선형/2차 모형을 다시 적합하며, 남은 제곱항도 재검사합니다. 선형항은
재적합한 α의 95% 구간이 양수일 때만 채택합니다. 두 경우 모두 40랩·
4스틴트 최소 표본을 적용합니다. 음수 계수를 잘라서 채택하지 않습니다.

채택 계수 자체도 학습 구간 추정치이므로 홀드아웃은 모형 선택이나
채택에 사용되지 않습니다. 선택된 통계 회귀의 뒤 25% 오차를 별도로
출력합니다. 이 오차는 가정 절편·워밍업·교통을 더한 전체 시뮬레이터의
예측 오차가 아닙니다. 단위 테스트는 홀드아웃 랩타임을 크게 바꾸어도
모형과 채택 계수가 변하지 않는지 검증합니다.

같은 서킷·상대 컴파운드의 통과 계수만 학습 랩 수로 가중해 프로젝트
초깃값으로 사용합니다. 새 세트의 1→0 수명 변환을 위해 α₀=α+2β,
상수 보정=α+β를 함께 적용하고, 가정 기반 초기 컴파운드 속도차는
유지합니다. 관측이 없으면 같은 프로젝트 열화 등급 중 길이가 가장
가까운 서킷을 대체 출처로 명시합니다. 피트 손실은 다른 서킷에서
가져오지 않으며 기존값과 3초 이상 차이 날 때만 관측 중앙값을 채택합니다.

팀 페이스·열화 변환의 축소율/제한값은 `app/model/params.ts`의
`historical`·`performance`에 있습니다. 원 관측과 채택값을 따로 표시하며,
팀별 정차 교체 시간을 분리할 자료가 없으므로 피트크루 보정은 0입니다.

원자료는 FastF1을 통해 공개 F1 타이밍 자료에서 가져옵니다. 성공한
경기마다 `timingSourceUrl`을 기록합니다. 공식 타이밍에 대한 프로젝트
분석이며 공식 F1 타이밍 제품이나 실제 팀 텔레메트리가 아닙니다.

β는 수명에 따른 곡률 항입니다. β의 채택은 클리프 시작 랩·급락 임계점의
학습이 아닙니다. 클리프·워밍업·상태 비용은 기존 프로젝트 가정으로 남습니다.
현재 선택 모형 MAE 0.525209초/랩과 전체 2차 진단 MAE 0.583883초/랩은
서로 다른 결과이며, 둘 다 전체 경기 시간 오차와 다릅니다. 2025 영국
관측 전략의 전체시간 백테스트 오차는 약 14.33–15.09%입니다.

## 후속 자료 수집과 재실행 범위

아래는 역사 수집 이후 추가된 별도 산출물입니다. 경로는 저장소 루트 기준이며,
수집 명령은 외부 자료를 읽고 기본 출력 파일을 덮어씁니다. 표준 출력만 쓰는
EA 수집은 명시적으로 `--output`을 지정해야 파일이 바뀝니다.

```sh
python tools/collect_recent_team_evidence.py --cache-dir work/fastf1-cache
python tools/check_recent_team_evidence.py
python tools/collect_pit_loss_evidence.py --workers 3 --cache-dir work/fastf1-cache
python tools/collect_pit_loss_evidence.py --check
python tools/collect_pit_loss_evidence.py --self-test
python tools/collect_backtest_evidence.py --workers 3 --cache-dir work/fastf1-cache
python tools/collect_neutralisation_evidence.py --workers 4 --cache-dir work/neutralisation-cache
python tools/check_neutralisation_evidence.py
python tools/fetch_ea_ratings.py --output app/data/ea-ratings.json
```

- **최근 팀:** 2026 네덜란드·헝가리와 2025 같은 두 경기 고정. 현재 날짜의 최신 경기를
  자동 탐색하지 않습니다. 원자료 `recent-team-evidence.json`은 공식 차트 전사와 다른
  프로젝트 관측입니다. 실제 소비·표본 게이트는 [팀 문서](README-team-pace.md)를 참고하세요.
- **피트 손실:** `pit-loss-evidence.json`과 경량 `pit-loss-summary.json`을 동시에 생성합니다.
  `--resume`은 `pending`이 아닌 상태를 재사용하므로 미확보 경기까지 새로 조회하려면
  이 옵션을 빼야 합니다. 현재 마드리드만 역사 경기 없음입니다. 23개 값이 모두 현재
  기본값으로 채택되는 것은 아니며, 기존 다경기 관측을 우선하고 3초 차이 게이트를 적용합니다.
- **백테스트:** `backtest-evidence.json`은 2025년 오스트리아·헝가리·이탈리아·바레인·스페인·
  벨기에·영국의 상위 3명 전략·전체시간·기상입니다. 공식 시간은 우승자 시간+선수 격차로
  구하며 랩타임 합계와 따로 보존합니다. 계수 적합·완주시간 역산은 하지 않습니다.
- **SC/VSC:** `neutralisation-evidence.json`은 2018–2025년 공식 상태 채널의 집계이며
  `neutralisation-summary.json`은 런타임 요약입니다. 유효 137/173경기, 제외 36경기,
  현재 서킷 중 관측 빈도 15/24개입니다. `--limit`은 진단용 부분 수집이고,
  `--offline-rebuild`는 기존 출력과 캐시로 재분석합니다. 실패 응답을 다시 요청하거나
  접근 제한을 우회하지 않습니다. 빈도 최소 5경기와 기간 최소 3구간은 각각의 프로젝트
  채택 게이트이며, 원자료 확률과 런타임 fallback을 혼합해 실측이라고 쓰지 않습니다.
- **EA:** `ea-ratings.json`에 공식 게임 점수·iteration·확인 시각·누락을 보존합니다.
  `--html 저장한공식페이지.html`로 네트워크 없이 파싱할 수 있습니다. 현재 22명 점수의
  `2026june` iteration과 2026 팀/번호 스냅샷은 서로 다른 출처입니다.

역사 수집의 `--output-dir`를 바꾸더라도 요약 생성·검사기는 기본 `app/data`를 읽습니다.
서로 다른 실행의 원시 파일·경량 요약을 섞으면 출처 해시나 집계 검사가 실패해야 정상입니다.
역사 체크포인트, FastF1 응답 캐시, 실행 코드와 의존성 버전을 함께 보존해야 숫자 차이를
감사할 수 있습니다. 수집 시각은 원자료 기사 공개일이나 레이스 날짜가 아닙니다.

## 이번 문서 재현 검수

2026-09-07에 6개 수집기의 실제 `--help`를 실행해 위 옵션을 확인했습니다.
저장된 자료에 대한 역사 집계 검사, 학습 전용 모델 선택 합성 검사, 최근 팀
불변식/합성 검사, 피트 원시·요약 해시 검사와 self-test, SC/VSC 합성·집계
검사를 모두 통과했습니다. 문서 검수 중 원격 자료를 새로 수집하거나 JSON을
갱신하지 않았습니다. 전체 사이트 브라우저 검증이나 신규 원격 재수집 성공을
이 검사 결과로 대신하지 않습니다.
