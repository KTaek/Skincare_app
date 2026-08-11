/**
 * 넓이를 재는 **자(ruler)** — 얼굴과 몸통이 함께 쓰는 한 겹.
 *
 * 병변 면적을 회차 간 비교하려면 촬영 거리를 지워야 하고, 그러려면 시간에 따라 변하지 않는 기준
 * 길이가 필요하다. 병변 자체는 변하므로 기준이 될 수 없고(그래서 병변 크기를 쓰던 구도 게이트가
 * frameQuality.ts에서 걷어내졌다), 남는 것은 뼈뿐이다:
 *
 *     얼굴 — d = 안간거리,   v = 눈선 중점→입   (두개골).      면적의 자는 d·v
 *     몸통 — d = 어깨너비                        (견봉간거리).  면적의 자는 d²
 *
 * 얼굴이 d·v를 쓰는 이유: 고개를 돌리거나 숙이면 d와 v가 서로 다른 방향으로 짧아지므로 곱이
 * 두 단축을 부분적으로 상쇄하고, 덤으로 **d/v 비율 자체가 자세를 재는 눈금**이 된다.
 *
 * 몸통이 d² 하나로 가는 이유는 그 이점보다 대가가 컸기 때문이다. v(어깨중점→골반중점)는 몸통
 * 전체를 가로질러서, **골반이 프레임을 벗어나는 순간 자가 통째로 추정값이 된다** — 그런데 사용자가
 * 등이나 가슴을 찍는 자연스러운 구도는 거의 예외 없이 골반이 밖이다. 자세 눈금은 어깨의 깊이
 * 차(poseDetector의 shoulderDz)로 대신한다. 자세한 근거와 대가는 ai/torsoFrame.ts 파일 주석에 있다.
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
  /** 자의 중심 (얼굴은 코 높이, 몸통은 어깨선 아래 0.5d — 등·가슴 한가운데) */
  cx: number;
  cy: number;
  /** 면내 회전 (rad). 가로 기준선이 수평이면 0 */
  theta: number;
  /** d / v — 정면성. 사람마다 값이 다르므로 절대 기준이 아니라 기준 세션과의 비교로 쓴다 */
  ratio: number;
  /**
   * 좌우 비대칭 (0 = 완전 대칭). 사람마다 타고난 값이 달라 기준 사진과의 **차이**로만 쓴다.
   * 얼굴은 두 눈에서 코까지의 거리 차, 몸통은 좌우 어깨의 깊이 차 ÷ 어깨너비(≈ sin θ)다.
   */
  asym: number;
  /**
   * 자를 재는 데 필요한 부분이 사진 안에 다 들어왔는지.
   *
   * 얼굴은 항상 true다 — 눈 둘과 입이 보이면 그게 전부고, 그 세 점이 안 보이면 애초에 자가 없다.
   * 몸통은 **어깨 두 점**이 사진 안에 있고 visibility가 충분한지를 본다(골반은 자에서 빠졌다).
   * 모델은 화면 밖의 관절도 추정해서 내놓기 때문에, 좌표만 보면 늘 값이 있어서 이 확인이
   * 따로 필요하다(torsoFrame.ts).
   */
  complete: boolean;
  /**
   * 검출기가 직접 준 부위 상자 (원본 픽셀). 얼굴에서만 채워진다.
   *
   * 왜 키포인트에서 유도하지 않고 이걸 쓰는가 — "부위가 사진에 얼마나 담겼나"(coverageOf)를
   * 재려면 부위의 실제 범위가 필요한데, 그것을 눈·입 세 점에서 유도하려면 **비례 상수**를
   * 거쳐야 한다(bodySpan). 그 상수는 성인 얼굴에서 나왔고 **아이 얼굴에는 잘 맞지 않는다** —
   * 아기는 머리가 크고 이목구비가 아래쪽에 몰려 있어서, 같은 눈·입 간격이라도 얼굴이 훨씬
   * 위로 넓다. 이 앱에서 얼굴 넓이를 재는 대상이 대개 아이라는 점을 생각하면 그 오차를 안고
   * 갈 이유가 없다. 검출 상자는 그 사진의 그 얼굴을 직접 잰 값이라 비례 가정이 없다.
   *
   * 없으면 bodySpan 타원으로 근사한다 (몸통, 또는 상자를 못 받은 경우).
   */
  box?: ScaleRoi;
}

