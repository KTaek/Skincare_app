import { BodyPartId, PartFacing } from './bodyParts';
import { BodyModelId } from '../three/humanModel';
import type { SkinSource } from './skinMask';
import type { AlignEvaluation, ScaleFrame, ScaleReference } from '../ai/scaleFrame';

/**
 * 세션 간 색 비교를 맞추는 채널별 게인 (v' = gain·v).
 *
 * 기준 세션이 조명의 기준이고, 이후 세션은 "정상 피부가 기준 세션과 같아 보이도록" 하는
 * 게인을 받는다. 사진 파일 자체는 건드리지 않고 모델 입력 텐서에만 적용한다 —
 * 사용자가 보는 기록은 찍은 그대로 남아야 하고, 재인코딩 비용도 들지 않는다.
 */
export interface ColorNormalization {
  gain: [number, number, number];
  /** false면 게인이 [1,1,1]이다 (기준 세션이거나, 정상 피부 표본이 모자라 보정을 포기한 경우) */
  applied: boolean;
}

/** 첫 촬영(기준 세션)이 정하는 이 자리의 기준값 — 이후 세션의 조명 보정이 여기서 나온다 */
export interface Baseline {
  sessionId: string;
  processedUri: string;
  /**
   * 기준 세션 피부 픽셀의 채널별 중앙값 (0~1).
   * 이후 세션은 이 값에 맞추는 게인을 받는다. 중앙값이라 병변이 붉어져도 흔들리지 않으므로
   * 조명 변화만 골라낼 수 있다.
   */
  skinReference: [number, number, number];
  brightness: number;
  /**
   * 얼굴 자리에서만 채워지는 기준 기하 (양눈·입에서 나온다).
   *
   * 배율(areaRef)은 기록용이다 — 면적은 매 회차 자기 사진의 d·v로 나누므로 기준값이 필요 없다.
   * 실제로 비교에 쓰이는 것은 ratio(=d/v)뿐이고, 그것으로 "지난번과 같은 각도인가"를 판정한다.
   * 사람마다 얼굴 비례가 다르기 때문에 이 값은 절대 기준이 될 수 없고 반드시 자기 자신과 비교해야 한다.
   */
  scale?: ScaleReference;
  /**
   * 기준 사진을 어느 카메라로 찍었는지.
   *
   * 전면 카메라는 프리뷰가 좌우 반전돼 보이고 저장본의 반전 여부도 기기마다 다르다. 게다가
   * 렌즈 화각이 후면과 달라 같은 거리에서도 원근 왜곡이 다르다 — 카메라가 바뀌면 고스트가
   * 맞지 않을 뿐 아니라 면적 비교 자체가 성립하지 않는다. 그래서 기준을 남기고 이어찍기에서 잠근다.
   */
  facing?: 'front' | 'back';
}

/**
 * 이번 촬영의 병변 면적 측정값.
 *
 * 프레임 대비 %(maskAreaPct)는 회차 간 비교가 불가능하다 — 10cm 더 가까이 가면 병변이 그대로여도
 * 값이 두 배가 된다. faceAreaIndex는 그 넓이를 얼굴의 d·v로 나눈 값이라 배율이 상쇄된다.
 */
export interface AreaMeasurement {
  /** 병변 넓이 ÷ (안간거리 × 눈-입 거리) × 100. 단위는 없다 */
  faceAreaIndex: number;
  /**
   * 회차 간 비교에 써도 되는 측정인지. false면 기록에는 남기되 추세선에서는 뺀다.
   * 정렬이 어긋났거나, 조명 보정이 한계까지 밀렸거나, 얼굴을 못 찾은 촬영이 여기 걸린다.
   */
  usable: boolean;
  /** usable=false인 이유 (화면에 그대로 보여준다) */
  reason?: string;
}

