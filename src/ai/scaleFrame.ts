/**
 * 넓이를 재는 **자(ruler)** — 얼굴과 몸통이 함께 쓰는 한 겹.
 *
 * 병변 면적을 회차 간 비교하려면 촬영 거리를 지워야 하고, 그러려면 시간에 따라 변하지 않는 기준
 * 길이가 필요하다. 병변 자체는 변하므로 기준이 될 수 없고(그래서 병변 크기를 쓰던 구도 게이트가
 * frameQuality.ts에서 걷어내졌다), 남는 것은 뼈뿐이다:
 *
 *     얼굴 — d = 안간거리,   v = 눈선 중점→입      (두개골)
 *     몸통 — d = 어깨너비,   v = 어깨중점→골반중점  (견봉간거리와 척추)
 *
 * 두 경우 모두 **면적의 자는 d·v**다. d 하나만 쓰지 않는 이유가 둘 다 같다: 고개를 돌리거나(yaw)
 * 몸을 틀면 d만 짧아지고 v는 그대로다. d²로 나누면 면적이 부풀려진다. d·v를 쓰면 두 방향의 단축이
 * 서로를 부분적으로 상쇄하고, 덤으로 **d/v 비율 자체가 자세를 재는 눈금**이 된다.
 *
 * 수식이 같으므로 ROI·정렬 게이트·프레이밍 목표도 전부 공유한다. 다른 것은 상수뿐이라 SCALE_SPEC
 * 한 곳에 모아 두었다 — 나중에 팔·다리를 붙일 때도 자를 하나 더 만들고 상수 한 줄을 더하면 된다.
 */

export type ScaleKind = 'face' | 'torso';

/** 사진 한 장에서 잰 자 — 어느 부위든 모양이 같다 */
export interface ScaleFrame {
  kind: ScaleKind;
  /** 가로 기준 길이 (원본 픽셀). yaw에 민감하다 */
  d: number;
  /** 세로 기준 길이 (원본 픽셀). pitch에 민감하다 */
  v: number;
  /** 길이 스케일 √(d·v) */
  s: number;
  /** 면적 스케일 d·v — 병변 면적을 이 값으로 나누면 배율이 사라진다 */
  areaRef: number;
  /** 자의 중심 (얼굴은 코 높이, 몸통은 어깨중점과 골반중점의 가운데) */
  cx: number;
  cy: number;
  /** 면내 회전 (rad). 가로 기준선이 수평이면 0 */
  theta: number;
  /** d / v — 정면성. 사람마다 값이 다르므로 절대 기준이 아니라 기준 세션과의 비교로 쓴다 */
  ratio: number;
  /**
   * 좌우 비대칭 (0 = 완전 대칭). 사람마다 타고난 값이 달라 기준 사진과의 **차이**로만 쓴다.
   * 얼굴은 두 눈에서 코까지의 거리 차, 몸통은 좌우 옆구리 길이 차다.
   */
  asym: number;
  /**
   * 자를 재는 데 필요한 부분이 사진 안에 다 들어왔는지.
   *
   * 얼굴은 항상 true다 — 눈 둘과 입이 보이면 그게 전부고, 그 세 점이 안 보이면 애초에 자가 없다.
   * 몸통은 어깨 두 점과 골반 두 점이 모두 사진 안에 있는지를 본다. 모델은 화면 밖의 관절도
   * 추정해서 내놓기 때문에, 좌표만 보면 늘 값이 있어서 이 확인이 따로 필요하다(torsoFrame.ts).
   */
  complete: boolean;
}

/** 기준 세션이 남기는 자 — 다음 촬영의 자세 비교 기준이 된다 */
export interface ScaleReference {
  areaRef: number;
  ratio: number;
  /** 기준 사진에서의 비대칭 — 타고난 비대칭을 상쇄하는 기준값 */
  asym: number;
}

/**
 * 자세 비교에 필요한 것은 d/v와 비대칭 둘뿐이다.
 * 기준 세션이든 화면에 깔린 지난 사진이든 이것만 있으면 되므로, 어느 쪽을 넘겨도 되도록
 * 필요한 만큼만 요구한다.
 */
export interface PoseReference {
  ratio: number;
  asym: number;
}

