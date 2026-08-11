import { LocalAnalysisResult } from '../ai/analyzeLocal';
import { labels, SignKey } from '../ai/labels';
import { DISPLAY_SCALE } from '../folders/theme';
import type { AreaEligibility } from '../monitoring/types';

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
 *
 * ⚠️ 이 값은 **회차 간 비교에 쓸 수 없다.** 분모가 "사진"이라 10cm 더 가까이 가면 병변이
 *    그대로여도 값이 두 배가 된다. 화면에서는 그날 한 장의 크기를 가늠하는 용도로만 쓰고,
 *    변화 추이는 아래 faceAreaIndex로 본다.
 */
export function lesionAreaPct(result: LocalAnalysisResult): number {
  return result.maskAreaPct;
}

/**
 * 배율이 상쇄된 병변 넓이 지수 — 자를 찾은 자리(얼굴·몸통)에서만 나온다.
 *
 * 분모가 그 자리의 크기(얼굴은 안간거리 × 눈-입 거리, 몸통은 어깨너비 × 척추 길이)라 촬영 거리가
 * 달라져도 값이 변하지 않는다. 자를 못 찾았으면 null이고, 그때 폴더 기록에는 넓이 추이가 남지
 * 않는다 — 잴 수 없는 것을 0으로 남기면 그래프가 "병변이 사라졌다"고 말하게 된다.
 */
export function faceAreaIndex(result: LocalAnalysisResult): number | null {
  return result.scaleArea?.index ?? null;
}

/**
 * 그 지수를 **무엇으로 나눈 값인지** — 기록에 함께 남겨야 하는 이유가 분명하다.
 *
 * 지수는 넓이 ÷ (자의 d·v)라서, "부위의 몇 %"로 되돌리려면 그 자의 면적 비례상수가 필요하다
 * (얼굴 5.5, 몸통 0.85 — folders/areaTrend). 종류를 안 남기면 몸통 지수를 얼굴 상수로 나누게
 * 되고, 화면에는 6배 틀린 숫자가 "측정값"인 척 뜬다.
 */
export function faceAreaKind(result: LocalAnalysisResult): 'face' | 'torso' | null {
  return result.scaleArea?.kind ?? null;
}

/**
 * 분석 결과를 모니터링 폴더 기록이 쓰는 스케일(IGA 0~4, 세부 증상 0~10)로 옮긴다.
 * 폴더 화면의 그래프·요약 박스가 이 스케일을 기준으로 그려지므로 여기서 한 번만 환산한다.
 *
 * 넓이 측정 자격(area)은 촬영 시점에만 알 수 있는 정보(정렬·조명·해상도)라 분석 결과에 들어 있지
 * 않고, 부르는 쪽이 세션에서 꺼내 넘긴다. 판정 자체가 없으면(얼굴 자리가 아니면) 넓이를 뺄 이유도
 * 없으므로 통과로 본다.
 */
export function toFolderMetrics(result: LocalAnalysisResult, area?: AreaEligibility) {
  const areaUsable = area ? area.ok : true;
  const symptoms: Record<SymptomRecordKey, number> = { redness: 0, bumps: 0, scratch: 0, thickening: 0 };
  result.signs.forEach((s) => {
    symptoms[SIGN_DISPLAY[s.sign].recordKey] = Math.round(signDisplayValue(s.sign, s.grade)) / 10;
  });
  const faceIndex = faceAreaIndex(result);
  return {
    iga: result.igaGrade,
    ...symptoms,
    areaPct: lesionAreaPct(result),
    // 어긋나게 찍힌 회차는 값을 남기지 않는다 — 추세선에서 빼는 가장 단순하고 확실한 방법이다
    faceAreaIndex: areaUsable ? faceIndex : null,
    faceAreaKind: areaUsable ? faceAreaKind(result) : null,
    /*
      사용자가 해상도 게이트를 직접 열고 잰 값인지.

      이 표시를 기록까지 끌고 가는 이유: 흔들릴 수 있는 값이라는 사실은 **그 값을 읽는 자리**에서
      알아야 쓸모가 있다. 촬영 화면에서 한 번 말하고 마는 것으로는, 두 달 뒤 그래프에서 튀는 점을
      보는 사람에게 아무것도 남지 않는다.
    */
    faceAreaLowRes: areaUsable && !!area?.override,
  };
}
