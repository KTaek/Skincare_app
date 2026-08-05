# EMCAD 분할 모델 → TFLite 온디바이스 변환

서버(FastAPI + PyTorch)로 보내던 병변 분할 추론을 폰에서 직접 돌리기 위해
`emcad_pvtv2b0_352.pth`(EMCAD + PVTv2-B0, 7/10 체크포인트, `server.py`와 동일)를
`.tflite`로 변환한 결과와 절차.

## 산출물
- `assets/skin_emcad_352_f32.tflite` — 분할(segmentation) 모델, float32, 약 15.9 MB
- `assets/skin_severity_384_f32.tflite` — 중증도 분류기, float32, 약 14 MB
- `conv/out/skin_emcad.onnx` — 중간 ONNX (참고용, 실제 변환엔 미사용)

## 모델 입출력 규격 (RN 통합 계약)
- **입력** : `input` shape `[1, 3, 352, 352]`, dtype `float32`, **NCHW**
  - 전처리(=`server.py`와 동일): RGB → 352×352 리사이즈 → `/255` → ImageNet 정규화
    `mean=[0.485,0.456,0.406] std=[0.229,0.224,0.225]` → `(H,W,C)`를 `(C,H,W)`로 transpose
- **출력** : `mask` shape `[1, 1, 352, 352]`, dtype `float32`
  - 값은 병변 확률(0~1, sigmoid 적용됨). 이진 마스크는 앱에서 `prob > 0.5`
  - 면적 비율(%) = `(prob > 0.5).mean() * 100`  (server.py `area_pct`와 동일)
- 원본 EMCADNet은 deep-supervision 헤드 4개 `[p4,p3,p2,p1]`를 반환하지만,
  변환 시 최종 헤드 `p1`에 sigmoid를 적용한 **단일 출력**으로 래핑함.

## 검증 결과 (원본 PyTorch 서버 모델 대비)
- 랜덤 입력: max 절대오차 **9.5e-7**, 마스크 일치율 **100%**
- 실제 병변 이미지 end-to-end: max 오차 **1.07e-6**, `area_pct` torch 62.8% == tflite 62.8%

## 중증도 분류기 규격 (skin_severity_384_f32.tflite)
분할 마스크로 병변 영역만 남긴 이미지를 받아 전체 중증도(IGA) + 개별 병변 4종을 분류.
백본 = timm 정품 PVTv2-B0 (num_classes=0, global_pool='avg') + Linear 헤드 5개.

- **입력** : `input` shape `[1, 3, 384, 384]`, dtype `float32`, **NCHW**
  - 전처리(=`server.py` `cls_masked_input`+`cls_preprocess`): 원본을 1024 기준 스케일 →
    seg 마스크 15px(@1024) 팽창 → 배경 0 → letterbox 384(비율 유지 + center 0패딩) →
    `/255` → ImageNet 정규화 → CHW. (마스크가 비면 원본 그대로 letterbox)
- **출력** : 5개 텐서, **raw logits** (softmax는 앱에서 적용). 출력 인덱스 순서 고정:

  | index | head | shape | 클래스(순서=인덱스) |
  |---|---|---|---|
  | 0 | `iga_grade` | `[1,5]` | Clear, Almost Clear, Mild, Moderate, Severe |
  | 1 | `erythema` | `[1,4]` | None, Mild, Moderate, Severe |
  | 2 | `papulation` | `[1,4]` | None, Mild, Moderate, Severe |
  | 3 | `excoriation` | `[1,4]` | None, Mild, Moderate, Severe |
  | 4 | `lichenification` | `[1,4]` | None, Mild, Moderate, Severe |

  - 앱 로직(server.py `classify`와 동일): 각 헤드 `softmax`→`argmax`. 개별 병변은
    argmax가 `None`이면 미검출로 제외, 나머지는 확률 높은순 정렬. `iga_grade`는 항상 표시.
- **검증**(원본 PyTorch 대비): 5개 헤드 모두 max 오차 ~1e-6, argmax(예측 등급) 전부 일치.
- 변환 주의: `emcad/lib.pvtv2`를 import하면 timm 레지스트리의 정품 `pvt_v2_b0`이 덮어써지므로
  분류기 변환 스크립트(`3_export_severity_tflite.py`)는 emcad를 절대 import하지 않는다.

## 변환 절차
PyTorch → TFLite 직접 변환기 **litert-torch(구 ai-edge-torch)** 사용.
(torch.export→StableHLO 경로라 onnx2tf처럼 NCHW/NHWC를 추측하지 않아 PVTv2 트랜스포머에 적합)

```bash
# 시스템 torch 2.10 재사용 venv (/home/work/MINJI/.aet_venv)
python conv/2_export_tflite.py    # → conv/out/skin_emcad_f32.tflite
```

### 변환 중 걸림돌과 해결
1. **onnx2tf 경로 실패** — PVTv2의 `(B,N,C)` 토큰 텐서를 conv `(B,C,W)`로 오인해
   MLP bias add 축이 깨짐(`[?,7744,256]` vs `[1,256,1]`). → litert-torch로 경로 변경.
2. **torch 2.10 신규 dynamo ONNX exporter가 `adaptive_max_pool2d` 미지원**
   → (ONNX가 필요할 경우) 레거시 exporter `dynamo=False` + opset 16 사용.
3. **litert-torch가 `aten.adaptive_max_pool2d` lowering 없음** (CAB 채널어텐션의 전역 max)
   → 변환 스크립트에서만 `AdaptiveMaxPool2d(1)`을 커널=전체 spatial인 `max_pool2d`로 치환
   (수학적으로 동일, 서버가 쓰는 `emcad/lib/decoders.py`는 그대로 둠).

## 다음 단계 (선택)
- float16 weight quantization으로 두 모델 모두 ~절반 축소 가능 (정확도 거의 동일)
- RN 통합: `react-native-fast-tflite` 등으로 두 `.tflite`(분할→분류 순서)를 로드,
  위 전처리/후처리를 JS에서 구현. FastAPI `/predict` 호출을 대체.
  파이프라인: 이미지 → [분할 tflite] → 마스크 → area_pct/오버레이 +
  마스크로 병변만 남긴 384 입력 → [분류 tflite] → iga/병변별 등급.
