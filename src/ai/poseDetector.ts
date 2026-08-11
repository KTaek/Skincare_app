import type { TensorflowModel } from 'react-native-fast-tflite';
import type { SkImage } from '@shopify/react-native-skia';
import { createModelSlot, preloadInOrder } from './modelLoader';
import { readLetterboxRGBA, unletterbox, type Letterbox } from './skiaPixels';
import poseMeta from '../../assets/models/pose_labels.json';

/**
 * 자세 추정(BlazePose) — 몸통 넓이를 재기 위한 **자(ruler)**.
 *
 * 얼굴에서 눈 둘과 입이 하는 일을 여기서는 양 어깨와 양 골반이 한다. 견봉간거리(어깨너비)와 척추
 * 길이는 뼈라서 몇 달 단위로 변하지 않는다 — 허리둘레나 배 폭은 체중에 따라 변하므로 절대 자로
 * 쓸 수 없다(변하는 대상을 기준으로 쓰는 실수는 이 저장소가 이미 한 번 겪었다).
 *
 * ── 왜 두 단계인가 ─────────────────────────────────────────
 *
 *   1단계 pose_det_224      사람을 찾고 골반 중점·전신 크기를 잡는다 (SSD 앵커, 키포인트 4개)
 *   2단계 pose_landmark_256 그 자리를 잘라 넣으면 관절 33개를 낸다 (좌우 어깨·골반이 여기 있다)
 *
 * 1단계만으로는 안 된다. 검출기가 주는 네 점에는 골반 중점과 어깨 중점이 있어 **척추 길이 v는
 * 나오지만 어깨너비 d가 나오지 않는다.** d 없이 v²로 정규화하면 몸을 앞으로 숙이는 것만으로 넓이가
 * 부풀려진다 — 얼굴에서 안간거리 하나(d²)를 쓰지 않는 것과 똑같은 이유다.
 *
 * ── 실측: 프레이밍이 자를 움직인다 ───────────────────────────
 *
 * 공개 사진(MediaPipe 테스트 이미지)으로 이 파이프라인을 그대로 돌려, **같은 방식으로 찍은 회차들
 * 사이의** 흔들림을 쟀다. 정렬 게이트가 허용하는 만큼(배율 ±16%, 위치 ±0.2s)만 흔든 9회의
 * areaRef 퍼짐이다:
 *
 *     머리~허벅지            4.5%   ← 가장 안정적
 *     전신(머리~무릎)         7.6%
 *     머리~골반              9.9%
 *     어깨~무릎 (머리 없음)   14.7%
 *     몸통만                24.4%   ⚠️
 *
 * 읽는 법이 중요하다. **자의 절대 편향은 문제가 아니다** — 넓이 추이는 같은 사람의 회차끼리 나눈
 * 값이라 매번 같은 방식으로 찍으면 편향이 상쇄된다. 문제는 위의 퍼짐이고, 그것은 그대로 넓이
 * 잡음이 된다(지수는 areaRef에 반비례한다).
 *
 * 그리고 갈리는 지점은 다리가 아니라 **머리**다. 머리 없이 무릎까지 넣은 것(14.7%)보다 다리 없이
 * 머리만 넣은 것(9.9%)이 낫다. 검출기가 사람의 크기와 방향을 머리 위치에서 잡기 때문으로 보인다.
 *
 * ⚠️ 표본은 사진 한 장(합성 흔들림)이다. 사람·의상·자세가 바뀌면 달라질 수 있으므로 실기기에서
 *    다시 잴 것. 지금 게이트는 이 표에서 4.5~7.6% 구간만 통과시키도록 잡혀 있다(torsoFrame.ts).
 */

const META = poseMeta as {
  detector: {
    img_size: number;
    num_anchors: number;
    num_coords: number;
    anchor_options: {
      num_layers: number;
      strides: number[];
      anchor_offset_x: number;
      anchor_offset_y: number;
      interpolated_scale_aspect_ratio: number;
    };
    score_threshold: number;
  };
  landmark: {
    img_size: number;
    num_landmarks: number;
    values_per_landmark: number;
    landmark_index: { leftShoulder: number; rightShoulder: number; leftHip: number; rightHip: number };
    presence_threshold: number;
  };
};

