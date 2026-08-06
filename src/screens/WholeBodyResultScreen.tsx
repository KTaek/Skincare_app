import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { AppColors } from '../theme';

/** 전신 결과 — 추후 채워질 예정. 지금은 빈 자리만 잡아둔다 */
export default function WholeBodyResultScreen() {
  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 24, flexGrow: 1 }}
    >
      <Text style={styles.title}>전신 결과</Text>
      <View style={{ height: 4 }} />
      <Text style={styles.subtitle}>전신 분석 결과가 이곳에 표시될 예정이에요</Text>

      <View style={styles.emptyWrap}>
        <MaterialIcons name="accessibility-new" size={40} color={AppColors.sub} />
        <View style={{ height: 10 }} />
        <Text style={styles.emptyText}>준비 중입니다</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '800', color: AppColors.ink },
  subtitle: { fontSize: 13.5, color: AppColors.sub },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 80 },
  emptyText: { fontSize: 14, color: AppColors.sub },
});
