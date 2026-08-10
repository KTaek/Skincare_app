import type { SkImage } from '@shopify/react-native-skia';
import { readResizedRGBA } from '../ai/skiaPixels';
import { estimateSkin, SKIN_GATE } from './skinMask';
import {
  alignTargetFor,
  evaluateAlign,
  ALIGN_GATE,
  faceRoiFits,
  MIN_FACE_SCALE_PX,
  type AlignEvaluation,
  type FaceFrame,
  type FaceFraming,
  type PoseReference,
  type FaceRoi,
} from '../ai/faceFrame';
import { Baseline, FrameEvaluation, HardGateKey, ImageQualityMetrics } from './types';

/**
 * 촬영 게이트 임계값.
 *
 * 원칙 세 가지를 통과한 것만 필수(hard)로 막는다:
 *   1. 후처리로 되돌릴 수 없는가 — 되돌릴 수 있으면 통과시키고 후처리가 흡수한다
 *   2. 사용자가 그 자리에서 몸으로 고칠 수 있는가 — 못 고치면 게이트가 아니라 점수다
 *   3. 기준이 시간에 따라 변하지 않는가 — 변하면 같은 자세로 찍어도 판정이 달라진다
 *
 * 남은 필수 조건은 셋뿐이고, 사용자 동작과 1:1로 대응한다:
 *   가까이/멀리(피부) · 잠깐 멈추기(초점) · 각도 살짝(노출)
 *
 * 뺀 것과 이유:
 *   · 거리·각도 정합 — 면적 측정을 걷어내면서 "지난번과 같은 배율"을 지킬 이유가 사라졌다.
 *   · 구도(framing) — 원칙 3을 어겼다. 병변 세그의 bbox 크기·위치를 기준으로 삼고 있었는데,
 *     ① 정상 피부만 찍으면 검출되는 병변이 없어 영영 통과할 수 없고,
 *     ② 병변이 작아지면(= 좋아지면) bbox가 줄어 게이트에 걸린다 — 호전을 촬영 실패로 취급한다.
 *     크기가 변하는 대상을 크기 기준으로 쓸 수는 없다.
 *
 * 그 결과 이 파일의 판정은 **어떤 모델에도 의존하지 않는다**. 프레임 픽셀만 보면 되므로
 * 촬영 루프에서 세그 추론이 통째로 빠졌다.
 */