const DET = META.detector;
const LM = META.landmark;
const LM_VALUES = LM.num_landmarks * LM.values_per_landmark;

export interface Pt {
  x: number;
  y: number;
}

/** 몸통의 자를 만드는 네 점 */
export interface PoseLandmarks {
  leftShoulder: Pt;
  rightShoulder: Pt;
  leftHip: Pt;
  rightHip: Pt;
  /** 네 점 중 가장 낮은 존재 확률 — 옷이나 팔에 가려지면 떨어진다 */
  presence: number;
  /**
   * 관절별 visibility (0~1) — "이 관절이 **화면에 실제로 보이는가**".
   *
   * presence와 다른 축이다. presence는 "이 사람에게 이 관절이 있는가"에 가까워서, 프레임 밖으로
   * 나간 관절에도 높은 값이 나온다. 모델은 화면 밖 관절의 좌표를 **추정해서** 내놓기 때문에
   * 좌표만 보면 언제나 값이 있고, 그 추정이 화면 안쪽으로 떨어지면 경계 검사(inside)마저 통과한다.
   * 그때 기록되는 것은 있지도 않은 어깨너비다.
   *
   * visibility는 정확히 그 경우를 가려내라고 있는 값인데 여태 디코딩만 하고 버리고 있었다.
   */
  visibility: {
    leftShoulder: number;
    rightShoulder: number;
    leftHip: number;
    rightHip: number;
  };
  /**
   * 좌우 어깨의 깊이 차 (이미지 픽셀과 같은 배율, 부호 있음).
   *
   * 골반 없이 몸통 자를 만들 때 **비틀림(yaw)을 잴 수 있는 유일한 재료**다. 어깨-골반 길이가
   * 있으면 d/v 비율이 그 역할을 하지만, 어깨만 쓰는 자에서는 그 값이 상수가 되어 쓸 수 없다.
   *
   * ⚠️ BlazePose의 z는 x·y보다 부정확하기로 알려져 있다. 그래서 이 값은 "정면인지 아닌지"를
   *    거칠게 가르는 용도로만 쓰고 임계값도 느슨하게 잡는다 — 비틀림 25°까지는 넓이 오차가
   *    ±44% 문턱 안에 들어오므로(1/cos²25° = 1.22) 굳이 조일 이유도 없다.
   */
  shoulderDz: number;
}

const detSlot = createModelSlot('pose_det_224', () => require('../../assets/models/pose_det_224.tflite'));
const lmSlot = createModelSlot('pose_landmark_256', () => require('../../assets/models/pose_landmark_256.tflite'));

/**
 * 되살릴 수 없는 고장 — 출력 규격이 예상과 다른 경우다.
 *
 * 로딩 실패와는 성격이 완전히 다르므로 따로 둔다. 개발 중에는 모델을 Metro에서 받아 오기 때문에
 * 연결이 끊겨 실패하는 일이 흔한데(modelLoader.ts), 그건 다음 시도에 성공할 수 있는 일이다.
 * 반면 출력 모양이 다르면 몇 번을 다시 받아도 같으므로 그때만 영구히 끈다.
 */
let broken = false;

/** 자세 추정을 쓸 수 있는지. false면 몸통 넓이 측정을 켜지 않는다 */
export function isPoseDetectionAvailable(): boolean {
  return !broken && !(detSlot.hopeless || lmSlot.hopeless);
}

/**
 * 촬영 화면에 들어올 때 미리 불러 두면 첫 틱의 지연이 사라진다.
 * 둘을 동시에 받지 않는다 — 개발 중 동시 다운로드가 연결이 끊기는 흔한 원인이다.
 */
export async function preloadPoseModel(): Promise<void> {
  if (!isPoseDetectionAvailable()) return;
  try {
    await preloadInOrder([detSlot, lmSlot]);
  } catch (e: any) {
    // 여기서 끄지 않는다 — 다음 시도에 받아질 수 있다. 몇 번을 해도 안 되면 slot이 알려준다.
    console.warn('[pose] 모델을 아직 못 불러왔어요 (다시 시도합니다):', e?.message ?? e);
  }
}

