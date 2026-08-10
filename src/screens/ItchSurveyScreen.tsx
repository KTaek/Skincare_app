import React, { useRef, useState } from 'react';
import { PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { AppColors } from '../theme';
import { ITCH_SEGMENTS, segmentFor, DISPLAY_SCALE } from '../folders/theme';

const MAX_VAS = 10;
const TICKS = Array.from({ length: MAX_VAS + 1 }, (_, i) => i);

/**
 * 가려움 문진 — 촬영 직전 단계.
 *
 * 건너뛰기를 없앴다. 예전에는 "넘어가기 / 등록하기"를 먼저 고르게 했는데, 매번 촬영할 때마다
 * 거치는 단계에 선택지를 하나 더 얹으면 대부분 그냥 넘어가 버려서 추이가 비어 버린다. 지금은
 * 바를 움직이거나 숫자를 탭하기만 하면 되고, 손대지 않으면 기본값(0 = 가렵지 않음) 그대로
 * 다음으로 넘어간다.
 */
export default function ItchSurveyScreen({
  stepLabel,
  onBack,
  onDone,
}: {
  stepLabel: string;
  onBack: () => void;
  onDone: (vas: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const [vas, setVas] = useState(0);

  const band = segmentFor(DISPLAY_SCALE.itch(vas), ITCH_SEGMENTS);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={onBack}>
          <MaterialIcons name="chevron-left" size={24} color={AppColors.ink} />
        </Pressable>
        <Text style={styles.headerTitle}>가려움 문진</Text>
      </View>
      <Text style={styles.step}>{stepLabel}</Text>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.question}>오늘 가려움은{'\n'}어느 정도인가요?</Text>
        <View style={{ height: 6 }} />
        <Text style={styles.caption}>바를 움직이거나 숫자를 눌러주세요.</Text>

        <View style={{ height: 34 }} />
        <VasSlider value={vas} onChange={setVas} color={band.color} />

        <View style={{ height: 26 }} />
        <View style={[styles.bandBox, { borderColor: band.color }]}>
          <Text style={[styles.bandText, { color: band.color }]}>{band.ko}</Text>
          <Text style={styles.bandHint}>{itchHintFor(vas)}</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={styles.nextBtn} onPress={() => onDone(vas)}>
          <Text style={styles.nextBtnText}>다음</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * 숫자(VAS 0~10)마다 "이 정도면 어떤 느낌인지"를 한 줄로 — 숫자만 보고 고르기 어려워서 붙였다.
 * 4단계 배지(band)와는 다른 경계선을 쓴다 — 이 문구는 실제 문진 기준(생활·수면 방해 정도)을
 * 그대로 옮긴 것이라, ITCH_SEGMENTS(화면 표시용 4단계)와 굳이 같은 경계일 필요가 없다.
 */
function itchHintFor(vas: number): string {
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
 * 지금 값은 손잡이 위에 말풍선으로 띄워 손가락에 가려도 읽히게 한다.
 */
function VasSlider({
  value,
  onChange,
  color,
}: {
  value: number;
  onChange: (v: number) => void;
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

  return (
    <View>
      <View style={styles.bubbleStrip}>
        <View style={[styles.bubble, { left: `${frac * 100}%`, backgroundColor: color }]}>
          <Text style={styles.bubbleText}>{value}</Text>
        </View>
      </View>

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

      {/* 숫자를 직접 눌러도 값이 정해진다 — 드래그가 어려운 손에도 길을 하나 더 준다 */}
      <View style={styles.numberRow}>
        {TICKS.map((t) => (
          <Pressable key={t} style={styles.numberBtn} onPress={() => onChange(t)} hitSlop={4}>
            <Text style={[styles.number, t === value && { color, fontWeight: '800' }]}>{t}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8 },
  backBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: AppColors.ink, marginRight: 38 },
  step: { textAlign: 'center', fontSize: 12, fontWeight: '600', color: AppColors.sub },
  body: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 12 },

  question: { fontSize: 20, fontWeight: '800', color: AppColors.ink, lineHeight: 29 },
  caption: { fontSize: 12.5, color: AppColors.sub, lineHeight: 18 },

  bubbleStrip: { height: 34, position: 'relative' },
  bubble: {
    position: 'absolute',
    minWidth: 40,
    marginLeft: -20,
    borderRadius: 9,
    paddingVertical: 5,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  bubbleText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },

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

  numberRow: { flexDirection: 'row', marginTop: 2 },
  numberBtn: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  number: { fontSize: 12, color: AppColors.sub },

  bandBox: {
    borderRadius: 14,
    borderWidth: 1.5,
    paddingVertical: 16,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  bandText: { fontSize: 18, fontWeight: '800' },
  bandHint: { fontSize: 12.5, color: AppColors.sub, marginTop: 4 },

  footer: { paddingHorizontal: 24, paddingBottom: 24, paddingTop: 8 },
  nextBtn: { backgroundColor: AppColors.greenTop, borderRadius: 16, paddingVertical: 15, alignItems: 'center' },
  nextBtnText: { fontSize: 16, fontWeight: '800', color: '#16320A' },
});