/** 기준 세션이 남기는 자 — 다음 촬영의 자세 비교 기준이 된다 */
export interface ScaleReference {
  areaRef: number;
  ratio: number;
  /** 기준 사진에서의 비대칭 — 타고난 비대칭을 상쇄하는 기준값 */
  asym: number;
  /**
   * 기준 사진에서 부위가 분석 영역에 담긴 비율 (coverageOf).
   *
   * 넓이 추이에서 **절대적으로 중요한 것은 100%가 아니라 회차마다 같은 값**이라는 점이다.
   * 매번 얼굴의 95%만 담겼다면 넓이 지수는 매번 같은 만큼 작게 나오고, 변화율에서는 그
   * 계통 오차가 상쇄된다. 반대로 1회차에 100%, 2회차에 80%면 병변이 그대로여도 지수가
   * 내려가고 사용자는 그것을 호전으로 읽는다. 그래서 기준값을 남겨 다음 회차와 견준다.
   */
  covered?: number;
  /**
   * 기준 사진에서 자가 화면 짧은 변의 몇 배였는지 (= framingOf의 sOfMinSide).
   *
   * **몸통에서만 실제로 쓰인다.** 얼굴은 넓이를 d·v로 나누는 순간 배율이 계산에서 사라지지만,
   * 몸통의 자는 사람 전체를 보는 랜드마크 모델에서 나와 프레이밍을 탄다 — 촬영 거리가 달라지면
   * 같은 몸인데 어깨너비가 다르게 측정된다. 그 편향은 **매번 같은 거리에서 찍으면 상쇄되므로**,
   * 표준 구도가 아니라 이 기준값과 견주는 것이 옳다.
   */
  sOfMinSide?: number;
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
   * 몸통 1.3 — 몸통의 s는 어깨너비 d 그 자체다. 400mm 기준 520mm 정사각형으로, 어깨선 위
   *   0.15d부터 아래 1.15d(허리 언저리)까지 덮는다. 얼굴보다 배수가 훨씬 작은 이유는 자 자체가
   *   이미 재려는 부위만 하기 때문이다(얼굴의 자는 얼굴의 3분의 1 크기다).
   */
  roiSide: number;
  /**
   * ROI 중심을 자의 "위쪽"으로 얼마나 밀지 (s의 배수).
   * 얼굴은 세 점의 무게중심이 코 높이라 그대로 두면 이마가 잘린다. 몸통은 자의 중심이 이미
   * 어깨선 아래 0.5d — 분석 창의 한가운데 — 라 밀 필요가 없다.
   */
  roiUpShift: number;
  /**
   * 프레임 짧은 변 대비 목표 길이 스케일 s — 지난 사진이 없을 때의 촬영 목표.
   *
   * 얼굴 0.24 — 정렬 게이트가 허용하는 최악의 조합에서도 ROI(3s)가 화면을 벗어나지 않는 상한에서
   *   유도했다: 배율 상한 e^0.18 = 1.197, 위치 상한 0.20s ⇒ ROI 반폭 2.035s ≤ 짧은 변의 절반
   *   ⇒ s ≤ 0.246 × 짧은 변. 0.24를 쓴다 (ROI가 짧은 변의 72%).
   * 몸통 0.48 — 가슴/복부(또는 등)만 담는 크기. 유도는 SCALE_SPEC.torso 쪽 주석에 있다.
   *   ⚠️ 몸통에서 이 값은 **화면 가이드용일 뿐 넓이 자격을 가르지 않는다** — 그쪽은 기준 회차와
   *   견준다(frameQuality의 areaScaleLn).
   */
  targetOfMinSide: number;
  /**
   * 이 아래로 내려가면 넓이가 **흔들릴 수 있다고 표시**하는 선 (길이 스케일 s, 원본 픽셀).
   *
   * ⚠️ **측정을 막지 않는다.** 넓이 지수는 병변 픽셀 ÷ 자²라서 해상도가 절반이 되면 분자와
   *    분모가 함께 4분의 1이 되어 몫은 그대로다 — 해상도는 값을 틀리게 만들지 않고 흔들리게만
   *    한다. 그래서 제외 사유에서 빼고(AreaRejectCode에 'resolution'이 없다) 기록에 표시만
   *    남긴다(lesionAreaLowRes). 아래 유도는 그 표시선을 어디에 둘지의 근거다 —
   *    ROI가 360px 밑으로 내려가지 않을 것(512로 1.4배까지만 늘린다):
   *
   *     얼굴  360 / 3.0 = 120px      몸통  260 / 1.3 = 200px (배율 상한이 다르다 — torso 주석)
   *
   * ⚠️ 실기기 캘리브레이션 대상 — 실제로 몇 픽셀부터 넓이가 흔들리는지 재서 다시 잡을 것.
   */
  minScalePx: number;
  /** 이 자의 면적 ÷ areaRef — 넓이 지수를 "부위의 몇 %"로 읽을 때 쓴다 (folders/areaTrend) */
  areaOverAreaRef: number;
  /**
   * 재려는 부위 자체의 크기 (길이 스케일 s의 배수) — **이 부위가 사진에 얼마나 담겼는지**를
   * 재는 타원의 지름이다. ROI(roiSide)와는 다른 값이다: ROI는 여백까지 포함한 분석 사각형이고,
   * 이쪽은 병변이 실제로 있을 수 있는 살의 범위다.
   *
   * 얼굴 — 이마 끝~턱 190mm × 광대 폭 140mm, s ≈ 61.5mm ⇒ 3.09 × 2.28
   * 몸통 — 분석 창 안의 몸통. s = 어깨너비이므로 ⇒ 1.1 × 1.0 (torso 쪽 주석 참고)
   *
   * 타원으로 두는 것은 근사지만, 이 값의 오차는 **변화율에 들어가지 않는다** — 회차마다 같은
   * 타원을 쓰므로 "얼마나 담겼나"의 회차 간 비교에는 그대로 유효하다.
   */
  bodySpan: { w: number; h: number };
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
    bodySpan: { w: 2.28, h: 3.09 },
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
    /*
      ⚠️ 몸통의 s는 **어깨너비 d 그 자체**다 (torsoFrame이 v = d인 가상의 아래 점을 넣는다).
         아래 배수들은 전부 어깨너비의 배수로 읽어야 한다 — 예전 자(√(d·v))와 숫자를 비교하면 안 된다.

      1.3 — 어깨너비 400mm 기준 520mm 정사각형. 자의 중심이 어깨선 아래 0.5d라 위로 0.15d(어깨선
      위 한 뼘), 아래로 1.15d(허리 언저리)까지 덮는다. 등·가슴을 담기에 충분하고, 그 이상 키우면
      ROI가 화면을 벗어나 정작 찍을 수 있는 구도가 줄어든다.
    */
    roiSide: 1.3,
    // 자의 중심이 이미 몸통 한가운데(어깨선 아래 0.5d)라 밀 필요가 없다
    roiUpShift: 0,
    /*
      화면 가이드와 자동 셔터가 유도하는 목표 크기다. **넓이 자격은 이 값으로 판정하지 않는다** —
      그쪽은 기준 회차의 구도와 견준다(frameQuality의 areaScaleLn). 사용자가 등을 찍는 구도는
      실제로 0.49~0.75까지 퍼져 있어서, 표준 하나를 정해 놓고 거기서 벗어났다고 측정을 빼면
      멀쩡한 사진이 전부 탈락한다.

      값은 게이트가 허용하는 최악의 조합에서도 ROI가 화면 안에 남도록 잡는다:

          ROI 반폭 = 0.65s × e^0.16 = 0.763s,  위치 = 0.2s × e^0.16 = 0.235s
          합 0.998s ≤ 짧은 변의 절반  ⇒  s ≤ 0.50 × 짧은 변

      0.48을 쓴다 (ROI가 짧은 변의 62%).
    */
    targetOfMinSide: 0.48,
    /*
      ROI가 260px 밑으로 내려가지 않을 것 — ROI = 1.3d이므로 260 / 1.3 = 200.

      얼굴(512로 1.4배까지)보다 느슨한 2배까지 허용한다. 근거는 병변의 생김새다: 몸통에 나는
      것(건선 판, 발진 무리)은 얼굴 병변보다 크고 경계가 뭉툭해서, 같은 배율 손실에서 넓이
      오차가 훨씬 작다. 얼굴 기준을 그대로 옮기면 **웹이나 메신저를 거쳐 400~500px로 줄어든
      사진이 전부 탈락한다** — 화면을 가득 채운 사진에 "더 크게 찍으라"고 말하게 되고, 앨범
      사진에는 그럴 방법조차 없다.

      ⚠️ 캘리브레이션 대상. 같은 몸통을 원본·축소본으로 나란히 재서 넓이가 실제로 몇 픽셀부터
         흔들리는지 확인할 것 — 제외될 때마다 개발 콘솔에 실제 s가 찍힌다.
    */
    minScalePx: 200,
    /*
      몸통 앞면을 사다리꼴로 보면 어깨너비 400mm, 골반너비 ≈ 0.75 × 400mm, 높이 480mm →
      평균너비 350mm × 480mm ≈ 168,000mm²이고, 자는 이제 d² = 400 × 400 = 160,000mm²다. ⇒ 1.05

      ⚠️ 얼굴보다 개인차가 크다(체형). 그래도 변화율에는 들어가지 않는다 — 분자·분모에서
         상쇄되기 때문이다(folders/areaTrend의 같은 주석).
    */
    areaOverAreaRef: 1.05,
    /*
      ROI가 실제로 덮는 창(어깨선 위 0.15d ~ 아래 1.15d) 안의 몸통을 근사한 타원이다.
      몸통 전체(어깨~골반 1.2d)가 아니라 **분석 창 안의 몸통**을 쓰는 이유: 이 창 아래로는
      애초에 분석하지 않으므로, 거기까지 요구하면 표준 구도에서도 covered가 1에 못 미친다.

      ROI 반폭 0.65d에 대해 이 타원의 반축은 0.5d × 0.55d — 15~23% 여유가 있어서, 표준 구도는
      1.0이 나오고 프레임이 실제로 ROI를 자를 때만 떨어진다. 몸통에서 covered는 얼굴처럼 조이는
      게이트가 아니라 **명백한 잘림만 잡는 안전망**이다 (몸통의 진짜 위험은 자 쪽에 있었다).
    */
    bodySpan: { w: 1.0, h: 1.1 },
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
       * ⚠️ **어깨만 쓰는 자에서는 이 값이 동작하지 않는다.** d/v가 항상 1이라 비율 비교가
       * 상수끼리의 비교가 되어 언제나 통과한다. 비틀림 판정은 아래 asym(어깨 깊이 차)이 맡는다.
       * 골반을 되살리게 되면 다시 의미가 생기므로 지우지 않고 남겨 둔다.
       */
      poseLn: 0.09,
      /*
        비틀림 지표가 바뀌었다 — 옆구리 길이 차에서 **어깨 좌우의 깊이 차 ÷ 어깨너비**로.
        몸을 θ만큼 틀면 이 값이 대략 sin θ다:

            0.17 ≈ 10°    0.26 ≈ 15°    0.42 ≈ 25°    0.50 ≈ 30°

        느슨하게 잡는 데는 근거가 있다. 25°까지 틀어도 넓이 오차는 1/cos²25° = 1.22로 몸통의
        변화 문턱(±44%) 안에 머물고, BlazePose의 z는 x·y보다 부정확해서 조여 봐야 잡음을
        거를 뿐이다. 여기서 막아야 하는 것은 "옆으로 돌아선 사진"이지 몇 도의 흔들림이 아니다.

        ⚠️ 둘 다 캘리브레이션 전 값이다. 실기기에서 정면·비스듬 사진의 asym 분포를 보고 잡을 것.
      */
      asymDelta: 0.2,
      asymAbs: 0.5,
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
  /*
    자의 "위" 방향 — 가로 기준선에 수직이고 아래쪽 점에서 멀어지는 쪽.

    접은 각도를 쓴다. 생 theta는 두 점의 순서에 따라 π만큼 달라질 수 있는데, 그러면 이 벡터가
    통째로 뒤집혀 ROI가 위가 아니라 **아래로** 밀린다 — 얼굴에서는 이마 대신 목이 담긴다.
  */
  const tilt = tiltOf(frame);
  const upX = Math.sin(tilt);
  const upY = -Math.cos(tilt);

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

/** 가시 범위를 재는 표본 격자의 한 변 — 타원 안 픽셀만 세므로 실제 표본은 이보다 적다 */
const COVERAGE_GRID = 32;

/**
 * **부위가 분석 영역에 얼마나 담겼는가** (0~1). 넓이를 재도 되는지를 가르는 연속값이다.
 *
 * 왜 roiFits(예/아니오)로는 부족한가. roiFits는 여백까지 포함한 3s 사각형이 사진 안에 통째로
 * 들어올 것을 요구한다. 그런데 얼굴을 가득 채워 찍은 사진 — 아이 얼굴 근접 촬영이 대개 그렇다 —
 * 은 이마 위나 귀 바깥이 조금 잘리면서 그 사각형을 벗어난다. 실제로 잘린 것은 머리카락과
 * 배경인데 넓이 측정이 통째로 빠진다. **얼굴은 거의 다 나왔는데 "얼굴이 잘렸다"고 말하는 것이다.**
 *
 * 그래서 사각형이 아니라 **살 자체**(bodySpan 타원)가 분석 영역에 얼마나 들어왔는지를 잰다.
 * 이마 끝 5%가 잘린 사진은 0.95가 나오고, 얼굴 절반이 나간 사진은 0.5가 나온다 — 그 둘을
 * 같은 실패로 묶지 않는 것이 요점이다.
 *
 * ROI를 기준으로 재는 것(사진이 아니라)이 중요하다. roiOf는 사각형이 사진 밖으로 나가면 밀어
 * 넣고 그래도 안 되면 줄이므로, **사진에는 보이는데 분석에는 안 들어간 살**이 생길 수 있다.
 * 세그가 실제로 본 범위가 ROI라, 병변이 세어졌는지를 결정하는 것도 ROI다.
 *
 * @param roi 분석에 실제로 쓰는 영역 (roiOf의 결과 — 이미 사진 안으로 잘려 있다)
 */
export function coverageOf(frame: ScaleFrame, roi: ScaleRoi): number {
  // 검출기가 상자를 준 경우(얼굴) — 비례 가정 없이 겹친 넓이를 그대로 잰다
  if (frame.box) {
    const x0 = Math.max(frame.box.x, roi.x);
    const y0 = Math.max(frame.box.y, roi.y);
    const x1 = Math.min(frame.box.x + frame.box.width, roi.x + roi.width);
    const y1 = Math.min(frame.box.y + frame.box.height, roi.y + roi.height);
    const overlap = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
    const area = frame.box.width * frame.box.height;
    return area > 0 ? Math.min(1, overlap / area) : 0;
  }

  const spec = SCALE_SPEC[frame.kind];
  const tilt = tiltOf(frame);
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);

