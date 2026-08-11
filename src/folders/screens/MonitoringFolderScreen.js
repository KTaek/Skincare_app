import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  monitoringColors as mc, monitoringCard, sleepBand, itchBand, skinConditionInfo, DISPLAY_SCALE,
  SKIN_SEGMENTS, ITCH_SEGMENTS, SLEEP_SEGMENTS, SYMPTOM_SEGMENTS_BASE, SYMPTOMS, CHART_SERIES,
} from '../theme';
import { useFolder, folderHasSeverity } from '../store';
import { useProfile } from '../../context/ProfileContext';
import { useRoutines } from '../../context/RoutineContext';
import { plainSiteLabel } from '../../models';
import { MetricCard, MetricRow, EmptyMetricCard } from '../../components/MetricCard';
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
 *
 * 처음 기록 대비 증감은 여기 없다 — 루틴 이행률 카드의 오른쪽 열(TrendMini)로 옮겼다.
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

/**
 * 루틴 이행률 카드 오른쪽 열 한 줄 — 처음 기록 대비 "개선/악화"와 등급 이동("나쁨 → 주의")을
 * 보여준다. 세모(▲/▼)와 "개선/악화" 글자 모두 카드 맨 아래 응원 문구와 같은 색(greenDeep)을 써서
 * 한 카드 안에서 색이 따로 놀지 않게 한다. delta가 null이면(수면 미연동 등) 등급 이동 없이
 * "미기재"만 남긴다.
 */
