import { BodyRegion } from '../models';
import { applyMat3, dot, Mat3, rotationMatrix, transposeMat3, v3, Vec3 } from '../three/geom3d';

/**
 * 3D 모델에서 클릭으로 고를 수 있는 부위.
 * 기존 6구역(BodyRegion)보다 잘게 나눈다 — 모니터링은 "같은 자리"를 반복 촬영해야 하므로
 * '왼쪽 팔'만으로는 부족하고 팔꿈치/전완처럼 구분이 필요하다.
 */
export type BodyPartId =
  | 'head'
  | 'neck'
  | 'chest'
  | 'abdomen'
  | 'leftUpperArm'
  | 'leftElbow'
  | 'leftForearm'
  | 'leftHand'
  | 'rightUpperArm'
  | 'rightElbow'
  | 'rightForearm'
  | 'rightHand'
  | 'leftThigh'
  | 'leftKnee'
  | 'leftShank'
  | 'leftFoot'
  | 'rightThigh'
  | 'rightKnee'
  | 'rightShank'
  | 'rightFoot';

/** 클릭한 지점이 모델의 앞면인지 뒷면인지 — 팔꿈치 안쪽(주와), 무릎 뒤(슬와) 구분에 필요 */
export type PartFacing = 'front' | 'back';

/** 기존 기록 체계(6구역)와 호환되도록 축약 */
export const PART_TO_REGION: Record<BodyPartId, BodyRegion> = {
  head: 'head',
  neck: 'head',
  chest: 'torso',
  abdomen: 'torso',
  leftUpperArm: 'leftArm',
  leftElbow: 'leftArm',
  leftForearm: 'leftArm',
  leftHand: 'leftArm',
  rightUpperArm: 'rightArm',
  rightElbow: 'rightArm',
  rightForearm: 'rightArm',
  rightHand: 'rightArm',
  leftThigh: 'leftLeg',
  leftKnee: 'leftLeg',
  leftShank: 'leftLeg',
  leftFoot: 'leftLeg',
  rightThigh: 'rightLeg',
  rightKnee: 'rightLeg',
  rightShank: 'rightLeg',
  rightFoot: 'rightLeg',
};

/* ------------------------------------------------------------------
 * 부위 선택은 두 단계다.
 *   1단계 — 그룹(PartGroupId): 3D 전신에서 탭으로 고르는 큰 덩어리. 몸통은 가슴/배를 한 덩어리로 묶는다.
 *   2단계 — 지점(BodySpot): 그룹 안에서 실제로 촬영할 면. 앞/뒤처럼 사진이 완전히 달라지는 단위라
 *           기준 세션(baseline)도 여기에 붙는다.
 * ------------------------------------------------------------------ */

export type PartGroupId =
  | 'head'
  | 'neck'
  | 'torso'
  | 'leftUpperArm'
  | 'leftElbow'
  | 'leftForearm'
  | 'leftHand'
  | 'rightUpperArm'
  | 'rightElbow'
  | 'rightForearm'
  | 'rightHand'
  | 'leftThigh'
  | 'leftKnee'
  | 'leftShank'
  | 'leftFoot'
  | 'rightThigh'
  | 'rightKnee'
  | 'rightShank'
  | 'rightFoot';

/** 3D 메시의 부위 태그 → 선택 그룹. 몸통만 두 부위(chest/abdomen)가 한 그룹으로 합쳐진다. */
export const GROUP_OF_PART: Record<BodyPartId, PartGroupId> = {
  head: 'head',
  neck: 'neck',
  chest: 'torso',
  abdomen: 'torso',
  leftUpperArm: 'leftUpperArm',
  leftElbow: 'leftElbow',
  leftForearm: 'leftForearm',
  leftHand: 'leftHand',
  rightUpperArm: 'rightUpperArm',
  rightElbow: 'rightElbow',
  rightForearm: 'rightForearm',
  rightHand: 'rightHand',
  leftThigh: 'leftThigh',
  leftKnee: 'leftKnee',
  leftShank: 'leftShank',
  leftFoot: 'leftFoot',
  rightThigh: 'rightThigh',
  rightKnee: 'rightKnee',
  rightShank: 'rightShank',
  rightFoot: 'rightFoot',
};

export const GROUP_LABELS: Record<PartGroupId, string> = {
  head: '얼굴',
  neck: '목',
  torso: '가슴/복부/허리/등',
  leftUpperArm: '왼쪽 상완',
  leftElbow: '왼쪽 팔꿈치/팔오금',
  leftForearm: '왼쪽 하완',
  leftHand: '왼쪽 손',
  rightUpperArm: '오른쪽 상완',
  rightElbow: '오른쪽 팔꿈치/팔오금',
  rightForearm: '오른쪽 하완',
  rightHand: '오른쪽 손',
  leftThigh: '왼쪽 허벅지',
  leftKnee: '왼쪽 무릎/무릎오금',
  leftShank: '왼쪽 종아리',
  leftFoot: '왼쪽 발',
  rightThigh: '오른쪽 허벅지',
  rightKnee: '오른쪽 무릎/무릎오금',
  rightShank: '오른쪽 종아리',
  rightFoot: '오른쪽 발',
};

