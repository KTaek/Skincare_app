import { findMaskBlobs, type MaskBlob } from './maskBlobs';
import { expandInMask, type MaskBounds, type MaskRect } from './maskToBbox';

/**
 * 중증도를 따로 매길 "판정 단위"를 정한다.
 *
 * 규칙은 두 단계다.
 *
 * **1) 모양 사이 거리로 묶는다** — 두 덩어리의 경계 사이 빈 픽셀이 mergeGapPixels 이하면 한
 * 단위로 본다. 임계값 0.5에서 마스크가 얇게 끊긴 한 병변을 다시 붙이고, 눈에 띄게 떨어진 두
 * 곳은 따로 둔다. 병변 크기와 방향에 무관해서 "가장자리 사이가 N px 이하면 한 덩어리"라는 한
 * 문장으로 설명된다.
 *
 * 예전에는 크롭 사각형이 상대 병변을 품는지로 판정했는데, 크롭은 자기 크기의 15%만큼 넓어지므로
 * 큰 병변일수록 멀리 있는 것까지 끌어당겼다(도달거리 1.2%~12%로 U자). 사진에서 봐도 두 곳인데
 * 하나로 묶이는 일이 그래서 생겼다.
 *
 * **2) 크롭에 남는 남의 병변이 과하면 그때 합친다** — 모델 입력은 여전히 사각 크롭이라, 따로
 * 둔 단위의 크롭에 옆 병변이 조금 들어올 수 있다. 그 양을 세서 자기 병변 대비
 * mergeForeignRatio를 넘으면(그 등급이 자기보다 이웃에 대한 것이 되는 경우) 합친다. 넘지
 * 않으면 따로 두고 foreignPct로 남겨, 화면이 "옆 병변이 일부 함께 찍혔다"고 말할 수 있게 한다.
 *
 * 모양대로 잘라 넣지 않는(모양 밖을 지우지 않는) 이유: 중증도 모델은 사각 크롭의 자연스러운
 * 피부 사진만 보고 학습했다(tools/export_models.py의 cls_input 규격). 모양 밖을 지우면 학습에서
 * 본 적 없는 평평한 면과 딱딱한 경계가 생기고, 등급 판정이 기대는 "주변 정상 피부와의 대조"가
 * 사라진다. 실측해 보면 이렇게 따로 둘 때 섞여 드는 남의 병변은 자기 면적의 몇 % 수준이라,
 * 입력을 학습 분포 밖으로 밀어내면서까지 지울 값이 아니다.
 */

export interface LesionRegion {
  /** 중증도 모델에 넣을 크롭 (마스크 격자 좌표) */
  crop: MaskRect;
  /** 이 판정 단위에 속한 마스크 픽셀 수 (묶인 덩어리 합산) */
  pixels: number;
  /** 이 단위로 묶인 연결 덩어리 수 — 1이면 묶은 것이 없다 */
  mergedBlobs: number;
  /** 크롭에 섞여 든 다른 단위의 병변 픽셀 비율 (자기 병변 픽셀 대비 %) */
  foreignPct: number;
}

export interface LesionRegionsResult {
  /** 픽셀 수 내림차순. 마스크가 비면 빈 배열 */
  regions: LesionRegion[];
  /** 픽셀 → regions 인덱스. 마스크 바깥과 제외된 덩어리는 -1 */
  regionOf: Int32Array;
  /** 판정에서 제외한 덩어리 수 (너무 작거나 개수 상한을 넘은 것) */
  dropped: number;
}

export interface LesionRegionOptions {
  /** 크롭 여백 (labels.json의 crop_margin) */
  margin?: number;
  /** 크롭 최소 크기, 이미지 변의 비율 (labels.json의 min_crop_ratio) */
  minRatio?: number;
  /**
   * 경계 사이 빈 픽셀이 이 값 이하면 한 단위로 묶는다 (마스크 격자 기준).
   * 512 격자에서 10px ≈ 화면의 2%.
   */
  mergeGapPixels?: number;
  /** 크롭에 든 남의 병변이 자기 병변의 이 비율을 넘으면 합친다 */
  mergeForeignRatio?: number;
  /** 가장 큰 판정 단위 대비 이 비율보다 작으면 잡음으로 보고 등급을 매기지 않는다 */
  minPixelRatio?: number;
  /** 판정 단위 수 상한 — 하나당 중증도 추론이 한 번 더 돌기 때문에 상한이 필요하다 */
  maxRegions?: number;
}