export const GATE = {
  /**
   * 정규화 선명도(lapVar/grayVar) 하한. 대비로 나눈 값이라 매끈한 피부에서도 통한다.
   *
   * ⚠️ 이 두 값은 아직 캘리브레이션되지 않은 초기값이다. 지표를 바꿨으므로 예전 라플라시안
   *    절대값(45/140)과는 아무 관계가 없다. 실기기에서 흐린 샷·선명한 샷을 각 20장씩 찍어
   *    두 분포가 갈리는 지점으로 다시 잡을 것.
   *    일부러 낮게 잡아 뒀다 — 너무 높으면 자동 셔터가 영영 안 열려 앱이 고장 난 것처럼 보이는데,
   *    그건 흐린 사진 몇 장이 통과하는 것보다 훨씬 나쁜 실패다 (통과해도 신뢰도 점수가 깎인다).
   */
  focusMin: 0.06,
  /** 이 값 이상이면 초점 점수 만점 */
  focusGood: 0.3,
  /**
   * 직전 프레임과의 상관도 하한. 이 아래면 화면이 움직이는 중이라 보고 셔터를 막는다.
   *
   * 선명도만으로는 "사용자가 가만히 있는가"를 알 수 없다 — takePictureAsync는 실제 정지 촬영이라
   * 밝은 곳에서는 셔터가 짧아 흔들리는 손도 또렷하게 찍힌다. 그러면 초점 게이트는 정당하게
   * 통과하는데 정작 원하는 장면이 아니다. 정지 여부는 애초에 한 장으로는 판정할 수 없는,
   * 프레임 사이에만 존재하는 정보다.
   *
   * 16×16으로 뭉갠 지문을 쓰므로 손떨림 정도의 미세한 흔들림에는 둔감하고,
   * 피사체가 바뀌는 수준의 움직임에만 반응한다. 합성 장면으로 잰 상관도 대응표:
   *
   *   프레임 폭의 1~3% 이동 → 0.99   (손떨림, 통과)
   *   6% 이동              → 0.97   (통과)
   *   12% 이동             → 0.90   (차단)
   *   손이 화면을 가로지름  → 0.24~0.63 (확실히 차단)
   *
   * 즉 0.95는 "틱 사이에 화면 폭의 8% 이상 움직이면 막는다"에 해당한다.
   * ⚠️ 실기기에서 너무 엄격하면(가까이 찍을수록 같은 손동작이 화면에서 크게 움직인다) 0.90까지
   *    낮출 것. focusMin과 함께 캘리브레이션 대상이다.
   */
  stabilityMin: 0.95,
  /** RGB가 전부 날아간 픽셀(경면반사) 상한 */
  highlightClipMax: 0.03,
  /** 채널 하나라도 포화된 픽셀 상한 — 홍반 등급을 지키는 게이트 */
  channelClipMax: 0.02,
  shadowClipMax: 0.18,
  /** ↓ 여기부터는 권장 조건의 "만점 기준" */
  goodBrightnessDelta: 0.06,
  /** 피부 점유율 만점 기준 — 세그 모델 학습 분포(평균 94.5%) 근방 */
  goodSkinRatio: 0.9,
  /** 자동 셔터가 켜지는 권장 점수 (100%가 아니라 "충분히 근접") */
  autoShutterSoftScore: 0.7,
  /** 이 점수를 넘으면 더 좋은 프레임을 기다리지 않고 바로 확정 */
  excellentSoftScore: 0.88,
  /**
   * 면적을 회차 간 비교하려 할 때만 요구하는 밝기 차 상한 (기준 세션 대비).
   *
   * 평소에는 밝기가 권장 조건(soft)이다 — 조명 보정이 게인으로 흡수하고, 등급 판정은 그 정도
   * 차이를 견딘다. 면적은 사정이 다르다: 밝기가 달라지면 세그 마스크의 경계가 통째로 밀려서
   * 병변이 커지거나 작아진 것처럼 보인다. 그 오차는 보정으로 되돌릴 수 없다.
   */
  areaBrightnessDelta: 0.1,
} as const;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** 선명도를 재는 중앙 정사각형의 크기 (짧은 변 대비) */
const FOCUS_ROI = 0.5;
/** 정지 판정용 지문의 한 변. 거칠게 뭉개야 손떨림에 둔감하고 실제 움직임에만 반응한다 */
const SIG_SIZE = 16;
/** 정지 막대의 0점. 상관도는 0.8 아래로 내려가면 어차피 "크게 움직이는 중"이라 구분할 실익이 없다 */
const STABILITY_FLOOR = 0.8;

/**
 * 프레임의 선명도·노출·피부 점유율을 잰다. 어떤 모델도 부르지 않는다.
 *
 * 지표마다 봐야 할 영역이 다르므로 표본을 두 번 뜬다:
 *
 *   · 노출·피부·밝기 → **분석에 들어갈 영역**. 보통은 프레임 전체다(질환 분류 모델이 크롭 없이
 *     프레임을 통째로 먹으므로, 가운데만 재면 "가운데는 피부, 주변은 카펫"인 프레임을 통과시킨다).
 *     얼굴 자리에서는 roi로 얼굴 관심영역이 들어온다 — 그때 분석에 실제로 들어가는 것이 그
 *     영역이고, 배경 창문이 하얗게 날아갔다고 촬영을 막을 이유가 없기 때문이다.
 *   · 선명도 → **가운데 고정 정사각형**. 한때 병변 bbox를 관심영역으로 썼지만, 병변 크기는
 *     세션마다 변하는 값이라 관심영역까지 같이 변해 선명도를 세션 간 비교할 수 없게 된다.
 *     정상 피부만 찍은 사진에는 bbox가 아예 없기도 하다. 고정 영역이라야 기준이 선다.
 *
 * 정지 판정용 지문(signature)만은 roi가 있어도 **항상 프레임 전체**에서 뜬다. 관심영역은 얼굴을
 * 따라 움직이므로, 그 안에서 지문을 뜨면 폰과 얼굴이 함께 움직일 때 "멈춰 있다"고 오판한다.
 */
