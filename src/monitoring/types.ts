import { BodyPartId, PartFacing } from './bodyParts';
import { BodyModelId } from '../three/humanModel';
import type { SkinSource } from './skinMask';
import type { AlignEvaluation, FaceFrame, FaceReference } from '../ai/faceFrame';

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
  face?: FaceReference;
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
 * 필수 게이트 — "후처리로 되돌릴 수 없고, 사용자가 그 자리에서 고칠 수 있고,
 * 기준이 시간에 따라 변하지 않는 것"만 남겼다.
 *
 * 뺀 것:
 *   · recoverable(거리·각도) — 면적 측정을 걷어내면서 맞출 이유가 사라졌다
 *   · framing(구도) — 병변 크기를 기준으로 삼고 있었는데, 병변이 없는 정상 피부는 영영 통과할 수
 *     없고 병변이 작아지면(호전) 게이트에 걸린다. 변하는 대상을 기준으로 쓸 수 없다.
 */
export type HardGateKey = 'skin' | 'focus' | 'exposure';

export interface FrameEvaluation {
  metrics: ImageQualityMetrics;
  /** 필수 조건 통과 여부 — 후처리로 되돌릴 수 없는 것들만 본다 */
  hard: Record<HardGateKey, boolean>;
  hardPass: boolean;
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
    /** 필수 하한을 넘긴 뒤로도 더 선명할수록 좋다 */
    sharpness: number;
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
  face: FaceFrame | null;
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
  /** false면 추세 계산에서 제외하고 재촬영을 안내 */
  usable: boolean;
}

export interface MonitorSession {
  id: string;
  targetId: string;
  capturedAt: Date;
  rawUri: string;
  processedUri: string;
  confidence: SessionConfidence;
  softScore: number;
  /**
   * 이 촬영을 기준 세션의 조명에 맞추는 게인. 분석 모델에 넣을 때만 적용하고
   * 사진 자체에는 손대지 않는다. 품질을 재지 못한 촬영에서는 없을 수 있다.
   */
  colorNorm?: ColorNormalization;
  /**
   * 이 촬영에서 찾은 얼굴 기하. 얼굴 자리가 아니거나 못 찾았으면 없다.
   * 분석 단계가 이 값으로 관심영역을 정하고 면적을 정규화한다.
   */
  face?: FaceFrame;
  /** 촬영 시점에 이미 알 수 있는 면적 측정 자격 — 정렬·조명이 회차 비교를 견딜 만한지 */
  areaEligible?: { ok: boolean; reason?: string };
}
