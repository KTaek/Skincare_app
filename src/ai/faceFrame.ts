import type { FaceDetection, FaceKeypoints } from './faceDetector';

/**
 * 얼굴 세 점(양눈·입)에서 뽑아내는 촬영 기하 — 배율·자세·회전·위치.
 *
 * 왜 이 세 점인가. 병변 면적을 회차 간 비교하려면 "같은 배율로 찍었는가"를 알아야 하는데,
 * 그 기준이 될 수 있는 것은 **시간에 따라 변하지 않는 것**뿐이다. 병변은 변한다(그래서 병변
 * 크기를 기준으로 삼던 구도 게이트가 frameQuality.ts에서 걷어내졌다). 얼굴 골격은 변하지 않는다.
 *
 * 안간거리 d 하나만 쓰지 않는 이유: 고개를 좌우로 돌리면(yaw) d만 짧아지고 눈-입 거리 v는
 * 그대로다. d²로 나누면 면적이 부풀려진다. d·v를 면적의 자로 쓰면 두 방향의 단축이 서로를
 * 부분적으로 상쇄하고, 덤으로 **d/v 비율 자체가 자세를 재는 눈금**이 된다 — 정면일 때만
 * 그 비율이 기준 세션과 같아진다.
 */

export interface FaceFrame {
  /** 안간거리 (원본 픽셀). yaw에 민감하다 */
  d: number;
  /** 눈선 중점 → 입 (원본 픽셀). pitch에 민감하다 */
  v: number;
  /** 길이 스케일 √(d·v) */
  s: number;
  /** 면적 스케일 d·v — 병변 면적을 이 값으로 나누면 배율이 사라진다 */
  areaRef: number;
  /** 얼굴 중심 (눈 둘과 입의 무게중심, 대략 코 높이) */
  cx: number;
  cy: number;
  /** 면내 회전 (rad). 눈선이 수평이면 0 */
  theta: number;
  /** d / v — 정면성. 사람마다 값이 다르므로 절대 기준이 아니라 기준 세션과의 비교로 쓴다 */
  ratio: number;
  /**
   * 코의 좌우 비대칭 (0 = 완전 대칭). 두 눈에서 코까지의 거리 차를 d로 나눈 값이라
   * 사람에 따른 편차가 작아, 기준 세션 없이도 쓸 수 있는 유일한 정면성 지표다.
   */
  noseAsym: number;
}

/** 기준 세션이 남기는 얼굴 기하 — 다음 촬영의 자세 비교 기준이 된다 */
export interface FaceReference {
  areaRef: number;
  ratio: number;
  /** 기준 사진의 코 대칭 — 타고난 비대칭을 상쇄하는 기준값 */
  noseAsym: number;
}

/**
 * 자세 비교에 필요한 것은 d/v 하나뿐이다.
 * 기준 세션(FaceReference)이든 화면에 깔린 지난 사진(FaceFraming)이든 이것만 있으면 되므로,
 * 어느 쪽을 넘겨도 되도록 필요한 만큼만 요구한다.
 */
export interface PoseReference {
  ratio: number;
  /** 그 사진에서의 코 대칭. 타고난 비대칭을 상쇄하려면 자기 값과 견줘야 한다 */
  noseAsym: number;
}

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

/**
 * 키포인트 → 촬영 기하. 세 점이 거의 한 점으로 뭉쳐 있으면(검출 실패의 흔한 모습) null.
 *
 * 하한을 두는 이유: d나 v가 0에 가까우면 뒤이은 나눗셈이 전부 폭주해서, 말도 안 되는 면적
 * 지수가 "측정된 값"인 척 기록에 남는다. 못 잰 것은 못 잰 것으로 두는 편이 낫다.
 */
