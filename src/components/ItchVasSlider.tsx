import React, { useRef } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import { AppColors } from '../theme';
import { MAX_VAS } from '../records/itchStore';

/**
 * 숫자(VAS 0~10)마다 "이 정도면 어떤 느낌인지"를 한 줄로 — 숫자만 보고 고르기 어려워서 붙였다.
 * 4단계 배지(band)와는 다른 경계선을 쓴다 — 이 문구는 실제 문진 기준(생활·수면 방해 정도)을
 * 그대로 옮긴 것이라, ITCH_SEGMENTS(화면 표시용 4단계)와 굳이 같은 경계일 필요가 없다.
 */
export function itchHintFor(vas: number): string {
  if (vas <= 0) return '가려움 없음';
  if (vas <= 3) return '무의식 중에 긁음 (생활이나 수면방해는 없음)';
  if (vas <= 6) return '생활, 수면 방해 정도의 가려움 (온종일은 아님)';
  if (vas <= 9) return '대부분의 시간 동안 생활과 수면을 방해하는 가려움';
  return '가려움으로 생활과 수면 장애가 심함';
}

/**
 * VAS 슬라이더 — 0(가렵지 않음) ~ 10(상상할 수 있는 최악).
 *
 * 드래그로 값을 바꾼다. 손가락 x좌표는 화면 절대좌표(pageX)로만 안정적으로 얻을 수 있어서,
 * 트랙이 화면의 어디에 놓였는지(pageX)를 onLayout 때 재 두고 그 차이로 위치를 계산한다.
 *
 * 트랙 밑에는 양 끝(0·MAX_VAS)과 가운데(MAX_VAS/2) 세 눈금만 남긴다 — 값 하나하나를 누르는
 * 버튼 줄과 손잡이 위 말풍선은 뺐다. 지금 값은 카드 쪽(DayItchCard)이 상단 배지로 이미 보여
 * 주므로 여기서 또 띄울 필요가 없다.
 */
export default function ItchVasSlider({
  value,
  onChange,
  color,
}: {
  value: number;
  onChange: (v: number) => void;
  /** 지금 단계(band)의 색 — 채움·손잡이가 함께 이 색을 쓴다 */
  color: string;
}) {
  const trackRef = useRef<View>(null);
  const geom = useRef({ x: 0, width: 0 });

  const updateFromPageX = (pageX: number) => {
    const { x, width } = geom.current;
    if (width <= 0) return;
    const t = Math.min(1, Math.max(0, (pageX - x) / width));
    onChange(Math.round(t * MAX_VAS));
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => updateFromPageX(e.nativeEvent.pageX),
      onPanResponderMove: (_e, g) => updateFromPageX(g.moveX),
    }),
  ).current;

  const frac = value / MAX_VAS;
  const mid = MAX_VAS / 2;

  return (
    <View>
      <View
        ref={trackRef}
        style={styles.sliderTrack}
        onLayout={() => trackRef.current?.measureInWindow((x, _y, width) => { geom.current = { x, width }; })}
        {...pan.panHandlers}
      >
        <View style={styles.sliderRail} />
        <View style={[styles.sliderFill, { width: `${frac * 100}%`, backgroundColor: color }]} />
        <View style={[styles.sliderThumb, { left: `${frac * 100}%`, borderColor: color }]} />
      </View>

      <View style={styles.tickRow}>
        <Text style={styles.tick}>0 (없음)</Text>
        <Text style={[styles.tick, styles.tickCenter]}>{mid} (중간)</Text>
        <Text style={[styles.tick, styles.tickRight]}>{MAX_VAS} (극심함)</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // 손가락이 닿을 자리를 넉넉히 주려고 높이를 크게 잡고, 그 안에 레일/채움/손잡이를 그린다
  sliderTrack: { height: 44, justifyContent: 'center' },
  sliderRail: { height: 8, borderRadius: 4, backgroundColor: '#E7E9EC' },
  sliderFill: { position: 'absolute', left: 0, height: 8, borderRadius: 4 },
  sliderThumb: {
    position: 'absolute',
    width: 28,
    height: 28,
    marginLeft: -14,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 5,
  },

  tickRow: { flexDirection: 'row', marginTop: 8 },
  tick: { flex: 1, fontSize: 11.5, color: AppColors.sub },
  tickCenter: { textAlign: 'center' },
  tickRight: { textAlign: 'right' },
});