export interface ScaleRoi {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 부위마다 다른 것은 이 상수들뿐이다 */
export interface ScaleSpec {
  /** 화면에 쓰는 이름 ("얼굴" / "몸통") */
  noun: string;
  /**
   * 분석에 쓸 정사각형 관심영역의 한 변 (길이 스케일 s의 배수).
   *
   * 얼굴 3.0 — 성인 얼굴의 실측 비례. 눈선-입 60mm · 안간거리 63mm면 s ≈ 61mm이고, 이마 끝에서
   *   턱까지가 약 190mm라 3.0 s ≈ 185mm — 턱과 이마가 겨우 들어오고 좌우로는 여유가 남는다.
   * 몸통 1.6 — 어깨너비 400mm · 어깨~골반 480mm면 s ≈ 438mm이고, 1.6 s ≈ 700mm라 어깨선 위와
   *   골반 아래로 각각 한 뼘씩 여유가 남는다. 얼굴보다 배수가 훨씬 작은 이유는 자 자체가 이미
   *   재려는 부위만 하기 때문이다(얼굴의 자는 얼굴의 3분의 1 크기다).
   */
  roiSide: number;
  /**
   * ROI 중심을 자의 "위쪽"으로 얼마나 밀지 (s의 배수).
   * 얼굴은 세 점의 무게중심이 코 높이라 그대로 두면 이마가 잘린다. 몸통은 어깨중점과 골반중점의
   * 가운데가 곧 몸통의 세로 중심이라 밀 필요가 없다.
   */
  roiUpShift: number;
  /**
   * 프레임 짧은 변 대비 목표 길이 스케일 s — 지난 사진이 없을 때의 촬영 목표.
   *
   * 얼굴 0.24 — 정렬 게이트가 허용하는 최악의 조합에서도 ROI(3s)가 화면을 벗어나지 않는 상한에서
   *   유도했다: 배율 상한 e^0.18 = 1.197, 위치 상한 0.20s ⇒ ROI 반폭 2.035s ≤ 짧은 변의 절반
   *   ⇒ s ≤ 0.246 × 짧은 변. 0.24를 쓴다 (ROI가 짧은 변의 72%).
   * 몸통 0.46 — 가슴/복부(또는 등)만 담는 크기. 유도는 SCALE_SPEC.torso 쪽 주석에 있다.
   */
  targetOfMinSide: number;
  /**
   * 넓이를 재기 위해 필요한 최소 크기 (길이 스케일 s, 원본 픽셀).
   *
   * 배율은 정규화로 사라지지만 **해상도는 사라지지 않는다.** 분석은 ROI를 512 격자로 눌러 넣으므로,
   * s가 작으면 없는 정보를 늘려 놓은 것이 되고 병변 경계가 뭉개진다. 두 값 모두 같은 기준에서
   * 나왔다 — ROI가 360px 밑으로 내려가지 않을 것(512로 1.4배까지만 늘린다):
   *
   *     얼굴  360 / 3.0 = 120px      몸통  360 / 1.6 = 225px
   *
   * ⚠️ 실기기 캘리브레이션 대상 — 실제로 몇 픽셀부터 넓이가 흔들리는지 재서 다시 잡을 것.
   */
  minScalePx: number;
  /** 이 자의 면적 ÷ areaRef — 넓이 지수를 "부위의 몇 %"로 읽을 때 쓴다 (folders/areaTrend) */
  areaOverAreaRef: number;
  gate: ScaleGate;
}

export interface ScaleGate {
  /** 배율 |ln(s/s_target)| 상한 */
  scaleLn: number;
  /** 자세 |ln((d/v)/(d/v)_기준)| 상한 */
  poseLn: number;
  /** 비대칭이 기준 사진과 얼마나 달라졌는지의 상한 */
  asymDelta: number;
  /** 기준 사진이 없을 때만 쓰는 느슨한 절대 상한 */
  asymAbs: number;
  /** 면내 회전 상한 (rad) */
  rotation: number;
  /** 중심 어긋남 상한 (s 대비) */
  offset: number;
}

export const SCALE_SPEC: Record<ScaleKind, ScaleSpec> = {
  face: {
    noun: '얼굴',
    roiSide: 3.0,
    roiUpShift: 0.15,
    targetOfMinSide: 0.72 / 3.0,
    minScalePx: 120,
    /*
      얼굴을 타원으로 보면 이마 끝~턱 190mm × 광대 폭 140mm → π/4 × 190 × 140 ≈ 20,900mm²이고,
      같은 얼굴의 자는 63mm × 60mm = 3,780mm²다. ⇒ 5.5
    */
    areaOverAreaRef: 5.5,
    gate: {
      /**
       * 면적을 d·v로 정규화하면 배율은 계산에서 사라지므로 여기를 조일 이유가 별로 없다.
       * 이 게이트가 남아 있는 이유는 정확도가 아니라 해상도와 프레이밍이다.
       */
      scaleLn: 0.18,
      /**
       * 고개를 각도 θ만큼 돌리면 이 값이 그대로 ln(1/cos θ)다:
       *     0.035 → 15°   0.05 → 18°   0.062 → 20°   0.10 → 25°
       * 검출기의 키포인트 떨림이 d·v에 1% 남짓 들어오므로 그보다 몇 배는 커야 하고, 볼처럼 이미
       * 옆으로 돌아간 면의 병변이 상쇄되지 않기 시작하는 20° 언저리를 못 넘게 잡았다.
       */
      poseLn: 0.05,
      /** 코 옆이동 1mm → 0.024 (3°) · 4mm → 0.096 (12°) · 5mm → 0.120 (14°) */
      asymDelta: 0.12,
      /** 기준 사진이 없을 때 (≈32°) — 옆모습이 기준 사진이 되는 것만 막는다 */
      asymAbs: 0.25,
      rotation: (7 * Math.PI) / 180,
      offset: 0.2,
    },
  },
  torso: {
    noun: '몸통',
    roiSide: 1.6,
    roiUpShift: 0,
    /*
      가슴/복부만 또는 등만 담는 크기다. 어깨 위·골반 아래로 0.5v씩 여유를 두면 세로가 약 2.6v이고,
      3:4 프레임에서 짧은 변은 그 0.75배인 1.95v다. s ≈ 0.84v이므로 구도만 보면 0.43쯤이 목표다.

      그런데 목표를 정하는 것은 구도가 아니라 **게이트가 허용하는 최악의 조합**이다. 그 조합에서도
      ROI가 화면을 벗어나지 않아야 한다 — 벗어나면 "가이드에 맞췄는데 넓이만 조용히 빠지는" 일이
      생기고, 그건 사용자가 원인을 알 수 없는 실패다 (얼굴 가이드가 0.78 → 0.72로 내려간 이유가
      정확히 이것이었다):

          ROI 반폭 = 0.8s × e^0.16 = 0.939s,  위치 = 0.2s × e^0.16 = 0.235s
          합 1.174s ≤ 짧은 변의 절반  ⇒  s ≤ 0.426 × 짧은 변

      0.42를 쓴다 (ROI가 짧은 변의 67%). ⚠️ 게이트(scaleLn·offset)를 건드리면 이 값도 함께
      다시 계산해야 한다 — 셋은 한 덩어리다.
    */
    targetOfMinSide: 0.42,
    minScalePx: 225,
    /*
      몸통 앞면을 사다리꼴로 보면 어깨너비 400mm, 골반너비 ≈ 0.75 × 400mm, 높이 480mm →
      평균너비 350mm × 480mm ≈ 168,000mm²이고, 자는 400 × 480 = 192,000mm²다. ⇒ 0.87 → 0.85

      ⚠️ 얼굴보다 개인차가 크다(체형). 그래도 변화율에는 들어가지 않는다 — 분자·분모에서
         상쇄되기 때문이다(folders/areaTrend의 같은 주석).
    */
    areaOverAreaRef: 0.85,
    gate: {
      /**
       * 몸통은 배율이 계산에서 사라지지 않는다 — 자를 내는 랜드마크 모델이 프레이밍을 탄다.
       * 몸통만 담은 사진에서 게이트 폭을 바꿔 가며 잰 areaRef 퍼짐(15회):
       *
       *     ±16%(ln 0.15) → 32.2%      ±11%(ln 0.10) → 21.3%      ±3% → 11.7%
       *
       * 한때 0.10까지 조였다가 되돌렸다. **조인 만큼 사용자가 통과하지 못했기 때문이다.**
       * 되돌려도 되는 근거가 있다: ±16%에서의 퍼짐 32.2%는 σ ≈ 10.7%이고, 몸통의 변화 문턱은
       * ±44%(2σ = 21%)라 그 잡음을 이미 덮는다. 즉 여기를 조여서 얻는 것은 "문턱 안에서 더
       * 조용한 잡음"뿐인데, 대가는 촬영 실패다 — 사용자가 포기하면 추이 자체가 없다.
       *
       * ⚠️ SIGMA_BY_KIND.torso(0.22)와 짝이다. 문턱을 낮추려면 여기를 먼저 조여야 한다.
       */
      scaleLn: 0.16,
      /**
       * ⚠️ 얼굴(0.05)보다 느슨하다. 위 실측에서 **프레이밍 흔들림만으로 d/v가 3.6%(ln 0.036)**
       * 움직였기 때문이다 — 0.05로 두면 사용자가 정면으로 잘 서 있어도 절반이 잡음에 먹힌다.
       * 0.09는 몸을 약 25° 트는 것에 해당한다. 실기기에서 잡음을 다시 재고 조일 것.
       */
      poseLn: 0.09,
      /** ⚠️ 캘리브레이션 전 추정치. 옆구리 길이 차가 v의 8% = 몸을 15° 남짓 튼 정도 */
      asymDelta: 0.08,
      asymAbs: 0.15,
      /** 얼굴보다 느슨하다 — 몸통은 좌우 어깨 높이가 원래 조금씩 다르다 */
      rotation: (10 * Math.PI) / 180,
      /** 얼굴과 같은 폭. 위 실측의 32.2%가 이 폭(0.2s)까지 흔든 결과라, 따로 조일 근거가 없다 */
      offset: 0.2,
    },
  },
};

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * 사진 한 장이 겨냥한 구도 — 자가 사진의 어디에 얼마나 크게 담겼는지.
 *
 * 픽셀이 아니라 **비율**로 들고 있는 이유: 지난 사진과 지금 프리뷰는 해상도가 다를 수 있다
 * (판정 프레임은 화질을 낮춰 찍고, 기록 사진은 원본 해상도다).
 */
export interface ScaleFraming {
  kind: ScaleKind;
  /** 길이 스케일 s ÷ 프레임 짧은 변 */
  sOfMinSide: number;
  /** 자 중심의 가로·세로 위치 (0~1) */
  cxFrac: number;
  cyFrac: number;
  theta: number;
  ratio: number;
  asym: number;
}

export function framingOf(frame: ScaleFrame, imageW: number, imageH: number): ScaleFraming {
  return {
    kind: frame.kind,
    sOfMinSide: frame.s / Math.min(imageW, imageH),
    cxFrac: frame.cx / imageW,
    cyFrac: frame.cy / imageH,
    theta: frame.theta,
    ratio: frame.ratio,
    asym: frame.asym,
  };
}

export interface AlignTarget {
  s: number;
  cx: number;
  cy: number;
  theta: number;
}

/**
 * 이번 프레임의 정렬 목표를 픽셀 좌표로 만든다.
 *
 * 지난 사진(고스트)이 있으면 **그 사진의 구도가 목표**다. 화면에 그 사진을 그대로 깔아 두고
 * 맞추라고 하면서 게이트는 다른 자리를 재면, 사용자가 눈으로 맞춘 순간에 판정이 실패한다.
 *
 * 목표를 항상 기준 사진 하나로 두는 것이 중요하다. 매번 직전 사진을 목표로 삼으면 회차마다
 * 허용 오차만큼 밀린 구도가 다음 목표가 되어 서서히 흘러간다.
 */
export function alignTargetFor(
  kind: ScaleKind,
  imageW: number,
  imageH: number,
  framing?: ScaleFraming,
): AlignTarget {
  const spec = SCALE_SPEC[kind];
  const minSide = Math.min(imageW, imageH);
  if (framing) {
    return {
      s: minSide * framing.sOfMinSide,
      cx: imageW * framing.cxFrac,
      cy: imageH * framing.cyFrac,
      theta: framing.theta,
    };
  }
  const s = minSide * spec.targetOfMinSide;
  return {
    s,
    cx: imageW / 2,
    /*
      ROI를 위로 미는 보정이 있는 자(얼굴)는 목표 중심이 화면 중앙보다 **아래**여야 ROI가 화면
      한가운데 놓인다. 예전에 이 부호를 반대로 두어 ROI가 이중으로 올라갔고, 가로 화면에서
      정렬은 통과하는데 얼굴이 잘리는 조합이 생겼다.
    */
    cy: imageH / 2 + spec.roiUpShift * s,
    theta: 0,
  };
}

/** 잘라내기 전의 관심영역 — 자를 기준으로만 정해진, 사진 경계를 모르는 사각형 */
function idealRoi(frame: ScaleFrame): { x: number; y: number; side: number } {
  const spec = SCALE_SPEC[frame.kind];
  // 자의 "위" 방향 — 가로 기준선에 수직이고 아래쪽 점에서 멀어지는 쪽
  const upX = Math.sin(frame.theta);
  const upY = -Math.cos(frame.theta);

  const side = spec.roiSide * frame.s;
  const cx = frame.cx + upX * spec.roiUpShift * frame.s;
  const cy = frame.cy + upY * spec.roiUpShift * frame.s;
  return { x: cx - side / 2, y: cy - side / 2, side };
}

/**
 * 분석·품질 측정에 쓸 정사각형 관심영역.
 *
 * **정사각형**인 것이 중요하다. 세그 입력은 프레임을 종횡비를 무시하고 512×512로 눌러 넣는데
 * (extractNormalizedRGB), 그러면 마스크 픽셀 하나가 가리는 실제 넓이가 가로세로로 달라지고
 * 사진 비율이 바뀌면 그 왜곡도 함께 바뀐다. 정사각형을 잘라 넣으면 왜곡이 아예 없다.
 *
 * 사진 밖으로 나가면 밀어 넣고, 그래도 안 들어가면 줄인다 — 그 순간 이 ROI는 더 이상 부위 전체를
 * 담지 못하므로 넓이를 재서는 안 된다. 그 판단은 roiFits가 하고, 부르는 쪽이 반드시 함께 확인한다.
 */
export function roiOf(frame: ScaleFrame, imageW: number, imageH: number): ScaleRoi {
  const { x, y, side } = idealRoi(frame);
  const w = Math.min(side, imageW, imageH);
  return {
    x: Math.max(0, Math.min(imageW - w, x + (side - w) / 2)),
    y: Math.max(0, Math.min(imageH - w, y + (side - w) / 2)),
    width: w,
    height: w,
  };
}

/**
 * 부위 전체가 사진 안에 들어왔는가 — **넓이를 재도 되는지의 전제 조건**이다.
 *
 * 넓이를 d·v로 나누면 배율과 위치가 상쇄되지만, 그건 **병변이 전부 관심영역 안에 있을 때만**
 * 참이다. 화면 밖으로 걸치면 잘려 나간 쪽의 병변은 아예 세어지지 않는데 분모인 d·v는 그대로다 —
 * **병변은 그대로인데 지수만 내려가고, 사용자는 그것을 호전으로 읽는다.** 잘린 채로 재느니 재지 않는다.
 */
export function roiFits(frame: ScaleFrame, imageW: number, imageH: number): boolean {
  const { x, y, side } = idealRoi(frame);
  return x >= 0 && y >= 0 && x + side <= imageW && y + side <= imageH;
}

/**
 * 표준 프레이밍의 관심영역 사각형 (프레임 픽셀 좌표).
 * 화면 가이드와 게이트가 같은 자리를 가리키게 하려고 한 곳에서 만든다.
 */
export function standardRoi(kind: ScaleKind, imageW: number, imageH: number): ScaleRoi {
  const spec = SCALE_SPEC[kind];
  const t = alignTargetFor(kind, imageW, imageH);
  const side = spec.roiSide * t.s;
  return { x: t.cx - side / 2, y: t.cy - spec.roiUpShift * t.s - side / 2, width: side, height: side };
}

export type AlignFault = 'none' | 'scale' | 'offset' | 'rotation' | 'pose';

export interface AlignEvaluation {
  ok: boolean;
  /** 0~1 막대값 — 가장 나쁜 항목을 쓴다 (지금 무엇에 발목 잡혀 있는지를 보여줘야 하므로) */
  gauge: number;
  fault: AlignFault;
  hint: string;
  /** 지금 배율이 목표보다 큰지 작은지 (안내 문구를 "가까이/멀리"로 가르는 데 쓴다) */
  scaleLn: number;
  /**
   * 자세만 따로 뽑은 통과 여부.
   *
   * 얼굴에서는 정렬 항목 넷 중 이것만 성격이 달랐다 — 배율·위치·기울기는 d·v로 나누는 순간
   * 계산에서 사라지므로 측정의 정확도와 무관하다. **몸통은 다르다**: 랜드마크 모델이 프레이밍에
   * 따라 다른 값을 내므로 배율도 측정에 영향을 준다. 그래서 몸통에서는 이 값이 배율까지 함께 본다.
   */
  poseOk: boolean;
  /** 자세를 견준 기준값의 비대칭 (없으면 절대 상한으로 판정했다는 뜻) — 진단 로그용 */
  poseRef: number | null;
}

/**
 * 정렬 판정. 기준 세션의 자(reference)가 있으면 자세 비교까지 하고, 없으면(첫 촬영)
 * 비대칭만으로 정면성을 본다.
 *
 * 이 판정은 **자동 셔터만 막고 촬영 자체는 막지 않는다.** 정렬이 어긋난 사진도 등급 판정에는
 * 아무 문제가 없고, 다만 면적을 회차 간 비교할 수 없을 뿐이다.
 */
export function evaluateAlign(
  frame: ScaleFrame,
  target: AlignTarget,
  reference?: PoseReference,
): AlignEvaluation {
  const spec = SCALE_SPEC[frame.kind];
  const gate = spec.gate;

  const scaleLn = Math.log(frame.s / target.s);
  const offset = Math.hypot(frame.cx - target.cx, frame.cy - target.cy) / frame.s;
  // 목표가 지난 사진이면 그 사진의 기울기가 기준이다 — 지난 사진이 5° 기울어 있는데 수평을
  // 요구하면, 고스트에 맞춘 바로 그 순간에 회전 게이트가 걸린다
  const rotation = Math.abs(normalizeAngle(frame.theta - target.theta));
  const poseLn = reference ? Math.abs(Math.log(frame.ratio / reference.ratio)) : 0;

  const bars = {
    scale: clamp01(1 - Math.abs(scaleLn) / gate.scaleLn),
    offset: clamp01(1 - offset / gate.offset),
    rotation: clamp01(1 - rotation / gate.rotation),
    /*
      자세는 두 지표(d/v, 비대칭) 중 나쁜 쪽이다. 둘 다 **사람마다 다른 값**이라 절대 기준으로
      쓸 수 없고, 반드시 그 사람의 기준 사진과 견줘야 한다. 기준 사진이 없는 첫 촬영에서는 견줄
      상대가 없으므로 정확도를 요구하지 않는다 — 그 사진은 비교 대상이 아니라 기준이 될 사진이라,
      옆모습만 아니면 된다.
    */
    pose: reference
      ? Math.min(
          clamp01(1 - poseLn / gate.poseLn),
          clamp01(1 - Math.abs(frame.asym - reference.asym) / gate.asymDelta),
        )
      : clamp01(1 - frame.asym / gate.asymAbs),
  };

  // 고치면 나머지가 함께 따라오는 순서 — 크기를 맞추면 위치가, 위치가 맞으면 각도가 쉬워진다
  const order: AlignFault[] = ['scale', 'offset', 'rotation', 'pose'];
  const fault = order.find((k) => bars[k as keyof typeof bars] <= 0) ?? 'none';
  const gauge = Math.min(bars.scale, bars.offset, bars.rotation, bars.pose);

  return {
    ok: fault === 'none',
    gauge,
    fault,
    hint: alignHint(frame.kind, fault, scaleLn),
    scaleLn,
    /*
      "넓이를 비교해도 되는가"에 배율을 넣을지가 부위마다 다르다.

      얼굴은 넣지 않는다 — 넓이를 d·v로 나누는 순간 배율이 사라지므로, 앨범에서 고른 사진처럼
      가이드를 볼 기회가 없었던 사진도 자세만 맞으면 잴 수 있다. 몸통은 넣는다: 자를 내는 랜드마크
      모델 자체가 프레이밍에 따라 다른 값을 내기 때문에, 배율이 어긋나면 자가 어긋난 것이다.
    */
    poseOk: frame.kind === 'torso' ? bars.pose > 0 && bars.scale > 0 : bars.pose > 0,
    poseRef: reference?.asym ?? null,
  };
}

/** 각도를 -π/2~π/2로 접는다 — 미러링이나 뒤집힌 검출이 ±π 근처 값을 만들 수 있다 */
function normalizeAngle(theta: number): number {
  let a = theta;
  while (a > Math.PI / 2) a -= Math.PI;
  while (a < -Math.PI / 2) a += Math.PI;
  return a;
}

function alignHint(kind: ScaleKind, fault: AlignFault, scaleLn: number): string {
  const face = kind === 'face';
  switch (fault) {
    case 'scale':
      if (face) {
        return scaleLn < 0 ? '조금 더 가까이 — 가이드에 얼굴을 채워주세요' : '조금 더 멀리 — 얼굴이 가이드보다 커요';
      }
      return scaleLn < 0 ? '조금 더 멀리 — 몸통이 가이드보다 커요' : '조금 더 가까이 — 몸통을 가이드에 채워주세요';
    case 'offset':
      return face ? '얼굴을 가이드 한가운데로 옮겨주세요' : '몸통을 가이드 한가운데로 옮겨주세요';
    case 'rotation':
      return face ? '고개가 기울었어요 — 눈높이를 수평으로' : '몸이 기울었어요 — 양 어깨를 수평으로';
    case 'pose':
      return face ? '정면을 봐주세요 — 고개를 돌리거나 숙이지 말고' : '몸을 정면으로 — 옆으로 틀거나 숙이지 말고';
    default:
      return face ? '가이드에 맞았어요 — 그대로 유지해주세요' : '가이드에 맞았어요 — 그대로 서 계세요';
  }
}

/**
 * 두 기준점에서 자 하나를 만든다 — 얼굴과 몸통이 같은 계산을 쓴다.
 *
 * 하한을 두는 이유: d나 v가 0에 가까우면 뒤이은 나눗셈이 전부 폭주해서, 말도 안 되는 면적 지수가
 * "측정된 값"인 척 기록에 남는다. 못 잰 것은 못 잰 것으로 두는 편이 낫다.
 *
 * @param left  가로 기준선의 한쪽 끝 (얼굴=한쪽 눈, 몸통=한쪽 어깨)
 * @param right 반대쪽 끝
 * @param lower 세로 기준점 (얼굴=입, 몸통=골반 중점)
 * @param asym  좌우 비대칭 지표 (부위마다 재는 법이 다르므로 부르는 쪽이 계산해 넘긴다)
 */
export function scaleFrameOf(
  kind: ScaleKind,
  left: { x: number; y: number },
  right: { x: number; y: number },
  lower: { x: number; y: number },
  asym: number,
  complete = true,
): ScaleFrame | null {
  const ux = (left.x + right.x) / 2;
  const uy = (left.y + right.y) / 2;

  const d = dist(left.x, left.y, right.x, right.y);
  const v = dist(ux, uy, lower.x, lower.y);
  if (!(d > 1) || !(v > 1)) return null;

  const spec = SCALE_SPEC[kind];
  return {
    kind,
    d,
    v,
    s: Math.sqrt(d * v),
    areaRef: d * v,
    /*
      자의 중심. 얼굴은 세 점의 무게중심(코 높이)을 쓰고 ROI를 위로 밀어 보정하지만, 몸통은
      가로 기준선의 중점과 아래 기준점의 **가운데**가 곧 몸통의 세로 중심이라 보정이 필요 없다.
    */
    cx: spec.roiUpShift > 0 ? (left.x + right.x + lower.x) / 3 : (ux + lower.x) / 2,
    cy: spec.roiUpShift > 0 ? (left.y + right.y + lower.y) / 3 : (uy + lower.y) / 2,
    // 좌/우 순서는 미러링으로 뒤집힐 수 있다. 부호가 뒤집혀도 |θ|는 같으므로 기울기 판정에는
    // 영향이 없다 (목표 각도가 0이라 좌우 대칭이다).
    theta: Math.atan2(left.y - right.y, left.x - right.x),
    ratio: d / v,
    asym,
    complete,
  };
}
