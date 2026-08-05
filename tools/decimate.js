/**
 * 이차오차(QEM) 기반 에지 축약 감축기.
 * 실루엣을 최대한 지키면서 삼각형 수를 줄인다 — 격자 클러스터링과 달리
 * 손가락처럼 가까이 붙은 부위가 서로 붙어버리지 않는다(에지를 따라서만 합치므로).
 */

function decimate(mesh, targetTris) {
  const V = mesh.vertices.map((v) => ({ x: v.x, y: v.y, z: v.z }));
  const T = mesh.tris.map((t) => ({ a: t.a, b: t.b, c: t.c, dead: false }));
  const nV = V.length;

  // 정점별 quadric (대칭 4x4 → 10개 계수)
  const Q = new Float64Array(nV * 10);
  const addQuadric = (i, p) => { for (let k = 0; k < 10; k++) Q[i * 10 + k] += p[k]; };
  const planeQ = (t) => {
    const a = V[t.a], b = V[t.b], c = V[t.c];
    const e1 = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const e2 = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
    let nx = e1.y * e2.z - e1.z * e2.y, ny = e1.z * e2.x - e1.x * e2.z, nz = e1.x * e2.y - e1.y * e2.x;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) return null;
    nx /= l; ny /= l; nz /= l;
    const d = -(nx * a.x + ny * a.y + nz * a.z);
    return [nx * nx, nx * ny, nx * nz, nx * d, ny * ny, ny * nz, ny * d, nz * nz, nz * d, d * d];
  };
  T.forEach((t) => { const p = planeQ(t); if (p) { addQuadric(t.a, p); addQuadric(t.b, p); addQuadric(t.c, p); } });

  const quadError = (i, j, p) => {
    const q = new Float64Array(10);
    for (let k = 0; k < 10; k++) q[k] = Q[i * 10 + k] + Q[j * 10 + k];
    const { x, y, z } = p;
    return (
      q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x +
      q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y +
      q[7] * z * z + 2 * q[8] * z + q[9]
    );
  };

  // 정점 → 인접 삼각형
  const around = Array.from({ length: nV }, () => new Set());
  T.forEach((t, i) => { around[t.a].add(i); around[t.b].add(i); around[t.c].add(i); });

  const key = (i, j) => (i < j ? i * nV + j : j * nV + i);
  const heap = [];
  const push = (e) => {
    heap.push(e);
    let c = heap.length - 1;
    while (c > 0) { const p = (c - 1) >> 1; if (heap[p].cost <= heap[c].cost) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) { heap[0] = last; let p = 0;
      for (;;) { const l = p * 2 + 1, r = l + 1; let s = p;
        if (l < heap.length && heap[l].cost < heap[s].cost) s = l;
        if (r < heap.length && heap[r].cost < heap[s].cost) s = r;
        if (s === p) break; [heap[p], heap[s]] = [heap[s], heap[p]]; p = s; } }
    return top;
  };

  const version = new Int32Array(nV);
  const alive = new Uint8Array(nV).fill(1);
  const candidates = (i, j) => {
    const a = V[i], b = V[j];
    return [a, b, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }];
  };
  const bestPlacement = (i, j) => {
    let best = null, bestCost = Infinity;
    for (const p of candidates(i, j)) { const c = quadError(i, j, p); if (c < bestCost) { bestCost = c; best = p; } }
    return { cost: bestCost, p: best };
  };
  const addEdge = (i, j) => {
    const { cost, p } = bestPlacement(i, j);
    push({ i, j, cost, p, vi: version[i], vj: version[j] });
  };

  const edges = new Set();
  T.forEach((t) => { [[t.a, t.b], [t.b, t.c], [t.c, t.a]].forEach(([i, j]) => { const k = key(i, j); if (!edges.has(k)) { edges.add(k); addEdge(i, j); } }); });

  const triNormal = (t, override) => {
    const g = (idx) => (override && override.from === idx ? override.to : V[idx]);
    const a = g(t.a), b = g(t.b), c = g(t.c);
    const e1 = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const e2 = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
    return { x: e1.y * e2.z - e1.z * e2.y, y: e1.z * e2.x - e1.x * e2.z, z: e1.x * e2.y - e1.y * e2.x };
  };

  let liveTris = T.length;
  while (liveTris > targetTris && heap.length) {
    const e = pop();
    if (!alive[e.i] || !alive[e.j] || e.vi !== version[e.i] || e.vj !== version[e.j]) continue;

    // j를 i로 합친다. 접히거나 뒤집히는 삼각형이 생기면 취소.
    const affected = new Set([...around[e.i], ...around[e.j]]);
    let flip = false;
    for (const ti of affected) {
      const t = T[ti];
      if (t.dead) continue;
      const has = (t.a === e.j || t.b === e.j || t.c === e.j) || (t.a === e.i || t.b === e.i || t.c === e.i);
      if (!has) continue;
      const degenerate = [t.a, t.b, t.c].filter((v) => v === e.i || v === e.j).length === 2;
      if (degenerate) continue; // 축약으로 사라질 삼각형
      const before = triNormal(t);
      const after = triNormal(t, { from: t.a === e.j || t.b === e.j || t.c === e.j ? e.j : e.i, to: e.p });
      const dot = before.x * after.x + before.y * after.y + before.z * after.z;
      const la = Math.hypot(after.x, after.y, after.z);
      if (la < 1e-14 || dot <= 0) { flip = true; break; }
    }
    if (flip) continue;

    V[e.i] = e.p;
    alive[e.j] = 0;
    for (let k = 0; k < 10; k++) Q[e.i * 10 + k] += Q[e.j * 10 + k];

    for (const ti of around[e.j]) {
      const t = T[ti];
      if (t.dead) continue;
      if (t.a === e.j) t.a = e.i;
      if (t.b === e.j) t.b = e.i;
      if (t.c === e.j) t.c = e.i;
      if (t.a === t.b || t.b === t.c || t.c === t.a) { t.dead = true; liveTris--; }
      else around[e.i].add(ti);
    }
    around[e.j].clear();
    version[e.i]++;

    // 새 이웃들과의 에지를 다시 평가
    const nb = new Set();
    for (const ti of around[e.i]) { const t = T[ti]; if (t.dead) continue; [t.a, t.b, t.c].forEach((v) => { if (v !== e.i && alive[v]) nb.add(v); }); }
    nb.forEach((v) => addEdge(e.i, v));
  }

  // 살아남은 정점만 남겨 재색인
  const remap = new Int32Array(nV).fill(-1);
  const outV = [];
  T.forEach((t) => { if (t.dead) return; [t.a, t.b, t.c].forEach((v) => { if (remap[v] < 0) { remap[v] = outV.length; outV.push(V[v]); } }); });
  const outT = T.filter((t) => !t.dead).map((t) => ({ a: remap[t.a], b: remap[t.b], c: remap[t.c], part: 'base' }));
  return { vertices: outV, tris: outT };
}

module.exports = { decimate };
