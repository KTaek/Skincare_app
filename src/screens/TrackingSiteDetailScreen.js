// Phase 5 — 부위 상세: 면적 추이 그래프(baseline ±1σ 변동밴드) + 사진 타임랩스.
// 표현 제약: 호전/악화 판정 금지. "기록/측정/변화 범위 내"만 사용.
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, SafeAreaView, ScrollView,
  StatusBar, Image, Alert, Dimensions, Modal, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getSessionsBySite, softDeleteSession, restoreSession, siteLabel } from '../utils/tracking';
import { measureAreaOnDevice } from '../utils/ondevice';
import { AppColors, cardShadow } from '../appTheme';
import { cardDecoration } from '../theme';
import LineChart from '../components/LineChart';

function fmtDate(t) {
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function TrackingSiteDetailScreen({ route, navigation }) {
  const { body_site } = route.params;
  const [sessions, setSessions] = useState([]);
  // 사진 전체보기 모달 (병변 초록 오버레이)
  const [viewer, setViewer] = useState({ open: false, busy: false, orig: null, overlay: null, skin: null, area: null, show: 'overlay' });
  const [undoId, setUndoId] = useState(null);   // 방금 삭제한 세션(실행 취소용)

  const openViewer = async (s) => {
    setViewer({ open: true, busy: true, orig: s.overview_photo_path, overlay: null, skin: null, area: s.area_ratio, show: 'overlay' });
    try {
      const m = await measureAreaOnDevice(s.overview_photo_path);
      setViewer(v => v.open ? { ...v, busy: false, overlay: m.overlayUri, skin: m.skinOverlayUri, area: m.area_ratio } : v);
    } catch (e) {
      setViewer(v => v.open ? { ...v, busy: false } : v);
    }
  };
  const closeViewer = () => setViewer({ open: false, busy: false, orig: null, overlay: null, skin: null, area: null, show: 'overlay' });

  const load = useCallback(() => {
    getSessionsBySite(body_site).then(setSessions);
  }, [body_site]);
  useEffect(() => { load(); }, [load]);

  const confirmDelete = (id) => {
    Alert.alert('기록 삭제', '이 촬영 기록을 삭제할까요? (실행 취소로 되돌릴 수 있어요)', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: async () => { await softDeleteSession(id); setUndoId(id); load(); } },
    ]);
  };
  const undoDelete = async () => { if (undoId) { await restoreSession(undoId); setUndoId(null); load(); } };

  // 면적 시계열 (+ IGA 중증도 등급)
  const pts = sessions.filter(s => s.area_ratio != null)
    .map(s => {
      const iga = (s.severity_scores || []).find(v => v.key === 'iga_grade');
      return {
        id: s.id, t: s.timestamp, v: s.area_ratio, flags: s.quality_flags || [],
        thumb: s.overview_photo_path,
        iga: iga ? iga.level : null, iga_ko: iga ? iga.grade_ko : null,
      };
    });

  const baseSession = sessions.find(s => s.is_baseline) || sessions[0];
  const baseVal = baseSession?.area_ratio ?? null;

  let std = 0, band = null;
  if (pts.length >= 2 && baseVal != null) {
    const mean = pts.reduce((a, p) => a + p.v, 0) / pts.length;
    std = Math.sqrt(pts.reduce((a, p) => a + (p.v - mean) ** 2, 0) / pts.length);
    band = { lo: Math.max(0, baseVal - std), hi: baseVal + std };
  }

  const latest = pts[pts.length - 1];
  const withinBand = latest && band ? Math.abs(latest.v - baseVal) <= std + 0.05 : null;

  // 측정 모드(피부 대비 % vs 기준 랜드마크 대비 지표)
  const mode = (sessions[sessions.length - 1]?.measure_mode) || 'skin';
  const refName = sessions[sessions.length - 1]?.ref_name || null;
  const areaLabel = mode === 'ref'
    ? `병변 면적 (${refName || '기준'} 기준)`
    : '병변 면적 (피부 대비)';
  const areaUnit = '%';

  // 앱 공용 LineChart용 데이터 (면적 / IGA)
  const areaData = pts.map(p => ({ date: new Date(p.t), value: p.v }));
  const igaData = pts.filter(p => p.iga != null).map(p => ({ date: new Date(p.t), value: p.iga }));
  const _mv = Math.max(0, ...pts.map(p => p.v), band ? band.hi : 0);
  const areaMax = _mv <= 10 ? Math.max(1, Math.ceil(_mv * 1.2)) : Math.ceil(_mv / 10) * 10;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={AppColors.greenDeep} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={26} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{siteLabel(body_site)}</Text>
        <TouchableOpacity onPress={() => navigation.navigate('TrackingFlow', { body_site })}>
          <Ionicons name="add-circle" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {/* 면적 추이 그래프는 제거됨 — 실측 면적%는 홈·기록·모니터링 상세에 표시된다 */}

        {/* 타임랩스 */}
        <Text style={styles.sectionTitle}>사진 기록 (타임랩스)</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 4 }}>
          {sessions.map(s => {                              /* 오래된 사진이 왼쪽부터 (시간 오름차순) */
            const iga = (s.severity_scores || []).find(v => v.key === 'iga_grade');
            return (
              <TouchableOpacity key={s.id} style={styles.frame}
                onPress={() => openViewer(s)} onLongPress={() => confirmDelete(s.id)}>
                {s.overview_photo_path
                  ? <Image source={{ uri: s.overview_photo_path }} style={styles.frameImg} />
                  : <View style={[styles.frameImg, styles.thumbEmpty]}><Ionicons name="image" size={20} color={AppColors.navInactive} /></View>}
                <Text style={styles.frameDate}>{fmtDate(s.timestamp)}</Text>
                <Text style={styles.frameArea}>{s.area_ratio != null ? `${Math.round(s.area_ratio)}%` : '-'}</Text>
                {iga && <Text style={styles.frameIga}>IGA {iga.grade_ko}</Text>}
                {(s.quality_flags || []).length > 0 && (
                  <View style={styles.flagDot}><Ionicons name="alert" size={10} color="#fff" /></View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <Text style={styles.hint}>사진을 누르면 크게 보기 · 길게 누르면 삭제</Text>
      </ScrollView>

      {/* 실행 취소 배너 */}
      {undoId && (
        <View style={styles.undoBar}>
          <Text style={styles.undoTxt}>기록을 삭제했습니다</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <TouchableOpacity onPress={undoDelete}>
              <Text style={styles.undoAction}>실행 취소</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setUndoId(null)}>
              <Ionicons name="close" size={18} color="rgba(255,255,255,0.7)" />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* 사진 전체보기 (병변 초록 오버레이) */}
      <Modal visible={viewer.open} transparent animationType="fade" onRequestClose={closeViewer}>
        <View style={styles.modalBg}>
          <TouchableOpacity style={styles.closeBtn} onPress={closeViewer}>
            <Ionicons name="close" size={30} color="#fff" />
          </TouchableOpacity>

          <View style={styles.modalImgWrap}>
            {viewer.busy ? (
              <View style={styles.modalLoading}>
                <ActivityIndicator size="large" color="#fff" />
                <Text style={styles.modalLoadTxt}>병변 영역 계산 중...</Text>
              </View>
            ) : (
              <Image
                source={{ uri: viewer.show === 'overlay' ? (viewer.overlay || viewer.orig)
                              : viewer.show === 'skin' ? (viewer.skin || viewer.orig)
                              : viewer.orig }}
                style={styles.modalImg} resizeMode="contain" />
            )}
          </View>

          {viewer.area != null && (
            <Text style={styles.modalArea}>병변 면적 {Math.round(viewer.area)}%</Text>
          )}

          {/* 원본 / 병변 / 피부 토글 */}
          {!viewer.busy && viewer.overlay && (
            <View style={styles.toggleRow}>
              <TouchableOpacity onPress={() => setViewer(v => ({ ...v, show: 'orig' }))}
                style={[styles.toggleBtn, viewer.show === 'orig' && styles.toggleOn]}>
                <Text style={[styles.toggleTxt, viewer.show === 'orig' && styles.toggleTxtOn]}>원본</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setViewer(v => ({ ...v, show: 'overlay' }))}
                style={[styles.toggleBtn, viewer.show === 'overlay' && styles.toggleOn]}>
                <Text style={[styles.toggleTxt, viewer.show === 'overlay' && styles.toggleTxtOn]}>병변</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setViewer(v => ({ ...v, show: 'skin' }))}
                style={[styles.toggleBtn, viewer.show === 'skin' && styles.toggleOn]}>
                <Text style={[styles.toggleTxt, viewer.show === 'skin' && styles.toggleTxtOn]}>피부</Text>
              </TouchableOpacity>
            </View>
          )}
          <Text style={styles.modalHint}>병변=초록 · 피부=파랑 · 노랑 외곽=병변 경계</Text>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: AppColors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            backgroundColor: AppColors.greenDeep, paddingHorizontal: 16, paddingVertical: 14 },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  card: { padding: 18, marginBottom: 16 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: AppColors.ink, marginBottom: 10 },
  trendHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  trendTitle: { fontSize: 15, fontWeight: '700', color: AppColors.ink },
  trendCount: { fontSize: 12, fontWeight: '600', color: AppColors.sub },
  chartLabel: { fontSize: 12.5, fontWeight: '700', color: AppColors.sub },
  hintSmall: { fontSize: 11, color: AppColors.sub },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  sumBig: { fontSize: 30, fontWeight: '800', color: AppColors.greenMuted },
  sumCap: { fontSize: 11, color: AppColors.sub },
  bandInfo: { alignItems: 'flex-end', maxWidth: '60%' },
  withinTxt: { fontSize: 15, fontWeight: '800', color: AppColors.greenMuted },
  deltaTxt: { fontSize: 14, fontWeight: '700', color: AppColors.ink, textAlign: 'right' },
  bandCap: { fontSize: 11, color: AppColors.sub, marginTop: 4, textAlign: 'right' },
  legend: { fontSize: 10, color: AppColors.sub, marginTop: 6, lineHeight: 15 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: AppColors.ink, marginBottom: 8 },
  frame: { width: 96, alignItems: 'center' },
  frameImg: { width: 96, height: 96, borderRadius: 14, backgroundColor: '#000' },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: AppColors.bg },
  frameDate: { fontSize: 11, color: AppColors.sub, marginTop: 4 },
  frameArea: { fontSize: 13, fontWeight: '800', color: AppColors.greenMuted },
  frameIga: { fontSize: 10, color: AppColors.sev2, fontWeight: '700', marginTop: 1 },
  flagDot: { position: 'absolute', top: 6, right: 6, backgroundColor: AppColors.sev3,
             width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  hint: { fontSize: 11, color: AppColors.sub, marginTop: 8 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  closeBtn: { position: 'absolute', top: 44, right: 20, zIndex: 2, padding: 6 },
  modalImgWrap: { width: '92%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  modalImg: { width: '100%', height: '100%', borderRadius: 14 },
  modalLoading: { alignItems: 'center', gap: 12 },
  modalLoadTxt: { color: '#fff', fontSize: 13 },
  modalArea: { color: '#fff', fontSize: 16, fontWeight: '800', marginTop: 18 },
  toggleRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  toggleBtn: { paddingHorizontal: 20, paddingVertical: 9, borderRadius: 20,
               borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' },
  toggleOn: { backgroundColor: AppColors.greenTop, borderColor: AppColors.greenTop },
  toggleTxt: { color: '#fff', fontSize: 13, fontWeight: '600' },
  toggleTxtOn: { color: AppColors.greenDeep },
  modalHint: { color: 'rgba(255,255,255,0.6)', fontSize: 11, marginTop: 14 },
  undoBar: { position: 'absolute', left: 16, right: 16, bottom: 20, backgroundColor: AppColors.greenDeep,
             borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14,
             flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', ...cardShadow },
  undoTxt: { color: '#fff', fontSize: 13 },
  undoAction: { color: AppColors.greenBody, fontSize: 14, fontWeight: '800' },
});
