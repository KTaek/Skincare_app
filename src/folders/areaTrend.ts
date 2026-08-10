import { monitoringColors as mc } from './theme';

/**
 * 병변 넓이 추이 계산 — 결과 화면과 폴더 화면이 **함께 쓰는 단 하나의 출처**.
 *
 * 두 화면이 같은 값을 따로 계산하면 언젠가 반드시 어긋난다. 촬영 직후 "−18% 좋아지는 중"이라고
 * 해 놓고 폴더에 들어가니 "변화 없음"이면, 사용자는 어느 쪽을 믿어야 할지 알 수 없다.
 * 판정 문구·기준·색까지 여기서 한 번만 정한다.
 *
 * ── 왜 절대값이 아니라 상대 변화인가 ──────────────────────────────────
 *
 * 넓이 지수(lesionAreaFaceIndex)의 절대값에는 세그 모델의 계통 편향(경계를 조금 넓게 혹은 좁게
 * 잡는 버릇)이 그대로 들어 있다. 같은 편향이 모든 회차에 똑같이 들어가므로 **비율을 내면 상당
 * 부분 상쇄된다.** 사용자가 알고 싶은 것도 "몇 %인가"가 아니라 "줄었나"다.
 *
 * 기준은 항상 **첫 회차**다. 직전 회차 대비로 하면 매번 작은 변화만 보이고 두 달에 걸친 흐름이
 * 안 보인다.
 */

/** 넓이 추이가 읽는 기록의 최소 모양 (폴더 기록 record의 일부) */
export interface AreaRecord {
  id: string;
  dayOffset: number;
  /** 촬영 시각 (epoch ms) — 가로축 위치의 기준. 같은 날 여러 번 찍어도 겹치지 않는다 */
  ts: number;
  /** 넓이를 잰 회차에만 들어 있다. 못 잰 회차는 null — 0이 아니다("없다"와 "0"은 다르다) */
  lesionAreaFaceIndex?: number | null;
}

/**
 * 같은 조건으로 연달아 찍었을 때 넓이가 흔들리는 폭(상대표준편차)의 잠정값.
 *
 * 잡음의 출처는 넷이다 — 프레이밍(거리·위치), 자세, 조명에 따른 마스크 경계 이동, 세그의 확률
 * 흔들림. 이 중 **프레이밍만** 합성 장면으로 측정해 두었다: 얼굴 크기를 520~840px로 바꾸고
 * 위치를 옮겨 가며 같은 병변을 재면 지수가 2.6% 안에서 움직인다(정규화 없이 프레임 대비 %로
 * 재면 같은 조건에서 161% 벌어진다). 나머지 셋은 실기기에서만 잴 수 있다.
 *
 * ⚠️ 그래서 15%는 나머지 셋을 넉넉히 잡은 보수적인 가정이다. 등록 직후 같은 자리를 연속 2~3장
 *    찍어 실제 σ를 재고 이 값을 낮출 것. 크게 잡으면 진짜 변화를 "변화 없음"이라고 할 위험이
 *    있지만, 반대(측정 잡음을 호전이라고 말하는 것)가 훨씬 나쁘다.
 */
export const REPEATABILITY_SIGMA = 0.15;
/** 이 배수를 넘어야 변화로 인정한다 (2σ ≈ 95% 신뢰) */
export const LOD_K = 2;
/** 변화로 인정하는 최소 폭 (±30%) — 이 안의 오르내림은 측정 오차와 구분되지 않는다 */
export const LOD = REPEATABILITY_SIGMA * LOD_K;

export interface AreaPoint<R extends AreaRecord> {
  record: R;
  /** 첫 회차 대비 변화율 (-1 = 완전히 사라짐, +1 = 두 배) */
  delta: number;
}

export interface AreaTrend<R extends AreaRecord> {
  /** 기준이 된 첫 회차 */
  base: R;
  /** 넓이를 잰 회차만, 날짜 순 */
  points: AreaPoint<R>[];
  /** 가장 최근에 잰 회차 */
  latest: AreaPoint<R>;
  /** 넓이를 못 재서 빠진 회차 수 */
  skipped: number;
  /** 아직 기준 한 장뿐이라 "변화"를 말할 수 없는 상태 */
  baselineOnly: boolean;
}

/**
 * 각 회차의 가로축 위치 (0~1).
 *
 * 촬영 **순서**가 아니라 **시각**으로 벌린다 — 3일 만에 찍은 것과 3주 만에 찍은 것을 같은
 * 간격으로 두면 변화 속도가 왜곡된다. 날짜가 아니라 시각(ts)을 쓰는 이유는 같은 날 두 번 찍은
 * 기록이 한 점에 겹치지 않게 하기 위해서다.
 *
 * 모든 회차가 같은 순간이면(있을 수 없지만 방어) 균등 간격으로 편다 — 0으로 나누지 않는다.
 */
export function timeAxisOf<R extends AreaRecord>(points: readonly AreaPoint<R>[]): number[] {
  const t = points.map((p) => p.record.ts);
  const span = t[t.length - 1] - t[0];
  if (!(span > 0)) return points.map((_, i) => (points.length > 1 ? i / (points.length - 1) : 0));
  return t.map((v) => (v - t[0]) / span);
}

/** 넓이를 잰 회차만 골라 첫 회차 대비 변화율로 바꾼다. 잰 회차가 하나도 없으면 null */
export function areaTrendOf<R extends AreaRecord>(records: readonly R[]): AreaTrend<R> | null {
  const measured = records.filter((r) => r.lesionAreaFaceIndex != null && r.lesionAreaFaceIndex > 0);
  if (measured.length === 0) return null;

  const base = measured[0];
  const baseIndex = base.lesionAreaFaceIndex as number;
  const points = measured.map((record) => ({
    record,
    delta: (record.lesionAreaFaceIndex as number) / baseIndex - 1,
  }));

  return {
    base,
    points,
    latest: points[points.length - 1],
    skipped: records.length - measured.length,
    baselineOnly: points.length < 2,
  };
}

export type AreaTone = 'better' | 'same' | 'worse';

export interface AreaVerdict {
  ko: string;
  tone: AreaTone;
  color: string;
  /** 밝은 배경이라 흰 글자가 안 읽히는 색인지 — 배지를 그리는 쪽이 글자색을 고를 때 쓴다 */
  lightBg: boolean;
}

/**
 * 변화율 → 판정. 띠(LOD) 안이면 **방향을 말하지 않는다.**
 * 측정 오차와 구분되지 않는 움직임에 "좋아졌다"를 붙이면, 그건 없는 정보를 지어내는 것이다.
 */
export function verdictOf(delta: number): AreaVerdict {
  if (Math.abs(delta) < LOD) return { ko: '변화 없음', tone: 'same', color: mc.navInactive, lightBg: false };
  return delta < 0
    ? { ko: '좋아지는 중', tone: 'better', color: mc.sev1, lightBg: true }
    : { ko: '넓어지는 중', tone: 'worse', color: mc.sev3, lightBg: false };
}

/** 변화율 → "+12%" / "-33%" */
export function fmtPct(v: number): string {
  return `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;
}
