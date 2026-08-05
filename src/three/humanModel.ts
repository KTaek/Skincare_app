import { BodyPartId } from '../monitoring/bodyParts';
import { cross, dot, Mesh, normalize, sub, v3, Vec3 } from './geom3d';

/**
 * 인체 3D 모델을 코드로 생성한다.
 * 외부 GLB/OBJ 에셋과 네이티브 3D 런타임 없이도 회전·클릭이 가능한 저폴리 메시를 만들기 위한 것이라,
 * 각 부위를 "단면(타원)들을 이어 붙인 튜브"로 근사한다.
 * 나중에 실제 스캔 메시로 교체하더라도 Mesh<BodyPartId> 인터페이스만 지키면 화면 코드는 그대로 쓸 수 있다.
 */

export type BodyModelId = 'adultMale' | 'adultFemale' | 'child';

export interface BodyModelPreset {
  id: BodyModelId;
  label: string;
  caption: string;
  /** 모델 전체 키 (모델 단위) */
  height: number;
  /** 어깨 너비 배율 */
  shoulder: number;
  /** 골반 너비 배율 */
  hip: number;
  /** 팔다리 굵기 배율 */
  limb: number;
  /** 머리 크기 배율 (아동일수록 크다) */
  head: number;
}

export const BODY_MODEL_PRESETS: BodyModelPreset[] = [
  {
    id: 'adultMale',
    label: '성인 남성',
    caption: '어깨가 넓은 표준 성인 체형',
    height: 1.74,
    shoulder: 1.0,
    hip: 0.92,
    limb: 1.0,
    head: 1.0,
  },
  {
    id: 'adultFemale',
    label: '성인 여성',
    caption: '골반이 상대적으로 넓은 성인 체형',
    height: 1.62,
    shoulder: 0.88,
    hip: 1.04,
    limb: 0.92,
    head: 0.97,
  },
  {
    id: 'child',
    label: '아동',
    caption: '머리가 크고 팔다리가 짧은 소아 체형',
    height: 1.2,
    shoulder: 0.84,
    hip: 0.88,
    limb: 0.95,
    head: 1.22,
  },
];

export const getPreset = (id: BodyModelId): BodyModelPreset =>
  BODY_MODEL_PRESETS.find((p) => p.id === id) ?? BODY_MODEL_PRESETS[0];

interface Section {
  c: Vec3;
  rx: number;
  rz: number;
}

const RADIAL_SEGMENTS = 10;
const CAP_RINGS = 2;