/** 그룹에 속한 메시 부위들 — 3D에서 강조하거나 그 부위만 떼어 보여줄 때 쓴다 */
export const GROUP_PARTS: Record<PartGroupId, BodyPartId[]> = (() => {
  const out = {} as Record<PartGroupId, BodyPartId[]>;
  (Object.keys(GROUP_OF_PART) as BodyPartId[]).forEach((part) => {
    const g = GROUP_OF_PART[part];
    if (!out[g]) out[g] = [];
    out[g].push(part);
  });
  return out;
})();

/** 3D 미리보기에서 그 면이 정면으로 보이는 카메라 각도 */
export interface SpotView {
  yaw: number;
  pitch: number;
}

const FRONT: SpotView = { yaw: 0, pitch: 0 };
const BACK: SpotView = { yaw: Math.PI, pitch: 0 };
// -x(화면 왼쪽) 면이 카메라를 향하는 각도. 좌우 이름은 humanModel.ts와 같은 "화면 기준"이다.
const LEFT: SpotView = { yaw: Math.PI / 2, pitch: 0 };
const RIGHT: SpotView = { yaw: -Math.PI / 2, pitch: 0 };
// 발등/발바닥은 위아래에서 봐야 해서 pitch를 크게 준다
const ABOVE: SpotView = { yaw: 0, pitch: -0.65 };
const BELOW: SpotView = { yaw: 0, pitch: 0.95 };

/** 실제 촬영 단위 — "왼쪽 팔오금"처럼 사진 한 장에 대응한다 */
export interface BodySpot {
  id: string;
  label: string;
  group: PartGroupId;
  part: BodyPartId;
  facing: PartFacing;
  view: SpotView;
  /** 3D에서 이 지점으로 강조할 부위 — 보통 그룹 전체지만 허리처럼 일부만 가리키는 경우가 있다 */
  highlight: BodyPartId[];
}

type SpotDef = {
  key: string;
  label: string;
  part: BodyPartId;
  facing: PartFacing;
  view: SpotView;
  highlight?: BodyPartId[];
};

export const SPOTS_OF_GROUP: Record<PartGroupId, BodySpot[]> = {} as Record<PartGroupId, BodySpot[]>;

const define = (group: PartGroupId, defs: SpotDef[]) => {
  SPOTS_OF_GROUP[group] = defs.map((d) => ({
    id: `${group}:${d.key}`,
    label: d.label,
    group,
    part: d.part,
    facing: d.facing,
    view: d.view,
    highlight: d.highlight ?? GROUP_PARTS[group],
  }));
};

define('head', [{ key: 'face', label: '얼굴', part: 'head', facing: 'front', view: FRONT }]);
define('neck', [
  { key: 'front', label: '목 앞', part: 'neck', facing: 'front', view: FRONT },
  { key: 'back', label: '목 뒤', part: 'neck', facing: 'back', view: BACK },
]);
define('torso', [
  { key: 'front', label: '가슴/복부', part: 'chest', facing: 'front', view: FRONT },
  { key: 'leftWaist', label: '왼쪽 허리', part: 'abdomen', facing: 'front', view: LEFT, highlight: ['abdomen'] },
  { key: 'rightWaist', label: '오른쪽 허리', part: 'abdomen', facing: 'front', view: RIGHT, highlight: ['abdomen'] },
  { key: 'back', label: '등', part: 'chest', facing: 'back', view: BACK },
]);

const SIDE_KO = { left: '왼쪽', right: '오른쪽' } as const;