export function faceFrameOf(kp: FaceKeypoints): FaceFrame | null {
  const ex = (kp.leftEye.x + kp.rightEye.x) / 2;
  const ey = (kp.leftEye.y + kp.rightEye.y) / 2;

  const d = dist(kp.leftEye.x, kp.leftEye.y, kp.rightEye.x, kp.rightEye.y);
  const v = dist(ex, ey, kp.mouth.x, kp.mouth.y);
  if (!(d > 1) || !(v > 1)) return null;

  const dl = dist(kp.leftEye.x, kp.leftEye.y, kp.nose.x, kp.nose.y);
  const dr = dist(kp.rightEye.x, kp.rightEye.y, kp.nose.x, kp.nose.y);

  return {
    d,
    v,
    s: Math.sqrt(d * v),
    areaRef: d * v,
    cx: (kp.leftEye.x + kp.rightEye.x + kp.mouth.x) / 3,
    cy: (kp.leftEye.y + kp.rightEye.y + kp.mouth.y) / 3,
    // 눈 순서(좌/우)는 미러링으로 뒤집힐 수 있다. 부호가 뒤집혀도 |θ|는 같으므로
    // 기울기 판정에는 영향이 없다 (목표 각도가 0이라 좌우 대칭이다).
    theta: Math.atan2(kp.leftEye.y - kp.rightEye.y, kp.leftEye.x - kp.rightEye.x),
    ratio: d / v,
    noseAsym: Math.abs(dl - dr) / d,
  };
}

export function faceFrameOfDetection(det: FaceDetection | null): FaceFrame | null {
  return det ? faceFrameOf(det.kp) : null;
}

/**
 * 사진 한 장이 겨냥한 구도 — 얼굴이 사진의 어디에 얼마나 크게 담겼는지.
 *
 * 픽셀이 아니라 **비율**로 들고 있는 이유: 지난 사진과 지금 프리뷰는 해상도가 다를 수 있다
 * (판정 프레임은 화질을 낮춰 찍고, 기록 사진은 원본 해상도다). 비율로 두면 어느 크기의
 * 프레임에도 같은 구도를 재현할 수 있다.
 */
export interface FaceFraming {
  /** 얼굴 스케일 s ÷ 프레임 짧은 변 */
  sOfMinSide: number;
  /** 얼굴 중심의 가로·세로 위치 (0~1) */
  cxFrac: number;
  cyFrac: number;
  /** 그 사진에서의 얼굴 기울기 (rad) */
  theta: number;
  /** d/v — 자세 비교 기준 (사람마다 달라 자기 사진과만 견줄 수 있다) */
  ratio: number;
  /** 코 대칭 — 이것도 사람마다 달라 자기 사진과만 견줄 수 있다 */
  noseAsym: number;
}

export function framingOf(frame: FaceFrame, imageW: number, imageH: number): FaceFraming {
  return {
    sOfMinSide: frame.s / Math.min(imageW, imageH),
    cxFrac: frame.cx / imageW,
    cyFrac: frame.cy / imageH,
    theta: frame.theta,
    ratio: frame.ratio,
    noseAsym: frame.noseAsym,
  };
}

/**
 * 지난 사진이 없을 때의 촬영 목표 — 화면 한가운데의 고정 크기.
 *
 * 첫 촬영에는 맞출 지난 사진이 없으므로 여기로 유도한다. 이 구도가 이후 모든 회차의 목표가
 * 되므로(첫 사진이 곧 기준이다), 분석에 유리한 자리 — 얼굴이 화면을 충분히 채우고 잘리지 않는
 * 크기 — 로 잡아 둔다.
 */
export const FACE_TARGET = {
  /**
   * 프레임 짧은 변 대비 목표 길이 스케일 s. ROI(= ROI_SIDE × s)가 짧은 변의 72%를 차지한다.
   *
   * 이 값은 취향이 아니라 **정렬 게이트에서 유도되는 상한**이다. 자동 셔터가 열린 촬영은
   * 반드시 넓이 검사(faceRoiFits)도 통과해야 한다 — 셔터는 열렸는데 넓이는 빠지면 사용자는
   * 앱이 스스로 모순된 말을 한다고 느낀다.
   *
   * 정렬 게이트가 허용하는 최악의 조합에서 ROI가 화면을 벗어나지 않아야 하므로:
   *
   *     배율 상한   e^0.18 = 1.197 배  →  ROI 반폭 = 1.5 × 1.197 s = 1.796 s
   *     위치 상한   0.20 s (그때의 실제 s 기준) = 0.239 s
   *     합          2.035 s  ≤  짧은 변의 절반
   *     ⇒ s ≤ 0.246 × 짧은 변,  즉 ROI ≤ 0.74 × 짧은 변
   *
   * 0.72를 쓴다(약간의 여유). 예전 값 0.78은 이 부등식을 어겨서, 배율을 조금만 크게 잡으면
   * 정렬은 통과하는데 넓이만 조용히 빠졌다.
   *
   * 더 키우고 싶으면 세 값(여기 · scaleLn · offset)을 **함께** 움직여야 한다.
   */
  scaleOfMinSide: 0.72 / 3.0,
} as const;

