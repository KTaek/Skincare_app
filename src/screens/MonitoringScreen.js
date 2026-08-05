import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { monitoringColors as mc, monitoringCard } from '../styles/theme';
import { useFolders, addFolder, dayCount } from '../lib/monitoringStore';
import LesionThumb from '../components/LesionThumb';
import BottomNav from '../components/BottomNav';

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
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  const submit = () => {
    if (!name.trim()) return;
    const folder = addFolder(name.trim());
    setName('');
    setAdding(false);
    navigation.navigate('MonitoringFolder', { folderId: folder.id });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.topBarTitle}>모니터링</Text>
        <Text style={{ fontSize: 22 }}>🔔</Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 24 }}>

        {/* 새 폴더 만들기 */}
        <View style={[monitoringCard(), styles.card]}>
          {adding ? (
            <View style={{ gap: 10 }}>
              <Text style={styles.cardLabel}>폴더명 지정</Text>
              <TextInput
                style={styles.input}
                placeholder="예: 오른팔 아토피 피부염 모니터링"
                placeholderTextColor={mc.sub}
                value={name}
                onChangeText={setName}
                onSubmitEditing={submit}
                autoFocus
              />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => { setAdding(false); setName(''); }}>
                  <Text style={styles.cancelBtnText}>취소</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.addBtn} onPress={submit}>
                  <Text style={styles.addBtnText}>폴더 만들기</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity style={styles.newFolderRow} onPress={() => setAdding(true)}>
              <Text style={styles.newFolderIcon}>＋</Text>
              <Text style={styles.newFolderText}>새 모니터링 폴더 만들기</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* 폴더 목록 */}
        {folders.length === 0 ? (
          <View style={[monitoringCard(), styles.emptyCard]}>
            <Text style={{ fontSize: 28, marginBottom: 6 }}>📁</Text>
            <Text style={{ fontSize: 13, color: mc.sub }}>아직 모니터링 폴더가 없습니다</Text>
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

      <BottomNav active="monitoring" navigation={navigation} />
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
  card: { padding: 16 },
  cardLabel: { fontSize: 13, color: mc.sub },
  input: {
    height: 44, borderWidth: 1, borderColor: mc.line,
    borderRadius: 10, paddingHorizontal: 14, fontSize: 14, color: mc.ink,
    backgroundColor: mc.bg,
  },
  cancelBtn: {
    flex: 1, height: 44, borderRadius: 10, borderWidth: 1, borderColor: mc.line,
    justifyContent: 'center', alignItems: 'center',
  },
  cancelBtnText: { fontSize: 14, color: mc.sub, fontWeight: '600' },
  addBtn: {
    flex: 2, height: 44, borderRadius: 10, backgroundColor: mc.greenTop,
    justifyContent: 'center', alignItems: 'center',
  },
  addBtnText: { fontSize: 14, color: mc.greenDeep, fontWeight: '800' },
  newFolderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  newFolderIcon: { fontSize: 20, color: mc.greenMuted, fontWeight: '700' },
  newFolderText: { fontSize: 14, color: mc.ink, fontWeight: '700' },
  emptyCard: { padding: 24, alignItems: 'center' },
  folderCard: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  folderName: { fontSize: 15, fontWeight: '800', color: mc.ink },
  folderMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  dayBadge: { backgroundColor: mc.greenBody, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  dayBadgeText: { fontSize: 11, color: mc.greenDeep, fontWeight: '800' },
  folderMeta: { fontSize: 12, color: mc.sub, fontWeight: '600' },
  trendText: { fontSize: 12, marginTop: 6, fontWeight: '700' },
});