/** 등록 전 문진에서 받은 질환 정보 */
export interface MonitorDiagnosis {
  /** 피부과 전문의 진단 이력 여부 */
  diagnosed: boolean;
  /**
   * 질환명. 진단 이력이 없으면 등록 시점에는 비어 있고, 결과 화면의 질환 분류 모델이
   * 이름을 알아낸 뒤에 채워진다 (진단 이력이 있으면 모델은 아예 돌리지 않는다).
   */
  disease?: string;
  /** 사용자가 고른 것인지, 분류 모델이 추정한 것인지 */
  source: 'self' | 'model';
  /** 모델 추정일 때의 확률 (0~1) */
  score?: number;
  photoUri?: string;
}

/** 사용자가 3D 모델에서 고른 "계속 지켜볼 자리" */
export interface MonitorTarget {
  id: string;
  modelId: BodyModelId;
  /** 촬영 지점 식별자 (BodySpot.id) — "왼쪽 허리"처럼 부위+면 단위로 구분된다 */
  spotId: string;
  part: BodyPartId;
  facing: PartFacing;
  label: string;
  /** 등록 시 문진 결과 */
  diagnosis?: MonitorDiagnosis;
  createdAt: Date;
  baseline?: Baseline;
  sessionCount: number;
  lastCapturedAt?: Date;
}

/** 촬영 프레임에서 뽑은 원시 지표 */
export interface ImageQualityMetrics {
  /**
   * 대비로 정규화한 라플라시안 분산 (lapVar / grayVar).
   *
   * 생 라플라시안 분산은 "텍스처 양"이라 매끈한 피부 근접샷은 초점이 맞아도 값이 낮게 나온다.
   * 전체 대비로 나누면 콘텐츠 의존성이 크게 줄어, baseline 없이도 절대 임계값을 쓸 수 있다.
   */
  sharpness: number;
  /**
   * RGB가 모두 날아간 픽셀 비율 (0~1) — 사실상 경면반사(번들거림) 검출기다.
   * 채널별 포화와는 다른 현상이라 따로 잰다.
   *
   * ⚠️ 아래 channelClip·shadowClip·brightness와 함께 **피부가 모여 있는 자리 안에서만** 잰다
   *    (skinMask의 SkinBox). 뒤쪽 창문이 하얗게 날아간 것은 피부의 노출과 아무 상관이 없는데,
   *    프레임 전체로 재면 그것만으로 노출 판정이 깨져 촬영 내내 경고가 붙어 있었다.
   *    피부를 못 찾은 프레임에서는 예전처럼 영역 전체를 잰다.
   */
  highlightClip: number;
  /**
   * 채널 하나라도 포화된 픽셀의 최대 비율 (0~1).
   *
   * 이걸 따로 재는 이유: 따뜻한 조명 아래 붉은 피부는 R만 255로 포화되고 G·B는 멀쩡하다.
   * RGB 전부를 보는 highlightClip은 그걸 통째로 놓치는데, 하필 그게 홍반 등급의 실패 모드다.
   * R이 포화되면 "붉음"과 "매우 붉음"이 같은 값이 되어 등급 구분이 물리적으로 불가능해진다.
   */
  channelClip: number;
  /** 검게 뭉갠 픽셀 비율 (0~1) */
  shadowClip: number;
  /** 평균 밝기 (0~1) */
  brightness: number;
  /** 프레임에서 피부가 차지하는 비율 (0~1) */
  skinRatio: number;
  /** 피부 비율을 무엇으로 쟀는지 — 게이트 임계값이 여기에 따라 달라진다 */
  skinSource: SkinSource;
  /** 피부 픽셀의 채널별 중앙값 (0~1) — 조명 보정의 기준 */
  skinMedians: [number, number, number];
  /** 중앙값을 잰 피부 픽셀 수. 0이면 조명 기준으로 쓸 수 없다 */
  skinCount: number;
  /**
   * 프레임을 16×16 흑백으로 압축해 평균 0·크기 1로 정규화한 지문.
   * 직전 프레임의 것과 내적하면 그대로 정규화 상관도가 되어 "화면이 멈췄는지"를 알 수 있다.
   * 한 장 안에서는 알 수 없는 정보라, 단일 촬영 경로에서는 쓰이지 않는다.
   */
  signature: Float32Array;
}

