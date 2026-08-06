import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { AppColors, cardDecoration } from '../theme';
import {
  SkinStatus,
  kUserName,
  currentStatusFromRecords,
  worstItchTimeSlot,
  timeSlotOf,
  addDays,
  dayOffsetLabel,
  Routine,
} from '../models';
import { SectionHeader, RoutineRowContent } from '../components/widgets';
import { useRoutines } from '../context/RoutineContext';
import { useRecords } from '../context/RecordsContext';
import { useLatestMonitoringRecord } from '../folders/store';
import { DISPLAY_SCALE, skinConditionInfo, itchBand, sleepBand } from '../folders/theme';
import ItchDetailScreen from './ItchDetailScreen';

export default function HomeScreen({ navigation }: { navigation: any }) {
  const { sorted, routinesForOffset, toggleForOffset } = useRoutines();
  const { records } = useRecords();
  const currentStatus = useMemo(() => currentStatusFromRecords(records), [records]);
  const latestMonitoring = useLatestMonitoringRecord();
  const [showDetail, setShowDetail] = useState(false);
  // "루틴" 카드가 지금 몇 일째를 보여주고 있는지 (0=오늘, 음수=과거, 양수=미래)
  const [careDayOffset, setCareDayOffset] = useState(0);

  // 평소 가려움이 가장 심했던 시간대에 지금이 해당하면 미리 진정 케어를 안내
  const worstSlot = useMemo(() => worstItchTimeSlot(records), [records]);
  const showItchTip = worstSlot != null && timeSlotOf(new Date()) === worstSlot.slot;

  const goCamera = () => navigation.navigate('Camera');
  const goRoutine = () => navigation.navigate('Routine');

  if (showDetail) {
    return <ItchDetailScreen records={records} onBack={() => setShowDetail(false)} />;
  }

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24 }}
    >
      <Text style={styles.greeting}>안녕하세요, {kUserName}님</Text>
      <View style={{ height: 3 }} />
      <Text style={styles.headline}>오늘 피부 상태를 확인해볼까요?</Text>
      <View style={{ height: 14 }} />

      <StatusCard
        userName={kUserName}
        status={currentStatus}
        monitoring={latestMonitoring?.record}
        onDetail={() => setShowDetail(true)}
      />

      {showItchTip && (
        <>
          <View style={{ height: 12 }} />
          <ItchTipCard />
        </>
      )}

      <View style={{ height: 16 }} />

      <ScanCard onScan={goCamera} />

      <SectionHeader title="루틴" onMore={goRoutine} />
      <TodayCareCard
        dayOffset={careDayOffset}
        onStepDay={(delta) => setCareDayOffset((o) => o + delta)}
        routinesForOffset={routinesForOffset}
        onToggle={(id) => toggleForOffset(careDayOffset, id)}
      />
    </ScrollView>
  );
}

/**
 * "루틴" 카드 — 왼쪽으로 슬라이드하면 하루씩 과거(어제, 그제…)로, 오른쪽으로
 * 슬라이드하면 하루씩 미래(내일, 모레…)로 넘어간다. 미래 날짜는 아직 이행할 수 없으니
 * 체크박스를 비활성화한다.
 */
