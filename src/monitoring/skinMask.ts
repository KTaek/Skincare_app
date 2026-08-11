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

import type { SkImage } from '@shopify/react-native-skia';
import { readResizedRGBA } from '../ai/skiaPixels';

/** 추정 출처 — 임계값이 출처마다 다르다 (아래 SKIN_GATE 참고) */
export type SkinSource = 'heuristic' | 'model';

/**
 * 피부 픽셀이 실제로 모여 있는 범위 (표본 격자 대비 0~1의 비율 좌표).
 *
 * 비율로 두는 이유는 표본 격자 크기(160)를 부르는 쪽이 몰라도 되게 하려는 것이다 —
 * 원본 어느 사각형에서 표본을 떴든 같은 비율을 그대로 곱하면 된다.
 *
 * 쓰임이 둘이다:
 *   · 노출·밝기를 **피부가 있는 자리에서만** 재기 위한 창 (뒤쪽 창문이 날아갔다고 촬영을
 *     막을 이유가 없다 — 재려는 것은 피부의 노출이다)
 *   · 피부가 화면에 적게 담긴 사진에서 분류 모델의 입력을 그 자리로 좁히기 위한 크롭
 */
export interface SkinBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

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
  /** 피부가 모여 있는 범위. 피부 표본이 너무 적으면 null (그때는 부르는 쪽이 전체를 쓴다) */
  box: SkinBox | null;
}

/**
 * 피부 점유율의 "충분한" 기준 — 추정 출처에 따라 다르다.
 *
 * 추정기가 부정확한데 임계값만 높이면 멀쩡한 사진을 막게 된다. 임계값은 추정기의
 * 신뢰도와 함께 올라가야 한다.
 *   heuristic 0.55 — 색 규칙의 과소검출을 감안한 값
 *   model     0.85 — 세그 모델의 학습 분포(평균 94.5%) 근방으로 유도
 *
 * ⚠️ **이 값은 더 이상 자동 셔터를 막지 않는다.** 셔터를 막는 것은 frameQuality의 SAFETY뿐이고,
 *    여기는 신뢰도 점수와 화면 막대의 기준으로만 쓰인다. 피부가 적게 담긴 사진은 촬영을 막는
 *    대신 분류 입력을 그 자리로 좁혀서(skinCropOf) 해결한다.
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
  // 피부 픽셀의 가로·세로 분포 — 경계 상자를 가장자리 몇 점에 끌려가지 않게 잘라내는 데 쓴다
  const cols = new Uint32Array(w);
  const rows = new Uint32Array(h);

  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
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
    cols[p % w] += 1;
    rows[(p / w) | 0] += 1;
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
    box: enough ? boxOf(cols, rows, skin, w, h) : null,
  };
}

/**
 * 가장자리 BOX_TRIM만큼을 잘라낸 경계 상자.
 *
 * 최소·최대 좌표를 그대로 쓰면 상자가 **가장 바깥 한 점**에 끌려간다. 나무 책상이나 주황색
 * 물건처럼 피부색 규칙에 걸리는 것이 구석에 하나만 있어도 상자가 화면 전체로 벌어져, 이 상자로
 * 하려던 두 가지(노출을 피부에서만 재기·분류 입력을 피부로 좁히기)가 통째로 무의미해진다.
 * 양끝에서 2%씩 버리면 그런 점들은 떨어져 나가고 실제로 모여 있는 덩어리만 남는다.
 */
const BOX_TRIM = 0.02;

function boxOf(cols: Uint32Array, rows: Uint32Array, total: number, w: number, h: number): SkinBox {
  const [x0, x1] = trimmedBounds(cols, total);
  const [y0, y1] = trimmedBounds(rows, total);
  return { x: x0 / w, y: y0 / h, width: (x1 - x0 + 1) / w, height: (y1 - y0 + 1) / h };
}