/**
 * 분석에 쓸 정사각형 관심영역의 한 변 (얼굴 스케일 s의 배수).
 *
 * 성인 얼굴의 실측 비례로 잡았다: 눈선-입 60mm · 안간거리 63mm면 s ≈ 61mm이고, 이마 끝에서
 * 턱까지가 약 190mm라 3.0 s ≈ 185mm — 턱과 이마가 겨우 들어오고 좌우로는 여유가 남는다.
 */
const ROI_SIDE = 3.0;
/**
 * ROI 중심을 얼굴의 "위쪽"으로 얼마나 밀지 (s의 배수).
 * 세 점의 무게중심은 코 높이라 얼굴 세로 중심보다 조금 아래다 — 그대로 두면 이마가 잘린다.
 */
const ROI_UP_SHIFT = 0.15;

/** 게이트 임계값 — 셋의 성격이 다르므로 근거를 각각 적어 둔다 */
export const ALIGN_GATE = {
  /**
   * 배율 |ln(s/s_target)| 상한. ±20%까지 허용한다.
   *
   * 면적을 d·v로 정규화하면 배율은 계산에서 **사라지므로** 여기를 조일 이유가 별로 없다.
   * 이 게이트가 남아 있는 이유는 정확도가 아니라 해상도와 프레이밍이다 — 너무 멀면 512 격자에
   * 담기는 병변 픽셀이 줄고, 너무 가까우면 얼굴이 화면 밖으로 나간다.
   */
  scaleLn: 0.18,
  /**
   * 자세 |ln((d/v)/(d/v)_기준)| 상한.
   *
   * 고개를 각도 θ만큼 돌리면(yaw) 안간거리가 cos θ로 짧아지고 눈-입 거리는 그대로다 — 즉 이
   * 값은 그대로 ln(1/cos θ)다. 숙이면(pitch) 반대로 v가 짧아져 부호만 바뀐다. 그래서 임계값을
   * 각도로 읽을 수 있다:
   *
   *     0.035 → 15°     0.05 → 18°     0.062 → 20°     0.10 → 25°
   *
   * 0.05를 쓴다. 왜 이 근처인가:
   *   · 아래로: 검출기의 키포인트 떨림이 d·v에 1% 남짓(≈0.01) 들어오므로 그보다 몇 배는 커야 한다.
   *   · 위로: 얼굴 정면에 있는 병변은 얼굴과 똑같이 단축되므로 d·v로 나누면 오차가 상쇄된다.
   *     하지만 볼처럼 이미 옆으로 돌아간 면의 병변은 상쇄되지 않고, 얼굴 병변에서 볼은 가장
   *     흔한 자리다. 그 오차가 눈에 띄기 시작하는 20° 언저리를 못 넘게 잡았다.
   *
   * ⚠️ 실기기 캘리브레이션 대상이다. 너무 조이면 자동 셔터가 잘 안 열리는데, 그건 넓이 몇 %가
   *    틀리는 것보다 나쁜 실패다 (수동 촬영은 항상 열려 있고, 그 사진은 넓이만 빠진다).
   */
  poseLn: 0.05,
  /**
   * 코 대칭이 **기준 사진과 얼마나 달라졌는지**의 상한.
   *
   * 절대값이 아니라 차이를 보는 이유가 중요하다. 코가 원래 조금 휜 사람은 정면을 정확히 봐도
   * noseAsym이 0이 아니라 자기만의 상수에서 시작한다 — 실측 비례로 코끝이 중앙선에서 4mm만
   * 벗어나 있어도 0.096이라, 예전의 절대 임계 0.12에는 여유가 거의 남지 않는다. 그러면 그
   * 사람은 무엇을 해도 넓이를 못 재게 된다.
   *
   * 이건 이 저장소가 이미 한 번 겪은 실수와 같은 종류다 — 구도 게이트가 "변하는 대상(병변
   * 크기)을 기준으로 썼다"면, 이쪽은 "사람마다 다른 값을 절대 기준으로 썼다". 자기 자신과
   * 비교하면 타고난 비대칭이 양쪽에서 상쇄되고 남는 것은 자세 변화뿐이다.
   *
   * 0.12는 각도로 약 14°에 해당한다 (아래 대응표).
   *
   *     코 옆이동 1mm → 0.024 (3°)    4mm → 0.096 (12°)    7mm → 0.168 (20°)
   *               2mm → 0.048 (6°)    5mm → 0.120 (14°)   10mm → 0.238 (30°)
   */
  noseAsymDelta: 0.12,
  /**
   * 기준 사진이 없을 때만 쓰는 느슨한 절대 상한 (≈32°).
   *
   * 첫 촬영에는 견줄 상대가 없어서 타고난 비대칭과 돌아간 고개를 구분할 방법이 없다. 그래서
   * 여기서는 정확도를 요구하지 않고 "옆모습이 기준 사진이 되는 것"만 막는다.
   *
   * 첫 장의 자세가 조금 틀어져도 괜찮은 이유: 그 사진은 **비교 대상이 아니라 기준**이다.
   * 이후 촬영이 그 자세에 맞기만 하면 회차 간 비교는 그대로 성립한다.
   */
  noseAsymAbs: 0.25,
  /** 면내 회전 상한 (rad ≈ 7°) */
  rotation: (7 * Math.PI) / 180,
  /** 얼굴 중심 어긋남 상한 (얼굴 스케일 s 대비). 0.20 s ≈ 화면 짧은 변의 5% */
  offset: 0.2,
} as const;

