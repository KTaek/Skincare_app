import { BodyPartId, PartFacing } from './bodyParts';
import { BodyModelId } from '../three/humanModel';
import type { SkinSource } from './skinMask';

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
}
