import { Platform } from 'react-native';

export const colors = {
  bg: '#F5F0EB',
  surface: '#FFFFFF',
  primary: '#1A1F4B',
  beige: '#E8DDD4',
  rose: '#F2B8B0',
  text: '#3D3D3D',
  muted: '#9A9A9A',
  border: '#E8E3DE',
  green: '#6DB87A',
  yellow: '#F0C05A',
  red: '#E05C5C',
  orange: '#E8843D',
  lime: '#A8D66E',
  teal: '#4F9C93',
  blue: '#6E8FD9',
  coolGray: '#AEB7C2', // 연한 쿨 그레이 — 피부 종합 상태 막대
  warmBrown: '#B0805A', // 웜 브라운 — 가려움 막대
};

/**
 * 참고 디자인(GitHub github.com/KTaek/Skincare_app, src/theme.ts의 AppColors)에서 그대로
 * 옮겨온 팔레트. 모니터링 화면 3개(MonitoringScreen · MonitoringFolderScreen ·
 * MonitoringDetailScreen)와 그 전용 컴포넌트(TrendChart · ScaleBar · LesionThumb)만 이 팔레트를
 * 쓴다 — 위 colors는 그대로 남겨두므로 이 앱에 다른 화면이 추가되어도 영향이 없다.
 */
export const monitoringColors = {
  bg: '#EDF0F4',
  card: '#FFFFFF',
  ink: '#1C1C1E',
  sub: '#8E8E93',
  line: '#ECECEF',
  greenTop: '#93D258',
  greenBody: '#A8E06C',
  greenDeep: '#2E4A14',
  greenMuted: '#4C6B2C',
  sev1: '#5FC36A', // 경증/개선 — 참고 디자인의 sev1
  sev2: '#F2B33C', // 중등증 — 참고 디자인의 sev2
  sev3: '#EB5757', // 중증/악화 — 참고 디자인의 sev3
  warn: '#F0924B', // sev2·sev3 사이를 보간한 4단계용 주황(참고 디자인엔 없어 sev 톤에 맞춰 추가)
  navInactive: '#B6BAC1',
};

/**
 * 흰 카드 공통 그림자 — 참고 디자인의 cardDecoration()과 동일한 값이다(테두리 대신 은은한 그림자로
 * 카드를 띄운다). iOS는 shadow*, Android는 elevation을 쓴다.
 */
export function monitoringCard(radius = 18) {
  return {
    backgroundColor: monitoringColors.card,
    borderRadius: radius,
    ...Platform.select({
      ios: {
        shadowColor: '#1E283C',
        shadowOpacity: 0.06,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 3 },
      default: {},
    }),
  };
}

/**
 * 모니터링 결합 그래프 지표별 고정 색상 — y축 하나(0~100)를 쓰는 꺾은선 콤보 차트.
 * 수면 점수 · 가려움 · 피부 종합 상태 모두 0~100 표시값(DISPLAY_SCALE 참고)으로 재스케일해서
 * 같은 축, 같은 25/50/75/100 눈금 위에 세 꺾은선으로 겹쳐 그린다. 형태는 셋 다 동일(line)하고
 * 색으로만 구분한다.
 *   - 수면 점수: 0~100 그대로, 파란 꺾은선
 *   - 피부 종합 상태(IGA 기댓값 0~4) ×25: 쿨 그레이 꺾은선
 *   - 가려움 VAS(0~10) ×10: 웜 브라운 꺾은선
 */
export const CHART_SERIES = {
  sleep: { key: 'sleepScore', label: '수면 점수', unit: '점', color: '#5B8DEF', shape: 'line' },
  itch: { key: 'itchVas', label: '가려움(VAS)', unit: '점', color: monitoringColors.navInactive, shape: 'line' },
  skin: { key: 'iga', label: '피부 종합 상태', unit: '단계', color: '#B98254', shape: 'line' },
};

/**
 * 피부 종합 상태(IGA) · 가려움(VAS) · 세부 증상은 원래 스케일이 저마다 달라서(0~4, 0~10, 0~10)
 * 화면에 보여줄 땐 모두 0~100으로 맞춘다 — 수면 점수(원래 0~100)와 같은 축·같은 분류 기준을
 * 쓰기 위해서다. 데이터는 원래 스케일 그대로 저장하고(모델이 실제로 내는 값 그대로), 화면에
 * 뿌리기 직전에만 이 배율을 곱한다.
 *   - IGA(0~4) × 25 = 0~100
 *   - 가려움 VAS(0~10) × 10 = 0~100
 *   - 세부 증상(0~10) × 10 = 0~100
 */