/**
 * 넓이를 재기 위해 필요한 최소 얼굴 크기 (길이 스케일 s, 원본 픽셀).
 *
 * 배율은 정규화로 사라지지만 **해상도는 사라지지 않는다.** 분석은 관심영역(3s)을 512 격자로
 * 눌러 넣으므로, s가 작으면 없는 정보를 늘려 놓은 것이 되고 병변 경계가 뭉개진다.
 * s=120이면 관심영역이 360px이라 512로 1.4배 늘어난다 — 그 정도가 한계다.
 *
 * 이 값이 필요한 곳은 주로 앨범 사진이다. 카메라 촬영은 배율 게이트가 이미 얼굴을 화면에 크게
 * 담도록 유도하지만, 갤러리에는 얼굴이 손톱만 하게 찍힌 사진도 있다.
 *
 * ⚠️ 실기기 캘리브레이션 대상 — 실제로 몇 픽셀부터 넓이가 흔들리는지 재서 다시 잡을 것.
 */
export const MIN_FACE_SCALE_PX = 120;

export interface AlignTarget {
  /** 목표 길이 스케일 (원본 픽셀) */
  s: number;
  /** 목표 중심 (원본 픽셀) */
  cx: number;
  cy: number;
  /** 목표 기울기 (rad) */
  theta: number;
}

/**
 * 이번 프레임의 정렬 목표를 픽셀 좌표로 만든다.
 *
 * 지난 사진(고스트)이 있으면 **그 사진의 구도가 목표**다. 화면에 그 사진을 그대로 깔아 두고
 * 맞추라고 하면서 게이트는 다른 자리를 재면, 사용자가 눈으로 맞춘 순간에 판정이 실패한다 —
 * 화면과 판정은 반드시 같은 곳을 겨냥해야 한다.
 *
 * 고스트가 없으면(첫 촬영, 지난 사진에서 얼굴을 못 찾음) 고정 표준으로 유도한다.
 *
 * 목표를 항상 **기준 사진 하나**로 두는 것이 중요하다. 매번 직전 사진을 목표로 삼으면 회차마다
 * 허용 오차만큼 밀린 구도가 다음 목표가 되어 서서히 흘러간다 — 그래서 부르는 쪽이 기준 세션의
 * 사진을 우선 넘긴다.
 */