function TodayCareCard({
  dayOffset,
  onStepDay,
  routinesForOffset,
  onToggle,
}: {
  dayOffset: number;
  onStepDay: (delta: number) => void;
  routinesForOffset: (offsetDays: number) => Routine[];
  onToggle: (id: number) => void;
}) {
  const routines = routinesForOffset(dayOffset).slice(0, 3);
  const label = dayOffsetLabel(dayOffset, addDays(new Date(), dayOffset));
  const isFuture = dayOffset > 0;

  const dragX = useRef(new Animated.Value(0)).current;
  const contentOpacity = useRef(new Animated.Value(1)).current;

  const stepDay = (delta: number) => {
    Animated.timing(contentOpacity, { toValue: 0, duration: 120, useNativeDriver: true }).start(() => {
      onStepDay(delta);
      Animated.timing(contentOpacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_, g) => dragX.setValue(g.dx * 0.3),
      onPanResponderRelease: (_, g) => {
        Animated.spring(dragX, { toValue: 0, useNativeDriver: true, friction: 8 }).start();
        const SWIPE_THRESHOLD = 40;
        if (g.dx <= -SWIPE_THRESHOLD) stepDay(-1); // 왼쪽으로 슬라이드 → 어제(과거) 방향
        else if (g.dx >= SWIPE_THRESHOLD) stepDay(1); // 오른쪽으로 슬라이드 → 내일(미래) 방향
      },
      onPanResponderTerminate: () => {
        Animated.spring(dragX, { toValue: 0, useNativeDriver: true, friction: 8 }).start();
      },
    }),
  ).current;

  return (
    <View>
      <View style={styles.dayNavRow}>
        <Pressable onPress={() => stepDay(-1)} style={styles.dayNavBtn} hitSlop={8}>
          <MaterialIcons name="chevron-left" size={20} color={AppColors.sub} />
        </Pressable>
        <Text style={styles.dayNavLabel}>{label}</Text>
        <Pressable onPress={() => stepDay(1)} style={styles.dayNavBtn} hitSlop={8}>
          <MaterialIcons name="chevron-right" size={20} color={AppColors.sub} />
        </Pressable>
      </View>
      <Animated.View
        {...panResponder.panHandlers}
        style={{ transform: [{ translateX: dragX }], opacity: contentOpacity }}
      >
        <View style={[cardDecoration(), { paddingHorizontal: 18 }]}>
          {[0, 1, 2].map((i) => (
            <View
              key={i}
              style={[
                { paddingVertical: 15 },
                i !== 2 && { borderBottomWidth: 1, borderBottomColor: AppColors.line },
              ]}
            >
              {i < routines.length ? (
                <FadingRoutineRow
                  routine={routines[i]}
                  onToggle={isFuture ? undefined : () => onToggle(routines[i].id)}
                />
              ) : (
                <View style={{ height: 26 }} />
              )}
            </View>
          ))}
        </View>
      </Animated.View>
    </View>
  );
}

