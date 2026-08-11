import type { PoseLandmarks } from './poseDetector';
import { scaleFrameOf, SCALE_SPEC, type ScaleFrame } from './scaleFrame';

/**
 * 어깨 두 점 → 몸통의 자.
 *
 *     d = 어깨너비 (양 어깨 사이) — 견봉간거리, 뼈
 *     면적의 자 = d²
 *
 * ── 왜 골반을 뺐는가 ────────────────────────────────────────
 *
 * 예전 자는 d(어깨너비) × v(어깨중점→골반중점)였다. 수식은 얼굴(안간거리 × 눈-입)과 똑같았지만
 * 결정적인 차이가 하나 있었다: **얼굴의 자는 얼굴의 3분의 1 크기인데, 몸통의 자는 몸통 전체를
 * 가로지른다.** 그래서 얼굴은 이마·귀가 잘려도 자가 멀쩡하지만, 몸통은 골반이 프레임을 벗어나는
 * 순간 자 자체가 추정값이 된다.
 *
 * 그리고 사용자가 등을 찍는 자연스러운 구도는 **거의 예외 없이 골반이 프레임 밖**이다. 실제
 * 사진들을 대 보면 어깨너비가 화면 짧은 변의 0.49~0.75를 차지하는데, 골반까지 담으려면 0.38까지
 * 물러나야 한다. 그러면 병변에 돌아가는 픽셀이 4분의 1~3분의 1로 줄어든다 —
 * **자를 정확히 얻은 만큼을 마스크에서 잃는 거래**였고, 애초에 그 구도로 찍는 사람이 없었다.
 *
 * d²로 바꾸면 조건이 "양 어깨가 화면 안"으로 줄어든다. 자가 몸통 위쪽 40cm에만 걸쳐 있으므로
 * 가슴만·등 위쪽만 담은 사진에서도 성립한다.
 *
 * ── 대가 ────────────────────────────────────────────────
 *
 * · **숙이기(pitch)를 감지할 수 없다.** v가 없으므로 앞뒤로 기울어도 d는 그대로다. 다만 오차가
 *   유계다 — 20° 기울면 6%, 30°면 13%로, 몸통의 변화 문턱(±44%) 안에 머문다.
 * · **비틀기(yaw)는 d/v 대신 어깨의 깊이 차로 잰다**(poseDetector의 shoulderDz). 25°까지는
 *   넓이 오차가 1/cos²25° = 1.22로 역시 문턱 안이라, 거친 판정으로 충분하다.
 *
 * 두 오차 모두 **한 사진 안에서 계통적으로** 생기므로, 문턱 안에 머무는 한 "변화 없음"으로
 * 읽힌다 — 없는 호전을 지어내지는 않는다. 그게 이 거래를 받아들일 수 있는 이유다.
 *
 * ── 바꾸지 않은 것 ──────────────────────────────────────
 *
 * 허리둘레·배 폭·젖꼭지 간격·배꼽은 여전히 쓰지 않는다. 이유는 하나이고 예전과 같다 —
 * **체중에 따라 변한다.** 변하는 것을 자로 쓰면 살이 빠진 것이 병변이 넓어진 것으로 기록된다.
 * 어깨너비(견봉간거리)만이 이 범위에서 유일하게 뼈다.
 */

/** 몸통에서 잰 자 */
export type TorsoFrame = ScaleFrame;

/**
 * 이 아래로는 넓이가 흔들릴 수 있다고 **표시**하는 선 (측정을 막지는 않는다 — scaleFrame 주석).
 */
export const MIN_TORSO_SCALE_PX = SCALE_SPEC.torso.minScalePx;

