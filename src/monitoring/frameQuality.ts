import type { SkImage } from '@shopify/react-native-skia';
import { readResizedRGBA } from '../ai/skiaPixels';
import { estimateSkin, SKIN_GATE } from './skinMask';
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
 *   · 노출·피부·밝기 → **프레임 전체**. 질환 분류 모델이 크롭 없이 프레임을 통째로 먹기 때문에,
 *     가운데만 재면 "가운데는 피부, 주변은 카펫"인 프레임을 통과시키게 된다.
 *   · 선명도 → **가운데 고정 정사각형**. 한때 병변 bbox를 관심영역으로 썼지만, 병변 크기는
 *     세션마다 변하는 값이라 관심영역까지 같이 변해 선명도를 세션 간 비교할 수 없게 된다.
 *     정상 피부만 찍은 사진에는 bbox가 아예 없기도 하다. 고정 영역이라야 기준이 선다.
 */
export function measureImageQuality(
  image: SkImage,
  opts: { sampleSize?: number } = {},
): ImageQualityMetrics {
  const sampleSize = opts.sampleSize ?? 160;
  const w = image.width();
  const h = image.height();
  const n = sampleSize * sampleSize;

  // ── 프레임 전체 표본: 노출·피부·밝기 ─────────────────────────────
  const full = readResizedRGBA(image, { x: 0, y: 0, width: w, height: h }, sampleSize, sampleSize);

  let sumY = 0;
  let specular = 0;
  let shadow = 0;
  let clipR = 0;
  let clipG = 0;
  let clipB = 0;

  // 정지 판정용 지문을 같은 순회에서 누적한다 (SIG_SIZE×SIG_SIZE 블록 평균)
  const block = sampleSize / SIG_SIZE;
  const sig = new Float32Array(SIG_SIZE * SIG_SIZE);

  for (let i = 0, p = 0; i < full.length; i += 4, p++) {
    const r = full[i];
    const g = full[i + 1];
    const b = full[i + 2];

    // 채널별 포화 — 하나라도 255에 붙으면 그 채널의 정보는 사라진 것이다
    if (r >= 250) clipR += 1;
    if (g >= 250) clipG += 1;
    if (b >= 250) clipB += 1;
    // RGB가 동시에 날아간 것은 색 포화가 아니라 경면반사(번들거림)다
    if (r >= 250 && g >= 250 && b >= 250) specular += 1;

    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    sumY += y;
    if (y <= 8) shadow += 1;

    const sx = Math.min(SIG_SIZE - 1, ((p % sampleSize) / block) | 0);
    const sy = Math.min(SIG_SIZE - 1, (((p / sampleSize) | 0) / block) | 0);
    sig[sy * SIG_SIZE + sx] += y;
  }

  const skin = estimateSkin(full, sampleSize, sampleSize);

  return {
    sharpness: measureSharpness(image, sampleSize),
    highlightClip: specular / n,
    channelClip: Math.max(clipR, clipG, clipB) / n,
    shadowClip: shadow / n,
    brightness: sumY / n / 255,
    skinRatio: skin.ratio,
    skinSource: skin.source,
    skinMedians: skin.skinMedians,
    skinCount: skin.skinCount,
    signature: normalizeSignature(sig),
  };
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
 */
function measureSharpness(image: SkImage, sampleSize: number): number {
  const w = image.width();
  const h = image.height();
  const side = Math.min(w, h) * FOCUS_ROI;
  const src = { x: (w - side) / 2, y: (h - side) / 2, width: side, height: side };

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

/**
 * 필수 조건 → 통과/실패, 권장 조건 → 0~1 점수. 기준 세션이 없으면 밝기 항목은 만점 처리한다.
 *
 * prevSignature를 주면 직전 프레임과의 상관도로 "정지 여부"까지 초점 게이트에 포함한다.
 * 사용자에게는 둘 다 "잠깐 멈춰주세요"로 귀결되는 같은 문제라 칩을 따로 만들지 않았다.
 */
export function evaluateFrame(
  metrics: ImageQualityMetrics,
  baseline?: Baseline,
  prevSignature?: Float32Array | null,
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

  return {
    metrics,
    hard,
    hardPass,
    stability,
    gauges,
    soft,
    softScore,
    hint: buildHint(hard, soft, metrics, stability),
  };
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
): string {
  if (!hard.skin) return '조금 더 가까이 — 화면을 피부로 채워주세요';
  if (!hard.focus) {
    if (stability < GATE.stabilityMin) return '움직이고 있어요 — 잠깐 멈춰주세요';
    return '초점이 흐려요 — 잠깐 멈춰서 초점을 맞춰주세요';
  }
  if (!hard.exposure) {
    if (metrics.shadowClip > GATE.shadowClipMax) return '너무 어두워요 — 밝은 곳으로 옮겨주세요';
    return '빛이 반사돼요 — 각도를 살짝 바꿔주세요';
  }
  if (soft.skin < 0.5) return '조금만 더 가까이 가면 더 정확해요';
  return '좋아요 — 그대로 유지해주세요';
}
