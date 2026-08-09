/**
 * 피부 영역 추정 — "이 프레임이 정말 피부를 찍은 것인가"를 판정한다.
 *
 * 지금은 YCbCr 색공간의 고전적인 피부색 규칙을 쓴다. 피부 세그 모델이 번들에 들어오면
 * estimateSkin의 내부만 갈아끼우면 되도록 입출력(SkinEstimate)을 맞춰 두었다.
 *
 * ⚠️ 세그 모델이 들어와도 이 휴리스틱을 지우지 말 것.
 *    학습 데이터의 평균 피부 면적이 94.5%라, 모델은 저피부율 프레임을 거의 본 적이 없다.
 *    그런데 게이트가 필요한 구간이 바로 그 저피부율 구간이다 — 배경을 찍었을 때 모델이
 *    배경에 피부를 환각하면 게이트가 모델과 함께 무너진다. 값싼 색 규칙을 1차 방어선으로
 *    남겨 두고, 모델은 그 위에서 정밀도를 올리는 2차 검증으로 쓴다.
 *
 * ⚠️ 색 규칙의 한계: 매우 어두운 피부톤과 강한 색조명(주황 백열등 등)에서 과소검출한다.
 *    그래서 휴리스틱일 때의 게이트 임계값(SKIN_GATE.heuristic)은 일부러 낮게 잡아
 *    "책상을 찍었다" 수준의 명백한 실패만 걸러낸다. 모델이 붙으면 임계값을 올린다.
 */

/** 추정 출처 — 임계값이 출처마다 다르다 (아래 SKIN_GATE 참고) */
export type SkinSource = 'heuristic' | 'model';

export interface SkinEstimate {
  source: SkinSource;
  /** 표본에서 피부로 판정된 픽셀 비율 (0~1) */
  ratio: number;
  /**
   * 피부 픽셀의 채널별 **중앙값** (0~1) — 조명 보정의 기준.
   *
   * 평균이 아니라 중앙값을 쓰는 이유: 이 값은 "조명이 어떤 색인가"를 나타내야 하는데,
   * 평균을 쓰면 병변의 붉은 색이 섞여 들어가 조명이 붉은 것으로 오인된다. 그러면 보정이
   * 병변의 붉기를 지워버려 — 우리가 재려는 신호를 정규화가 삭제하는 꼴이 된다.
   *
   * 병변 마스크로 빼내는 방법도 있지만 그러려면 세그 모델을 매번 돌려야 하고, 정상 피부만
   * 찍은 사진에서는 뺄 것도 없다. 중앙값은 병변이 피부의 절반을 넘지 않는 한 정상 피부 쪽에
   * 머무르므로, 모델 없이 같은 목적을 달성하고 병변이 없어도 그대로 동작한다.
   */
  skinMedians: [number, number, number];
  /** 중앙값을 잰 피부 픽셀 수 — 너무 적으면 조명 기준으로 신뢰할 수 없다 */
  skinCount: number;
}

/**
 * 피부 점유율 하한 — 추정 출처에 따라 다르다.
 *
 * 추정기가 부정확한데 임계값만 높이면 멀쩡한 사진을 막게 된다. 임계값은 추정기의
 * 신뢰도와 함께 올라가야 한다.
 *   heuristic 0.55 — 색 규칙의 과소검출을 감안한 값. 명백한 실패만 차단
 *   model     0.85 — 세그 모델의 학습 분포(평균 94.5%) 근방으로 유도
 */
export const SKIN_GATE: Record<SkinSource, number> = {
  heuristic: 0.55,
  model: 0.85,
};

/** 색상(채도) 판정이 의미를 갖는 밝기 범위. 너무 어둡거나 날아간 픽셀은 크로마를 믿을 수 없다 */
const Y_MIN = 40;
const Y_MAX = 250;
/** YCbCr 피부색 규칙의 통상적인 경계값 */
const CR_MIN = 133;
const CR_MAX = 173;
const CB_MIN = 77;
const CB_MAX = 127;

/**
 * RGBA 픽셀 버퍼에서 피부 비율과 피부 픽셀의 채널별 중앙값을 한 번에 계산한다.
 *
 * 중앙값은 채널마다 256칸 히스토그램으로 구한다 — 값이 어차피 0~255 정수라 정확하고,
 * 정렬 없이 한 번의 순회로 끝난다.
 *
 * @param px  RGBA8888 픽셀 (길이 = w*h*4)
 * @param w,h px의 격자 크기
 */
export function estimateSkin(px: Uint8Array, w: number, h: number): SkinEstimate {
  const n = w * h;
  let skin = 0;
  const histR = new Uint32Array(256);
  const histG = new Uint32Array(256);
  const histB = new Uint32Array(256);

  for (let i = 0; i < px.length; i += 4) {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];

    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    if (luma < Y_MIN || luma > Y_MAX) continue;
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    if (cr < CR_MIN || cr > CR_MAX || cb < CB_MIN || cb > CB_MAX) continue;

    skin += 1;
    histR[r] += 1;
    histG[g] += 1;
    histB[b] += 1;
  }

  // 피부 표본이 너무 적으면 조명 기준을 세울 수 없다. 중립값을 돌려주고,
  // 부르는 쪽이 skinCount를 보고 보정을 건너뛴다.
  const enough = skin >= Math.max(64, n * 0.02);
  const skinMedians: [number, number, number] = enough
    ? [median(histR, skin) / 255, median(histG, skin) / 255, median(histB, skin) / 255]
    : [0.5, 0.5, 0.5];

  return {
    source: 'heuristic',
    ratio: n > 0 ? skin / n : 0,
    skinMedians,
    skinCount: enough ? skin : 0,
  };
}

/** 256칸 히스토그램에서 중앙값(누적이 절반을 넘는 첫 칸)을 찾는다 */
function median(hist: Uint32Array, total: number): number {
  const half = total / 2;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= half) return v;
  }
  return 128;
}
