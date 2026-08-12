/**
 * 모니터링 폴더 화면 전용 디자인 토큰.
 *
 * 색/그림자는 앱 공용 팔레트(../theme의 AppColors · cardDecoration)를 그대로 재사용한다 —
 * 이 기능은 원래 별도 프로토타입(app2)에서 이 팔레트를 베껴 쓰던 것이라 값이 완전히 같다.
 * 여기서 새로 정의하는 건 그 팔레트에 없던 4단계 중간색(warn) 하나와, 지표 스케일/구간 정의뿐이다.
 */
import { AppColors, cardDecoration } from '../theme';

export const monitoringColors = {
  ...AppColors,
  warn: '#F0924B', // sev2·sev3 사이를 보간한 4단계용 주황 (AppColors엔 없어 sev 톤에 맞춰 추가)
};

/**
 * 등급을 매길 수 없는 자리의 색.
 *
 * 4가지 증상·IGA 모델은 아토피 채점 기준으로 학습돼 있어서 다른 질환(건선·주사 등)에는 근거가
 * 없다. 그 자리에 4단계 색 중 하나를 붙이면 없는 판정을 지어내는 것이라, **어느 단계도 아니라는
 * 뜻의 채도 없는 회색**을 쓴다. 전신 지도의 동그라미와 폴더 화면의 요약 칸이 같은 색이어야
 * "이건 못 재는 자리구나"가 한 번만 학습된다.
 */
export const NO_GRADE_COLOR = '#AEB6C0';

/** 흰 카드 공통 그림자 — 공용 cardDecoration을 쓰되 기본 반경만 이 화면들에 맞춰 18로 둔다 */
export function monitoringCard(radius = 18) {
  return cardDecoration(radius);
}

/**
 * 모니터링 결합 그래프 지표별 고정 색상 — y축 하나(0~100)를 쓰는 꺾은선 콤보 차트.
 * 수면 점수 · 가려움 안정도 · 피부 종합 상태 모두 0~100 표시값(DISPLAY_SCALE 참고)으로
 * 재스케일해서 같은 축, 같은 25/50/75/100 눈금 위에 세 꺾은선으로 겹쳐 그린다. 형태는 셋 다
 * 동일(line)하고 색으로만 구분한다 — 이 색은 그래프 꺾은선뿐 아니라, 모니터링 폴더 화면 상단
 * 요약칸의 원형 아이콘 배지 색에도 그대로 써서 "어느 꺾은선이 어느 항목인지"가 바로 이어져
 * 보이게 한다.
 *   - 피부 종합 상태: 코럴(주황빛 빨강)
 *   - 가려움 안정도: 청록
 *   - 수면 점수: 남색
 */
export const CHART_SERIES = {
  sleep: { key: 'sleepScore', label: '수면 점수', unit: '점', color: '#1E3A8A', shape: 'line' },
  itch: { key: 'itchVas', label: '가려움 안정도', unit: '점', color: '#0F9488', shape: 'line' },
  skin: { key: 'iga', label: '피부 종합 상태', unit: '단계', color: '#E36657', shape: 'line' },
};

/**
 * 피부 종합 상태(IGA) · 가려움(VAS) · 세부 증상은 원래 스케일이 저마다 달라서(0~4, 0~10, 0~10)
 * 화면에 보여줄 땐 모두 0~100으로 맞춘다 — 수면 점수(원래 0~100)와 같은 축·같은 분류 기준을
 * 쓰기 위해서다. 데이터는 원래 스케일 그대로 저장하고(모델이 실제로 내는 값 그대로), 화면에
 * 뿌리기 직전에만 이 식을 적용한다.
 *
 * 모델이 내는 원래 값은 셋 다 "낮을수록 좋음"이지만(0=정상), 총점 100점을 "높을수록 좋다"고
 * 직관적으로 읽는 수면 점수와 나란히 보여주면 사용자가 반대로 헷갈린다. 그래서 화면 표시값은
 * 100에서 뺀 "역산 점수"로 통일한다 — 수면 점수와 똑같이 100점이 가장 좋고 0점이 가장 나쁘다.
 *   - IGA(0~4): 100 - 원값 × 25
 *   - 가려움 VAS(0~10): 100 - 원값 × 10
 *   - 세부 증상(0~10): 100 - 원값 × 10
 */
