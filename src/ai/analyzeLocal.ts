import type { SkImage } from '@shopify/react-native-skia';
import { withSkImage, extractNormalizedRGB } from './skiaPixels';
import { runSegModel, runClsModel } from './tfliteService';
import { maskToBbox, expandMaskBounds } from './maskToBbox';
import { findMaskBlobs } from './maskBlobs';
import { decodeSign } from './dex';
import { labels, SIGN_KEYS, IGA_GRADE_TO_SEVERITY, type SignKey } from './labels';

export interface LesionBox {
  x: number;
  y: number;
  width: number;
  height: number;
  imageWidth: number;
  imageHeight: number;
}

export interface SignResult {
  sign: SignKey;
  grade: number;
  gradeName: string;
}

/** 증상 덩어리 하나의 판정 결과 */
export interface LesionRegionResult {
  bbox: LesionBox;
  signs: SignResult[];
  igaGrade: number;
  igaGradeName: string;
  /** 이 덩어리가 마스크 전체에서 차지하는 비율 (0~1) */
  share: number;
}

export interface LocalAnalysisResult {
  signs: SignResult[];
  igaGrade: number;
  igaGradeName: string;
  /** 기존 앱 전역의 1~3단계 중증도 체계로 축약한 값 (SevBadge 등 기존 UI와 호환) */
  severity: number;
  bbox: LesionBox;
  /**
   * 분할 마스크가 사진에서 차지하는 실제 넓이 비율 (%).
   * bbox 넓이가 아니라 마스크 픽셀 수라서, 길게 번진 증상이 사각형으로 과대평가되지 않는다.
   */
  maskAreaPct: number;
  /**
   * 따로 떨어진 증상 덩어리별 판정. 하나뿐이면 길이 1이다.
   * 최상위 signs/igaGrade는 이 중 가장 나쁜 덩어리의 값이다.
   */
  regions: LesionRegionResult[];
  /** Stage1+Stage2 추론 전체 소요 시간 (ms) */
  inferenceTimeMs: number;
}

/** 촬영 후처리에서 계산한 조명 보정 게인 — 세션 간 색 비교를 맞춘다 */
export interface AnalyzeOptions {
  colorGain?: readonly number[];
}

async function runStage1(image: SkImage, colorGain?: readonly number[]) {
  const origW = image.width();
  const origH = image.height();
  const fullRect = { x: 0, y: 0, width: origW, height: origH };

  const size = labels.img_size_seg;
  const stage1Input = extractNormalizedRGB(image, fullRect, size, labels.imagenet_mean, labels.imagenet_std, colorGain);
  // 모델이 시그모이드까지 태워 0~1 확률을 그대로 낸다 — 여기서는 임계값만 적용하면 된다
  const mask = await runSegModel(stage1Input);

  const { bbox, found } = maskToBbox(mask, size, size, origW, origH, {
    threshold: labels.mask_threshold,
    margin: labels.crop_margin,
    minRatio: labels.min_crop_ratio,
  });

  let on = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] > labels.mask_threshold) on += 1;
  const maskAreaPct = mask.length > 0 ? Math.round((on / mask.length) * 1000) / 10 : 0;

  return { origW, origH, mask, maskOn: on, bbox, found, maskAreaPct };
}

/** 카메라 미리보기 중 주기적으로 호출 — 병변 위치 박스만 가볍게 계산 (Stage2 분류는 생략) */
export async function detectBboxLocal(uri: string): Promise<LesionBox | null> {
  const { origW, origH, bbox, found } = await withSkImage(uri, (image) => runStage1(image));
  if (!found) return null;
  return { x: bbox.x1, y: bbox.y1, width: bbox.x2 - bbox.x1, height: bbox.y2 - bbox.y1, imageWidth: origW, imageHeight: origH };
}

/**
 * 질환 분류(diseaseModel)에서 1순위가 "정상"으로 나왔을 때 쓰는 합성 결과.
 *
 * 이미 정상 피부라고 판단됐는데 세그멘테이션·중증도 모델(Stage1/2)을 또 돌리면, 병변이 없는
 * 사진에서도 잡음을 병변처럼 읽어 등급을 매기려 드는 경우가 있다 — 이 경로에서는 그 모델들을
 * 아예 부르지 않고 "이상 없음"을 그대로 확정한다. 이미지 크기만 읽어(가볍다, 모델 추론이 아니다)
 * bbox를 전체 이미지로 채운다.
 */
