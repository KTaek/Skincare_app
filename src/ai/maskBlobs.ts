/**
 * 분할 마스크를 연결된 덩어리(blob)로 쪼갠다.
 *
 * 왜 필요한가: maskToBbox는 마스크 전체를 감싸는 사각형 하나를 만든다. 증상이 떨어진 두 곳에
 * 있으면 그 사각형 안쪽 대부분이 정상 피부가 되고, 중증도 모델은 희석된 입력을 받아 등급을
 * 과소평가한다. 사용자에게 "한 곳씩 나눠 찍으세요"라고 시키는 대신 앱이 나눠서 본다.
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

/**
 * 4-이웃 연결 성분을 찾아 큰 순으로 돌려준다.
 *
 * @param minPixelRatio 가장 큰 덩어리 대비 이 비율보다 작은 덩어리는 잡음으로 보고 버린다
 * @param maxBlobs      돌려줄 최대 개수 (중증도 추론을 덩어리마다 돌리므로 비용 상한이 필요하다)
 */
export function findMaskBlobs(
  mask: Float32Array,
  maskW: number,
  maskH: number,
  threshold: number,
  opts: { minPixelRatio?: number; maxBlobs?: number } = {},
): MaskBlob[] {
  const minPixelRatio = opts.minPixelRatio ?? 0.15;
  const maxBlobs = opts.maxBlobs ?? 3;

  const n = maskW * maskH;
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const blobs: MaskBlob[] = [];

  for (let start = 0; start < n; start++) {
    if (seen[start] || mask[start] <= threshold) continue;

    let top = 0;
    stack[top++] = start;
    seen[start] = 1;

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

      if (x > 0 && !seen[p - 1] && mask[p - 1] > threshold) {
        seen[p - 1] = 1;
        stack[top++] = p - 1;
      }
      if (x < maskW - 1 && !seen[p + 1] && mask[p + 1] > threshold) {
        seen[p + 1] = 1;
        stack[top++] = p + 1;
      }
      if (y > 0 && !seen[p - maskW] && mask[p - maskW] > threshold) {
        seen[p - maskW] = 1;
        stack[top++] = p - maskW;
      }
      if (y < maskH - 1 && !seen[p + maskW] && mask[p + maskW] > threshold) {
        seen[p + maskW] = 1;
        stack[top++] = p + maskW;
      }
    }

    blobs.push({ minX, minY, maxX, maxY, pixels });
  }

  if (blobs.length === 0) return blobs;
  blobs.sort((a, b) => b.pixels - a.pixels);
  const cutoff = blobs[0].pixels * minPixelRatio;
  return blobs.filter((b) => b.pixels >= cutoff).slice(0, maxBlobs);
}
