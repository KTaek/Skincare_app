import { LesionBox, LocalAnalysisResult, SignResult } from '../ai/analyzeLocal';
import { DiseasePrediction } from '../ai/diseaseModel';
import { IGA_GRADE_TO_SEVERITY, labels, SIGN_KEYS } from '../ai/labels';
import { Baseline, SessionConfidence } from '../monitoring/types';
import diseaseMeta from '../../assets/models/disease_labels.json';
import { makeRng } from '../folders/store';

/**
 * 촬영 탭을 온디바이스 모델 없이 굴리는 스위치.
 *
 * 지금은 꺼져 있다 — 실제 학습 체크포인트 3종(질환 cls_dis_512 · 중증도 cls_sev_384 ·
 * 분할 seg_lesion_512)을 float32 입출력 TFLite로 변환해 번들에 넣었고, 그 모델들이 기기에서
 * 실제로 돌아간다. 아래 dump 값은 모델 없이 화면만 확인할 일이 다시 생겼을 때를 위해 남겨 둔다.
 *
 * ⚠️ 켜면 여기서 나오는 숫자는 전부 가짜다 — 실제 피부 상태와 아무 관계가 없다.
 */
export const DUMP_RESULTS = false;

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

  // 사진 가운데를 살짝 벗어난 자리에 증상이 있는 것처럼 박스를 잡는다
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

  const igaGradeName = labels.grade_names_by_sign.iga[igaGrade];
  return {
    signs,
    igaGrade,
    igaGradeName,
    severity: IGA_GRADE_TO_SEVERITY[igaGrade] ?? 1,
    bbox,
    // 실제 마스크가 없으니 박스 넓이의 절반쯤을 마스크 넓이로 친다 (박스는 여백을 포함한다)
    maskAreaPct: Math.round(side * side * 50 * 10) / 10,
    // 자 기준 넓이는 지어내지 않는다 — 자 검출과 분할이 함께 있어야 나오는 값이라,
    // 그럴듯한 숫자를 넣으면 dump 모드에서 넓이 추이 그래프가 진짜처럼 그려진다
    scaleArea: null,
    // 마스크 오버레이는 지어낼 방법이 없다 — dump 모드에서는 원본 사진만 보인다
    maskUri: null,
    // dump에서는 판정 단위를 하나로만 지어낸다 — 여러 단위는 실제 마스크가 있어야 나온다
    regions: [
      {
        bbox,
        signs,
        igaGrade,
        igaGradeName,
        share: 1,
        areaPct: Math.round(side * side * 50 * 10) / 10,
        mergedBlobs: 1,
        foreignPct: 0,
      },
    ],
    worstRegionIndex: 0,
    droppedRegions: 0,
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
 * 다음 촬영의 조명 보정과 확인 화면의 기준 사진 비교가 동작한다 — 안 그러면 "경과 이어서 기록"의
 * 핵심 화면을 확인할 수 없다.
 */
export function makeDumpBaseline(sessionId: string, uri: string): Baseline {
  return {
    sessionId,
    processedUri: uri,
    skinReference: [0.5, 0.45, 0.42],
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
    breakdown: { focus: 0.8, exposure: 0.8, skin: 0.9, color: 1 },
    warnings: [],
    usable: true,
  };
}
