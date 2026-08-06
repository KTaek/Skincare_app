// 병변 면적 추적 진입 3단계 — 부위 확정 직후의 자리표시 화면.
// 여기부터 SkinAI2 면적 측정(규격 촬영 → 세그멘테이션 → 면적 지표) 기능이 들어간다.
// route.params: { region: AreaRegionId, intake?: IntakeResult }
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { AppColors } from '../theme';
import { AREA_REGION_LABELS } from '../monitoring/areaRegions';

export default function AreaPlaceholderScreen({ navigation, route }) {
  const region = route?.params?.region;
  const intake = route?.params?.intake;
  const insets = useSafeAreaInsets();
  const label = region ? AREA_REGION_LABELS[region] : '';

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <MaterialIcons name="chevron-left" size={24} color={AppColors.ink} />
        </Pressable>
        <Text style={styles.headerTitle}>병변 면적 추적</Text>
      </View>

      <View style={styles.body}>
        <View style={styles.iconWrap}>
          <MaterialIcons name="straighten" size={44} color={AppColors.greenTop} />
        </View>
        <Text style={styles.region}>{label}</Text>
        {intake?.disease ? (
          <Text style={styles.sub}>사전문진: {intake.disease}</Text>
        ) : null}
        <View style={styles.noteBox}>
          <Text style={styles.note}>여기부터 SkinAI2 면적 측정 기능이 들어갑니다.</Text>
          <Text style={styles.noteSub}>
            선택 부위: {region}
            {'\n'}(규격 촬영 → 세그멘테이션 → 병변 면적 지표)
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8 },
  backBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: AppColors.ink, marginRight: 38 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  iconWrap: {
    width: 88, height: 88, borderRadius: 44, backgroundColor: '#EEF4EA',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  region: { fontSize: 26, fontWeight: '800', color: AppColors.ink },
  sub: { marginTop: 6, fontSize: 14, fontWeight: '600', color: AppColors.sub },
  noteBox: {
    marginTop: 28, paddingVertical: 18, paddingHorizontal: 20, borderRadius: 16,
    backgroundColor: '#F4F6F8', alignItems: 'center',
  },
  note: { fontSize: 15, fontWeight: '700', color: AppColors.ink, textAlign: 'center' },
  noteSub: { marginTop: 8, fontSize: 13, color: AppColors.sub, textAlign: 'center', lineHeight: 19 },
});
