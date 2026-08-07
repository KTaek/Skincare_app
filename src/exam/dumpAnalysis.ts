import { LesionBox, LocalAnalysisResult, SignResult } from '../ai/analyzeLocal';
import { DiseasePrediction } from '../ai/diseaseModel';
import { IGA_GRADE_TO_SEVERITY, labels, SIGN_KEYS } from '../ai/labels';
import { Baseline, SessionConfidence } from '../monitoring/types';
import diseaseMeta from '../../assets/models/disease_labels.json';
import { makeRng } from '../folders/store';

/**
 * 카메라 탭을 온디바이스 모델 없이 굴리는 스위치.
 *
 * 실기기에서 tflite 모델이 "Failed to allocate memory for input/output tensors"로 뜨지 않아
 * 검사 흐름 전체가 막히는 상태라, 화면 설계를 먼저 확인할 수 있도록 모델을 아예 부르지 않고
 * 아래 dump 값으로 결과를 채운다.
 *
 * ⚠️ 여기서 나오는 숫자는 전부 가짜다 — 실제 병변과 아무 관계가 없다.
 * 모델이 다시 뜨면 이 상수만 false로 바꾸면 원래의 실제 분석 경로로 돌아간다
 * (호출부는 두 경로를 모두 그대로 들고 있다).
 */
export const DUMP_RESULTS = true;

/** 문자열 → 32bit 정수 시드 (folders/store.js의 해시와 같은 FNV-1a) */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** dump bbox를 그릴 가상의 원본 해상도 — 화면에서는 비율로만 쓰이므로 값 자체는 의미가 없다 */
const DUMP_IMAGE_SIZE = 1000;

/**
 * 중증도 dump — 종합 등급(IGA)을 먼저 뽑고, 세부 증상 4종을 그 근처에서 흔들어 만든다.
 * 증상이 전부 같은 값이면 화면이 밋밋해서 실제 결과처럼 보이지 않는다.
 *
 * seedKey가 같으면 항상 같은 값이 나온다 — 리렌더마다 숫자가 바뀌면 결과 화면이 아니라
 * 난수 표시기가 되기 때문이다.
 */
export function makeDumpLocalResult(seedKey: string): LocalAnalysisResult {
  const rng = makeRng(hashStr(`local:${seedKey}`));
  const pick = (n: number) => Math.floor(rng() * n);

  // 0(Clear)이나 4(Severe)만 계속 나오면 스케일 바가 양 끝에 붙어 단조로우므로 가운데 위주로 뽑는다
  const igaGrade = 1 + pick(3);

  const signs: SignResult[] = SIGN_KEYS.map((sign) => {
    const grades = labels.grade_names_by_sign[sign];
    const max = grades.length - 1;
    const grade = Math.max(0, Math.min(max, igaGrade - 1 + pick(2)));
    return { sign, grade, gradeName: grades[grade] };
  });

  // 사진 가운데를 살짝 벗어난 자리에 병변이 있는 것처럼 박스를 잡는다
  const side = 0.28 + rng() * 0.2;
  const left = (1 - side) / 2 + (rng() - 0.5) * 0.12;
  const top = (1 - side) / 2 + (rng() - 0.5) * 0.12;
  const bbox: LesionBox = {
    x: left * DUMP_IMAGE_SIZE,
    y: top * DUMP_IMAGE_SIZE,
    width: side * DUMP_IMAGE_SIZE,
    height: side * DUMP_IMAGE_SIZE,
    imageWidth: DUMP_IMAGE_SIZE,
    imageHeight: DUMP_IMAGE_SIZE,
  };

  return {
    signs,
    igaGrade,
    igaGradeName: labels.grade_names_by_sign.iga[igaGrade],
    severity: IGA_GRADE_TO_SEVERITY[igaGrade] ?? 1,
    bbox,
    inferenceTimeMs: 0,
  };
}

/**
 * 질환 분류 dump — 한 클래스가 뚜렷하게 높고 나머지가 완만히 떨어지는 분포로 만든다.
 * 실제 softmax 출력과 비슷한 모양이라야 상위 3개 카드가 그럴듯하게 보인다.
 */
export function makeDumpDiseases(seedKey: string): DiseasePrediction[] {
  const rng = makeRng(hashStr(`disease:${seedKey}`));
  const classes: string[] = diseaseMeta.classes;
  const display: string[] = diseaseMeta.display_names;

  const weights = classes.map(() => rng() * 0.12);
  weights[Math.floor(rng() * classes.length)] = 1.2 + rng() * 1.6;
  const sum = weights.reduce((a, b) => a + b, 0) || 1;

  return classes
    .map((key, i) => ({ key, label: display[i] ?? key, score: weights[i] / sum }))
    .sort((a, b) => b.score - a.score);
}

/**
 * 기준 사진(baseline) dump.
 *
 * 원래는 세그멘테이션이 찾은 병변 크기·방향에서 나오는 값이다. dump 모드에서도 이걸 남겨야
 * 다음 촬영 때 고스트 겹쳐보기와 가이드 박스 크기가 동작한다 — 안 그러면 "경과 이어서 기록"의
 * 핵심 화면을 확인할 수 없다.
 */
export function makeDumpBaseline(sessionId: string, uri: string): Baseline {
  return {
    sessionId,
    processedUri: uri,
    orientation: 0,
    // 가이드 박스가 화면 짧은 변의 70% 정도가 되도록 잡은 값 (FIELD_OF_VIEW_FACTOR 3.2 기준)
    radiusNorm: 0.11,
    colorStats: { mean: [0.5, 0.45, 0.42], std: [0.1, 0.1, 0.1] },
    brightness: 0.5,
  };
}

/** 촬영 신뢰도 dump — 품질 판정도 모델(세그멘테이션)을 쓰므로 함께 지어낸다 */
export function makeDumpConfidence(seedKey: string): SessionConfidence {
  const rng = makeRng(hashStr(`confidence:${seedKey}`));
  const score = 68 + Math.floor(rng() * 28); // 68~95 — "그럭저럭 잘 찍힌" 범위
  return {
    score,
    tier: score >= 75 ? 'high' : 'medium',
    breakdown: { focus: 0.8, exposure: 0.8, framing: 0.8, registration: 1, color: 1 },
    warnings: [],
    usable: true,
  };
}