  // 타원의 중심은 ROI와 같은 자리다 — 얼굴은 자의 중심(코 높이)에서 위로 밀어야 얼굴 한가운데다
  const cx = frame.cx + s * spec.roiUpShift * frame.s;
  const cy = frame.cy - c * spec.roiUpShift * frame.s;
  const rw = (spec.bodySpan.w * frame.s) / 2;
  const rh = (spec.bodySpan.h * frame.s) / 2;

  let inside = 0;
  let total = 0;
  for (let j = 0; j < COVERAGE_GRID; j++) {
    const v = ((j + 0.5) / COVERAGE_GRID) * 2 - 1;
    for (let i = 0; i < COVERAGE_GRID; i++) {
      const u = ((i + 0.5) / COVERAGE_GRID) * 2 - 1;
      if (u * u + v * v > 1) continue; // 타원 밖 — 부위가 아니다
      total += 1;
      // 부위 좌표 → 이미지 좌표 (타원 반지름을 곱하고 기울기를 얹는다)
      const lx = u * rw;
      const ly = v * rh;
      const px = cx + lx * c - ly * s;
      const py = cy + lx * s + ly * c;
      if (px >= roi.x && px <= roi.x + roi.width && py >= roi.y && py <= roi.y + roi.height) inside += 1;
    }
  }
  return total > 0 ? inside / total : 0;
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
    /*
      "넓이를 비교해도 되는가"에는 자세만 넣는다.

      한때 몸통에는 배율(bars.scale)도 함께 넣었다. 근거는 옳았다 — 몸통의 자를 내는 랜드마크
      모델은 프레이밍을 타므로 배율이 어긋나면 자도 어긋난다. 틀린 것은 **무엇과 견주느냐**였다:
      bars.scale은 표준 구도와의 차이인데, 정작 측정을 망치는 것은 표준에서 벗어난 것이 아니라
      **기준 회차와 달라진 것**이다. 매번 같은 거리에서 찍으면 표준에서 얼마나 벗어났든 자는
      일관되고, 변화율에서 그 편향이 상쇄된다.

      그래서 배율 비교는 기준 회차와 견주는 자리로 옮겼다(frameQuality의 areaScaleLn).
      실제 사용자가 등을 찍는 구도가 화면의 0.49~0.75까지 퍼져 있어서, 표준 하나를 정해 두고
      거기서 벗어났다고 측정을 빼면 첫 촬영부터 거의 전부 탈락한다.
    */
    poseOk: bars.pose > 0,
    poseRef: reference?.asym ?? null,
  };
}

/**
 * 자의 면내 기울기 — ±90°로 접은 값.
 *
 * **기울기를 실제로 되돌리는 쪽에서는 반드시 이 값을 써야 한다.** 생 theta는 가로 기준선의 두
 * 점을 어느 순서로 넣었느냐에 따라 0 근처일 수도 π 근처일 수도 있고, 그 순서는 전면 카메라의
 * 미러링이나 검출기 규약에 따라 뒤집힌다. 판정에만 쓸 때는 |θ|가 같아서 문제가 없었지만,
 * 크롭을 그 각도로 돌리는 순간 π의 차이는 **사진이 뒤집히는 것**이 된다.
 */
export function tiltOf(frame: ScaleFrame): number {
  return normalizeAngle(frame.theta);
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
  /** 검출기가 직접 준 부위 상자 — 있으면 가시 범위 판정이 비례 가정 없이 이뤄진다 */
  box?: ScaleRoi,
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
    box,
  };
}
