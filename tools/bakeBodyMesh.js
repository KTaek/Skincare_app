/**
 * assets/mesh/*.obj → src/three/bodyMeshData.ts 로 굽는 빌드 스크립트.
 *
 *   node tools/bakeBodyMesh.js [삼각형수]
 *
 * 하는 일
 *   1) OBJ 파싱 → 앱 좌표계(x 오른쪽 / y 아래 / z 앞, 키 = 1.74)로 변환
 *   2) QEM 감축 — JS 래스터라이저가 매 프레임 그려야 하므로 6천 개 안팎으로 줄인다
 *   3) 20개 부위 자동 태깅 — 메시에서 뽑은 관절로 뼈를 만들고 삼각형을 가장 가까운 뼈에 배정
 *   4) 부위별로 정렬해 "부위 = 삼각형 구간"으로 저장 (삼각형마다 태그를 들고 있지 않아도 된다)
 *
 * 결과를 눈으로 확인하려면: node tools/previewBodyMesh.js
 */
const fs = require('fs');
const path = require('path');
const { decimate } = require('./decimate');

const H = 1.74; // 모델 키 (모델 단위)
const OBJ = path.join(__dirname, '../assets/mesh/FinalBaseMesh.obj');
const OUT = path.join(__dirname, '../src/three/bodyMeshData.ts');

/* ------------------------------------------------------------------ 1. OBJ 로드 */

function loadObj(file, height = H) {
  const src = fs.readFileSync(file, 'utf8');
  const V = [];
  const F = [];
  for (const line of src.split('\n')) {
    if (line.startsWith('v ')) {
      const p = line.trim().split(/\s+/);
      V.push([+p[1], +p[2], +p[3]]);
    } else if (line.startsWith('f ')) {
      const idx = line.trim().split(/\s+/).slice(1).map((t) => parseInt(t.split('/')[0], 10) - 1);
      for (let i = 1; i + 1 < idx.length; i++) F.push([idx[0], idx[i], idx[i + 1]]); // n각형 → 팬 삼각화
    }
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  V.forEach(([x, y, z]) => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  });
  const s = height / (maxY - minY);
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  return {
    // OBJ는 y가 위로 향하므로 뒤집는다. 감김 방향도 앱 규칙(바깥 = CCW)에 맞춰 b/c를 바꾼다.
    vertices: V.map(([x, y, z]) => ({ x: (x - cx) * s, y: (maxY - y) * s, z: (z - cz) * s })),
    tris: F.map(([a, b, c]) => ({ a, b: c, c: b, part: 'base' })),
  };
}

/* ------------------------------------------------ 2. 관절 추출 (슬라이스 프로파일) */

/** y 슬랩을 x로 클러스터링 — 겨드랑이 아래면 팔이, 가랑이 아래면 다리가 따로 잡힌다 */
function sliceClusters(vertices, y0, y1, gap = 0.012) {
  const sel = vertices.filter((v) => v.y >= y0 && v.y < y1).sort((a, b) => a.x - b.x);
  if (!sel.length) return [];
  const groups = [[sel[0]]];
  for (let i = 1; i < sel.length; i++) {
    if (sel[i].x - sel[i - 1].x > gap) groups.push([]);
    groups[groups.length - 1].push(sel[i]);
  }
  return groups.filter((g) => g.length >= 4).map((g) => {
    const at = (k) => g.map((v) => v[k]);
    const mid = (k) => (Math.max(...at(k)) + Math.min(...at(k))) / 2;
    const half = (k) => (Math.max(...at(k)) - Math.min(...at(k))) / 2;
    return { y: (y0 + y1) / 2, x: mid('x'), z: mid('z'), rx: half('x'), rz: half('z'), n: g.length };
  });
}

/**
 * 메시에서 관절 위치를 찾는다.
 * y는 키 대비 비율, x·z·반지름은 모델 단위. 값은 모두 슬라이스 프로파일에서 읽어낸 것이라
 * 다른 체형의 OBJ로 바꿔도 대체로 따라간다.
 */