/**
 * 품질 항목 셋 — 촬영이 얼마나 잘 됐는지를 재는 축이다.
 *
 * ⚠️ **이름이 'hard'지만 더 이상 촬영을 막지 않는다.** 예전에는 이 셋이 모두 참이어야 자동
 * 셔터가 열렸는데, 실기기에서 그 구조 자체가 문제였다: 아홉 개 남짓한 조건이 **한 순간에
 * 동시에** 참이어야 했고, 각각이 꽤 자주 통과해도 곱하면 한 틱당 통과율이 바닥으로 내려간다.
 * 그래서 자동 촬영이 사실상 열리지 않았다.
 *
 * 지금은 역할을 갈라 두었다:
 *   · SAFETY (frameQuality) — 셔터를 막는 유일한 조건. 명백한 오촬영만 본다.
 *   · 이 셋            — 신뢰도 점수와 화면 막대·안내 문구의 재료. 막지는 않는다.
 *   · softScore        — 여러 후보 중 **어느 프레임을 채택할지** 고르는 기준.
 *
 * 막던 것을 점수로 바꾼 만큼, 낮은 품질로 찍힌 사실은 반드시 기록에 남아야 한다(scoreConfidence).
 */
export type HardGateKey = 'skin' | 'focus' | 'exposure';

export interface FrameEvaluation {
  metrics: ImageQualityMetrics;
  /** 품질 항목별 충족 여부 — 신뢰도와 화면 표시용이고, 셔터를 막지 않는다 */
  hard: Record<HardGateKey, boolean>;
  hardPass: boolean;
  /**
   * 이 프레임을 촬영해도 되는가 — **자동 셔터를 막는 유일한 조건**이다.
   *
   * 책상·벽·천장을 찍었거나, 거의 암흑이거나, 렌즈가 가려진 수준만 걸러낸다. 그 외에는
   * 전부 통과시키고 품질은 점수로만 남긴다 (frameQuality의 SAFETY 주석 참고).
   */
  safe: boolean;
  /**
   * 권장 조건 세부 점수 (0~1). 통과 여부가 아니라 "얼마나 잘 맞았는지"를 기록한다.
   * 자동 셔터가 여러 후보 중 한 장을 고를 때의 기준이기도 하다.
   */
  /** 직전 프레임과의 상관도 (0~1). 비교할 프레임이 없으면 1 */
  stability: number;
  /**
   * 필수 게이트 셋을 각각 0~1 막대로 보여주기 위한 값.
   * hard가 통과/실패라는 사실만 알려준다면 이쪽은 "얼마나 왔는지"를 알려준다 —
   * 화면에는 막대 하나만 두고 색으로 통과 여부를 표현하므로, 둘이 짝을 이룬다.
   */
  gauges: Record<HardGateKey, number>;
  soft: {
    /** 선명할수록 좋다 */
    sharpness: number;
    /**
     * 직전 프레임과 얼마나 같은 장면인지 (움직이지 않았는지).
     *
     * 예전에는 초점 게이트에 묶여 **촬영을 막는** 조건이었다. 그런데 정지 여부는 프레임 사이에만
     * 있는 정보라, 한 순간의 실패로 통째로 막는 것은 대가가 너무 컸다 — 0.9초 간격으로 비교하는
     * 동안 손이 조금만 움직여도 셔터가 닫혔다. 지금은 점수로만 쓴다: 움직인 프레임은 차단되는
     * 것이 아니라 **후보 경쟁에서 진다.** 창 안에 멈춘 프레임이 하나라도 있으면 그것이 뽑히므로
     * 결과는 같고, 하나도 없을 때 촬영이 아예 안 되는 일만 사라진다.
     */
    stability: number;
    /** 피부가 화면을 채울수록 모델 학습 분포에 가깝다 */
    skin: number;
    brightness: number;
  };
  softScore: number;
  /**
   * 얼굴 정렬 판정 — 얼굴 자리를 찍을 때만 채워지고, 그 외에는 null이다.
   *
   * hard에 넣지 않은 것은 의도적이다. hard에 든 항목은 신뢰도 점수 상한(45점)을 씌우는데,
   * 정렬이 어긋난 사진은 **사진으로서는 아무 문제가 없다** — 등급 판정도 정상적으로 나온다.
   * 어긋난 것은 면적을 지난 회차와 견줄 자격뿐이라, 그 대가는 areaMeasurement.usable로만 치른다.
   */
  align: AlignEvaluation | null;
  /** 이번 프레임에서 찾은 얼굴 기하 — 못 찾았으면 null */
  scale: ScaleFrame | null;
  /**
   * 이 판정을 한 이미지의 크기.
   *
   * 넓이 자격 판정이 "얼굴이 사진 안에 다 들어왔는가"를 확인하려면 경계를 알아야 한다.
   * 얼굴 기하만으로는 알 수 없다 — 눈과 입만 보이면 d와 v는 계산되기 때문이다.
   */
  frameSize: { width: number; height: number };
  /** 화면에 한 줄로 띄울 안내 */
  hint: string;
}