export const DISPLAY_SCALE = {
  iga: (v) => 100 - v * 25,
  itch: (v) => 100 - v * 10,
  symptom: (v) => 100 - v * 10,
};

/**
 * 네 지표(피부 종합 상태 · 가려움 안정도 · 수면 점수 · 세부 증상 4종) 모두 같은 4단계 색과 "100점 =
 * 가장 좋음" 방향을 공유한다 — 좋음/없음(파랑) · 주의/미미함(노랑) · 나쁨/두드러짐(주황) ·
 * 매우 나쁨/뚜렷함(빨강). 이름은 지표마다 다르지만(피부 종합 상태·가려움 안정도·수면 점수는
 * 좋음/주의/나쁨/매우 나쁨, 세부 증상은 없음/미미함/두드러짐/뚜렷함) 같은 4단계·같은 색이다.
 * 노랑과 주황(warn)은 바로 옆 단계라 헷갈리기 쉬워서, sev2(기존 3단계 중증도의 "중등증" 색,
 * #F2B33C)보다 더 옅은 전용 노랑(sevCaution)을 따로 쓴다.
 *
 * 지표마다 "구간 목록"(SEGMENTS)을 정의해 둔다. 각 항목의 `to`는 그 구간의 위쪽 경계값(첫 구간의
 * 아래쪽 경계는 항상 0)이고, segmentFor는 배열 순서가 아니라 이 `to` 값으로 구간을 찾으므로 배열
 * 순서를 값 크기와 다르게 둬도 판정 로직은 그대로 맞는다 — 순서는 오직 ScaleBar가 막대를 왼쪽부터
 * 그리는 "시각적 배치"만 정한다. 피부 종합 상태·가려움 안정도·수면 점수 셋은 낮은 값(왼쪽)이
 * 나쁨, 높은 값(오른쪽)이 좋음이라 색 순서가 같다(빨강 → 주황 → 노랑 → 파랑). 세부 증상
 * (SYMPTOM_SEGMENTS_BASE)만 그 반대로 배치해 뒀다 — 이유는 그쪽 주석 참고. 모두 DISPLAY_SCALE로
 * 환산한 뒤의 0~100 표시값 기준이다.
 */
const LEVEL_COLORS = [monitoringColors.sev0, monitoringColors.sevCaution, monitoringColors.warn, monitoringColors.sev3];

/** 피부 종합 상태 — 그래프·요약 박스에 쓰는 0~100 표시값(100 - IGA 기댓값 0~4 × 25) 기준 */
export const SKIN_SEGMENTS = [
  { to: 12.6, ko: '매우 나쁨', color: LEVEL_COLORS[3] },
  { to: 37.6, ko: '나쁨', color: LEVEL_COLORS[2] },
  { to: 87.6, ko: '주의', color: LEVEL_COLORS[1] },
  { to: 100, ko: '좋음', color: LEVEL_COLORS[0] },
];

/** 가려움 안정도(100 - VAS 0~10 × 10 = 0~100 표시값) — "좋음"은 100점 하나뿐이라 폭이 0인 구간이다 */
export const ITCH_SEGMENTS = [
  { to: 30, ko: '매우 나쁨', color: LEVEL_COLORS[3] },
  { to: 50, ko: '나쁨', color: LEVEL_COLORS[2] },
  { to: 90, ko: '주의', color: LEVEL_COLORS[1] },
  { to: 100, ko: '좋음', color: LEVEL_COLORS[0] },
];

/** 수면 점수(삼성헬스 연동, 0~100) — 원래부터 높을수록 좋아서 그대로 쓴다(역산 없음) */
export const SLEEP_SEGMENTS = [
  { to: 59, ko: '매우 나쁨', color: LEVEL_COLORS[3] },
  { to: 74, ko: '나쁨', color: LEVEL_COLORS[2] },
  { to: 84, ko: '주의', color: LEVEL_COLORS[1] },
  { to: 100, ko: '좋음', color: LEVEL_COLORS[0] },
];