function findJoints(mesh) {
  const steps = 120;
  const slices = [];
  for (let i = 0; i < steps; i++) {
    const y0 = (i / steps) * H;
    slices.push({ t: (i + 0.5) / steps, clusters: sliceClusters(mesh.vertices, y0, y0 + H / steps) });
  }
  const lateral = (s) => s.clusters.filter((c) => Math.abs(c.x) > 0.03).sort((a, b) => a.x - b.x);
  const armpit = slices.find((s) => s.t > 0.2 && lateral(s).length >= 2); // 팔이 몸통에서 떨어지는 높이
  // 다리는 몸통 근처(|x| < 0.25)에서 두 덩어리로 갈라지는 높이 — 팔·손 덩어리는 제외한다
  const legSplit = slices.find(
    (s) => s.t > 0.45 && s.clusters.filter((c) => Math.abs(c.x) < 0.25).length === 2,
  );

  // 팔: 겨드랑이에서 시작해 바깥쪽(+x) 덩어리를 손끝까지 이어 따라간다.
  // 팔이 끝나는 높이 아래에는 다리가 바깥쪽 덩어리로 잡히므로, 팔보다 안쪽(x가 작은)이면 끊는다.
  const armMinX = Math.abs(lateral(armpit)[lateral(armpit).length - 1].x) * 0.8;
  const armPts = [];
  for (const s of slices) {
    if (s.t < armpit.t) continue;
    const outer = s.clusters.filter((c) => c.x > armMinX).sort((a, b) => a.x - b.x).pop();
    if (!outer) break;
    armPts.push({ t: s.t, c: outer });
  }
  const radius = (p) => (p.c.rx + p.c.rz) / 2;
  // 손목 = 팔꿈치 아래로 계속 가늘어지다가 손바닥에서 다시 굵어지기 직전.
  // 그냥 최소값을 찾으면 손끝(가장 가는 곳)이 잡힌다.
  let wrist = armPts[armPts.length - 1];
  for (let i = 1; i < armPts.length; i++) {
    if (armPts[i].t < armpit.t + 0.08) continue;
    if (radius(armPts[i]) > radius(armPts[i - 1]) * 1.02) { wrist = armPts[i - 1]; break; }
  }
  const tip = armPts[armPts.length - 1];
  // 겨드랑이~손목 직선을 위로 연장해 어깨 관절 위치를 잡는다
  const slope = (wrist.c.x - armPts[0].c.x) / (wrist.t - armPts[0].t);
  const shoulderT = armpit.t - 0.075;
  const shoulder = { y: shoulderT, x: armPts[0].c.x - slope * 0.075, z: armPts[0].c.z + 0.01 };

  // 다리: 가랑이 아래 오른쪽 덩어리의 반지름 곡선에서 무릎(가장 가는 곳)과 발목(그 아래 최소)을 찾는다
  const legPts = slices
    .filter((s) => s.t >= legSplit.t && s.clusters.length >= 2)
    .map((s) => ({ t: s.t, c: s.clusters.filter((c) => c.x > 0).sort((a, b) => b.n - a.n)[0] }))
    .filter((p) => p.c);
  const inRange = (lo, hi) => legPts.filter((p) => p.t >= lo && p.t <= hi);
  const minR = (arr) => arr.reduce((m, p) => ((p.c.rx + p.c.rz) < (m.c.rx + m.c.rz) ? p : m), arr[0]);
  const knee = minR(inRange(0.66, 0.76));
  const ankle = minR(inRange(0.85, 0.94));
  const toe = legPts[legPts.length - 1];

  // 허리 = 몸통이 가장 잘록한 높이 (가슴/배 경계)
  const torsoPts = slices
    .filter((s) => s.t > 0.3 && s.t < 0.45)
    .map((s) => ({ t: s.t, c: s.clusters.filter((c) => Math.abs(c.x) < 0.15).sort((a, b) => b.n - a.n)[0] }))
    .filter((p) => p.c);
  const legHalves = legSplit.clusters.filter((c) => Math.abs(c.x) < 0.25).sort((a, b) => a.x - b.x);

  return {
    chin: 0.12,
    shoulderLine: 0.185,
    waist: minR(torsoPts).t,
    crotch: legSplit.t - 0.012,
    shoulder,
    wrist: { y: wrist.t, x: wrist.c.x, z: wrist.c.z },
    fingertip: { y: tip.t, x: tip.c.x, z: tip.c.z },
    hip: { y: legSplit.t - 0.012, x: legHalves[1].x, z: legHalves[1].z },
    knee: { y: knee.t, x: knee.c.x, z: knee.c.z },
    ankle: { y: ankle.t, x: ankle.c.x, z: ankle.c.z },
    toe: { y: toe.t, x: toe.c.x, z: toe.c.z + 0.06 },
  };
}

