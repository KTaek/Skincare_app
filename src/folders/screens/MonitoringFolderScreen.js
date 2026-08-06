import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { monitoringColors as mc, monitoringCard, sleepBand, itchBand, skinConditionInfo, DISPLAY_SCALE } from '../theme';
import { useFolder, dayCount, addRecord } from '../store';
import { useMonitoring } from '../../context/MonitoringContext';
import MonitorCaptureScreen from '../../screens/MonitorCaptureScreen';
import TrendChart, {
  TrendChartLegend, TrendChartYAxis, chartContentWidth, POINT_W, Y_AXIS_W,
} from '../components/TrendChart';
import LesionThumb from '../components/LesionThumb';
import PhotoZoomModal from '../components/PhotoZoomModal';

// 이 화면은 위아래로 스크롤하지 않는다 — 요약 박스·사진 카드·기록 버튼은 내용에 맞는 고정
// 높이를 쓰고, 그래프 카드만 flex:1로 "남는 공간을 전부" 차지한다. 그래프 SVG는 픽셀 높이가
// 필요해서(y축 눈금 위치 계산) flex만으로는 안 되고, 실제로 얼마나 남았는지 onLayout으로 재서
// 그 값을 그대로 그래프 높이로 쓴다 — 미리 정해둔 두 숫자를 더하는 방식(예전 방식)이 아니라
// "차지한 만큼 그대로" 재는 것이라 다른 요소 크기가 바뀌어도 항상 정확하다.
const GRAPH_H_DEFAULT = 190; // 첫 렌더(아직 실측 전) 임시값
const PHOTO_SIZE = 110;

// 날짜 칸의 폭 — 그래프 포인트 폭(POINT_W)과 똑같이 맞춰서 같은 가로 스크롤 안에서 날짜 칸과
// 그래프 데이터가 항상 같은 x 위치에 정렬된다. 높이는 이 칸이 그래프 위에 얹히는 고정 줄 높이.
const DATE_CELL_W = POINT_W;
const DATE_ROW_H = 60;

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

function parseDateKey(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return { y, m, d, weekday: WEEKDAY_KO[new Date(y, m - 1, d).getDay()] };
}

function fmtFull(dateKey) {
  const { y, m, d } = parseDateKey(dateKey);
  return `${y}.${m}.${d}`;
}

// 밝은 배경(연두/주황/노랑 계열)은 흰 글자보다 진한 잉크색 글자가 더 잘 읽혀서 배경색에 따라
// 글자색을 바꾼다 — 참고 디자인의 sev3(빨강)만 어두운 편이라 흰 글자를 그대로 쓴다.
const LIGHT_PILL_BGS = [mc.sev1, mc.sev2, mc.warn];

/** 그래프에서 선택된 날짜의 값을 보여주는 요약 박스 — 그래프 포인트를 탭하면 값이 함께 바뀐다 */
function SummaryBox({ label, value, unit, pillText, pillColor }) {
  const pillTextColor = LIGHT_PILL_BGS.includes(pillColor) ? mc.ink : '#fff';
  return (
    <View style={[monitoringCard(14), styles.summaryBox]}>
      <Text style={styles.summaryLabel} numberOfLines={1}>{label}</Text>
      <View style={styles.summaryValueRow}>
        <Text style={styles.summaryValue}>{value}</Text>
        <Text style={styles.summaryUnit}>{unit}</Text>
      </View>
      <View style={[styles.summaryPill, { backgroundColor: pillColor }]}>
        <Text style={[styles.summaryPillText, { color: pillTextColor }]} numberOfLines={1}>{pillText}</Text>
      </View>
    </View>
  );
}