/**
 * 랜드마크 모델에 넣을 자리를 검출 결과에서 만들 때 쓰는 배수.
 *
 * MediaPipe가 쓰는 값과 같다 — 골반 중점을 중심으로 전신 원의 반지름을 1.25배 한 정사각형.
 * 회전은 적용하지 않는다. MediaPipe는 골반→어깨 축으로 크롭을 세워 넣지만, 이 앱은 애초에
 * 기울기를 게이트로 막고(SCALE_SPEC.torso.gate.rotation ≈ 10°) 서 있는 사람만 찍으므로 회전이
 * 거의 0이다. 실측에서도 세우지 않은 크롭으로 배율 퍼짐 1.9%가 나왔다.
 */
const ROI_SCALE = 1.25;

/**
 * 사진에서 사람 하나를 찾아 어깨·골반 네 점을 돌려준다. 없거나 모델을 못 쓰면 null.
 *
 * 사람이 여럿이면 가장 확신도 높은 하나만 쓴다 — 얼굴과 같은 규칙이고, 다른 사람이 더 크게 찍힌
 * 사진이면 자가 통째로 바뀌므로 그 경우는 사용자가 사진을 잘라 고르게 한다(PhotoCropper).
 */
export async function detectPose(image: SkImage): Promise<PoseLandmarks | null> {
  if (!isPoseDetectionAvailable()) return null;

  let detector: TensorflowModel;
  let landmarker: TensorflowModel;
  try {
    // 하나씩 — 동시에 받으면 개발 서버에서 끊기기 쉽다 (modelLoader.ts)
    detector = await detSlot.get();
    landmarker = await lmSlot.get();
  } catch (e: any) {
    console.warn('[pose] 모델을 아직 못 불러왔어요:', e?.message ?? e);
    return null;
  }

  /*
    사람 검출이 실패하면 **프레임 전체를 정사각형으로 감싸** 랜드마크 모델에 그대로 넣는다.

    왜 필요한가: 이 검출기는 **사람 하나가 통째로 담긴 사진**으로 학습됐다. 골반 중점과 전신
    크기를 함께 예측해서 그 둘로 크롭을 만드는 구조라, 다리도 머리도 없이 몸통만 담긴 사진에서는
    아예 안 잡히거나 전신 원을 엉뚱하게 키운다. 그런데 사용자가 등·가슴을 찍는 자연스러운 구도가
    정확히 그 사진이다 — 검출기가 첫 관문에서 막으면 뒤의 모든 개선이 무의미해진다.

    프레임 전체를 넣는 방식은 예전에 시도해 밀린 적이 있다(areaRef 퍼짐 155%). 다만 그때는 자가
    어깨너비 × **어깨-골반**이라 골반 위치가 값을 좌우했다. 자가 어깨 하나로 바뀐 지금은 골반이
    어디로 추정되든 상관없고, 필요한 것은 어깨 두 점뿐이라 다시 시도할 가치가 있다.
    믿을 수 없는 어깨는 visibility가 걸러 낸다(torsoFrame).

    ⚠️ 이 경로로 들어온 판이 실제로 쓸 만한지는 실기기 로그로 확인할 것 — 아래 경고에 표시된다.
  */
  let roi = await runDetector(detector, image);
  if (!roi) {
    const side = Math.max(image.width(), image.height());
    roi = { x: (image.width() - side) / 2, y: (image.height() - side) / 2, side };
    console.warn('[pose] 사람을 못 찾아 프레임 전체로 관절을 찾습니다', {
      frame: `${image.width()}×${image.height()}`,
    });
  }

  const lm = await runLandmark(landmarker, image, roi);
  if (!lm) {
    console.warn('[pose] 관절을 찾지 못했어요 (presence 미달)', {
      roi: `${Math.round(roi.x)},${Math.round(roi.y)} ${Math.round(roi.side)}px`,
      frame: `${image.width()}×${image.height()}`,
    });
  }
  return lm;
}