/* ------------------------------------------------------------- 3. 부위 태깅 */

const lerpJ = (a, b, t) => ({ y: a.y + (b.y - a.y) * t, x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });

function bones(J) {
  const out = [];
  const P = (p) => ({ x: p.x, y: p.y * H, z: p.z });
  const add = (part, a, b, r) => out.push({ part, a: P(a), b: P(b), r });

  add('head', { y: 0.03, x: 0, z: 0.01 }, { y: J.chin, x: 0, z: 0 }, 0.085);
  add('neck', { y: J.chin, x: 0, z: 0 }, { y: J.shoulderLine, x: 0, z: -0.035 }, 0.07);
  add('chest', { y: J.shoulderLine, x: 0, z: -0.03 }, { y: J.waist, x: 0, z: -0.01 }, 0.135);
  add('abdomen', { y: J.waist, x: 0, z: -0.01 }, { y: J.crotch, x: 0, z: -0.01 }, 0.14);

  [-1, 1].forEach((s) => {
    const side = s < 0 ? 'left' : 'right';
    const m = (p) => ({ y: p.y, x: p.x * s, z: p.z });
    const S = m(J.shoulder), W = m(J.wrist), F = m(J.fingertip);
    // 어깨→손목을 0~1로 보고 팔꿈치 구간을 0.50~0.63으로 잡는다 (팔오금/팔꿈치 탭 영역)
    add(`${side}UpperArm`, S, lerpJ(S, W, 0.5), 0.062);
    add(`${side}Elbow`, lerpJ(S, W, 0.5), lerpJ(S, W, 0.63), 0.056);
    add(`${side}Forearm`, lerpJ(S, W, 0.63), W, 0.042);
    add(`${side}Hand`, W, F, 0.04);

    const HIP = m(J.hip), K = m(J.knee), A = m(J.ankle), T = m(J.toe);
    add(`${side}Thigh`, HIP, lerpJ(HIP, K, 0.83), 0.082);
    add(`${side}Knee`, lerpJ(HIP, K, 0.83), lerpJ(K, A, 0.28), 0.056);
    add(`${side}Shank`, lerpJ(K, A, 0.28), A, 0.05);
    add(`${side}Foot`, A, T, 0.06);
  });
  return out;
}

/** 뼈 구간 밖으로 벗어난 정도에 벌점을 주는 허용치 (모델 단위) */
const AXIAL_TOL = 0.022;

/**
 * 점수 = √((반지름방향 거리 / 뼈 굵기)² + (축방향 이탈 / 허용치)²).
 * 거리 비율만 쓰면 굵은 가슴 뼈의 끝이 목·엉덩이까지 삼켜버려서 축 이탈을 함께 본다.
 */
function boneScore(p, bone) {
  const abx = bone.b.x - bone.a.x, aby = bone.b.y - bone.a.y, abz = bone.b.z - bone.a.z;
  const apx = p.x - bone.a.x, apy = p.y - bone.a.y, apz = p.z - bone.a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  const traw = len2 > 0 ? (apx * abx + apy * aby + apz * abz) / len2 : 0;
  const t = Math.max(0, Math.min(1, traw));
  const radial = Math.hypot(apx - abx * t, apy - aby * t, apz - abz * t);
  const overshoot = (traw < 0 ? -traw : traw > 1 ? traw - 1 : 0) * Math.sqrt(len2);
  return Math.hypot(radial / bone.r, overshoot / AXIAL_TOL);
}

/** 경계에 홀로 튄 삼각형을 이웃 다수결로 정리한다 */
function smoothParts(mesh, rounds = 3) {
  const edges = new Map();
  mesh.tris.forEach((t, i) => {
    [[t.a, t.b], [t.b, t.c], [t.c, t.a]].forEach(([u, v]) => {
      const k = u < v ? `${u}_${v}` : `${v}_${u}`;
      const list = edges.get(k);
      if (list) list.push(i); else edges.set(k, [i]);
    });
  });
  const nbr = mesh.tris.map(() => []);
  edges.forEach((list) => {
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) { nbr[list[i]].push(list[j]); nbr[list[j]].push(list[i]); }
  });
  for (let r = 0; r < rounds; r++) {
    const next = mesh.tris.map((t) => t.part);
    mesh.tris.forEach((t, i) => {
      const tally = {};
      nbr[i].forEach((j) => { tally[mesh.tris[j].part] = (tally[mesh.tris[j].part] || 0) + 1; });
      const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
      if (top && top[1] > (tally[t.part] || 0)) next[i] = top[0];
    });
    mesh.tris.forEach((t, i) => { t.part = next[i]; });
  }
}

