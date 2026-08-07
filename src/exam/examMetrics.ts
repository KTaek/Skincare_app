import { LocalAnalysisResult } from '../ai/analyzeLocal';
import { labels, SignKey } from '../ai/labels';
import { DISPLAY_SCALE } from '../folders/theme';

/** 모니터링 폴더 기록(0~10 스케일)에서 세부 증상이 쓰는 필드 이름 */
export type SymptomRecordKey = 'redness' | 'bumps' | 'scratch' | 'thickening';

/**
 * 결과 화면의 "세부 지표" 4종.
 *
 * 제목은 슬라이드 지시대로 의학 용어(홍반/구진/찰상/태선화)를 쓰고, 모니터링 상세 화면이 쓰던
 * 일상어를 힌트로 남겨 둘이 같은 지표임을 알 수 있게 한다. recordKey는 같은 값을 모니터링 폴더
 * 기록으로 옮길 때 쓰는 필드 이름이다.
 */
export const SIGN_DISPLAY: Record<SignKey, { label: string; hint: string; recordKey: SymptomRecordKey }> = {
  erythema: { label: '홍반', hint: '피부 붉기', recordKey: 'redness' },
  papulation: { label: '구진', hint: '오돌토돌함', recordKey: 'bumps' },
  excoriation: { label: '찰상', hint: '긁은 상처', recordKey: 'scratch' },
  lichenification: { label: '태선화', hint: '피부 두꺼워짐', recordKey: 'thickening' },
};

/** 화면에 그리는 순서 — 슬라이드의 "홍반/구진/찰상/태선화" 순서 그대로 */
export const SIGN_ORDER: SignKey[] = ['erythema', 'papulation', 'excoriation', 'lichenification'];

/**
 * sign 등급(0 ~ 최고 등급) → 다른 지표와 같은 0~100 표시값.
 * 등급 수는 labels.json이 sign마다 들고 있으므로 하드코딩하지 않고 거기서 읽는다.
 */
export function signDisplayValue(sign: SignKey, grade: number): number {
  const max = labels.grade_names_by_sign[sign].length - 1;
  return max > 0 ? (grade / max) * 100 : 0;
}

/** IGA 등급(0~4) → 0~100 표시값 (모니터링 상세 화면·그래프와 같은 배율) */
export function igaDisplayValue(grade: number): number {
  return DISPLAY_SCALE.iga(grade);
}

/** 가려움 VAS(0~10) → 0~100 표시값 */
export function itchDisplayValue(vas: number): number {
  return DISPLAY_SCALE.itch(vas);
}

/** 병변 bbox가 사진에서 차지하는 면적 비율(%) — 모니터링 기록의 lesionAreaPct 자리에 들어간다 */
export function lesionAreaPct(result: LocalAnalysisResult): number {
  const { bbox } = result;
  const total = bbox.imageWidth * bbox.imageHeight;
  if (!total) return 0;
  return Math.round(((bbox.width * bbox.height) / total) * 1000) / 10;
}

/**
 * 분석 결과를 모니터링 폴더 기록이 쓰는 스케일(IGA 0~4, 세부 증상 0~10)로 옮긴다.
 * 폴더 화면의 그래프·요약 박스가 이 스케일을 기준으로 그려지므로 여기서 한 번만 환산한다.
 */
export function toFolderMetrics(result: LocalAnalysisResult) {
  const symptoms: Record<SymptomRecordKey, number> = { redness: 0, bumps: 0, scratch: 0, thickening: 0 };
  result.signs.forEach((s) => {
    symptoms[SIGN_DISPLAY[s.sign].recordKey] = Math.round(signDisplayValue(s.sign, s.grade)) / 10;
  });
  return { iga: result.igaGrade, ...symptoms, areaPct: lesionAreaPct(result) };
}