export function measureImageQuality(
  image: SkImage,
  opts: { sampleSize?: number; roi?: FaceRoi } = {},
): ImageQualityMetrics {
  const sampleSize = opts.sampleSize ?? 160;
  const w = image.width();
  const h = image.height();
  const n = sampleSize * sampleSize;

  // ── 프레임 전체 표본: 정지 판정용 지문 (+ roi가 없으면 나머지 지표도 여기서) ────
  const full = readResizedRGBA(image, { x: 0, y: 0, width: w, height: h }, sampleSize, sampleSize);
  const signature = signatureOf(full, sampleSize);

  // ── 분석 영역 표본: 노출·피부·밝기 ─────────────────────────────
  const region = opts.roi
    ? readResizedRGBA(image, opts.roi, sampleSize, sampleSize)
    : full;

  let sumY = 0;
  let specular = 0;
  let shadow = 0;
  let clipR = 0;
  let clipG = 0;
  let clipB = 0;

  for (let i = 0; i < region.length; i += 4) {
    const r = region[i];
    const g = region[i + 1];
    const b = region[i + 2];

    // 채널별 포화 — 하나라도 255에 붙으면 그 채널의 정보는 사라진 것이다
    if (r >= 250) clipR += 1;
    if (g >= 250) clipG += 1;
    if (b >= 250) clipB += 1;
    // RGB가 동시에 날아간 것은 색 포화가 아니라 경면반사(번들거림)다
    if (r >= 250 && g >= 250 && b >= 250) specular += 1;

    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    sumY += y;
    if (y <= 8) shadow += 1;
  }

  const skin = estimateSkin(region, sampleSize, sampleSize);

  return {
    sharpness: measureSharpness(image, sampleSize, opts.roi),
    highlightClip: specular / n,
    channelClip: Math.max(clipR, clipG, clipB) / n,
    shadowClip: shadow / n,
    brightness: sumY / n / 255,
    skinRatio: skin.ratio,
    skinSource: skin.source,
    skinMedians: skin.skinMedians,
    skinCount: skin.skinCount,
    signature,
  };
}

/** 프레임을 SIG_SIZE×SIG_SIZE 블록 평균으로 뭉갠 정지 판정용 지문 */
function signatureOf(px: Uint8Array, sampleSize: number): Float32Array {
  const block = sampleSize / SIG_SIZE;
  const sig = new Float32Array(SIG_SIZE * SIG_SIZE);
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    const y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    const sx = Math.min(SIG_SIZE - 1, ((p % sampleSize) / block) | 0);
    const sy = Math.min(SIG_SIZE - 1, (((p / sampleSize) | 0) / block) | 0);
    sig[sy * SIG_SIZE + sx] += y;
  }
  return normalizeSignature(sig);
}

/** 평균 0·크기 1로 맞춰, 두 지문의 내적이 곧 정규화 상관도가 되게 한다 */
function normalizeSignature(sig: Float32Array): Float32Array {
  let mean = 0;
  for (let i = 0; i < sig.length; i++) mean += sig[i];
  mean /= sig.length;

  let ss = 0;
  for (let i = 0; i < sig.length; i++) {
    sig[i] -= mean;
    ss += sig[i] * sig[i];
  }
  const norm = Math.sqrt(ss) || 1;
  for (let i = 0; i < sig.length; i++) sig[i] /= norm;
  return sig;
}

