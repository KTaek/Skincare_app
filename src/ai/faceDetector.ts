import { loadTensorflowModel, type TensorflowModel } from 'react-native-fast-tflite';
import type { SkImage } from '@shopify/react-native-skia';
import { readLetterboxRGBA, unletterbox, type Letterbox } from './skiaPixels';
import faceMeta from '../../assets/models/face_labels.json';

/**
 * 얼굴 검출(BlazeFace, MediaPipe face_detection_short_range) — 128px, 229KB.
 *
 * 여기서 얼굴은 진단 대상이 아니라 **자(ruler)**다. 병변 면적을 회차 간 비교하려면 시간에 따라
 * 변하지 않는 기준 길이가 필요한데, 병변 자체는 변하는 대상이라 기준이 될 수 없다(그래서
 * frameQuality.ts의 구도 게이트가 걷어내졌다). 얼굴 골격은 몇 달 단위로 변하지 않으므로
 * 눈 두 점과 입 한 점이면 배율·자세·회전을 모두 잴 수 있다.
 *
 * 모델이 내는 것은 앵커 기준의 상대 좌표라 앱이 앵커를 똑같이 만들어 되풀어야 한다. 앵커 생성은
 * MediaPipe의 SsdAnchorsCalculator를 그대로 옮긴 것이고, 규격(128px · 896 앵커 · 앵커당 16값 ·
 * 키포인트 6개)은 assets/models/face_labels.json에 적어 두었다. 모델을 바꾸면 그 파일과 이
 * 파일을 함께 고쳐야 한다 (tools/export_face_tflite.py가 해시로 지킨다).
 *
 * 모델을 못 불러와도 앱은 그대로 돌아간다 — 얼굴 정렬·면적 측정만 조용히 꺼지고, 기존 촬영
 * 경로(피부·초점·노출 게이트, 등급 판정)는 아무 영향을 받지 않는다. 웹 미리보기에서는
 * react-native-fast-tflite 자체가 스텁이라 항상 이 경로로 떨어진다.
 */

export interface Pt {
  x: number;
  y: number;
}

/** BlazeFace의 키포인트 6개. 좌/우는 **사진에서 보이는 대로**가 아니라 피검자 기준이다. */
export interface FaceKeypoints {
  rightEye: Pt;
  leftEye: Pt;
  nose: Pt;
  mouth: Pt;
  rightEar: Pt;
  leftEar: Pt;
}

export interface FaceDetection {
  /** 0~1 확신도 */
  score: number;
  /** 원본 픽셀 좌표계의 얼굴 상자 */
  box: { x: number; y: number; width: number; height: number };
  /** 원본 픽셀 좌표계의 키포인트 */
  kp: FaceKeypoints;
}

const META = faceMeta as {
  img_size: number;
  num_anchors: number;
  num_coords: number;
  num_keypoints: number;
  anchor_options: {
    num_layers: number;
    min_scale: number;
    max_scale: number;
    strides: number[];
    anchor_offset_x: number;
    anchor_offset_y: number;
    interpolated_scale_aspect_ratio: number;
  };
  score_threshold: number;
  iou_merge_threshold: number;
};

const SIZE = META.img_size;
const NUM_COORDS = META.num_coords;

let modelPromise: Promise<TensorflowModel> | null = null;
/** 한 번 실패하면 다시 시도하지 않는다 — 매 틱마다 같은 실패를 되풀이할 이유가 없다 */
let unavailable = false;

function getModel(): Promise<TensorflowModel> {
  if (!modelPromise) {
    modelPromise = loadTensorflowModel(require('../../assets/models/face_det_128.tflite'), []);
  }
  return modelPromise;
}

/**
 * 얼굴 검출을 쓸 수 있는지. false면 얼굴 모드(고스트·정렬 게이트·면적 측정)를 켜지 않는다.
 * 한 번이라도 로딩에 실패해야 false가 되므로, 처음에는 낙관적으로 true다.
 */
