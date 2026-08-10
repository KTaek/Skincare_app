/**
 * 분할 마스크를 연결된 덩어리(blob)로 쪼갠다.
 *
 * 왜 필요한가: maskToBbox는 마스크 전체를 감싸는 사각형 하나를 만든다. 증상이 떨어진 두 곳에
 * 있으면 그 사각형 안쪽 대부분이 정상 피부가 되고, 중증도 모델은 희석된 입력을 받아 등급을
 * 과소평가한다. 사용자에게 "한 곳씩 나눠 찍으세요"라고 시키는 대신 앱이 나눠서 본다.
 *
 * 여기서는 자르지도 버리지도 않는다 — 덩어리를 다 찾아 크기순으로 돌려줄 뿐이다. 어느 덩어리를
 * 합치고 어느 것을 버릴지는 lesionRegions.ts가 정한다 (판정 단위를 정하는 규칙은 한 곳에 모여
 * 있어야 한다).
 */

export interface MaskBlob {
  /** 마스크 격자 좌표 기준 경계 (x2/y2는 포함) */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** 이 덩어리의 마스크 픽셀 수 */
  pixels: number;
}

export interface MaskBlobsResult {
  /** 픽셀 수 내림차순 */
  blobs: MaskBlob[];
  /** 픽셀 → blobs 인덱스. 마스크 바깥이거나 후보에서 밀려난 잔 덩어리는 -1 */
  labels: Int32Array;
  /** maxCandidates에 밀려 라벨에서 지운 잔 덩어리 수 */
  droppedTiny: number;
}

/**
 * 4-이웃 연결 성분을 찾아 큰 순으로 돌려준다.
 *
 * @param maxCandidates 남길 덩어리 수 상한. 노이즈가 많은 마스크는 한 픽셀짜리 덩어리가 수백 개
 *                      나올 수 있고, 뒤따르는 병합 판정이 덩어리 수의 제곱으로 늘어난다. 크기순
 *                      정렬 뒤 이 개수까지만 남긴다 — 잘리는 것은 항상 가장 작은 것들이다.
 */
export function findMaskBlobs(
  mask: Float32Array,
  maskW: number,
  maskH: number,
  threshold: number,
  opts: { maxCandidates?: number } = {},
): MaskBlobsResult {
  const maxCandidates = opts.maxCandidates ?? 48;

  const n = maskW * maskH;
  const labels = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n);
  const blobs: MaskBlob[] = [];

  for (let start = 0; start < n; start++) {
    if (labels[start] !== -1 || mask[start] <= threshold) continue;

    const id = blobs.length;
    let top = 0;
    stack[top++] = start;
    labels[start] = id;

    let minX = maskW;
    let minY = maskH;
    let maxX = 0;
    let maxY = 0;
    let pixels = 0;

    while (top > 0) {
      const p = stack[--top];
      const x = p % maskW;
      const y = (p - x) / maskW;
      pixels += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      if (x > 0 && labels[p - 1] === -1 && mask[p - 1] > threshold) {
        labels[p - 1] = id;
        stack[top++] = p - 1;
      }
      if (x < maskW - 1 && labels[p + 1] === -1 && mask[p + 1] > threshold) {
        labels[p + 1] = id;
        stack[top++] = p + 1;
      }
      if (y > 0 && labels[p - maskW] === -1 && mask[p - maskW] > threshold) {
        labels[p - maskW] = id;
        stack[top++] = p - maskW;
      }
      if (y < maskH - 1 && labels[p + maskW] === -1 && mask[p + maskW] > threshold) {
        labels[p + maskW] = id;
        stack[top++] = p + maskW;
      }
    }

    blobs.push({ minX, minY, maxX, maxY, pixels });
  }

  if (blobs.length === 0) return { blobs, labels, droppedTiny: 0 };

  // 크기순으로 다시 번호를 매긴다 — 이후 단계가 "0번이 가장 큰 덩어리"를 전제로 쓴다
  const order = blobs.map((b, i) => ({ b, i })).sort((p, q) => q.b.pixels - p.b.pixels);
  const kept = order.slice(0, maxCandidates);
  const remap = new Int32Array(blobs.length).fill(-1);
  kept.forEach((entry, newId) => {
    remap[entry.i] = newId;
  });
  for (let i = 0; i < n; i++) {
    const old = labels[i];
    if (old !== -1) labels[i] = remap[old];
  }

  return {
    blobs: kept.map((entry) => entry.b),
    labels,
    droppedTiny: order.length - kept.length,
  };
}