/** 1단계 — 사람을 찾아 랜드마크 모델에 넣을 정사각형을 만든다 (원본 픽셀 좌표) */
async function runDetector(
  model: TensorflowModel,
  image: SkImage,
): Promise<{ x: number; y: number; side: number } | null> {
  const size = DET.img_size;
  const { pixels, box } = readLetterboxRGBA(image, size);
  // BlazePose 검출기의 정규화는 얼굴 검출과 같은 [-1, 1]이다
  const input = new Float32Array(size * size * 3);
  for (let i = 0, o = 0; i < pixels.length; i += 4) {
    input[o++] = pixels[i] / 127.5 - 1;
    input[o++] = pixels[i + 1] / 127.5 - 1;
    input[o++] = pixels[i + 2] / 127.5 - 1;
  }

  const outputs = await model.run([input.buffer as ArrayBuffer]);
  // 출력 순서를 코드에 박지 않는다 — 길이로 가른다 (회귀는 앵커×12, 점수는 앵커×1)
  const anchors = getAnchors();
  let regressors: Float32Array | null = null;
  let scores: Float32Array | null = null;
  for (const out of outputs) {
    const arr = new Float32Array(out as ArrayBufferLike);
    if (arr.length === anchors.length * DET.num_coords) regressors = arr;
    else if (arr.length === anchors.length) scores = arr;
  }
  if (!regressors || !scores) {
    broken = true;
    console.warn('[pose] 검출기 출력 모양이 예상과 달라요 — 몸통 넓이 측정을 끕니다');
    return null;
  }

  let bestIndex = -1;
  let bestScore = DET.score_threshold;
  for (let i = 0; i < scores.length; i++) {
    const s = sigmoid(scores[i]);
    if (s > bestScore) {
      bestScore = s;
      bestIndex = i;
    }
  }
  if (bestIndex < 0) {
    // 몸통만 담긴 사진에서 흔하다 — 부르는 쪽이 프레임 전체로 되돌아간다
    console.warn('[pose] 사람 검출 실패 (최고 점수가 문턱 미달)', {
      threshold: DET.score_threshold,
      best: Math.round(bestScore * 100) / 100,
    });
    return null;
  }

  /*
    앵커 기준의 상대 좌표를 푼다. 얼굴과 형식이 같고 개수만 다르다:
    [cx, cy, w, h, kp0x, kp0y, ... kp3x, kp3y] — kp0 = 골반 중점, kp1 = 전신 크기 원 위의 점.
  */
  const a = anchors[bestIndex];
  const o = bestIndex * DET.num_coords;
  const at = (i: number) =>
    unletterbox(box, regressors![o + i] / DET.img_size + a.cx, regressors![o + i + 1] / DET.img_size + a.cy);

  const hip = at(4);
  const full = at(6);
  const radius = Math.hypot(full.x - hip.x, full.y - hip.y);
  const side = 2 * radius * ROI_SCALE;
  if (!(side > 8)) return null;
  return { x: hip.x - side / 2, y: hip.y - side / 2, side };
}