export function buildLesionRegions(
  mask: Float32Array,
  maskW: number,
  maskH: number,
  threshold: number,
  opts: LesionRegionOptions = {},
): LesionRegionsResult {
  const margin = opts.margin ?? 0.15;
  const minRatio = opts.minRatio ?? 0.1;
  const mergeGapPixels = opts.mergeGapPixels ?? 10;
  const mergeForeignRatio = opts.mergeForeignRatio ?? 0.5;
  const minPixelRatio = opts.minPixelRatio ?? 0.05;
  const maxRegions = opts.maxRegions ?? 3;

  const { blobs, labels, droppedTiny } = findMaskBlobs(mask, maskW, maskH, threshold);
  if (blobs.length === 0) {
    return { regions: [], regionOf: labels, dropped: 0 };
  }

  const uf = makeUnionFind(blobs.length);
  const cropOf = (bounds: MaskBounds) => expandInMask(bounds, maskW, maskH, { margin, minRatio });

  // 1단계: 모양 사이 거리로 묶는다
  unionNearbyBlobs(labels, maskW, maskH, uf, mergeGapPixels);

  // 2단계: 등급을 매길 단위들의 크롭을 보고, 남의 병변이 과한 것만 추가로 합친다.
  //        합치면 순위가 바뀌어 다른 단위가 상위로 올라올 수 있으므로 변화가 없을 때까지 되풀이한다.
  for (let pass = 0; pass < blobs.length; pass++) {
    const top = topGroups(blobs, uf, minPixelRatio, maxRegions);
    const topRoots = new Set(top.map((g) => g.root));
    let merged = false;

    for (const g of top) {
      const foreign = foreignInCrop(labels, maskW, cropOf(g.bounds), uf, g.root);
      for (const [otherRoot, count] of foreign.byRoot) {
        // 등급을 매기지 않는 잔 덩어리와는 합치지 않는다 — 어차피 비율이 이 문턱을 넘지 못한다
        if (!topRoots.has(otherRoot)) continue;
        if (count >= g.pixels * mergeForeignRatio) {
          uf.union(g.root, otherRoot);
          merged = true;
          break;
        }
      }
      if (merged) break;
    }
    if (!merged) break;
  }

  // 큰 순으로 두고, 가장 큰 것 대비 너무 작은 것과 상한을 넘은 것은 등급을 매기지 않는다.
  // (마스크 면적 maskAreaPct에는 그대로 포함된다 — 제외한 것은 등급이지 넓이가 아니다)
  const groups = collectGroups(blobs, uf).sort((a, b) => b.pixels - a.pixels);
  const cutoff = groups[0].pixels * minPixelRatio;
  const kept = groups.filter((g) => g.pixels >= cutoff).slice(0, maxRegions);

  // 픽셀 → 판정 단위 번호. 오버레이가 단위마다 다른 색으로 칠하는 데 쓴다.
  const blobToRegion = new Int32Array(blobs.length).fill(-1);
  kept.forEach((g, regionIndex) => {
    g.members.forEach((blobIndex) => {
      blobToRegion[blobIndex] = regionIndex;
    });
  });

  const regions = kept.map((g) => {
    const crop = cropOf(g.bounds);
    // 고지용 오염량은 제외된 잔 덩어리까지 모두 센다 — 모델 입력에 실제로 들어간 것이 기준이다
    const foreign = foreignInCrop(labels, maskW, crop, uf, g.root);
    return {
      crop,
      pixels: g.pixels,
      mergedBlobs: g.members.length,
      foreignPct: Math.round((foreign.total / g.pixels) * 1000) / 10,
    };
  });

  const regionOf = labels;
  for (let i = 0; i < regionOf.length; i++) {
    const blob = regionOf[i];
    if (blob !== -1) regionOf[i] = blobToRegion[blob];
  }

  return { regions, regionOf, dropped: groups.length - kept.length + droppedTiny };
}

interface BlobGroup {
  root: number;
  members: number[];
  bounds: MaskBounds;
  pixels: number;
}

function makeUnionFind(n: number) {
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    while (parent[i] !== root) {
      const next = parent[i];
      parent[i] = root;
      i = next;
    }
    return root;
  };
  return {
    find,
    union(a: number, b: number) {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    },
  };
}

type UnionFind = ReturnType<typeof makeUnionFind>;

