/**
 * 아주 작은 3D 유틸 — 네이티브 3D 엔진(expo-gl/three) 없이
 * JS에서 정점을 변환하고 Skia가 2D 삼각형으로 그리게 하기 위한 최소 구현.
 *
 * 좌표계: x 오른쪽, y 아래(화면과 동일), z 앞(카메라 쪽).
 * 카메라는 (0, 0, +cameraDist)에서 -z 방향을 본다.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const sub = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const add = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const scale = (a: Vec3, s: number): Vec3 => v3(a.x * s, a.y * s, a.z * s);
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 =>
  v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

export function normalize(a: Vec3): Vec3 {
  const len = Math.hypot(a.x, a.y, a.z) || 1;
  return v3(a.x / len, a.y / len, a.z / len);
}

/** 행 우선 3x3 행렬 */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export function applyMat3(m: Mat3, p: Vec3): Vec3 {
  return v3(
    m[0] * p.x + m[1] * p.y + m[2] * p.z,
    m[3] * p.x + m[4] * p.y + m[5] * p.z,
    m[6] * p.x + m[7] * p.y + m[8] * p.z,
  );
}

/** 직교 행렬의 역행렬 = 전치 */
export function transposeMat3(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

/** yaw(세로축 회전) 후 pitch(가로축 회전)를 적용하는 회전 행렬 R = Rx(pitch) · Ry(yaw) */
export function rotationMatrix(yaw: number, pitch: number): Mat3 {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cx = Math.cos(pitch);
  const sx = Math.sin(pitch);
  // Ry = [[cy,0,sy],[0,1,0],[-sy,0,cy]], Rx = [[1,0,0],[0,cx,-sx],[0,sx,cx]]
  return [
    cy, 0, sy,
    sx * sy, cx, -sx * cy,
    -cx * sy, sx, cx * cy,
  ];
}

/** 삼각형 하나 — 정점 인덱스와 소속 부위 태그 */
export interface Tri<TPart extends string = string> {
  a: number;
  b: number;
  c: number;
  part: TPart;
}

export interface Mesh<TPart extends string = string> {
  vertices: Vec3[];
  tris: Tri<TPart>[];
}

export interface Camera {
  /** 화면 중심 (px) */
  cx: number;
  cy: number;
  /** 모델 1단위가 화면 몇 px인지 */
  scale: number;
  /** 카메라와 모델 중심 사이 거리 (모델 단위). 클수록 원근이 약해진다 */
  dist: number;
  /** 초점거리 (모델 단위) */
  focal: number;
}

export interface Projected {
  /** 화면 좌표 */
  sx: Float32Array;
  sy: Float32Array;
  /** 회전 후 좌표 (셰이딩·깊이 정렬용) */
  rx: Float32Array;
  ry: Float32Array;
  rz: Float32Array;
}

/** 모든 정점을 회전 → 원근 투영해 화면 좌표로 변환 */
export function projectVertices(
  vertices: Vec3[],
  center: Vec3,
  rot: Mat3,
  cam: Camera,
): Projected {
  const n = vertices.length;
  const sx = new Float32Array(n);
  const sy = new Float32Array(n);
  const rx = new Float32Array(n);
  const ry = new Float32Array(n);
  const rz = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const v = vertices[i];
    const px = v.x - center.x;
    const py = v.y - center.y;
    const pz = v.z - center.z;
    const qx = rot[0] * px + rot[1] * py + rot[2] * pz;
    const qy = rot[3] * px + rot[4] * py + rot[5] * pz;
    const qz = rot[6] * px + rot[7] * py + rot[8] * pz;
    rx[i] = qx;
    ry[i] = qy;
    rz[i] = qz;
    const w = Math.max(cam.dist - qz, 0.05);
    const f = (cam.focal / w) * cam.scale;
    sx[i] = cam.cx + qx * f;
    sy[i] = cam.cy + qy * f;
  }
  return { sx, sy, rx, ry, rz };
}

export interface RayHit<TPart extends string = string> {
  part: TPart;
  /** 카메라에서의 거리 */
  t: number;
  /** 모델 좌표계에서의 교점 */
  point: Vec3;
  /** 모델 좌표계에서의 삼각형 법선 */
  normal: Vec3;
}

/**
 * 화면 좌표 → 모델 좌표계 광선으로 되돌린 뒤 메시와 교차 판정.
 * 가장 가까운(= 눈에 보이는) 삼각형을 돌려준다.
 */
export function pickPart<TPart extends string>(
  mesh: Mesh<TPart>,
  center: Vec3,
  rot: Mat3,
  cam: Camera,
  screenX: number,
  screenY: number,
): RayHit<TPart> | null {
  const u = (screenX - cam.cx) / (cam.focal * cam.scale);
  const w = (screenY - cam.cy) / (cam.focal * cam.scale);
  // 회전 좌표계에서의 광선: 원점 (0,0,dist), 방향 (u, w, -1)
  const invRot = transposeMat3(rot);
  const origin = add(applyMat3(invRot, v3(0, 0, cam.dist)), center);
  const dir = normalize(applyMat3(invRot, v3(u, w, -1)));

  let best: RayHit<TPart> | null = null;
  const { vertices, tris } = mesh;

  for (let i = 0; i < tris.length; i++) {
    const tri = tris[i];
    const a = vertices[tri.a];
    const b = vertices[tri.b];
    const c = vertices[tri.c];
    const e1 = sub(b, a);
    const e2 = sub(c, a);
    const pvec = cross(dir, e2);
    const det = dot(e1, pvec);
    if (Math.abs(det) < 1e-9) continue;
    const invDet = 1 / det;
    const tvec = sub(origin, a);
    const bu = dot(tvec, pvec) * invDet;
    if (bu < 0 || bu > 1) continue;
    const qvec = cross(tvec, e1);
    const bv = dot(dir, qvec) * invDet;
    if (bv < 0 || bu + bv > 1) continue;
    const t = dot(e2, qvec) * invDet;
    if (t <= 0) continue;
    if (best && t >= best.t) continue;
    best = {
      part: tri.part,
      t,
      point: add(origin, scale(dir, t)),
      normal: normalize(cross(e1, e2)),
    };
  }
  return best;
}

/** 메시 전체를 감싸는 축 정렬 박스의 중심과 크기 */
export function meshBounds(vertices: Vec3[]): { center: Vec3; size: Vec3 } {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  vertices.forEach((v) => {
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.z < minZ) minZ = v.z;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
    if (v.z > maxZ) maxZ = v.z;
  });
  return {
    center: v3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2),
    size: v3(maxX - minX, maxY - minY, maxZ - minZ),
  };
}
