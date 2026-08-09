export interface BBoxPixels {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface MaskToBboxResult {
  bbox: BBoxPixels;
  /** 마스크에 threshold를 넘는 픽셀이 하나라도 있었는지 (없으면 bbox는 full_image 폴백) */
  found: boolean;
}

/** data_utils.py의 mask_to_bbox를 그대로 포팅.
 * mask는 (maskW x maskH) 정사각형 격자(예: 512x512)의 확률값이고, 원본 이미지는 (origW x origH)다.
 * 참고: 파이썬 원본은 마스크를 원본 해상도로 업샘플한 뒤 bbox를 계산하지만,
 * 여기서는 마스크 격자에서 바로 bbox를 구하고 좌표만 원본 스케일로 환산한다.
 * seg 모델의 입력 자체가 원본을 정사각형으로 눌러 리사이즈한 것이므로(종횡비 비유지),
 * "업샘플 후 threshold"와 "격자에서 threshold 후 스케일"은 픽셀 경계 오차(최대 1px 수준) 외에는 동일한 결과를 내면서
 * 원본이 수백만 화소일 때 발생하는 JS 쪽 전체 이미지 bilinear 업샘플 비용을 피할 수 있다. */
export function maskToBbox(
  mask: Float32Array,
  maskW: number,
  maskH: number,
  origW: number,
  origH: number,
  opts: { threshold?: number; margin?: number; minRatio?: number } = {},
): MaskToBboxResult {
  const threshold = opts.threshold ?? 0.5;
  const margin = opts.margin ?? 0.15;
  const minRatio = opts.minRatio ?? 0.1;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let found = false;

  for (let y = 0; y < maskH; y++) {
    const rowOffset = y * maskW;
    for (let x = 0; x < maskW; x++) {
      if (mask[rowOffset + x] > threshold) {
        found = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (!found) {
    return { found: false, bbox: { x1: 0, y1: 0, x2: origW, y2: origH } };
  }

  return {
    found: true,
    bbox: expandMaskBounds({ minX, minY, maxX, maxY }, maskW, maskH, origW, origH, { margin, minRatio }),
  };
}

/**
 * 마스크 격자 좌표의 경계 → 원본 픽셀 좌표의 크롭 사각형.
 * margin만큼 넓혀 병변 주변 정상 피부를 함께 담고(등급 판정의 대조군이 된다),
 * minRatio보다 작아지지 않게 키운 뒤 이미지 밖으로 나가지 않게 자른다.
 *
 * 마스크 전체를 감싸는 경우와 덩어리(blob) 하나를 감싸는 경우가 같은 규칙을 써야 하므로 분리했다.
 */
export function expandMaskBounds(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  maskW: number,
  maskH: number,
  origW: number,
  origH: number,
  opts: { margin?: number; minRatio?: number } = {},
): BBoxPixels {
  const margin = opts.margin ?? 0.15;
  const minRatio = opts.minRatio ?? 0.1;

  const scaleX = origW / maskW;
  const scaleY = origH / maskH;
  let x1 = bounds.minX * scaleX;
  let x2 = (bounds.maxX + 1) * scaleX;
  let y1 = bounds.minY * scaleY;
  let y2 = (bounds.maxY + 1) * scaleY;

  const w = x2 - x1;
  const h = y2 - y1;
  x1 -= w * margin;
  x2 += w * margin;
  y1 -= h * margin;
  y2 += h * margin;

  const minW = origW * minRatio;
  const minH = origH * minRatio;
  if (x2 - x1 < minW) {
    const cx = (x1 + x2) / 2;
    x1 = cx - minW / 2;
    x2 = cx + minW / 2;
  }
  if (y2 - y1 < minH) {
    const cy = (y1 + y2) / 2;
    y1 = cy - minH / 2;
    y2 = cy + minH / 2;
  }

  return {
    x1: Math.max(Math.floor(x1), 0),
    y1: Math.max(Math.floor(y1), 0),
    x2: Math.min(Math.ceil(x2), origW),
    y2: Math.min(Math.ceil(y2), origH),
  };
}
