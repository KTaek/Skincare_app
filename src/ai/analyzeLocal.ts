import type { SkImage } from '@shopify/react-native-skia';
import { withSkImage, extractNormalizedRGB } from './skiaPixels';
import { runSegModel, runClsModel } from './tfliteService';
import { maskToBbox, maskRectToOriginal, type MaskRect } from './maskToBbox';
import { buildLesionRegions } from './lesionRegions';
import { renderMaskOverlay } from './maskOverlay';
import { roiOf, SCALE_SPEC, type ScaleFrame, type ScaleRoi } from './scaleFrame';
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
  /**
   * 이 단위가 분석 영역에서 차지하는 넓이 비율 (%) — maskAreaPct와 같은 기준.
   * 병변 면적 추적(ai/lesionRegions)이 있어야 나오는 값이라, 옛 경로(normalSkinResult 등)의
   * 자리 채우기 값에는 없을 수 있다.
   */
  areaPct?: number;
  /**
   * 이 단위로 묶인 연결 덩어리 수. 1보다 크면 경계 사이가 가까워 한 병변으로 본 것이다
   * (lesionRegions.ts의 병합 규칙).
   */
  mergedBlobs?: number;
  /**
   * 이 단위의 크롭에 함께 찍힌 다른 병변의 양 (자기 병변 픽셀 대비 %).
   * 사각 크롭이라 옆 병변이 조금 들어올 수 있고, 그 양을 지우는 대신 재서 남긴다.
   */
  foreignPct?: number;
}

export interface LocalAnalysisResult {
  signs: SignResult[];
  igaGrade: number;
  igaGradeName: string;
  /** 기존 앱 전역의 1~3단계 중증도 체계로 축약한 값 (SevBadge 등 기존 UI와 호환) */
  severity: number;
  bbox: LesionBox;
  /**
   * 분할 마스크가 **분석에 들어간 영역**에서 차지하는 넓이 비율 (%).
   * bbox 넓이가 아니라 마스크 픽셀 수라서, 길게 번진 증상이 사각형으로 과대평가되지 않는다.
   *
   * 보통 그 영역은 사진 전체지만, 자가 있는 자리에서는 그 관심영역이다. 어느 쪽이든 이 값은
   * **회차 간 비교에 쓸 수 없다** — 조금만 가까이 가도 값이 커진다. 비교에 쓸 값은 scaleArea다.
   */
  maskAreaPct: number;
  /**
   * 배율이 상쇄된 병변 넓이 = 100 × 병변 넓이 ÷ (자의 가로 × 세로).
   * 자(얼굴 또는 몸통)를 찾아 관심영역으로 분석했을 때만 나온다 (그 외에는 없거나 null).
   */
  scaleArea?: ScaleAreaResult | null;
  /**
   * 사진 위에 분할 마스크를 겹쳐 그린 이미지 (data URI).
   * 마스크를 못 찾았거나 합성에 실패하면 null — 그때는 원본만 보여준다.
   */
  maskUri?: string | null;
  /**
   * 판정 단위별 결과 (넓은 순). 하나뿐이면 길이 1이다.
   * 최상위 signs/igaGrade는 이 중 가장 나쁜 단위의 값이다.
   */
  regions: LesionRegionResult[];
  /** regions에서 가장 나쁜(최상위로 올린) 단위의 번호 */
  worstRegionIndex?: number;
  /** 너무 작아 등급을 매기지 않은 덩어리 수 — 넓이(maskAreaPct)에는 포함돼 있다 */
  droppedRegions?: number;
  /** Stage1+Stage2 추론 전체 소요 시간 (ms) */
  inferenceTimeMs: number;
}

/** 판정 단위 수 상한 — 하나당 중증도 추론(384px)이 한 번 더 돌기 때문에 상한이 필요하다. */
const MAX_REGIONS = 3;

export interface ScaleAreaResult {
  /** 무엇을 자로 삼아 잰 값인지 — 화면이 "얼굴의 20%"인지 "몸통의 20%"인지 가르는 데 쓴다 */
  kind: ScaleFrame['kind'];
  /** 100 × 병변 넓이 ÷ (d·v). 단위 없는 지수 — 배율이 상쇄돼 회차 간 비교가 된다 */
  index: number;
  /** 병변 넓이 (원본 픽셀²) — 지수를 다시 풀어 보고 싶을 때를 위해 남긴다 */
  lesionPixels: number;
  /** 이번 사진의 면적 자 (d·v, 원본 픽셀²) */
  areaRef: number;
  /** 분석에 실제로 쓴 관심영역 */
  roi: ScaleRoi;
}

