import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { AppColors, cardDecoration } from '../theme';
import {
  SkinStatus,
  sevOf,
  kUserName,
  currentStatusFromRecords,
  worstItchTimeSlot,
  timeSlotOf,
  Routine,
} from '../models';
import { SectionHeader, RoutineRowContent } from '../components/widgets';
import { useRoutines } from '../context/RoutineContext';
import { useRecords } from '../context/RecordsContext';
import ItchDetailScreen from './ItchDetailScreen';

export default function HomeScreen({ navigation }: { navigation: any }) {
  const { sorted, upcoming, toggle } = useRoutines();
  const { records } = useRecords();
  const currentStatus = useMemo(() => currentStatusFromRecords(records, sorted), [records, sorted]);
  const [showDetail, setShowDetail] = useState(false);

  // 평소 가려움이 가장 심했던 시간대에 지금이 해당하면 미리 진정 케어를 안내
  const worstSlot = useMemo(() => worstItchTimeSlot(records), [records]);
  const showItchTip = worstSlot != null && timeSlotOf(new Date()) === worstSlot.slot;

  const goCamera = () => navigation.navigate('Camera');
  const goRoutine = () => navigation.navigate('Routine');
  const goHospital = () => navigation.navigate('Hospital');

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

      <StatusCard userName={kUserName} status={currentStatus} onDetail={() => setShowDetail(true)} />

      {showItchTip && (
        <>
          <View style={{ height: 12 }} />
          <ItchTipCard />
        </>
      )}

      <View style={{ height: 16 }} />

      <ScanCard onScan={goCamera} />

      <SectionHeader title="루틴" onMore={goRoutine} />
      <View style={[cardDecoration(), { paddingHorizontal: 18 }]}>
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={[
              { paddingVertical: 15 },
              i !== 2 && { borderBottomWidth: 1, borderBottomColor: AppColors.line },
            ]}
          >
            {i < upcoming.length ? (
              <FadingRoutineRow routine={upcoming[i]} onToggle={() => toggle(upcoming[i].id)} />
            ) : (
              <View style={{ height: 26 }} />
            )}
          </View>
        ))}
      </View>

      <SectionHeader title="주변 병원 찾기" onMore={goHospital} />
      <HospitalPreview onPress={goHospital} />
    </ScrollView>
  );
}

/** 완료 시 1초에 걸쳐 서서히 사라지는 홈 루틴 행 */
function FadingRoutineRow({ routine, onToggle }: { routine: Routine; onToggle: () => void }) {
  const opacity = useRef(new Animated.Value(routine.done ? 0 : 1)).current;
  useEffect(() => {
    Animated.timing(opacity, {
      toValue: routine.done ? 0 : 1,
      duration: 1000,
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
  onDetail,
}: {
  userName: string;
  status: SkinStatus;
  onDetail: () => void;
}) {
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
          <View style={{ height: 6 }} />
          <View style={{ flexDirection: 'row' }}>
            <Text style={styles.sevLabel}>병변 중증도 </Text>
            <Text style={styles.sevValue}>{sevOf(status.sev).stage}</Text>
          </View>
          <View style={{ height: 18 }} />
          <View style={{ flexDirection: 'row' }}>
            <Stat label="가려움 정도" value={status.itch} delta={status.itchDelta} />
            <Divider />
            <Stat label="최근 검사일" value={status.lastExam} delta=" " />
            <Divider />
            <Stat label="루틴 이행률" value={status.rate} delta={status.rateDelta} />
          </View>
        </View>
      </View>
    </View>
  );
}

const Divider = () => <View style={styles.divider} />;

function Stat({ label, value, delta }: { label: string; value: string; delta: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <View style={{ height: 7 }} />
      <Text style={styles.statValue}>{value}</Text>
      <View style={{ height: 5 }} />
      <Text style={styles.statDelta}>{delta}</Text>
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

// ---- 병원 미리보기 ----
function HospitalPreview({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[cardDecoration(), { overflow: 'hidden' }]}>
      <LinearGradient
        colors={['#DFE6EC', '#EEF2F6']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ height: 120 }}
      >
        <MaterialIcons name="location-on" size={24} color={AppColors.sev3} style={{ position: 'absolute', left: 110, top: 30 }} />
        <MaterialIcons name="location-on" size={24} color={AppColors.sev3} style={{ position: 'absolute', left: 250, top: 24 }} />
        <MaterialIcons name="circle" size={16} color="#2F80ED" style={{ position: 'absolute', left: 175, top: 64 }} />
      </LinearGradient>
      <View style={styles.hospitalPreviewRow}>
        <View style={styles.hospitalDot} />
        <View style={{ width: 10 }} />
        <Text style={styles.hospitalName}>맑은피부과의원</Text>
        <Text style={styles.hospitalDist}>320m</Text>
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
  sevLabel: { fontSize: 16, fontWeight: '600', color: '#1F3B0F' },
  sevValue: { fontSize: 16, fontWeight: '800', color: '#1F3B0F' },
  divider: { width: 1, height: 52, backgroundColor: 'rgba(40,70,20,0.18)' },
  stat: { flex: 1, alignItems: 'center' },
  statLabel: { fontSize: 12, fontWeight: '600', color: AppColors.greenMuted },
  statValue: { fontSize: 19, fontWeight: '800', color: '#16290B' },
  statDelta: { fontSize: 12, fontWeight: '600', color: '#3A5A1D' },

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

  hospitalPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: AppColors.line,
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  hospitalDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: AppColors.greenTop },
  hospitalName: { flex: 1, fontSize: 14.5, fontWeight: '700', color: AppColors.ink },
  hospitalDist: { fontSize: 13, color: AppColors.sub },
});
