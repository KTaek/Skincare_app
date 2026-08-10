import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { AppColors, cardDecoration } from '../theme';
import { plainSiteLabel } from '../models';
import { useFolders } from '../folders/store';
import { DISPLAY_SCALE, skinConditionInfo, itchBand, sleepBand } from '../folders/theme';
import LesionThumb from '../folders/components/LesionThumb';
import { useMonitoring } from '../context/MonitoringContext';
import { useProfile } from '../context/ProfileContext';
import MemoBlock from '../records/MemoBlock';
import { MemoTarget, normalizeDateKey, useDatesWithMemos, useHasMemo } from '../records/memoStore';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

/** 모니터링 폴더의 기록 하나 + 그 기록이 속한 폴더 */
type FolderEntry = { folder: any; record: any };

/** 폴더의 날짜 문자열("2026-08-06")을 달력 셀 키("2026-8-6", 앞자리 0 없음)로 맞춘다 */
function toCellKey(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${y}-${m}-${d}`;
}

/** 오늘 날짜의 달력 셀 키 — 처음 화면을 열었을 때 기본으로 선택해 둔다 */
function todayCellKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export default function RecordsScreen() {
  const folders = useFolders();
  const navigation = useNavigation<any>();
  const [view, setView] = useState(() => new Date());
  // 캘린더를 누르기 전에도 오늘 기록이 바로 보이도록, 기본 선택 날짜를 오늘로 둔다.
  const [selectedKey, setSelectedKey] = useState<string | null>(() => todayCellKey());

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

  /** 한 주(7일)씩 앞뒤로 옮긴다 — delta는 주 단위(-1 = 지난주, 1 = 다음주) */
  const changeWeek = (delta: number) => {
    setView((v) => {
      const d = new Date(v);
      d.setDate(d.getDate() + delta * 7);
      return d;
    });
    setSelectedKey(null);
  };

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 24 }}
      // 메모를 쓰는 중에도 접기 버튼·다른 날짜가 한 번에 눌리도록
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>기록</Text>
      <View style={{ height: 4 }} />
      <Text style={styles.subtitle}>그동안의 기록을 달력으로 확인하세요</Text>
      <View style={{ height: 16 }} />

      <CalendarCard
        view={view}
        entriesByDate={entriesByDate}
        selectedKey={selectedKey}
        onSelect={setSelectedKey}
        onChangeWeek={changeWeek}
      />

      <View style={{ height: 16 }} />
      {/* 이 탭에서 가장 자주 쓰는 길 — 지켜보는 자리별 추이를 보러 간다. 날짜를 골라야만 나오는
          그날의 분석 결과보다 먼저 두어, 스크롤하지 않아도 항상 바로 보인다. */}
      <ActionBox
        icon="timeline"
        title="경과 관찰"
        caption={folders.length ? `${folders.length}곳을 지켜보고 있어요` : '아직 지켜보는 자리가 없어요'}
        trailing="chevron-right"
        accent
        onPress={() => navigation.navigate('Monitoring')}
      />
      <View style={{ height: 10 }} />
      <ActionBox
        icon="accessibility-new"
        title="전신 결과"
        caption="전신 분석 결과 모아보기"
        trailing="chevron-right"
        onPress={() => navigation.navigate('WholeBody')}
      />

      {selectedKey != null && (
        <>
          <View style={{ height: 22 }} />
          {/* 날짜가 바뀌면 접힘 상태·메모 입력칸을 새로 세운다 */}
          <DetailSection key={selectedKey} dateKey={selectedKey} entries={entriesByDate[selectedKey]} />
        </>
      )}
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

/** date가 속한 주의 일요일 자정 — 달력을 한 주씩만 보여주는 기준점 */
function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - d.getDay());
  return d;
}

const fmtDot = (d: Date) => `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;

/**
 * 달력 카드 — 한 주(일~토) 7칸만 보여주고, 화살표로 이전/다음 주로 옮긴다.
 * 예전엔 한 달 전체(최대 6주)를 그려서 기록이 없는 달에도 카드가 크게 자리를 차지했는데,
 * 지금은 늘 7칸 한 줄이라 카드 높이가 고정되고 필요한 주만 오간다.
 */
function CalendarCard({
  view,
  entriesByDate,
  selectedKey,
  onSelect,
  onChangeWeek,
}: {
  /** 지금 보여줄 주에 속한 아무 날짜 하나(주의 시작으로 정규화해서 쓴다) */
  view: Date;
  entriesByDate: Record<string, FolderEntry[]>;
  selectedKey: string | null;
  onSelect: (k: string) => void;
  onChangeWeek: (d: number) => void;
}) {
  const today = new Date();
  const memoDates = useDatesWithMemos();
  const start = startOfWeek(view);
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    return day;
  });

  const cells = weekDays.map((day) => {
    const year = day.getFullYear();
    const month = day.getMonth();
    const d = day.getDate();
    const key = `${year}-${month + 1}-${d}`;
    const entries = entriesByDate[key];
    const hasMemo = memoDates.has(normalizeDateKey(key));
    const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
    const isSel = selectedKey === key;
    return (
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
          {/* 메모가 있는 날 — 아래 촬영 점과 헷갈리지 않도록 칸 오른쪽 위에 따로 표시한다 */}
          {hasMemo && (
            <MaterialIcons
              name="sticky-note-2"
              size={11}
              color={isSel ? '#3E6B12' : AppColors.sub}
              style={styles.memoMark}
            />
          )}
        </View>
      </Pressable>
    );
  });

  const end = weekDays[6];
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  const endLabel = sameMonth
    ? `${end.getDate()}`
    : sameYear
      ? `${end.getMonth() + 1}.${end.getDate()}`
      : fmtDot(end);
  const rangeLabel = `${fmtDot(start)} - ${endLabel}`;

  return (
    <View style={[cardDecoration(), styles.calendarCard]}>
      <View style={styles.calendarHeader}>
        <Text style={styles.rangeLabel}>{rangeLabel}</Text>
        <View style={{ flexDirection: 'row' }}>
          <NavBtn icon="chevron-left" onPress={() => onChangeWeek(-1)} />
          <View style={{ width: 6 }} />
          <NavBtn icon="chevron-right" onPress={() => onChangeWeek(1)} />
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

function DetailSection({
  dateKey,
  entries,
}: {
  dateKey: string;
  entries: FolderEntry[] | undefined;
}) {
  const list = entries ?? [];
  // 기록 하나하나의 접힘 상태. 기본은 펼침이고, 한 번 접으면 그 날짜를 보고 있는 동안 유지된다.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // "모두 접기" — 날짜 제목 줄은 그대로 두고, 그 아래 분석 결과 목록만 통째로 접었다 편다.
  // (예전엔 날짜 선택 자체를 풀어서 제목 줄까지 함께 사라졌는데, 그러면 다시 펼 방법이
  // 달력을 다시 누르는 것뿐이라 불편했다.)
  const [expanded, setExpanded] = useState(true);
  const idOf = (entry: FolderEntry, i: number) => `${entry.folder.id}:${entry.record.id ?? i}`;

  const [y, m, d] = dateKey.split('-').map(Number);
  const dateStr = `${y}.${m}.${d}`;

  return (
    <>
      <View style={styles.sectionHeader}>
        <Text style={styles.dateHeading}>
          {dateStr} 기록{list.length > 1 ? ` · ${list.length}건` : ''}
        </Text>
        <View style={{ flex: 1 }} />
        <Pressable style={styles.toggleAllBtn} onPress={() => setExpanded((v) => !v)} hitSlop={6}>
          <MaterialIcons name={expanded ? 'unfold-less' : 'unfold-more'} size={14} color={AppColors.sub} />
          <Text style={styles.toggleAllText}>{expanded ? '모두 접기' : '펼치기'}</Text>
        </Pressable>
      </View>

      {expanded && (
        <>
          <View style={{ height: 10 }} />
          {list.length === 0 ? (
            <View style={[cardDecoration(), { padding: 18, alignItems: 'center' }]}>
              <Text style={styles.noRecord}>이 날에는 촬영 기록이 없어요.</Text>
            </View>
          ) : (
            list.map((entry, i) => {
              const id = idOf(entry, i);
              return (
                <View key={id} style={i !== list.length - 1 ? { marginBottom: 12 } : undefined}>
                  <DetailCard
                    entry={entry}
                    collapsed={!!collapsed[id]}
                    onToggle={() => setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }))}
                  />
                </View>
              );
            })
          )}
        </>
      )}
    </>
  );
}

