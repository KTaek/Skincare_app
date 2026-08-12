import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  monitoringColors as mc, monitoringCard, DISPLAY_SCALE,
  SKIN_SEGMENTS, ITCH_SEGMENTS, SLEEP_SEGMENTS, SYMPTOM_SEGMENTS_BASE, SYMPTOMS,
} from '../theme';
import { useFolder, folderHasSeverity } from '../store';
import LesionThumb from '../components/LesionThumb';
import PhotoZoomModal from '../components/PhotoZoomModal';
import { MetricCard, MetricRow, EmptyMetricCard } from '../../components/MetricCard';
import { useProfile } from '../../context/ProfileContext';
import { plainSiteLabel } from '../../models';

const PAGE_PAD = 16;
const PHOTO_GAP = 10;
const PHOTO_SIZE = 96; // 휴대폰 화면 기준 작은 크기 — 두 장이 카드 하나 안에 나란히 들어간다

const SYMPTOM_ORDER = ['redness', 'bumps', 'scratch', 'thickening'];

function shortDate(dateKey) {
  const [y, m, d] = dateKey.split('-');
  return `${y}.${parseInt(m)}.${parseInt(d)}`;
}

/**
 * 경과 관찰 상세 결과 — 하루치 기록 하나를 자세히 본다.
 *
 * 지표 카드(피부 종합 상태 · 증상 4종 · 가려움 · 수면 점수)는 피부 촬영 분석 결과 화면과 **같은**
 * 컴포넌트(MetricCard)를 쓴다. 같은 값을 두 화면에서 다른 모양으로 보여주면 어느 쪽이 맞는지
 * 헷갈리기 때문이다.
 */
export default function MonitoringDetailScreen({ navigation, route }) {
  const { folderId, recordId } = route.params || {};
  const folder = useFolder(folderId);
  const [zoomRecord, setZoomRecord] = useState(null);
  const [zoomPage, setZoomPage] = useState(0);
  // 수면 점수는 스마트워치(Samsung Health) 연동으로 들어오는 값이라, 미연동이면 "미기재"로 둔다
  const { healthConnected } = useProfile();
  if (!folder) {
    return <SafeAreaView style={styles.container}><Text style={{ padding: 20, color: mc.sub }}>폴더를 찾을 수 없습니다.</Text></SafeAreaView>;
  }

  const record = folder.records.find((r) => r.id === recordId) || folder.records[folder.records.length - 1];
  /*
    이 회차의 병변 오버레이. 실제 촬영은 분석이 합성한 것을 저장하고(recordExam의 maskUri),
    데모 기록은 미리 구운 에셋을 쓴다(tools/bake_dump_overlays.py) — 둘 다 진짜 세그 결과다.
    없으면 null이고, 그때 화면은 원본 사진을 그대로 보여준다.
  */
  const overlay = record.overlay;

  // 4가지 증상·IGA 모델은 아토피피부염 채점 기준이라, 이 폴더의 진단명이 그게 아니면 두 카드 다 숨긴다
  const hasSeverity = folderHasSeverity(folder);
  const skinValue = DISPLAY_SCALE.iga(record.iga); // 그래프·요약 박스와 같은 0~100 표시값
  const itchValue = DISPLAY_SCALE.itch(record.itchVas);

  const openZoom = (page) => { setZoomPage(page); setZoomRecord(record); };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontSize: 20, color: mc.ink }}>‹</Text>
          <View>
            <Text style={styles.topBarTitle}>{shortDate(record.date)} 상세 결과</Text>
            <Text style={styles.topBarSub} numberOfLines={1}>{plainSiteLabel(folder.name)}</Text>
          </View>
        </TouchableOpacity>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: PAGE_PAD, gap: 12, paddingBottom: 24 }}>

        {/* 촬영 사진 — 원본과 증상 부위 표시를 작은 박스 하나 안에 나란히 보여준다. 탭하면
            그 이미지가 바로 보이는 페이지로 크게 열린다. */}
        <View style={[monitoringCard(), styles.photoCard]}>
          <View style={styles.photoRow}>
            <TouchableOpacity style={styles.photoCol} activeOpacity={0.85} onPress={() => openZoom(0)}>
              <LesionThumb photo={record.photo} mode="photo" size={PHOTO_SIZE} />
              <Text style={styles.photoCaption}>촬영 이미지 (원본)</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.photoCol} activeOpacity={0.85} onPress={() => openZoom(1)}>
              <LesionThumb photo={record.photo} overlay={overlay} mode="overlay" size={PHOTO_SIZE} />
              <Text style={styles.photoCaption}>증상 부위 표시</Text>
            </TouchableOpacity>
          </View>
        </View>

        {hasSeverity && (
          <>
            {/* 1) 피부 종합 상태 — 이 상세 결과 페이지에서만 몇 점 만점인지("/100")를 값 옆에 적는다 */}
            <MetricCard label="피부 종합 상태" value={skinValue} unit="/100" segments={SKIN_SEGMENTS} />

            {/* 2) 4가지 증상 */}
            <View style={[monitoringCard(), styles.card]}>
              <Text style={styles.cardLabel}>4가지 증상</Text>
              {SYMPTOM_ORDER.map((key, i) => (
                <MetricRow
                  key={key}
                  label={SYMPTOMS[key].label}
                  value={DISPLAY_SCALE.symptom(record[key])}
                  segments={SYMPTOM_SEGMENTS_BASE}
                  first={i === 0}
                  hideValue
                />
              ))}
            </View>
          </>
        )}

        {/* 3) 가려움 문진 (VAS 0~10 × 10 = 0~100 표시값) */}
        <MetricCard label="가려움 안정도" value={itchValue} unit="/100" segments={ITCH_SEGMENTS} />

        {/* 4) 수면 점수 (삼성헬스) — 스마트워치를 연동하지 않았으면 점수 대신 "미기재" */}
        {healthConnected ? (
          <MetricCard label="수면 점수" value={record.sleepScore} unit="/100" segments={SLEEP_SEGMENTS} />
        ) : (
          <EmptyMetricCard label="수면 점수" text="미기재" />
        )}

      </ScrollView>

      <PhotoZoomModal visible={!!zoomRecord} record={zoomRecord} initialPage={zoomPage} onClose={() => setZoomRecord(null)} />
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
  topBarTitle: { fontSize: 15, fontWeight: '700', color: mc.ink },
  topBarSub: { fontSize: 11, color: mc.sub, maxWidth: 160 },

  photoCard: { padding: 12 },
  photoRow: { flexDirection: 'row', justifyContent: 'center', gap: PHOTO_GAP },
  photoCol: { alignItems: 'center' },
  photoCaption: { fontSize: 10.5, color: mc.sub, marginTop: 6, textAlign: 'center' },

  card: { padding: 16 },
  cardLabel: { fontSize: 16, fontWeight: '800', color: mc.ink, marginBottom: 12 },
});
