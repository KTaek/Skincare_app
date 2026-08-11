import { SCALE_SPEC, type ScaleKind } from '../ai/scaleFrame';
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
 *
 * ── 그러면 "지금 얼마나 넓은가"는 어디서 오나 ────────────────────────
 *
 * 변화율만 보여주면 "42% 줄었다"가 무엇에서 무엇으로 줄었는지 알 수 없다. 그래서 절대량도 함께
 * 낸다 — 다만 픽셀 수가 아니라 **그 부위 전체에서 차지하는 비율**로(coveragePct). 그 환산은
 * 부위마다 상수 하나로 끝나고, 그 상수의 오차는 변화율에는 **들어가지 않는다**
 * (분자·분모에 똑같이 곱해져 상쇄된다). 두 숫자의 신뢰도가 다르다는 뜻이라, 화면도 그렇게 말한다.
 */

/** 넓이 추이가 읽는 기록의 최소 모양 (폴더 기록 record의 일부) */
export interface AreaRecord {
  id: string;
  dayOffset: number;
  /** 촬영 시각 (epoch ms) — 가로축 위치의 기준. 같은 날 여러 번 찍어도 겹치지 않는다 */
  ts: number;
  /** 넓이를 잰 회차에만 들어 있다. 못 잰 회차는 null — 0이 아니다("없다"와 "0"은 다르다) */
  lesionAreaFaceIndex?: number | null;
  /**
   * 그 지수를 무엇으로 나눴는지 (얼굴 자 / 몸통 자). 없으면 얼굴 — 이 필드가 생기기 전의
   * 기록은 전부 얼굴 자리였다.
   */
  lesionAreaScaleKind?: ScaleKind | null;
  /**
   * 해상도 게이트를 사용자가 열고 잰 회차인지 (얼굴이 작게 찍힌 사진).
   *
   * 값을 빼지는 않는다 — 흔들릴 뿐 한쪽으로 치우치지는 않기 때문이다. 다만 이 점이 추세에서
   * 튀었을 때 이유를 댈 수 있어야 해서, 화면까지 따라오게 들고 있는다.
   */
  lesionAreaLowRes?: boolean;
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
 *
 * 몸통도 같은 값을 쓴다. 공개 사진으로 잰 프레이밍 잡음은 몸통이 3.6%, 얼굴이 2.6%로 얼굴보다
 * 크지만 둘 다 15%에는 한참 못 미친다 — 이 값은 애초에 **재지 못한 잡음(자세·조명·세그 흔들림)**을
 * 덮는 담요라, 지금 아는 차이만으로 나누면 정밀해 보이기만 하고 근거는 없다.
 * ⚠️ 실기기 데이터가 쌓이면 부위별로 나눌 것 — 몸통은 옷·호흡·자세가 얼굴에 없던 잡음이다.
 */
export const REPEATABILITY_SIGMA = 0.15;
/**
 * 부위마다 다른 재현성.
 *
 * **몸통이 더 크다.** 얼굴의 자(눈·입)는 그 세 점만 보이면 사진에 무엇이 더 담겼든 같은 값이
 * 나오지만, 몸통의 자는 사람 전체를 보는 모델에서 나오기 때문에 프레이밍을 탄다. 가슴/복부만
 * 또는 등만 담아 찍는 방식에서 게이트 허용 범위 안의 퍼짐을 실측하면(poseDetector.ts 표):
 *
 *     얼굴  프레이밍 잡음 2.6%  →  담요 0.15  (약 6배)
 *     몸통  프레이밍 잡음 21%   →  담요 0.22  (약 3배 — 나머지 잡음원은 얼굴과 공유한다)
 *
 * 몸통 0.22는 문턱 ±44%를 뜻한다. 크다. 그래도 낮추면 안 되는 이유는 방향이 반대인 두 실패의
 * 무게가 다르기 때문이다 — 진짜 변화를 "변화 없음"이라고 하는 것보다, **측정 잡음을 호전이라고
 * 말하는 것**이 훨씬 나쁘다. 사용자는 그 말을 믿고 약을 줄인다.
 *
 * ⚠️ 실기기에서 같은 자리를 연속 2~3장 찍어 실제 σ를 재고 두 값 모두 다시 잡을 것.
 */
export const SIGMA_BY_KIND: Record<ScaleKind, number> = {
  face: REPEATABILITY_SIGMA,
  torso: 0.22,
};
/** 이 배수를 넘어야 변화로 인정한다 (2σ ≈ 95% 신뢰) */
export const LOD_K = 2;
/** 변화로 인정하는 최소 폭 (얼굴 ±30%) — 이 안의 오르내림은 측정 오차와 구분되지 않는다 */
export const LOD = REPEATABILITY_SIGMA * LOD_K;

/** 그 부위에서 변화로 인정하는 최소 폭 */
export function lodOf(kind: ScaleKind): number {
  return SIGMA_BY_KIND[kind] * LOD_K;
}

/**
 * 넓이 지수 → "그 부위의 몇 %".
 *
 * 지수의 분모 d·v는 부위의 넓이가 아니라 **넓이에 비례하는 자**다. 그 비례상수는 성인의 실측
 * 비례에서 나오고(ai/scaleFrame의 areaOverAreaRef: 얼굴 5.5, 몸통 0.85), 부위마다 다르므로
 * 회차 기록에 **무엇으로 쟀는지**가 함께 남아 있어야 한다.
 *
 * ⚠️ 사람마다 다르다 — 얼굴이 갸름하거나 체형이 다르면 이 비가 ±15% 정도 움직인다. 그래서 이
 *    상수는 **coveragePct("부위의 몇 %")에만** 들어가고 delta(변화율)에는 전혀 들어가지 않는다:
 *    변화율은 같은 사람의 두 회차를 나눈 값이라 상수가 위아래에서 상쇄된다. 화면에서 두 숫자를
 *    나란히 보여줄 때 이 차이를 반드시 함께 말해야 한다 — 하나는 어림값, 하나는 측정값이다.
 */
export function coveragePctOf(index: number, kind: ScaleKind): number {
  return index / SCALE_SPEC[kind].areaOverAreaRef;
}

/** 이 회차를 무엇으로 쟀는지 — 예전 기록에는 없고, 그때는 전부 얼굴이었다 */
export function scaleKindOfRecord(record: AreaRecord): ScaleKind {
  return record.lesionAreaScaleKind ?? 'face';
}

export interface AreaPoint<R extends AreaRecord> {
  record: R;
  /** 첫 회차 대비 변화율 (-1 = 완전히 사라짐, +1 = 두 배) */
  delta: number;
  /** 이 회차의 병변 넓이가 부위 전체에서 차지하는 비율 (%) — 어림 환산이다 (위 주석) */
  coveragePct: number;
  /** 그 부위의 이름 ("얼굴" / "몸통") — 화면 문구가 여기서 나온다 */
  noun: string;
  /** 화질이 낮은 사진에서 잰 회차 — 값이 흔들릴 수 있다 */
  lowRes: boolean;
}

export interface AreaTrend<R extends AreaRecord> {
  /** 기준이 된 첫 회차 */
  base: R;
  /** 무엇을 자로 쟀는지 — 문턱(lod)과 화면 문구가 여기서 나온다 */
  kind: ScaleKind;
  /** 이 부위에서 변화로 인정하는 최소 폭 (±) */
  lod: number;
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
  // 자의 종류는 기준 회차의 것을 쓴다 — 한 폴더는 한 자리를 따라가므로 회차마다 바뀔 일이 없고,
  // 혹시 섞였다면 기준과 견주는 계산이므로 기준 쪽이 맞다
  const kind = scaleKindOfRecord(base);
  const points = measured.map((record) => ({
    record,
    delta: (record.lesionAreaFaceIndex as number) / baseIndex - 1,
    coveragePct: coveragePctOf(record.lesionAreaFaceIndex as number, scaleKindOfRecord(record)),
    noun: SCALE_SPEC[scaleKindOfRecord(record)].noun,
    lowRes: !!record.lesionAreaLowRes,
  }));

