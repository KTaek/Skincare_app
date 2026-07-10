import { loadTensorflowModel, type TensorflowModel } from 'react-native-fast-tflite';
import { float32ArrayToFloat16Buffer, float16BufferToFloat32Array } from './float16';
import { SIGN_KEYS, type SignKey } from './labels';

let segModelPromise: Promise<TensorflowModel> | null = null;
let clsModelPromise: Promise<TensorflowModel> | null = null;

function getSegModel(): Promise<TensorflowModel> {
  if (!segModelPromise) {
    segModelPromise = loadTensorflowModel(require('../../assets/models/seg_model_float16.tflite'), []);
  }
  return segModelPromise;
}

function getClsModel(): Promise<TensorflowModel> {
  if (!clsModelPromise) {
    clsModelPromise = loadTensorflowModel(require('../../assets/models/cls_model_float16.tflite'), []);
  }
  return clsModelPromise;
}

/** 카메라 화면 진입 시 미리 호출해두면 첫 추론 지연을 없앨 수 있다 */
export async function preloadModels(): Promise<void> {
  await Promise.all([getSegModel(), getClsModel()]);
}

/** Stage1: 분할 모델 실행. 512x512x3 정규화 입력 → 512x512 마스크 확률(0~1) */
export async function runSegModel(input: Float32Array): Promise<Float32Array> {
  const model = await getSegModel();
  const [output] = await model.run([float32ArrayToFloat16Buffer(input)]);
  return float16BufferToFloat32Array(output);
}

export type ClsLogits = Record<SignKey | 'iga', Float32Array>;

/** Stage2: 분류 모델 실행. 224x224x3 정규화 입력 → sign별 logits (그래프 출력 순서 = erythema, papulation, excoriation, lichenification, iga) */
export async function runClsModel(input: Float32Array): Promise<ClsLogits> {
  const model = await getClsModel();
  const outputs = await model.run([float32ArrayToFloat16Buffer(input)]);

  const result = {} as ClsLogits;
  SIGN_KEYS.forEach((key, i) => {
    result[key] = float16BufferToFloat32Array(outputs[i]);
  });
  result.iga = float16BufferToFloat32Array(outputs[SIGN_KEYS.length]);
  return result;
}
