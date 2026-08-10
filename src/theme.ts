import { Platform, ViewStyle } from 'react-native';

/** 디자인 토큰 — 원본 Flutter 디자인의 색상을 그대로 옮긴 값 */
export const AppColors = {
  bg: '#EDF0F4',
  card: '#FFFFFF',
  greenBody: '#A8E06C',
  greenTop: '#93D258',
  greenDeep: '#2E4A14',
  greenMuted: '#4C6B2C',
  ink: '#1C1C1E',
  sub: '#8E8E93',
  line: '#ECECEF',

  // 중증도 색상
  sev1: '#5FC36A', // 경증
  sev2: '#F2B33C', // 중등증
  sev3: '#EB5757', // 중증

  // 4단계 지표(피부 종합 상태·가려움 안정도·수면 점수·세부 증상)의 "좋음/없음"·"주의/미미함" 색.
  // sev1~3과 별개 축이라 새로 둔다 — 저 셋은 이미 다른 화면(진단 확신도 등)에서 다른 의미로 쓴다.
  sev0: '#5B8DEF',
  // "주의/미미함" — sev2(중등증 노랑, #F2B33C)보다 더 옅게 잡아서 바로 옆 단계인 주황(warn)과
  // 뚜렷이 구분되게 한다.
  sevCaution: '#FFD966',

  navInactive: '#B6BAC1',
} as const;

/**
 * 흰 카드 공통 그림자/데코레이션.
 * Flutter의 BoxShadow(color: 0x0F1E283C, blur: 18, offset: (0,4)) 대응.
 * iOS는 shadow*, Android는 elevation 사용.
 */
export function cardDecoration(radius = 20): ViewStyle {
  return {
    backgroundColor: AppColors.card,
    borderRadius: radius,
    ...Platform.select<ViewStyle>({
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