export async function normalSkinResult(uri: string): Promise<LocalAnalysisResult> {
  const { origW, origH } = await withSkImage(uri, (image) => ({ origW: image.width(), origH: image.height() }));
  const bbox: LesionBox = { x: 0, y: 0, width: origW, height: origH, imageWidth: origW, imageHeight: origH };
  const signs: SignResult[] = SIGN_KEYS.map((sign) => ({
    sign,
    grade: 0,
    gradeName: labels.grade_names_by_sign[sign][0],
  }));
  const igaGradeName = labels.grade_names_by_sign.iga[0]; // 'Clear'

  return {
    signs,
    igaGrade: 0,
    igaGradeName,
    severity: IGA_GRADE_TO_SEVERITY[0] ?? 1,
    bbox,
    maskAreaPct: 0,
    regions: [{ bbox, signs, igaGrade: 0, igaGradeName, share: 1 }],
    inferenceTimeMs: 0,
  };
}

/**
 * 촬영된 사진 전체 분석: Stage1(분할) → 덩어리별 crop → Stage2(분류) → DEX 등급 산출.
 *
 * 증상이 여러 곳에 떨어져 있으면 덩어리마다 따로 잘라 등급을 매기고, 그중 가장 나쁜 것을
 * 대표값으로 올린다. 하나의 큰 사각형으로 뭉뚱그리면 사이의 정상 피부가 섞여 들어가
 * 등급이 실제보다 낮게 나오기 때문이다.
 */
export async function analyzeLocal(uri: string, opts: AnalyzeOptions = {}): Promise<LocalAnalysisResult> {
  // 이미지 한 장을 두 단계가 함께 쓰므로 바깥에서 열고, 끝나면 withSkImage가 확실히 해제한다
  return withSkImage(uri, (image) => analyzeImage(image, opts));
}

async function analyzeImage(image: SkImage, opts: AnalyzeOptions): Promise<LocalAnalysisResult> {
  const startedAt = Date.now();
  const { colorGain } = opts;

  const { origW, origH, mask, maskOn, bbox, found, maskAreaPct } = await runStage1(image, colorGain);
  const size = labels.img_size_seg;

  // 마스크가 비면 maskToBbox가 전체 이미지로 폴백한다 — 쪼갤 것이 없으니 그대로 한 번만 돌린다
  const blobs = found
    ? findMaskBlobs(mask, size, size, labels.mask_threshold, { minPixelRatio: 0.15, maxBlobs: 3 })
    : [];

  const rects =
    blobs.length > 1
      ? blobs.map((b) => ({
          bbox: expandMaskBounds(b, size, size, origW, origH, {
            margin: labels.crop_margin,
            minRatio: labels.min_crop_ratio,
          }),
          share: maskOn > 0 ? b.pixels / maskOn : 1,
        }))
      : [{ bbox, share: 1 }];

  const regions: LesionRegionResult[] = [];
  for (const { bbox: rect, share } of rects) {
    const cropRect = { x: rect.x1, y: rect.y1, width: rect.x2 - rect.x1, height: rect.y2 - rect.y1 };
    const stage2Input = extractNormalizedRGB(
      image,
      cropRect,
      labels.img_size_cls,
      labels.imagenet_mean,
      labels.imagenet_std,
      colorGain,
    );
    const clsOut = await runClsModel(stage2Input);

    const signs: SignResult[] = SIGN_KEYS.map((key) => {
      const decoded = decodeSign(clsOut[key], labels.dex_thresholds_by_sign[key], labels.grade_names_by_sign[key]);
      return { sign: key, grade: decoded.grade, gradeName: decoded.gradeName };
    });
    const iga = decodeSign(clsOut.iga, labels.dex_thresholds_by_sign.iga, labels.grade_names_by_sign.iga);

    regions.push({
      bbox: { ...cropRect, imageWidth: origW, imageHeight: origH },
      signs,
      igaGrade: iga.grade,
      igaGradeName: iga.gradeName,
      share,
    });
  }

  // 대표값은 가장 나쁜 덩어리 — 좋아진 곳이 나빠진 곳을 평균으로 가리면 안 된다
  const worst = regions.reduce((a, b) => (b.igaGrade > a.igaGrade ? b : a));

  return {
    signs: worst.signs,
    igaGrade: worst.igaGrade,
    igaGradeName: worst.igaGradeName,
    severity: IGA_GRADE_TO_SEVERITY[worst.igaGrade] ?? 1,
    bbox: worst.bbox,
    maskAreaPct,
    regions,
    inferenceTimeMs: Date.now() - startedAt,
  };
}