/** 단면 중심열을 따라가는 튜브를 메시에 추가한다. 삼각형은 모두 바깥을 향하도록 정렬된다. */
function addTube(
  mesh: Mesh<BodyPartId>,
  part: BodyPartId,
  sections: Section[],
  opts: { capStart?: boolean; capEnd?: boolean } = {},
) {
  const ringsCenters: Vec3[] = [];
  const ringsStart: number[] = [];

  const tangentAt = (i: number): Vec3 => {
    const prev = sections[Math.max(0, i - 1)].c;
    const next = sections[Math.min(sections.length - 1, i + 1)].c;
    const d = sub(next, prev);
    if (Math.hypot(d.x, d.y, d.z) < 1e-6) return v3(0, 1, 0);
    return normalize(d);
  };

  const frameAt = (t: Vec3) => {
    const ref = Math.abs(t.z) > 0.9 ? v3(0, 1, 0) : v3(0, 0, 1);
    const u = normalize(cross(ref, t));
    const w = normalize(cross(t, u));
    return { u, w };
  };

  const pushRing = (center: Vec3, rx: number, rz: number, t: Vec3) => {
    const { u, w } = frameAt(t);
    const start = mesh.vertices.length;
    for (let k = 0; k < RADIAL_SEGMENTS; k++) {
      const a = (k / RADIAL_SEGMENTS) * Math.PI * 2;
      const ca = Math.cos(a) * rx;
      const sa = Math.sin(a) * rz;
      mesh.vertices.push(v3(center.x + u.x * ca + w.x * sa, center.y + u.y * ca + w.y * sa, center.z + u.z * ca + w.z * sa));
    }
    ringsStart.push(start);
    ringsCenters.push(center);
  };

  // 캡이 부위 밖으로 튀어나오는 길이. 넓은 쪽(rx)을 쓰면 어깨 캡이 목을 통째로 덮어버려서
  // 짧은 쪽 반지름의 절반만 내민다.
  const capReach = (s: Section) => Math.min(s.rx, s.rz) * 0.5;

  // 시작 캡: 단면을 축 바깥으로 조금씩 내밀면서 반지름을 줄여 둥글게 마감
  if (opts.capStart) {
    const s = sections[0];
    const t = tangentAt(0);
    const r = capReach(s);
    for (let k = CAP_RINGS; k >= 1; k--) {
      const a = (k / (CAP_RINGS + 1)) * (Math.PI / 2);
      const off = Math.sin(a) * r;
      const f = Math.cos(a);
      pushRing(v3(s.c.x - t.x * off, s.c.y - t.y * off, s.c.z - t.z * off), s.rx * f, s.rz * f, t);
    }
  }

  sections.forEach((s, i) => pushRing(s.c, s.rx, s.rz, tangentAt(i)));

  if (opts.capEnd) {
    const s = sections[sections.length - 1];
    const t = tangentAt(sections.length - 1);
    const r = capReach(s);
    for (let k = 1; k <= CAP_RINGS; k++) {
      const a = (k / (CAP_RINGS + 1)) * (Math.PI / 2);
      const off = Math.sin(a) * r;
      const f = Math.cos(a);
      pushRing(v3(s.c.x + t.x * off, s.c.y + t.y * off, s.c.z + t.z * off), s.rx * f, s.rz * f, t);
    }
  }

  const pushTri = (ia: number, ib: number, ic: number, refCenter: Vec3) => {
    const a = mesh.vertices[ia];
    const b = mesh.vertices[ib];
    const c = mesh.vertices[ic];
    const n = cross(sub(b, a), sub(c, a));
    const outward = v3(
      (a.x + b.x + c.x) / 3 - refCenter.x,
      (a.y + b.y + c.y) / 3 - refCenter.y,
      (a.z + b.z + c.z) / 3 - refCenter.z,
    );
    // 바깥을 향하도록 감김 방향을 통일 (뒷면 컬링과 셰이딩이 이것에 의존)
    if (dot(n, outward) >= 0) mesh.tris.push({ a: ia, b: ib, c: ic, part });
    else mesh.tris.push({ a: ia, b: ic, c: ib, part });
  };

  for (let i = 0; i < ringsStart.length - 1; i++) {
    const s0 = ringsStart[i];
    const s1 = ringsStart[i + 1];
    const mid = v3(
      (ringsCenters[i].x + ringsCenters[i + 1].x) / 2,
      (ringsCenters[i].y + ringsCenters[i + 1].y) / 2,
      (ringsCenters[i].z + ringsCenters[i + 1].z) / 2,
    );
    for (let k = 0; k < RADIAL_SEGMENTS; k++) {
      const k2 = (k + 1) % RADIAL_SEGMENTS;
      pushTri(s0 + k, s0 + k2, s1 + k, mid);
      pushTri(s1 + k, s0 + k2, s1 + k2, mid);
    }
  }

  // 양 끝은 마지막 링을 극점 하나로 모아 닫는다
  const closeEnd = (ringIdx: number, poleOffsetSign: number, tangent: Vec3, radius: number) => {
    const start = ringsStart[ringIdx];
    const c = ringsCenters[ringIdx];
    const pole = v3(
      c.x + tangent.x * radius * poleOffsetSign,
      c.y + tangent.y * radius * poleOffsetSign,
      c.z + tangent.z * radius * poleOffsetSign,
    );
    const poleIdx = mesh.vertices.length;
    mesh.vertices.push(pole);
    for (let k = 0; k < RADIAL_SEGMENTS; k++) {
      const k2 = (k + 1) % RADIAL_SEGMENTS;
      pushTri(start + k, start + k2, poleIdx, c);
    }
  };

  const firstSection = sections[0];
  const lastSection = sections[sections.length - 1];
  const tFirst = tangentAt(0);
  const tLast = tangentAt(sections.length - 1);
  const rFirst = opts.capStart ? capReach(firstSection) * 0.35 : Math.min(firstSection.rx, firstSection.rz) * 0.12;
  const rLast = opts.capEnd ? capReach(lastSection) * 0.35 : Math.min(lastSection.rx, lastSection.rz) * 0.12;
  closeEnd(0, -1, tFirst, rFirst);
  closeEnd(ringsStart.length - 1, 1, tLast, rLast);
}

const lerpVec = (a: Vec3, b: Vec3, t: number): Vec3 =>
  v3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);

/** 시작점 → 끝점을 n등분하며 반지름이 선형으로 변하는 단면열 */
function taper(a: Vec3, b: Vec3, r0: number, r1: number, steps: number, flatten = 1): Section[] {
  const out: Section[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const r = r0 + (r1 - r0) * t;
    out.push({ c: lerpVec(a, b, t), rx: r, rz: r * flatten });
  }
  return out;
}

