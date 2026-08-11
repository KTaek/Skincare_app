import type { PoseLandmarks } from './poseDetector';
import { scaleFrameOf, SCALE_SPEC, type ScaleFrame } from './scaleFrame';

/**
 * 어깨·골반 네 점 → 몸통의 자.
 *
 *     d = 어깨너비 (양 어깨 사이)            — 견봉간거리, 뼈
 *     v = 어깨 중점 → 골반 중점              — 척추 길이, 뼈
 *
 * 얼굴의 안간거리·눈-입 거리와 정확히 같은 자리에 들어간다(scaleFrame.ts). 허리둘레나 배 폭을
 * 쓰지 않는 이유는 하나다 — **체중에 따라 변한다.** 변하는 것을 자로 쓰면 살이 빠진 것이 병변이
 * 넓어진 것으로 기록된다.
 */

/** 몸통에서 잰 자 */
export type TorsoFrame = ScaleFrame;

/** 넓이를 재기 위해 필요한 최소 몸통 크기 (길이 스케일 s, 원본 픽셀) */
export const MIN_TORSO_SCALE_PX = SCALE_SPEC.torso.minScalePx;

/**
 * 자를 믿을 수 있는 프레이밍인가 — 몸통에만 있는 검사다.
 *
 * ── 무엇을 요구하고 무엇을 포기했는가 ────────────────────────
 *
 * 요구하는 것은 하나다: **어깨 두 점과 골반 두 점이 사진 안에 있을 것.** 가슴/복부만, 또는 등만
 * 찍는 촬영이 그대로 성립한다 — 머리도 다리도 필요 없다.
 *
 * ── 왜 어깨와 골반은 못 빼는가 (실측) ────────────────────────
 *
 * "허리에서 끊으면 안 되나"는 당연한 질문이고, 답은 안 된다. 골반이 화면을 벗어나면 모델은 그
 * 위치를 **추정해서** 내놓는데 그 추정이 회차마다 전혀 다르고, 사람 대부분이 프레임 밖이면
 * 화면 안에 있는 어깨 예측까지 함께 무너진다. 같은 방식으로 15회 찍어 잰 areaRef 퍼짐:
 *
 *     아래를 어디서 자르나        퍼짐      골반이 화면 밖   ROI 잘림
 *     골반 아래 +0.5v (지금)     12.5%        0/15          0/15
 *     골반선에서 딱              47.9%        1/15         11/15
 *     배꼽쯤                    81.7%       13/15         15/15
 *     허리                       437%       14/15         14/15
 *     명치                      7427%       10/12         11/12
 *
 * 자를 고쳐도 두 번째 열(ROI 잘림)은 남는다 — 잘린 쪽 병변이 안 세어지는데 분모는 그대로라
 * 병변이 그대로여도 줄어든 것처럼 보인다. 그래서 이 조건만은 풀 수 없다.
 *
 * ── 반대로, 풀 수 있는 것은 풀었다 ───────────────────────────
 *
 * 정렬 게이트는 한때 배율 ±11% · 위치 0.12s까지 조였다가 되돌렸다. **조인 만큼 사용자가 통과하지
 * 못했고, 통과하지 못하면 추이 자체가 없기 때문이다.** 되돌려도 되는 근거:
 *
 *     정렬 ±16% · 위치 0.2s (지금) → areaRef 퍼짐 12.5%, σ ≈ 4.2%
 *     변화 문턱 ±44% = 10.5σ — 잡음을 이미 넉넉히 덮는다
 *
 * 그리고 게이트를 못 넘은 사진도 **숫자는 보여준다**(화면의 areaShowOf). 어긋난 것은 회차 간
 * 비교 자격이지 그 한 장의 값이 아니라서, "약 12%"로 보여주고 추이에서만 뺀다.
 *
 * 시도했지만 효과가 없던 것들(다시 시도하지 말 것): 관심영역을 랜드마크로 다시 잡아 2·3패스로
 * 돌리기(22~37%, 얼굴에서는 통했다), 검출기를 건너뛰고 프레임 전체를 랜드마크에 넣기(155%).
 *
 * ⚠️ 표본은 공개 사진 한 장에 합성 흔들림이다. 실기기에서 같은 자리를 연속으로 찍어 다시 재고,
 *    그 값으로 SIGMA_BY_KIND.torso를 조정할 것.
 */

/**
 * 네 점에서 자를 만든다. 점들이 뭉쳐 있으면(검출 실패의 흔한 모습) null.
 *
 * 비대칭 지표는 **좌우 옆구리 길이 차**다 — 얼굴의 코 치우침에 해당한다. 몸을 옆으로 틀면 카메라
 * 쪽 옆구리가 길어 보이고 반대쪽이 짧아지므로, 그 차이가 곧 정면성이다. v로 나눠 두면 사람의
 * 크기와 촬영 거리가 지워져서 회차 간에 견줄 수 있다.
 *
 * 타고난 비대칭(척추측만, 어깨 높이 차)이 있는 사람은 이 값이 0에서 시작하지 않는다. 그래서
 * 절대 기준이 아니라 **자기 기준 사진과의 차이**로 쓴다(scaleFrame의 asymDelta).
 */
export function torsoFrameOf(lm: PoseLandmarks, imageW: number, imageH: number): TorsoFrame | null {
  const shoulder = {
    x: (lm.leftShoulder.x + lm.rightShoulder.x) / 2,
    y: (lm.leftShoulder.y + lm.rightShoulder.y) / 2,
  };
  const hip = {
    x: (lm.leftHip.x + lm.rightHip.x) / 2,
    y: (lm.leftHip.y + lm.rightHip.y) / 2,
  };

  const leftSide = Math.hypot(lm.leftShoulder.x - lm.leftHip.x, lm.leftShoulder.y - lm.leftHip.y);
  const rightSide = Math.hypot(lm.rightShoulder.x - lm.rightHip.x, lm.rightShoulder.y - lm.rightHip.y);
  const mean = (leftSide + rightSide) / 2;
  const asym = mean > 0 ? Math.abs(leftSide - rightSide) / mean : 0;

  /*
    네 점이 모두 사진 안에 있는가.

    모델은 화면 밖의 관절도 위치를 **추정해서** 내놓기 때문에, 좌표만 보면 언제나 값이 있다.
    그 추정값을 자로 쓰면 어깨가 잘린 사진에서 있지도 않은 어깨너비가 기록된다. 관심영역이
    사진 안에 들어오는지는 따로 본다(scaleFrame의 roiFits) — 그건 병변이 다 세어지는지의 문제고,
    이건 자 자체가 재어졌는지의 문제라 서로 다른 검사다.
  */
  const inside = (p: { x: number; y: number }) =>
    p.x >= 0 && p.y >= 0 && p.x <= imageW && p.y <= imageH;
  const framed =
    inside(lm.leftShoulder) && inside(lm.rightShoulder) && inside(lm.leftHip) && inside(lm.rightHip);

  return scaleFrameOf('torso', lm.leftShoulder, lm.rightShoulder, hip, asym, framed);
}
