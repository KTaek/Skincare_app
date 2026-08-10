import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { monitoringColors as mc, monitoringCard } from '../folders/theme';
import { cycleLabel } from '../models';
import { useRoutines } from '../context/RoutineContext';

/**
 * 상세 결과 화면의 "사용한 제품" — 루틴 탭의 <사용 제품> 목록과 연동된다.
 *
 * 그 날짜에 쓰기로 되어 있던 제품(사용 주기 반영) 중 실제로 체크한 것을 보여준다. 아직
 * 아무것도 체크하지 않은 날은 그날 예정이던 제품을 그대로 보여준다 — 이 검사 결과가 어떤 제품을
 * 쓰던 중에 나온 값인지가 추이를 해석하는 데 필요한 맥락이기 때문이다.
 */
export default function UsedProductsCard({ date }: { date: Date }) {
  const { productsUsedOn } = useRoutines();
  const used = productsUsedOn(date);

  return (
    <View style={[monitoringCard(), styles.card]}>
      <Text style={styles.cardLabel}>사용한 제품</Text>
      {used.length === 0 ? (
        <Text style={styles.empty}>이 날 사용한 제품이 없어요.</Text>
      ) : (
        <View style={styles.chips}>
          {used.map((p) => (
            <View key={p.key} style={styles.chip}>
              <MaterialIcons name="medication" size={14} color={mc.greenMuted} />
              <Text style={styles.chipText}>{p.name}</Text>
              <Text style={styles.chipMeta}>
                {p.time ?? (p.occurrenceCount > 1 ? `${p.occurrenceIndex + 1}회` : '시각 미정')}
                {(p.cycleDays ?? 1) > 1 ? ` · ${cycleLabel(p.cycleDays ?? 1)}` : ''}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16 },
  cardLabel: { fontSize: 17, fontWeight: '800', color: mc.ink, marginBottom: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 12,
    backgroundColor: mc.bg,
    borderWidth: 1,
    borderColor: mc.line,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  chipText: { fontSize: 13.5, fontWeight: '800', color: mc.ink },
  chipMeta: { fontSize: 11, fontWeight: '700', color: mc.sub },
  empty: { fontSize: 13, color: mc.sub },
});