  return {
    base,
    kind,
    lod: lodOf(kind),
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
export function verdictOf(delta: number, kind: ScaleKind = 'face'): AreaVerdict {
  if (Math.abs(delta) < lodOf(kind)) return { ko: '변화 없음', tone: 'same', color: mc.navInactive, lightBg: false };
  return delta < 0
    ? { ko: '좋아지는 중', tone: 'better', color: mc.sev1, lightBg: true }
    : { ko: '넓어지는 중', tone: 'worse', color: mc.sev3, lightBg: false };
}

/** 변화율 → "+12%" / "-33%" */
export function fmtPct(v: number): string {
  return `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;
}

/**
 * 얼굴 대비 넓이 → "20%" / "3.4%".
 *
 * 10% 아래에서만 소수 한 자리를 남긴다. 병변이 작을 때는 1%와 2%가 두 배 차이라 반올림하면
 * 변화가 통째로 사라지고, 클 때는 소수점이 실제로 있지도 않은 정밀도를 흉내 내기 때문이다.
 */
export function fmtCoverage(pct: number): string {
  return `${pct < 10 ? Math.round(pct * 10) / 10 : Math.round(pct)}%`;
}

/**
 * 첫 회차 대비 변화를 말로 — "처음보다 42% 감소".
 *
 * 띠(lodOf) 안이면 방향을 말하지 않는 규칙은 verdictOf와 같다. 여기서 "처음보다 3% 감소"라고 써
 * 놓고 배지에는 "변화 없음"을 달면, 화면 한 줄 안에서 앱이 스스로 모순된 말을 하게 된다.
 */
export function changePhrase(delta: number, kind: ScaleKind = 'face'): string {
  if (Math.abs(delta) < lodOf(kind)) return '처음과 비슷해요';
  return `처음보다 ${Math.round(Math.abs(delta) * 100)}% ${delta < 0 ? '감소' : '증가'}`;
}
