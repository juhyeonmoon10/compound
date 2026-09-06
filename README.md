# compound

데이터 분석을 통한 F1 타이어 전략 알고리즘 구현하기.

공개 F1 랩 데이터를 분석하고 상위 후보를 유지하는 동적계획법으로 타이어 전략 상위 3개를
계산·비교하는 비공식·비영리 시뮬레이터입니다.
실제 F1 팀의 비공개 전략 시스템이나 미래 경기 결과를 재현하지 않습니다.

## 기능

- 실제 서킷 프리셋과 팀·드라이버 선택
- S/M/H/인터/웨트, 강수·건조와 피트 시점을 반영한 추천 전략
- 직접 전략 설계, 시간 차이 및 비용 항목 비교
- 공개 FastF1 데이터 분석과 과거 관측 전략 검증
- EA 공식 선수 점수와 관측 기반 팀 보정, 동일 성능 모드
- 동일 조건의 자동 3D 레이스 리플레이
- 브라우저 내 실험 기록 저장, 두 실험 비교, CSV 내보내기

## 실행

Node.js 22.13 이상과 pnpm 11.9.0을 사용합니다.

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm build
pnpm start
```

기본 경로는 `/compound/`입니다. 다른 저장소에 배포할 때는
`PAGES_BASE_PATH`를 `/저장소이름/` 형식으로 지정합니다.

## 배포

GitHub Pages의 배포 원본은 **GitHub Actions**입니다.
`main`에 변경 사항을 올리면 테스트와 정적 빌드 후 자동 배포합니다.
별도 서버, API 키, 비밀키가 필요하지 않습니다.

웹 엔트리는 `pages/main.tsx`, 배포 설정은 `vite.pages.config.ts`입니다.
기존 Next/Vinext용 화면 파일은 배포 엔트리에 포함하지 않으며,
현재 화면에서 쓰이는 계산·저장·리플레이는 브라우저에서 실행됩니다.

## 데이터·가정·한계

2023–2025년 7서킷 21경기: 원시 23,229랩 → 정제 18,778랩·1,034스틴트.
학습 구간에서 2차항 유의성을 검사하고 미유의 항은 제거 후 선형 재적합합니다.
홀드아웃 4,388랩의 가중 MAE는 0.525초/랩이며 **통계 회귀**의 오차입니다.
전체 레이스 시간·순위 예측의 정확도가 아닙니다. 기준 통과 계수만 적용하며
직접 자료가 없는 서킷은 같은 열화 등급의 가까운 길이 서킷을 대체 근거로 표시합니다.

강수·수막과 우천 페널티는 프로젝트 가정입니다. 2025 호주·영국·벨기에
자료에 날씨를 결합했으나 Full Wet 동랩 비교 표본이 없어 보정했다고 주장하지 않습니다.
주어진 식의 교차점은 슬릭→인터가 수막 0.10 바로 위(불연속), 인터→웨트는 0.60입니다.
건식 2종 의무 면제는 비가 왔다는 사실만으로 적용하지 않습니다. FIA B6.3.6에 따라
해당 전략이 실제로 인터 또는 웨트를 사용해야 합니다.

피트 손실은 24개 서킷을 확인해 23개 관측 프록시를 확보했습니다. 마드리드는
과거 경기가 없어 결측입니다. 기존 다경기 표본을 우선하고, 관측치와 기존값이
3초 이상 다른 경우에만 기본값을 교체합니다. 정차 시간과 피트 손실은 다르며
피트 크루 정차 시간을 분리하지 못한 항은 0초 중립으로 남깁니다.
팀 페이스는 2026 네덜란드·헝가리 두 경기의 동컴파운드 관측을 우선합니다.
2025 같은 두 경기와 공식 최신 5경기 차트의 결측값은 별도 표로 표시합니다.
관측에 남는 선수·교통·운영 효과 때문에 차량 고유 성능의 측정값은 아닙니다.

서킷별 데이터 유무와 가정, 모형식, 검증 결과는 사이트에서 확인할 수 있습니다.
오프라인 분석 재현 방법은 [analysis/README.md](analysis/README.md)를 참고하세요.
실험 노트는 현재 브라우저·사이트 주소에만 저장됩니다. 다른 기기로 이동하려면
CSV를 내보내 보관하세요. CSV 재가져오기와 서버 동기화는 제공하지 않습니다.

## 자료 수집 재현

Python에 FastF1·pandas·numpy·statsmodels·requests를 설치한 환경에서 실행합니다.
원격 자료 변경이나 라이브러리 버전에 따라 표본과 계수는 달라질 수 있습니다.
각 JSON의 수집 버전·시각·정제 기준·URL을 함께 확인하세요.

```sh
python tools/collect_historical_evidence.py
python tools/build_calibration_summary.py
python tools/check_historical_evidence.py
python tools/test_historical_selection.py
python tools/fetch_ea_ratings.py
python tools/collect_recent_team_evidence.py
python tools/check_recent_team_evidence.py
python tools/collect_pit_loss_evidence.py
python tools/collect_pit_loss_evidence.py --check
python tools/collect_pit_loss_evidence.py --self-test
```

세부 인자와 환경 경로는 `tools/README.md`, `tools/README-team-pace.md`에 있습니다.

## 이미지·모델 출처

제3자 자산은 원저작자에게 권리가 있습니다. 사이트의 출처 표시와 함께
`public/cars/SOURCE.md`, `public/circuits/SOURCE.txt`,
`public/circuits/LICENSE.txt`, `public/models/SOURCE.txt`,
`public/models/meshy-player-car-LICENSE.txt`의 이용 조건을 확인하세요.
화면 이미지의 출처 확인 상태는 `public/ui/SOURCE.md`에 기록했습니다.
F1 및 팀·선수·타이어 관련 명칭과 이미지는 공식 제휴를 의미하지 않습니다.
