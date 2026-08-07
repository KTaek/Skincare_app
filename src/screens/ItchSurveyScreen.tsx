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
 * 먼저 "넘어가기 / 등록하기"를 고르고, 등록하기를 골랐을 때만 VAS 눈금자(0~10)가 열린다.
 * 넘어가기를 고르면 결과 화면의 가려움 카드는 "등록 안함"으로 남는다 — 억지로 0점을 넣으면
 * 실제로 안 가려웠던 날과 구분이 안 돼 추세가 왜곡되기 때문이다.
 */
export default function ItchSurveyScreen({
  stepLabel,
  onBack,
  onDone,
}: {
  stepLabel: string;
  onBack: () => void;
  /** 등록하지 않았으면 null */
  onDone: (vas: number | null) => void;
}) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'skip' | 'record' | null>(null);
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
        <Text style={styles.question}>오늘의 가려움 정도를{'\n'}함께 기록할까요?</Text>
        <View style={{ height: 6 }} />
        <Text style={styles.caption}>기록해 두면 피부 상태 추이와 겹쳐 볼 수 있어요.</Text>
        <View style={{ height: 20 }} />

        <RadioRow label="넘어가기" selected={mode === 'skip'} onPress={() => setMode('skip')} />
        <RadioRow label="등록하기" selected={mode === 'record'} onPress={() => setMode('record')} />

        {mode === 'record' && (
          <>
            <View style={{ height: 26 }} />
            <View style={styles.vasHeadRow}>
              <Text style={styles.vasValue}>
                {vas}
                <Text style={styles.vasUnit}> / 10</Text>
              </Text>
              <Text style={[styles.vasBand, { color: band.color }]}>{band.ko}</Text>
            </View>
            <View style={{ height: 14 }} />
            <VasRuler value={vas} onChange={setVas} />
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          style={[styles.nextBtn, !mode && styles.nextBtnDisabled]}
          disabled={!mode}
          onPress={() => onDone(mode === 'record' ? vas : null)}
        >
          <Text style={[styles.nextBtnText, !mode && styles.nextBtnTextDisabled]}>다음</Text>
        </Pressable>
      </View>
    </View>
  );
}

function RadioRow({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.radioRow, selected && styles.radioRowActive]} onPress={onPress}>
      <View style={[styles.radioOuter, selected && styles.radioOuterActive]}>
        {selected && <View style={styles.radioInner} />}
      </View>
      <Text style={[styles.radioLabel, selected && styles.radioLabelActive]}>{label}</Text>
    </Pressable>
  );
}

/**
 * VAS 눈금자 — 0(No itch) ~ 10(Worst itch imaginable).
 *
 * 드래그로 값을 바꾼다. 손가락 x좌표는 화면 절대좌표(pageX)로만 안정적으로 얻을 수 있어서,
 * 트랙이 화면의 어디에 놓였는지(pageX)를 onLayout 때 재 두고 그 차이로 위치를 계산한다.
 */
function VasRuler({ value, onChange }: { value: number; onChange: (v: number) => void }) {
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
      <View
        ref={trackRef}
        style={styles.rulerTrack}
        onLayout={() => trackRef.current?.measureInWindow((x, _y, width) => { geom.current = { x, width }; })}
        {...pan.panHandlers}
      >
        <View style={styles.rulerBaseline} />
        {TICKS.map((t) => (
          <View key={t} style={[styles.rulerTick, t % 5 === 0 && styles.rulerTickMajor, { left: `${(t / MAX_VAS) * 100}%` }]} />
        ))}
        <View style={[styles.rulerThumb, { left: `${frac * 100}%` }]} />
      </View>

      <View style={styles.rulerNumbers}>
        {TICKS.map((t) => (
          <Text key={t} style={[styles.rulerNumber, t === value && styles.rulerNumberActive, { left: `${(t / MAX_VAS) * 100}%` }]}>
            {t}
          </Text>
        ))}
      </View>

      <View style={styles.rulerEnds}>
        <Text style={styles.rulerEndText}>No itch</Text>
        <Text style={[styles.rulerEndText, { textAlign: 'right' }]}>Worst itch{'\n'}imaginable</Text>
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

  question: { fontSize: 18, fontWeight: '800', color: AppColors.ink, lineHeight: 26 },
  caption: { fontSize: 12.5, color: AppColors.sub, lineHeight: 18 },

  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#E7E9EC',
    backgroundColor: '#F7F8FA',
    marginBottom: 12,
  },
  radioRowActive: { borderColor: AppColors.greenTop, backgroundColor: '#F4FBEC' },
  radioOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#C9CDD4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterActive: { borderColor: AppColors.greenTop },
  radioInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: AppColors.greenTop },
  radioLabel: { marginLeft: 14, fontSize: 16, fontWeight: '700', color: AppColors.ink },
  radioLabelActive: { color: AppColors.ink },

  vasHeadRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  vasValue: { fontSize: 30, fontWeight: '800', color: AppColors.ink },
  vasUnit: { fontSize: 15, fontWeight: '600', color: AppColors.sub },
  vasBand: { fontSize: 13, fontWeight: '800', marginBottom: 5 },

  // 눈금자: 손가락이 닿을 자리를 넉넉히 주려고 높이를 크게 잡고, 그 안에 기준선/눈금/썸을 그린다
  rulerTrack: { height: 54, justifyContent: 'center' },
  rulerBaseline: { height: 2, backgroundColor: AppColors.ink },
  rulerTick: { position: 'absolute', bottom: 26, width: 1.5, height: 12, marginLeft: -0.75, backgroundColor: AppColors.ink },
  rulerTickMajor: { height: 20, width: 2, marginLeft: -1 },
  rulerThumb: {
    position: 'absolute',
    top: 12,
    width: 30,
    height: 30,
    marginLeft: -15,
    borderRadius: 15,
    backgroundColor: AppColors.greenTop,
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  rulerNumbers: { height: 18, marginTop: 2 },
  rulerNumber: {
    position: 'absolute',
    width: 24,
    marginLeft: -12,
    textAlign: 'center',
    fontSize: 11,
    color: AppColors.sub,
  },
  rulerNumberActive: { color: AppColors.ink, fontWeight: '800' },
  rulerEnds: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  rulerEndText: { flex: 1, fontSize: 11, color: AppColors.sub, lineHeight: 15 },

  footer: { paddingHorizontal: 24, paddingBottom: 24, paddingTop: 8 },
  nextBtn: { backgroundColor: AppColors.greenTop, borderRadius: 16, paddingVertical: 15, alignItems: 'center' },
  nextBtnDisabled: { backgroundColor: '#E7E9EC' },
  nextBtnText: { fontSize: 16, fontWeight: '700', color: '#16320A' },
  nextBtnTextDisabled: { color: AppColors.sub },
});