export function isFaceDetectionAvailable(): boolean {
  return !unavailable;
}

/** 촬영 화면에 들어올 때 미리 불러 두면 첫 틱의 지연이 사라진다 */
export async function preloadFaceModel(): Promise<void> {
  if (unavailable) return;
  try {
    await getModel();
  } catch (e: any) {
    unavailable = true;
    console.warn('[face] 모델을 불러오지 못했어요 — 얼굴 정렬/면적 측정을 끕니다:', e?.message ?? e);
  }
}

/**
 * 찾은 얼굴 상자를 이만큼 넓혀 한 번 더 본다.
 *
 * 왜 두 번 보는가. 모델 입력이 128px이라, 세로 3:4 프레임에서 얼굴이 화면의 절반쯤을 차지해도
 * 얼굴에 돌아가는 것은 50px 남짓이다. 그 해상도에서 나오는 키포인트로는 **거리가 달라졌을 뿐인
 * 두 사진의 d/v가 10% 가까이 벌어진다** — 자세 게이트 임계값(5%)의 두 배다. 즉 사용자가 정면을
 * 그대로 보고 있어도 가까이 가기만 하면 "고개를 돌렸다"고 막게 된다.
 *
 * 얼굴 자리만 잘라 다시 넣으면 같은 128px이 얼굴에 온전히 쓰인다. 실측(같은 얼굴을 520·760·900px로
 * 찍어 비교):
 *
 *     d/v 퍼짐        1패스 9.63%  → 2패스 0.69%
 *     넓이 지수 오차   1패스 7.7%   → 2패스 1.4%
 *
 * 값이 싸다 — 128px 추론 한 번이 더 붙을 뿐이고, 예전에 걷어낸 512px 세그 한 번의 16분의 1이다.
 */
const REFINE_EXPAND = 1.8;

/**
 * 이미지에서 가장 확신도 높은 얼굴 하나를 찾는다. 없거나 모델을 못 쓰면 null.
 *
 * 얼굴이 여러 개여도 하나만 돌려준다 — 이 앱에서 화면에 얼굴이 둘 이상 나오는 경우는
 * "다른 사람이 같이 찍혔다"뿐이고, 그때 재야 할 것은 화면을 가장 크게 차지한 얼굴이다.
 */
export async function detectFace(image: SkImage): Promise<FaceDetection | null> {
  const first = await runDetector(image);
  if (!first) return null;

  // 찾은 자리를 크게 다시 본다. 두 번째 판이 실패하면(잘라 낸 그림에서 못 찾는 경우)
  // 첫 판을 그대로 쓴다 — 정밀도가 조금 떨어질 뿐 못 쓰는 값은 아니다.
  const side = Math.max(first.box.width, first.box.height) * REFINE_EXPAND;
  const cx = first.box.x + first.box.width / 2;
  const cy = first.box.y + first.box.height / 2;
  const crop = intersect(
    { x: cx - side / 2, y: cy - side / 2, width: side, height: side },
    image.width(),
    image.height(),
  );
  if (!crop) return first;

  return (await runDetector(image, crop)) ?? first;
}

/** 사각형을 이미지 안으로 자른다. 남는 것이 없으면 null */
function intersect(
  rect: { x: number; y: number; width: number; height: number },
  imageW: number,
  imageH: number,
): { x: number; y: number; width: number; height: number } | null {
  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  const width = Math.min(imageW, rect.x + rect.width) - x;
  const height = Math.min(imageH, rect.y + rect.height) - y;
  return width >= 8 && height >= 8 ? { x, y, width, height } : null;
}