/**
 * 홈의 "최근 피부 상태" 카드와 같은 3개 지표(피부 종합 상태 · 가려움 · 수면 점수)를 보여준다 —
 * 사진/부위/병명만 이 폴더가 참조하는 모니터링 대상(MonitorTarget)에서 그대로 가져온다.
 */
function DetailCard({
  entry,
  collapsed,
  onToggle,
}: {
  entry: FolderEntry;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { folder, record } = entry;
  const { findTarget } = useMonitoring();
  const { healthConnected } = useProfile();
  const navigation = useNavigation<any>();
  const target = folder.targetId ? findTarget(folder.targetId) : undefined;
  const siteLabel: string | undefined = target ? plainSiteLabel(target.label) : undefined;
  const diseaseName: string = target?.diagnosis?.disease ?? plainSiteLabel(folder.name);

  const skinValue = DISPLAY_SCALE.iga(record.iga);
  const itchValue = DISPLAY_SCALE.itch(record.itchVas);
  const skin = skinConditionInfo(skinValue);
  const itch = itchBand(itchValue);
  const sleep = healthConnected ? sleepBand(record.sleepScore) : null;

  // 이 기록 한 건에 붙는 메모. label은 나중에 PDF에서 소제목으로 그대로 쓸 이름이다.
  const memoTarget: MemoTarget = {
    date: record.date,
    folderId: folder.id,
    recordId: String(record.id),
    label: [diseaseName, siteLabel].filter(Boolean).join(' · '),
  };
  const hasMemo = useHasMemo(memoTarget);

  return (
    <View style={[cardDecoration(), styles.detailCard, collapsed && styles.detailCardCollapsed]}>
      {/* 제목 줄 전체가 접기 버튼이다 — 접으면 병명·부위만 한 줄로 남는다 */}
      <Pressable style={{ flexDirection: 'row', alignItems: 'center' }} onPress={onToggle}>
        <Text style={styles.detailDate}>기록</Text>
        {collapsed && (
          <Text style={styles.detailPeek} numberOfLines={1}>
            {[diseaseName, siteLabel].filter(Boolean).join(' · ')}
          </Text>
        )}
        <View style={{ flex: 1 }} />
        {/* 접혀 있어도 메모가 달렸다는 건 보여 준다 */}
        {collapsed && hasMemo && (
          <MaterialIcons name="edit-note" size={16} color={AppColors.greenMuted} style={{ marginRight: 4 }} />
        )}
        <MaterialIcons name={collapsed ? 'expand-more' : 'expand-less'} size={20} color={AppColors.sub} />
      </Pressable>

      {!collapsed && (
        <Pressable
          onPress={() => navigation.navigate('MonitoringDetail', { folderId: folder.id, recordId: record.id })}
        >
          <View style={{ height: 10 }} />
          {/* 사진은 왼쪽에, 병명·상세결과 링크·세 지표는 그 옆 한 칸에 — 지표 세 칸을 박스로
              칠하지 않고 "|" 구분선만 세워 나눈다. 사진·부위 표시가 있는 왼쪽 칸의 세로 폭을
              넘지 않도록 이 칸도 라벨·점수·단계 세 줄로만 짧게 고정한다. */}
          <View style={{ flexDirection: 'row' }}>
            <View style={{ alignItems: 'center' }}>
              <LesionThumb
                photo={record.photo}
                areaPct={record.lesionAreaPct}
                seed={record.seed}
                mode="photo"
                size={64}
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
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={styles.detailDisease} numberOfLines={1}>
                  {diseaseName}
                </Text>
                <Text style={styles.detailLink}>상세 결과</Text>
                <MaterialIcons name="chevron-right" size={16} color={AppColors.sub} />
              </View>
              <View style={{ height: 8 }} />
              <View style={styles.statCols}>
                <StatCol label="피부 종합 상태" value={Math.round(skinValue)} band={skin} />
                <View style={styles.statColDivider} />
                <StatCol label="가려움 안정도" value={itchValue} band={itch} />
                <View style={styles.statColDivider} />
                <StatCol label="수면 점수" value={sleep ? record.sleepScore : '-'} band={sleep} />
              </View>
            </View>
          </View>
        </Pressable>
      )}

      {/* 상세 결과로 넘어가는 Pressable 밖에 둔다 — 메모를 누르면 화면이 넘어가면 안 된다 */}
      {!collapsed && (
        <MemoBlock target={memoTarget} placeholder="이 기록에 대해 남길 말 (긁은 정도, 바른 약 등)" />
      )}
    </View>
  );
}

/** 지표 세 칸 중 하나 — 박스로 칠하지 않고 라벨·점수·단계 세 줄만 쌓는다 (사이 구분은 세로선) */
function StatCol({
  label,
  value,
  band,
}: {
  label: string;
  value: number | string;
  band: { ko: string; color: string } | null;
}) {
  return (
    <View style={styles.statCol}>
      <Text style={styles.statColLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.statColValue}>{value}</Text>
      <View style={[styles.statColBadge, { backgroundColor: band?.color ?? AppColors.sub }]}>
        <Text style={styles.statColBandText} numberOfLines={1}>
          {band?.ko ?? '미기재'}
        </Text>
      </View>
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
  rangeLabel: { fontSize: 16, fontWeight: '800', color: AppColors.ink },
  navBtn: { width: 30, height: 30, borderRadius: 9, backgroundColor: '#F1F3F6', alignItems: 'center', justifyContent: 'center' },
  weekdayCell: { flex: 1, alignItems: 'center' },
  weekdayText: { fontSize: 12, fontWeight: '600', color: AppColors.sub },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, padding: 2 },
  cellInner: { flex: 1, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  dotsRow: { position: 'absolute', bottom: 6, flexDirection: 'row' },
  dot: { width: 5, height: 5, borderRadius: 2.5, marginHorizontal: 1 },
  memoMark: { position: 'absolute', top: 3, right: 4 },
  noRecord: { fontSize: 14, color: AppColors.sub },

  sectionHeader: { flexDirection: 'row', alignItems: 'center' },
  dateHeading: { fontSize: 13, fontWeight: '700', color: AppColors.ink },
  toggleAllBtn: { flexDirection: 'row', alignItems: 'center' },
  toggleAllText: { fontSize: 12, fontWeight: '700', color: AppColors.sub, marginLeft: 2 },

  detailCard: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 18 },
  detailCardCollapsed: { paddingTop: 13, paddingBottom: 13 },
  detailDate: { fontSize: 13, fontWeight: '600', color: AppColors.sub },
  detailPeek: { flexShrink: 1, fontSize: 13, fontWeight: '700', color: AppColors.ink, marginLeft: 8 },
  detailLink: { fontSize: 12, fontWeight: '700', color: AppColors.sub },
  regionPill: { backgroundColor: '#F1F3F6', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  regionPillText: { fontSize: 10.5, fontWeight: '700', color: AppColors.sub },
  detailDisease: { flexShrink: 1, fontSize: 15, fontWeight: '800', color: AppColors.ink, marginRight: 8 },

  statCols: { flexDirection: 'row', alignItems: 'stretch' },
  statCol: { flex: 1, alignItems: 'center' },
  statColDivider: { width: 1, backgroundColor: AppColors.line, marginHorizontal: 6 },
  statColLabel: { fontSize: 9.5, fontWeight: '600', color: AppColors.sub },
  statColValue: { fontSize: 15, fontWeight: '800', color: AppColors.ink, marginTop: 2 },
  statColBadge: { borderRadius: 7, paddingHorizontal: 6, paddingVertical: 2, marginTop: 3, maxWidth: '100%' },
  statColBandText: { fontSize: 9.5, fontWeight: '800', color: '#FFFFFF' },
});
