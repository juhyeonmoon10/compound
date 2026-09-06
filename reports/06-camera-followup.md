# §6 후속: 고배속 추적 카메라 지연

## 확인된 원인

`app/RaceScene3D.tsx`의 차량은 매 프레임 현재 레이스 진행 위치에 배치되지만, 기존 추적/운전석 카메라는 이전 **월드 좌표**에서 목표 좌표까지 지수 감쇠 보간했다. 배속에 따라 보간 강도를 `sqrt(playbackScale)`로 높여도 60배속에서 차량의 프레임당 이동량을 따라잡지 못했다. 이 때문에 설정된 추적 거리 약 6m보다 수십 미터 뒤에서 차량을 바라볼 수 있었다.

예를 들어 250km/h, 60배속, 60fps의 등속 이동을 가정하면 한 프레임 이동량은 약 69m이며 기존 위치 보간 비율은 약 0.62다. 이는 원인을 설명하는 등속 근사일 뿐, 실제 레이스의 랩 속도 측정값은 아니다. 실제 renderer 함수를 호출하는 회귀 fixture에서도 기존 코드는 차량과 카메라의 거리가 20m를 초과했다. 차량 선택은 `playerGridCarId`에 연결되어 있어 다른 선수를 잘못 추적한 문제가 아니었다.

## 최소 수정

- 변경 파일: `app/RaceScene3D.tsx`.
- 추가 상태: 마지막 추적 기준점 `cameraAnchorPosition: THREE.Vector3`.
- 추적/운전석에서는 차량 기준점의 프레임간 이동분을 카메라 위치와 주시점에 먼저 더한다. 이후 기존 보간을 실행하여 차량에 대한 상대 오프셋만 부드럽게 변경한다.
- 첫 프레임과 카메라 모드 변경의 기존 즉시 배치, 중계 카메라의 트랙사이드 배치, FOV, 진동/롤, 휠 회전, 차량 모델과 전략 시계는 그대로다.
- 새 수치 상수나 모델 계수 없음. 기존 카메라 계수도 변경하지 않았다. `RaceReplay.tsx`와 `StrategyLab.tsx`는 수정하지 않았다.

## 검사

신규 `tests/race-camera.test.mjs`는 실제 `RaceScene3D.tsx`를 메모리에서 TypeScript 변환한 후 내부 `renderFrame`을 실행한다. WebGL renderer의 마지막 draw만 no-op으로 대체한다.

- 추적/운전석 × 1·10·30·60배속 × 30·60·120fps: 추적 거리 7m 이내, 운전석 2.1m 이내, 내 차가 추적 카메라의 화면 투영 범위 안에 유지됨.
- 몬트리올 70랩/강한 비/3스톱 비용과 실제 20대 race-grid frame 사용. Leclerc ID를 10번 그리드에 배치. 도로는 몬트리올과 같은 길이의 합성 원형 경로이므로 실제 몬트리올 코너의 시각 검수는 아님.
- 같은 fixture에서 수정 전 보간을 재현하면 거리 20m 초과, 수정 후 7m 미만. 수정 효과를 회귀 테스트로 확인.
- 전후 탐색, 피트 구간, 그리드 없는 fallback, 카메라 모드 전환 이후 추적 거리 유지.
- 중계 모드는 같은 섹터에서 차량만 이동하고 트랙사이드 카메라 위치는 고정.

실행 결과: 4개 테스트 통과. `tsc --noEmit --incremental false` 통과. `eslint app/RaceScene3D.tsx tests/race-camera.test.mjs` 통과.

```powershell
node --experimental-strip-types --test --test-isolation=none tests/race-camera.test.mjs
node ../../node_modules/typescript/bin/tsc --noEmit --incremental false
node ../../node_modules/eslint/bin/eslint.js app/RaceScene3D.tsx tests/race-camera.test.mjs
```

이 하위 작업에서는 브라우저/DOM/전체화면/GLB 외관/GPU 검증을 수행하지 않았다. 실제 몬트리올 우천 60배속 화면은 메인 작업의 별도 브라우저 QA 대상이다. 카메라 translation 지연을 제거했으나 저프레임·급격한 코너에서 방향 보간, 모델 외관, 투명 차량 겹침까지 새로 설계한 것은 아니다.

## 도로 중앙 검은 띠: 읽기 확인만

가장 직접적인 코드상 후보는 scene 생성 시 추가하는 `racingLine` mesh다. `createRoadGeometry(worldPoints, 0.72, 0.071)`은 중앙에 폭 1.44m의 연속 띠를 만들며, 아스팔트보다 어둡게 조정한 색과 `opacity: 0.62`를 사용한다. 도로 표면 높이 0.06m보다 0.011m 위에 있다. 이 mesh의 shadow 수신/투사는 설정되어 있지 않으므로, 자체가 그림자나 차량 GLB는 아니다.

우천에서는 `wetRoadMaterial`의 거칠기/금속성만 변경하고 `racingLine` 재질은 그대로 두므로 젖은 도로와 중앙 띠의 대비가 커질 수 있다. 그림자맵과 차량 그림자도 별도로 존재하므로, 스크린샷과 실제 mesh를 대조하지 않은 상태에서 사용자가 본 검은 띠가 반드시 이것이라고 확정하지 않는다. 검은 띠, 그림자, 도로/차량 재질은 이 수정에서 변경하지 않았다.
# 루트 브라우저 후속 확인

몬트리올·페라리·강한 비·최대 3스톱·60배속 조건을 동일하게 재설정해 실제 3D 주행을 확인했다. 수정 전에는 내 차가 먼 전방으로 떨어졌으나 수정 후 18랩에서 화면 하단 중앙에 가까운 내 차가 유지됐다. 전체화면·일시정지·복귀와 콘솔 오류/경고 없음도 확인했다. 기존 알고리즘 30+우천 6+카메라 4의 **40 PASS, 0 FAIL**을 재확인했고 두 DP ↔ 완전탐색 검사도 통과했다. 중앙 검은 주행선은 기존 그래픽으로 남겨 뒀다.