/**
 * ── 골반을 요구하던 시절의 실측 (자를 되돌릴 일이 있으면 이 표부터 볼 것) ──
 *
 * 예전 자(d × 어깨-골반)에서 "아래를 어디서 잘라도 되나"를 15회씩 재 본 결과다. 골반이 자에
 * 들어 있던 때라 프레임이 짧아질수록 값이 폭주했다:
 *
 *     아래를 어디서 자르나        areaRef 퍼짐   골반이 화면 밖   ROI 잘림
 *     골반 아래 +0.5v            12.5%           0/15          0/15
 *     골반선에서 딱              47.9%           1/15         11/15
 *     배꼽쯤                    81.7%          13/15         15/15
 *     허리                       437%          14/15         14/15
 *     명치                      7427%          10/12         11/12
 *
 * 지금 자에는 골반이 없으므로 이 표는 더 이상 적용되지 않는다 — 남겨 두는 이유는 **골반을 다시
 * 넣자는 제안이 나왔을 때 그 대가를 숫자로 보여주기 위해서**다. 사용자가 실제로 찍는 구도는
 * 이 표의 아래쪽 세 줄이고, 거기서 골반은 언제나 추정값이다.
 *
 * 그때 시도했다가 효과가 없던 것들: 관심영역을 랜드마크로 다시 잡아 2·3패스로 돌리기(22~37%,
 * 얼굴에서는 통했다), 검출기를 건너뛰고 프레임 전체를 랜드마크에 넣기(155%). 뒤엣것은 지금
 * 폴백 경로로 되살아났는데, 골반 정확도가 더 이상 값을 좌우하지 않기 때문이다(poseDetector).
 *
 * ⚠️ 표본은 공개 사진 한 장에 합성 흔들림이다. 실기기에서 같은 자리를 연속으로 찍어 다시 재고,
 *    그 값으로 SIGMA_BY_KIND.torso를 조정할 것 — 자가 바뀌었으므로 그 값도 다시 재야 한다.
 */

/**
 * 어깨가 "진짜로 보이는" 최소 확률.
 *
 * ⚠️ 캘리브레이션 전 값이다. 어깨가 프레임에 온전히 들어온 사진과 잘린 사진을 각각 여러 장 찍어
 *    visibility 분포가 갈리는 지점으로 다시 잡을 것 — 판정할 때마다 개발 콘솔에 실제 값이 찍힌다.
 */
const SHOULDER_VISIBILITY_MIN = 0.5;

