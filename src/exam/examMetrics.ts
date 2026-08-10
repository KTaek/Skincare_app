import { LocalAnalysisResult } from '../ai/analyzeLocal';
import { labels, SignKey } from '../ai/labels';
import { DISPLAY_SCALE } from '../folders/theme';

/** 모니터링 폴더 기록(0~10 스케일)에서 세부 증상이 쓰는 필드 이름 */
export type SymptomRecordKey = 'redness' | 'bumps' | 'scratch' | 'thickening';

/**
 * 결과 화면의 "4가지 증상".
 *
 * 의학 용어(홍반/구진/찰상/태선화)는 쓰지 않는다 — 환자가 자기 피부를 보고 바로 맞춰볼 수 있는
 * 일상어만 남긴다. recordKey는 같은 값을 경과 관찰 폴더 기록으로 옮길 때 쓰는 필드 이름이다.
 */
export const SIGN_DISPLAY: Record<SignKey, { label: string; recordKey: SymptomRecordKey }> = {
  erythema: { label: '피부 붉기', recordKey: 'redness' },
  papulation: { label: '오돌토돌함', recordKey: 'bumps' },
  excoriation: { label: '긁은 상처', recordKey: 'scratch' },
  lichenification: { label: '피부 두꺼워짐', recordKey: 'thickening' },
};

/** 화면에 그리는 순서 */
export const SIGN_ORDER: SignKey[] = ['erythema', 'papulation', 'excoriation', 'lichenification'];

/**
 * sign 등급(0 ~ 최고 등급) → 0~100 "원래" 스케일값(0 = 정상, 100 = 최고 등급 — 낮을수록 좋다).
 * DISPLAY_SCALE과 달리 역산하지 않은 raw 값이다 — toFolderMetrics가 경과 관찰 기록에 그대로
 * 저장해 두는 축이 이 스케일이라, 여기서 방향을 바꾸면 저장된 기록의 의미가 흔들린다. 화면에
 * "높을수록 좋음"으로 바로 보여줘야 하면 100에서 빼서 쓴다(ExamResultScreen의 SymptomCard 참고).
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

/**
 * 증상 부위가 사진에서 차지하는 면적 비율(%) — 경과 관찰 기록의 lesionAreaPct 자리에 들어간다.
 * 분할 마스크의 실제 픽셀 넓이를 쓴다 (bbox 넓이는 길게 번진 증상을 크게 부풀린다).
 */
export function lesionAreaPct(result: LocalAnalysisResult): number {
  return result.maskAreaPct;
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
