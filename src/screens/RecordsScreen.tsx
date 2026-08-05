import React, { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { AppColors, cardDecoration } from '../theme';
import { BODY_REGION_LABELS, SkinRecord, sevOf } from '../models';
import { useRecords } from '../context/RecordsContext';
import { useFolders } from '../folders/store';
import { SevBadge } from '../components/widgets';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export default function RecordsScreen() {
  const { records } = useRecords();
  const folders = useFolders();
  const navigation = useNavigation<any>();
  const [view, setView] = useState(() => new Date());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

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
        records={records}
        selectedKey={selectedKey}
        onSelect={setSelectedKey}
        onChangeMonth={changeMonth}
      />

      {selectedKey != null && (
        <>
          <View style={{ height: 16 }} />
          <DetailSection records={records[selectedKey]} />
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
        title="신규 모니터링 등록하기"
        trailing="chevron-right"
        accent
        onPress={() => navigation.navigate('Camera', { mode: 'monitor' })}
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
