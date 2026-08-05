/**
 * 하단 탭 바 — 참고 디자인(GitHub KTaek/Skincare_app)의 BottomNav.tsx를 옮겨온 것.
 * 원본은 5개 탭(홈·기록·카메라·루틴·병원)이지만, 이 앱은 홈과 모니터링 기능만 있어 2개 탭만 둔다.
 * "기록"(캘린더) 탭 자리는 우리 모니터링 폴더 목록 화면으로 바로 연결된다.
 * 최상위 탭 화면(홈 · 모니터링 폴더 목록)에만 붙이고, 그 아래로 들어간 화면(폴더 상세 · 기록 상세)에는
 * 붙이지 않는다 — 일반적인 모바일 앱처럼 눌러 들어간 화면에서는 하단 탭이 사라지는 편이 자연스럽다.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { monitoringColors as mc } from '../styles/theme';

const TABS = [
  { key: 'home', label: '홈', icon: '🏠', screen: 'Home' },
  { key: 'monitoring', label: '모니터링', icon: '📈', screen: 'Monitoring' },
];

export default function BottomNav({ active, navigation }) {
  return (
    <View style={styles.container}>
      {TABS.map((tab) => {
        const focused = active === tab.key;
        return (
          <TouchableOpacity
            key={tab.key}
            style={styles.item}
            onPress={() => navigation.navigate(tab.screen)}
          >
            <Text style={{ fontSize: 22 }}>{tab.icon}</Text>
            <Text style={[styles.label, focused && styles.labelActive]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row', backgroundColor: mc.card,
    borderTopWidth: 1, borderTopColor: mc.line,
    paddingTop: 8, paddingBottom: 8,
  },
  item: { flex: 1, alignItems: 'center', gap: 2 },
  label: { fontSize: 10.5, color: mc.sub, fontWeight: '600' },
  labelActive: { color: mc.greenDeep, fontWeight: '800' },
});