/** 프리셋으로부터 전신 메시를 만든다 (부위 태그 포함) */
export function buildBodyMesh(preset: BodyModelPreset): Mesh<BodyPartId> {
  const mesh: Mesh<BodyPartId> = { vertices: [], tris: [] };
  const H = preset.height;
  const u = (f: number) => f * H; // 키 대비 비율 → 모델 단위

  const limb = preset.limb;
  const shoulderX = u(0.115) * preset.shoulder;
  const hipX = u(0.075) * preset.hip;

  // 머리 — 구를 단면열로 근사
  const headR = u(0.068) * preset.head;
  const headCy = u(0.068) * preset.head;
  const headSections: Section[] = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const ang = t * Math.PI;
    const r = Math.sin(ang) * headR;
    headSections.push({ c: v3(0, headCy - Math.cos(ang) * headR * 1.12, 0), rx: Math.max(r, 0.004), rz: Math.max(r, 0.004) * 1.05 });
  }
  addTube(mesh, 'head', headSections);

  // 코 — 몸이 앞뒤로 거의 대칭이라 이것 말고는 어느 쪽을 보고 있는지 알 단서가 없다
  const noseY = headCy + headR * 0.08;
  addTube(
    mesh,
    'head',
    taper(v3(0, noseY, headR * 0.7), v3(0, noseY + headR * 0.22, headR * 1.16), headR * 0.19, headR * 0.08, 2),
    { capEnd: true },
  );

  // 목 — 목 뒤(nape)는 아토피 호발 부위라 탭 영역이 남도록 어깨선 아래까지 길게 만든다
  addTube(mesh, 'neck', taper(v3(0, u(0.125), 0), v3(0, u(0.225), 0), u(0.042), u(0.05), 3));

  // 몸통 — 가슴과 배를 나눠 별도 부위로
  addTube(
    mesh,
    'chest',
    [
      { c: v3(0, u(0.21), 0), rx: shoulderX * 1.0, rz: u(0.062) },
      { c: v3(0, u(0.26), 0), rx: shoulderX * 0.97, rz: u(0.068) },
      { c: v3(0, u(0.31), 0), rx: shoulderX * 0.85, rz: u(0.064) },
      { c: v3(0, u(0.37), 0), rx: shoulderX * 0.78, rz: u(0.058) },
    ],
    { capStart: true },
  );
  addTube(
    mesh,
    'abdomen',
    [
      { c: v3(0, u(0.37), 0), rx: shoulderX * 0.78, rz: u(0.058) },
      { c: v3(0, u(0.44), 0), rx: shoulderX * 0.8, rz: u(0.06) },
      { c: v3(0, u(0.5), 0), rx: hipX * 1.25, rz: u(0.068) },
      { c: v3(0, u(0.545), 0), rx: hipX * 1.28, rz: u(0.07) },
    ],
    { capEnd: true },
  );

  const buildArm = (sign: 1 | -1, side: 'left' | 'right') => {
    const sx = shoulderX * 0.95 * sign;
    const shoulder = v3(sx, u(0.205), 0);
    const elbowTop = v3(sx * 1.16, u(0.375), 0);
    const elbowBottom = v3(sx * 1.2, u(0.425), 0);
    const wrist = v3(sx * 1.28, u(0.575), 0);
    const handEnd = v3(sx * 1.3, u(0.655), 0);

    addTube(mesh, `${side}UpperArm` as BodyPartId, taper(shoulder, elbowTop, u(0.042) * limb, u(0.034) * limb, 3), {
      capStart: true,
    });
    addTube(mesh, `${side}Elbow` as BodyPartId, taper(elbowTop, elbowBottom, u(0.035) * limb, u(0.035) * limb, 2));
    addTube(mesh, `${side}Forearm` as BodyPartId, taper(elbowBottom, wrist, u(0.034) * limb, u(0.026) * limb, 3));
    addTube(mesh, `${side}Hand` as BodyPartId, taper(wrist, handEnd, u(0.03) * limb, u(0.032) * limb, 2, 0.55), {
      capEnd: true,
    });
  };

  const buildLeg = (sign: 1 | -1, side: 'left' | 'right') => {
    const hip = v3(hipX * 0.72 * sign, u(0.53), 0);
    const kneeTop = v3(hipX * 0.72 * sign, u(0.705), 0);
    const kneeBottom = v3(hipX * 0.7 * sign, u(0.765), 0);
    const ankle = v3(hipX * 0.66 * sign, u(0.955), 0);
    const toe = v3(hipX * 0.66 * sign, u(0.995), u(0.075));

    addTube(mesh, `${side}Thigh` as BodyPartId, taper(hip, kneeTop, u(0.068) * limb, u(0.05) * limb, 3), { capStart: true });
    addTube(mesh, `${side}Knee` as BodyPartId, taper(kneeTop, kneeBottom, u(0.051) * limb, u(0.05) * limb, 2));
    addTube(mesh, `${side}Shank` as BodyPartId, taper(kneeBottom, ankle, u(0.05) * limb, u(0.03) * limb, 3));
    addTube(mesh, `${side}Foot` as BodyPartId, taper(ankle, toe, u(0.032) * limb, u(0.03) * limb, 2, 1.15), { capEnd: true });
  };

  buildArm(-1, 'left');
  buildArm(1, 'right');
  buildLeg(-1, 'left');
  buildLeg(1, 'right');

  return mesh;
}

/**
 * 좌/우 이름은 "화면 기준"이다.
 * buildArm(-1, 'left')가 -x(화면 왼쪽)에 left* 부위를 두는데, 기존 2D 그림(bodyShapes.ts)의
 * leftArm/rightArm도 화면 기준으로 매겨져 있어 두 화면의 라벨이 서로 어긋나지 않는다.
 * 환자 기준(해부학적 좌우)으로 바꾸려면 여기와 bodyShapes.ts를 함께 뒤집어야 한다.
 */