/** 두 지문의 상관도 (-1~1, 같을수록 1). 한쪽이 없으면 1 — 비교할 것이 없으면 막지 않는다 */
export function frameSimilarity(a?: Float32Array | null, b?: Float32Array | null): number {
  if (!a || !b || a.length !== b.length) return 1;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * 가운데 고정 영역의 정규화 선명도 = 라플라시안 분산 / 밝기 분산.
 *
 * 생 라플라시안 분산만 보면 "텍스처가 얼마나 많은가"를 재게 되어, 초점이 맞은 매끈한 피부가
 * 흐린 사진과 같은 값으로 나온다. 전체 대비로 나누면 — 흐릴 때는 고주파만 죽고 대비는 남으므로 —
 * 콘텐츠 의존성이 줄어 baseline 없이도 절대 임계값을 쓸 수 있다.
 *
 * roi가 있으면 그 안의 가운데를 잰다. 얼굴 촬영에서 화면 정중앙은 코끝인데, 초점이 맞아야 하는
 * 것은 피부 전체이고 배경이 섞여 들면 값이 흔들린다 — 관심영역 안에서 재야 기준이 같아진다.
 */
function measureSharpness(image: SkImage, sampleSize: number, roi?: FaceRoi): number {
  const rx = roi?.x ?? 0;
  const ry = roi?.y ?? 0;
  const w = roi?.width ?? image.width();
  const h = roi?.height ?? image.height();
  const side = Math.min(w, h) * FOCUS_ROI;
  const src = { x: rx + (w - side) / 2, y: ry + (h - side) / 2, width: side, height: side };

  const px = readResizedRGBA(image, src, sampleSize, sampleSize);
  const gray = new Float32Array(sampleSize * sampleSize);
  let sumY = 0;
  let sumYSq = 0;
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    const y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    gray[p] = y;
    sumY += y;
    sumYSq += y * y;
  }

  let lapSum = 0;
  let lapSqSum = 0;
  let count = 0;
  for (let y = 1; y < sampleSize - 1; y++) {
    const row = y * sampleSize;
    for (let x = 1; x < sampleSize - 1; x++) {
      const i = row + x;
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - sampleSize] - gray[i + sampleSize];
      lapSum += lap;
      lapSqSum += lap * lap;
      count += 1;
    }
  }
  if (count === 0) return 0;

  const n = sampleSize * sampleSize;
  const lapVar = lapSqSum / count - (lapSum / count) ** 2;
  const grayVar = Math.max(sumYSq / n - (sumY / n) ** 2, 1);
  return lapVar / grayVar;
}

/** 얼굴 자리를 찍을 때만 넘어오는 정렬 판정 재료 */
export interface FaceContext {
  frame: FaceFrame | null;
  imageWidth: number;
  imageHeight: number;
  /**
   * 화면에 깔린 지난 사진의 구도 — 이번 촬영이 맞춰야 할 목표.
   * 없으면(첫 촬영) 고정 표준 프레이밍으로 유도한다.
   */
  framing?: FaceFraming;
  /** 자세(d/v) 비교 기준 — 첫 촬영이면 없다 (그때는 코 대칭만으로 정면성을 본다) */
  reference?: PoseReference;
}

/**
 * 필수 조건 → 통과/실패, 권장 조건 → 0~1 점수. 기준 세션이 없으면 밝기 항목은 만점 처리한다.
 *
 * prevSignature를 주면 직전 프레임과의 상관도로 "정지 여부"까지 초점 게이트에 포함한다.
 * 사용자에게는 둘 다 "잠깐 멈춰주세요"로 귀결되는 같은 문제라 칩을 따로 만들지 않았다.
 *
 * face를 주면(얼굴 자리) 정렬 판정을 함께 낸다. 그 결과는 hard에 들어가지 않는다 —
 * 자동 셔터와 면적 측정 자격에만 관여하고, 사진의 신뢰도 점수는 건드리지 않는다.
 */
