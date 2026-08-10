import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  monitoringColors as mc, monitoringCard, sleepBand, itchBand, skinConditionInfo, DISPLAY_SCALE,
  SKIN_SEGMENTS, ITCH_SEGMENTS, SLEEP_SEGMENTS, SYMPTOM_SEGMENTS_BASE, SYMPTOMS, CHART_SERIES,
} from '../theme';
import { useFolder } from '../store';
import { useProfile } from '../../context/ProfileContext';
import { plainSiteLabel } from '../../models';
import { MetricCard, MetricRow, EmptyMetricCard } from '../../components/MetricCard';
import UsedProductsCard from '../../components/UsedProductsCard';
import TrendChart, {
  TrendChartLegend, TrendChartYAxis, chartContentWidth, POINT_W, Y_AXIS_W,
} from '../components/TrendChart';
import LesionThumb from '../components/LesionThumb';
import PhotoZoomModal from '../components/PhotoZoomModal';

// 상세 결과와 사용한 제품이 아래에 붙으면서 한 화면에 다 들어가지 않게 되어, 페이지 전체를
// 세로로 스크롤한다. 그래프 SVG는 픽셀 높이가 필요해서(y축 눈금 위치 계산) flex로 늘릴 수 없고,
// 스크롤 안에서는 "남는 공간"이라는 것도 없으므로 그래프 카드에 고정 높이를 준다.
// (예전엔 190px이라 가로 폭에 비해 너무 짧고 뚱뚱해 보였고, 가로 스크롤바가 그래프 맨 아래
// 선과 겹쳐서 잘린 것처럼 보였다 — 세로를 키우고 TrendChart의 아래 여백(PAD_BOTTOM)도 늘렸다.)
const GRAPH_ROW_H = 340; // 날짜 칸 줄 + 그래프가 함께 차지하는 높이
const GRAPH_H_DEFAULT = GRAPH_ROW_H - 60;
const PHOTO_SIZE = 110;
const SYMPTOM_ORDER = ['redness', 'bumps', 'scratch', 'thickening'];

// 요약칸 원형 배지 아이콘 — 흰 선화라 배경색(CHART_SERIES 색) 위에 바로 얹는다
const SKIN_ICON = require('../../../assets/icon/skin_icon_white.png');
const ITCH_ICON = require('../../../assets/icon/itch_icon_white.png');
const SLEEP_ICON = require('../../../assets/icon/sleep_icon_white.png');

/** 기록의 날짜 키("2026-08-05")를 Date로 — "사용한 제품"이 그날의 제품 목록을 찾는 데 쓴다 */
function toDate(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d);
}

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

// 밝은 배경(노랑/주황 계열)은 흰 글자보다 진한 잉크색 글자가 더 잘 읽혀서 배경색에 따라
// 글자색을 바꾼다 — 파랑(sev0)·빨강(sev3)은 진한 편이라 흰 글자를 그대로 쓴다.
const LIGHT_PILL_BGS = [mc.sevCaution, mc.warn];

/**
 * 그래프에서 선택된 날짜의 값을 보여주는 요약 박스 — 그래프 포인트를 탭하면 값이 함께 바뀐다.
 * 원형 배지 색(circleColor)은 그 아래 배지(pillColor, 좋음/나쁨 4단계)와는 다른 축이다 — 이건
 * "지금 상태가 좋은지 나쁜지"가 아니라 "이 항목이 그래프의 어느 꺾은선인지"를 색으로 잇는다.
 * 점수 글자색은 항상 검정(ink) — 상태색은 원형 배지·아래 배지 둘로 충분하다.
 */