export const DISPLAY_SCALE = {
  iga: (v) => v * 25,
  itch: (v) => v * 10,
  symptom: (v) => v * 10,
};

/**
 * 세 지표(피부 종합 상태 · 가려움 · 수면 점수)와 세부 증상 4종 모두 같은 4단계 색을 쓰도록
 * 통일했다 — 편함(연두) · 신경 쓰임(노랑) · 불편(주황) · 매우 불편(빨강).
 *
 * 지표마다 "구간 목록"(SEGMENTS)을 값이 작은 쪽 → 큰 쪽 순서로 정의해 둔다. 각 항목의 `to`는 그
 * 구간의 위쪽 경계값(첫 구간의 아래쪽 경계는 항상 0)이라, 이 배열 하나가 곧 판정 로직(segmentFor)과
 * 스케일 바 눈금(ScaleBar) 양쪽의 단일 기준(source of truth)이 된다. 수면 점수는 높을수록 좋아서
 * 색 순서가 반대(왼쪽이 나쁨)이고, 나머지는 낮을수록 좋아서 왼쪽이 좋음이다. 모두 DISPLAY_SCALE로
 * 환산한 뒤의 0~100 표시값 기준이다.
 */
const LEVEL_COLORS = [monitoringColors.sev1, monitoringColors.sev2, monitoringColors.warn, monitoringColors.sev3];

/** 피부 종합 상태 — 그래프·요약 박스에 쓰는 0~100 표시값(IGA 기댓값 0~4 × 25) 기준 */
export const SKIN_SEGMENTS = [
  { to: 12.4, ko: '편함', color: LEVEL_COLORS[0] },
  { to: 62.4, ko: '신경 쓰임', color: LEVEL_COLORS[1] },
  { to: 87.4, ko: '불편', color: LEVEL_COLORS[2] },
  { to: 100, ko: '매우 불편', color: LEVEL_COLORS[3] },
];

/** 가려움 문진(VAS 0~10 × 10 = 0~100 표시값) — "편함"은 0점 하나뿐이라 폭이 0인 구간이다 */
export const ITCH_SEGMENTS = [
  { to: 0, ko: '편함', color: LEVEL_COLORS[0] },
  { to: 40, ko: '신경 쓰임', color: LEVEL_COLORS[1] },
  { to: 60, ko: '불편', color: LEVEL_COLORS[2] },
  { to: 100, ko: '매우 불편', color: LEVEL_COLORS[3] },
];

/** 수면 점수(삼성헬스 연동, 0~100) — 높을수록 좋아서 색이 나쁨→좋음(빨강→연두) 순서로 놓인다 */
export const SLEEP_SEGMENTS = [
  { to: 59, ko: '매우 불편', color: LEVEL_COLORS[3] },
  { to: 74, ko: '불편', color: LEVEL_COLORS[2] },
  { to: 84, ko: '신경 쓰임', color: LEVEL_COLORS[1] },
  { to: 100, ko: '편함', color: LEVEL_COLORS[0] },
];

/**
 * 세부 증상(피부 붉기 · 오돌토돌함 · 긁은 상처 · 피부 두꺼워짐) 4종이 공유하는 0~100 표시값
 * (원래 0~10 × 10) 구간. 증상마다 다른 설명 문구 대신, 다른 지표와 똑같은 4단계 이름을 쓴다.
 */
export const SYMPTOM_SEGMENTS_BASE = [
  { to: 16.6, ko: '편함', color: LEVEL_COLORS[0] },
  { to: 50.0, ko: '신경 쓰임', color: LEVEL_COLORS[1] },
  { to: 83.3, ko: '불편', color: LEVEL_COLORS[2] },
  { to: 100, ko: '매우 불편', color: LEVEL_COLORS[3] },
];
/** 증상별 이름/부가 설명 — 판정용 4단계 이름은 SYMPTOM_SEGMENTS_BASE의 공용 이름을 그대로 쓴다 */
export const SYMPTOMS = {
  redness: { label: '피부 붉기', hint: '붉어진 정도' },
  bumps: { label: '오돌토돌함', hint: '트러블 · 솟아오름' },
  scratch: { label: '긁은 상처', hint: '피 · 진물 · 상처' },
  thickening: { label: '피부 두꺼워짐', hint: '뻣뻣함 · 굳은살' },
};

/** value가 segments(작은 값 → 큰 값 순) 중 몇 번째 구간에 속하는지 찾아 그 구간 정보를 반환한다 */
export function segmentFor(value, segments) {
  for (let i = 0; i < segments.length; i++) {
    if (value <= segments[i].to || i === segments.length - 1) {
      return { index: i, ...segments[i] };
    }
  }
  return { index: segments.length - 1, ...segments[segments.length - 1] };
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

