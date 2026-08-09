import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { monitoringColors as mc, monitoringCard } from '../theme';
import { useFolders } from '../store';
import { useMonitoring } from '../../context/MonitoringContext';
import { plainSiteLabel } from '../../models';

/**
 * 경과 관찰 — 지켜보고 있는 자리 목록.
 *
 * 한 줄에 "몸 아이콘 · 부위 진단명 · 최종 입력일자"만 둔다. 촬영 횟수나 개선/악화 문구를 같이
 * 얹어 봤지만, 여기서 하는 일은 "어느 자리를 볼지 고르는 것" 하나뿐이라 줄이 길수록 고르기만
 * 느려졌다. 좌우(왼쪽/오른쪽)는 떼고 보여준다 — 며칠 지나면 어느 쪽이었는지 기억하지 못한다.
 */
export default function MonitoringScreen({ navigation }) {
  const folders = useFolders();
  const { findTarget } = useMonitoring();

  const rows = folders
    .map((folder) => {
      const target = folder.targetId ? findTarget(folder.targetId) : undefined;
      const last = folder.records[folder.records.length - 1];
      return {
        folder,
        last,
        name: target
          ? [plainSiteLabel(target.label), target.diagnosis?.disease].filter(Boolean).join(' ')
          : plainSiteLabel(folder.name),
      };
    })
    .sort((a, b) => (b.last?.ts ?? 0) - (a.last?.ts ?? 0));

  return (
    <SafeAreaView style={styles.container}>
      {/* 기록 탭에서 밀려 올라온 화면이라(스택) 하단 탭 바가 가려진다 — 돌아갈 길은 이 뒤로가기뿐이다 */}
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}
        >
          <Text style={{ fontSize: 20, color: mc.ink }}>‹</Text>
          <Text style={styles.topBarTitle}>경과 관찰</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 24 }}>
        {rows.length === 0 ? (
          <View style={[monitoringCard(), styles.emptyCard]}>
            <MaterialIcons name="accessibility-new" size={30} color={mc.sub} />
            <Text style={styles.emptyTitle}>아직 지켜보는 자리가 없어요</Text>
            <Text style={styles.emptyHint}>
              "신규 증상 기록하기"를 마친 뒤 결과 화면에서 "경과 관찰에 연동"을 누르면{'\n'}그 자리가 여기에 쌓여요
            </Text>
          </View>
        ) : (
          rows.map(({ folder, last, name }) => (
            <TouchableOpacity
              key={folder.id}
              style={[monitoringCard(14), styles.siteRow]}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('MonitoringFolder', { folderId: folder.id })}
            >
              <View style={styles.siteIcon}>
                <MaterialIcons name="accessibility-new" size={20} color={mc.greenMuted} />
              </View>
              <Text style={styles.siteName} numberOfLines={1}>{name}</Text>
              <Text style={styles.siteDate}>{last ? last.date.split('-').join('.') : '기록 없음'}</Text>
              <MaterialIcons name="chevron-right" size={20} color={mc.sub} />
            </TouchableOpacity>
          ))
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
  emptyCard: { padding: 24, alignItems: 'center', gap: 8 },
  emptyTitle: { fontSize: 14, color: mc.ink, fontWeight: '800' },
  emptyHint: { fontSize: 12, color: mc.sub, textAlign: 'center', lineHeight: 18 },

  siteRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 13 },
  siteIcon: {
    width: 34, height: 34, borderRadius: 11, backgroundColor: '#F1F5EA',
    alignItems: 'center', justifyContent: 'center',
  },
  siteName: { flex: 1, fontSize: 15, fontWeight: '800', color: mc.ink },
  siteDate: { fontSize: 12, fontWeight: '600', color: mc.sub },
});
