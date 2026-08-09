import React from 'react';
import { StyleSheet, Text, View, Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { AppColors } from '../theme';
import { useLeaveGuard } from '../context/LeaveGuardContext';

type IconName = React.ComponentProps<typeof MaterialIcons>['name'];

// 라우트 이름 → (아이콘, 라벨)
const TABS: Record<string, { icon: IconName; label: string }> = {
  Home: { icon: 'home', label: '홈' },
  Camera: { icon: 'photo-camera', label: '피부 촬영' },
  Records: { icon: 'calendar-today', label: '기록' },
  Routine: { icon: 'checklist', label: '루틴' },
  Profile: { icon: 'person', label: '마이페이지' },
};

export default function BottomNav({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { guardedAction } = useLeaveGuard();
  return (
    <View style={[styles.container, { paddingBottom: 8 + insets.bottom }]}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const tab = TABS[route.name];
        if (!tab) return null;

        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) {
            guardedAction(() => navigation.navigate(route.name));
          }
        };

        return (
          <Pressable key={route.key} style={styles.item} onPress={onPress} hitSlop={4}>
            <MaterialIcons
              name={tab.icon}
              size={24}
              color={focused ? AppColors.greenTop : AppColors.navInactive}
            />
            <View style={{ height: 3 }} />
            <Text style={[styles.label, { color: focused ? AppColors.greenMuted : AppColors.navInactive }]}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#EEEEEE',
    paddingHorizontal: 6,
    paddingTop: 8,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 10.5, fontWeight: '600' },
});
