# 온디바이스 통합 현황 & 남은 작업

교수님 과제: 피부진단 모델을 **TFLite로 변환 → RN 앱에 통합 → 온디바이스(서버 없이) 동작**,
시연 영상 + **모델 사이즈 / 추론 속도** 측정.

## ✅ 완료
- 모델 변환: `assets/skin_emcad_352_f32.tflite`(분할, 16MB), `assets/skin_severity_384_f32.tflite`(분류, 14MB). 변환/검증 상세는 [conv/README.md](conv/README.md).
- JS 추론 모듈: `src/lib/onDeviceInference.js` — 전처리→두 모델 추론→`server.py`와 동일한 결과 객체 + 측정치(`metrics`) 반환. **서버 fetch 완전 제거.**
- `src/screens/ScanLoadingScreen.js` — `/predict` 호출을 `analyzeOnDevice(uri)` 로 교체.
- `src/screens/ScanResultScreen.js` — 결과 화면에 **측정치 카드**(추론 ms · 모델 사이즈) 추가.
- `metro.config.js` — `.tflite` 를 번들 에셋으로 포함.

환경: **Expo SDK 54.0.35 · RN 0.81.5 · React 19** (app.json 의 v56 언급은 무시).
빌드 설정은 이미 준비됨: `metro.config.js`(tflite asset), `app.json` plugins(fast-tflite), `eas.json`(development 프로파일).

1. **패키지 설치** (`react-native-nitro-modules` 는 fast-tflite 필수 peer)
   ```bash
   npx expo install react-native-fast-tflite react-native-nitro-modules jpeg-js
   ```
   (`expo-image-manipulator` 는 이미 설치됨. expo-file-system 은 사용 안 함)
2. **개발 빌드 생성** (네이티브 모듈 포함 — 플러그인 때문에 prebuild 필수)
   - EAS(클라우드): `eas build --profile development --platform android`
   - 또는 로컬: `npx expo prebuild --clean && npx expo run:android` (Android SDK 필요)
3. 실기기에 개발 빌드 설치 → `npx expo start --dev-client` 로 구동.

## 📹 시연 영상 체크리스트
- [ ] **비행기모드 ON** (서버 없이 동작함을 증명 — 핵심)
- [ ] 사진 촬영 → 분석 → 결과 화면
- [ ] 결과 화면의 **측정치 카드가 화면에 보이게**: 추론 속도(ms), 모델 사이즈(MB)
- [ ] (선택) 분할 오버레이 + iga/병변 등급 표시

## 측정 항목 (교수님 기준)
- **메모리 사용량 = 모델 사이즈**: 16.0MB + 14.0MB ≈ **30.0MB** (`metrics.model_size_mb`).
- **추론 속도**: `metrics.seg_ms`(분할) / `metrics.cls_ms`(분류) / `metrics.total_ms`(전처리 포함 전체).
  실기기 첫 추론은 워밍업으로 느릴 수 있으니, 영상엔 2회차 수치 권장.
- **평균 추론 속도(분할·분류 따로)**: 결과 화면의 **`평균 속도 측정 (10회 반복)`** 버튼 →
  `benchmarkOnDevice(uri, {warmup:2, runs:10})` 가 워밍업 후 순수 모델 추론만 10회 반복해
  분할/분류 각각의 **평균·중앙값 ms** 를 화면에 표시. 1회 측정보다 대표성이 높아 보고용 수치로 권장.
  (하드웨어 의존이므로 실제 값은 실기기에서만 나옴 — 서버/에뮬레이터 수치와 다름.)

## 구현 메모 / 근사 지점
- 픽셀 접근: `expo-image-manipulator` 리사이즈 → JPEG → `jpeg-js` 디코드(RGBA). JPEG 재인코딩으로
  미세한 색 차이가 있으나 마스크/등급 결과엔 영향 미미.
- 분류 masked 입력의 마스크 팽창(서버 15px@1024)은 384 스케일 ≈6px 로 근사(`CLS_DILATE_PX_384`).
- 오버레이는 640px 기준 반투명 빨강(외곽선 없음) — 서버 cv2 오버레이의 경량 버전.
- 분할 모델은 sigmoid 를 이미 포함(변환 시 래핑). 분류는 raw logit → JS 에서 softmax.
