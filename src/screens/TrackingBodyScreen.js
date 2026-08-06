// 면적추적 진입 — 인체도 탭(관절 기준 세부 부위) → 이름 표시 → 촬영/추이 선택.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BodyGranularView from '../components/BodyGranularView';
import { AppColors } from '../appTheme';
import { getTrackedSites } from '../utils/tracking';

// 여러 부위에 퍼진 경우 한 번에 잡는 넓은 범위 선택
const WHOLE = [
  { part: '몸통 전체', ref: '배꼽', ref_mode: 'circle' },
  { part: '등 전체', ref: null, ref_mode: null },
];

export default function TrackingBodyScreen({ navigation }) {
  const [sel, setSel] = useState(null);       // { part, ref }
  const [counts, setCounts] = useState({});

  useEffect(() => {
    getTrackedSites().then((sites) => {
      const m = {};
      sites.forEach((s) => { const p = s.body_site?.part; if (p) m[p] = (m[p] || 0) + s.count; });
      setCounts(m);
    });
  }, []);

  const bodySite = sel ? { part: sel.part, side: null, ref: sel.ref, ref_mode: sel.ref_mode || 'circle' } : null;
  const goDetail = () => { if (bodySite) navigation.navigate('TrackingSiteDetail', { body_site: bodySite }); };
  const goCapture = () => { if (bodySite) navigation.navigate('TrackingFlow', { body_site: bodySite }); };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={AppColors.greenDeep} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={26} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>병변 면적 추적</Text>
        <View style={{ width: 26 }} />
      </View>

      <Text style={styles.caption}>추적할 부위를 인체 그림에서 탭하세요</Text>
      <Text style={styles.sub}>팔 = 상완·전완·손 · 다리 = 허벅지·종아리·발 · 몸통 = 가슴·배</Text>

      {/* 넓은 범위 선택 (병변이 여러 곳에 퍼졌을 때 한 번에) */}
      <View style={styles.wholeRow}>
        {WHOLE.map((w) => {
          const on = sel?.part === w.part;
          return (
            <TouchableOpacity key={w.part} onPress={() => setSel(w)}
              style={[styles.wholeBtn, on && styles.wholeBtnOn]}>
              <Ionicons name="scan-outline" size={15} color={on ? '#fff' : AppColors.greenDeep} />
              <Text style={[styles.wholeTxt, on && styles.wholeTxtOn]}>{w.part}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.bodyArea}>
        <BodyGranularView onMarked={setSel} />
      </View>

      <View style={styles.footer}>
        {!sel ? (
          <Text style={styles.hint}>부위를 탭하면 촬영하거나 추이를 볼 수 있어요</Text>
        ) : (
          <>
            <Text style={styles.picked}>
              {sel.part}
              <Text style={styles.pickedSub}>{counts[sel.part] ? `  ·  기록 ${counts[sel.part]}건` : '  ·  첫 기록'}</Text>
            </Text>
            {sel.ref && (
              <Text style={styles.refHint}>
                기준: 촬영 시 <Text style={styles.refBold}>{sel.ref}</Text>가 프레임에 들어오게 (외부물체 불필요)
              </Text>
            )}
            <TouchableOpacity style={styles.btn} onPress={goCapture}>
              <Ionicons name="camera" size={18} color={AppColors.greenDeep} />
              <Text style={styles.btnTxt}>이 부위 촬영하기</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnOutline} onPress={goDetail}>
              <Ionicons name="trending-up" size={17} color={AppColors.greenMuted} />
              <Text style={styles.btnOutlineTxt}>추이 그래프 보기</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            backgroundColor: AppColors.greenDeep, paddingHorizontal: 16, paddingVertical: 14 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  caption: { fontSize: 15, fontWeight: '700', color: AppColors.ink, textAlign: 'center', marginTop: 14 },
  sub: { fontSize: 12, color: AppColors.sub, textAlign: 'center', marginTop: 5, paddingHorizontal: 20, lineHeight: 17 },
  wholeRow: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 12 },
  wholeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9,
              borderRadius: 20, borderWidth: 1, borderColor: AppColors.greenTop, backgroundColor: AppColors.card },
  wholeBtnOn: { backgroundColor: AppColors.greenTop, borderColor: AppColors.greenTop },
  wholeTxt: { color: AppColors.greenDeep, fontSize: 13, fontWeight: '700' },
  wholeTxtOn: { color: '#fff' },
  bodyArea: { flex: 1, marginVertical: 6 },
  footer: { paddingHorizontal: 24, paddingBottom: 26, paddingTop: 4, minHeight: 150, justifyContent: 'flex-end' },
  hint: { fontSize: 13, color: AppColors.sub, textAlign: 'center', paddingVertical: 12 },
  picked: { fontSize: 19, fontWeight: '800', color: AppColors.greenDeep, textAlign: 'center', marginBottom: 8 },
  pickedSub: { fontSize: 13, fontWeight: '600', color: AppColors.sub },
  refHint: { fontSize: 12, color: AppColors.sub, textAlign: 'center', marginBottom: 12, lineHeight: 17 },
  refBold: { fontWeight: '800', color: AppColors.greenMuted },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
         backgroundColor: AppColors.greenTop, borderRadius: 20, paddingVertical: 15 },
  btnTxt: { color: AppColors.greenDeep, fontSize: 15, fontWeight: '800' },
  btnOutline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, marginTop: 6 },
  btnOutlineTxt: { color: AppColors.greenMuted, fontSize: 14, fontWeight: '700' },
});