export function evaluateFrame(
  metrics: ImageQualityMetrics,
  baseline?: Baseline,
  prevSignature?: Float32Array | null,
  face?: FaceContext,
): FrameEvaluation {
  // 피부 게이트 임계값은 추정 출처를 따라간다 — 부정확한 추정기에 높은 임계값을 걸면
  // 멀쩡한 사진을 막게 된다 (skinMask.ts의 SKIN_GATE 주석 참고)
  const skinMin = SKIN_GATE[metrics.skinSource];
  const stability = frameSimilarity(metrics.signature, prevSignature);

  const hard: Record<HardGateKey, boolean> = {
    skin: metrics.skinRatio >= skinMin,
    // 선명하기만 한 게 아니라 멈춰 있어야 한다 — 밝은 곳에서는 흔들리는 손도 또렷하게 찍힌다
    focus: metrics.sharpness >= GATE.focusMin && stability >= GATE.stabilityMin,
    exposure:
      metrics.highlightClip <= GATE.highlightClipMax &&
      metrics.channelClip <= GATE.channelClipMax &&
      metrics.shadowClip <= GATE.shadowClipMax,
  };
  const hardPass = hard.skin && hard.focus && hard.exposure;

  // 막대로 보여줄 0~1 값. 통과선이 아니라 "만점 기준"에 대한 비율이라, 게이트를 넘긴 뒤에도
  // 더 채우면 더 차오른다. 초점은 선명도와 정지 중 나쁜 쪽을 쓴다 — 막대가 지금 무엇에
  // 발목 잡혀 있는지를 보여줘야 하기 때문이다.
  const gauges: Record<HardGateKey, number> = {
    skin: clamp01(metrics.skinRatio / GATE.goodSkinRatio),
    focus: Math.min(
      clamp01(metrics.sharpness / GATE.focusGood),
      clamp01((stability - STABILITY_FLOOR) / (1 - STABILITY_FLOOR)),
    ),
    exposure: clamp01(
      1 -
        Math.max(
          metrics.highlightClip / GATE.highlightClipMax,
          metrics.channelClip / GATE.channelClipMax,
          metrics.shadowClip / GATE.shadowClipMax,
        ),
    ),
  };

  const soft = {
    sharpness: clamp01((metrics.sharpness - GATE.focusMin) / (GATE.focusGood - GATE.focusMin)),
    skin: clamp01((metrics.skinRatio - skinMin) / Math.max(GATE.goodSkinRatio - skinMin, 1e-3)),
    brightness: baseline
      ? clamp01(1 - (Math.abs(metrics.brightness - baseline.brightness) - GATE.goodBrightnessDelta) / 0.2)
      : 1,
  };
  // 자동 셔터가 후보 중 한 장을 고르는 기준. 되돌릴 수 없는 것(선명도)과 학습 분포에 가까운 것
  // (피부)에 무게를 싣고, 후처리가 게인으로 흡수하는 밝기는 최소로 둔다.
  const softScore = soft.sharpness * 0.45 + soft.skin * 0.35 + soft.brightness * 0.2;

  const align = faceAlign(face);

  return {
    metrics,
    hard,
    hardPass,
    stability,
    gauges,
    soft,
    softScore,
    align,
    face: face?.frame ?? null,
    frameSize: { width: face?.imageWidth ?? 0, height: face?.imageHeight ?? 0 },
    hint: buildHint(hard, soft, metrics, stability, align, face),
  };
}

/**
 * 얼굴을 못 찾았을 때의 정렬 판정 — 실패지만 "무엇이 나쁘다"가 아니라 "아직 못 봤다"이므로
 * 막대는 0으로 두고 안내만 다르게 준다.
 */
