export interface BBoxPixels {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** 마스크 격자 좌표의 사각형 (실수, [0,maskW]×[0,maskH]로 클램프된 상태) */
export interface MaskRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface MaskBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
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
 * 마스크 격자 좌표의 경계 → 같은 격자 좌표의 크롭 사각형.
 * margin만큼 넓혀 병변 주변 정상 피부를 함께 담고(등급 판정의 대조군이 된다),
 * minRatio보다 작아지지 않게 키운 뒤 격자 밖으로 나가지 않게 자른다.
 *
 * 원본 픽셀이 아니라 마스크 격자에서 계산하는 이유: 판정 단위를 정하는 병합 규칙
 * (lesionRegions.ts)이 "이 크롭 안에 저 덩어리의 픽셀이 있는가"를 라벨 맵에서 세어야 하고,
 * 라벨 맵은 이 격자 좌표계다. 최종 크롭과 병합 판정이 **같은 사각형**을 봐야 규칙이 성립한다.
 *
 * minRatio가 "변의 비율"이라 격자에서 계산해도 원본에서 계산한 것과 같은 사각형이 된다
 * (origW * minRatio / scaleX == maskW * minRatio).
 */
export function expandInMask(
  bounds: MaskBounds,
  maskW: number,
  maskH: number,
  opts: { margin?: number; minRatio?: number } = {},
): MaskRect {
  const margin = opts.margin ?? 0.15;
  const minRatio = opts.minRatio ?? 0.1;

  let x1 = bounds.minX;
  let x2 = bounds.maxX + 1;
  let y1 = bounds.minY;
  let y2 = bounds.maxY + 1;

  const w = x2 - x1;
  const h = y2 - y1;
  x1 -= w * margin;
  x2 += w * margin;
  y1 -= h * margin;
  y2 += h * margin;

  const minW = maskW * minRatio;
  const minH = maskH * minRatio;
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
    x1: Math.max(x1, 0),
    y1: Math.max(y1, 0),
    x2: Math.min(x2, maskW),
    y2: Math.min(y2, maskH),
  };
}

/** 마스크 격자 사각형 → 원본 픽셀 사각형 (모델에 넣을 크롭) */
export function maskRectToOriginal(
  rect: MaskRect,
  maskW: number,
  maskH: number,
  origW: number,
  origH: number,
): BBoxPixels {
  const scaleX = origW / maskW;
  const scaleY = origH / maskH;
  return {
    x1: Math.max(Math.floor(rect.x1 * scaleX), 0),
    y1: Math.max(Math.floor(rect.y1 * scaleY), 0),
    x2: Math.min(Math.ceil(rect.x2 * scaleX), origW),
    y2: Math.min(Math.ceil(rect.y2 * scaleY), origH),
  };
}

/** 마스크 격자 경계 → 원본 픽셀 크롭. 위 두 단계를 이어 붙인 것. */
export function expandMaskBounds(
  bounds: MaskBounds,
  maskW: number,
  maskH: number,
  origW: number,
  origH: number,
  opts: { margin?: number; minRatio?: number } = {},
): BBoxPixels {
  return maskRectToOriginal(expandInMask(bounds, maskW, maskH, opts), maskW, maskH, origW, origH);
}