export type ConfidenceTier = 'high' | 'medium' | 'low';

export interface ConfidenceBreakdown {
  focus: number;
  exposure: number;
  /** 피부가 화면을 얼마나 채웠는지 — 모델 입력이 학습 분포에 얼마나 가까운지의 대리 지표 */
  skin: number;
  /** 조명 보정을 얼마나 크게 해야 했는지 (많이 손댈수록 낮다) */
  color: number;
}

export interface SessionConfidence {
  /** 0~100 */
  score: number;
  tier: ConfidenceTier;
  breakdown: ConfidenceBreakdown;
  /** 후처리로도 메우지 못한 문제 — 비어 있지 않으면 재촬영을 권한다 */
  warnings: string[];
  /**
   * false면 재촬영을 권한다.
   *
   * ⚠️ 이름과 달리 지금은 **아무 계산에서도 제외하지 않는다** — 실제로 이 값을 읽는 곳은 리뷰
   *    화면의 권유 문구 하나뿐이다. 촬영 게이트를 걷어내면서 낮은 품질의 기록이 늘어나므로,
   *    추세 계산이 이 이분법 대신 score를 가중치로 쓰도록 바꾸는 것이 다음 숙제다.
   */
  usable: boolean;
}

/**
 * 이 사진이 어떤 경로로 찍혔는지.
 *
 * 자동 셔터가 품질 조건을 더 이상 요구하지 않게 되면서 필요해졌다. 예전에는 "자동으로 찍혔다"가
 * 곧 "조건을 다 만족했다"였지만 이제는 아니다 — 그 사실을 점수만으로는 되살릴 수 없어서 남긴다.
 *
 *   auto     — 목표 점수를 넘겨 채택된 사진 (가장 흔한 경우)
 *   fallback — 시간 안에 목표를 넘긴 프레임이 없어 그때까지의 최선을 채택한 사진.
 *              "영영 안 찍힘"을 없애는 대가로 생긴 경로라, 신뢰도에서 그 사실을 말해야 한다.
 *   manual   — 사용자가 셔터를 직접 누른 사진
 *   album    — 갤러리에서 고른 사진
 */
export type CapturePath = 'auto' | 'fallback' | 'manual' | 'album';

export interface MonitorSession {
  id: string;
  targetId: string;
  capturedAt: Date;
  rawUri: string;
  processedUri: string;
  confidence: SessionConfidence;
  softScore: number;
  /** 이 사진이 어떤 경로로 찍혔는지 — 신뢰도 해석과 재촬영 안내가 여기서 갈린다 */
  capturePath?: CapturePath;
  /**
   * 이 촬영을 기준 세션의 조명에 맞추는 게인. 분석 모델에 넣을 때만 적용하고
   * 사진 자체에는 손대지 않는다. 품질을 재지 못한 촬영에서는 없을 수 있다.
   */
  colorNorm?: ColorNormalization;
  /**
   * 이 촬영에서 찾은 자(얼굴 또는 몸통). 넓이를 재지 않는 자리이거나 못 찾았으면 없다.
   * 분석 단계가 이 값으로 관심영역을 정하고 면적을 정규화한다.
   */
  scale?: ScaleFrame;
  /** 촬영 시점에 이미 알 수 있는 면적 측정 자격 — 정렬·조명이 회차 비교를 견딜 만한지 */
  areaEligible?: AreaEligibility;
}

