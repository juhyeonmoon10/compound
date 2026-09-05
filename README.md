# compound

데이터 분석을 통한 F1 타이어 전략 알고리즘 구현하기.

공개 F1 랩 데이터를 분석하고 K-best 동적계획법으로 타이어 전략 Top 3를
계산·비교하는 학교 연구 프로젝트입니다. 비공식 교육용 시뮬레이션이며
실제 F1 팀의 비공개 전략 시스템이나 미래 경기 결과를 재현하지 않습니다.

## 기능

- 실제 서킷 프리셋과 팀·드라이버 선택
- S/M/H 컴파운드와 피트 시점을 반영한 추천 전략 Top 3
- 직접 전략 설계, 시간 차이 및 비용 항목 비교
- 공개 FastF1 데이터 분석과 과거 관측 전략 검증
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

GitHub Pages의 Source는 **GitHub Actions**입니다.
`main`에 변경 사항을 push하면 테스트와 정적 빌드 후 자동 배포합니다.
별도 서버, API 키, 비밀키가 필요하지 않습니다.

웹 엔트리는 `pages/main.tsx`, 배포 설정은 `vite.pages.config.ts`입니다.
기존 Next/Vinext용 화면 파일은 배포 엔트리에 포함하지 않으며,
현재 화면에서 쓰이는 계산·저장·리플레이는 브라우저에서 실행됩니다.

## 연구 데이터·한계

5개 2025년 GP의 공개 데이터 집계와 프로젝트 가정을 사용합니다.
서킷별 데이터 유무와 가정, 모형식, 검증 결과는 사이트에서 확인할 수 있습니다.
오프라인 분석 재현 방법은 [analysis/README.md](analysis/README.md)를 참고하세요.
실험 노트는 현재 브라우저·사이트 주소에만 저장됩니다. 다른 기기로 이동하려면
CSV를 내보내 보관하세요. CSV 재가져오기와 서버 동기화는 제공하지 않습니다.

## 이미지·모델 출처

제3자 자산은 원저작자에게 권리가 있습니다. 사이트의 출처 표시와 함께
`public/cars/SOURCE.md`, `public/circuits/SOURCE.txt`,
`public/circuits/LICENSE.txt`, `public/models/SOURCE.txt`,
`public/models/meshy-player-car-LICENSE.txt`의 이용 조건을 확인하세요.
UI 이미지의 출처 확인 상태는 `public/ui/SOURCE.md`에 기록했습니다.
F1 및 팀·선수·타이어 관련 명칭과 이미지는 공식 제휴를 의미하지 않습니다.