/** 한 축의 분포에서 양끝 BOX_TRIM을 잘라낸 [시작, 끝] 칸 번호 (양끝 포함) */
function trimmedBounds(hist: Uint32Array, total: number): [number, number] {
  const cut = total * BOX_TRIM;
  let acc = 0;
  let lo = 0;
  for (let i = 0; i < hist.length; i++) {
    acc += hist[i];
    if (acc > cut) {
      lo = i;
      break;
    }
  }
  acc = 0;
  let hi = hist.length - 1;
  for (let i = hist.length - 1; i >= 0; i--) {
    acc += hist[i];
    if (acc > cut) {
      hi = i;
      break;
    }
  }
  return lo <= hi ? [lo, hi] : [0, hist.length - 1];
}

/** 표본 격자 한 변 — 크롭을 정하는 데만 쓰므로 촬영 판정과 같은 크기면 충분하다 */
const CROP_SAMPLE = 160;
/** 피부 상자 바깥으로 두는 여유 (상자 짧은 변 대비). 경계의 병변이 잘리지 않게 한다 */
const CROP_MARGIN = 0.15;
/** 크롭 한 변의 하한 (프레임 짧은 변 대비) — 작은 피부 조각을 512로 늘려 놓지 않기 위한 바닥 */
const CROP_MIN_OF_MIN_SIDE = 0.35;
/**
 * 이 비율 이상 피부가 담긴 사진은 크롭하지 않는다.
 *
 * 질환 분류 모델은 **프레임 전체를 눌러 넣은 사진**으로 학습됐다. 잘 찍힌 사진까지 가운데를
 * 잘라 넣으면 학습 때 본 적 없는 배치가 되어, 고치려던 것과 상관없는 곳에서 정확도가 흔들린다.
 * 크롭이 필요한 것은 **피부가 적게 담긴 사진**뿐이다 — 촬영 게이트를 걷어내면서 통과하게 된
 * 바로 그 구간이다. 그래서 여기를 넘으면 예전과 똑같이 동작한다.
 */
const CROP_SKIP_RATIO = 0.55;

/**
 * 질환 분류 모델에 넣을 정사각형 크롭 — 피부가 모여 있는 자리로 좁힌다. 없으면 null(전체 사용).
 *
 * 촬영 게이트에서 "피부 55% 이상"을 걷어낸 대가를 여기서 치른다. 그 게이트가 있던 이유는 분류
 * 모델이 크롭 없이 프레임을 통째로 먹기 때문이었다 — 화면의 3분의 2가 카펫이면 모델도 카펫을
 * 본다. 게이트를 없애는 대신 **입력을 피부 쪽으로 좁혀** 같은 문제를 촬영이 아니라 후처리에서
 * 해결한다. 사용자가 할 일이 하나 줄고, 이미 찍어 둔 앨범 사진에도 똑같이 적용된다.
 *
 * 정사각형인 것은 분류 입력이 정사각형으로 눌려 들어가기 때문이다 — 직사각형을 넣으면 그
 * 종횡비만큼 얼굴·병변이 찌그러진다.
 */
export function skinCropOf(image: SkImage): SkinBox | null {
  const w = image.width();
  const h = image.height();
  if (!(w > 0) || !(h > 0)) return null;

  const px = readResizedRGBA(image, { x: 0, y: 0, width: w, height: h }, CROP_SAMPLE, CROP_SAMPLE);
  const est = estimateSkin(px, CROP_SAMPLE, CROP_SAMPLE);
  if (!est.box || est.ratio >= CROP_SKIP_RATIO) return null;

  // 비율 좌표 → 원본 픽셀
  const bx = est.box.x * w;
  const by = est.box.y * h;
  const bw = est.box.width * w;
  const bh = est.box.height * h;

  const minSide = Math.min(w, h);
  // 여유를 두되 정사각형으로 맞춘다. 화면보다 커지면 화면에 맞춰 줄인다.
  const side = Math.min(
    minSide,
    Math.max(CROP_MIN_OF_MIN_SIDE * minSide, Math.max(bw, bh) * (1 + CROP_MARGIN * 2)),
  );
  const cx = bx + bw / 2;
  const cy = by + bh / 2;
  return {
    x: clamp(cx - side / 2, 0, w - side),
    y: clamp(cy - side / 2, 0, h - side),
    width: side,
    height: side,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

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
