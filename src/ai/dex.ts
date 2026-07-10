export function softmax(logits: Float32Array): number[] {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) if (logits[i] > max) max = logits[i];

  const exps = new Array<number>(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    const e = Math.exp(logits[i] - max);
    exps[i] = e;
    sum += e;
  }
  return exps.map((e) => e / sum);
}

/** DEX(Deep EXpectation): 등급 인덱스 기대값 = sum(i * P(grade=i)) */
export function dexExpectation(probs: number[]): number {
  return probs.reduce((sum, p, i) => sum + i * p, 0);
}

/** 왼쪽 열린 구간으로 기대값을 등급에 이산화. thresholds=[0.5,1.5,2.5] → 0~3등급 */
export function bucketize(value: number, thresholds: number[]): number {
  let grade = 0;
  for (const t of thresholds) {
    if (value >= t) grade += 1;
  }
  return grade;
}

export interface SignGrade {
  grade: number;
  gradeName: string;
  expectation: number;
}

export function decodeSign(logits: Float32Array, thresholds: number[], gradeNames: string[]): SignGrade {
  const probs = softmax(logits);
  const expectation = dexExpectation(probs);
  const grade = bucketize(expectation, thresholds);
  return { grade, gradeName: gradeNames[grade], expectation };
}
