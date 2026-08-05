import React, { useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { AppColors, cardDecoration } from '../theme';
import { useTracking } from '../TrackingModalContext';
import { BODY_REGIONS, BODY_REGION_LABELS, BodyRegion, SkinRecord, parseItch, sevOf } from '../models';
import { useRecords } from '../context/RecordsContext';
import { SevBadge } from '../components/widgets';
import LineChart from '../components/LineChart';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const REGION_ICONS: Record<BodyRegion, React.ComponentProps<typeof MaterialIcons>['name']> = {
  head: 'face',
  leftArm: 'front-hand',
  rightArm: 'front-hand',
  torso: 'accessibility-new',
  leftLeg: 'directions-walk',
  rightLeg: 'directions-walk',
};

export default function RecordsScreen() {
  const { records } = useRecords();
  const { open: openTracking } = useTracking();
  const [view, setView] = useState(() => new Date());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<BodyRegion | null>(null);

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

      <Pressable style={styles.trackEntry} onPress={() => openTracking()}>
        <MaterialIcons name="straighten" size={20} color="#2E4A14" />
        <Text style={styles.trackEntryText}>병변 면적 추적</Text>
        <MaterialIcons name="chevron-right" size={20} color="#2E4A14" />
      </Pressable>
      <View style={{ height: 16 }} />

      <CalendarCard
        view={view}
        records={records}
        selectedKey={selectedKey}
        onSelect={(key) => {
          setSelectedKey(key);
          setSelectedRegion(null);
        }}
        onChangeMonth={changeMonth}
      />

      {selectedKey != null && (
        <>
          <View style={{ height: 16 }} />
          <DetailSection records={records[selectedKey]} />
        </>
      )}

      <View style={{ height: 22 }} />
      <Text style={styles.sectionTitle}>부위별 변화 보기</Text>
      <View style={{ height: 3 }} />
      <Text style={styles.subtitle}>부위를 선택하면 그동안의 가려움·중증도 변화를 볼 수 있어요</Text>
      <View style={{ height: 12 }} />
      <RegionPicker
        selected={selectedRegion}
        onSelect={(r) => setSelectedRegion((prev) => (prev === r ? null : r))}
      />

      {selectedRegion != null && (
        <>
          <View style={{ height: 14 }} />
          <RegionTrendCard records={records} region={selectedRegion} />
        </>
      )}
    </ScrollView>
  );
}

