import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { AppColors, cardDecoration } from '../theme';
import { useFolders } from '../folders/store';
import { DISPLAY_SCALE, skinConditionInfo, itchBand, sleepBand } from '../folders/theme';
import LesionThumb from '../folders/components/LesionThumb';
import { useMonitoring } from '../context/MonitoringContext';
import { useTracking } from '../TrackingModalContext';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** 모니터링 폴더의 기록 하나 + 그 기록이 속한 폴더 */
type FolderEntry = { folder: any; record: any };

/** 폴더의 날짜 문자열("2026-08-06")을 달력 셀 키("2026-8-6", 앞자리 0 없음)로 맞춘다 */
function toCellKey(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${y}-${m}-${d}`;
}

export default function RecordsScreen() {
  const folders = useFolders();
  const navigation = useNavigation<any>();
  const { open: openTracking } = useTracking();
  const [view, setView] = useState(() => new Date());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // 모든 모니터링 폴더의 기록을 날짜(달력 셀 키) 기준으로 묶어 둔다 — 같은 날 여러 부위를
  // 찍었으면 그 날짜 칸에 여러 건이 쌓인다.
  const entriesByDate = useMemo(() => {
    const map: Record<string, FolderEntry[]> = {};
    for (const folder of folders) {
      for (const record of folder.records) {
        const key = toCellKey(record.date);
        (map[key] ??= []).push({ folder, record });
      }
    }
    return map;
  }, [folders]);

  const changeMonth = (delta: number) => {
    setView((v) => new Date(v.getFullYear(), v.getMonth() + delta, 1));
    setSelectedKey(null);
  };

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 24 }}
    >
      <Text style={styles.title}>기록</Text>
      <View style={{ height: 4 }} />
      <Text style={styles.subtitle}>그동안의 검사 기록을 달력으로 확인하세요</Text>
      <View style={{ height: 16 }} />

      <CalendarCard
        view={view}
        entriesByDate={entriesByDate}
        selectedKey={selectedKey}
        onSelect={setSelectedKey}
        onChangeMonth={changeMonth}
      />

      {selectedKey != null && (
        <>
          <View style={{ height: 16 }} />
          <DetailSection dateKey={selectedKey} entries={entriesByDate[selectedKey]} />
        </>
      )}

      <View style={{ height: 22 }} />
      {/* 예전에는 이 자리에서 목록이 아래로 펼쳐졌지만, 이제는 폴더별 추이 그래프까지 있는
          모니터링 화면으로 넘어간다 (RootNavigator의 스택 화면) */}
      <ActionBox
        icon="photo-library"
        title="등록된 모니터링 기록 보기"
        caption={folders.length ? `${folders.length}개 폴더를 지켜보고 있어요` : '아직 만든 폴더가 없어요'}
        trailing="chevron-right"
        onPress={() => navigation.navigate('Monitoring')}
      />
      <View style={{ height: 10 }} />
      <ActionBox
        icon="add-a-photo"
        title="신규 검사 시작하기"
        caption="부위 · 질환 등록부터 촬영까지"
        trailing="chevron-right"
        accent
        onPress={() => navigation.navigate('Camera', { mode: 'new' })}
      />
      <View style={{ height: 10 }} />
      <ActionBox
        icon="straighten"
        title="병변 면적 추적"
        caption="부위별 병변 면적을 촬영·추적"
        trailing="chevron-right"
        onPress={() => openTracking()}
      />
    </ScrollView>
  );
}

/** 달력 아래에 놓이는 큰 네모 버튼 */
function ActionBox({
  icon,
  title,
  caption,
  trailing,
  accent,
  onPress,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  title: string;
  caption?: string;
  trailing: React.ComponentProps<typeof MaterialIcons>['name'];
  accent?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[cardDecoration(16), styles.actionBox, accent && styles.actionBoxAccent]} onPress={onPress}>
      <View style={[styles.actionIcon, accent && styles.actionIconAccent]}>
        <MaterialIcons name={icon} size={20} color={accent ? '#16320A' : AppColors.greenMuted} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.actionTitle}>{title}</Text>
        {caption != null && <Text style={styles.actionCaption}>{caption}</Text>}
      </View>
      <MaterialIcons name={trailing} size={22} color={AppColors.sub} />
    </Pressable>
  );
}

function CalendarCard({
  view,
  entriesByDate,
  selectedKey,
  onSelect,
  onChangeMonth,
}: {
  view: Date;
  entriesByDate: Record<string, FolderEntry[]>;
  selectedKey: string | null;
  onSelect: (k: string) => void;
  onChangeMonth: (d: number) => void;
}) {
  const year = view.getFullYear();
  const month = view.getMonth(); // 0-based
  const first = new Date(year, month, 1).getDay(); // 일=0
  const days = new Date(year, month + 1, 0).getDate();
  const today = new Date();

  const cells: React.ReactNode[] = [];
  for (let i = 0; i < first; i++) cells.push(<View key={`blank-${i}`} style={styles.cell} />);
  for (let d = 1; d <= days; d++) {
    const key = `${year}-${month + 1}-${d}`;
    const entries = entriesByDate[key];
    const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
    const isSel = selectedKey === key;
    cells.push(
      <Pressable key={key} style={styles.cell} onPress={() => onSelect(key)}>
        <View
          style={[
            styles.cellInner,
            isSel && { backgroundColor: AppColors.greenTop },
            !isSel && isToday && { backgroundColor: AppColors.bg },
          ]}
        >
          <Text
            style={{
              fontSize: 14,
              fontWeight: isSel || isToday ? '800' : '400',
              color: isSel ? '#143006' : AppColors.ink,
            }}
          >
            {d}
          </Text>
          {entries && entries.length > 0 && (
            <View style={styles.dotsRow}>
              {entries.slice(0, 3).map((e, i) => (
                <View
                  key={i}
                  style={[
                    styles.dot,
                    { backgroundColor: skinConditionInfo(DISPLAY_SCALE.iga(e.record.iga)).color },
                  ]}
                />
              ))}
            </View>
          )}
        </View>
      </Pressable>,
    );
  }

  return (
    <View style={[cardDecoration(), styles.calendarCard]}>
      <View style={styles.calendarHeader}>
        <Text style={styles.monthLabel}>
          {year}년 {month + 1}월
        </Text>
        <View style={{ flexDirection: 'row' }}>
          <NavBtn icon="chevron-left" onPress={() => onChangeMonth(-1)} />
          <View style={{ width: 6 }} />
          <NavBtn icon="chevron-right" onPress={() => onChangeMonth(1)} />
        </View>
      </View>
      <View style={{ height: 14 }} />
      <View style={{ flexDirection: 'row' }}>
        {WEEKDAYS.map((w) => (
          <View key={w} style={styles.weekdayCell}>
            <Text style={styles.weekdayText}>{w}</Text>
          </View>
        ))}
      </View>
      <View style={{ height: 8 }} />
      <View style={styles.grid}>{cells}</View>
    </View>
  );
}

function NavBtn({ icon, onPress }: { icon: 'chevron-left' | 'chevron-right'; onPress: () => void }) {
  return (
    <Pressable style={styles.navBtn} onPress={onPress}>
      <MaterialIcons name={icon} size={20} color="#555555" />
    </Pressable>
  );
}

function DetailSection({ dateKey, entries }: { dateKey: string; entries: FolderEntry[] | undefined }) {
  if (!entries || entries.length === 0) {
    return (
      <View style={[cardDecoration(), { padding: 18, alignItems: 'center' }]}>
        <Text style={styles.noRecord}>이 날에는 검사 기록이 없어요.</Text>
      </View>
    );
  }

  const [y, m, d] = dateKey.split('-').map(Number);
  const dateStr = `${y}.${m}.${d}`;

  return (
    <>
      <Text style={styles.dateHeading}>
        {dateStr} 검사{entries.length > 1 ? ` · ${entries.length}건` : ''}
      </Text>
      <View style={{ height: 10 }} />
      {entries.map((entry, i) => (
        <View key={entry.record.id ?? i} style={i !== entries.length - 1 ? { marginBottom: 12 } : undefined}>
          <DetailCard entry={entry} />
        </View>
      ))}
    </>
  );
}

/**
 * 홈의 "최근 피부 상태" 카드와 같은 4개 지표(피부 종합 상태 · 가려움 · 수면 점수 · 병변 면적)로
 * 통일했다 — 사진/부위/병명만 이 폴더가 참조하는 모니터링 대상(MonitorTarget)에서 그대로 가져온다.
 */
function DetailCard({ entry }: { entry: FolderEntry }) {
  const { folder, record } = entry;
  const { findTarget } = useMonitoring();
  const target = folder.targetId ? findTarget(folder.targetId) : undefined;
  const siteLabel: string | undefined = target?.label;
  const diseaseName: string = target?.diagnosis?.disease ?? folder.name;

  const skinValue = DISPLAY_SCALE.iga(record.iga);
  const itchValue = DISPLAY_SCALE.itch(record.itchVas);
  const skin = skinConditionInfo(skinValue);
  const itch = itchBand(itchValue);
  const sleep = sleepBand(record.sleepScore);

  return (
    <View style={[cardDecoration(), styles.detailCard]}>
      <Text style={styles.detailDate}>D+{record.dayOffset} 기록</Text>
      <View style={{ height: 10 }} />
      <View style={{ flexDirection: 'row' }}>
        <View style={{ alignItems: 'center' }}>
          <LesionThumb
            photo={record.photo}
            areaPct={record.lesionAreaPct}
            seed={record.seed}
            mode="photo"
            size={60}
            style={undefined}
          />
          {siteLabel != null && (
            <>
              <View style={{ height: 6 }} />
              <View style={styles.regionPill}>
                <Text style={styles.regionPillText}>{siteLabel}</Text>
              </View>
            </>
          )}
        </View>
        <View style={{ width: 12 }} />
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Text style={styles.detailDisease}>{diseaseName}</Text>
        </View>
      </View>
      <View style={{ height: 14 }} />
      <View style={{ flexDirection: 'row' }}>
        <MonitorStat label="피부 종합 상태" value={skinValue.toFixed(1)} unit="/100" band={skin.ko} bandColor={skin.color} />
        <MonitorStat label="가려움" value={`${itchValue}`} unit="/100" band={itch.ko} bandColor={itch.color} />
        <MonitorStat label="수면 점수" value={`${record.sleepScore}`} unit="/100" band={sleep.ko} bandColor={sleep.color} />
        <MonitorStat label="병변 면적" value={record.lesionAreaPct.toFixed(1)} unit="%" />
      </View>
    </View>
  );
}

function MonitorStat({
  label,
  value,
  unit,
  band,
  bandColor,
}: {
  label: string;
  value: string;
  unit?: string;
  band?: string;
  bandColor?: string;
}) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel} numberOfLines={1}>
        {label}
      </Text>
      <View style={{ height: 3 }} />
      <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
        <Text style={styles.metricValue}>{value}</Text>
        {unit != null && <Text style={styles.metricUnit}>{unit}</Text>}
      </View>
      {band != null && (
        <>
          <View style={{ height: 2 }} />
          <Text style={[styles.metricBand, bandColor && { color: bandColor }]} numberOfLines={1}>
            {band}
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '800', color: AppColors.ink },
  subtitle: { fontSize: 13.5, color: AppColors.sub },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: AppColors.ink },

  actionBox: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  actionBoxAccent: { borderWidth: 1.5, borderColor: AppColors.greenTop },
  actionIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    marginRight: 12,
    backgroundColor: '#F1F3F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIconAccent: { backgroundColor: AppColors.greenTop },
  actionTitle: { fontSize: 15, fontWeight: '700', color: AppColors.ink },
  actionCaption: { fontSize: 12, color: AppColors.sub, marginTop: 3 },

  calendarCard: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 20 },
  calendarHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  monthLabel: { fontSize: 17, fontWeight: '800', color: AppColors.ink },
  navBtn: { width: 30, height: 30, borderRadius: 9, backgroundColor: '#F1F3F6', alignItems: 'center', justifyContent: 'center' },
  weekdayCell: { flex: 1, alignItems: 'center' },
  weekdayText: { fontSize: 12, fontWeight: '600', color: AppColors.sub },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, padding: 2 },
  cellInner: { flex: 1, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  dotsRow: { position: 'absolute', bottom: 6, flexDirection: 'row' },
  dot: { width: 5, height: 5, borderRadius: 2.5, marginHorizontal: 1 },
  noRecord: { fontSize: 14, color: AppColors.sub },
  dateHeading: { fontSize: 13, fontWeight: '700', color: AppColors.ink },
  detailCard: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 18 },
  detailDate: { fontSize: 13, fontWeight: '600', color: AppColors.sub },
  regionPill: { backgroundColor: '#F1F3F6', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  regionPillText: { fontSize: 10.5, fontWeight: '700', color: AppColors.sub },
  detailDisease: { fontSize: 17, fontWeight: '800', color: AppColors.ink },
  metric: { flex: 1, backgroundColor: '#F4F6F9', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 4, alignItems: 'center', marginHorizontal: 3 },
  metricLabel: { fontSize: 10, color: AppColors.sub },
  metricValue: { fontSize: 14, fontWeight: '800', color: AppColors.ink },
  metricUnit: { fontSize: 9, fontWeight: '700', color: AppColors.sub, marginLeft: 1, marginBottom: 1 },
  metricBand: { fontSize: 9.5, fontWeight: '700', color: AppColors.sub },
});
