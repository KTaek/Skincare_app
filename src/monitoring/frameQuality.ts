import type { SkImage } from '@shopify/react-native-skia';
import { readResizedRGBA } from '../ai/skiaPixels';
import { LesionShape } from './lesionShape';
import { Baseline, FrameEvaluation, HardGateKey, ImageQualityMetrics } from './types';

/**
 * 촬영 게이트 임계값.
 *
 * 원칙: "후처리로 되돌릴 수 없는 것"만 필수(hard)로 막고, 나머지는 통과시킨 뒤 점수로 남긴다.
 *  - 필수: 초점(흐리면 디테일이 아예 소실), 프레이밍(병변이 프레임 밖), 노출 클리핑(정보가 날아감)
 *  - 필수(하한선): 후처리로도 못 살릴 만큼 각도/거리가 어긋난 경우
 *  - 권장: 구도 일치도, 거리, 각도, 밝기 — 어긋나도 후처리가 흡수한다
 *
 * 실기기에서 프리뷰 해상도/JPEG 품질에 따라 sharpness 절대값이 달라지므로,
 * 이 값들은 실제 단말에서 한 번 캘리브레이션하는 것을 전제로 한 초기값이다.
 */
export const GATE = {
  /** 라플라시안 분산 하한 (이 아래면 셔터가 눌리지 않는다) */
  focusMin: 45,
  /** 이 값 이상이면 초점 점수 만점 */
  focusGood: 140,
  highlightClipMax: 0.06,
  shadowClipMax: 0.18,
  /** 프레임 중심에서 병변 중심까지 허용 거리 (짧은 변 대비) */
  centerOffsetMax: 0.3,
  /** 병변이 화면에서 차지하는 최소/최대 넓이 비율 */
  areaRatioMin: 0.015,
  areaRatioMax: 0.72,
  /** 병변 bbox가 프레임 가장자리에 이만큼 이내로 붙으면 잘린 것으로 본다 (짧은 변 대비) */
  edgeMargin: 0.01,
  /** ↓ 여기부터는 "후처리로도 못 살리는" 하한선 */
  recoverScaleMin: 0.5,
  recoverScaleMax: 2.0,
  recoverAngleMaxRad: (35 * Math.PI) / 180,
  /** ↓ 여기부터는 권장 조건의 "만점 기준" */
  goodCenterOffset: 0.08,
  goodScaleTolerance: 0.18,
  goodAngleRad: (8 * Math.PI) / 180,
  goodBrightnessDelta: 0.06,
  /** 자동 셔터가 켜지는 권장 점수 (100%가 아니라 "충분히 근접") */
  autoShutterSoftScore: 0.7,
  /** 이 점수를 넘으면 더 좋은 프레임을 기다리지 않고 바로 확정 */
  excellentSoftScore: 0.88,
} as const;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * 프레임의 선명도·노출·밝기를 잰다.
 * 화면 전체가 아니라 가운데 60% 영역만 보는데, 가장자리 배경 때문에 판정이 흔들리는 것을 막기 위해서다.
 */
export function measureImageQuality(image: SkImage, sampleSize = 160): ImageQualityMetrics {
  const w = image.width();
  const h = image.height();
  const side = Math.min(w, h) * 0.6;
  const src = { x: (w - side) / 2, y: (h - side) / 2, width: side, height: side };
  const px = readResizedRGBA(image, src, sampleSize, sampleSize);

  const gray = new Float32Array(sampleSize * sampleSize);
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let highlight = 0;
  let shadow = 0;

  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    sumR += r;
    sumG += g;
    sumB += b;
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[p] = y;
    if (r >= 250 && g >= 250 && b >= 250) highlight += 1;
    if (y <= 8) shadow += 1;
  }

  const n = sampleSize * sampleSize;

  // 라플라시안(4-이웃) 분산 — 초점이 맞을수록 고주파 성분이 커진다
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
  const lapMean = lapSum / count;
  const sharpness = lapSqSum / count - lapMean * lapMean;

  return {
    sharpness,
    highlightClip: highlight / n,
    shadowClip: shadow / n,
    brightness: (sumR + sumG + sumB) / (3 * n * 255),
    channelMeans: [sumR / (n * 255), sumG / (n * 255), sumB / (n * 255)],
  };
}

/** 마스크 주축 각도는 180° 모호성이 있어, 기준 각도에 가장 가까운 표현으로 접어서 비교한다 */
export function angleDelta(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI / 2) d -= Math.PI;
  while (d < -Math.PI / 2) d += Math.PI;
  return d;
}