/**
 * 분석 옵션.
 *
 * scale을 주면 그 관심영역만 잘라 분할을 돌리고, 넓이를 자로 나눈 지수를 함께 낸다.
 * 관심영역을 쓰는 것이 정확도에서도 이득이다 — 정사각형이라 종횡비 왜곡이 없고, 얼굴이 512
 * 격자를 가득 채워 유효 해상도가 서너 배 오르며, 머리카락·목·옷·배경의 오검출이 입력 단계에서
 * 사라지고, 세그 모델의 학습 분포(피부가 화면의 94.5%)에 훨씬 가까워진다.
 *
 * scale을 주지 않으면(기존 촬영 경로) 예전과 동일하게 사진 전체를 분석한다 — scaleArea/maskUri는
 * 각각 null이 되거나, maskUri는 그대로 채워진다(사진 전체 기준 오버레이).
 */
export interface AnalyzeOptions {
  /** 촬영 후처리에서 계산한 조명 보정 게인 — 세션 간 색 비교를 맞춘다 */
  colorGain?: readonly number[];
  /** 촬영 때 찾아 둔 자 (얼굴·몸통 자리에서만) */
  scale?: ScaleFrame | null;
}

/**
 * 분할이 실제로 본 영역. 얼굴 관심영역이거나 사진 전체다.
 * 마스크 격자 좌표를 원본으로 되돌릴 때 이 사각형이 기준이 된다.
 */
type Region = { x: number; y: number; width: number; height: number };

/**
 * 임계값 근처를 부분 가중으로 세는 구간.
 *
 * 0.5로 딱 잘라 세면 경계에 걸친 픽셀이 회차마다 통째로 켜졌다 꺼지며 넓이가 튄다 — 그 떨림이
 * 그대로 "호전/악화"로 읽힌다. 임계값 ±0.15 구간을 선형으로 이어 주면 경계가 연속적으로 변해
 * 추세가 눈에 띄게 안정된다. 화면에 그리는 오버레이는 예전처럼 딱 잘라 칠한다 —
 * 보이는 그림과 재는 값의 목적이 다르다.
 */
const AREA_SOFT_HALF = 0.15;

async function runStage1(image: SkImage, colorGain?: readonly number[], region?: Region) {
  const origW = image.width();
  const origH = image.height();
  const src = region ?? { x: 0, y: 0, width: origW, height: origH };

  const size = labels.img_size_seg;
  const stage1Input = extractNormalizedRGB(image, src, size, labels.imagenet_mean, labels.imagenet_std, colorGain);
  // 모델이 시그모이드까지 태워 0~1 확률을 그대로 낸다 — 여기서는 임계값만 적용하면 된다
  const mask = await runSegModel(stage1Input);

  // bbox는 분석 영역 안의 좌표로 나오므로 원본 좌표로 옮겨 준다 (영역이 사진 전체면 오프셋이 0이다)
  const { bbox: local, found } = maskToBbox(mask, size, size, src.width, src.height, {
    threshold: labels.mask_threshold,
    margin: labels.crop_margin,
    minRatio: labels.min_crop_ratio,
  });
  const bbox = { x1: local.x1 + src.x, y1: local.y1 + src.y, x2: local.x2 + src.x, y2: local.y2 + src.y };

  let on = 0;
  let soft = 0;
  const lo = labels.mask_threshold - AREA_SOFT_HALF;
  const span = AREA_SOFT_HALF * 2;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] > labels.mask_threshold) on += 1;
    const w = (mask[i] - lo) / span;
    if (w > 0) soft += w > 1 ? 1 : w;
  }
  const maskAreaPct = mask.length > 0 ? Math.round((on / mask.length) * 1000) / 10 : 0;

  return { origW, origH, src, mask, maskOn: on, maskSoft: soft, bbox, found, maskAreaPct };
}

/** 마스크 격자 사각형 → 원본 픽셀 사각형. 분할이 본 영역이 사진 일부일 수 있으므로 오프셋을 얹는다 */
function maskRectToImage(rect: MaskRect, maskSize: number, src: Region) {
  const local = maskRectToOriginal(rect, maskSize, maskSize, src.width, src.height);
  return { x1: local.x1 + src.x, y1: local.y1 + src.y, x2: local.x2 + src.x, y2: local.y2 + src.y };
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
    scaleArea: null,
    maskUri: null,
    regions: [{ bbox, signs, igaGrade: 0, igaGradeName, share: 1 }],
    worstRegionIndex: 0,
    droppedRegions: 0,
    inferenceTimeMs: 0,
  };
}

/**
 * 질환 분류 1순위가 "정상"도 "아토피피부염"도 아닐 때 쓰는 결과.
 *
 * 증상 4가지·IGA를 매기는 Stage2 모델은 아토피피부염의 중증도 채점 기준(홍반·구진·긁은
 * 상처·태선화)으로 학습돼 있어서, 건선·여드름·주사·지루피부염 같은 다른 질환 사진에 그대로
 * 돌리면 근거 없는 등급이 나온다. 그래서 이 경로에서는 Stage2를 아예 부르지 않는다. 사진 위
 * 병변 위치 표시에만 쓰는 Stage1(분할)은 가볍게 그대로 돌려서 bbox는 채운다.
 */
