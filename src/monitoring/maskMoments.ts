import { LesionShape } from './lesionShape';

export type MaskMoments = Pick<LesionShape, 'centroid' | 'radiusPx' | 'orientation' | 'elongation' | 'areaRatio'>;

/**
 * 마스크의 0/1/2차 모멘트로 중심·주축·면적을 계산한다.
 * 마스크 격자는 원본을 정사각형으로 눌러 만든 것이므로, 누적할 때 좌표를 원본 스케일로 되돌려
 * 공분산이 원본 픽셀 기준이 되게 한다 (그래야 각도와 반지름이 실제 사진과 맞는다).
 */
export function maskMoments(
  mask: Float32Array,
  maskW: number,
  maskH: number,
  origW: number,
  origH: number,
  threshold: number,
): MaskMoments {
  const sx = origW / maskW;
  const sy = origH / maskH;

  let n = 0;
  let sumX = 0;
  let sumY = 0;
  for (let y = 0; y < maskH; y++) {
    const row = y * maskW;
    for (let x = 0; x < maskW; x++) {
      if (mask[row + x] <= threshold) continue;
      n += 1;
      sumX += (x + 0.5) * sx;
      sumY += (y + 0.5) * sy;
    }
  }

  if (n === 0) {
    return {
      centroid: { x: origW / 2, y: origH / 2 },
      radiusPx: Math.min(origW, origH) * 0.25,
      orientation: 0,
      elongation: 1,
      areaRatio: 0,
    };
  }

  const cx = sumX / n;
  const cy = sumY / n;

  let mxx = 0;
  let myy = 0;
  let mxy = 0;
  for (let y = 0; y < maskH; y++) {
    const row = y * maskW;
    for (let x = 0; x < maskW; x++) {
      if (mask[row + x] <= threshold) continue;
      const dx = (x + 0.5) * sx - cx;
      const dy = (y + 0.5) * sy - cy;
      mxx += dx * dx;
      myy += dy * dy;
      mxy += dx * dy;
    }
  }
  mxx /= n;
  myy /= n;
  mxy /= n;

  // 공분산 행렬의 고유값 → 주축/부축 길이, 고유벡터 각도 → 주축 방향
  const tr = mxx + myy;
  const det = mxx * myy - mxy * mxy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc;
  const l2 = Math.max(tr / 2 - disc, 1e-6);
  const orientation = 0.5 * Math.atan2(2 * mxy, mxx - myy);

  const areaPx = n * sx * sy;
  return {
    centroid: { x: cx, y: cy },
    radiusPx: Math.sqrt(areaPx / Math.PI),
    orientation,
    elongation: Math.sqrt(l1 / l2),
    areaRatio: n / (maskW * maskH),
  };
}