/** 날짜 선택 줄의 칸 하나 — 요일(위) + 월/일(아래, 예: 8/1), 선택되면 초록 배지로 강조된다 */
function DateCell({ record, selected, onPress }) {
  const { weekday, m, d } = parseDateKey(record.date);
  return (
    <TouchableOpacity style={styles.dateCell} activeOpacity={0.7} onPress={onPress}>
      <View style={[styles.dateCellInner, selected && styles.dateCellInnerActive]}>
        <Text style={[styles.dateCellWeekday, selected && styles.dateCellTextActive]}>{weekday}</Text>
        <Text style={[styles.dateCellDay, selected && styles.dateCellTextActive]} numberOfLines={1}>{m}/{d}</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function MonitoringFolderScreen({ navigation, route }) {
  const { folderId } = route.params || {};
  const folder = useFolder(folderId);
  const [zoomRecord, setZoomRecord] = useState(null);
  const [zoomPage, setZoomPage] = useState(0);
  // true면 이 화면 대신 가이드 촬영 화면(MonitorCaptureScreen)을 전체 화면으로 띄운다
  const [capturing, setCapturing] = useState(false);
  const { findTarget } = useMonitoring();
  // 날짜 칸 줄과 그래프가 같은 가로 스크롤 하나를 공유한다(아래 참고) — 처음 열렸을 때(또는 새로
  // 촬영해 기록이 늘었을 때) 오른쪽 끝(오늘)으로 자동 스크롤하기 위한 참조.
  const scrollRef = useRef(null);
  const scrolledToEndRef = useRef(false);
  // 그래프 영역(graphRow)이 실제로 차지한 높이 — 여기서 DATE_ROW_H(고정값)를 빼면 그래프 자체에
  // 줄 수 있는 높이가 나온다. 화면 아래까지 이 카드가 남는 공간을 전부 채우도록 페이지 자체는
  // 스크롤하지 않는다.
  const [graphRowH, setGraphRowH] = useState(0);
  // 지금 선택된 날짜 — 기본은 가장 최근 기록(맨 오른쪽). 그래프 포인트나 날짜 칸을 탭하면 바뀐다.
  const [selectedId, setSelectedId] = useState(() => {
    const recs = folder?.records;
    return recs && recs.length ? recs[recs.length - 1].id : null;
  });

  // 기록이 하나도 없는 폴더는 만들어지지 않지만(폴더 생성과 첫 기록이 한 번에 일어난다),
  // 아래 계산이 전부 "기록이 최소 하나"를 전제하므로 방어적으로 함께 막는다.
  if (!folder || folder.records.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={{ padding: 20, color: mc.sub }}>폴더를 찾을 수 없습니다.</Text>
      </SafeAreaView>
    );
  }

  const records = folder.records;
  const total = records.length;
  const contentWidth = chartContentWidth(total);
  const graphH = graphRowH > 0 ? Math.max(60, graphRowH - DATE_ROW_H) : GRAPH_H_DEFAULT;
  const selectedRecord = records.find((r) => r.id === selectedId) || records[records.length - 1];
  const skinDisplay = DISPLAY_SCALE.iga(selectedRecord.iga);
  const itchDisplay = DISPLAY_SCALE.itch(selectedRecord.itchVas);
  const sleep = sleepBand(selectedRecord.sleepScore);
  const itch = itchBand(itchDisplay);
  const skin = skinConditionInfo(skinDisplay); // 그래프와 같은 0~100 표시값 기준

  /** 날짜를 선택하면(날짜 칸 탭이든 그래프 포인트 탭이든) 그 위치가 화면에 보이도록 스크롤한다 —
   * 날짜 칸과 그래프가 같은 스크롤 안에 있어서 한 번만 스크롤하면 둘 다 함께 움직인다. */
  const selectRecord = (r) => {
    setSelectedId(r.id);
    const idx = records.findIndex((x) => x.id === r.id);
    if (idx < 0) return;
    scrollRef.current?.scrollTo({ x: Math.max(0, idx * POINT_W - POINT_W), animated: true });
  };

  const openZoom = (page) => { setZoomPage(page); setZoomRecord(selectedRecord); };

  /**
   * "오늘의 피부 상태 기록"은 신규 등록 때와 똑같은 가이드 촬영을 쓴다 — 같은 자리를 계속
   * 비교하려면 매번 같은 구도·같은 색 기준으로 찍혀야 하므로, 일반 카메라가 아니라 기준 사진에
   * 맞춰 자동 셔터·정합·색보정까지 하는 MonitorCaptureScreen을 그대로 띄운다.
   * 그 화면은 대상(MonitorTarget)을 요구하므로 폴더에 적힌 targetId로 찾아 넘긴다.
   */
  const target = folder.targetId ? findTarget(folder.targetId) : undefined;

  if (capturing && target) {
    return (
      <MonitorCaptureScreen
        target={target}
        onCancel={() => setCapturing(false)}
        onComplete={(processedUri) => {
          // 후처리까지 끝난 사진을 오늘 기록으로 폴더에 넣는다 (기준 사진 갱신은 MonitorCaptureScreen이 한다)
          const record = addRecord(folderId, { uri: processedUri });
          setCapturing(false);
          if (record) {
            setSelectedId(record.id);
            scrollRef.current?.scrollToEnd({ animated: true });
          }
        }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          <Text style={{ fontSize: 20, color: mc.ink }}>‹</Text>
          <Text style={styles.topBarTitle} numberOfLines={1}>{folder.name}</Text>
        </TouchableOpacity>
        <View style={styles.dayBadge}>
          <Text style={styles.dayBadgeText}>D+{dayCount(folder)}</Text>
        </View>
      </View>

      {/* 화면 자체는 위아래로 스크롤하지 않는다 — 요약 박스·사진 카드·기록 버튼은 고정 높이,
          그래프 카드(flex:1)만 남는 공간을 전부 차지한다. */}
      <View style={styles.body}>
        {/* 그래프에서 선택된 날짜의 값을 보여주는 요약 박스 3개 — 그래프 포인트를 탭하면 함께 바뀐다.
            세 지표 모두 DISPLAY_SCALE로 0~100 표시값으로 맞춰서 같은 축·같은 기준으로 비교할 수 있다. */}
        <View style={styles.summaryRow}>
          <SummaryBox label="피부 종합 상태" value={skinDisplay.toFixed(1)} unit="/100" pillText={skin.ko} pillColor={skin.color} />
          <SummaryBox label="가려움" value={itchDisplay} unit="/100" pillText={itch.ko} pillColor={itch.color} />
          <SummaryBox label="수면 점수" value={selectedRecord.sleepScore} unit="/100" pillText={sleep.ko} pillColor={sleep.color} />
        </View>

        {/* 날짜 + 변화 추이 그래프를 한 카드에 합쳤다. 맨 위에 촬영 기간 전체(첫 기록 ~ 마지막
            기록)를 보여주고, 그 아래 날짜 칸 줄과 그래프가 같은 가로 스크롤 하나를 공유해서 항상
            같은 x 위치로 맞물려 움직인다. 날짜 칸을 탭하거나 그래프 포인트를 탭하면(selectRecord)
            선택된 날짜의 폭 전체가 초록 띠(그래프)·초록 배지(날짜 칸)로 함께 강조되고, 위 요약
            박스 값도 갱신된다. 그래프 포인트를 두 번(더블탭) 탭하면 바로 그 기록의 상세 결과로
            넘어간다. "변화 추이" 제목·촬영 횟수·범례는 그래프 아래에 둔다. */}
        <View style={[monitoringCard(), styles.card, { flex: 1 }]}>
          <View style={styles.dateStripHeader}>
            <Text style={{ fontSize: 15 }}>📅</Text>
            <Text style={styles.dateStripRange}>
              {fmtFull(records[0].date)} - {fmtFull(records[records.length - 1].date)}
            </Text>
          </View>

          <View style={styles.graphRow} onLayout={(e) => setGraphRowH(e.nativeEvent.layout.height)}>
            <View style={styles.axisCol}>
              <View style={{ height: DATE_ROW_H }} />
              <TrendChartYAxis chartHeight={graphH} />
            </View>
            <ScrollView
              ref={scrollRef}
              horizontal
              showsHorizontalScrollIndicator
              style={styles.graphRegion}
              onContentSizeChange={() => {
                // 처음 열었을 때, 그리고 새로 촬영해 기록이 늘었을 때 항상 가장 최근(오늘) 기록이
                // 보이도록 오른쪽 끝으로 스크롤한다(첫 진입만 자동으로, 이후엔 촬영 직후에만 명시적으로 호출됨)
                if (!scrolledToEndRef.current) {
                  scrolledToEndRef.current = true;
                  scrollRef.current?.scrollToEnd({ animated: false });
                }
              }}
            >
              <View style={{ width: contentWidth }}>
                <View style={[styles.dateCellRow, { height: DATE_ROW_H }]}>
                  {records.map((r) => (
                    <DateCell key={r.id} record={r} selected={r.id === selectedRecord.id} onPress={() => selectRecord(r)} />
                  ))}
                </View>
                <TrendChart
                  records={records}
                  chartHeight={graphH}
                  selectedId={selectedRecord.id}
                  onSelect={selectRecord}
                  onDoubleSelect={(r) => navigation.navigate('MonitoringDetail', { folderId, recordId: r.id })}
                />
              </View>
            </ScrollView>
          </View>

          <View style={styles.cardHeadRow}>
            <Text style={styles.cardTitle}>변화 추이</Text>
            <Text style={styles.cardSub}>총 {total}회 촬영</Text>
          </View>
          <TrendChartLegend />
        </View>

        {/* 선택된 날짜의 촬영 이미지 — 제목 줄 오른쪽에 그 날짜의 병변 면적(%)을 적고(사진 크기에
            영향 없이), 그 아래 원본과 병변 마스크 오버레이를 나란히 보여준다. 사진을 탭하면 크게
            확대해서 볼 수 있다(원본 탭 → 사진 페이지, 오버레이 탭 → overlay 페이지). */}
        <View style={[monitoringCard(), styles.photoCard]}>
          <View style={styles.photoCardHeader}>
            <Text style={styles.photoCardTitle}>{fmtFull(selectedRecord.date)} 촬영</Text>
            <Text style={styles.photoCardLesion}>
              병변 면적 <Text style={styles.photoCardLesionValue}>{selectedRecord.lesionAreaPct.toFixed(1)}%</Text>
            </Text>
          </View>
          <View style={styles.photoRow}>
            <TouchableOpacity style={styles.photoCol} activeOpacity={0.85} onPress={() => openZoom(0)}>
              <LesionThumb photo={selectedRecord.photo} areaPct={selectedRecord.lesionAreaPct} seed={selectedRecord.seed} mode="photo" size={PHOTO_SIZE} />
              <Text style={styles.photoCaption}>촬영 이미지 (원본)</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.photoCol} activeOpacity={0.85} onPress={() => openZoom(1)}>
              <LesionThumb photo={selectedRecord.photo} areaPct={selectedRecord.lesionAreaPct} seed={selectedRecord.seed} mode="overlay" size={PHOTO_SIZE} />
              <Text style={styles.photoCaption}>마스크 오버레이 이미지</Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.recordBtn, !target && styles.recordBtnDisabled]}
          activeOpacity={0.85}
          onPress={() => setCapturing(true)}
          disabled={!target}
        >
          <Text style={[styles.recordBtnText, !target && styles.recordBtnTextDisabled]}>
            {target ? '📷 오늘의 피부 상태 기록' : '등록된 촬영 자리가 없어요'}
          </Text>
        </TouchableOpacity>
      </View>

      <PhotoZoomModal visible={!!zoomRecord} record={zoomRecord} initialPage={zoomPage} onClose={() => setZoomRecord(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: mc.bg },
  topBar: {
    height: 56, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 20, gap: 8,
    backgroundColor: mc.card, borderBottomWidth: 1, borderBottomColor: mc.line,
  },
  topBarTitle: { fontSize: 15, fontWeight: '700', color: mc.ink, flexShrink: 1 },
  dayBadge: { backgroundColor: mc.greenBody, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  dayBadgeText: { fontSize: 12, color: mc.greenDeep, fontWeight: '800' },
  body: { flex: 1, padding: 12, gap: 12 },
  summaryRow: { flexDirection: 'row', gap: 8 },
  summaryBox: {
    flex: 1, paddingVertical: 12, paddingHorizontal: 8,
    alignItems: 'center', gap: 6,
  },
  summaryLabel: { fontSize: 11, color: mc.sub, fontWeight: '700' },
  summaryValueRow: { flexDirection: 'row', alignItems: 'flex-end' },
  summaryValue: { fontSize: 22, fontWeight: '800', color: mc.ink },
  summaryUnit: { fontSize: 11, color: mc.sub, marginLeft: 2, marginBottom: 3 },
  summaryPill: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3, maxWidth: '100%' },
  summaryPillText: { fontSize: 10.5, fontWeight: '800' },

  dateStripHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dateStripRange: { fontSize: 14, fontWeight: '800', color: mc.ink },
  dateCellRow: { flexDirection: 'row' },
  dateCell: { width: DATE_CELL_W, alignItems: 'center', justifyContent: 'center' },
  dateCellInner: { alignItems: 'center', paddingVertical: 8, paddingHorizontal: 4, borderRadius: 14, minWidth: 54 },
  dateCellInnerActive: { backgroundColor: mc.greenTop },
  dateCellWeekday: { fontSize: 11.5, fontWeight: '700', color: mc.sub },
  dateCellDay: { fontSize: 14, fontWeight: '800', color: mc.ink, marginTop: 2 },
  dateCellTextActive: { color: mc.greenDeep },

  card: { paddingVertical: 16, paddingHorizontal: 10 },
  cardHeadRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 6, marginTop: 14 },
  cardTitle: { fontSize: 14, fontWeight: '800', color: mc.ink },
  cardSub: { fontSize: 11, color: mc.sub, fontWeight: '600' },
  graphRow: { flex: 1, flexDirection: 'row', marginTop: 10 },
  axisCol: { width: Y_AXIS_W },
  graphRegion: { flex: 1 },

  photoCard: { padding: 14 },
  photoCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  photoCardTitle: { fontSize: 13, fontWeight: '700', color: mc.sub },
  photoCardLesion: { fontSize: 12, fontWeight: '600', color: mc.sub },
  photoCardLesionValue: { fontSize: 13, fontWeight: '800', color: mc.ink },
  photoRow: { flexDirection: 'row', justifyContent: 'center', gap: 14 },
  photoCol: { alignItems: 'center' },
  photoCaption: { fontSize: 10.5, color: mc.sub, marginTop: 6, textAlign: 'center' },

  recordBtn: {
    height: 50, borderRadius: 12, backgroundColor: mc.greenTop,
    alignItems: 'center', justifyContent: 'center',
  },
  recordBtnText: { fontSize: 15, fontWeight: '800', color: mc.greenDeep },
  recordBtnDisabled: { backgroundColor: mc.line },
  recordBtnTextDisabled: { color: mc.sub },
});
