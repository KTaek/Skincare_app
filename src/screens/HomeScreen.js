/**
 * 홈 화면 — 참고 디자인(GitHub KTaek/Skincare_app)의 HomeScreen.tsx 레이아웃을 그대로 옮겨온 것
 * (인사말 + 초록 상태 카드 + 스캔 유도 카드 + 오늘의 루틴 + 주변 병원). 그 저장소는 카메라·루틴·
 * 병원용 서버/컨텍스트가 따로 있었지만, 이 앱엔 없으므로:
 *   - 상태 카드는 monitoringStore의 실제 최근 기록(모든 폴더 통틀어 가장 최근 촬영)을 그대로 보여준다.
 *   - 루틴은 백엔드 없이 이 화면 안에서만 체크 상태가 유지되는 간단한 로컬 목록이다.
 *   - 병원 카드는 실제 지도 연동이 없어 장식용 미리보기만 보여준다(탭 동작 없음).
 * 아이콘은 참고 디자인의 @expo/vector-icons 대신, 이 프로젝트 다른 화면들과 같은 이모지를 쓴다
 * (별도 아이콘 폰트 패키지를 새로 설치하지 않기 위해).
 */
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { monitoringColors as mc, monitoringCard, skinConditionInfo, itchBand, DISPLAY_SCALE } from '../styles/theme';
import { useFolders } from '../lib/monitoringStore';
import BottomNav from '../components/BottomNav';

const kUserName = '사용자';

const initialRoutines = [
  { id: 1, name: '세라마이드 보습제 바르기', time: '08:00', done: false },
  { id: 2, name: '병변 상태 사진 찍기', time: '12:00', done: false },
  { id: 3, name: '미지근한 물로 샤워하기', time: '20:00', done: false },
];

function daysAgo(ts) {
  const diff = Math.round((Date.now() - ts) / (1000 * 60 * 60 * 24));
  return diff <= 0 ? '오늘' : `${diff}일 전`;
}

/** 모든 폴더의 기록을 통틀어 가장 최근 촬영 하나를 찾는다 */
function latestOverall(folders) {
  let best = null;
  for (const folder of folders) {
    for (const record of folder.records) {
      if (!best || record.ts > best.record.ts) best = { folder, record };
    }
  }
  return best;
}

export default function HomeScreen({ navigation }) {
  const folders = useFolders();
  const latest = useMemo(() => latestOverall(folders), [folders]);

  const goMonitoring = () => navigation.navigate('Monitoring');
  const goLatestFolder = () => {
    if (!latest) { goMonitoring(); return; }
    navigation.navigate('MonitoringFolder', { folderId: latest.folder.id });
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingTop: 12, paddingBottom: 24 }}>
        <Text style={styles.greeting}>안녕하세요, {kUserName}님</Text>
        <View style={{ height: 3 }} />
        <Text style={styles.headline}>오늘 피부 상태를 확인해볼까요?</Text>
        <View style={{ height: 14 }} />

        <StatusCard latest={latest} onDetail={goLatestFolder} />

        <View style={{ height: 16 }} />
        <ScanCard onPress={goMonitoring} />

        <RoutineSection />

        <HospitalPreview />
      </ScrollView>

      <BottomNav active="home" navigation={navigation} />
    </SafeAreaView>
  );
}

