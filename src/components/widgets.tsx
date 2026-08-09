import React from 'react';
import { Text, View, Pressable, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { AppColors } from '../theme';
import { CareItem, cycleLabel, sevOf } from '../models';

/** "루틴 >" 처럼 제목 + 원형 화살표 버튼 */
export function SectionHeader({ title, onMore }: { title: string; onMore?: () => void }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {onMore && (
        <Pressable onPress={onMore} style={styles.moreBtn}>
          <MaterialIcons name="chevron-right" size={18} color="#333333" />
        </Pressable>
      )}
    </View>
  );
}

/**
 * 케어 한 줄의 내용 (체크 + 이름 + 시각 + 선택적 삭제) — 테두리/패딩 없이 내용만.
 * 제품은 이름 앞에 알약 아이콘을, 매일이 아니면 주기 배지("격일")를 함께 단다.
 */
export function RoutineRowContent({
  item,
  onToggle,
  onDelete,
}: {
  item: CareItem;
  onToggle?: () => void;
  onDelete?: () => void;
}) {
  const isProduct = item.kind === 'product';
  const showCycle = isProduct && (item.cycleDays ?? 1) > 1;
  return (
    <View style={styles.row}>
      <Pressable
        onPress={onToggle}
        style={[
          styles.checkbox,
          {
            backgroundColor: item.done ? AppColors.greenTop : 'transparent',
            borderColor: item.done ? AppColors.greenTop : '#DADDE2',
          },
        ]}
      >
        {item.done && <MaterialIcons name="check" size={14} color="#FFFFFF" />}
      </Pressable>
      <View style={{ width: 11 }} />
      {isProduct && (
        <MaterialIcons name="medication" size={16} color={AppColors.greenMuted} style={{ marginRight: 5 }} />
      )}
      <Text
        style={[
          styles.routineName,
          {
            color: item.done ? AppColors.sub : AppColors.ink,
            textDecorationLine: item.done ? 'line-through' : 'none',
          },
        ]}
        numberOfLines={1}
      >
        {item.name}
      </Text>
      {showCycle && (
        <View style={styles.cyclePill}>
          <Text style={styles.cyclePillText}>{cycleLabel(item.cycleDays ?? 1)}</Text>
        </View>
      )}
      {item.push && (
        <MaterialIcons name="notifications-active" size={14} color="#C0C4CB" style={{ marginRight: 6 }} />
      )}
      <Text style={styles.routineTime}>{item.time}</Text>
      {onDelete && (
        <Pressable onPress={onDelete} style={{ paddingLeft: 8 }} hitSlop={6}>
          <MaterialIcons name="close" size={18} color="#C7CBD1" />
        </Pressable>
      )}
    </View>
  );
}

/** 케어 한 줄 (구분선 + 패딩 + 내용) */
export function RoutineRow({
  item,
  onToggle,
  onDelete,
  last = false,
}: {
  item: CareItem;
  onToggle?: () => void;
  onDelete?: () => void;
  last?: boolean;
}) {
  return (
    <View
      style={[
        styles.routineRow,
        !last && { borderBottomWidth: 1, borderBottomColor: AppColors.line },
        // 오늘 쓰는 날이 아닌 제품은 흐리게 — 목록에서 사라지면 관리할 수가 없어 남겨는 둔다
        !item.due && { opacity: 0.45 },
      ]}
    >
      <RoutineRowContent item={item} onToggle={onToggle} onDelete={onDelete} />
    </View>
  );
}

/** 중증도 배지 (예: "중증도 2단계 · 중등증") */
export function SevBadge({ sev, prefix }: { sev: number; prefix?: string }) {
  const s = sevOf(sev);
  const text = prefix == null ? s.stage : `${prefix} ${s.stage} · ${s.label}`;
  return (
    <View style={[styles.badge, { backgroundColor: s.color }]}>
      <Text style={styles.badgeText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 2,
    paddingTop: 24,
    paddingBottom: 12,
  },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: AppColors.ink },
  moreBtn: {
    width: 26,
    height: 26,
    marginLeft: 8,
    borderRadius: 13,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  routineName: { flex: 1, fontSize: 15, fontWeight: '600' },
  routineTime: { fontSize: 15, fontWeight: '700', color: AppColors.ink },
  cyclePill: {
    backgroundColor: '#EFF5E4',
    borderRadius: 7,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginRight: 8,
  },
  cyclePillText: { fontSize: 10.5, fontWeight: '800', color: AppColors.greenMuted },
  routineRow: { paddingVertical: 15 },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 8 },
  badgeText: { fontSize: 12, fontWeight: '700', color: '#FFFFFF' },
});
