import { BodyRegion } from '../models';
import type { ScaleKind } from '../ai/scaleFrame';
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
  torso: '가슴/복부/등/허리/엉덩이',
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
  /** 선택 화면에서 상자를 놓을 줄 번호 (0부터) */
  row: number;
}

type SpotDef = {
  key: string;
  label: string;
  part: BodyPartId;
  facing: PartFacing;
  view: SpotView;
  highlight?: BodyPartId[];
  row?: number;
};

export const SPOTS_OF_GROUP: Record<PartGroupId, BodySpot[]> = {} as Record<PartGroupId, BodySpot[]>;

const define = (group: PartGroupId, defs: SpotDef[]) => {
  SPOTS_OF_GROUP[group] = defs.map((d, i) => ({
    id: `${group}:${d.key}`,
    label: d.label,
    group,
    part: d.part,
    facing: d.facing,
    view: d.view,
    highlight: d.highlight ?? GROUP_PARTS[group],
    row: d.row ?? Math.floor(i / 2), // 따로 지정하지 않으면 한 줄에 두 개씩
  }));
};

/**
 * 이 부위의 넓이를 무엇을 자로 삼아 잴 것인가 — 잴 수 없으면 null.
 *
 * 넓이를 회차 간 비교하려면 시간에 따라 변하지 않는 자가 필요하다(ai/scaleFrame.ts). 지금 그
 * 조건을 만족하는 랜드마크가 있는 곳은 둘이다:
 *
 *   얼굴 — 눈 둘과 입 (두개골)
 *   몸통 — 양 어깨와 양 골반 (견봉간거리와 척추)
 *
 * 팔오금·오금처럼 뼈 기준점이 없는 자리는 여전히 잴 수 없다. 팔꿈치·손목을 자로 쓰는 방법이
 * 있긴 하지만 팔은 굽히는 각도에 따라 투영이 통째로 바뀌어서, 자보다 자세가 먼저 문제가 된다.
 *
 * 촬영 화면과 폴더 화면이 **같은 판단**을 써야 한다. 한쪽만 얼굴로 치면 "넓이를 기록했다"고
 * 해 놓고 볼 곳이 없거나, 반대로 영영 채워지지 않을 카드를 띄우게 된다.
 *
 * part로 가르는 이유: 지금 등록 흐름은 네 덩어리 id("coarse:head")를 만들고 예전 기록에는
 * 세밀한 id("head:face")가 남아 있다. 둘 다 part는 'head'라 한 줄로 끝난다.
 */
export function scaleKindOf(part: BodyPartId): ScaleKind | null {
  if (part === 'head') return 'face';
  /*
    몸통 자를 쓰는 것은 'chest'뿐이다 — 지점으로는 "가슴/복부"(앞)와 "등"(뒤).
    앞뒤는 폴더가 따로라 한 추세에 섞이지 않는다.

    'abdomen'을 넣지 않은 이유가 중요하다. 그 부위에 달린 지점은 셋인데 전부 조건이 깨진다:

      · 왼쪽/오른쪽 허리 — 옆에서 찍는 자리다. 옆모습에서는 어깨너비 d가 투영으로 뭉개져서
        자 자체가 성립하지 않는다 (얼굴에서 옆모습을 기준 사진으로 쓸 수 없는 것과 같다).
      · 엉덩이 — 골반선 아래라 관심영역(어깨중점~골반중점을 감싸는 1.6s 정사각형) 밖으로 거의
        벗어난다. 그대로 켜면 병변이 분석 영역에 들어오지도 않은 채 "넓이 0"이 기록된다.

    두 경우 다 자를 다시 정의해야 하는 문제라(옆면은 어깨-골반 한쪽 변, 엉덩이는 골반 기준),
    지금 자로 억지로 켜는 것보다 꺼 두는 편이 맞다.
  */
  if (part === 'chest') return 'torso';
  return null;
}

/** 병변 넓이 추이를 잴 수 있는 부위인지 */
export function supportsAreaTracking(part: BodyPartId): boolean {
  return scaleKindOf(part) !== null;
}

/** 선택 화면에서 상자를 줄 단위로 묶어 준다 */
export function spotRows(group: PartGroupId): BodySpot[][] {
  const rows: BodySpot[][] = [];
  SPOTS_OF_GROUP[group].forEach((s) => {
    (rows[s.row] ??= []).push(s);
  });
  return rows.filter(Boolean);
}