/** 검출 한 판. src를 주면 그 부분만 잘라서 본다 (좌표는 언제나 원본 기준으로 돌려준다) */
async function runDetector(
  image: SkImage,
  src?: { x: number; y: number; width: number; height: number },
): Promise<FaceDetection | null> {
  if (unavailable) return null;

  let model: TensorflowModel;
  try {
    model = await getModel();
  } catch (e: any) {
    unavailable = true;
    console.warn('[face] 모델을 불러오지 못했어요 — 얼굴 정렬/면적 측정을 끕니다:', e?.message ?? e);
    return null;
  }

  const { pixels, box } = readLetterboxRGBA(image, SIZE, src);
  // BlazeFace의 정규화는 imagenet이 아니라 [-1, 1]이다
  const input = new Float32Array(SIZE * SIZE * 3);
  for (let i = 0, o = 0; i < pixels.length; i += 4) {
    input[o++] = pixels[i] / 127.5 - 1;
    input[o++] = pixels[i + 1] / 127.5 - 1;
    input[o++] = pixels[i + 2] / 127.5 - 1;
  }

  const outputs = await model.run([input.buffer as ArrayBuffer]);
  // 출력 순서를 코드에 박지 않는다 — 길이로 가른다 (회귀는 앵커×16, 점수는 앵커×1)
  const anchors = getAnchors();
  let regressors: Float32Array | null = null;
  let scores: Float32Array | null = null;
  for (const out of outputs) {
    const arr = new Float32Array(out as ArrayBufferLike);
    if (arr.length === anchors.length * NUM_COORDS) regressors = arr;
    else if (arr.length === anchors.length) scores = arr;
  }
  if (!regressors || !scores) {
    unavailable = true;
    console.warn('[face] 모델 출력 모양이 예상과 달라요 — 얼굴 정렬/면적 측정을 끕니다');
    return null;
  }

  return decodeBest(regressors, scores, anchors, box);
}

/** 앵커 하나 — 중심만 있으면 된다 (이 모델은 fixed_anchor_size라 폭·높이가 항상 1이다) */
interface Anchor {
  cx: number;
  cy: number;
}

let anchorCache: Anchor[] | null = null;

/**
 * MediaPipe SsdAnchorsCalculator 포팅.
 *
 * stride 8 격자(16×16)에 앵커 2개, stride 16 격자(8×8)에 앵커 6개 — 합쳐서 896개다.
 * 같은 stride를 쓰는 층들이 하나의 격자를 나눠 쓰기 때문에 바깥 루프가 층을 건너뛰며 돈다.
 */
function getAnchors(): Anchor[] {
  if (anchorCache) return anchorCache;

  const o = META.anchor_options;
  const anchors: Anchor[] = [];
  let layer = 0;

  while (layer < o.num_layers) {
    let perCell = 0;
    let sameStrideEnd = layer;
    while (sameStrideEnd < o.num_layers && o.strides[sameStrideEnd] === o.strides[layer]) {
      // 각 층은 자기 종횡비 하나(1.0) + 다음 층과의 기하평균 스케일 하나를 더한다
      perCell += 1;
      if (o.interpolated_scale_aspect_ratio > 0) perCell += 1;
      sameStrideEnd += 1;
    }

    const stride = o.strides[layer];
    const cells = Math.ceil(SIZE / stride);
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        for (let a = 0; a < perCell; a++) {
          anchors.push({ cx: (x + o.anchor_offset_x) / cells, cy: (y + o.anchor_offset_y) / cells });
        }
      }
    }
    layer = sameStrideEnd;
  }

  if (anchors.length !== META.num_anchors) {
    // 규격이 어긋나면 좌표가 통째로 틀어진다 — 조용히 이상한 값을 내는 것보다 여기서 막는다
    throw new Error(`앵커 수가 맞지 않아요 (${anchors.length} ≠ ${META.num_anchors})`);
  }
  anchorCache = anchors;
  return anchors;
}

const sigmoid = (v: number) => 1 / (1 + Math.exp(-Math.max(-100, Math.min(100, v))));

/**
 * 가장 점수가 높은 검출 하나를 뽑고, 그것과 충분히 겹치는 이웃 검출들을 점수로 가중평균한다.
 *
 * 최댓값 하나만 쓰면 키포인트가 틱마다 몇 픽셀씩 떨린다 — 그 떨림이 그대로 배율·각도 판정에
 * 들어와 정렬 막대가 깜빡인다. 겹치는 것들을 섞으면(MediaPipe의 weighted NMS와 같은 방식)
 * 좌표가 눈에 띄게 안정된다. 얼굴은 하나만 쓰므로 나머지 후보를 제거하는 절차는 필요 없다.
 */