/**
 * 넓이를 못 잰 이유의 기계가 읽는 이름.
 *
 * 사용자에게 보이는 문장(reason)만 두면 화면이 그 문장을 뒤져서 분기하게 되는데, 그러면 문구를
 * 한 글자 다듬는 순간 조용히 어긋난다. 무엇보다 **고칠 수 있는 이유와 없는 이유가 다르다** —
 * 얼굴을 못 찾은 것은 사진을 잘라 고칠 수 있지만, 해상도·잘림·자세는 자를수록 나빠진다.
 * 그 구분을 화면이 정확히 알아야 엉뚱한 해결책을 권하지 않는다.
 */
export type AreaRejectCode =
  /** 자가 될 자리를 못 찾았다 — 잘라내면 찾을 수 있다 (검출 입력이 작아 멀리 있는 사람을 놓친다) */
  | 'noFace'
  /**
   * 몸통 전용 — 전신이 프레임에 다 담기지 않았다.
   * 잘라서는 못 고친다(오히려 더 잘린다). 뒤로 물러서서 다시 찍어야 한다.
   */
  | 'partialBody'
  /**
   * 부위가 분석 영역에 **너무 적게** 담겼다 (coverageOf가 하한 미만).
   *
   * 조금 잘린 것과는 다르다 — 이마 끝이 살짝 나간 사진은 그대로 측정한다. 여기 걸리는 것은
   * 얼굴의 상당 부분이 없는 사진이라, 세지 못한 병변이 지수를 통째로 끌어내린다.
   */
  | 'cropped'
  /**
   * 담긴 정도가 **기준 회차와 다르다.**
   *
   * 절대량이 아니라 회차 간 차이가 문제인 유일한 코드다. 매번 95%만 담겨도 추이는 성립하지만,
   * 100%였다가 80%가 되면 병변이 그대로여도 지수가 내려간다 — 그 하락은 호전과 구분되지 않는다.
   */
  | 'framingChanged'
  /** 고개가 돌아가거나 숙여졌다 — 사진 편집으로 되돌릴 수 없다 */
  | 'pose'
  /** 조명이 기준 회차와 다르다 — 다시 찍는 수밖에 없다 */
  | 'lighting';

export interface AreaEligibility {
  ok: boolean;
  /** 사용자에게 그대로 보여주는 한 문장 (실패했을 때만) */
  reason?: string;
  code?: AreaRejectCode;
  /**
   * 부위가 분석 영역에 담긴 비율 (0~1). 기준 세션이 이 값을 남겨 다음 회차와 견준다.
   * 자를 못 찾은 촬영에서는 없다.
   */
  covered?: number;
  /**
   * 원본 해상도가 낮아 **넓이가 흔들릴 수 있는** 촬영인지. 값은 그대로 기록된다.
   *
   * 해상도만 이렇게 다루는 이유가 있다. 넓이 지수는 병변 픽셀 ÷ 자²라서 **해상도가 절반이 되면
   * 분자와 분모가 함께 4분의 1이 되어 몫은 그대로다** — 즉 해상도는 값을 틀리게 만들지 않는다.
   * 남는 영향은 둘뿐이고 둘 다 편향이 아니라 잡음이다: 마스크 경계의 양자화, 그리고 아주 작은
   * 병변이 뭉개져 사라지는 것.
   *
   * 나머지 자격 조건은 성격이 다르다 — 부위가 잘리면 병변이 통째로 빠지고, 몸이 돌아가면 투영이
   * 바뀌며, 조명이 다르면 경계가 한쪽으로 밀린다. 전부 **방향이 정해진** 오차라 호전/악화로
   * 읽히므로 재지 않는 편이 낫다. 해상도는 그 무리에 끼지 않는다.
   *
   * 그래서 제외하지 않고 **표시만 한다.** 이 표시는 기록까지 따라간다(lesionAreaLowRes) —
   * 흔들릴 수 있는 값이라는 사실은 그 값을 읽는 자리에서 알아야 의미가 있지, 촬영 화면에서
   * 한 번 말하고 잊으면 아무 소용이 없다.
   */
  lowRes?: boolean;
}
