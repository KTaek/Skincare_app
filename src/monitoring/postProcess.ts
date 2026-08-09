import { GATE } from './frameQuality';
import { SKIN_GATE } from './skinMask';
import {
  Baseline,
  ColorNormalization,
  ConfidenceBreakdown,
  FrameEvaluation,
  ImageQualityMetrics,
  SessionConfidence,
} from './types';

/**
 * 후처리 — "사용자에게 시키지 않고 앱이 대신 흡수하는 것"들.
 *
 * 이전 구현은 Skia 오프스크린 캔버스에 정합·색보정을 렌더해 JPEG로 다시 쓰는 방식이었는데,
 * 실기기에서 그 경로가 실패하면 촬영이 통째로 막혀 결국 통째로 꺼둔 채 방치돼 있었다.
 * 지금은 두 가지를 바꿨다:
 *
 *   1. 정합(회전·배율 정규화)을 아예 하지 않는다. 면적 측정을 걷어내면서 필요가 없어졌고,
 *      필요 없는 것 때문에 촬영이 막히는 건 최악의 거래였다.
 *   2. 색 정규화는 이미지를 다시 그리지 않고 "게인 숫자"만 계산해서 모델 입력 텐서에 적용한다.
 *      재인코딩도 파일 쓰기도 없으니 실패할 지점 자체가 사라졌고, 사용자가 보는 사진은
 *      찍은 그대로 남는다 (기록은 손대지 않는 편이 옳다).
 */

/** 과보정 방지 한계 — 이 밖으로 나가려는 조명 차이는 보정하지 않고 신뢰도를 깎는다 */
const GAIN_MIN = 0.75;
const GAIN_MAX = 1.35;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const clamp01 = (v: number) => clamp(v, 0, 1);

let seq = 0;
export const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(seq++).toString(36)}`;

export const IDENTITY_COLOR_NORM: ColorNormalization = { gain: [1, 1, 1], applied: false };

/**
 * 이번 촬영을 기준 세션의 조명에 맞추는 채널 게인을 계산한다.
 *
 * 기준으로 삼는 값은 피부 픽셀의 채널별 **중앙값**이다. 두 가지를 일부러 피한 결과다:
 *
 *   · 그레이월드(채널 평균을 모두 같게)를 쓰지 않는다 — 피부는 원래 붉다. 채널을 억지로
 *     균등하게 만들면 그 붉기가 통째로 지워지고, 재려는 홍반 신호를 정규화가 삭제하게 된다.
 *   · 평균 대신 중앙값을 쓴다 — 평균에는 병변의 붉은 색이 섞여 들어가 조명이 붉은 것으로
 *     오인되고, 그 보정이 병변의 붉기를 지운다. 중앙값은 병변이 피부의 절반을 넘지 않는 한
 *     정상 피부 쪽에 머무르므로 순수한 조명 기준이 된다. 세그 마스크도 필요 없다.
 *
 * 기준 세션 자신은 보정하지 않는다 — 그 세션이 곧 기준이기 때문이다.
 */
export function computeColorNormalization(
  metrics: ImageQualityMetrics,
  baseline?: Baseline,
): ColorNormalization {
  // 기준 세션이거나, 피부 표본이 모자라 조명을 추정할 수 없으면 손대지 않는다
  if (!baseline || metrics.skinCount === 0) return IDENTITY_COLOR_NORM;

  const target = baseline.skinReference;
  const current = metrics.skinMedians;
  const gain = [0, 1, 2].map((ch) =>
    current[ch] > 1e-3 ? clamp(target[ch] / current[ch], GAIN_MIN, GAIN_MAX) : 1,
  ) as [number, number, number];

  const applied = gain.some((g) => Math.abs(g - 1) > 1e-3);
  return { gain, applied };
}

/** 이번 촬영을 이 자리의 기준(baseline)으로 삼는다 — 다음 촬영의 조명 보정이 여기서 나온다 */
export function baselineFromCapture(sessionId: string, uri: string, metrics: ImageQualityMetrics): Baseline {
  return {
    sessionId,
    processedUri: uri,
    skinReference: metrics.skinMedians,
    brightness: metrics.brightness,
  };
}

/**
 * 신뢰도 = 촬영 품질(초점·노출·구도·피부) + 보정량(조명을 얼마나 크게 손댔는지).
 * 느슨한 게이트로 통과시킨 대가를 여기서 정량화해, 추세 계산에서 가중치를 낮추거나 재촬영을 안내한다.
 */
export function scoreConfidence(
  evaluation: FrameEvaluation,
  colorNorm: ColorNormalization,
  baseline?: Baseline,
): SessionConfidence {
  const { metrics, gauges, hard } = evaluation;

  const breakdown: ConfidenceBreakdown = {
    // 화면 막대와 같은 값을 그대로 쓴다 — 사용자가 촬영할 때 본 것과 기록에 남는 점수가
    // 어긋나면 "왜 초록색이었는데 신뢰도가 낮지?"가 된다
    focus: gauges.focus,
    exposure: gauges.exposure,
    skin: gauges.skin,
    // 보정 없이 맞았으면 만점. 게인이 한계(GAIN_MAX)까지 밀렸다면 조명이 그만큼 달랐다는 뜻이다.
    color: baseline ? clamp01(1 - Math.max(...colorNorm.gain.map((g) => Math.abs(g - 1))) / (GAIN_MAX - 1)) : 1,
  };

  const weighted =
    100 * (breakdown.focus * 0.35 + breakdown.exposure * 0.3 + breakdown.skin * 0.25 + breakdown.color * 0.1);

  // 수동 셔터는 필수 조건을 못 넘겨도 찍히므로, 그 경우 점수가 높게 나오지 않도록 상한을 씌운다.
  // (초점·노출·피부는 후처리로 복구할 수 없는 항목이라 다른 항목이 아무리 좋아도 신뢰할 수 없다)
  const hardFailed = (Object.keys(hard) as (keyof typeof hard)[]).filter((k) => !hard[k]);
  const score = Math.round(hardFailed.length > 0 ? Math.min(weighted, 45) : weighted);

  const warnings: string[] = [];
  if (!hard.focus) warnings.push('초점이 맞지 않은 상태로 촬영됐어요 (나중에 되살릴 수 없어요)');
  else if (breakdown.focus < 0.35) warnings.push('초점이 충분히 선명하지 않아요');
  if (!hard.skin) warnings.push('화면에 피부가 적게 담겨서 분석이 정확하지 않을 수 있어요');
  else if (breakdown.skin < 0.3) warnings.push('다음엔 조금 더 가까이 찍으면 더 정확해요');
  if (metrics.channelClip > GATE.channelClipMax) warnings.push('붉은 부분의 색이 날아가 진하기를 구분하기 어려워요');
  else if (!hard.exposure) warnings.push('밝은 부분이나 어두운 부분의 색 정보가 날아갔어요');
  else if (breakdown.exposure < 0.4) warnings.push('빛이 날아가거나 어두워 색 정보가 일부 손실됐어요');
  if (breakdown.color < 0.4) warnings.push('조명이 지난번과 많이 달라요 — 보정했지만 오차가 남을 수 있어요');

  // 필수 조건을 하나라도 놓친 촬영은 추세 계산에서 제외한다
  const usable = hardFailed.length === 0 && score >= 35;
  const tier = score >= 75 ? 'high' : score >= 50 ? 'medium' : 'low';

  return { score, tier, breakdown, warnings, usable };
}