export async function unsupportedDiseaseResult(
  uri: string,
  colorGain?: readonly number[],
): Promise<LocalAnalysisResult> {
  const { origW, origH, bbox: rawBbox, found } = await withSkImage(uri, (image) => runStage1(image, colorGain));
  const bbox: LesionBox = found
    ? { x: rawBbox.x1, y: rawBbox.y1, width: rawBbox.x2 - rawBbox.x1, height: rawBbox.y2 - rawBbox.y1, imageWidth: origW, imageHeight: origH }
    : { x: 0, y: 0, width: origW, height: origH, imageWidth: origW, imageHeight: origH };
  const signs: SignResult[] = SIGN_KEYS.map((sign) => ({
    sign,
    grade: 0,
    gradeName: labels.grade_names_by_sign[sign][0],
  }));
  const igaGradeName = labels.grade_names_by_sign.iga[0];

  return {
    signs,
    igaGrade: 0,
    igaGradeName,
    severity: IGA_GRADE_TO_SEVERITY[0] ?? 1,
    bbox,
    maskAreaPct: 0,
    scaleArea: null,
    maskUri: null,
    regions: [{ bbox, signs, igaGrade: 0, igaGradeName, share: 1 }],
    worstRegionIndex: 0,
    droppedRegions: 0,
    inferenceTimeMs: 0,
  };
}

/**
 * 촬영된 사진 전체 분석: Stage1(분할) → 판정 단위별 crop → Stage2(분류) → DEX 등급 산출.
 *
 * 증상이 여러 곳에 떨어져 있으면 단위마다 따로 잘라 등급을 매기고, 그중 가장 나쁜 것을
 * 대표값으로 올린다. 하나의 큰 사각형으로 뭉뚱그리면 사이의 정상 피부가 섞여 들어가
 * 등급이 실제보다 낮게 나오기 때문이다. 무엇을 한 단위로 볼지는 lesionRegions.ts가 정한다.
 *
 * opts.scale을 주면(얼굴·몸통 자리) 그 관심영역만 잘라 분석하고, 배율이 상쇄된 넓이 지수
 * (scaleArea)를 함께 낸다. 기존 호출부(scale 없이 부르는 곳)는 예전과 같은 사진 전체 분석을
 * 그대로 받는다.
 */
export async function analyzeLocal(uri: string, opts: AnalyzeOptions = {}): Promise<LocalAnalysisResult> {
  // 이미지 한 장을 두 단계가 함께 쓰므로 바깥에서 열고, 끝나면 withSkImage가 확실히 해제한다
  return withSkImage(uri, (image) => analyzeImage(image, opts));
}

async function analyzeImage(image: SkImage, opts: AnalyzeOptions): Promise<LocalAnalysisResult> {
  const startedAt = Date.now();
  const { colorGain, scale } = opts;

  // 자가 있으면 관심영역만 잘라 분할한다 — 그 영역이 정사각형이라 종횡비 왜곡이 없다
  const roi = scale ? roiOf(scale, image.width(), image.height()) : undefined;

  const { origW, origH, src, mask, maskOn, maskSoft, bbox, found, maskAreaPct } = await runStage1(image, colorGain, roi);
  const size = labels.img_size_seg;

  /*
    배율이 상쇄된 넓이.

    마스크 한 칸이 가리는 실제 넓이는 (관심영역 넓이 / 512²)이다. 그것을 다 더하면 병변의
    원본 픽셀 넓이가 되고, 자의 d·v로 나누면 배율이 사라진다 — 같은 병변을 두 배 가까이서
    찍으면 넓이도 d·v도 똑같이 네 배가 되므로 몫은 그대로다.
  */
  const scaleArea: ScaleAreaResult | null =
    scale && roi
      ? (() => {
          const perCell = (roi.width * roi.height) / (size * size);
          const lesionPixels = maskSoft * perCell;
          return {
            kind: scale.kind,
            index: Math.round((lesionPixels / scale.areaRef) * 1000) / 10,
            lesionPixels,
            areaRef: scale.areaRef,
            roi,
          };
        })()
      : null;

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
      maskUri = renderMaskOverlay(image, mask, size, labels.mask_threshold, regionOf, roi);
    } catch {
      maskUri = null;
    }
  }

  const rects = maskRegions.length
    ? maskRegions.map((r) => ({
        bbox: maskRectToImage(r.crop, size, src),
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
    scaleArea,
    maskUri,
    regions,
    worstRegionIndex: worstIndex,
    droppedRegions: dropped,
    inferenceTimeMs: Date.now() - startedAt,
  };
}
