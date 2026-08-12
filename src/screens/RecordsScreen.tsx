import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import Svg, { Rect } from 'react-native-svg';
import { useNavigation } from '@react-navigation/native';
import { AppColors, cardDecoration } from '../theme';
import { plainSiteLabel } from '../models';
import { useFolders, folderHasSeverity } from '../folders/store';
import { DISPLAY_SCALE, skinConditionInfo, itchBand, sleepBand } from '../folders/theme';
import LesionThumb from '../folders/components/LesionThumb';
import { useMonitoring } from '../context/MonitoringContext';
import { useProfile } from '../context/ProfileContext';
import MemoBlock from '../records/MemoBlock';
import DayItchCard from '../records/DayItchCard';
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

export default function RecordsScreen({ route }: { route?: any }) {
  const folders = useFolders();
  const navigation = useNavigation<any>();
  /*
    루틴에서 "가려움증 문진하기"로 넘어오면 오늘의 가려움 칸을 펼치고 거기까지 스크롤한다 —
    기록 탭 첫 화면에 내려놓기만 하면 여전히 사용자가 카드를 찾아 눌러야 한다.

    파라미터는 **읽자마자 지운다.** 안 지우면 이 탭으로 돌아올 때마다 카드가 다시 열려서,
    사용자가 접어 둔 것을 앱이 계속 되돌린다.
  */
  const focusItch = route?.params?.focus === 'itch';
  const [view, setView] = useState(() => new Date());
  // 캘린더를 누르기 전에도 오늘 기록이 바로 보이도록, 기본 선택 날짜를 오늘로 둔다.
  const [selectedKey, setSelectedKey] = useState<string | null>(() => todayCellKey());
  const scrollRef = useRef<ScrollView>(null);
  /** 가려움 카드가 화면 어디쯤에 있는지 — 넘어왔을 때 거기까지 데려다주려고 재 둔다 */
  const itchCardY = useRef(0);
  const [itchOpenToken, setItchOpenToken] = useState(0);

  useEffect(() => {
    if (!focusItch) return;
    navigation.setParams({ focus: undefined });
    /*
      루틴에서 눌러 온 줄은 **오늘 줄**이다. 지난 주를 들춰보다 넘어왔더라도 그날 칸을 열어 주면
      엉뚱한 날짜에 오늘의 가려움을 적게 되므로, 달력을 오늘로 되돌리고 나서 카드를 펼친다.
    */
    setView(new Date());
    setSelectedKey(todayCellKey());
    setItchOpenToken((n) => n + 1);
  }, [focusItch, navigation]);

  // 펼치기만 하면 화면 밖에 있을 수 있다 — 달력 아래라 첫 화면에서 잘리는 위치다
  useEffect(() => {
    if (itchOpenToken === 0) return;
    const timer = setTimeout(
      () => scrollRef.current?.scrollTo({ y: Math.max(0, itchCardY.current - 12), animated: true }),
      60, // 카드가 펼쳐져 자리를 잡은 뒤에 옮긴다
    );
    return () => clearTimeout(timer);
  }, [itchOpenToken]);

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

  /** 달력이 "이번 달 전체보기"일 때 화살표가 한 달씩 옮긴다 */
  const changeMonth = (delta: number) => {
    setView((v) => {
      const d = new Date(v);
      d.setMonth(d.getMonth() + delta);
      return d;
    });
    setSelectedKey(null);
  };

  return (
    <ScrollView
      ref={scrollRef}
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
        onChangeMonth={changeMonth}
      />

      <View style={{ height: 16 }} />
      {/* 촬영 흐름에 있던 가려움 문진이 여기로 왔다 — 하루에 한 번 적으면 그날 촬영한 기록에
          전부 적용된다(records/itchStore). 달력 바로 밑이 자리인 이유는 "그날 무엇을 남겼나"를
          보는 흐름의 첫 칸이 이 값이기 때문이다. 날짜를 아직 고르지 않았으면 오늘을 받는다. */}
      {/* 날짜가 바뀌면 편집 중이던 값이 남지 않도록 카드를 새로 세운다 */}
      <View onLayout={(e) => (itchCardY.current = e.nativeEvent.layout.y)}>
        <DayItchCard
          key={selectedKey ?? 'today'}
          dateKey={selectedKey ?? todayCellKey()}
          openToken={itchOpenToken}
        />
      </View>

      <View style={{ height: 10 }} />
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
        accent
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
 * 달력 카드 — 기본은 한 주(일~토) 7칸만 보여주고, 화살표로 이전/다음 주로 옮긴다.
 * 헤더의 토글 버튼을 누르면 그 달 전체(5~6주)로 펼쳐지고, 다시 누르면 원래의 한 줄짜리
 * 주간 보기로 돌아온다 — 두 모드 모두 같은 anchor 날짜(view)를 공유해서 전환해도
 * 보고 있던 시점을 잃지 않는다.
 */
function CalendarCard({
  view,
  entriesByDate,
  selectedKey,
  onSelect,
  onChangeWeek,
  onChangeMonth,
}: {
  /** 지금 보여줄 주(또는 달)에 속한 아무 날짜 하나 */
  view: Date;
  entriesByDate: Record<string, FolderEntry[]>;
  selectedKey: string | null;
  onSelect: (k: string) => void;
  onChangeWeek: (d: number) => void;
  onChangeMonth: (d: number) => void;
}) {
  const today = new Date();
  const memoDates = useDatesWithMemos();
  const [monthMode, setMonthMode] = useState(false);

  const monthStart = new Date(view.getFullYear(), view.getMonth(), 1);
  const start = monthMode ? startOfWeek(monthStart) : startOfWeek(view);
  // 월간 보기는 그 달의 1일이 속한 주부터, 말일이 속한 주까지 — 항상 7의 배수(보통 5~6주)
  const numDays = monthMode
    ? Math.ceil((monthStart.getDay() + new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate()) / 7) * 7
    : 7;
  const gridDays = Array.from({ length: numDays }, (_, i) => {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    return day;
  });

  const cells = gridDays.map((day) => {
    const year = day.getFullYear();
    const month = day.getMonth();
    const d = day.getDate();
    const key = `${year}-${month + 1}-${d}`;
    const entries = entriesByDate[key];
    const hasMemo = memoDates.has(normalizeDateKey(key));
    const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
    const isSel = selectedKey === key;
    // 월간 보기에서 앞뒤 달에 걸친 칸은 흐리게 — 날짜는 눌러도 정상 동작하지만 이번 달이 아님을 알려준다
    const inCurrentMonth = !monthMode || month === view.getMonth();
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
              color: isSel ? '#143006' : inCurrentMonth ? AppColors.ink : AppColors.navInactive,
            }}
          >
            {d}
          </Text>
          {/* 그날 찍은 검사 건수 — 예전엔 지표 세 개를 점으로 찍었는데, 상세 카드가 이미
              같은 정보를 더 정확히 보여주므로 달력 칸에는 "몇 건 찍었나"만 남긴다. 이 슬롯은
              건수가 없는 날에도 항상 자리를 차지해야 날짜 숫자가 칸마다 같은 높이에 온다. */}
          <View style={styles.dayCountSlot}>
            {entries && entries.length > 0 && (
              <View style={[styles.dayCountPill, isSel && styles.dayCountPillSelected]}>
                <Text style={[styles.dayCountText, isSel && styles.dayCountTextSelected]}>
                  {entries.length}건
                </Text>
              </View>
            )}
          </View>
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

  const rangeLabel = monthMode
    ? `${view.getFullYear()}.${view.getMonth() + 1}`
    : (() => {
        const end = gridDays[6];
        const sameYear = start.getFullYear() === end.getFullYear();
        const sameMonth = sameYear && start.getMonth() === end.getMonth();
        const endLabel = sameMonth
          ? `${end.getDate()}`
          : sameYear
            ? `${end.getMonth() + 1}.${end.getDate()}`
            : fmtDot(end);
        return `${fmtDot(start)} - ${endLabel}`;
      })();

  return (
    <View style={[cardDecoration(), styles.calendarCard]}>
      <View style={styles.calendarHeader}>
        <Text style={styles.rangeLabel}>{rangeLabel}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {/* 주간 ↔ 월간 전환 — 켜져 있을 때 초록으로 채워서 지금 어느 모드인지 바로 보이게 */}
          <Pressable
            style={[styles.viewToggleBtn, monthMode && styles.viewToggleBtnActive]}
            onPress={() => setMonthMode((v) => !v)}
            hitSlop={4}
          >
            <CalendarMonthIcon color={monthMode ? '#143006' : '#555555'} size={25} />
          </Pressable>
          <View style={{ width: 8 }} />
          <NavBtn icon="chevron-left" onPress={() => (monthMode ? onChangeMonth(-1) : onChangeWeek(-1))} />
          <View style={{ width: 6 }} />
          <NavBtn icon="chevron-right" onPress={() => (monthMode ? onChangeMonth(1) : onChangeWeek(1))} />
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

/**
 * 스프링 링·접힌 모서리가 있는 탁상달력 모양 안에 숫자를 박아 넣은 아이콘 — 주간/월간
 * 전환 버튼에 쓴다. 숫자는 지금 보고 있는 주가 아니라 실제 오늘 날짜의 달(예: 8월 → "08")로,
 * 달력 앱 아이콘처럼 매달 자동으로 바뀐다.
 */
function CalendarMonthIcon({ color, size = 18 }: { color: string; size?: number }) {
  const month = String(new Date().getMonth() + 1).padStart(2, '0');
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 24 24" style={StyleSheet.absoluteFill}>
        {[5.6, 9.87, 14.13, 18.4].map((x, i) => (
          <Rect key={i} x={x - 0.9} y={1.5} width={1.8} height={5} rx={0.9} fill={color} />
        ))}
        <Rect x={3} y={5} width={18} height={17} rx={3.5} stroke={color} strokeWidth={1.3} fill="none" />
      </Svg>
      <View
        style={{
          position: 'absolute',
          top: size * 0.21,
          left: 0,
          right: 0,
          bottom: size * 0.08,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: size * 0.4, fontWeight: '800', color }}>{month}</Text>
      </View>
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
 * 홈의 "최근 피부 상태" 카드와 같은 지표(피부 종합 상태 · 가려움 · 수면 점수)를 보여준다 —
 * 사진/부위/병명만 이 폴더가 참조하는 모니터링 대상(MonitorTarget)에서 그대로 가져온다.
 * 피부 종합 상태 칸은 질환에 관계없이 늘 있고, 등급(IGA)은 아토피일 때만 배지로 붙는다.
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
  // 사진 밑에 따로 붙던 부위 배지를 없애는 대신, 병명 앞에 부위를 붙여 "몸통 아토피피부염"처럼 한 줄로 보여준다
  const displayDiseaseName = [siteLabel, diseaseName].filter(Boolean).join(' ');
  // 4가지 증상·IGA 모델은 아토피피부염 채점 기준이라, 이 폴더의 진단명이 그게 아니면 값 자체가 없다
  const hasSeverity = folderHasSeverity(folder);

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

  const goDetail = () => navigation.navigate('MonitoringDetail', { folderId: folder.id, recordId: record.id });

  return (
    <View style={[cardDecoration(), styles.detailCard, collapsed && styles.detailCardCollapsed]}>
      {/* 병명 줄 — 접혀 있든 펼쳐 있든 늘 보인다. "상세 결과"까지는 상세 페이지로 가는 링크라
          접기 버튼(화살표)과 탭 영역을 따로 둔다 — 한 Pressable로 묶으면 이름을 눌러도 접힌다. */}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Pressable style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }} onPress={goDetail}>
          <Text style={styles.detailDisease} numberOfLines={1}>
            {displayDiseaseName}
          </Text>
          <Text style={styles.detailLink}>상세 결과</Text>
          <MaterialIcons name="chevron-right" size={16} color={AppColors.sub} />
        </Pressable>
        <View style={{ flex: 1 }} />
        {/* 접혀 있어도 메모가 달렸다는 건 보여 준다 */}
        {collapsed && hasMemo && (
          <MaterialIcons name="edit-note" size={16} color={AppColors.greenMuted} style={{ marginRight: 4 }} />
        )}
        <Pressable onPress={onToggle} hitSlop={8}>
          <MaterialIcons name={collapsed ? 'expand-more' : 'expand-less'} size={20} color={AppColors.sub} />
        </Pressable>
      </View>

      {!collapsed && (
        <Pressable onPress={goDetail}>
          <View style={{ height: 10 }} />
          {/* 사진은 왼쪽에, 세 지표는 그 옆 한 칸에 — 병명 줄이 위로 빠지면서 사진과 지표 표가
              같은 줄에서 나란히 정렬된다. 지표 세 칸은 박스로 칠하지 않고 "|" 구분선만 세운다. */}
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <LesionThumb photo={record.photo} mode="photo" size={64} style={undefined} />
            <View style={{ width: 12 }} />
            {/*
              첫 칸은 어느 질환이든 **질환명**을 적고, 등급은 매길 수 있을 때만 배지로 덧붙인다.

              아토피는 IGA 4단계가 있으니 "아토피피부염 + 그 단계"까지 보여주고, 등급 자체가
              없는 질환은 이름만 남긴다 — "등급 없음"이라 적어 봤더니 세 칸 중 한 칸만 다른
              말을 해서 오히려 눈이 그리로 끌렸다. 없는 것을 굳이 가리키는 셈이었다.
              (band를 넘기지 않으면 배지 줄 자체가 빠진다.)
            */}
            <View style={[styles.statCols, { flex: 1 }]}>
              {/* 홈 화면과 같은 형태(점수 + 중증도)로 맞춘다. IGA 채점은 아토피피부염 기준이라
                  다른 질환은 매길 점수가 없어 "준비중"으로 대신한다. */}
              <StatCol
                label="피부 종합 상태"
                value={hasSeverity ? skinValue : '준비중'}
                band={hasSeverity ? skin : undefined}
              />
              <View style={styles.statColDivider} />
              <StatCol label="가려움 안정도" value={itchValue} band={itch} />
              <View style={styles.statColDivider} />
              <StatCol label="수면 점수" value={sleep ? record.sleepScore : '-'} band={sleep} />
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
  /**
   * 단계 배지. **넘기지 않으면 배지 줄을 아예 그리지 않는다** — null은 "잴 수 있는데 값이
   * 없다"(수면 미연동의 "미기재")를 뜻하므로 "애초에 배지가 없는 칸"과 구분해야 한다.
   */
  band?: { ko: string; color: string } | null;
}) {
  const isText = typeof value === 'string' && Number.isNaN(Number(value));
  return (
    <View style={styles.statCol}>
      <Text style={styles.statColLabel} numberOfLines={1}>
        {label}
      </Text>
      {/* 값 자리에 점수 대신 질환명이 올 수 있다 — 숫자용 크기 그대로면 칸을 넘긴다.
          줄 높이는 고정한다: 글씨가 작아진 칸만 낮아지면 그 아래 배지가 옆 칸보다 위로 붙는다 */}
      <View style={styles.statColValueSlot}>
        <Text
          style={[styles.statColValue, isText && styles.statColValueText]}
          numberOfLines={1}
          adjustsFontSizeToFit={isText}
          minimumFontScale={0.6}
        >
          {value}
        </Text>
      </View>
      {band !== undefined && (
        <View style={[styles.statColBadge, { backgroundColor: band?.color ?? AppColors.sub }]}>
          <Text style={styles.statColBandText} numberOfLines={1}>
            {band?.ko ?? '미기재'}
          </Text>
        </View>
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
  rangeLabel: { fontSize: 16, fontWeight: '800', color: AppColors.ink },
  navBtn: { width: 30, height: 30, borderRadius: 9, backgroundColor: '#F1F3F6', alignItems: 'center', justifyContent: 'center' },
  viewToggleBtn: { width: 30, height: 30, borderRadius: 9, backgroundColor: '#F1F3F6', alignItems: 'center', justifyContent: 'center' },
  viewToggleBtnActive: { backgroundColor: AppColors.greenTop },
  weekdayCell: { flex: 1, alignItems: 'center' },
  weekdayText: { fontSize: 12, fontWeight: '600', color: AppColors.sub },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, padding: 2 },
  cellInner: { flex: 1, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  /** 건수 배지가 있든 없든 항상 같은 높이를 차지해 — 날짜 숫자가 칸마다 같은 자리에 오도록 */
  dayCountSlot: { height: 17, marginTop: 2, alignItems: 'center', justifyContent: 'flex-start' },
  dayCountPill: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 6,
    backgroundColor: '#E7F2DC',
  },
  dayCountPillSelected: { backgroundColor: 'rgba(20,48,6,0.16)' },
  dayCountText: { fontSize: 9, fontWeight: '700', color: AppColors.greenMuted },
  dayCountTextSelected: { color: '#143006' },
  memoMark: { position: 'absolute', top: 3, right: 4 },
  noRecord: { fontSize: 14, color: AppColors.sub },

  sectionHeader: { flexDirection: 'row', alignItems: 'center' },
  dateHeading: { fontSize: 13, fontWeight: '700', color: AppColors.ink },
  toggleAllBtn: { flexDirection: 'row', alignItems: 'center' },
  toggleAllText: { fontSize: 12, fontWeight: '700', color: AppColors.sub, marginLeft: 2 },

  detailCard: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 18 },
  detailCardCollapsed: { paddingTop: 13, paddingBottom: 13 },
  detailLink: { fontSize: 12, fontWeight: '700', color: AppColors.sub },
  detailDisease: { flexShrink: 1, fontSize: 15, fontWeight: '800', color: AppColors.ink, marginRight: 8 },

  statCols: { flexDirection: 'row', alignItems: 'stretch' },
  statCol: { flex: 1, alignItems: 'center' },
  statColDivider: { width: 1, backgroundColor: AppColors.line, marginHorizontal: 6 },
  statColLabel: { fontSize: 9.5, fontWeight: '600', color: AppColors.sub },
  /** 15pt 글씨 한 줄 높이 — 값이 숫자든 질환명이든 이 높이로 고정한다 (배지 줄 맞춤) */
  statColValueSlot: { height: 19, width: '100%', justifyContent: 'center', marginTop: 2 },
  statColValue: { fontSize: 15, fontWeight: '800', color: AppColors.ink, textAlign: 'center' },
  /** 값 자리에 질환명이 올 때 — 세 칸으로 나눈 좁은 폭이라 숫자보다는 줄인다 */
  statColValueText: { fontSize: 13 },
  statColBadge: { borderRadius: 7, paddingHorizontal: 6, paddingVertical: 2, marginTop: 3, maxWidth: '100%' },
  statColBandText: { fontSize: 9.5, fontWeight: '800', color: '#FFFFFF' },
});