function SummaryBox({ label, value, pillText, pillColor, icon, circleColor, iconSize = 22 }) {
  const pillTextColor = LIGHT_PILL_BGS.includes(pillColor) ? mc.ink : '#fff';
  return (
    <View style={[monitoringCard(14), styles.summaryBox]}>
      <View style={[styles.summaryIconCircle, { backgroundColor: circleColor }]}>
        <Image source={icon} style={{ width: iconSize, height: iconSize }} resizeMode="contain" />
      </View>
      <Text style={styles.summaryLabel} numberOfLines={1}>{label}</Text>
      <View style={styles.summaryValueRow}>
        <Text style={styles.summaryValue}>{value}</Text>
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
  const { healthConnected } = useProfile();
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
  // 수면 점수는 스마트워치(Samsung Health) 연동 값이라, 미연동이면 "미기재"로 비워 둔다
  const sleep = healthConnected ? sleepBand(selectedRecord.sleepScore) : null;
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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          <Text style={{ fontSize: 20, color: mc.ink }}>‹</Text>
          <Text style={styles.topBarTitle} numberOfLines={1}>{plainSiteLabel(folder.name)}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body}>
        {/* 그래프에서 선택된 날짜의 값을 보여주는 요약 박스 3개 — 그래프 포인트를 탭하면 함께 바뀐다.
            세 지표 모두 DISPLAY_SCALE로 0~100 표시값으로 맞춰서 같은 축·같은 기준으로 비교할 수 있다. */}
        <View style={styles.summaryRow}>
          <SummaryBox
            label="피부 종합 상태"
            value={Math.round(skinDisplay)}
            pillText={skin.ko}
            pillColor={skin.color}
            icon={SKIN_ICON}
            circleColor={CHART_SERIES.skin.color}
            iconSize={32}
          />
          <SummaryBox
            label="가려움 안정도"
            value={itchDisplay}
            pillText={itch.ko}
            pillColor={itch.color}
            icon={ITCH_ICON}
            circleColor={CHART_SERIES.itch.color}
            iconSize={26}
          />
          <SummaryBox
            label="수면 점수"
            value={sleep ? selectedRecord.sleepScore : '-'}
            pillText={sleep ? sleep.ko : '미기재'}
            pillColor={sleep ? sleep.color : mc.navInactive}
            icon={SLEEP_ICON}
            circleColor={CHART_SERIES.sleep.color}
            iconSize={32}
          />
        </View>

        {/* 날짜 + 변화 경과 그래프를 한 카드에 합쳤다. 맨 위에 촬영 기간 전체(첫 기록 ~ 마지막
            기록)를 보여주고, 그 아래 날짜 칸 줄과 그래프가 같은 가로 스크롤 하나를 공유해서 항상
            같은 x 위치로 맞물려 움직인다. 날짜 칸을 탭하거나 그래프 포인트를 탭하면(selectRecord)
            선택된 날짜의 폭 전체가 회색 띠(그래프)·초록 배지(날짜 칸)로 함께 강조되고, 위 요약
            박스 값도 갱신된다. 상세 결과로 넘어가는 길은 없다 — 아래 "피부 상태 상세 결과"에서
            그대로 펼쳐 본다. "변화 경과" 제목·촬영 횟수·범례는 그래프 아래에 둔다. */}
        <View style={[monitoringCard(), styles.card]}>
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
                />
              </View>
            </ScrollView>
          </View>

          <View style={styles.cardHeadRow}>
            <Text style={styles.cardTitle}>변화 경과</Text>
            <Text style={styles.cardSub}>총 {total}회 촬영</Text>
          </View>
          <TrendChartLegend />
        </View>

        {/* 선택된 날짜의 촬영 이미지 — 원본과 병변 마스크 오버레이를 나란히 보여준다. 사진을 탭하면
            크게 확대해서 볼 수 있다(원본 탭 → 사진 페이지, 오버레이 탭 → overlay 페이지). */}
        <View style={[monitoringCard(), styles.photoCard]}>
          <View style={styles.photoCardHeader}>
            <Text style={styles.photoCardTitle}>{fmtFull(selectedRecord.date)} 촬영</Text>
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

        {/* 선택된 날짜의 지표 네 가지 — 상세 결과 화면과 같은 카드(MetricCard)를 쓴다. 같은 값을
            두 화면에서 다른 모양으로 보여주면 어느 쪽이 맞는지 헷갈린다. 위 요약 박스(SummaryBox)와
            달리 여기는 4가지 증상까지 다 펼쳐 보여주는 상세 영역이라 몇 점 만점인지("/100")도
            함께 적는다. */}
        <MetricCard label="피부 종합 상태" value={skinDisplay} unit="/100" segments={SKIN_SEGMENTS} />

        <View style={[monitoringCard(), styles.metricCard]}>
          <Text style={styles.metricCardLabel}>4가지 증상</Text>
          {SYMPTOM_ORDER.map((key, i) => (
            <MetricRow
              key={key}
              label={SYMPTOMS[key].label}
              value={DISPLAY_SCALE.symptom(selectedRecord[key])}
              segments={SYMPTOM_SEGMENTS_BASE}
              first={i === 0}
              hideValue
            />
          ))}
        </View>

        <MetricCard label="가려움 안정도" value={itchDisplay} unit="/100" segments={ITCH_SEGMENTS} />

        {healthConnected ? (
          <MetricCard label="수면 점수" value={selectedRecord.sleepScore} unit="/100" segments={SLEEP_SEGMENTS} />
        ) : (
          <EmptyMetricCard label="수면 점수" text="미기재" />
        )}

        {/* 그날 쓴 제품 — 루틴 탭의 <사용 제품>과 연동 */}
        <UsedProductsCard date={toDate(selectedRecord.date)} />
      </ScrollView>

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
  body: { padding: 12, gap: 12, paddingBottom: 24 },
  summaryRow: { flexDirection: 'row', gap: 8 },
  summaryBox: {
    flex: 1, paddingVertical: 12, paddingHorizontal: 8,
    alignItems: 'center', gap: 6,
  },
  summaryIconCircle: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  summaryLabel: { fontSize: 11, color: mc.sub, fontWeight: '700' },
  summaryValueRow: { flexDirection: 'row', alignItems: 'flex-end' },
  summaryValue: { fontSize: 22, fontWeight: '800', color: mc.ink },
  summaryPill: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3, maxWidth: '100%' },
  summaryPillText: { fontSize: 10.5, fontWeight: '800' },

  dateStripHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dateStripRange: { fontSize: 14, fontWeight: '800', color: mc.ink },
  dateCellRow: { flexDirection: 'row' },
  dateCell: { width: DATE_CELL_W, alignItems: 'center', justifyContent: 'center' },
  dateCellInner: { alignItems: 'center', paddingVertical: 8, paddingHorizontal: 4, borderRadius: 14, minWidth: 42 },
  dateCellInnerActive: { backgroundColor: mc.greenTop },
  dateCellWeekday: { fontSize: 11.5, fontWeight: '700', color: mc.sub },
  dateCellDay: { fontSize: 14, fontWeight: '800', color: mc.ink, marginTop: 2 },
  dateCellTextActive: { color: mc.greenDeep },

  card: { paddingVertical: 16, paddingHorizontal: 10 },
  cardHeadRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 6, marginTop: 14 },
  cardTitle: { fontSize: 14, fontWeight: '800', color: mc.ink },
  cardSub: { fontSize: 11, color: mc.sub, fontWeight: '600' },
  graphRow: { height: GRAPH_ROW_H, flexDirection: 'row', marginTop: 10 },
  axisCol: { width: Y_AXIS_W },
  graphRegion: { flex: 1 },

  photoCard: { padding: 14 },
  photoCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  photoCardTitle: { fontSize: 13, fontWeight: '700', color: mc.sub },
  photoRow: { flexDirection: 'row', justifyContent: 'center', gap: 14 },
  photoCol: { alignItems: 'center' },
  photoCaption: { fontSize: 10.5, color: mc.sub, marginTop: 6, textAlign: 'center' },

  metricCard: { padding: 16 },
  metricCardLabel: { fontSize: 16, fontWeight: '800', color: mc.ink, marginBottom: 12 },
});