/**
 * 모양 사이 거리로 묶기 — 모든 병변 픽셀에서 동시에 퍼뜨리는 BFS 한 번으로 끝낸다.
 *
 * 각 칸은 (어느 덩어리에서 왔는지, 몇 걸음 왔는지)를 들고 있고, 서로 다른 덩어리에서 온 칸이
 * 만나는 자리에서 두 걸음수의 합이 gap 이하면 그 두 덩어리를 묶는다. 걸음수 합이 곧 두 병변
 * 경계 사이의 빈 픽셀 수다.
 *
 * 8-이웃 균일 비용이라 거리가 체비쇼프 거리다 — 대각선 간격을 조금 짧게 본다(10,10 떨어진 것을
 * 10으로). 이 판단에는 문제가 되지 않는 수준이고, 대신 격자를 한 번만 훑는다.
 */
function unionNearbyBlobs(
  labels: Int32Array,
  maskW: number,
  maskH: number,
  uf: UnionFind,
  gap: number,
): void {
  const n = maskW * maskH;
  const owner = new Int32Array(n).fill(-1);
  const dist = new Uint8Array(n).fill(255);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;

  for (let i = 0; i < n; i++) {
    if (labels[i] >= 0) {
      owner[i] = labels[i];
      dist[i] = 0;
      queue[tail++] = i;
    }
  }

  while (head < tail) {
    const p = queue[head++];
    const d = dist[p];
    // 여기서 더 퍼뜨려도 gap 안에서 만날 수 없다 (반대쪽에서 오는 만남은 그쪽이 찾는다)
    if (d >= gap) continue;

    const x = p % maskW;
    const y = (p - x) / maskW;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= maskH) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        if ((dx === 0 && dy === 0) || nx < 0 || nx >= maskW) continue;

        const q = ny * maskW + nx;
        if (dist[q] === 255) {
          owner[q] = owner[p];
          dist[q] = d + 1;
          queue[tail++] = q;
        } else if (d + dist[q] <= gap) {
          uf.union(owner[p], owner[q]);
        }
      }
    }
  }
}

/** 크롭 안에 있는 다른 단위의 병변 픽셀 — 합계와 단위별 내역 */
function foreignInCrop(
  labels: Int32Array,
  maskW: number,
  crop: MaskRect,
  uf: UnionFind,
  root: number,
): { total: number; byRoot: Map<number, number> } {
  // 크롭은 실수 사각형이다 — 일부라도 걸치는 픽셀은 크롭에 들어간 것으로 본다
  // (최종 크롭을 원본 좌표로 옮길 때도 floor/ceil로 같은 판단을 한다)
  const x0 = Math.floor(crop.x1);
  const x1 = Math.ceil(crop.x2) - 1;
  const y0 = Math.floor(crop.y1);
  const y1 = Math.ceil(crop.y2) - 1;

  const byRoot = new Map<number, number>();
  let total = 0;
  for (let y = y0; y <= y1; y++) {
    const row = y * maskW;
    for (let x = x0; x <= x1; x++) {
      const blob = labels[row + x];
      if (blob < 0) continue;
      const r = uf.find(blob);
      if (r === root) continue;
      total += 1;
      byRoot.set(r, (byRoot.get(r) ?? 0) + 1);
    }
  }
  return { total, byRoot };
}

/** 지금 묶임 상태에서 등급을 매길 단위들 (큰 순, 크기 미달·상한 초과 제외) */
function topGroups(
  blobs: MaskBlob[],
  uf: UnionFind,
  minPixelRatio: number,
  maxRegions: number,
): BlobGroup[] {
  const groups = collectGroups(blobs, uf).sort((a, b) => b.pixels - a.pixels);
  const cutoff = groups[0].pixels * minPixelRatio;
  return groups.filter((g) => g.pixels >= cutoff).slice(0, maxRegions);
}

function collectGroups(blobs: MaskBlob[], uf: UnionFind): BlobGroup[] {
  const byRoot = new Map<number, BlobGroup>();
  for (let i = 0; i < blobs.length; i++) {
    const root = uf.find(i);
    const b = blobs[i];
    const g = byRoot.get(root);
    if (!g) {
      byRoot.set(root, {
        root,
        members: [i],
        bounds: { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY },
        pixels: b.pixels,
      });
      continue;
    }
    g.members.push(i);
    g.pixels += b.pixels;
    g.bounds.minX = Math.min(g.bounds.minX, b.minX);
    g.bounds.minY = Math.min(g.bounds.minY, b.minY);
    g.bounds.maxX = Math.max(g.bounds.maxX, b.maxX);
    g.bounds.maxY = Math.max(g.bounds.maxY, b.maxY);
  }
  return [...byRoot.values()];
}