// ---- 초록 상태 카드 ----
function StatusCard({ latest, onDetail }) {
  if (!latest) {
    return (
      <View style={[monitoringCard(22), styles.statusEmpty]}>
        <Text style={styles.statusEmptyTitle}>아직 기록이 없어요</Text>
        <View style={{ height: 4 }} />
        <Text style={styles.statusEmptySub}>모니터링에서 첫 피부 상태를 기록해보세요.</Text>
        <View style={{ height: 14 }} />
        <Pressable onPress={onDetail} style={styles.statusEmptyBtn}>
          <Text style={styles.statusEmptyBtnText}>모니터링으로 이동</Text>
        </Pressable>
      </View>
    );
  }

  const { folder, record } = latest;
  const skinValue = DISPLAY_SCALE.iga(record.iga);
  const itchValue = DISPLAY_SCALE.itch(record.itchVas);
  const skin = skinConditionInfo(skinValue);
  const itch = itchBand(itchValue);

  return (
    <View style={styles.statusShadow}>
      <View style={styles.statusClip}>
        <View style={styles.statusHeader}>
          <Text style={styles.statusHeaderText} numberOfLines={1}>{folder.name}</Text>
          <Pressable onPress={onDetail}>
            <Text style={styles.detailLink}>자세히 보기</Text>
          </Pressable>
        </View>
        <View style={styles.statusBody}>
          <Text style={styles.statusDisease}>{skin.ko}</Text>
          <View style={{ height: 6 }} />
          <View style={{ flexDirection: 'row' }}>
            <Text style={styles.sevLabel}>피부 종합 상태 </Text>
            <Text style={styles.sevValue}>{skinValue.toFixed(1)}/100</Text>
          </View>
          <View style={{ height: 18 }} />
          <View style={{ flexDirection: 'row' }}>
            <Stat label="가려움" value={`${itchValue}/100`} sub={itch.ko} />
            <Divider />
            <Stat label="최근 검사일" value={daysAgo(record.ts)} sub={`D+${record.dayOffset}`} />
            <Divider />
            <Stat label="전체 기록" value={`${folder.records.length}회`} sub=" " />
          </View>
        </View>
      </View>
    </View>
  );
}

const Divider = () => <View style={styles.divider} />;

function Stat({ label, value, sub }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <View style={{ height: 7 }} />
      <Text style={styles.statValue}>{value}</Text>
      <View style={{ height: 5 }} />
      <Text style={styles.statSub}>{sub}</Text>
    </View>
  );
}