export function alignTargetFor(imageW: number, imageH: number, framing?: FaceFraming): AlignTarget {
  const minSide = Math.min(imageW, imageH);
  if (framing) {
    return {
      s: minSide * framing.sOfMinSide,
      cx: imageW * framing.cxFrac,
      cy: imageH * framing.cyFrac,
      theta: framing.theta,
    };
  }
  const s = minSide * FACE_TARGET.scaleOfMinSide;
  return {
    s,
    cx: imageW / 2,
    /*
      세 점의 무게중심은 코 높이라 얼굴 세로 중심보다 아래에 있고, faceRoiOf는 그만큼(0.15 s)
      관심영역을 위로 밀어 보정한다. 그러므로 목표 무게중심은 화면 중앙보다 **아래**여야
      관심영역이 화면 한가운데 놓인다.

      예전에는 여기를 0.47H(중앙보다 위)로 두었는데, 위로 미는 보정과 방향이 같아 이중으로
      올라갔다. 그러면 관심영역이 위로 치우쳐 아래 여백을 낭비하고 위쪽 여유가 사라져서,
      가로 화면에서 정렬은 통과하는데 얼굴이 잘리는 조합이 생겼다.
    */
    cy: imageH / 2 + ROI_UP_SHIFT * s,
    theta: 0,
  };
}

/**
 * 표준 프레이밍의 관심영역 사각형 (프레임 픽셀 좌표).
 *
 * 화면 가이드와 게이트가 같은 자리를 가리키게 하려고 한 곳에서 만든다 — 도형을 그리는 쪽이
 * 이 계산을 따로 하면 언젠가 어긋나고, 그러면 "가이드에 맞췄는데 안 찍힌다"가 된다.
 */
export function standardRoi(imageW: number, imageH: number): FaceRoi {
  const t = alignTargetFor(imageW, imageH);
  const side = ROI_SIDE * t.s;
  return { x: t.cx - side / 2, y: t.cy - ROI_UP_SHIFT * t.s - side / 2, width: side, height: side };
}

export type AlignFault = 'none' | 'scale' | 'offset' | 'rotation' | 'pose';