/** 필수 조건 → 통과/실패, 권장 조건 → 0~1 점수. 기준 세션이 없으면 정합 관련 항목은 만점 처리한다. */
export function evaluateFrame(
  metrics: ImageQualityMetrics,
  shape: LesionShape,
  baseline?: Baseline,
): FrameEvaluation {
  const shortSide = Math.min(shape.imageWidth, shape.imageHeight);
  const cx = shape.imageWidth / 2;
  const cy = shape.imageHeight / 2;
  const centerOffset = Math.hypot(shape.centroid.x - cx, shape.centroid.y - cy) / shortSide;

  const bw = shape.bbox.x2 - shape.bbox.x1;
  const bh = shape.bbox.y2 - shape.bbox.y1;
  const areaRatio = (bw * bh) / (shape.imageWidth * shape.imageHeight);
  const margin = shortSide * GATE.edgeMargin;
  const cropped =
    shape.bbox.x1 <= margin ||
    shape.bbox.y1 <= margin ||
    shape.bbox.x2 >= shape.imageWidth - margin ||
    shape.bbox.y2 >= shape.imageHeight - margin;

  const radiusNorm = shape.radiusPx / shortSide;
  const scaleRatio = baseline && baseline.radiusNorm > 0 ? radiusNorm / baseline.radiusNorm : 1;
  // 모양이 거의 원형이면 주축 방향을 신뢰할 수 없으므로 각도 차이는 0으로 본다
  const angleTrustworthy = shape.elongation > 1.25 && (baseline?.orientation != null);
  const dAngle = angleTrustworthy ? Math.abs(angleDelta(shape.orientation, baseline!.orientation)) : 0;

  const hard: Record<HardGateKey, boolean> = {
    focus: metrics.sharpness >= GATE.focusMin,
    framing:
      shape.found &&
      !cropped &&
      centerOffset <= GATE.centerOffsetMax &&
      areaRatio >= GATE.areaRatioMin &&
      areaRatio <= GATE.areaRatioMax,
    exposure: metrics.highlightClip <= GATE.highlightClipMax && metrics.shadowClip <= GATE.shadowClipMax,
    recoverable:
      scaleRatio >= GATE.recoverScaleMin && scaleRatio <= GATE.recoverScaleMax && dAngle <= GATE.recoverAngleMaxRad,
  };
  const hardPass = hard.focus && hard.framing && hard.exposure && hard.recoverable;

  const soft = {
    alignment: clamp01(1 - (centerOffset - GATE.goodCenterOffset) / (GATE.centerOffsetMax - GATE.goodCenterOffset)),
    distance: clamp01(1 - (Math.abs(scaleRatio - 1) - GATE.goodScaleTolerance) / (0.6 - GATE.goodScaleTolerance)),
    angle: clamp01(1 - (dAngle - GATE.goodAngleRad) / (GATE.recoverAngleMaxRad - GATE.goodAngleRad)),
    brightness: baseline
      ? clamp01(1 - (Math.abs(metrics.brightness - baseline.brightness) - GATE.goodBrightnessDelta) / 0.2)
      : 1,
  };
  const softScore = soft.alignment * 0.4 + soft.distance * 0.25 + soft.angle * 0.2 + soft.brightness * 0.15;

  return { metrics, hard, hardPass, soft, softScore, hint: buildHint(hard, soft, shape, centerOffset, scaleRatio, dAngle) };
}

function buildHint(
  hard: Record<HardGateKey, boolean>,
  soft: FrameEvaluation['soft'],
  shape: LesionShape,
  centerOffset: number,
  scaleRatio: number,
  dAngle: number,
): string {
  if (!shape.found) return '병변이 보이도록 카메라를 비춰주세요';
  if (!hard.focus) return '초점이 흐려요 — 잠시 멈춰서 초점을 맞춰주세요';
  if (!hard.framing) {
    if (centerOffset > GATE.centerOffsetMax) return '병변을 가이드 안쪽으로 옮겨주세요';
    return '병변이 프레임에 다 들어오게 거리를 조절해주세요';
  }
  if (!hard.exposure) return '빛이 너무 세거나 어두워요 — 각도를 살짝 바꿔주세요';
  if (!hard.recoverable) {
    if (dAngle > GATE.recoverAngleMaxRad) return '지난번과 방향이 많이 달라요 — 비슷한 각도에서 찍어주세요';
    return scaleRatio > 1 ? '지난번보다 너무 가까워요 — 조금 떨어져주세요' : '지난번보다 너무 멀어요 — 조금 다가가주세요';
  }
  if (soft.alignment < 0.6) return '조금만 더 가운데로 — 그대로 들고 계세요';
  if (soft.distance < 0.6) return '거리를 지난번과 비슷하게 맞춰주세요';
  return '좋아요 — 그대로 유지해주세요';
}
