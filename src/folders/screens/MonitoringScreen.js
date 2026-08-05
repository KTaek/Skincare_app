import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { monitoringColors as mc, monitoringCard } from '../theme';
import { useFolders, dayCount } from '../store';
import LesionThumb from '../components/LesionThumb';

/** 폴더 요약 카드에는 세 지표를 다 나열하기엔 좁으니, "피부 종합 상태"(IGA) 하나로 추세를 요약한다 */
function trendSummary(folder) {
  const recs = folder.records;
  if (recs.length < 2) return null;
  const first = recs[0];
  const last = recs[recs.length - 1];
  const diff = last.iga - first.iga;
  const improved = diff <= 0;
  return {
    improved,
    text: diff === 0
      ? '· 피부 종합 상태 변화없음'
      : `${improved ? '▼' : '▲'} 피부 종합 상태 ${Math.abs(diff)}단계 ${improved ? '개선' : '악화'}`,
  };
}

export default function MonitoringScreen({ navigation }) {
  const folders = useFolders();

  return (
    <SafeAreaView style={styles.container}>
      {/* 기록 탭에서 밀려 올라온 화면이라(스택) 하단 탭 바가 가려진다 — 돌아갈 길은 이 뒤로가기뿐이다 */}
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}
        >
          <Text style={{ fontSize: 20, color: mc.ink }}>‹</Text>
          <Text style={styles.topBarTitle}>모니터링</Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 22 }}>🔔</Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 24 }}>

        {/* 폴더는 직접 만들지 않는다 — 기록 탭의 "신규 모니터링 등록하기"를 끝내면
            "{부위} {질환}" 이름으로 자동 생성된다 */}
        {folders.length === 0 ? (
          <View style={[monitoringCard(), styles.emptyCard]}>
            <Text style={{ fontSize: 28, marginBottom: 6 }}>📁</Text>
            <Text style={styles.emptyTitle}>아직 모니터링 폴더가 없습니다</Text>
            <Text style={styles.emptyHint}>
              기록 탭의 “신규 모니터링 등록하기”로 자리를 등록하면{'\n'}폴더가 자동으로 만들어집니다
            </Text>
          </View>
        ) : (
          folders.map((folder) => {
            const last = folder.records[folder.records.length - 1];
            const trend = trendSummary(folder);
            return (
              <TouchableOpacity
                key={folder.id}
                style={[monitoringCard(), styles.folderCard]}
                activeOpacity={0.85}
                onPress={() => navigation.navigate('MonitoringFolder', { folderId: folder.id })}
              >
                {last && <LesionThumb photo={last.photo} areaPct={last.lesionAreaPct} seed={last.seed} mode="photo" size={56} />}
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.folderName} numberOfLines={1}>{folder.name}</Text>
                  <View style={styles.folderMetaRow}>
                    <View style={styles.dayBadge}>
                      <Text style={styles.dayBadgeText}>D+{dayCount(folder)}</Text>
                    </View>
                    <Text style={styles.folderMeta}>촬영 {folder.records.length}회</Text>
                  </View>
                  {trend && (
                    <Text style={[styles.trendText, { color: trend.improved ? mc.sev1 : mc.sev3 }]}>
                      {trend.text}
                    </Text>
                  )}
                </View>
                <Text style={{ fontSize: 18, color: mc.sub }}>›</Text>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: mc.bg },
  topBar: {
    height: 56, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 20,
    backgroundColor: mc.card, borderBottomWidth: 1, borderBottomColor: mc.line,
  },
  topBarTitle: { fontSize: 17, fontWeight: '800', color: mc.ink },
  emptyCard: { padding: 24, alignItems: 'center' },
  emptyTitle: { fontSize: 13, color: mc.sub, fontWeight: '700' },
  emptyHint: { fontSize: 12, color: mc.sub, textAlign: 'center', lineHeight: 18, marginTop: 6 },
  folderCard: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  folderName: { fontSize: 15, fontWeight: '800', color: mc.ink },
  folderMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  dayBadge: { backgroundColor: mc.greenBody, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  dayBadgeText: { fontSize: 11, color: mc.greenDeep, fontWeight: '800' },
  folderMeta: { fontSize: 12, color: mc.sub, fontWeight: '600' },
  trendText: { fontSize: 12, marginTop: 6, fontWeight: '700' },
});
