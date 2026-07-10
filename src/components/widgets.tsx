import React from 'react';
import { Text, View, Pressable, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { AppColors } from '../theme';
import { Routine, sevOf } from '../models';

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

/** 루틴 한 줄의 내용 (체크 + 이름 + 시각 + 선택적 삭제) — 테두리/패딩 없이 내용만 */
export function RoutineRowContent({
  routine,
  onToggle,
  onDelete,
}: {
  routine: Routine;
  onToggle?: () => void;
  onDelete?: () => void;
}) {
  return (
    <View style={styles.row}>
      <Pressable
        onPress={onToggle}
        style={[
          styles.checkbox,
          {
            backgroundColor: routine.done ? AppColors.greenTop : 'transparent',
            borderColor: routine.done ? AppColors.greenTop : '#DADDE2',
          },
        ]}
      >
        {routine.done && <MaterialIcons name="check" size={14} color="#FFFFFF" />}
      </Pressable>
      <View style={{ width: 13 }} />
      <Text
        style={[
          styles.routineName,
          {
            color: routine.done ? AppColors.sub : AppColors.ink,
            textDecorationLine: routine.done ? 'line-through' : 'none',
          },
        ]}
        numberOfLines={1}
      >
        {routine.name}
      </Text>
      <Text style={styles.routineTime}>{routine.time}</Text>
      {onDelete && (
        <Pressable onPress={onDelete} style={{ paddingLeft: 8 }}>
          <MaterialIcons name="close" size={18} color="#C7CBD1" />
        </Pressable>
      )}
    </View>
  );
}

/** 루틴 한 줄 (테두리 + 패딩 + 내용) */
export function RoutineRow({
  routine,
  onToggle,
  onDelete,
  last = false,
}: {
  routine: Routine;
  onToggle?: () => void;
  onDelete?: () => void;
  last?: boolean;
}) {
  return (
    <View
      style={[
        styles.routineRow,
        !last && { borderBottomWidth: 1, borderBottomColor: AppColors.line },
      ]}
    >
      <RoutineRowContent routine={routine} onToggle={onToggle} onDelete={onDelete} />
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
  routineRow: { paddingVertical: 15 },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 8 },
  badgeText: { fontSize: 12, fontWeight: '700', color: '#FFFFFF' },
});
