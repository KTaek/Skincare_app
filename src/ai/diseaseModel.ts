import { createModelSlot } from './modelLoader';
import { extractNormalizedRGB, withSkImage, type CropRect } from './skiaPixels';
import { roiOf, tiltOf, type ScaleFrame } from './scaleFrame';
import { skinCropOf } from '../monitoring/skinMask';
import meta from '../../assets/models/disease_labels.json';

/**
 * 질환 분류 모델 (EfficientNet-B0, 512px, 6-way).
 *
 * 학습 체크포인트: cls_dis_512.pt
 * 변환:           tools/export_models.py (PyTorch → ONNX → onnx2tf → TFLite)
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

const slot = createModelSlot('disease_cls_512', () => require('../../assets/models/disease_cls_512.tflite'));
const getModel = () => slot.get();

/**
 * 문진 화면 진입 시 미리 불러두면 첫 추론 지연이 줄어든다.
 * 실패는 무시한다 — 캐시에 남지 않으므로(modelLoader) 실제 추론 때 다시 받는다.
 */
export function preloadDiseaseModel(): void {
  getModel().catch(() => {});
}

const softmax = (logits: Float32Array): number[] => {
  const max = Math.max(...logits);
  const exps = Array.from(logits, (v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((v) => v / sum);
};

/**
 * 사진 한 장 → 질환 확률 (높은 순). 정상 클래스도 그대로 포함해 돌려준다.
 *
 * colorGain은 촬영 후처리가 계산한 조명 보정값이다.
 *
 * **어디를 볼지는 세 단계로 정한다.**
 *
 *   1. scale이 있으면(얼굴 자리) 그 관심영역을 **기울기까지 되돌려** 잘라 넣는다.
 *      고개가 기울어 찍힌 사진을 반듯하게 세워서 보여주는 것이라, 촬영 때 수평을 맞추라고
 *      요구할 이유가 사라진다 — 되돌릴 수 있는 것을 사용자에게 시키지 않는다.
 *   2. 없으면 피부가 모여 있는 자리로 좁힌다(skinCropOf). 이것이 촬영 게이트에서 "피부 55%"를
 *      걷어낸 대가를 치르는 자리다 — 화면의 3분의 2가 카펫인 사진을 막는 대신, 카펫을 빼고
 *      모델에 넣는다. 이미 찍어 둔 앨범 사진에도 똑같이 적용된다는 것이 게이트에는 없던 이점이다.
 *   3. 피부가 이미 충분히 담긴 사진이면 skinCropOf가 null을 돌려주고, 예전 그대로 프레임 전체를
 *      쓴다 — 이 모델은 그렇게 학습됐으므로 잘 찍힌 사진까지 건드릴 이유가 없다.
 */
export async function classifyDisease(
  uri: string,
  colorGain?: readonly number[],
  /** 촬영 때 찾아 둔 자 — 있으면 그 관심영역을 기울기까지 되돌려 잘라 쓴다 */
  scale?: ScaleFrame | null,
): Promise<DiseasePrediction[]> {
  const input = await withSkImage(uri, (image) => {
    const full = { x: 0, y: 0, width: image.width(), height: image.height() };
    const src: CropRect = scale
      ? { ...roiOf(scale, image.width(), image.height()), rotation: tiltOf(scale) }
      : (skinCropOf(image) ?? full);
    return extractNormalizedRGB(image, src, IMG_SIZE, meta.mean, meta.std, colorGain);
  });
  const model = await getModel();
  // 입출력 모두 float32 — 버퍼를 그대로 주고받는다 (float16 변환 없음)
  const [output] = await model.run([input.buffer as ArrayBuffer]);
  const probs = softmax(new Float32Array(output));
  return CLASSES.map((key, i) => ({ key, label: DISPLAY[i] ?? key, score: probs[i] }))
    .sort((a, b) => b.score - a.score);
}