define('head', [{ key: 'face', label: '얼굴', part: 'head', facing: 'front', view: FRONT }]);
define('neck', [
  { key: 'front', label: '목 앞', part: 'neck', facing: 'front', view: FRONT },
  { key: 'back', label: '목 뒤', part: 'neck', facing: 'back', view: BACK },
]);
define('torso', [
  { key: 'front', label: '가슴/복부', part: 'chest', facing: 'front', view: FRONT, row: 0 },
  // 등은 가슴 부위(어깨~허리)의 뒷면, 엉덩이는 배 부위(허리~가랑이)의 뒷면을 맡는다
  { key: 'back', label: '등', part: 'chest', facing: 'back', view: BACK, highlight: ['chest'], row: 0 },
  { key: 'leftWaist', label: '왼쪽 허리', part: 'abdomen', facing: 'front', view: LEFT, highlight: ['abdomen'], row: 1 },
  { key: 'rightWaist', label: '오른쪽 허리', part: 'abdomen', facing: 'front', view: RIGHT, highlight: ['abdomen'], row: 1 },
  { key: 'buttocks', label: '엉덩이', part: 'abdomen', facing: 'back', view: BACK, highlight: ['abdomen'], row: 1 },
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
  // 팔을 내린 자세에서는 손등이 바깥쪽, 손바닥이 몸 안쪽을 향한다 (앞/뒤가 아니라 좌우로 봐야 한다)
  define(p('Hand') as PartGroupId, [
    { key: 'dorsum', label: `${S} 손등`, part: p('Hand'), facing: 'back', view: side === 'left' ? LEFT : RIGHT },
    { key: 'palm', label: `${S} 손바닥`, part: p('Hand'), facing: 'front', view: side === 'left' ? RIGHT : LEFT },
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
 * 촬영 지점 id로 3D에서 칠할 부위들을 찾는다.
 * 지금 등록 흐름이 만드는 id는 네 덩어리("coarse:arm" 등)라 아래쪽 COARSE_SPOTS에서,
 * 예전의 세밀한 지점("leftElbow:fossa" 등)은 SPOTS_OF_GROUP에서 나온다.
 */
export function partsOfSpotId(spotId: string): BodyPartId[] | undefined {
  if (spotId.startsWith('coarse:')) return PARTS_OF_COARSE[spotId.slice(7) as CoarseGroupId];
  return findSpot(spotId)?.highlight;
}

/* ------------------------------------------------------------------
 * 신규 증상 기록의 부위 선택은 이 네 덩어리만 쓴다.
 *
 * 위의 세밀한 그룹/지점(상완 앞·팔오금·손등 …)은 3D 메시가 원래 들고 있는 태그이고, 실제로
 * 사용자가 고르는 단위는 머리 · 몸통 · 팔 · 다리 넷뿐이다. 좌우도 나누지 않는다 — 며칠 뒤
 * 목록에서 "좌측 팔 / 우측 팔"을 보면 어느 쪽이었는지 기억하지 못하기 때문이다.
 * ------------------------------------------------------------------ */

export type CoarseGroupId = 'head' | 'torso' | 'arm' | 'leg';

export const COARSE_GROUPS: CoarseGroupId[] = ['head', 'torso', 'arm', 'leg'];

/** 기록에 남는 짧은 이름 */
export const COARSE_LABELS: Record<CoarseGroupId, string> = {
  head: '머리',
  torso: '몸통',
  arm: '팔',
  leg: '다리',
};

/** 선택 화면에서만 덧붙이는 설명 — 어디까지 이 덩어리인지 알려준다 */
export const COARSE_HINTS: Record<CoarseGroupId, string | undefined> = {
  head: '얼굴/목',
  torso: '가슴/복부/등/허리/엉덩이',
  arm: undefined,
  leg: undefined,
};

/** 선택 화면에 그대로 쓰는 표시용 이름 (예: "머리 (얼굴/목)") */
export function coarseDisplayName(group: CoarseGroupId): string {
  const hint = COARSE_HINTS[group];
  return hint ? `${COARSE_LABELS[group]} (${hint})` : COARSE_LABELS[group];
}

/** 3D 메시의 부위 태그 → 네 덩어리 */
export const COARSE_OF_PART: Record<BodyPartId, CoarseGroupId> = {
  head: 'head',
  neck: 'head',
  chest: 'torso',
  abdomen: 'torso',
  leftUpperArm: 'arm',
  leftElbow: 'arm',
  leftForearm: 'arm',
  leftHand: 'arm',
  rightUpperArm: 'arm',
  rightElbow: 'arm',
  rightForearm: 'arm',
  rightHand: 'arm',
  leftThigh: 'leg',
  leftKnee: 'leg',
  leftShank: 'leg',
  leftFoot: 'leg',
  rightThigh: 'leg',
  rightKnee: 'leg',
  rightShank: 'leg',
  rightFoot: 'leg',
};

/** 덩어리에 속한 메시 부위들 — 3D에서 통째로 강조할 때 쓴다 */
export const PARTS_OF_COARSE: Record<CoarseGroupId, BodyPartId[]> = (() => {
  const out = { head: [], torso: [], arm: [], leg: [] } as Record<CoarseGroupId, BodyPartId[]>;
  (Object.keys(COARSE_OF_PART) as BodyPartId[]).forEach((part) => out[COARSE_OF_PART[part]].push(part));
  return out;
})();

/**
 * 덩어리 하나에 촬영 자리(BodySpot) 하나를 대응시킨다.
 *
 * 세부 면(앞/뒤)을 더 이상 고르지 않으므로 자리도 덩어리마다 하나면 된다. part는 그 덩어리를
 * 대표하는 메시 부위로 두는데, 기존 6구역 기록 체계(PART_TO_REGION)로 환산할 때만 쓰인다.
 */
export const COARSE_SPOTS: Record<CoarseGroupId, BodySpot> = {
  head: { id: 'coarse:head', label: '머리', group: 'head', part: 'head', facing: 'front', view: FRONT, highlight: PARTS_OF_COARSE.head, row: 0 },
  torso: { id: 'coarse:torso', label: '몸통', group: 'torso', part: 'chest', facing: 'front', view: FRONT, highlight: PARTS_OF_COARSE.torso, row: 0 },
  arm: { id: 'coarse:arm', label: '팔', group: 'rightUpperArm', part: 'rightUpperArm', facing: 'front', view: FRONT, highlight: PARTS_OF_COARSE.arm, row: 0 },
  leg: { id: 'coarse:leg', label: '다리', group: 'rightThigh', part: 'rightThigh', facing: 'front', view: FRONT, highlight: PARTS_OF_COARSE.leg, row: 0 },
};

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
 * 탭한 부위를 함께 주면 등/엉덩이처럼 보는 방향이 같은 지점도 구분된다.
 */
export function spotFromNormal(group: PartGroupId, normal: Vec3, part?: BodyPartId): BodySpot {
  const all = SPOTS_OF_GROUP[group];
  const onPart = part ? all.filter((s) => s.highlight.includes(part)) : [];
  const spots = onPart.length ? onPart : all;
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
