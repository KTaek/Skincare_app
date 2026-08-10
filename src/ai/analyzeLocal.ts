import type { SkImage } from '@shopify/react-native-skia';
import { withSkImage, extractNormalizedRGB } from './skiaPixels';
import { runSegModel, runClsModel } from './tfliteService';
import { maskToBbox, maskRectToOriginal } from './maskToBbox';
import { buildLesionRegions } from './lesionRegions';
import { renderMaskOverlay } from './maskOverlay';
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

/** 판정 단위(증상 덩어리) 하나의 결과 */
export interface LesionRegionResult {
  bbox: LesionBox;
  signs: SignResult[];
  igaGrade: number;
  igaGradeName: string;
  /** 이 단위가 마스크 전체에서 차지하는 비율 (0~1) */
  share: number;
  /** 이 단위가 사진에서 차지하는 넓이 비율 (%) — maskAreaPct와 같은 기준 */
  areaPct: number;
  /**
   * 이 단위로 묶인 연결 덩어리 수. 1보다 크면 경계 사이가 가까워 한 병변으로 본 것이다
   * (lesionRegions.ts의 병합 규칙).
   */
  mergedBlobs: number;
  /**
   * 이 단위의 크롭에 함께 찍힌 다른 병변의 양 (자기 병변 픽셀 대비 %).
   * 사각 크롭이라 옆 병변이 조금 들어올 수 있고, 그 양을 지우는 대신 재서 남긴다.
   */
  foreignPct: number;
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
   * 사진 위에 분할 마스크를 겹쳐 그린 이미지 (data URI).
   * 마스크를 못 찾았거나 합성에 실패하면 null — 그때는 원본만 보여준다.
   */
  maskUri: string | null;
  /**
   * 판정 단위별 결과 (넓은 순). 하나뿐이면 길이 1이다.
   * 최상위 signs/igaGrade는 이 중 가장 나쁜 단위의 값이다.
   */
  regions: LesionRegionResult[];
  /** regions에서 가장 나쁜(최상위로 올린) 단위의 번호 */
  worstRegionIndex: number;
  /** 너무 작아 등급을 매기지 않은 덩어리 수 — 넓이(maskAreaPct)에는 포함돼 있다 */
  droppedRegions: number;
  /** Stage1+Stage2 추론 전체 소요 시간 (ms) */
  inferenceTimeMs: number;
}

/**
 * 판정 단위 수 상한 — 하나당 중증도 추론(384px)이 한 번 더 돌기 때문에 상한이 필요하다.
 * maskOverlay의 REGION_COLORS 개수와 맞춰 둔다 (색이 돌아 쓰이면 사진과 카드를 맞출 수 없다).
 */
const MAX_REGIONS = 3;

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
 * 촬영된 사진 전체 분석: Stage1(분할) → 판정 단위별 crop → Stage2(분류) → DEX 등급 산출.
 *
 * 증상이 여러 곳에 떨어져 있으면 단위마다 따로 잘라 등급을 매기고, 그중 가장 나쁜 것을
 * 대표값으로 올린다. 하나의 큰 사각형으로 뭉뚱그리면 사이의 정상 피부가 섞여 들어가
 * 등급이 실제보다 낮게 나오기 때문이다. 무엇을 한 단위로 볼지는 lesionRegions.ts가 정한다.
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

  // 판정 단위를 정한다 — 연결 덩어리로 쪼갠 뒤, 경계 사이가 가까운 것끼리 묶는다.
  // 마스크가 비면 빈 배열이고, 그때는 maskToBbox의 전체 이미지 폴백으로 한 번만 돌린다.
  const { regions: maskRegions, regionOf, dropped } = found
    ? buildLesionRegions(mask, size, size, labels.mask_threshold, {
        margin: labels.crop_margin,
        minRatio: labels.min_crop_ratio,
        maxRegions: MAX_REGIONS,
      })
    : { regions: [], regionOf: null, dropped: 0 };

  // 결과 화면에 보여줄 오버레이. 합성이 실패해도 판정은 그대로 나가야 하므로 여기서 삼킨다
  // (그림이 없는 것과 분석이 죽는 것은 전혀 다른 무게의 실패다).
  let maskUri: string | null = null;
  if (found) {
    try {
      maskUri = renderMaskOverlay(image, mask, size, labels.mask_threshold, regionOf);
    } catch {
      maskUri = null;
    }
  }

  const rects = maskRegions.length
    ? maskRegions.map((r) => ({
        bbox: maskRectToOriginal(r.crop, size, size, origW, origH),
        share: maskOn > 0 ? r.pixels / maskOn : 1,
        areaPct: Math.round((r.pixels / (size * size)) * 1000) / 10,
        mergedBlobs: r.mergedBlobs,
        foreignPct: r.foreignPct,
      }))
    : [{ bbox, share: 1, areaPct: maskAreaPct, mergedBlobs: 0, foreignPct: 0 }];

  const regions: LesionRegionResult[] = [];
  for (const { bbox: rect, share, areaPct, mergedBlobs, foreignPct } of rects) {
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
      areaPct,
      mergedBlobs,
      foreignPct,
    });
  }

  // 대표값은 가장 나쁜 단위 — 좋아진 곳이 나빠진 곳을 평균으로 가리면 안 된다.
  // 같은 등급이면 앞(넓은) 쪽을 대표로 둔다.
  let worstIndex = 0;
  regions.forEach((r, i) => {
    if (r.igaGrade > regions[worstIndex].igaGrade) worstIndex = i;
  });
  const worst = regions[worstIndex];

  return {
    signs: worst.signs,
    igaGrade: worst.igaGrade,
    igaGradeName: worst.igaGradeName,
    severity: IGA_GRADE_TO_SEVERITY[worst.igaGrade] ?? 1,
    bbox: worst.bbox,
    maskAreaPct,
    maskUri,
    regions,
    worstRegionIndex: worstIndex,
    droppedRegions: dropped,
    inferenceTimeMs: Date.now() - startedAt,
  };
}
