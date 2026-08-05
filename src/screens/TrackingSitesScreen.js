// Phase 5 — 면적 추적 부위 목록 (허브). 부위별 카드 + 새 촬영 진입.
import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, SafeAreaView, FlatList, Image, StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getTrackedSites, getSessionsBySite, siteLabel } from '../utils/tracking';
import { AppColors, cardShadow } from '../appTheme';

export default function TrackingSitesScreen({ navigation }) {
  const [sites, setSites] = useState([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const list = await getTrackedSites();
      const enriched = await Promise.all(list.map(async (s) => {
        const sess = await getSessionsBySite(s.body_site);
        const last = sess[sess.length - 1];
        return { ...s, n: sess.length, last_area: last?.area_ratio, thumb: last?.overview_photo_path };
      }));
      if (alive) setSites(enriched);
    })();
    return () => { alive = false; };
  }, []);

  const renderItem = ({ item }) => (
    <TouchableOpacity style={styles.card}
      onPress={() => navigation.navigate('TrackingSiteDetail', { body_site: item.body_site })}>
      {item.thumb
        ? <Image source={{ uri: item.thumb }} style={styles.thumb} />
        : <View style={[styles.thumb, styles.thumbEmpty]}><Ionicons name="image" size={22} color={AppColors.navInactive} /></View>}
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle}>{siteLabel(item.body_site)}</Text>
        <Text style={styles.cardSub}>{item.n}회 기록 · 최근 {new Date(item.last).toLocaleDateString('ko-KR')}</Text>
      </View>
      <View style={styles.areaTag}>
        <Text style={styles.areaVal}>{item.last_area != null ? `${item.last_area}%` : '-'}</Text>
        <Text style={styles.areaCap}>최근 면적</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={AppColors.navInactive} />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={AppColors.greenDeep} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={26} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>면적 추적</Text>
        <TouchableOpacity onPress={() => navigation.navigate('TrackingFlow')}>
          <Ionicons name="add-circle" size={26} color="#fff" />
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.newBtn} onPress={() => navigation.navigate('TrackingFlow')}>
        <Ionicons name="camera" size={18} color={AppColors.greenDeep} />
        <Text style={styles.newTxt}>새 추적 촬영</Text>
      </TouchableOpacity>

      {sites.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="resize-outline" size={48} color={AppColors.navInactive} />
          <Text style={styles.emptyTitle}>추적 기록이 없습니다</Text>
          <Text style={styles.emptySub}>부위를 정해 첫 촬영을 하면 여기에 쌓입니다</Text>
        </View>
      ) : (
        <FlatList
          data={sites}
          keyExtractor={(s) => s.key}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, gap: 10 }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            backgroundColor: AppColors.greenDeep, paddingHorizontal: 16, paddingVertical: 14 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  newBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
            backgroundColor: AppColors.greenTop, margin: 16, marginBottom: 4, paddingVertical: 14,
            borderRadius: 20, ...cardShadow },
  newTxt: { color: AppColors.greenDeep, fontSize: 15, fontWeight: '800' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: AppColors.card,
          borderRadius: 20, padding: 14, ...cardShadow },
  thumb: { width: 54, height: 54, borderRadius: 14, backgroundColor: '#000' },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: AppColors.bg },
  cardTitle: { fontSize: 15, fontWeight: '700', color: AppColors.ink },
  cardSub: { fontSize: 12, color: AppColors.sub, marginTop: 3 },
  areaTag: { alignItems: 'flex-end', marginRight: 4 },
  areaVal: { fontSize: 18, fontWeight: '800', color: AppColors.greenMuted },
  areaCap: { fontSize: 10, color: AppColors.sub },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: AppColors.ink },
  emptySub: { fontSize: 13, color: AppColors.sub },
});