(['left', 'right'] as const).forEach((side) => {
  const S = SIDE_KO[side];
  const p = (base: string) => `${side}${base}` as BodyPartId;

  define(p('UpperArm') as PartGroupId, [
    { key: 'front', label: `${S} 상완 앞`, part: p('UpperArm'), facing: 'front', view: FRONT },
    { key: 'back', label: `${S} 상완 뒤`, part: p('UpperArm'), facing: 'back', view: BACK },
  ]);
  define(p('Elbow') as PartGroupId, [
    { key: 'fossa', label: `${S} 팔오금`, part: p('Elbow'), facing: 'front', view: FRONT },
    { key: 'olecranon', label: `${S} 팔꿈치`, part: p('Elbow'), facing: 'back', view: BACK },
  ]);
  define(p('Forearm') as PartGroupId, [
    { key: 'front', label: `${S} 하완 앞`, part: p('Forearm'), facing: 'front', view: FRONT },
    { key: 'back', label: `${S} 하완 뒤`, part: p('Forearm'), facing: 'back', view: BACK },
  ]);
  define(p('Hand') as PartGroupId, [
    { key: 'dorsum', label: `${S} 손등`, part: p('Hand'), facing: 'back', view: BACK },
    { key: 'palm', label: `${S} 손바닥`, part: p('Hand'), facing: 'front', view: FRONT },
  ]);
  define(p('Thigh') as PartGroupId, [
    { key: 'front', label: `${S} 허벅지 앞`, part: p('Thigh'), facing: 'front', view: FRONT },
    { key: 'back', label: `${S} 허벅지 뒤`, part: p('Thigh'), facing: 'back', view: BACK },
  ]);
  define(p('Knee') as PartGroupId, [
    { key: 'front', label: `${S} 무릎`, part: p('Knee'), facing: 'front', view: FRONT },
    { key: 'fossa', label: `${S} 무릎오금`, part: p('Knee'), facing: 'back', view: BACK },
  ]);
  define(p('Shank') as PartGroupId, [
    { key: 'front', label: `${S} 종아리 앞`, part: p('Shank'), facing: 'front', view: FRONT },
    { key: 'back', label: `${S} 종아리 뒤`, part: p('Shank'), facing: 'back', view: BACK },
  ]);
  define(p('Foot') as PartGroupId, [
    { key: 'dorsum', label: `${S} 발등`, part: p('Foot'), facing: 'front', view: ABOVE },
    { key: 'sole', label: `${S} 발바닥`, part: p('Foot'), facing: 'back', view: BELOW },
  ]);
});

export const findSpot = (spotId: string): BodySpot | undefined =>
  (Object.values(SPOTS_OF_GROUP) as BodySpot[][]).flat().find((s) => s.id === spotId);

/**
 * 세부 선택 화면에서 함께 보여줄 인접 부위.
 * 부위 하나만 떼어 놓으면 원통 하나라 어디인지 알 수 없어서, 이어지는 부위를 붙여 방향을 알려준다.
 */
export const CONTEXT_PARTS: Record<PartGroupId, BodyPartId[]> = (() => {
  const out = {} as Record<PartGroupId, BodyPartId[]>;
  out.head = ['neck', 'chest'];
  out.neck = ['head', 'chest'];
  out.torso = ['neck', 'leftUpperArm', 'rightUpperArm', 'leftThigh', 'rightThigh'];
  (['left', 'right'] as const).forEach((side) => {
    const p = (base: string) => `${side}${base}` as BodyPartId;
    out[p('UpperArm') as PartGroupId] = ['chest', p('Elbow')];
    out[p('Elbow') as PartGroupId] = [p('UpperArm'), p('Forearm')];
    out[p('Forearm') as PartGroupId] = [p('Elbow'), p('Hand')];
    out[p('Hand') as PartGroupId] = [p('Forearm')];
    out[p('Thigh') as PartGroupId] = ['abdomen', p('Knee')];
    out[p('Knee') as PartGroupId] = [p('Thigh'), p('Shank')];
    out[p('Shank') as PartGroupId] = [p('Knee'), p('Foot')];
    out[p('Foot') as PartGroupId] = [p('Shank')];
  });
  return out;
})();

/**
 * 지금 어느 쪽에서 보고 있는지 — 모델이 앞뒤로 거의 대칭이라 화면에 글로 알려줘야 구분이 된다.
 */
export function viewName(yaw: number, pitch: number): string {
  if (pitch < -0.45) return '위';
  if (pitch > 0.45) return '아래';
  const turn = Math.PI * 2;
  const y = ((yaw % turn) + turn) % turn;
  if (y < Math.PI / 4 || y >= (Math.PI * 7) / 4) return '앞';
  if (y < (Math.PI * 3) / 4) return '왼쪽';
  if (y < (Math.PI * 5) / 4) return '뒤';
  return '오른쪽';
}

/** 시점(yaw/pitch)에서 카메라가 모델을 바라보는 방향 — 모델 좌표계 기준 */
export const viewDirection = (view: SpotView): Vec3 => {
  const inv: Mat3 = transposeMat3(rotationMatrix(view.yaw, view.pitch));
  return applyMat3(inv, v3(0, 0, 1));
};

/**
 * 3D에서 탭한 면의 법선으로 그룹 안의 지점을 고른다.
 * 앞/뒤 판정(normal.z 부호)만으로는 발바닥처럼 위아래를 보는 면을 가릴 수 없어서,
 * 각 지점의 카메라 방향과 가장 잘 맞는 쪽을 고른다.
 */
export function spotFromNormal(group: PartGroupId, normal: Vec3): BodySpot {
  const spots = SPOTS_OF_GROUP[group];
  let best = spots[0];
  let bestDot = -Infinity;
  spots.forEach((s) => {
    const d = dot(normal, viewDirection(s.view));
    if (d > bestDot) {
      bestDot = d;
      best = s;
    }
  });
  return best;
}