export interface AlignEvaluation {
  ok: boolean;
  /** 0~1 막대값 — 가장 나쁜 항목을 쓴다 (지금 무엇에 발목 잡혀 있는지를 보여줘야 하므로) */
  gauge: number;
  /** 무엇이 가장 모자란지 — 한 번에 하나만 말한다 */
  fault: AlignFault;
  hint: string;
  /** 지금 배율이 목표보다 큰지 작은지 (안내 문구를 "가까이/멀리"로 가르는 데 쓴다) */
  scaleLn: number;
  /**
   * 자세(정면성)만 따로 뽑은 통과 여부.
   *
   * 정렬 항목 넷 중 이것만 성격이 다르다. 배율·위치·기울기는 넓이를 d·v로 나누는 순간 **계산에서
   * 사라지므로** 측정의 정확도와 아무 상관이 없다 — 그 셋은 촬영을 안내하기 위한 것(해상도를
   * 확보하고 얼굴이 잘리지 않게)이다. 반면 고개를 돌리거나 숙인 것은 투영 자체를 바꿔 버려
   * 되돌릴 수 없다.
   *
   * 그래서 "넓이를 비교해도 되는가"를 판단할 때는 정렬 전체가 아니라 이것만 본다 —
   * 앨범에서 고른 사진처럼 가이드를 볼 기회가 없었던 사진도 자세만 맞으면 잴 수 있다.
   */
  poseOk: boolean;
  /** 자세를 견준 기준값의 코 대칭 (없으면 절대 상한으로 판정했다는 뜻) — 진단 로그용 */
  poseRef: number | null;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * 정렬 판정. 기준 세션의 얼굴 기하(reference)가 있으면 자세 비교까지 하고, 없으면(첫 촬영)
 * 코 대칭만으로 정면성을 본다.
 *
 * 이 판정은 **자동 셔터만 막고 촬영 자체는 막지 않는다.** 정렬이 어긋난 사진도 등급 판정에는
 * 아무 문제가 없고(사진 품질과 무관한 문제다), 다만 면적을 회차 간 비교할 수 없을 뿐이다.
 * 그래서 신뢰도 점수(scoreConfidence)에도 넣지 않았다 — 여기서 걸린 촬영은 면적 측정만 빠진다.
 */
export function evaluateAlign(
  frame: FaceFrame,
  target: AlignTarget,
  reference?: PoseReference,
): AlignEvaluation {
  const scaleLn = Math.log(frame.s / target.s);
  const offset = Math.hypot(frame.cx - target.cx, frame.cy - target.cy) / frame.s;
  // 목표가 지난 사진이면 그 사진의 기울기가 기준이다 — 지난 사진이 5° 기울어 있는데 수평을
  // 요구하면, 고스트에 얼굴을 맞춘 바로 그 순간에 회전 게이트가 걸린다
  const rotation = Math.abs(normalizeAngle(frame.theta - target.theta));
  const poseLn = reference ? Math.abs(Math.log(frame.ratio / reference.ratio)) : 0;

  const bars = {
    scale: clamp01(1 - Math.abs(scaleLn) / ALIGN_GATE.scaleLn),
    offset: clamp01(1 - offset / ALIGN_GATE.offset),
    rotation: clamp01(1 - rotation / ALIGN_GATE.rotation),
    /*
      자세는 두 지표(d/v, 코 대칭) 중 나쁜 쪽이다. 둘 다 **사람마다 다른 값**이라 절대 기준으로
      쓸 수 없고, 반드시 그 사람의 기준 사진과 견뎌야 한다.

      기준 사진이 없는 첫 촬영에서는 견줄 상대가 없으므로 정확도를 요구하지 않는다 — 그 사진은
      비교 대상이 아니라 기준이 될 사진이라, 옆모습만 아니면 된다.
    */
    pose: reference
      ? Math.min(
          clamp01(1 - poseLn / ALIGN_GATE.poseLn),
          clamp01(1 - Math.abs(frame.noseAsym - reference.noseAsym) / ALIGN_GATE.noseAsymDelta),
        )
      : clamp01(1 - frame.noseAsym / ALIGN_GATE.noseAsymAbs),
  };

  // 고치면 나머지가 함께 따라오는 순서 — 크기를 맞추면 위치가, 위치가 맞으면 각도가 쉬워진다
  const order: AlignFault[] = ['scale', 'offset', 'rotation', 'pose'];
  const fault = order.find((k) => bars[k as keyof typeof bars] <= 0) ?? 'none';
  const gauge = Math.min(bars.scale, bars.offset, bars.rotation, bars.pose);

  return { ok: fault === 'none', gauge, fault, hint: alignHint(fault, scaleLn), scaleLn, poseOk: bars.pose > 0, poseRef: reference?.noseAsym ?? null };
}

/** 각도를 -π~π로 접는다 — 미러링이나 뒤집힌 검출이 ±π 근처 값을 만들 수 있다 */
function normalizeAngle(theta: number): number {
  let a = theta;
  while (a > Math.PI / 2) a -= Math.PI;
  while (a < -Math.PI / 2) a += Math.PI;
  return a;
}

function alignHint(fault: AlignFault, scaleLn: number): string {
  switch (fault) {
    case 'scale':
      return scaleLn < 0 ? '조금 더 가까이 — 가이드에 얼굴을 채워주세요' : '조금 더 멀리 — 얼굴이 가이드보다 커요';
    case 'offset':
      return '얼굴을 가이드 한가운데로 옮겨주세요';
    case 'rotation':
      return '고개가 기울었어요 — 눈높이를 수평으로';
    case 'pose':
      return '정면을 봐주세요 — 고개를 돌리거나 숙이지 말고';
    default:
      return '가이드에 맞았어요 — 그대로 유지해주세요';
  }
}

export interface FaceRoi {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 분석·품질 측정에 쓸 정사각형 관심영역.
 *
 * **정사각형**인 것이 중요하다. 지금 세그 입력은 프레임 전체를 종횡비를 무시하고 512×512로 눌러
 * 넣는데(extractNormalizedRGB), 그러면 마스크 픽셀 하나가 가리는 실제 넓이가 가로세로로 달라지고
 * 사진 비율이 바뀌면 그 왜곡도 함께 바뀐다. 정사각형을 잘라 넣으면 왜곡이 아예 없다.
 *
 * 덤으로 얻는 것: 얼굴이 512 격자를 가득 채워 유효 해상도가 3~4배 오르고, 배경·머리카락·옷에서
 * 나오는 오검출이 입력 단계에서 사라지며, 세그 모델의 학습 분포(피부가 화면의 94.5%)에 훨씬
 * 가까워진다.
 *
 * 사진 밖으로 나가면 밀어 넣고, 그래도 안 들어가면 줄인다 — 정렬 게이트를 통과한 촬영에서는
 * 둘 다 일어나지 않지만, 수동 촬영은 게이트를 건너뛸 수 있다.
 */
export function faceRoiOf(frame: FaceFrame, imageW: number, imageH: number): FaceRoi {
  const { x, y, side } = idealRoi(frame);
  // 사진 밖으로 나가면 줄이고 밀어 넣는다. 그 순간 이 ROI는 더 이상 얼굴 전체를 담지 못하므로
  // 넓이를 재서는 안 된다 — 그 판단은 faceRoiFits가 하고, 부르는 쪽이 반드시 함께 확인해야 한다.
  const w = Math.min(side, imageW, imageH);
  return {
    x: Math.max(0, Math.min(imageW - w, x + (side - w) / 2)),
    y: Math.max(0, Math.min(imageH - w, y + (side - w) / 2)),
    width: w,
    height: w,
  };
}

/** 잘라내기 전의 관심영역 — 얼굴을 기준으로만 정해진, 사진 경계를 모르는 사각형 */
function idealRoi(frame: FaceFrame): { x: number; y: number; side: number } {
  // 얼굴의 "위" 방향 — 눈선에 수직이고 입에서 멀어지는 쪽
  const upX = Math.sin(frame.theta);
  const upY = -Math.cos(frame.theta);

  const side = ROI_SIDE * frame.s;
  const cx = frame.cx + upX * ROI_UP_SHIFT * frame.s;
  const cy = frame.cy + upY * ROI_UP_SHIFT * frame.s;
  return { x: cx - side / 2, y: cy - side / 2, side };
}

/**
 * 얼굴 전체가 사진 안에 들어왔는가 — **넓이를 재도 되는지의 전제 조건**이다.
 *
 * 왜 따로 확인해야 하나. 넓이를 d·v로 나누면 배율과 위치가 상쇄되지만, 그건 **병변이 전부
 * 관심영역 안에 있을 때만** 참이다. 얼굴이 화면 밖으로 걸치면 faceRoiOf가 사각형을 줄이거나
 * 밀어 넣는데, 그러면 잘려 나간 쪽(턱이나 이마)의 병변은 아예 세어지지 않는다. 그런데 분모인
 * d·v는 그대로다 — 눈과 입만 보이면 계산되기 때문이다.
 *
 * 그 결과가 위험하다: **병변은 그대로인데 지수만 내려가고, 사용자는 그것을 호전으로 읽는다.**
 * 잘린 채로 재느니 재지 않는 편이 낫다.
 *
 * 관심영역(3s)은 성인 얼굴의 이마 끝~턱(≈3.1s)과 거의 같으므로, 이 사각형이 사진 안에 들어오면
 * 얼굴도 들어온 것이다 — 그래서 눈·코·입 좌표를 따로 확인할 필요가 없다.
 */
export function faceRoiFits(frame: FaceFrame, imageW: number, imageH: number): boolean {
  const { x, y, side } = idealRoi(frame);
  return x >= 0 && y >= 0 && x + side <= imageW && y + side <= imageH;
}
