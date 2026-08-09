import { loadTensorflowModel, type TensorflowModel } from 'react-native-fast-tflite';
import { labels, SIGN_KEYS, type SignKey } from './labels';

/**
 * 온디바이스 모델 2종 로더 — 증상 부위 분할(Stage1)과 중증도 분류(Stage2).
 *
 *   seg_lesion_512.tflite : UNet++/EfficientNet-B0, 512px. 시그모이드까지 모델 안에서 태워
 *                           0~1 확률 마스크를 그대로 낸다 (앱은 임계값만 적용).
 *   sev_cls_384.tflite    : PVTv2-B0, 384px, 헤드 5개(증상 4가지 + IGA).
 *
 * 두 모델 모두 **입출력이 float32**다. 입출력까지 float16으로 만든 모델은 TFLite CPU 커널이
 * CONV_2D를 준비하지 못해 로딩 시점에 "Failed to allocate memory for input/output tensors"로
 * 죽는다 — 예전에 이 흐름 전체가 막혀 dump 값으로 우회하던 원인이 그것이었다.
 *
 * 변환: tools/export_models.py (PyTorch → ONNX → onnx2tf → TFLite)
 */

let segModelPromise: Promise<TensorflowModel> | null = null;
let clsModelPromise: Promise<TensorflowModel> | null = null;

function getSegModel(): Promise<TensorflowModel> {
  if (!segModelPromise) {
    segModelPromise = loadTensorflowModel(require('../../assets/models/seg_lesion_512.tflite'), []);
  }
  return segModelPromise;
}

function getClsModel(): Promise<TensorflowModel> {
  if (!clsModelPromise) {
    clsModelPromise = loadTensorflowModel(require('../../assets/models/sev_cls_384.tflite'), []);
  }
  return clsModelPromise;
}

/** 촬영 화면 진입 시 미리 호출해두면 첫 추론 지연을 없앨 수 있다 */
export async function preloadModels(): Promise<void> {
  await Promise.all([getSegModel(), getClsModel()]);
}

/** Stage1: 분할 모델 실행. 512×512×3 정규화 입력 → 512×512 마스크 확률(0~1) */
export async function runSegModel(input: Float32Array): Promise<Float32Array> {
  const model = await getSegModel();
  const [output] = await model.run([input.buffer as ArrayBuffer]);
  return new Float32Array(output);
}

export type ClsLogits = Record<SignKey | 'iga', Float32Array>;

/**
 * Stage2: 중증도 모델 실행. 384×384×3 정규화 입력 → 헤드별 logits.
 *
 * 출력 순서는 onnx2tf가 정하기 때문에 코드에 박아두지 않는다 — 변환할 때 PyTorch 결과와
 * 대조해 알아낸 실제 순서를 labels.json의 cls_output_order에 적어 두고 그대로 따른다.
 */
export async function runClsModel(input: Float32Array): Promise<ClsLogits> {
  const model = await getClsModel();
  const outputs = await model.run([input.buffer as ArrayBuffer]);
  const order = labels.cls_output_order;

  const result = {} as ClsLogits;
  SIGN_KEYS.forEach((key, i) => {
    result[key] = new Float32Array(outputs[order[i]]);
  });
  result.iga = new Float32Array(outputs[order[SIGN_KEYS.length]]);
  return result;
}
