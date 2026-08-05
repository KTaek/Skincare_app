import { BodyPartId } from '../monitoring/bodyParts';
import { Mesh, v3, Vec3 } from './geom3d';
import { MESH_HEIGHT, MESH_INDICES, MESH_PART_RANGES, MESH_VERTICES } from './bodyMeshData';

/**
 * 인체 3D 모델.
 *
 * 실제 인체 베이스 메시(assets/mesh/FinalBaseMesh.obj)를 빌드 타임에 구워서 쓴다.
 *   - 감축·부위 태깅은 tools/bakeBodyMesh.js 가 하고, 결과가 bodyMeshData.ts 다.
 *   - 메시를 바꾸려면 OBJ를 갈아 끼우고 `node tools/bakeBodyMesh.js` 를 다시 돌리면 된다.
 *     화면 코드는 Mesh<BodyPartId> 인터페이스만 알면 되므로 손댈 필요가 없다.
 *
 * 좌표계: x 오른쪽 / y 아래(머리 0, 발바닥 = 키) / z 앞.
 */

export type BodyModelId = 'adultMale' | 'adultFemale' | 'child';

export interface BodyModelPreset {
  id: BodyModelId;
  label: string;
  caption: string;
  /** 모델 전체 키 (모델 단위) */
  height: number;
}

export const BODY_MODEL_PRESETS: BodyModelPreset[] = [
  { id: 'adultMale', label: '성인 남성', caption: '표준 성인 체형', height: MESH_HEIGHT },
  { id: 'adultFemale', label: '성인 여성', caption: '표준 성인 체형', height: 1.62 },
  { id: 'child', label: '아동', caption: '소아 체형', height: 1.2 },
];

export const getPreset = (id: BodyModelId): BodyModelPreset =>
  BODY_MODEL_PRESETS.find((p) => p.id === id) ?? BODY_MODEL_PRESETS[0];

/** 구워 둔 메시 — 한 번만 펼쳐서 재사용한다 (정점 3천, 삼각형 6천 규모) */
let baked: Mesh<BodyPartId> | null = null;

function bakedMesh(): Mesh<BodyPartId> {
  if (baked) return baked;

  const vertices: Vec3[] = new Array(MESH_VERTICES.length / 3);
  for (let i = 0, k = 0; i < MESH_VERTICES.length; i += 3, k++) {
    vertices[k] = v3(MESH_VERTICES[i], MESH_VERTICES[i + 1], MESH_VERTICES[i + 2]);
  }

  // 삼각형은 부위별로 정렬되어 저장돼 있어서, 구간마다 태그를 채워 넣으면 된다
  const tris: Mesh<BodyPartId>['tris'] = new Array(MESH_INDICES.length / 3);
  MESH_PART_RANGES.forEach(([part, start, count]) => {
    for (let t = start; t < start + count; t++) {
      const i = t * 3;
      tris[t] = { a: MESH_INDICES[i], b: MESH_INDICES[i + 1], c: MESH_INDICES[i + 2], part };
    }
  });

  baked = { vertices, tris };
  return baked;
}

/** 프리셋 키에 맞춘 전신 메시 (부위 태그 포함) */
export function buildBodyMesh(preset: BodyModelPreset): Mesh<BodyPartId> {
  const mesh = bakedMesh();
  const s = preset.height / MESH_HEIGHT;
  if (Math.abs(s - 1) < 1e-6) return mesh;
  return { vertices: mesh.vertices.map((p) => v3(p.x * s, p.y * s, p.z * s)), tris: mesh.tris };
}

/**
 * 좌/우 이름은 "화면 기준"이다 — 정면을 볼 때 화면 왼쪽(-x)이 left* 부위다.
 * 기존 2D 그림(bodyShapes.ts)의 leftArm/rightArm도 화면 기준이라 두 화면의 라벨이 어긋나지 않는다.
 * 환자 기준(해부학적 좌우)으로 바꾸려면 여기와 bodyShapes.ts를 함께 뒤집어야 한다.
 */
