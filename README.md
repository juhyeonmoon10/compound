# compound

데이터 분석을 통한 F1 타이어 전략 알고리즘 구현하기.

[웹사이트 열기](https://juhyeonmoon10.github.io/compound/) · [0–9절 변경·검증 보고](reports/09-completion.md)

공개 타이밍 자료의 관측 계수와 명시적인 프로젝트 가정을 사용해 타이어 교체 전략을 계산·비교하는 비공식 시뮬레이터입니다. 실제 F1 팀의 비공개 전략 시스템, 차량 물리 또는 미래 경기 결과를 재현하지 않습니다.

## 기능

- 24개 서킷 프리셋, 2026 팀·선수 선택, 동일 성능 모드.
- 소프트·미디엄·하드·인터미디어트·웨트, 강수·건조·노면 온도·피트 손실 설정.
- 최단 전략과 대표 대안, 직접 만든 전략의 랩별 비용·피트 구간 비교.
- 같은 참가자·기초 랩 비용을 쓰는 300회 시드 고정 확률 실험과 자동 3D 리플레이.
- 20대 순위·스틴트·피트·타이어 급락 이벤트, 주행 화면만 전체화면, 1/10/30/60배 재생.
- 관측 자료·출처·모형 가정·회귀 검증·7경기 백테스트 확인.
- 브라우저 실험 기록, 두 조건 비교, CSV 내보내기.

팀 색은 선택과 강조에만 사용합니다. 타이어 색은 S 빨강 / M 노랑 / H 흰색 / I 초록 / W 파랑으로 고정합니다. 3D는 별도 실행하며 운전 실력 평가가 아닙니다.

## 추천 3개와 확률 결과의 의미

**1번은 선언한 결정론 모델·탐색 제약 안의 전역 최단 해입니다. 2·3번은 대표 대안이며 전역 2·3위가 아닙니다.**

기존 K-best 동적계획법과 완전탐색 검증 계약은 유지합니다. 화면용 후보는 스톱 수·타이어 집합별 스틴트 DP와 한 피트 경계 이동에서 구성하며, `(타이어, 스틴트 길이)` 묶음의 순서만 바뀐 중복을 제거합니다. 같은 스톱 수·타이어 집합이면 표시 후보 사이에 0.5초 이상 차이가 있어야 합니다. 구별되는 합법 대안이 부족하면 개수를 그대로 표시합니다. 여기서 ‘최적’은 현실 경기 전체의 최적을 뜻하지 않습니다.

몬테카를로는 이미 계산된 후보를 평가합니다. 교통·안전 차량까지 포함한 공동 상태 DP를 다시 푸는 것이 아닙니다.

- 한 시행의 SC/VSC 일정과 상대·랩 ID 기반 난수를 후보들이 공유합니다. 같은 시드와 같은 전체 입력·코드·자료 버전이면 결과가 재현됩니다.
- 후보 중 승률은 입력 후보 중 최단시간 비율이며, 가상 그리드 승률은 20대 중 1위 비율입니다. 실제 우승 확률이 아닙니다.
- P10/P90은 가상 총시간 분포의 분위수이며 예측 정확도나 통계적 신뢰구간이 아닙니다.
- 3D와 확률 실험은 20대 참가자·출발 순번·상대 전략·능력치 기초 비용을 공유하지만 **레이스 시간 계산은 별개**입니다. 확률 교통·SC/VSC 할인을 3D 시계에 재적용하지 않습니다. 스틴트의 SC/VSC 띠도 전달받은 실험 조건의 오버레이이며 ‘재생 시계 미반영’으로 표시합니다.
- EA 공식 게임 점수를 초·마모·우천 페널티로 바꾸는 식은 프로젝트 추정입니다. 내 차의 성능은 DP 전에 한 번 적용하고, 그리드에서는 다른 차량의 상대 차이만 추가합니다.

## 로컬 실행과 검사

Node.js 22.13 이상, pnpm 11.9.0을 사용합니다. 웹 실행에는 Python·FastF1·API 키가 필요하지 않습니다.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

개발 서버가 출력한 주소의 `/compound/`를 엽니다. 빌드와 검사는 각각 실행합니다.

```sh
pnpm test
pnpm exec tsc --noEmit --incremental false
pnpm lint
pnpm build
pnpm start
```

테스트 하위 프로세스 생성이 제한된 환경에서는 다음 명령을 사용할 수 있습니다. Worker 테스트에는 실제 `worker_threads` 실행 권한이 필요합니다.

```sh
node --experimental-strip-types --test --test-isolation=none tests/*.test.mjs
```

웹 엔트리는 `pages/main.tsx`, 정적 빌드 설정은 `vite.pages.config.ts`, 산출물은 `out/`입니다. 기존 Next/Vinext 서버 엔트리는 이 정적 배포에 사용하지 않습니다. 기본 경로를 바꾸려면 빌드 시 `PAGES_BASE_PATH=/저장소이름/`을 지정합니다. `.github/workflows/deploy.yml`에는 `main` push 또는 수동 실행 시 테스트·빌드 후 GitHub Pages 배포가 설정되어 있습니다. 다른 저장소에 올리려면 해당 저장소 권한과 Pages 설정을 별도로 확인해야 합니다.

## 관측 자료와 검증을 읽는 법

아래는 저장된 JSON과 2026-09-07 코드의 스냅샷이며 실시간 갱신 값이 아닙니다.

| 자료 | 확보 범위 | 사용과 한계 |
| --- | --- | --- |
| 건식 랩 분석 | 2023–2025년 7서킷·21경기, 원시 23,229랩 → 정제 18,778랩·1,034스틴트 | 통과 계수만 채택. 직접 관측이 없으면 같은 열화 등급 중 길이가 가까운 서킷을 대체 출처로 명시 |
| 우천 관측 | 2025 호주·영국·벨기에 랩과 기상 | Rainfall은 강수 여부이지 강수량·수막 센서값이 아님. 동랩 INTER/WET 비교 0개로 전환점 실측 학습 불가 |
| 최근 팀 관측 | 2026 네덜란드·헝가리 2,799 → 1,978랩, 별도 2025 비교 2,732 → 2,116랩 | 공식 타이밍 기반 프로젝트 분석. 연도를 섞지 않으며 2026 관측을 명시적 게이트로 소비 |
| 공식 팀 페이스 차트 | 조사 기준 5경기 × 11팀의 55값 모두 미확보 | `null` 유지. 관측 회귀나 예선 기록을 공식 차트 값으로 바꾸어 넣지 않음 |
| 피트 손실 | 24서킷 중 23개 관측 프록시, 마드리드 역사 경기 없음 | 기존 다경기 풀링 우선, 기존값과 3초 이상 차이 날 때만 교체. 정지 교체 시간 미분리, 피트크루 보정 0초 |
| SC/VSC 기록 | 2018–2025년 173개 일정 중 유효 137경기·제외 36경기; 현 24서킷 중 관측 빈도 확보 15개 | 공식 상태 기록의 프로젝트 집계. 결측·특수 경기를 무사건 0으로 세지 않음. 2026 발생 확률의 정답이 아님 |
| EA 선수 점수 | 22명, `2026june` iteration, 확인 2026-09-06 | OVR/EXP/RAC/AWA/PAC는 공식 게임 평가. 팀 배정·차량 번호와 점수의 시간 변환은 별도 관리 |

### 회귀 오차와 클리프는 다릅니다

각 유효 스틴트 앞 75%에서 선형/2차항을 선택하고 뒤 25%를 홀드아웃으로 둡니다. 학습 전용 모델 선택 후 4,388 홀드아웃 랩의 가중 MAE는 **0.525209초/랩**입니다. 전체 2차 진단 모델의 별도 MAE 0.583883초/랩과 혼동하지 않습니다. 채택 항은 39개이며 그중 2차항은 3개입니다. 집계는 [calibration-summary.json](app/data/calibration-summary.json)의 `selectedModelSummary`에 있습니다.

β는 나이에 따른 완만한 곡률 계수입니다. **β를 학습했다고 클리프 시작 랩이나 급락 임계점을 학습한 것은 아닙니다.** 클리프·워밍업·상태 비용은 기존 프로젝트 모델로 남아 있습니다. 회귀 홀드아웃 오차는 전체 레이스 시간·순위 예측 오차가 아닙니다. 학습하지 않은 연도·서킷으로의 일반화도 보장하지 않습니다.

### 실제 전체 레이스 시간과의 차이

백테스트는 2025년 7경기의 실제 상위 3명 전략을 그대로 평가하고, 공식 우승자 시간에 해당 선수 격차를 더한 전체시간과 비교합니다. 실제 완주시간으로 기준 랩타임을 역산해 맞추지 않습니다.

| 2025 GP | 3명 각각의 전체시간 절대오차율 범위 |
| --- | ---: |
| 오스트리아 | 0.75–1.27% |
| 헝가리 | 2.04–2.41% |
| 이탈리아 | 0.61–1.13% |
| 바레인 | 5.27–5.60% |
| 스페인 | 6.48–6.78% |
| 벨기에 | 0.15–0.96% |
| 영국 | **14.33–15.09%** |

영국 노리스의 실제 5,835.735초에 대해 모델은 4,999.303초로, 약 836.432초 짧습니다. 이는 SC/VSC·재출발·우천·교통·선수 차이를 완주시간 모델이 충분히 설명하지 못한다는 한계입니다. 일부 대상 경기는 계수 학습 자료에도 포함되어 있으므로 **독립 미학습 경기 검증이 아닙니다**. 중고 타이어 초기 수명은 원자료에 남기지만 계산은 새 세트로 정규화합니다. [원자료](app/data/backtest-evidence.json)와 [계산 코드](app/lib/strategy-backtest.ts)를 함께 확인하세요.

## 자료 수집 재현

Python 3.11 이상 환경에서 저장소 루트를 작업 폴더로 사용합니다. 수집은 외부 공개 자료에 접근하고 JSON·캐시를 갱신하므로, 기존 스냅샷을 보존하려면 먼저 별도 사본이나 작업 브랜치를 만드세요. 재실행 시각, 원격 자료, 의존성에 따라 결과는 달라질 수 있습니다.

```sh
python -m pip install -r analysis/requirements.txt
python tools/collect_historical_evidence.py --workers 3 --cache-dir work/fastf1-cache
python tools/build_calibration_summary.py
python tools/check_historical_evidence.py
python tools/test_historical_selection.py
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

- 역사 건식 수집 기본값은 2023/2024/2025와 바레인·바르셀로나·슈필베르크·헝가로링·몬차·실버스톤·스파입니다. `--years`에 2025가 있으면 호주 우천 보조 세션도 추가하며 건식 21경기 합계에서는 제외합니다. `--tracks`, `--checkpoint-dir`, `--output-dir`로 범위를 지정할 수 있습니다. 완료된 동일 버전 체크포인트를 재사용하며, 요약 생성·검사기는 기본 `app/data` 파일을 읽습니다.
- 우천 보완만 재현하려면 기존 2025 호주·영국·벨기에 FastF1 캐시와 저장된 우천 JSON을 둔 상태에서 `python tools/collect_historical_evidence.py --wet-only-from-cache --cache-dir work/fastf1-cache`를 실행합니다. 네트워크를 차단하고 `wet-weather-2025.json`만 갱신하며 다른 자료는 재생성하지 않습니다. 캐시가 없거나 기존 동랩 비교와 달라지면 저장된 비교를 보존하고 전환 원자료를 미확보로 남깁니다. `python tools/test_wet_evidence.py`와 `node --experimental-strip-types --test tests/wet-evidence.test.mjs`로 합성 정제 규칙·기존 5개 비교·74건의 기록된 타이어 전환·표시를 검사합니다. 개별 점과 경기별 분포, 조인 방식 및 보정 불가 사유는 [우천 보완 보고서](reports/01-wet-followup.md)에 정리했습니다.
- 최근 팀 수집기는 **기록된 2개 대회·2개 연도 고정**입니다. 실행 날짜에 맞춰 최신 2경기를 자동 선택하지 않습니다. `--output`을 생략하면 `recent-team-evidence.json`을 덮어씁니다.
- 피트 수집의 `--resume`은 저장된 `pending` 이외 상태를 재사용합니다. 과거 `unavailable`까지 재조회하려면 `--resume`을 빼고 실행합니다. 원시 JSON과 경량 요약은 함께 생성됩니다.
- SC/VSC 수집은 5개 작은 공식 상태 채널만 읽습니다. `--limit`은 진단용 부분 수집입니다. `--offline-rebuild`는 동일 `--cache-dir`의 저장 응답과 기존 출력으로 재분석하며 실패 요청을 재시도하지 않습니다. 원시 파일과 `neutralisation-summary.json`을 함께 확인합니다.
- EA 수집의 기본 출력은 표준 출력입니다. 파일 교체에는 위의 `--output`이 필요합니다. 저장한 공식 HTML만 파싱하려면 `--html 파일경로`를 사용합니다.
- 전처리 상세는 [자료 수집 문서](tools/README.md), 팀 관측·채택 근거는 [팀 페이스 문서](tools/README-team-pace.md), 공유 그리드·사전값·Worker API는 [확률 실험 문서](tools/README-race-experiments.md), 기존 분석은 [analysis/README.md](analysis/README.md)에 있습니다. 새 런타임 계수의 단일 출처인 `app/model/params.ts`에 단위·추정 여부를 표시합니다.

## 남아 있는 모델 제한

강수·건조·수막·우천 페널티는 프로젝트 가정입니다. 제공 식의 슬릭→인터 경계는 수막 0.10 바로 위의 불연속 전환, 인터→웨트 교점은 0.60입니다. 둘 다 실측 학습값이 아닙니다. 건식 2종 의무 면제는 강수 여부만으로 적용하지 않고 해당 전략의 실제 인터/웨트 사용을 검사합니다. 기준은 [FIA 2026 Sporting Regulations Issue 08](https://www.fia.com/system/files/documents/fia_2026_f1_regulations_-_section_b_sporting_-_iss_08_-_2026-08-05_7.pdf)의 B6.3.6입니다.

SC/VSC 빈도는 해당 서킷의 유효 경기 5개 이상, 지속기간은 해당 종류의 관측 구간 3개 이상일 때 각각 독립적으로 채택합니다. 관측 0/n과 결측을 구분합니다. 부족하면 기본 경기당 SC 0.35 / VSC 0.25 및 기본 지속기간이라는 프로젝트 fallback을 사용합니다. 빈도는 fallback이지만 기간은 관측인 혼합 출처도 가능합니다. 피트 손실 배수 0.55 / 0.70도 공식 할인율이 아닌 추정입니다. 시행당 SC/VSC 각 최대 한 구간만 생성하고 실제 대열 압축·랩다운 해제·적기·전체 감속 시간을 재현하지 않습니다.

팀 페이스에는 선수·교통·운영·연료 효과가 남습니다. 2025 Kick Sauber를 2026 Audi 실측으로 바꾸지 않습니다. 공식 페이스 차트의 미확보 `null`과 모델의 중립 0초는 다릅니다. 22명 선택지 중 레이스에는 기존 규칙으로 고른 20대만 출전합니다. 서킷 윤곽·표시 속도·시야각·반사·카메라 효과는 연출이며 계산 정확도의 근거가 아닙니다.

## 실험 기록과 개인정보

현재 브라우저의 사이트 원점별 `localStorage`에 최대 20개를 보관합니다. 서버 전송·계정 동기화는 없습니다. v2 저장은 기존 `apex:experiment-notebook:v1` 키를 유지하고 v1 기록도 읽습니다. 과거 기록에 없는 강수·시드·능력치 조건은 추측해서 채우지 않습니다.

v2는 전략·조건과 시드, SC/VSC 요약, 팀·선수, 능력치 적용 여부, 선택적 MC 결과·EA 점수 스냅샷을 저장합니다. 조건이 다르면 시간 차이를 타이어 전략만의 효과로 해석하지 않도록 경고합니다. CSV는 40개 열의 보관용이며 **재가져오기 기능이나 모델 전체 백업이 아닙니다**. 모든 난수 시행·상대 그리드 원장·실행 코드 버전이 저장되는 것은 아니므로 CSV만으로 과거 실행을 완전히 복구할 수 없습니다. 브라우저 데이터 삭제 시 원본 기록도 사라집니다.

## 이미지·모델 출처

제3자 자산은 원저작자에게 권리가 있습니다. [차량 이미지](public/cars/SOURCE.md), [서킷](public/circuits/SOURCE.txt)·[서킷 라이선스](public/circuits/LICENSE.txt), [3D 모델](public/models/SOURCE.txt)·[Meshy 모델 라이선스](public/models/meshy-player-car-LICENSE.txt), [UI 이미지](public/ui/SOURCE.md)를 확인하세요. F1·팀·선수·타이어 관련 명칭과 이미지는 공식 제휴를 의미하지 않습니다.
