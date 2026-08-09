import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  monitoringColors as mc, monitoringCard, DISPLAY_SCALE,
  SKIN_SEGMENTS, ITCH_SEGMENTS, SLEEP_SEGMENTS, SYMPTOM_SEGMENTS_BASE, SYMPTOMS, CHART_SERIES,
} from '../theme';
import { useFolder, dayCount } from '../store';
import LesionThumb from '../components/LesionThumb';
import PhotoZoomModal from '../components/PhotoZoomModal';
import { MetricCard, MetricRow, EmptyMetricCard } from '../../components/MetricCard';
import UsedProductsCard from '../../components/UsedProductsCard';
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

/** 기록의 날짜 키("2026-08-05")를 Date로 — "사용한 제품"이 그날의 제품 목록을 찾는 데 쓴다 */
function toDate(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** 값이 오른 건 빨강, 내린 건 파랑으로만 표시한다 — 지표별로 오르는 게 좋은지 나쁜지는 따지지 않는다 */
function CompareRow({ label, first, latest, unit, color }) {
  const diff = Math.round((latest - first) * 10) / 10;
  const deltaColor = diff > 0 ? mc.sev3 : diff < 0 ? '#5B8DEF' : mc.sub;
  return (
    <View style={styles.compareRow}>
      <View style={[styles.compareDot, { backgroundColor: color }]} />
      <Text style={styles.compareLabel}>{label}</Text>
      <Text style={styles.compareValues}>
        {first}{unit} → {latest}{unit}
      </Text>
      <Text style={[styles.compareDelta, { color: deltaColor }]}>
        {diff === 0 ? '변화없음' : `${diff < 0 ? '▼' : '▲'} ${Math.abs(diff)}${unit}`}
      </Text>
    </View>
  );
}

/**
 * "경과 비교"의 기준(비교 시작) 날짜를 고르는 시트 — 날짜를 전부 한 줄에 펼쳐두면(칩 나열) 자리만
 * 차지하고 개수가 많으면 화면 밖으로 잘려 다 안 보이므로, 지금 고른 날짜 하나만 보여주는 버튼을
 * 탭했을 때 목록이 뜨는 방식으로 바꿨다.
 *
 * RN의 <Modal>은 안 쓴다 — PhotoZoomModal과 같은 이유로, 웹 미리보기의 폰 프레임(App.js의
 * WebPhoneFrame) 밖에 그려져 버리는 문제가 있다. 화면 트리 안의 절대위치 View로 덮어서 항상
 * 실제 보이는 영역 안에만 그려지게 한다.
 */
function BaselineDatePickerSheet({ visible, records, selectedId, onSelect, onClose }) {
  if (!visible) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={styles.sheetBackdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheetCard}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>기준 날짜 선택</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.sheetClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.sheetList} contentContainerStyle={{ paddingBottom: 8 }}>
            {records.map((r) => {
              const selected = r.id === selectedId;
              return (
                <TouchableOpacity key={r.id} style={styles.sheetRow} onPress={() => onSelect(r.id)}>
                  <Text style={[styles.sheetRowText, selected && styles.sheetRowTextActive]}>
                    {shortDate(r.date)} <Text style={styles.sheetRowSub}>(D+{r.dayOffset})</Text>
                  </Text>
                  {selected && <Text style={styles.sheetRowCheck}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </View>
  );
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
  // "경과 비교"의 비교 시작점(기준 날짜) — 폴더가 아직 없을 수도 있어 null로 시작하고,
  // 아래에서 폴더를 확인한 뒤 기본값(가장 이른 기록)으로 채운다. 아래 조건부 return보다
  // 위에서 선언해야 훅 호출 순서가 렌더마다 항상 같다.
  const [baselineId, setBaselineId] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // 수면 점수는 스마트워치(Samsung Health) 연동으로 들어오는 값이라, 미연동이면 "미기재"로 둔다
  const { healthConnected } = useProfile();

  if (!folder) {
    return <SafeAreaView style={styles.container}><Text style={{ padding: 20, color: mc.sub }}>폴더를 찾을 수 없습니다.</Text></SafeAreaView>;
  }

  const record = folder.records.find((r) => r.id === recordId) || folder.records[folder.records.length - 1];

  // "경과 비교"는 지금 보고 있는 이 기록(record)을 고정된 도착점으로 두고, 비교 시작점(기준
  // 날짜)은 이 기록보다 과거인 기록 중에서만 사용자가 직접 고를 수 있다 — "경과"는 과거 -> 현재
  // 방향으로만 의미가 있으므로 이 기록 이후(미래) 날짜는 후보에서 제외한다. 기본값(아직 아무것도
  // 고르지 않았을 때)은 그중 가장 이른 기록(예전의 "최초 기록")이다.
  const compareCandidates = folder.records.filter((r) => r.dayOffset < record.dayOffset);
  const baseline = compareCandidates.find((r) => r.id === baselineId) || compareCandidates[0] || null;
  const hasCompare = !!baseline;

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
        <View style={styles.dayBadge}>
          <Text style={styles.dayBadgeText}>D+{record.dayOffset} · 전체 D+{dayCount(folder)}</Text>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: PAGE_PAD, gap: 12, paddingBottom: 24 }}>

        {/* 촬영 사진 — 원본과 증상 부위 표시를 작은 박스 하나 안에 나란히 보여준다. 탭하면
            그 이미지가 바로 보이는 페이지로 크게 열린다. */}
        <View style={[monitoringCard(), styles.photoCard]}>
          <View style={styles.photoRow}>
            <TouchableOpacity style={styles.photoCol} activeOpacity={0.85} onPress={() => openZoom(0)}>
              <LesionThumb photo={record.photo} areaPct={record.lesionAreaPct} seed={record.seed} mode="photo" size={PHOTO_SIZE} />
              <Text style={styles.photoCaption}>촬영 이미지 (원본)</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.photoCol} activeOpacity={0.85} onPress={() => openZoom(1)}>
              <LesionThumb photo={record.photo} areaPct={record.lesionAreaPct} seed={record.seed} mode="overlay" size={PHOTO_SIZE} />
              <Text style={styles.photoCaption}>증상 부위 표시</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 1) 피부 종합 상태 */}
        <MetricCard label="피부 종합 상태" value={skinValue} segments={SKIN_SEGMENTS} />

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
            />
          ))}
        </View>

        {/* 3) 가려움 문진 (VAS 0~10 × 10 = 0~100 표시값) */}
        <MetricCard label="가려움" value={itchValue} segments={ITCH_SEGMENTS} />

        {/* 4) 수면 점수 (삼성헬스) — 스마트워치를 연동하지 않았으면 점수 대신 "미기재" */}
        {healthConnected ? (
          <MetricCard label="수면 점수" value={record.sleepScore} segments={SLEEP_SEGMENTS} />
        ) : (
          <EmptyMetricCard label="수면 점수" text="미기재" />
        )}

        {/* 5) 사용한 제품 — 루틴 탭의 <사용 제품>과 연동 */}
        <UsedProductsCard date={toDate(record.date)} />

        {/* 경과 비교 — 도착점은 지금 보고 있는 이 기록으로 고정, 시작점(기준 날짜)은 아래 버튼을
            눌러 뜨는 목록에서 골라 바꿀 수 있다. */}
        <View style={[monitoringCard(), styles.card, { marginTop: 4 }]}>
          <Text style={styles.cardLabel}>경과 비교</Text>
          {hasCompare ? (
            <>
              <Text style={styles.compareSubLabel}>기준 날짜</Text>
              <TouchableOpacity style={styles.baselineSelectRow} onPress={() => setPickerOpen(true)}>
                <Text style={styles.baselineSelectText}>
                  {shortDate(baseline.date)} (D+{baseline.dayOffset})
                </Text>
                <Text style={styles.baselineSelectChevron}>▾</Text>
              </TouchableOpacity>

              <Text style={styles.compareDates}>
                {shortDate(baseline.date)} (D+{baseline.dayOffset})  →  {shortDate(record.date)} (D+{record.dayOffset})
              </Text>
              <CompareRow label="피부 종합" first={DISPLAY_SCALE.iga(baseline.iga)} latest={DISPLAY_SCALE.iga(record.iga)} unit="/100" color={CHART_SERIES.skin.color} />
              <CompareRow label="가려움" first={DISPLAY_SCALE.itch(baseline.itchVas)} latest={DISPLAY_SCALE.itch(record.itchVas)} unit="/100" color={CHART_SERIES.itch.color} />
              {healthConnected && (
                <CompareRow label="수면" first={baseline.sleepScore} latest={record.sleepScore} unit="점" color={CHART_SERIES.sleep.color} />
              )}
            </>
          ) : (
            <Text style={styles.metricFoot}>비교할 다른 기록이 아직 없습니다.</Text>
          )}
        </View>
      </ScrollView>

      <PhotoZoomModal visible={!!zoomRecord} record={zoomRecord} initialPage={zoomPage} onClose={() => setZoomRecord(null)} />
      <BaselineDatePickerSheet
        visible={pickerOpen}
        records={compareCandidates}
        selectedId={baseline?.id}
        onSelect={(id) => { setBaselineId(id); setPickerOpen(false); }}
        onClose={() => setPickerOpen(false)}
      />
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
  dayBadge: { backgroundColor: mc.greenBody, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  dayBadgeText: { fontSize: 10, color: mc.greenDeep, fontWeight: '800' },

  photoCard: { padding: 12 },
  photoRow: { flexDirection: 'row', justifyContent: 'center', gap: PHOTO_GAP },
  photoCol: { alignItems: 'center' },
  photoCaption: { fontSize: 10.5, color: mc.sub, marginTop: 6, textAlign: 'center' },

  card: { padding: 16 },
  cardLabel: { fontSize: 16, fontWeight: '800', color: mc.ink, marginBottom: 12 },
  metricFoot: { fontSize: 11, color: mc.sub, marginTop: 10, lineHeight: 16 },

  compareSubLabel: { fontSize: 12, color: mc.sub, fontWeight: '700', marginBottom: 8 },
  baselineSelectRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12,
    backgroundColor: mc.bg, borderWidth: 1, borderColor: mc.line,
  },
  baselineSelectText: { fontSize: 13, fontWeight: '700', color: mc.ink },
  baselineSelectChevron: { fontSize: 13, color: mc.sub },
  compareDates: { fontSize: 11, color: mc.sub, marginBottom: 10 },
  compareRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 8, borderTopWidth: 1, borderTopColor: mc.line },
  compareDot: { width: 8, height: 8, borderRadius: 4 },
  compareLabel: { fontSize: 12, color: mc.ink, width: 62, fontWeight: '600' },
  compareValues: { fontSize: 12, color: mc.ink, flex: 1 },
  compareDelta: { fontSize: 12, fontWeight: '800' },

  // 기준 날짜 선택 시트 — 아래에서 올라오는 카드 하나에 후보 날짜를 세로로 나열해 보여준다.
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheetCard: {
    backgroundColor: mc.card, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '70%', paddingBottom: 20,
  },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 18, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: mc.line,
  },
  sheetTitle: { fontSize: 15, fontWeight: '800', color: mc.ink },
  sheetClose: { fontSize: 16, color: mc.sub },
  sheetList: { paddingHorizontal: 20 },
  sheetRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: mc.line,
  },
  sheetRowText: { fontSize: 14, fontWeight: '600', color: mc.ink },
  sheetRowTextActive: { color: mc.greenDeep, fontWeight: '800' },
  sheetRowSub: { fontSize: 12, fontWeight: '600', color: mc.sub },
  sheetRowCheck: { fontSize: 15, fontWeight: '800', color: mc.greenTop },
});