// ---- 스캔 유도 카드 ----
function ScanCard({ onPress }) {
  return (
    <Pressable onPress={onPress} style={[monitoringCard(), styles.scanCard]}>
      <View style={styles.scanIcon}>
        <Text style={{ fontSize: 26 }}>📷</Text>
      </View>
      <View style={{ width: 14 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.scanTitle}>오늘의 피부 상태를 기록하세요</Text>
        <View style={{ height: 3 }} />
        <Text style={styles.scanSub}>모니터링 폴더에서 사진을 찍고 변화를 추적해보세요</Text>
      </View>
    </Pressable>
  );
}

// ---- 오늘의 루틴 (로컬 전용, 백엔드 없음) ----
function RoutineSection() {
  const [routines, setRoutines] = useState(initialRoutines);
  const toggle = (id) => setRoutines((rs) => rs.map((r) => (r.id === id ? { ...r, done: !r.done } : r)));

  return (
    <>
      <Text style={styles.sectionTitle}>오늘의 루틴</Text>
      <View style={[monitoringCard(), styles.routineCard]}>
        {routines.map((r, i) => (
          <View key={r.id} style={[styles.routineRow, i !== routines.length - 1 && styles.routineDivider]}>
            <Pressable
              onPress={() => toggle(r.id)}
              style={[styles.checkbox, r.done && styles.checkboxDone]}
            >
              {r.done && <Text style={styles.checkboxMark}>✓</Text>}
            </Pressable>
            <View style={{ width: 13 }} />
            <Text
              style={[styles.routineName, r.done && styles.routineNameDone]}
              numberOfLines={1}
            >
              {r.name}
            </Text>
            <Text style={styles.routineTime}>{r.time}</Text>
          </View>
        ))}
      </View>
    </>
  );
}

// ---- 주변 병원 (장식용 미리보기, 탭 동작 없음) ----
function HospitalPreview() {
  return (
    <>
      <Text style={styles.sectionTitle}>주변 병원</Text>
      <View style={[monitoringCard(), { overflow: 'hidden', marginTop: 10 }]}>
        <View style={styles.hospitalMap}>
          <Text style={{ fontSize: 24 }}>📍</Text>
        </View>
        <View style={styles.hospitalPreviewRow}>
          <View style={styles.hospitalDot} />
          <View style={{ width: 10 }} />
          <Text style={styles.hospitalName}>맑은피부과의원</Text>
          <Text style={styles.hospitalDist}>320m</Text>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: mc.bg },
  greeting: { fontSize: 14, color: mc.sub, fontWeight: '600' },
  headline: { fontSize: 18, fontWeight: '800', color: mc.ink },

  statusShadow: {
    borderRadius: 22,
    shadowColor: '#A8C746', shadowOpacity: 0.25, shadowRadius: 20, shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  statusClip: { borderRadius: 22, overflow: 'hidden' },
  statusHeader: {
    backgroundColor: mc.greenTop, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  statusHeaderText: { fontSize: 14, fontWeight: '700', color: mc.greenDeep, flexShrink: 1 },
  detailLink: { fontSize: 12.5, fontWeight: '700', color: mc.greenDeep, marginLeft: 8 },
  statusBody: { backgroundColor: mc.greenBody, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 18 },
  statusDisease: { fontSize: 24, fontWeight: '800', color: '#15290A' },
  sevLabel: { fontSize: 16, fontWeight: '600', color: '#1F3B0F' },
  sevValue: { fontSize: 16, fontWeight: '800', color: '#1F3B0F' },
  divider: { width: 1, height: 52, backgroundColor: 'rgba(40,70,20,0.18)' },
  stat: { flex: 1, alignItems: 'center' },
  statLabel: { fontSize: 12, fontWeight: '700', color: mc.greenMuted },
  statValue: { fontSize: 17, fontWeight: '800', color: '#16290B' },
  statSub: { fontSize: 12, fontWeight: '600', color: '#3A5A1D' },

  statusEmpty: { padding: 22, alignItems: 'center' },
  statusEmptyTitle: { fontSize: 16, fontWeight: '800', color: mc.ink },
  statusEmptySub: { fontSize: 12.5, color: mc.sub, textAlign: 'center' },
  statusEmptyBtn: { backgroundColor: mc.greenTop, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  statusEmptyBtnText: { fontSize: 13, fontWeight: '800', color: mc.greenDeep },

  scanCard: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 16 },
  scanIcon: {
    width: 52, height: 52, borderRadius: 14, backgroundColor: mc.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  scanTitle: { fontSize: 15, fontWeight: '700', color: mc.ink },
  scanSub: { fontSize: 12.5, color: mc.sub, lineHeight: 18 },

  sectionTitle: { fontSize: 17, fontWeight: '800', color: mc.ink, marginTop: 24, marginBottom: 10 },

  routineCard: { paddingHorizontal: 18 },
  routineRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 15 },
  routineDivider: { borderBottomWidth: 1, borderBottomColor: mc.line },
  checkbox: {
    width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: mc.line,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxDone: { backgroundColor: mc.greenTop, borderColor: mc.greenTop },
  checkboxMark: { fontSize: 13, fontWeight: '800', color: '#FFFFFF' },
  routineName: { flex: 1, fontSize: 15, fontWeight: '600', color: mc.ink },
  routineNameDone: { color: mc.sub, textDecorationLine: 'line-through' },
  routineTime: { fontSize: 14, fontWeight: '700', color: mc.ink },

  hospitalMap: { height: 110, backgroundColor: mc.bg, alignItems: 'center', justifyContent: 'center' },
  hospitalPreviewRow: {
    flexDirection: 'row', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: mc.line, paddingHorizontal: 18, paddingVertical: 13,
  },
  hospitalDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: mc.greenTop },
  hospitalName: { flex: 1, fontSize: 14.5, fontWeight: '700', color: mc.ink },
  hospitalDist: { fontSize: 13, color: mc.sub, fontWeight: '600' },
});
