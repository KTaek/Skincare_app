/**
 * 구워진 src/three/bodyMeshData.ts 를 앱과 똑같은 방식으로 되읽어 PNG로 렌더한다.
 * 파이프라인 중간 결과가 아니라 "앱이 실제로 그릴 것"을 확인하기 위한 도구.
 *
 *   node tools/previewBodyMesh.js            → tools/preview-body.png (회색 마네킹)
 *   node tools/previewBodyMesh.js parts      → tools/preview-parts.png (부위별 색)
 */
const fs = require('fs');
const path = require('path');
const { render } = require('./render');

const DATA = path.join(__dirname, '../src/three/bodyMeshData.ts');

/** TS 파일에서 배열 리터럴만 뽑아낸다 (생성 파일이라 형태가 고정) */
function loadBaked() {
  const src = fs.readFileSync(DATA, 'utf8');
  const grab = (name) => {
    const m = src.match(new RegExp(`export const ${name}[^=]*=\\s*(\\[[\\s\\S]*?\\n\\];)`));
    if (!m) throw new Error(`${name} 를 찾지 못했습니다`);
    return eval(m[1].replace(/\];$/, ']'));
  };
  const verts = grab('MESH_VERTICES');
  const idx = grab('MESH_INDICES');
  const ranges = grab('MESH_PART_RANGES');

  const vertices = [];
  for (let i = 0; i < verts.length; i += 3) vertices.push({ x: verts[i], y: verts[i + 1], z: verts[i + 2] });
  const tris = new Array(idx.length / 3);
  ranges.forEach(([part, start, count]) => {
    for (let t = start; t < start + count; t++) {
      tris[t] = { a: idx[t * 3], b: idx[t * 3 + 1], c: idx[t * 3 + 2], part };
    }
  });
  return { vertices, tris, ranges };
}

const COLORS = {
  head: [230, 120, 120], neck: [245, 175, 90], chest: [120, 180, 230], abdomen: [80, 135, 200],
  leftUpperArm: [130, 210, 130], leftElbow: [50, 145, 55], leftForearm: [180, 230, 140], leftHand: [240, 235, 110],
  rightUpperArm: [130, 210, 130], rightElbow: [50, 145, 55], rightForearm: [180, 230, 140], rightHand: [240, 235, 110],
  leftThigh: [200, 140, 220], leftKnee: [135, 65, 175], leftShank: [230, 175, 240], leftFoot: [255, 195, 85],
  rightThigh: [200, 140, 220], rightKnee: [135, 65, 175], rightShank: [230, 175, 240], rightFoot: [255, 195, 85],
};

const mesh = loadBaked();
const showParts = process.argv[2] === 'parts';
const out = path.join(__dirname, showParts ? 'preview-parts.png' : 'preview-body.png');
render(mesh, {
  out,
  colorFn: showParts
    ? (t, shade) => (COLORS[t.part] || [200, 200, 200]).map((c) => Math.min(255, Math.round(c * (0.55 + 0.5 * shade))))
    : undefined,
});
const missing = Object.keys(COLORS).filter((k) => !mesh.tris.some((t) => t.part === k));
console.log(`삼각형 ${mesh.tris.length} · 정점 ${mesh.vertices.length} · 부위 ${mesh.ranges.length}`);
console.log(`삼각형 없는 부위: ${missing.length ? missing.join(', ') : '없음'}`);
console.log(`→ ${path.relative(process.cwd(), out)}`);
