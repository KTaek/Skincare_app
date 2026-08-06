import { BodyPartId, PartFacing } from './bodyParts';

/**
 * 병변 면적 추적용 단순 8부위. minji의 3D 모델(20개 세부부위 × 앞/뒤)을
 * 앞면 6부위 + 뒷면 2부위로 묶는다.
 *   앞: 얼굴 · 몸통 · 왼팔 · 오른팔 · 왼다리 · 오른다리
 *   뒤: 등(몸통 뒤) · 등밑에 다리(양 다리 뒤를 한 부위로)
 * 팔은 앞/뒤 구분 없이 왼팔/오른팔로, 다리는 앞=왼/오른다리·뒤=등밑에다리로 간다.
 */
export type AreaRegionId =
  | 'face'
  | 'torso'
  | 'leftArm'
  | 'rightArm'
  | 'leftLeg'
  | 'rightLeg'
  | 'back'
  | 'backLegs';

export const AREA_REGION_LABELS: Record<AreaRegionId, string> = {
  face: '얼굴',
  torso: '몸통',
  leftArm: '왼팔',
  rightArm: '오른팔',
  leftLeg: '왼다리',
  rightLeg: '오른다리',
  back: '등',
  backLegs: '등밑에 다리',
};

const LEFT_ARM: BodyPartId[] = ['leftUpperArm', 'leftElbow', 'leftForearm', 'leftHand'];
const RIGHT_ARM: BodyPartId[] = ['rightUpperArm', 'rightElbow', 'rightForearm', 'rightHand'];
const LEFT_LEG: BodyPartId[] = ['leftThigh', 'leftKnee', 'leftShank', 'leftFoot'];
const RIGHT_LEG: BodyPartId[] = ['rightThigh', 'rightKnee', 'rightShank', 'rightFoot'];
const TORSO: BodyPartId[] = ['chest', 'abdomen'];

/** 부위가 선택됐을 때 3D 모델에서 함께 밝힐 세부부위들 (Body3DView highlightParts) */
export const AREA_REGION_PARTS: Record<AreaRegionId, BodyPartId[]> = {
  face: ['head', 'neck'],
  torso: TORSO,
  back: TORSO,
  // 모델을 정면으로 마주 볼 때, 마주 본 사람 기준의 왼/오른 = 화면상 좌우가 뒤집힌다.
  // 그래서 화면-왼쪽(=모델 left* 파트)이 '오른팔/오른다리', 화면-오른쪽이 '왼팔/왼다리'.
  leftArm: RIGHT_ARM,
  rightArm: LEFT_ARM,
  leftLeg: RIGHT_LEG,
  rightLeg: LEFT_LEG,
  backLegs: [...LEFT_LEG, ...RIGHT_LEG],
};

/** SkinAI2 규격 촬영(TrackingFlow)이 기대하는 body_site 형태 */
export interface AreaBodySite {
  part: string;
  side: 'left' | 'right' | null;
  /** 거리불변 측정용 기준물 (없으면 피부 기준 area_ratio 모드) */
  ref: string | null;
  ref_mode: 'circle' | 'length' | null;
}

/** 8부위 → 촬영 화면 body_site. 얼굴=양안 폭(길이), 몸통=배꼽(면적) 기준. */
export const AREA_REGION_BODY_SITE: Record<AreaRegionId, AreaBodySite> = {
  face: { part: '얼굴', side: null, ref: '양안 폭', ref_mode: 'length' },
  torso: { part: '몸통', side: null, ref: '배꼽', ref_mode: 'circle' },
  back: { part: '등', side: null, ref: null, ref_mode: null },
  leftArm: { part: '왼팔', side: 'left', ref: null, ref_mode: null },
  rightArm: { part: '오른팔', side: 'right', ref: null, ref_mode: null },
  leftLeg: { part: '왼다리', side: 'left', ref: null, ref_mode: null },
  rightLeg: { part: '오른다리', side: 'right', ref: null, ref_mode: null },
  backLegs: { part: '등밑에 다리', side: null, ref: null, ref_mode: null },
};

/** 탭한 세부부위 + 바라보는 면(앞/뒤) → 8부위 중 하나 */
export function classifyAreaRegion(part: BodyPartId, facing: PartFacing): AreaRegionId {
  if (part === 'head' || part === 'neck') return 'face';
  if (part === 'chest' || part === 'abdomen') return facing === 'back' ? 'back' : 'torso';
  // 팔·다리는 좌우를 뒤집어 매핑 (마주 본 사람 기준)
  if (LEFT_ARM.includes(part)) return 'rightArm';
  if (RIGHT_ARM.includes(part)) return 'leftArm';
  if (LEFT_LEG.includes(part)) return facing === 'back' ? 'backLegs' : 'rightLeg';
  if (RIGHT_LEG.includes(part)) return facing === 'back' ? 'backLegs' : 'leftLeg';
  return 'torso';
}
