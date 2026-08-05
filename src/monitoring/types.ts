import { BodyPartId, PartFacing } from './bodyParts';
import { BodyModelId } from '../three/humanModel';

/** RGB 채널별 평균/표준편차 (0~1 스케일) — 세션 간 색 정규화의 기준값 */
export interface ColorStats {
  mean: [number, number, number];
  std: [number, number, number];
}

/** 첫 촬영(기준 세션)이 만들어내는 "정규 좌표계" — 이후 모든 세션은 여기에 맞춰 정합·색보정된다 */
export interface Baseline {
  sessionId: string;
  processedUri: string;
  /** 기준 세션 "원본 사진"에서의 병변 주축 방향 (라디안). 다음 촬영의 각도 게이트 기준이 된다 */
  orientation: number;
  /** 원본 대비 병변 반지름 비율 (radiusPx / min(W,H)) — 촬영 거리 가이드와 화각 기준에 쓴다 */
  radiusNorm: number;
  colorStats: ColorStats;
  brightness: number;
}

/** 등록 전 문진에서 받은 질환 정보 */
export interface MonitorDiagnosis {
  /** 피부과 전문의 진단 이력 여부 */
  diagnosed: boolean;
  disease: string;
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
  /** 라플라시안 분산 — 클수록 선명 */
  sharpness: number;
  /** 흰색으로 날아간 픽셀 비율 (0~1) */
  highlightClip: number;
  /** 검게 뭉갠 픽셀 비율 (0~1) */
  shadowClip: number;
  /** 평균 밝기 (0~1) */
  brightness: number;
  channelMeans: [number, number, number];
}

export type HardGateKey = 'focus' | 'framing' | 'exposure' | 'recoverable';

export interface FrameEvaluation {
  metrics: ImageQualityMetrics;
  /** 필수 조건 통과 여부 — 후처리로 되돌릴 수 없는 것들만 본다 */
  hard: Record<HardGateKey, boolean>;
  hardPass: boolean;
  /** 권장 조건 세부 점수 (0~1). 통과 여부가 아니라 "얼마나 잘 맞았는지"를 기록한다 */
  soft: {
    alignment: number;
    distance: number;
    angle: number;
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
  framing: number;
  registration: number;
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

/** 정합에 실제로 적용한 변환 — 얼마나 크게 보정했는지가 곧 신뢰도 근거가 된다 */
export interface RegistrationTransform {
  scale: number;
  rotationRad: number;
  translation: { x: number; y: number };
  /** 기준 세션이 없어서 이번 촬영이 기준이 된 경우 */
  isBaseline: boolean;
}

export interface PostProcessResult {
  processedUri: string;
  registration: RegistrationTransform;
  /** 적용한 채널별 게인/오프셋 */
  colorGain: [number, number, number];
  colorOffset: [number, number, number];
  /** 보정 결과 이미지의 색 통계 — 다음 세션의 기준이 된다 */
  resultStats: ColorStats;
  resultOrientation: number;
  confidence: SessionConfidence;
}

export interface MonitorSession {
  id: string;
  targetId: string;
  capturedAt: Date;
  rawUri: string;
  processedUri: string;
  confidence: SessionConfidence;
  softScore: number;
}