export function torsoFrameOf(lm: PoseLandmarks, imageW: number, imageH: number): TorsoFrame | null {
  const shoulder = {
    x: (lm.leftShoulder.x + lm.rightShoulder.x) / 2,
    y: (lm.leftShoulder.y + lm.rightShoulder.y) / 2,
  };
  const d = Math.hypot(
    lm.leftShoulder.x - lm.rightShoulder.x,
    lm.leftShoulder.y - lm.rightShoulder.y,
  );
  if (!(d > 1)) return null;

  /*
    자의 "아래" 방향으로 정확히 d만큼 내려간 가상의 점.

    scaleFrameOf는 가로 기준선의 두 끝과 아래 기준점 하나로 자를 만든다(얼굴과 공유하는 계산).
    여기에 이 점을 넣으면 v = d가 되어 면적의 자가 **d·v = d²**로 떨어지고, 자의 중심도 어깨선
    아래 d/2 — 등·가슴 한가운데 — 에 놓인다. 계산을 한 곳에 두려고 실제 관절 대신 가상의 점을
    쓰는 것이지, 몸에 그런 지점이 있다는 뜻이 아니다.
  */
  const ux = (lm.leftShoulder.x - lm.rightShoulder.x) / d;
  const uy = (lm.leftShoulder.y - lm.rightShoulder.y) / d;
  /*
    가로 기준선에 수직인 두 방향 중 **아래쪽**(화면 y가 커지는 쪽)을 고른다.
    두 후보는 (-uy, ux)와 (uy, -ux)이고, 세로 성분이 각각 ux와 -ux다 — 그래서 ux의 부호로 고른다.
    좌/우 어깨 순서는 전면 카메라 미러링으로 뒤집힐 수 있는데, 그때 ux 부호도 함께 뒤집히므로
    이 선택이 그대로 따라간다.
  */
  const downX = ux >= 0 ? -uy : uy;
  const downY = ux >= 0 ? ux : -ux;
  const lower = { x: shoulder.x + downX * d, y: shoulder.y + downY * d };

  /*
    정면성 지표 — 좌우 어깨의 깊이 차를 어깨너비로 나눈 값이다.

    몸을 각도 θ만큼 틀면 두 어깨의 깊이가 d·sin θ만큼 벌어지므로 이 값은 대략 sin θ가 된다
    (0.26 ≈ 15°, 0.42 ≈ 25°). 예전에는 좌우 옆구리 길이 차를 썼지만 그건 골반이 있어야 잴 수
    있었다. 타고난 비대칭이 있는 사람은 0에서 시작하지 않으므로, 얼굴과 마찬가지로 **자기 기준
    사진과의 차이**로 쓴다(scaleFrame의 asymDelta).
  */
  const rawAsym = Math.abs(lm.shoulderDz) / d;
  /*
    z가 터무니없으면 **비틀림을 모르는 것으로 친다** (0으로 둔다).

    이 값은 대략 sin θ라서 1을 넘을 수 없다 — 넘었다는 것은 몸이 90° 넘게 돌아갔다는 뜻이 아니라
    z 추정이 깨졌다는 뜻이다. BlazePose의 z는 골반 중점을 원점으로 삼는데, 골반이 프레임 밖이라
    추정된 사진에서는 그 원점부터 흔들린다 — 그리고 그게 바로 이 앱이 다루는 사진이다.

    깨진 값을 그대로 쓰면 **정면으로 잘 서서 찍은 사진이 "몸이 돌아갔다"며 넓이에서 빠진다.**
    모르는 것을 모른다고 두면 최악의 경우 25° 남짓 틀어진 사진이 통과하는데, 그 오차는 22%로
    몸통의 변화 문턱(±44%) 안이라 호전으로 읽히지 않는다. 두 실패의 무게가 다르다.
  */
  const asym = rawAsym > 1 ? 0 : rawAsym;
  if (rawAsym > 1) {
    console.warn('[torso] 어깨 깊이(z)가 터무니없어 비틀림 판정을 건너뜁니다', {
      shoulderDz: Math.round(lm.shoulderDz),
      d: Math.round(d),
      rawAsym: Math.round(rawAsym * 100) / 100,
    });
  }

  /*
    자를 믿어도 되는가 — **어깨 두 점만** 본다. 골반은 더 이상 자에 들어가지 않는다.

    좌표가 화면 안인지만 보면 부족하다. 모델은 화면 밖 관절을 추정해서 내놓는데 그 추정이
    화면 안쪽으로 떨어지는 일이 흔해서, 경계 검사만으로는 "진짜 본 어깨"와 "지어낸 어깨"가
    구분되지 않는다. visibility가 정확히 그 구분을 위한 값이라 함께 요구한다.
  */
  const inside = (p: { x: number; y: number }) =>
    p.x >= 0 && p.y >= 0 && p.x <= imageW && p.y <= imageH;
  const vis = Math.min(lm.visibility.leftShoulder, lm.visibility.rightShoulder);
  const framed = inside(lm.leftShoulder) && inside(lm.rightShoulder) && vis >= SHOULDER_VISIBILITY_MIN;

  if (!framed) {
    // 실기기에서 임계값을 다시 잡으려면 실패한 판의 실제 숫자가 보여야 한다
    console.warn('[torso] 어깨를 믿을 수 없어 자를 만들지 않았어요', {
      d: Math.round(d),
      visibility: Math.round(vis * 100) / 100,
      minVisibility: SHOULDER_VISIBILITY_MIN,
      hipVisibility:
        Math.round(Math.min(lm.visibility.leftHip, lm.visibility.rightHip) * 100) / 100,
      inside: `${inside(lm.leftShoulder)}/${inside(lm.rightShoulder)}`,
      frame: `${Math.round(imageW)}×${Math.round(imageH)}`,
      dOfMinSide: Math.round((d / Math.min(imageW, imageH)) * 100) / 100,
    });
  }

  return scaleFrameOf('torso', lm.leftShoulder, lm.rightShoulder, lower, asym, framed);
}
