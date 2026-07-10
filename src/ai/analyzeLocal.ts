import { loadSkImage, extractNormalizedRGB } from './skiaPixels';
import { runSegModel, runClsModel } from './tfliteService';
import { maskToBbox } from './maskToBbox';
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

export interface LocalAnalysisResult {
  signs: SignResult[];
  igaGrade: number;
  igaGradeName: string;
  /** 기존 앱 전역의 1~3단계 중증도 체계로 축약한 값 (SevBadge 등 기존 UI와 호환) */
  severity: number;
  bbox: LesionBox;
  /** Stage1+Stage2 추론 전체 소요 시간 (ms) */
  inferenceTimeMs: number;
}

async function runStage1(uri: string) {
  const image = await loadSkImage(uri);
  const origW = image.width();
  const origH = image.height();
  const fullRect = { x: 0, y: 0, width: origW, height: origH };

  const stage1Input = extractNormalizedRGB(image, fullRect, labels.img_size_seg, labels.imagenet_mean, labels.imagenet_std);
  const mask = await runSegModel(stage1Input);

  const { bbox, found } = maskToBbox(mask, labels.img_size_seg, labels.img_size_seg, origW, origH, {
    threshold: labels.mask_threshold,
    margin: labels.crop_margin,
    minRatio: labels.min_crop_ratio,
  });

  return { image, origW, origH, bbox, found };
}

/** 카메라 미리보기 중 주기적으로 호출 — 병변 위치 박스만 가볍게 계산 (Stage2 분류는 생략) */
export async function detectBboxLocal(uri: string): Promise<LesionBox | null> {
  const { origW, origH, bbox, found } = await runStage1(uri);
  if (!found) return null;
  return { x: bbox.x1, y: bbox.y1, width: bbox.x2 - bbox.x1, height: bbox.y2 - bbox.y1, imageWidth: origW, imageHeight: origH };
}

/** 촬영된 사진 전체 분석: Stage1(분할) → bbox → crop → Stage2(분류) → DEX 등급 산출 */
export async function analyzeLocal(uri: string): Promise<LocalAnalysisResult> {
  const startedAt = Date.now();

  const { image, origW, origH, bbox } = await runStage1(uri);

  const cropRect = { x: bbox.x1, y: bbox.y1, width: bbox.x2 - bbox.x1, height: bbox.y2 - bbox.y1 };
  const stage2Input = extractNormalizedRGB(image, cropRect, labels.img_size_cls, labels.imagenet_mean, labels.imagenet_std);
  const clsOut = await runClsModel(stage2Input);

  const signs: SignResult[] = SIGN_KEYS.map((key) => {
    const decoded = decodeSign(clsOut[key], labels.dex_thresholds_by_sign[key], labels.grade_names_by_sign[key]);
    return { sign: key, grade: decoded.grade, gradeName: decoded.gradeName };
  });

  const igaDecoded = decodeSign(clsOut.iga, labels.dex_thresholds_by_sign.iga, labels.grade_names_by_sign.iga);

  return {
    signs,
    igaGrade: igaDecoded.grade,
    igaGradeName: igaDecoded.gradeName,
    severity: IGA_GRADE_TO_SEVERITY[igaDecoded.grade] ?? 1,
    bbox: { x: bbox.x1, y: bbox.y1, width: cropRect.width, height: cropRect.height, imageWidth: origW, imageHeight: origH },
    inferenceTimeMs: Date.now() - startedAt,
  };
}