function segment(mesh, J) {
  const BONES = bones(J);
  mesh.tris.forEach((t) => {
    const a = mesh.vertices[t.a], b = mesh.vertices[t.b], c = mesh.vertices[t.c];
    const p = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3, z: (a.z + b.z + c.z) / 3 };
    let best = BONES[0], bestScore = Infinity;
    for (const bone of BONES) {
      const s = boneScore(p, bone);
      if (s < bestScore) { bestScore = s; best = bone; }
    }
    t.part = best.part;
  });
  smoothParts(mesh);
  return mesh;
}

/* ---------------------------------------------------------------- 4. 굽기 */

function bake(targetTris) {
  const raw = loadObj(OBJ);
  const J = findJoints(raw);
  const small = decimate(raw, targetTris);
  segment(small, J);

  // 부위별로 모아 두면 앱에서 삼각형마다 태그를 들고 있지 않아도 되고, 렌더 시 그룹핑도 공짜다
  small.tris.sort((p, q) => (p.part < q.part ? -1 : p.part > q.part ? 1 : 0));
  const ranges = [];
  small.tris.forEach((t, i) => {
    const last = ranges[ranges.length - 1];
    if (last && last.part === t.part) last.count++;
    else ranges.push({ part: t.part, start: i, count: 1 });
  });

  const q = (n) => Math.round(n * 10000) / 10000;
  const verts = [];
  small.vertices.forEach((v) => verts.push(q(v.x), q(v.y), q(v.z)));
  const idx = [];
  small.tris.forEach((t) => idx.push(t.a, t.b, t.c));

  const wrap = (arr, per) => {
    const lines = [];
    for (let i = 0; i < arr.length; i += per) lines.push('  ' + arr.slice(i, i + per).join(','));
    return lines.join(',\n');
  };

  const ts = `/* eslint-disable */
/**
 * 자동 생성 파일 — 직접 고치지 마세요.
 *   원본: assets/mesh/${path.basename(OBJ)}
 *   생성: node tools/bakeBodyMesh.js ${targetTris}
 *
 * 좌표계: x 오른쪽 / y 아래(머리 0, 발 ${H}) / z 앞. 삼각형은 부위별로 정렬되어 있다.
 */
import { BodyPartId } from '../monitoring/bodyParts';

/** 모델 키 (모델 단위) */
export const MESH_HEIGHT = ${H};

/** [x,y,z] * 정점수 */
export const MESH_VERTICES: number[] = [
${wrap(verts, 9)},
];

/** [a,b,c] * 삼각형수 — 정점 인덱스 */
export const MESH_INDICES: number[] = [
${wrap(idx, 12)},
];

/** 부위별 삼각형 구간 [부위, 시작 삼각형, 개수] */
export const MESH_PART_RANGES: [BodyPartId, number, number][] = [
${ranges.map((r) => `  ['${r.part}', ${r.start}, ${r.count}]`).join(',\n')},
];
`;
  fs.writeFileSync(OUT, ts);

  const counts = {};
  small.tris.forEach((t) => { counts[t.part] = (counts[t.part] || 0) + 1; });
  console.log(`관절(키 비율): 어깨 ${J.shoulder.y.toFixed(3)}/x${J.shoulder.x.toFixed(3)} 손목 ${J.wrist.y.toFixed(3)} 손끝 ${J.fingertip.y.toFixed(3)} 허리 ${J.waist.toFixed(3)} 가랑이 ${J.crotch.toFixed(3)} 무릎 ${J.knee.y.toFixed(3)} 발목 ${J.ankle.y.toFixed(3)} 발끝 ${J.toe.y.toFixed(3)}`);
  console.log(`삼각형 ${small.tris.length}, 정점 ${small.vertices.length}, 부위 ${ranges.length}개 구간`);
  console.log(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  '));
  console.log(`→ ${path.relative(process.cwd(), OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)}KB)`);
  return small;
}

if (require.main === module) bake(Number(process.argv[2]) || 6000);

module.exports = { bake, loadObj, findJoints, segment };
