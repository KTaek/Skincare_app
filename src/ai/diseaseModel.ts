import { loadTensorflowModel, type TensorflowModel } from 'react-native-fast-tflite';
import { extractNormalizedRGB, loadSkImage } from './skiaPixels';
import meta from '../../assets/models/disease_labels.json';

/**
 * 질환 분류 모델 (EfficientNet-B0, 512px, 6-way).
 *
 * 학습 체크포인트: classification_disease/runs/old/dis_effb0_r512_both/best.pt
 * 변환:           tools/export_disease_tflite.py (PyTorch → ONNX → onnx2tf → TFLite)
 * 전처리 규약:    Resize(512,512) → ImageNet 정규화 (학습 시 eval 변환과 동일)
 *
 * 입출력은 float32 다. 입출력까지 float16 인 모델은 TFLite CPU 커널이 CONV_2D 를 준비하지 못해
 * 로딩 시점에 "Failed to allocate memory for input/output tensors" 로 죽는다.
 */

export interface DiseasePrediction {
  /** 학습 라벨 (건선/아토피/여드름/정상/주사/지루) */
  key: string;
  /** 화면에 쓰는 이름 (아토피 → 아토피피부염 등) */
  label: string;
  /** 0~1 */
  score: number;
}

const CLASSES: string[] = meta.classes;
const DISPLAY: string[] = meta.display_names;
const IMG_SIZE: number = meta.imgsz;

let modelPromise: Promise<TensorflowModel> | null = null;

function getModel(): Promise<TensorflowModel> {
  if (!modelPromise) {
    modelPromise = loadTensorflowModel(require('../../assets/models/disease_model_float32.tflite'), []);
  }
  return modelPromise;
}

/** 문진 화면 진입 시 미리 불러두면 첫 추론 지연이 줄어든다 */
export function preloadDiseaseModel(): void {
  getModel().catch(() => {
    // 미리 불러오기 실패는 무시 — 실제 추론 시 다시 시도한다
  });
}

const softmax = (logits: Float32Array): number[] => {
  const max = Math.max(...logits);
  const exps = Array.from(logits, (v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((v) => v / sum);
};

/** 사진 한 장 → 질환 확률 (높은 순). 정상 클래스도 그대로 포함해 돌려준다. */
export async function classifyDisease(uri: string): Promise<DiseasePrediction[]> {
  const image = await loadSkImage(uri);
  const input = extractNormalizedRGB(
    image,
    { x: 0, y: 0, width: image.width(), height: image.height() },
    IMG_SIZE,
    meta.mean,
    meta.std,
  );
  const model = await getModel();
  // 입출력 모두 float32 — 버퍼를 그대로 주고받는다 (float16 변환 없음)
  const [output] = await model.run([input.buffer as ArrayBuffer]);
  const probs = softmax(new Float32Array(output));
  return CLASSES.map((key, i) => ({ key, label: DISPLAY[i] ?? key, score: probs[i] }))
    .sort((a, b) => b.score - a.score);
}
