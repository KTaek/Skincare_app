import type { SkImage } from '@shopify/react-native-skia';
import { extractNormalizedRGB, loadSkImage } from '../ai/skiaPixels';
import { runSegModel } from '../ai/tfliteService';
import { maskToBbox } from '../ai/maskToBbox';
import { labels } from '../ai/labels';
import { maskMoments } from './maskMoments';

/**
 * 분할 마스크에서 뽑아낸 병변의 기하 정보.
 * bbox만으로는 회전을 알 수 없어서, 2차 모멘트로 주축(=병변이 길게 뻗은 방향)까지 구한다.
 * 이 방향과 크기가 세션 간 정합(어파인 정렬)의 기준이 된다.
 */
export interface LesionShape {
  found: boolean;
  /** 원본 픽셀 좌표 */
  bbox: { x1: number; y1: number; x2: number; y2: number };
  centroid: { x: number; y: number };
  /** 병변 넓이를 원으로 환산한 반지름 (원본 픽셀) — 세션 간 배율 계산에 쓴다 */
  radiusPx: number;
  /** 주축 방향 (라디안, -π/2 ~ π/2). 원형에 가까우면 신뢰도가 낮다 */
  orientation: number;
  /** 주축/부축 길이 비 (1이면 완전한 원 — 이때 orientation은 의미가 없다) */
  elongation: number;
  /** 마스크가 이미지에서 차지하는 넓이 비율 (0~1) */
  areaRatio: number;
  imageWidth: number;
  imageHeight: number;
}

export interface LesionDetection {
  image: SkImage;
  shape: LesionShape;
}

/** 세그멘테이션 1회 실행 → 병변 bbox + 중심/방향/크기까지 한 번에 계산 */
export async function detectLesionShape(uri: string): Promise<LesionDetection> {
  const image = await loadSkImage(uri);
  const origW = image.width();
  const origH = image.height();
  const size = labels.img_size_seg;

  const input = extractNormalizedRGB(
    image,
    { x: 0, y: 0, width: origW, height: origH },
    size,
    labels.imagenet_mean,
    labels.imagenet_std,
  );
  const mask = await runSegModel(input);

  const { bbox, found } = maskToBbox(mask, size, size, origW, origH, {
    threshold: labels.mask_threshold,
    margin: labels.crop_margin,
    minRatio: labels.min_crop_ratio,
  });

  const shape = maskMoments(mask, size, size, origW, origH, labels.mask_threshold);
  return {
    image,
    shape: { ...shape, found, bbox, imageWidth: origW, imageHeight: origH },
  };
}