/** 2단계 — 잘라 넣어 관절을 뽑고, 좌표를 원본으로 되돌린다 */
async function runLandmark(
  model: TensorflowModel,
  image: SkImage,
  roi: { x: number; y: number; side: number },
): Promise<PoseLandmarks | null> {
  const size = LM.img_size;
  /*
    관심영역이 사진 밖으로 나가는 것은 정상이다 — 전신 원이 화면보다 클 수 있다. 모자란 자리는
    검게 채워 넣는다(MediaPipe도 같은 방식이고, 실측도 그 상태에서 잰 값이다).
  */
  const { pixels } = readLetterboxRGBA(image, size, {
    x: roi.x,
    y: roi.y,
    width: roi.side,
    height: roi.side,
  });
  // 랜드마크 모델의 정규화는 검출기와 다르다 — [0, 1]이다
  const input = new Float32Array(size * size * 3);
  for (let i = 0, o = 0; i < pixels.length; i += 4) {
    input[o++] = pixels[i] / 255;
    input[o++] = pixels[i + 1] / 255;
    input[o++] = pixels[i + 2] / 255;
  }

  const outputs = await model.run([input.buffer as ArrayBuffer]);
  // 출력이 다섯 개다(랜드마크·확신도·분할마스크·히트맵·월드좌표). 길이로 가른다
  let lms: Float32Array | null = null;
  for (const out of outputs) {
    const arr = new Float32Array(out as ArrayBufferLike);
    if (arr.length === LM_VALUES) lms = arr;
  }
  if (!lms) {
    broken = true;
    console.warn('[pose] 랜드마크 출력 모양이 예상과 달라요 — 몸통 넓이 측정을 끕니다');
    return null;
  }

  const stride = LM.values_per_landmark;
  // x·y는 256px 입력 좌표계로 나온다 → 잘라 온 자리로 되돌린다 (정사각형이라 배율이 하나다)
  const px = (i: number): Pt => ({
    x: roi.x + (lms![i * stride] / size) * roi.side,
    y: roi.y + (lms![i * stride + 1] / size) * roi.side,
  });
  // 랜드마크 하나는 (x, y, z, visibility, presence) 다섯 값이다 — 여태 x·y와 presence만 읽었다
  const zOf = (i: number) => (lms![i * stride + 2] / size) * roi.side;
  const visibilityOf = (i: number) => sigmoid(lms![i * stride + 3]);
  const presenceOf = (i: number) => sigmoid(lms![i * stride + 4]);

  const idx = LM.landmark_index;
  const leftShoulder = px(idx.leftShoulder);
  const rightShoulder = px(idx.rightShoulder);
  const leftHip = px(idx.leftHip);
  const rightHip = px(idx.rightHip);

  const presence = Math.min(
    presenceOf(idx.leftShoulder),
    presenceOf(idx.rightShoulder),
    presenceOf(idx.leftHip),
    presenceOf(idx.rightHip),
  );
  if (presence < LM.presence_threshold) return null;


  const visibility = {
    leftShoulder: visibilityOf(idx.leftShoulder),
    rightShoulder: visibilityOf(idx.rightShoulder),
    leftHip: visibilityOf(idx.leftHip),
    rightHip: visibilityOf(idx.rightHip),
  };
  // z는 x와 같은 배율로 나온다(MediaPipe 규약) — px()와 같은 변환을 태워 이미지 좌표계로 맞춘다
  const shoulderDz = zOf(idx.leftShoulder) - zOf(idx.rightShoulder);

  // 실기기에서 임계값을 잡으려면 성공한 판의 숫자도 보여야 한다 — 실패한 판만 보면
  // "얼마나 아슬아슬하게 통과했는지"를 알 수 없어 어디를 조일지 정할 수 없다
  console.log('[pose] 관절', {
    d: Math.round(Math.hypot(leftShoulder.x - rightShoulder.x, leftShoulder.y - rightShoulder.y)),
    presence: Math.round(presence * 100) / 100,
    visShoulder: `${visibilityOf(idx.leftShoulder).toFixed(2)}/${visibilityOf(idx.rightShoulder).toFixed(2)}`,
    visHip: `${visibilityOf(idx.leftHip).toFixed(2)}/${visibilityOf(idx.rightHip).toFixed(2)}`,
    shoulderDz: Math.round(shoulderDz),
  });

  return { leftShoulder, rightShoulder, leftHip, rightHip, presence, visibility, shoulderDz };
}

const sigmoid = (v: number) => 1 / (1 + Math.exp(-Math.max(-100, Math.min(100, v))));

interface Anchor {
  cx: number;
  cy: number;
}
let anchorCache: Anchor[] | null = null;

/**
 * MediaPipe SsdAnchorsCalculator 포팅 — 얼굴 검출기와 같은 코드, 설정만 다르다.
 *
 * stride 8 격자(28×28)에 앵커 2개, stride 16(14×14)에 2개, stride 32(7×7)를 세 층이 나눠 써서
 * 6개 — 합쳐서 1568 + 392 + 294 = 2254개다. 같은 stride를 쓰는 층들이 하나의 격자를 나눠 쓰기
 * 때문에 바깥 루프가 층을 건너뛰며 돈다.
 */
function getAnchors(): Anchor[] {
  if (anchorCache) return anchorCache;

  const o = DET.anchor_options;
  const size = DET.img_size;
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
    const cells = Math.ceil(size / stride);
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        for (let a = 0; a < perCell; a++) {
          anchors.push({ cx: (x + o.anchor_offset_x) / cells, cy: (y + o.anchor_offset_y) / cells });
        }
      }
    }
    layer = sameStrideEnd;
  }

  if (anchors.length !== DET.num_anchors) {
    // 규격이 어긋나면 좌표가 통째로 틀어진다 — 조용히 이상한 값을 내는 것보다 여기서 막는다
    throw new Error(`앵커 수가 맞지 않아요 (${anchors.length} ≠ ${DET.num_anchors})`);
  }
  anchorCache = anchors;
  return anchors;
}

export type { Letterbox };