/** 체크 시 목록에서 사라지지 않고, 줄긋기와 함께 서서히 흐려지는 홈 루틴 행 */
function FadingRoutineRow({ routine, onToggle }: { routine: Routine; onToggle?: () => void }) {
  const opacity = useRef(new Animated.Value(routine.done ? 0.45 : 1)).current;
  useEffect(() => {
    Animated.timing(opacity, {
      toValue: routine.done ? 0.45 : 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, [routine.done, opacity]);
  return (
    <Animated.View style={{ opacity }}>
      <RoutineRowContent routine={routine} onToggle={onToggle} />
    </Animated.View>
  );
}

// ---- 그린 상태 카드 ----
function StatusCard({
  userName,
  status,
  monitoring,
  onDetail,
}: {
  userName: string;
  status: SkinStatus;
  /** 전 모니터링 폴더를 통틀어 가장 최근 촬영 기록 — 아직 하나도 없으면 undefined */
  monitoring?: { iga: number; itchVas: number; sleepScore: number; lesionAreaPct: number };
  onDetail: () => void;
}) {
  // 모니터링 페이지의 요약 박스(피부 종합 상태 · 가려움 · 수면 점수)와 같은 0~100 표시값·4단계
  // 판정을 그대로 가져와 쓴다 — 병변 면적만 별도 4단계 없이 원본 % 그대로 보여준다(모니터링
  // 폴더 화면과 동일).
  const skinValue = monitoring ? DISPLAY_SCALE.iga(monitoring.iga) : null;
  const itchValue = monitoring ? DISPLAY_SCALE.itch(monitoring.itchVas) : null;
  const skin = skinValue != null ? skinConditionInfo(skinValue) : null;
  const itch = itchValue != null ? itchBand(itchValue) : null;
  const sleep = monitoring ? sleepBand(monitoring.sleepScore) : null;

  return (
    <View style={styles.statusShadow}>
      <View style={styles.statusClip}>
        <View style={styles.statusHeader}>
          <Text style={styles.statusHeaderText}>{userName}님의 최근 피부 상태</Text>
          <Pressable onPress={onDetail}>
            <Text style={styles.detailLink}>자세히 보기</Text>
          </Pressable>
        </View>
        <View style={styles.statusBody}>
          <Text style={styles.statusDisease}>{status.disease}</Text>
          <View style={{ height: 18 }} />
          <View style={{ flexDirection: 'row' }}>
            <Stat
              label="피부 종합 상태"
              value={skinValue != null ? skinValue.toFixed(1) : '-'}
              unit="/100"
              band={skin?.ko ?? ' '}
              bandColor={skin?.color}
            />
            <Divider />
            <Stat
              label="가려움"
              value={itchValue != null ? `${itchValue}` : '-'}
              unit="/100"
              band={itch?.ko ?? ' '}
              bandColor={itch?.color}
            />
            <Divider />
            <Stat
              label="수면 점수"
              value={monitoring ? `${monitoring.sleepScore}` : '-'}
              unit="/100"
              band={sleep?.ko ?? ' '}
              bandColor={sleep?.color}
            />
            <Divider />
            <Stat
              label="병변 면적"
              value={monitoring ? monitoring.lesionAreaPct.toFixed(1) : '-'}
              unit="%"
              band=" "
            />
          </View>
        </View>
      </View>
    </View>
  );
}

const Divider = () => <View style={styles.divider} />;

function Stat({
  label,
  value,
  unit,
  band,
  bandColor,
}: {
  label: string;
  value: string;
  unit?: string;
  band: string;
  bandColor?: string;
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
      <View style={{ height: 6 }} />
      <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
        <Text style={styles.statValue}>{value}</Text>
        {unit != null && <Text style={styles.statUnit}>{unit}</Text>}
      </View>
      <View style={{ height: 4 }} />
      <Text style={[styles.statDelta, bandColor && { color: bandColor }]} numberOfLines={1}>
        {band}
      </Text>
    </View>
  );
}

// ---- 시간대별 가려움 케어 팁 ----
function ItchTipCard() {
  return (
    <View style={styles.tipCard}>
      <View style={styles.tipIcon}>
        <MaterialIcons name="ac-unit" size={20} color="#2D7DD2" />
      </View>
      <View style={{ width: 12 }} />
      <Text style={styles.tipText}>
        <Text style={styles.tipBold}>평소 가려움이 심한 시간대에요. </Text>
        가려움이 심해지기 전에 보습이나 냉찜질로 피부를 미리 진정시켜보세요.
      </Text>
    </View>
  );
}

// ---- 스캔 안내 카드 ----
function ScanCard({ onScan }: { onScan: () => void }) {
  return (
    <Pressable onPress={onScan} style={[cardDecoration(), styles.scanCard]}>
      <View style={styles.scanIcon}>
        <MaterialIcons name="photo-camera" size={26} color="#5A5A5E" />
      </View>
      <View style={{ width: 14 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.scanTitle}>지금 바로 피부를 스캔하세요</Text>
        <View style={{ height: 3 }} />
        <Text style={styles.scanSub}>AI가 피부 병변 상태를 정밀히 분석해드립니다</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  greeting: { fontSize: 14, color: AppColors.sub },
  headline: { fontSize: 18, fontWeight: '700', color: AppColors.ink },

  statusShadow: {
    borderRadius: 22,
    shadowColor: '#A8C746',
    shadowOpacity: 0.25,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  statusClip: { borderRadius: 22, overflow: 'hidden' },
  statusHeader: {
    backgroundColor: AppColors.greenTop,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusHeaderText: { fontSize: 14, fontWeight: '600', color: AppColors.greenDeep },
  detailLink: { fontSize: 12.5, fontWeight: '600', color: AppColors.sub },
  statusBody: { backgroundColor: AppColors.greenBody, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 18 },
  statusDisease: { fontSize: 24, fontWeight: '800', color: '#15290A' },
  divider: { width: 1, height: 52, backgroundColor: 'rgba(40,70,20,0.18)' },
  stat: { flex: 1, alignItems: 'center', paddingHorizontal: 2 },
  statLabel: { fontSize: 10.5, fontWeight: '600', color: AppColors.greenMuted },
  statValue: { fontSize: 16, fontWeight: '800', color: '#16290B' },
  statUnit: { fontSize: 10, fontWeight: '700', color: AppColors.greenMuted, marginLeft: 1, marginBottom: 1 },
  statDelta: { fontSize: 10.5, fontWeight: '600', color: '#3A5A1D' },

  tipCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EAF4FB',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  tipIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tipText: { flex: 1, fontSize: 12.5, color: '#27506E', lineHeight: 18 },
  tipBold: { fontWeight: '800' },

  scanCard: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 16 },
  scanIcon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: AppColors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanTitle: { fontSize: 15, fontWeight: '700', color: AppColors.ink },
  scanSub: { fontSize: 12.5, color: AppColors.sub, lineHeight: 18 },

  dayNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 10,
  },
  dayNavBtn: { padding: 4 },
  dayNavLabel: { fontSize: 12.5, fontWeight: '600', color: AppColors.sub, marginHorizontal: 6 },
});
