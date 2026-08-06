import React from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AppColors } from '../theme';
import BottomNav from './BottomNav';
import HomeScreen from '../screens/HomeScreen';
import RecordsScreen from '../screens/RecordsScreen';
import CameraScreen from '../screens/CameraScreen';
import WholeBodyResultScreen from '../screens/WholeBodyResultScreen';
import HospitalScreen from '../screens/HospitalScreen';
import RoutineScreen from '../screens/RoutineScreen';
import MonitoringScreen from '../folders/screens/MonitoringScreen';
import MonitoringFolderScreen from '../folders/screens/MonitoringFolderScreen';
import MonitoringDetailScreen from '../folders/screens/MonitoringDetailScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

/** 카메라를 제외한 화면은 상단 세이프 에어리어 패딩을 준다 (카메라는 전체 화면을 써야 한다) */
function withTopInset<P extends object>(Component: React.ComponentType<P>) {
  return function Wrapped(props: P) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: AppColors.bg }} edges={['top']}>
        <Component {...props} />
      </SafeAreaView>
    );
  };
}

const HomeWrapped = withTopInset(HomeScreen);
const RecordsWrapped = withTopInset(RecordsScreen);
const WholeBodyResultWrapped = withTopInset(WholeBodyResultScreen);
const HospitalWrapped = withTopInset(HospitalScreen);

/** 하단 바가 붙어 있는 5개 탭 — 앱의 기본 화면 */
function Tabs() {
  return (
    <Tab.Navigator
      // 모든 탭을 처음부터 마운트 (Flutter IndexedStack 동작과 동일하게 상태 보존)
      backBehavior="none"
      screenOptions={{ headerShown: false, lazy: false }}
      tabBar={(props) => <BottomNav {...props} />}
    >
      {/* 탭 순서 = 하단 바 순서: 홈 · 기록 · 카메라 · 전신결과 · 주변 병원 */}
      <Tab.Screen name="Home" component={HomeWrapped} />
      <Tab.Screen name="Records" component={RecordsWrapped} />
      <Tab.Screen name="Camera" component={CameraScreen} />
      <Tab.Screen name="WholeBody" component={WholeBodyResultWrapped} />
      <Tab.Screen name="Hospital" component={HospitalWrapped} />
    </Tab.Navigator>
  );
}

/**
 * 탭 위에 스택을 한 겹 얹는다 — 기록 탭의 "등록된 모니터링 기록 보기"에서 밀려 올라오는
 * 모니터링 폴더 화면 3종과, 홈의 "루틴" 화살표에서 열리는 루틴 추가/삭제
 * 화면이 여기 올라탄다. 탭 화면 안에서 navigate('Monitoring')/navigate('Routine')을 부르면
 * 탭 안에 없는 이름이라 이 부모 스택으로 올라와 처리된다(그 반대로 navigate('Camera')는
 * 탭 안에서 그대로 해결되므로 기존 코드에 영향이 없다). Routine 화면은 탭 바가 없는 화면이라
 * 자체 뒤로가기 버튼을 두고 있다.
 */
export default function RootNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: AppColors.bg } }}
    >
      <Stack.Screen name="Tabs" component={Tabs} />
      <Stack.Screen name="Monitoring" component={MonitoringScreen} />
      <Stack.Screen name="MonitoringFolder" component={MonitoringFolderScreen} />
      <Stack.Screen name="MonitoringDetail" component={MonitoringDetailScreen} />
      <Stack.Screen name="Routine" component={RoutineScreen} />
    </Stack.Navigator>
  );
}