function TrendMini({ label, delta, fromBand, toBand, first }) {
  const rounded = delta == null ? null : Math.round(delta);
  const tag = rounded == null ? '미기재' : rounded > 0 ? '개선' : rounded < 0 ? '악화' : '유지';
  return (
    <View style={[styles.trendMiniItem, first && styles.trendMiniItemFirst]}>
      <View style={styles.trendMiniHead}>
        {/* 오른쪽 열이 좁아서(왼쪽에 폭을 더 준다) 라벨을 낱말 단위로 강제 줄바꿈한다 — 컨테이너
            폭에 맡기면(자동 줄바꿈) 폭에 따라 "피부 종합" + "상태"처럼 애매하게 걸치기도 해서,
            띄어쓰기 자리에 직접 줄바꿈을 넣어 "피부 / 종합 / 상태"로 항상 고정되게 한다. */}
        <Text style={styles.trendMiniLabel}>{label.replace(/ /g, '\n')}</Text>
        {/* 등급 이동("나쁨 → 주의")을 "개선" 배지 바로 밑에 붙인다 — 오른쪽으로 정렬된 한 덩어리다 */}
        <View style={styles.trendMiniRight}>
          <View style={styles.trendMiniTagRow}>
            {!!rounded && <Text style={styles.trendMiniArrow}>{rounded > 0 ? '▲' : '▼'}</Text>}
            <Text style={styles.trendMiniTag}>{tag}</Text>
          </View>
          {fromBand != null && toBand != null && (
            <Text style={styles.trendMiniBands} numberOfLines={1}>{fromBand} → {toBand}</Text>
          )}
        </View>
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

/**
 * 루틴 이행률 한 줄 — 구간(좋음/주의 등) 없이 0~100% 그대로 채운다. 다 챙겼으면 막대가 끝까지
 * 찬다. 다른 지표들(피부 종합 상태 등)처럼 상태에 따라 색이 바뀌지 않고, 앱 전체가 쓰는 연두색
 * (greenTop) 하나로 고정한다 — 이건 "좋다/나쁘다" 판정이 아니라 그냥 "얼마나 했는지"라서다.
 */
function AdherenceBar({ label, rate, first }) {
  const pct = Math.round(rate * 100);
  return (
    <View style={[styles.adherenceRow, first && styles.adherenceRowFirst]}>
      <View style={styles.adherenceHead}>
        <Text style={styles.adherenceLabel} numberOfLines={1}>{label}</Text>
        <Text style={styles.adherenceValue}>{pct}%</Text>
      </View>
      <View style={styles.adherenceTrack}>
        <View style={[styles.adherenceFill, { width: `${pct}%` }]} />
      </View>
    </View>
  );
}

export default function MonitoringFolderScreen({ navigation, route }) {
  const { folderId } = route.params || {};
  const folder = useFolder(folderId);
  const [zoomRecord, setZoomRecord] = useState(null);
  const [zoomPage, setZoomPage] = useState(0);
  const { healthConnected } = useProfile();
  const { adherenceRate } = useRoutines();
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
  // 4가지 증상·IGA 모델은 아토피피부염 채점 기준이라, 이 폴더의 진단명이 그게 아니면 "피부 종합
  // 상태"·"4가지 증상"을 요약칸·그래프·상세 카드 어디에도 보여주지 않는다.
  const hasSeverity = folderHasSeverity(folder);
  const chartSeries = hasSeverity ? ['skin', 'itch', 'sleep'] : ['itch', 'sleep'];
  const skinDisplay = DISPLAY_SCALE.iga(selectedRecord.iga);
  const itchDisplay = DISPLAY_SCALE.itch(selectedRecord.itchVas);
  // 수면 점수는 스마트워치(Samsung Health) 연동 값이라, 미연동이면 "미기재"로 비워 둔다
  const sleep = healthConnected ? sleepBand(selectedRecord.sleepScore) : null;
  const itch = itchBand(itchDisplay);
  const skin = skinConditionInfo(skinDisplay); // 그래프와 같은 0~100 표시값 기준

  // 루틴 탭에서 체크한 기록을 이 자리를 지켜본 기간(첫 기록 ~ 오늘) 동안 얼마나 챙겼는지로 환산한다.
  const [fy, fm, fd] = folder.startDate.split('-').map(Number);
  const folderStart = new Date(fy, fm - 1, fd);
  const bt4Rate = adherenceRate('BT4 Complex', folderStart, new Date());
  const patchRate = adherenceRate('음압 패치', folderStart, new Date());

  // 처음 기록 대비 지금 고른 날짜까지 몇 점 움직였는지 — 그래프 포인트나 날짜 칸을 탭해 다른 날을
  // 고르면 이 값도 그 날짜 기준으로 다시 계산된다(요약 박스 값 자체가 selectedRecord 기준인 것과
  // 같은 규칙). 화살표는 점수가 늘면 빨강, 줄면 파랑 — 증가/감소를 그대로 색으로 표시할 뿐 좋다/
  // 나쁘다가 아니다.
  const firstRecord = records[0];
  const skinDelta = hasSeverity ? DISPLAY_SCALE.iga(selectedRecord.iga) - DISPLAY_SCALE.iga(firstRecord.iga) : null;
  const itchDelta = DISPLAY_SCALE.itch(selectedRecord.itchVas) - DISPLAY_SCALE.itch(firstRecord.itchVas);
  const sleepDelta = healthConnected ? selectedRecord.sleepScore - firstRecord.sleepScore : null;
  // 이행률 카드 맨 아래 응원 문구용 — 위 세 지표 중 처음 기록보다 오른(▲) 항목이 몇 개인지 센다
  const increasedCount = [skinDelta, itchDelta, sleepDelta].filter((d) => d != null && Math.round(d) > 0).length;
  // TrendMini의 "나쁨 → 주의" 같은 등급 이동 표시용 — 처음 기록의 등급만 새로 구하면 된다
  // (지금 등급은 위에서 이미 구해 둔 skin/itch/sleep 밴드를 그대로 쓴다).
  const skinFromBand = hasSeverity ? skinConditionInfo(DISPLAY_SCALE.iga(firstRecord.iga)).ko : null;
  const itchFromBand = itchBand(DISPLAY_SCALE.itch(firstRecord.itchVas)).ko;
  const sleepFromBand = healthConnected ? sleepBand(firstRecord.sleepScore).ko : null;

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
            세 지표 모두 DISPLAY_SCALE로 0~100 표시값으로 맞춰서 같은 축·같은 기준으로 비교할 수 있다.
            처음 기록 대비 증감은 여기 없다 — 아래 루틴 이행률 카드의 오른쪽 열에서 보여준다. */}
        <View style={styles.summaryRow}>
          {hasSeverity && (
            <SummaryBox
              label="피부 종합 상태"
              value={Math.round(skinDisplay)}
              pillText={skin.ko}
              pillColor={skin.color}
              icon={SKIN_ICON}
              circleColor={CHART_SERIES.skin.color}
              iconSize={32}
            />
          )}
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

        {/* 경과추적 카드 — 왼쪽은 루틴 탭에서 체크한 BT4 Complex·음압 패치를 이 자리를 지켜본 기간
            (첫 기록~오늘) 동안 얼마나 챙겼는지 + 응원 문구, 오른쪽은 처음 기록 대비 지표별
            개선/악화와 등급 이동을 보여준다. 응원 문구는 왼쪽 열 안에 있지만 오른쪽 열의 증감
            (increasedCount)까지 가져와 둘을 이어서 보여준다. 등록된 적 없는 제품이면(이름이 안
            맞으면) 그 막대는 아예 안 그린다. */}
        {(bt4Rate != null || patchRate != null) && (
          <View style={[monitoringCard(), styles.metricCard]}>
            <View style={styles.progressRow}>
              <View style={[styles.progressCol, styles.progressColLeft]}>
                {bt4Rate != null && <AdherenceBar label="BT4 Complex 이행률" rate={bt4Rate} first />}
                {patchRate != null && <AdherenceBar label="음압 패치 이행률" rate={patchRate} first={bt4Rate == null} />}
                <View style={styles.adherenceEncourageBox}>
                  <Text style={styles.adherenceEncourage}>
                    {increasedCount > 0
                      ? `처음 기록 대비 ${increasedCount}개 항목 점수가 높아졌네요.\n루틴 잊지 말고 꾸준히 이어가 보세요.`
                      : '루틴 잊지 말고 꾸준히 이어가 보세요.'}
                  </Text>
                </View>
              </View>
              <View style={styles.progressDivider} />
              <View style={styles.progressCol}>
                {hasSeverity && (
                  <TrendMini label="피부 종합 상태" delta={skinDelta} fromBand={skinFromBand} toBand={skin.ko} first />
                )}
                <TrendMini
                  label="가려움 안정도"
                  delta={itchDelta}
                  fromBand={itchFromBand}
                  toBand={itch.ko}
                  first={!hasSeverity}
                />
                <TrendMini
                  label="수면 점수"
                  delta={sleepDelta}
                  fromBand={sleepFromBand}
                  toBand={sleep ? sleep.ko : null}
                />
              </View>
            </View>
          </View>
        )}

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
                  series={chartSeries}
                />
              </View>
            </ScrollView>
          </View>

          <View style={styles.cardHeadRow}>
            <Text style={styles.cardTitle}>변화 경과</Text>
            <Text style={styles.cardSub}>총 {total}회 촬영</Text>
          </View>
          <TrendChartLegend series={chartSeries} />
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
        {hasSeverity && (
          <>
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
          </>
        )}

        <MetricCard label="가려움 안정도" value={itchDisplay} unit="/100" segments={ITCH_SEGMENTS} />

        {healthConnected ? (
          <MetricCard label="수면 점수" value={selectedRecord.sleepScore} unit="/100" segments={SLEEP_SEGMENTS} />
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
  summaryLabel: { fontSize: 13.5, color: mc.sub, fontWeight: '700' },
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

  // 경과추적 카드 — 왼쪽 이행률 열 / 오른쪽 개선·악화 열을 나란히 둔다
  progressRow: { flexDirection: 'row', alignItems: 'stretch' },
  progressCol: { flex: 1 },
  // 응원 문구 박스의 첫 문장이 왼쪽 열 폭 안에서 한 줄에 들어가려면 꽤 넓은 폭이 필요하다 —
  // 오른쪽 라벨은 폭과 무관하게 줄바꿈을 직접 넣어 고정해 뒀으니(label.replace) 오른쪽을 더
  // 좁혀도 "피부/종합/상태"처럼 그대로 읽힌다.
  progressColLeft: { flex: 2.4 },
  progressDivider: { width: 1, backgroundColor: mc.line, marginHorizontal: 12 },

  // 응원 문구 박스가 이 열 안으로 들어오면서 왼쪽 열이 고정 높이를 꽤 차지하게 됐다 — 오른쪽
  // 열(개선율 3줄)과 세로 길이가 비슷해지도록 줄 사이를 조절한다.
  adherenceRow: { marginTop: 18 },
  adherenceRowFirst: { marginTop: 0 },
  adherenceHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  adherenceLabel: { flex: 1, fontSize: 12, fontWeight: '800', color: mc.ink, marginRight: 4 },
  adherenceValue: { fontSize: 12, fontWeight: '800', color: mc.greenDeep },
  adherenceTrack: { height: 10, borderRadius: 5, backgroundColor: mc.line, overflow: 'hidden' },
  adherenceFill: { height: '100%', borderRadius: 5, backgroundColor: mc.greenTop },
  adherenceEncourageBox: {
    marginTop: 16, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 10,
    backgroundColor: '#EDF7E1',
  },
  // 이제 이 박스가 왼쪽 열 폭 안에만 있어서(카드 전체 폭이 아니라) 첫 문장("...높아졌네요.")이
  // 한 줄에 들어가도록 글자를 줄이고(progressColLeft도 더 넓혀 뒀다), 두 번째 줄만 줄바꿈된다.
  adherenceEncourage: { fontSize: 10, fontWeight: '700', color: mc.greenDeep, lineHeight: 14 },

  // 오른쪽 열은 응원 문구 박스가 없어 왼쪽보다 짧게 끝난다 — 줄 사이를 벌려서
  // 왼쪽 열과 세로 길이를 맞춘다(adherenceRow 참고).
  trendMiniItem: { marginTop: 16 },
  trendMiniItemFirst: { marginTop: 0 },
  // 라벨은 위쪽에 맞추고, 배지+등급 이동 덩어리는 오른쪽 끝에서 아래로 쌓는다
  trendMiniHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  trendMiniLabel: { flex: 1, fontSize: 12.5, fontWeight: '800', color: mc.ink, marginRight: 6 },
  trendMiniRight: { alignItems: 'flex-end' },
  // 맨 아래 응원 문구 박스(adherenceEncourageBox)와 같은 연두색 — 두 요소가 한 카드 안에서
  // 같은 "잘하고 있다" 색으로 이어져 보이게 한다.
  trendMiniTagRow: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: '#EDF7E1', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
  },
  trendMiniArrow: { fontSize: 11, fontWeight: '800', color: mc.greenDeep },
  trendMiniTag: { fontSize: 12.5, fontWeight: '800', color: mc.greenDeep },
  trendMiniBands: { fontSize: 10.5, color: mc.sub, marginTop: 4 },
});