function decodeBest(
  regressors: Float32Array,
  scores: Float32Array,
  anchors: Anchor[],
  box: Letterbox,
): FaceDetection | null {
  let bestIndex = -1;
  let bestScore = META.score_threshold;
  for (let i = 0; i < scores.length; i++) {
    const s = sigmoid(scores[i]);
    if (s > bestScore) {
      bestScore = s;
      bestIndex = i;
    }
  }
  if (bestIndex < 0) return null;

  const best = decodeRaw(regressors, anchors, bestIndex);

  // 겹치는 후보를 점수로 가중평균 — 값이 흔들리는 것을 줄이는 것이 목적이다
  let wsum = 0;
  const acc = new Float32Array(NUM_COORDS);
  for (let i = 0; i < scores.length; i++) {
    const s = sigmoid(scores[i]);
    if (s <= META.score_threshold) continue;
    const cand = decodeRaw(regressors, anchors, i);
    if (iou(best, cand) < META.iou_merge_threshold) continue;
    wsum += s;
    for (let k = 0; k < NUM_COORDS; k++) acc[k] += cand[k] * s;
  }
  const merged = wsum > 0 ? acc.map((v) => v / wsum) : best;

  const at = (i: number) => unletterbox(box, merged[i], merged[i + 1]);
  const center = at(0);
  const halfW = (merged[2] * box.size) / box.scale / 2;
  const halfH = (merged[3] * box.size) / box.scale / 2;

  return {
    score: bestScore,
    box: { x: center.x - halfW, y: center.y - halfH, width: halfW * 2, height: halfH * 2 },
    kp: {
      rightEye: at(4),
      leftEye: at(6),
      nose: at(8),
      mouth: at(10),
      rightEar: at(12),
      leftEar: at(14),
    },
  };
}

/**
 * 앵커 하나의 원시 출력 → 정사각형 정규화 좌표.
 * [cx, cy, w, h, kp0x, kp0y, ... kp5x, kp5y] 순으로 16개.
 */
function decodeRaw(regressors: Float32Array, anchors: Anchor[], index: number): Float32Array {
  const a = anchors[index];
  const o = index * NUM_COORDS;
  const out = new Float32Array(NUM_COORDS);
  out[0] = regressors[o] / SIZE + a.cx;
  out[1] = regressors[o + 1] / SIZE + a.cy;
  out[2] = regressors[o + 2] / SIZE;
  out[3] = regressors[o + 3] / SIZE;
  for (let k = 4; k < NUM_COORDS; k += 2) {
    out[k] = regressors[o + k] / SIZE + a.cx;
    out[k + 1] = regressors[o + k + 1] / SIZE + a.cy;
  }
  return out;
}

/** 두 검출 상자의 IoU (정규화 좌표, [cx, cy, w, h] 형식) */
function iou(a: Float32Array, b: Float32Array): number {
  const ax1 = a[0] - a[2] / 2;
  const ay1 = a[1] - a[3] / 2;
  const ax2 = a[0] + a[2] / 2;
  const ay2 = a[1] + a[3] / 2;
  const bx1 = b[0] - b[2] / 2;
  const by1 = b[1] - b[3] / 2;
  const bx2 = b[0] + b[2] / 2;
  const by2 = b[1] + b[3] / 2;

  const iw = Math.min(ax2, bx2) - Math.max(ax1, bx1);
  const ih = Math.min(ay2, by2) - Math.max(ay1, by1);
  if (iw <= 0 || ih <= 0) return 0;
  const inter = iw * ih;
  const union = (ax2 - ax1) * (ay2 - ay1) + (bx2 - bx1) * (by2 - by1) - inter;
  return union > 0 ? inter / union : 0;
}