const NO_FACE: AlignEvaluation = {
  ok: false,
  gauge: 0,
  fault: 'scale',
  hint: '얼굴이 보이지 않아요 — 가이드 안으로 들어와주세요',
  scaleLn: 0,
  poseOk: false,
  poseRef: null,
};

function faceAlign(face?: FaceContext): AlignEvaluation | null {
  if (!face) return null;
  if (!face.frame) return NO_FACE;
  return evaluateAlign(
    face.frame,
    alignTargetFor(face.imageWidth, face.imageHeight, face.framing),
    face.reference,
  );
}

/**
 * 이번 촬영의 넓이를 회차 간 비교에 써도 되는지.
 *
 * **정렬 통과 여부(align.ok)를 그대로 쓰지 않는다.** 정렬 항목 넷 중 배율·위치·기울기는 넓이를
 * d·v로 나누는 순간 계산에서 사라진다 — 얼굴이 화면 어디에 얼마나 크게 담겼든 몫은 같다.
 * 그 셋은 촬영을 안내하기 위한 것(해상도를 확보하고 얼굴이 잘리지 않게)이지 측정의 자격이 아니다.
 *
 * 그래서 측정을 실제로 망치는 것만 본다:
 *
 *   · 얼굴 — 없으면 나눌 자가 없다
 *   · 자세 — 고개를 돌리거나 숙이면 투영 자체가 바뀌고, 그건 되돌릴 수 없다
 *   · 해상도 — 배율은 사라져도 픽셀 수는 사라지지 않는다 (앨범 사진에서 주로 걸린다)
 *   · 조명 — 밝기가 다르면 마스크 경계가 통째로 밀려 병변이 커지거나 작아진 것처럼 보인다
 *
 * 이 구분 덕분에 **앨범에서 고른 사진도 넓이를 잴 수 있다.** 가이드를 볼 기회가 없었으니 구도는
 * 당연히 어긋나 있지만, 정면으로 찍혔고 얼굴이 충분히 크고 조명이 비슷하면 그 사진의 넓이는
 * 지난 회차와 견줄 자격이 있다. 구도를 이유로 버리면 멀쩡한 측정을 버리는 것이다.
 *
 * 자격이 없어도 사진과 등급은 그대로 기록한다 — 빠지는 것은 넓이 추세뿐이다.
 */
