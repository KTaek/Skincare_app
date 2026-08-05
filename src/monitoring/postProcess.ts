import { AlphaType, ColorType, ImageFormat, Skia } from '@shopify/react-native-skia';
import { Directory, File, Paths } from 'expo-file-system';
import { LesionDetection } from './lesionShape';
import { angleDelta, GATE } from './frameQuality';
import {
  Baseline,
  ColorStats,
  ConfidenceBreakdown,
  FrameEvaluation,
  PostProcessResult,
  RegistrationTransform,
  SessionConfidence,
} from './types';

/** 정규화 캔버스 한 변 (px) — 모든 세션이 같은 크기·같은 구도로 저장된다 */
export const CANONICAL_SIZE = 512;
/** 기준 세션의 병변 반지름 기준으로 화면에 담을 범위 (반지름의 몇 배까지 보이게 할지) */
export const FIELD_OF_VIEW_FACTOR = 3.2;
/** 색 통계를 잴 중앙 원의 반지름 (캔버스 절반 대비) */
const STATS_DISC = 0.9;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const clamp01 = (v: number) => clamp(v, 0, 1);

let seq = 0;
export const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(seq++).toString(36)}`;

/**
 * 촬영본을 "세션 간 비교 가능한 형태"로 다듬는다.
 *
 * 1) 정합 — 병변 중심을 캔버스 중앙으로, 주축을 수평으로 맞추는 강체 변환(회전+평행이동)을 적용하고
 *    기준 세션이 정한 화각(FOV)으로 잘라낸다.
 *    주의: 병변 크기에 맞춰 배율을 재조정하지 **않는다**. 그렇게 하면 병변이 커진 것까지 정규화되어
 *    모니터링의 핵심 신호가 사라지기 때문이다. 촬영 거리 차이는 게이트와 신뢰도로 관리한다.
 * 2) 색 정규화 — 기준 세션의 채널별 평균/표준편차에 맞추는 게인·오프셋을 적용한다.
 * 3) 신뢰도 — 촬영 품질 + 보정량(얼마나 크게 손댔는지)을 합쳐 0~100 점수와 경고를 만든다.
 */
export async function postProcessCapture(params: {
  detection: LesionDetection;
  evaluation: FrameEvaluation;
  baseline?: Baseline;
  sessionId?: string;
}): Promise<PostProcessResult> {
  const { detection, evaluation, baseline } = params;
  const sessionId = params.sessionId ?? newId('sess');
  const { shape } = detection;
  const shortSide = Math.min(shape.imageWidth, shape.imageHeight);

  // ── 1) 정합 변환 ──────────────────────────────────────────────
  // 주축을 수평(0 rad)으로 돌린다. 마스크가 거의 원형이면 방향을 신뢰할 수 없으므로 회전하지 않는다.
  const rotation = shape.elongation > 1.25 ? -foldAngle(shape.orientation) : 0;
  const baseRadiusPx = baseline ? baseline.radiusNorm * shortSide : shape.radiusPx;
  const halfFov = Math.max(baseRadiusPx * FIELD_OF_VIEW_FACTOR, shortSide * 0.05);
  const scale = CANONICAL_SIZE / 2 / halfFov;

  const registration: RegistrationTransform = {
    scale,
    rotationRad: rotation,
    translation: { x: CANONICAL_SIZE / 2 - shape.centroid.x * scale, y: CANONICAL_SIZE / 2 - shape.centroid.y * scale },
    isBaseline: !baseline,
  };

  // ── 2) 1차 렌더: 색 보정 없이 정렬만 해서 현재 색 통계를 잰다 ──
  const alignedPixels = renderCanonical(detection, registration, null);
  const currentStats = discStats(alignedPixels, CANONICAL_SIZE, STATS_DISC);

  const target: ColorStats = baseline?.colorStats ?? grayWorldTarget(currentStats);
  const { gain, offset } = colorCorrection(currentStats, target);

  // ── 3) 2차 렌더: 색 보정을 적용해 최종 이미지를 만든다 ──
  const colorFilter = Skia.ColorFilter.MakeMatrix([
    gain[0], 0, 0, 0, offset[0],
    0, gain[1], 0, 0, offset[1],
    0, 0, gain[2], 0, offset[2],
    0, 0, 0, 1, 0,
  ]);
  const finalPixels = renderCanonical(detection, registration, colorFilter, true);
  const processedUri = await writeJpeg(sessionId, finalPixels.bytes!);
  const resultStats = discStats(finalPixels, CANONICAL_SIZE, STATS_DISC);

  const confidence = scoreConfidence(evaluation, registration, gain, baseline);

  return {
    processedUri,
    registration,
    colorGain: gain,
    colorOffset: offset,
    resultStats,
    resultOrientation: shape.orientation,
    confidence,
  };
}

interface RenderOutput {
  pixels: Uint8Array;
  bytes?: Uint8Array;
}

function renderCanonical(
  detection: LesionDetection,
  reg: RegistrationTransform,
  colorFilter: ReturnType<typeof Skia.ColorFilter.MakeMatrix> | null,
  encode = false,
): RenderOutput {
  const surface = Skia.Surface.MakeOffscreen(CANONICAL_SIZE, CANONICAL_SIZE);
  if (!surface) throw new Error('후처리용 캔버스를 만들지 못했어요');

  const canvas = surface.getCanvas();
  canvas.drawColor(Skia.Color('#000000'));

  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  if (colorFilter) paint.setColorFilter(colorFilter);

  const { image, shape } = detection;
  canvas.save();
  // 캔버스 중앙 → 회전 → 배율 → 병변 중심이 원점에 오도록 이동
  canvas.translate(CANONICAL_SIZE / 2, CANONICAL_SIZE / 2);
  canvas.rotate((reg.rotationRad * 180) / Math.PI, 0, 0);
  canvas.scale(reg.scale, reg.scale);
  canvas.translate(-shape.centroid.x, -shape.centroid.y);
  const full = { x: 0, y: 0, width: shape.imageWidth, height: shape.imageHeight };
  canvas.drawImageRect(image, full, full, paint);
  canvas.restore();
  surface.flush();

  const snapshot = surface.makeImageSnapshot();
  const pixels = snapshot.readPixels(0, 0, {
    width: CANONICAL_SIZE,
    height: CANONICAL_SIZE,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  }) as Uint8Array | null;
  if (!pixels) throw new Error('후처리 결과 픽셀을 읽지 못했어요');

  return { pixels, bytes: encode ? snapshot.encodeToBytes(ImageFormat.JPEG, 92) : undefined };
}

/** 캔버스 중앙 원 안쪽(= 병변과 그 주변 피부)의 채널별 평균/표준편차. 검은 여백은 제외한다. */
export function discStats(out: RenderOutput, size: number, discFactor: number): ColorStats {
  const r = (size / 2) * discFactor;
  const r2 = r * r;
  const c = size / 2;
  let n = 0;
  const sum = [0, 0, 0];
  const sumSq = [0, 0, 0];

  for (let y = 0; y < size; y++) {
    const dy = y - c;
    for (let x = 0; x < size; x++) {
      const dx = x - c;
      if (dx * dx + dy * dy > r2) continue;
      const i = (y * size + x) * 4;
      const px = out.pixels;
      if (px[i] + px[i + 1] + px[i + 2] === 0) continue; // 화각 밖 여백
      n += 1;
      for (let ch = 0; ch < 3; ch++) {
        const v = px[i + ch] / 255;
        sum[ch] += v;
        sumSq[ch] += v * v;
      }
    }
  }

  if (n === 0) return { mean: [0.5, 0.5, 0.5], std: [0.1, 0.1, 0.1] };
  const mean = sum.map((s) => s / n) as [number, number, number];
  const std = sumSq.map((s, ch) => Math.sqrt(Math.max(1e-6, s / n - mean[ch] * mean[ch]))) as [number, number, number];
  return { mean, std };
}

/** 기준 세션이 없을 때는 그레이월드 가정으로 화이트밸런스를 맞춘 상태를 기준으로 삼는다 */
function grayWorldTarget(stats: ColorStats): ColorStats {
  const gray = (stats.mean[0] + stats.mean[1] + stats.mean[2]) / 3;
  const stdAvg = (stats.std[0] + stats.std[1] + stats.std[2]) / 3;
  return { mean: [gray, gray, gray], std: [stdAvg, stdAvg, stdAvg] };
}

/** 채널별 선형 보정 (v' = gain·v + offset). 과보정을 막기 위해 게인·오프셋 모두 제한한다. */
export function colorCorrection(
  current: ColorStats,
  target: ColorStats,
): { gain: [number, number, number]; offset: [number, number, number] } {
  const gain: number[] = [];
  const offset: number[] = [];
  for (let ch = 0; ch < 3; ch++) {
    const g = clamp(target.std[ch] / Math.max(current.std[ch], 1e-4), 0.7, 1.4);
    gain.push(g);
    offset.push(clamp(target.mean[ch] - g * current.mean[ch], -0.25, 0.25));
  }
  return { gain: gain as [number, number, number], offset: offset as [number, number, number] };
}

/** 각도를 -π/2 ~ π/2로 접는다 (주축은 180° 모호성이 있어 두 표현이 같은 방향이다) */
function foldAngle(a: number): number {
  let v = a;
  while (v > Math.PI / 2) v -= Math.PI;
  while (v < -Math.PI / 2) v += Math.PI;
  return v;
}

/**
 * 신뢰도 = 촬영 품질(초점·노출·구도) + 보정량(정합/색을 얼마나 크게 손댔는지).
 * 느슨한 게이트로 통과시킨 대가를 여기서 정량화해, 추세 계산에서 가중치를 낮추거나 재촬영을 안내한다.
 */
export function scoreConfidence(
  evaluation: FrameEvaluation,
  registration: RegistrationTransform,
  gain: [number, number, number],
  baseline?: Baseline,
): SessionConfidence {
  const { metrics, soft, hard } = evaluation;

  const breakdown: ConfidenceBreakdown = {
    focus: clamp01((metrics.sharpness - GATE.focusMin) / (GATE.focusGood - GATE.focusMin)),
    exposure: clamp01(
      1 - Math.max(metrics.highlightClip / GATE.highlightClipMax, metrics.shadowClip / GATE.shadowClipMax),
    ),
    framing: soft.alignment,
    registration: baseline ? Math.min(soft.distance, soft.angle) : 1,
    color: clamp01(1 - Math.max(...gain.map((g) => Math.abs(g - 1))) / 0.4),
  };

  const weighted =
    100 *
    (breakdown.focus * 0.25 +
      breakdown.exposure * 0.2 +
      breakdown.framing * 0.2 +
      breakdown.registration * 0.2 +
      breakdown.color * 0.15);

  // 수동 셔터는 필수 조건을 못 넘겨도 찍히므로, 그 경우 점수가 높게 나오지 않도록 상한을 씌운다.
  // (초점·프레이밍·노출은 후처리로 복구할 수 없는 항목이라 다른 항목이 아무리 좋아도 신뢰할 수 없다)
  const hardFailed = (Object.keys(hard) as (keyof typeof hard)[]).filter((k) => !hard[k]);
  const score = Math.round(hardFailed.length > 0 ? Math.min(weighted, 45) : weighted);

  const warnings: string[] = [];
  if (!hard.focus) warnings.push('초점이 맞지 않은 상태로 촬영됐어요 (후처리로 복구할 수 없어요)');
  else if (breakdown.focus < 0.35) warnings.push('초점이 충분히 선명하지 않아요');
  if (!hard.exposure) warnings.push('밝은 부분이나 어두운 부분의 색 정보가 날아갔어요');
  else if (breakdown.exposure < 0.4) warnings.push('빛이 날아가거나 어두워 색 정보가 일부 손실됐어요');
  if (!hard.framing) warnings.push('병변이 프레임 안에 제대로 담기지 않았어요');
  if (breakdown.registration < 0.35) warnings.push('지난 촬영과 거리·각도 차이가 커서 정합이 완전하지 않아요');
  if (breakdown.color < 0.4) warnings.push('조명이 지난번과 달라 색 보정을 크게 적용했어요');
  if (!hard.recoverable) warnings.push('후처리로 보정할 수 있는 범위를 벗어났어요');

  // 필수 조건을 하나라도 놓친 촬영은 추세 계산에서 제외한다
  const usable = hardFailed.length === 0 && score >= 35;
  const tier = score >= 75 ? 'high' : score >= 50 ? 'medium' : 'low';

  return { score, tier, breakdown, warnings, usable };
}

async function writeJpeg(sessionId: string, bytes: Uint8Array): Promise<string> {
  const dir = new Directory(Paths.cache, 'monitoring');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const file = new File(dir, `${sessionId}.jpg`);
  file.create({ overwrite: true });
  file.write(bytes);
  return file.uri;
}

/** 이번 세션 결과로 다음 세션의 기준(baseline)을 만든다 */
export function baselineFromResult(
  sessionId: string,
  result: PostProcessResult,
  shape: { radiusPx: number; imageWidth: number; imageHeight: number; orientation: number },
  brightness: number,
): Baseline {
  return {
    sessionId,
    processedUri: result.processedUri,
    orientation: shape.orientation,
    radiusNorm: shape.radiusPx / Math.min(shape.imageWidth, shape.imageHeight),
    colorStats: result.resultStats,
    brightness,
  };
}

export { foldAngle, angleDelta };
