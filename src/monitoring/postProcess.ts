import type { ScaleFrame } from '../ai/scaleFrame';
import { GATE } from './frameQuality';
import { SKIN_GATE } from './skinMask';
import {
  Baseline,
  CapturePath,
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

/**
 * 기준 사진이 없을 때 맞춰 갈 표준 피부 중앙값 (0~1, RGB).
 *
 * 백색광 아래 중간 피부톤의 값에서 잡았다. 절대적으로 옳은 색이라는 뜻이 아니라 — 그런 값은
 * 없다, 피부색은 사람마다 다르다 — **모든 첫 촬영이 같은 자리로 모이게 하는 기준점**이다.
 * 그것만으로도 모델이 보는 색의 퍼짐이 줄어든다.
 *
 * 무엇을 노리는가: 기준 사진이 있을 때만 조명을 보정하면 첫 촬영·바로 스캔·앨범 사진은 조명이
 * 제각각인 채로 모델에 들어간다. 그런데 촬영 게이트를 걷어내면서 조명이 고르지 않은 사진이
 * 늘어나는 쪽으로 갔으므로, 보정이 가장 필요한 곳이 하필 보정이 없던 곳이 되었다.
 */
const CANONICAL_SKIN: readonly [number, number, number] = [0.72, 0.56, 0.5];
/**
 * 기준 없는 보정의 한계 — 기준 사진이 있을 때보다 훨씬 좁게 잡는다.
 *
 * 기준 사진과 맞추는 것은 **같은 사람의 같은 자리**를 견주는 일이라 큰 게인도 근거가 있다.
 * 표준값과 맞추는 것은 다르다: 그 사람의 피부가 원래 표준보다 짙은 것인지 조명이 어두운 것인지
 * 구분할 방법이 없으므로, 크게 밀면 **타고난 피부색을 지우는** 쪽으로 간다. 조명의 색기울기만
 * 살짝 덜어내는 정도로 제한한다.
 */
const CANONICAL_GAIN_MIN = 0.88;
const CANONICAL_GAIN_MAX = 1.14;

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
 * 기준 세션이 없으면 표준 피부값(CANONICAL_SKIN)에 맞추되 훨씬 좁은 한계를 쓴다 — 예전에는
 * 이 경우 아무것도 하지 않았는데, 첫 촬영·바로 스캔·앨범 사진이 전부 그 경우였다.
 */
export function computeColorNormalization(
  metrics: ImageQualityMetrics,
  baseline?: Baseline,
): ColorNormalization {
  // 피부 표본이 모자라면 조명을 추정할 근거가 없다 — 손대지 않는 편이 옳다
  if (metrics.skinCount === 0) return IDENTITY_COLOR_NORM;

  const target = baseline?.skinReference ?? CANONICAL_SKIN;
  const lo = baseline ? GAIN_MIN : CANONICAL_GAIN_MIN;
  const hi = baseline ? GAIN_MAX : CANONICAL_GAIN_MAX;

  const current = metrics.skinMedians;
  const gain = [0, 1, 2].map((ch) =>
    current[ch] > 1e-3 ? clamp(target[ch] / current[ch], lo, hi) : 1,
  ) as [number, number, number];

  const applied = gain.some((g) => Math.abs(g - 1) > 1e-3);
  return { gain, applied };
}

/** 이번 촬영을 이 자리의 기준(baseline)으로 삼는다 — 다음 촬영의 조명 보정이 여기서 나온다 */
export function baselineFromCapture(
  sessionId: string,
  uri: string,
  metrics: ImageQualityMetrics,
  /**
   * 넓이를 재는 자리에서만 채워지는 것들.
   *
   * scale — 이 자리의 자 기하(d/v 비율·비대칭). 다음 촬영의 **자세 게이트 기준**이 된다.
   *   사람마다 얼굴 비례가 다르므로 자세는 절대 기준으로 잴 수 없고, 반드시 자기 첫 사진과
   *   견줘야 한다. 배율(areaRef)은 기록용이다 — 면적은 매 회차 자기 사진의 d·v로 나눈다.
   * facing — 전면/후면은 화각이 달라 같은 거리에서도 원근 왜곡이 다르다. 카메라가 바뀌면
   *   면적 비교 자체가 성립하지 않으므로 기준을 남기고 이어찍기에서 잠근다.
   */
  extra: {
    scale?: ScaleFrame | null;
    facing?: 'front' | 'back';
    covered?: number;
    /** 자가 화면 짧은 변의 몇 배였는지 — 몸통의 배율 비교 기준이 된다 */
    sOfMinSide?: number;
  } = {},
): Baseline {
  return {
    sessionId,
    processedUri: uri,
    skinReference: metrics.skinMedians,
    brightness: metrics.brightness,
    scale: extra.scale
      ? {
          areaRef: extra.scale.areaRef,
          ratio: extra.scale.ratio,
          asym: extra.scale.asym,
          /*
            기준 사진에서 부위가 담긴 정도. 다음 회차는 100%가 아니라 **이 값**에 맞추면 된다 —
            얼굴을 가득 채워 찍는 것이 정상인 부위에서 100%를 요구하면 아무 사진도 통과하지 못한다.
          */
          covered: extra.covered,
          /*
            몸통에서만 쓰인다. 얼굴은 배율이 계산에서 사라지지만 몸통의 자는 프레이밍을 타므로,
            다음 회차가 "표준 구도"가 아니라 **이 사진과 같은 거리**에 맞춰야 한다.
          */
          sOfMinSide: extra.sOfMinSide,
        }
      : undefined,
    facing: extra.facing,
  };
}

/**
 * 신뢰도 = 촬영 품질(초점·노출·구도·피부) + 보정량(조명을 얼마나 크게 손댔는지).
 *
 * **이 함수의 무게가 예전보다 훨씬 무거워졌다.** 촬영 게이트를 걷어내면서 품질이 낮은 사진도
 * 전부 통과하게 됐으므로, "이 기록을 얼마나 믿을 수 있는가"를 말하는 곳이 여기밖에 남지 않았다.
 * 막지 않기로 한 이상 기록은 정직해야 한다 — 낮은 품질로 찍혔다는 사실이 점수와 문구에 남는다.
 */
export function scoreConfidence(
  evaluation: FrameEvaluation,
  colorNorm: ColorNormalization,
  baseline?: Baseline,
  /** 어떤 경로로 찍혔는지 — 'fallback'은 목표 품질에 못 미친 채 시간이 다 되어 찍힌 사진이다 */
  capturePath?: CapturePath,
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

  /*
    품질 항목을 놓친 사진에 씌우는 상한.

    예전에는 45였다. 그때는 이 경로로 들어오는 것이 **수동 셔터뿐**이었다 — 자동으로 찍힌 사진은
    정의상 모든 항목을 통과했으니까. 지금은 자동 셔터도 이 항목들을 요구하지 않으므로 평범한
    촬영이 여기로 들어온다. 45로 두면 대부분의 기록이 한 점으로 뭉쳐서, 정작 그 안에서 어느
    사진이 나은지를 구분할 수 없게 된다 — 상한이 정보를 지우는 셈이다.

    60으로 올리되 상한 자체는 남긴다. 초점·노출·피부는 후처리로 복구할 수 없으므로, 하나라도
    놓친 사진이 "높은 신뢰도"로 표시되어서는 안 된다 (tier 경계가 75라 medium에 머문다).
  */
  const hardFailed = (Object.keys(hard) as (keyof typeof hard)[]).filter((k) => !hard[k]);
  const capped = hardFailed.length > 0 ? Math.min(weighted, 60) : weighted;
  // 목표 품질에 못 미친 채 시간이 다 되어 찍힌 사진 — 앱이 "그만 기다리고 찍은" 것이라 더 깎는다
  const score = Math.round(capturePath === 'fallback' ? Math.min(capped, 50) : capped);

  const warnings: string[] = [];
  if (capturePath === 'fallback') {
    warnings.push('좋은 순간을 찾지 못해 그때까지 중 가장 나은 장면으로 촬영했어요');
  }
  if (!hard.focus) warnings.push('초점이 맞지 않은 상태로 촬영됐어요 (나중에 되살릴 수 없어요)');
  else if (breakdown.focus < 0.35) warnings.push('초점이 충분히 선명하지 않아요');
  if (!hard.skin) warnings.push('화면에 피부가 적게 담겨서 분석이 정확하지 않을 수 있어요');
  else if (breakdown.skin < 0.3) warnings.push('다음엔 조금 더 가까이 찍으면 더 정확해요');
  if (metrics.channelClip > GATE.channelClipMax) warnings.push('붉은 부분의 색이 날아가 진하기를 구분하기 어려워요');
  else if (!hard.exposure) warnings.push('밝은 부분이나 어두운 부분의 색 정보가 날아갔어요');
  else if (breakdown.exposure < 0.4) warnings.push('빛이 날아가거나 어두워 색 정보가 일부 손실됐어요');
  if (breakdown.color < 0.4) warnings.push('조명이 지난번과 많이 달라요 — 보정했지만 오차가 남을 수 있어요');

  /*
    재촬영을 권할지. **제외 여부가 아니다** — 이 값을 읽는 곳은 리뷰 화면의 권유 문구뿐이다.

    예전 기준(품질 항목을 하나라도 놓치면 false)을 그대로 두면 이제 거의 모든 촬영이 false가
    되어 문구가 늘 떠 있게 되고, 그러면 아무도 읽지 않는다. 되돌릴 수 없는 두 가지(초점·노출)를
    놓쳤거나 점수가 바닥일 때만 권한다 — 피부 점유율은 분류 입력 크롭(skinCropOf)이 상당 부분
    흡수하므로 여기서 재촬영을 권할 이유가 약해졌다.
  */
  const usable = (hard.focus && hard.exposure) || score >= 45;
  const tier = score >= 75 ? 'high' : score >= 50 ? 'medium' : 'low';

  return { score, tier, breakdown, warnings, usable };
}