function RegionPicker({
  selected,
  onSelect,
}: {
  selected: BodyRegion | null;
  onSelect: (r: BodyRegion) => void;
}) {
  return (
    <View style={styles.regionGrid}>
      {BODY_REGIONS.map((region) => {
        const isSel = selected === region;
        return (
          <Pressable
            key={region}
            style={[styles.regionBtn, isSel && styles.regionBtnSelected]}
            onPress={() => onSelect(region)}
          >
            <MaterialIcons name={REGION_ICONS[region]} size={20} color={isSel ? '#16320A' : AppColors.sub} />
            <View style={{ height: 6 }} />
            <Text style={[styles.regionBtnLabel, isSel && styles.regionBtnLabelSelected]}>
              {BODY_REGION_LABELS[region]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function RegionTrendCard({
  records,
  region,
}: {
  records: Record<string, SkinRecord[]>;
  region: BodyRegion;
}) {
  const regionRecords = useMemo(
    () =>
      Object.values(records)
        .flat()
        .filter((r) => r.region === region)
        .sort((a, b) => a.date.getTime() - b.date.getTime()),
    [records, region],
  );

  return (
    <View style={[cardDecoration(), styles.trendCard]}>
      <View style={styles.trendHeader}>
        <Text style={styles.trendTitle}>{BODY_REGION_LABELS[region]} 변화 추이</Text>
        {regionRecords.length > 0 && <Text style={styles.trendCount}>총 {regionRecords.length}건</Text>}
      </View>

      {regionRecords.length === 0 ? (
        <View style={styles.trendEmpty}>
          <MaterialIcons name="insights" size={26} color="#C7CBD1" />
          <View style={{ height: 8 }} />
          <Text style={styles.noRecord}>아직 이 부위에서 분석된 기록이 없어요.</Text>
        </View>
      ) : (
        <>
          <View style={{ height: 18 }} />
          <Text style={styles.trendChartLabel}>가려움 정도</Text>
          <View style={{ height: 8 }} />
          <LineChart
            data={regionRecords.map((r) => ({ date: r.date, value: parseItch(r.itch) }))}
            maxValue={10}
            color={AppColors.greenTop}
          />
          <View style={{ height: 20 }} />
          <Text style={styles.trendChartLabel}>병변 중증도</Text>
          <View style={{ height: 8 }} />
          <LineChart data={regionRecords.map((r) => ({ date: r.date, value: r.sev }))} maxValue={3} color="#2D7DD2" />
        </>
      )}
    </View>
  );
}

function CalendarCard({
  view,
  records,
  selectedKey,
  onSelect,
  onChangeMonth,
}: {
  view: Date;
  records: Record<string, SkinRecord[]>;
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
    const recs = records[key];
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
          {recs && recs.length > 0 && (
            <View style={styles.dotsRow}>
              {recs.slice(0, 3).map((r, i) => (
                <View key={i} style={[styles.dot, { backgroundColor: sevOf(r.sev).color }]} />
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

function DetailSection({ records }: { records: SkinRecord[] | undefined }) {
  if (!records || records.length === 0) {
    return (
      <View style={[cardDecoration(), { padding: 18, alignItems: 'center' }]}>
        <Text style={styles.noRecord}>이 날에는 검사 기록이 없어요.</Text>
      </View>
    );
  }

  const sorted = [...records].sort((a, b) => b.date.getTime() - a.date.getTime());
  const first = sorted[0];
  const dateStr = `${first.date.getFullYear()}.${first.date.getMonth() + 1}.${first.date.getDate()}`;

  return (
    <>
      <Text style={styles.dateHeading}>
        {dateStr} 검사{sorted.length > 1 ? ` · ${sorted.length}건` : ''}
      </Text>
      <View style={{ height: 10 }} />
      {sorted.map((record, i) => (
        <View key={i} style={i !== sorted.length - 1 ? { marginBottom: 12 } : undefined}>
          <DetailCard record={record} />
        </View>
      ))}
    </>
  );
}

function DetailCard({ record }: { record: SkinRecord }) {
  const s = sevOf(record.sev);
  const timeStr = record.date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  return (
    <View style={[cardDecoration(), styles.detailCard]}>
      <Text style={styles.detailDate}>{timeStr} 검사</Text>
      <View style={{ height: 10 }} />
      <View style={{ flexDirection: 'row' }}>
        <View style={{ alignItems: 'center' }}>
          <View style={styles.thumb}>
            {record.photoUri ? (
              <Image source={{ uri: record.photoUri }} style={styles.thumbImage} />
            ) : (
              <MaterialIcons name="image" size={24} color="#AAAABB" />
            )}
          </View>
          {record.region && (
            <>
              <View style={{ height: 6 }} />
              <View style={styles.regionPill}>
                <Text style={styles.regionPillText}>{BODY_REGION_LABELS[record.region]}</Text>
              </View>
            </>
          )}
        </View>
        <View style={{ width: 12 }} />
        <View>
          <Text style={styles.detailDisease}>{record.disease}</Text>
          <View style={{ height: 6 }} />
          <SevBadge sev={record.sev} prefix="중증도" />
        </View>
      </View>
      <View style={{ height: 14 }} />
      <View style={{ flexDirection: 'row' }}>
        <Metric label="가려움 정도" value={record.itch} />
        <View style={{ width: 10 }} />
        <Metric label="병변 중증도" value={s.stage} />
      </View>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <View style={{ height: 3 }} />
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '800', color: AppColors.ink },
  trackEntry: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#E4F2D6', borderRadius: 16, paddingVertical: 15, paddingHorizontal: 16,
  },
  trackEntryText: { flex: 1, fontSize: 15, fontWeight: '800', color: '#2E4A14' },
  subtitle: { fontSize: 13.5, color: AppColors.sub },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: AppColors.ink },
  regionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  regionBtn: {
    width: '31%',
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: '#F4F6F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  regionBtnSelected: { backgroundColor: AppColors.greenTop },
  regionBtnLabel: { fontSize: 12.5, fontWeight: '700', color: AppColors.ink },
  regionBtnLabelSelected: { color: '#16320A' },
  trendCard: { padding: 18 },
  trendHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  trendTitle: { fontSize: 15, fontWeight: '700', color: AppColors.ink },
  trendCount: { fontSize: 12, fontWeight: '600', color: AppColors.sub },
  trendChartLabel: { fontSize: 12.5, fontWeight: '700', color: AppColors.sub },
  trendEmpty: { alignItems: 'center', paddingVertical: 26 },
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
  thumb: {
    width: 60,
    height: 60,
    borderRadius: 14,
    backgroundColor: '#E7EBF0',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbImage: { width: '100%', height: '100%' },
  regionPill: { backgroundColor: '#F1F3F6', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  regionPillText: { fontSize: 10.5, fontWeight: '700', color: AppColors.sub },
  detailDisease: { fontSize: 17, fontWeight: '800', color: AppColors.ink },
  metric: { flex: 1, backgroundColor: '#F4F6F9', borderRadius: 12, padding: 10, alignItems: 'center' },
  metricLabel: { fontSize: 11, color: AppColors.sub },
  metricValue: { fontSize: 16, fontWeight: '800', color: AppColors.ink },
});