/**
 * 증상 4종(피부 붉기 · 오돌토돌함 · 긁은 상처 · 피부 두꺼워짐)이 공유하는 0~100 표시값
 * (100 - 원래 0~10 × 10) 구간. 다른 지표와 같은 4단계·색이되, 세부 증상은 점수 대신 이 이름만
 * 보여준다(뚜렷함/두드러짐/미미함/없음 — 모델 등급 3/2/1/0 그대로).
 *
 * 다른 세 지표(피부 종합 상태·가려움 안정도·수면 점수)와 달리 **왼쪽이 좋음(없음), 오른쪽이
 * 나쁨(뚜렷함)**이다 — "증상이 없는 상태"를 왼쪽(시작점)에 두는 게 체크리스트처럼 더 자연스럽게
 * 읽혀서 이 지표만 배치를 반대로 뒀다. `to` 값은 그대로 두고 배열 순서만 바꿨다 — segmentFor는
 * 순서가 아니라 `to`로 구간을 찾으므로 판정에는 영향이 없다.
 */
export const SYMPTOM_SEGMENTS_BASE = [
  { to: 100, ko: '없음', color: LEVEL_COLORS[0] },
  { to: 83.4, ko: '미미함', color: LEVEL_COLORS[1] },
  { to: 50.0, ko: '두드러짐', color: LEVEL_COLORS[2] },
  { to: 16.7, ko: '뚜렷함', color: LEVEL_COLORS[3] },
];

/** 증상별 이름 — 판정용 4단계 이름은 SYMPTOM_SEGMENTS_BASE의 공용 이름을 그대로 쓴다 */
export const SYMPTOMS = {
  redness: { label: '피부 붉기' },
  bumps: { label: '오돌토돌함' },
  scratch: { label: '긁은 상처' },
  thickening: { label: '피부 두꺼워짐' },
};

/**
 * value가 속하는 구간을 찾아 그 구간 정보(+ 배열 안에서의 위치 index)를 반환한다.
 *
 * segments 배열의 순서가 아니라 각 항목의 `to`(구간 상한)로 판정한다 — SYMPTOM_SEGMENTS_BASE처럼
 * 시각적 배치(왼쪽부터 그려지는 순서) 때문에 값이 작은 구간이 배열 뒤쪽에 올 수 있어서, 배열
 * 순서에 기대면 엉뚱한 구간이 잡힌다. index는 ScaleBar가 "그 칸"을 색칠할 때 배열 위치로 다시
 * 찾아야 해서 함께 돌려준다.
 */
export function segmentFor(value, segments) {
  let best = null;
  segments.forEach((s, i) => {
    if (value <= s.to && (best === null || s.to < best.to)) {
      best = { ...s, index: i };
    }
  });
  if (best) return best;
  // value가 모든 to보다 크면(부동소수 오차 등) to가 가장 큰 구간으로 떨어진다
  let maxI = 0;
  segments.forEach((s, i) => { if (s.to > segments[maxI].to) maxI = i; });
  return { index: maxI, ...segments[maxI] };
}

export function sleepBand(score) {
  return segmentFor(score, SLEEP_SEGMENTS);
}

/** displayVas: DISPLAY_SCALE.itch()로 이미 0~100으로 환산한 값(원래 VAS 0~10이 아니다) */
export function itchBand(displayVas) {
  return segmentFor(displayVas, ITCH_SEGMENTS);
}

/**
 * 피부 종합 상태 — 그래프·요약 박스에 쓰는 0~100 표시값(IGA 기댓값 0~4 × 25, DISPLAY_SCALE.iga) 기준.
 * 모델이 각 단계의 확률(P(0)~P(4))에 대한 기댓값을 출력하므로 실제 값은 1.7처럼 정수 사이
 * 소수도 나온다 — DISPLAY_SCALE.iga로 환산한 값을 그대로 이 함수에 넣어 4단계 중 어디에
 * 해당하는지만 고른다.
 */
export function skinConditionInfo(displayValue) {
  return segmentFor(displayValue, SKIN_SEGMENTS);
}

/** displayValue: DISPLAY_SCALE.symptom()으로 이미 0~100으로 환산한 값 — 다른 지표와 같은 공용 4단계 이름을 고른다 */
export function symptomBand(displayValue) {
  return segmentFor(displayValue, SYMPTOM_SEGMENTS_BASE);
}