export function evaluateAreaEligibility(
  evaluation: FrameEvaluation,
  baseline?: Baseline,
): { ok: boolean; reason?: string } {
  const { width, height } = evaluation.frameSize;
  const face = evaluation.face;

  /*
    실패하면 잰 값을 함께 남긴다.

    사용자에게 보여주는 문구는 "무엇을 고쳐야 하는지"만 말해야 해서 숫자가 들어갈 자리가 없다.
    그런데 임계값 넷(자세·해상도·잘림·조명)이 전부 아직 캘리브레이션 전이라, 실기기에서 왜
    걸렸는지 숫자를 못 보면 고칠 방향을 정할 수 없다. 개발 콘솔에만 남긴다.
  */
  const reject = (reason: string, detail: Record<string, unknown>) => {
    console.warn('[area] 넓이 측정 제외:', reason, {
      frame: `${Math.round(width)}×${Math.round(height)}`,
      ...detail,
    });
    return { ok: false, reason };
  };

  if (!face) {
    return reject('얼굴을 찾지 못해 넓이를 잴 기준이 없어요', { detected: false });
  }

  // 잰 값을 한자리에 모아 둔다 — 어느 검사에서 걸리든 같은 숫자를 함께 남기기 위해서다
  const seen = {
    s: Math.round(face.s),
    minS: MIN_FACE_SCALE_PX,
    roiSide: Math.round(3 * face.s),
    noseAsym: Math.round(face.noseAsym * 1000) / 1000,
    // 기준이 있으면 '자기 기준과의 차이', 없으면 느슨한 절대 상한을 본다
    refNoseAsym: evaluation.align?.poseRef ?? null,
    maxNoseAsym: evaluation.align?.poseRef == null ? ALIGN_GATE.noseAsymAbs : ALIGN_GATE.noseAsymDelta,
    poseLn: null as number | null,
    brightness: Math.round(evaluation.metrics.brightness * 1000) / 1000,
    baseBrightness: baseline ? Math.round(baseline.brightness * 1000) / 1000 : null,
  };

  if (face.s < MIN_FACE_SCALE_PX) {
    return reject('얼굴이 너무 작게 찍혀서 넓이를 정확히 잴 수 없어요', seen);
  }
  // 얼굴이 화면 밖으로 걸치면 잘려 나간 쪽의 병변이 통째로 빠지는데 분모(d·v)는 그대로다 —
  // 병변이 그대로여도 지수만 내려가고, 그건 호전으로 읽힌다. 잘린 채로 재느니 재지 않는다.
  if (!faceRoiFits(face, width, height)) {
    return reject('얼굴이 화면 밖으로 잘려서 넓이를 다 셀 수 없어요', {
      ...seen,
      // ROI가 화면보다 크면 "너무 가까이", 크기는 맞는데 안 들어오면 "치우침"이다
      cause: 3 * face.s > Math.min(width, height) ? '너무 가까움 (ROI > 화면 짧은 변)' : '얼굴이 가장자리로 치우침',
      faceCenter: `${Math.round(face.cx)},${Math.round(face.cy)}`,
    });
  }
  if (evaluation.align && !evaluation.align.poseOk) {
    return reject('고개가 돌아가거나 숙여진 채로 찍혀서 넓이 비교가 어려워요', {
      ...seen,
      maxPoseLn: ALIGN_GATE.poseLn,
      ratio: Math.round(face.ratio * 1000) / 1000,
    });
  }
  if (baseline && Math.abs(evaluation.metrics.brightness - baseline.brightness) > GATE.areaBrightnessDelta) {
    return reject('조명이 지난번과 많이 달라 넓이 비교가 어려워요', {
      ...seen,
      maxDelta: GATE.areaBrightnessDelta,
    });
  }
  return { ok: true };
}

/**
 * 한 번에 하나씩만 말한다. 여러 개를 나열하면 사용자는 무엇부터 고쳐야 할지 모른다.
 * 순서는 "고치면 가장 많이 해결되는 것" 순 — 피부를 채우면 해상도도 함께 따라온다.
 */
function buildHint(
  hard: Record<HardGateKey, boolean>,
  soft: FrameEvaluation['soft'],
  metrics: ImageQualityMetrics,
  stability: number,
  align: AlignEvaluation | null,
  face?: FaceContext,
): string {
  // 얼굴을 아직 못 찾았으면 다른 어떤 안내도 소용이 없다 — 화면에 얼굴부터 들어와야 한다
  if (face && !face.frame) return NO_FACE.hint;
  if (!hard.skin) return '조금 더 가까이 — 화면을 피부로 채워주세요';
  if (!hard.focus) {
    if (stability < GATE.stabilityMin) return '움직이고 있어요 — 잠깐 멈춰주세요';
    return '초점이 흐려요 — 잠깐 멈춰서 초점을 맞춰주세요';
  }
  if (!hard.exposure) {
    if (metrics.shadowClip > GATE.shadowClipMax) return '너무 어두워요 — 밝은 곳으로 옮겨주세요';
    return '빛이 반사돼요 — 각도를 살짝 바꿔주세요';
  }
  // 되돌릴 수 없는 것(초점·노출)을 먼저 해결한 뒤에 정렬을 말한다
  if (align && !align.ok) return align.hint;
  if (soft.skin < 0.5) return '조금만 더 가까이 가면 더 정확해요';
  return '좋아요 — 그대로 유지해주세요';
}
