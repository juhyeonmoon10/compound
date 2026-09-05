# FastF1 타이어 열화 분석

사이트의 2025년 건식 레이스 5개 사례 분석값을 재현하는 오프라인 분석
스크립트입니다. 브라우저에서 원격 데이터를 요청하지 않고, 분석 결과
집계값만 웹 번들에 포함합니다.

## 실행

```powershell
python -m pip install -r analysis/requirements.txt
python analysis/fastf1_multi_event_2025.py --event all
```

첫 실행은 FastF1 공개 타이밍 데이터를 `work/fastf1-cache`에 캐시합니다.
결과 JSON은 표준 출력으로 내보냅니다.

한 경기만 다시 계산하려면 `--event bahrain`, `spain`, `austria`,
`hungary`, `italy` 중 하나를 지정합니다. `--summary`를 붙이면 차트용
집계점을 생략한 감사용 요약을 출력합니다.

## 정제 기준

- 2025 Bahrain·Spanish·Austrian·Hungarian·Italian Grand Prix `Race`
- 이벤트 상대 표기 `SOFT`, `MEDIUM`, `HARD`만 사용
- `IsAccurate=True`, `Deleted!=True`, `FastF1Generated=False`
- 완전한 녹색기 `TrackStatus == "1"`
- 피트 인·아웃랩과 레이스 첫 랩 제외
- 정상 랩이 5개 이상이고 `TyreLife`가 감소하지 않는 스틴트
- 1차 적합 후 잔차 IQR 바깥의 큰 비정상 오차를 강건 정제로 제외

FastF1의 `pick_quicklaps()`는 오래된 타이어의 정상적인 느린 랩까지
제거할 수 있어 사용하지 않습니다.

## 모형과 검증

```text
LapTime ~ Driver + RaceLap + RaceLap² + TrackTemp
          + Compound + Compound × TyreLife
```

드라이버 고정효과와 경기 진행 추세를 통제합니다. 각 스틴트의 앞 75%로
학습하고 뒤 25%를 예측하므로 미래 랩을 무작위로 섞지 않습니다.

공개 랩타임에서 얻은 값은 타이어 센서의 물리적 마모율이 아니라 실제
레이스 운용을 포함한 관측 페이스 저하 효과입니다. 경기마다 Pirelli의
공식 배정 자료로 상대 표기 S/M/H를 실제 C1–C5에 연결하지만 서로 다른
경기의 원시 랩을 하나의 회귀에 섞지 않습니다. 2025 결과를 규격이
달라진 2026 타이어의 직접 계수로 해석하지 않습니다.

전략 계산에는 양의 기울기, 0을 벗어난 95% 신뢰구간, 40랩 이상,
4스틴트 이상을 모두 만족한 컴파운드만 넣습니다. 기준을 통과하지
못하면 해당 서킷의 프로젝트 사전값으로 자동 대체합니다.
