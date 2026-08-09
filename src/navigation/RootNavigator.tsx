import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AppColors } from '../theme';
import BottomNav from './BottomNav';
import HomeScreen from '../screens/HomeScreen';
import RecordsScreen from '../screens/RecordsScreen';
import CameraScreen from '../screens/CameraScreen';
import WholeBodyResultScreen from '../screens/WholeBodyResultScreen';
import DataExportScreen from '../screens/DataExportScreen';
import RoutineScreen from '../screens/RoutineScreen';
import ProfileScreen from '../screens/ProfileScreen';
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
const RoutineWrapped = withTopInset(RoutineScreen);
const ProfileWrapped = withTopInset(ProfileScreen);

/**
 * 하단 바가 붙어 있는 5개 탭 — 앱의 기본 화면.
 * 홈 · 피부 촬영 · 기록 · 루틴 · 마이페이지. 전신 결과는 기록 탭 안에서 스택 화면으로 열린다.
 */
function Tabs() {
  return (
    <Tab.Navigator
      // 모든 탭을 처음부터 마운트 (Flutter IndexedStack 동작과 동일하게 상태 보존)
      backBehavior="none"
      screenOptions={{ headerShown: false, lazy: false }}
      tabBar={(props) => <BottomNav {...props} />}
    >
      {/* 탭 순서 = 하단 바 순서 */}
      <Tab.Screen name="Home" component={HomeWrapped} />
      <Tab.Screen name="Camera" component={CameraScreen} />
      <Tab.Screen name="Records" component={RecordsWrapped} />
      <Tab.Screen name="Routine" component={RoutineWrapped} />
      <Tab.Screen name="Profile" component={ProfileWrapped} />
    </Tab.Navigator>
  );
}

/**
 * 탭 위에 스택을 한 겹 얹는다 — 경과 관찰 화면 3종과 기록 탭에서 열리는 전신 결과가 여기
 * 올라탄다. 탭 화면 안에서 navigate('WholeBody') 같이 탭에 없는 이름을 부르면 이 부모 스택으로
 * 올라와 처리된다(navigate('Camera')처럼 탭 안에 있는 이름은 그대로 탭에서 해결되므로 기존
 * 코드에 영향이 없다).
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
      {/* 탭에서 빠져나온 화면 — 자체 뒤로가기가 없어 네이티브 헤더를 켠다 */}
      <Stack.Screen
        name="WholeBody"
        component={WholeBodyResultScreen}
        options={{ headerShown: true, title: '전신 결과', headerTintColor: AppColors.ink }}
      />
      <Stack.Screen
        name="DataExport"
        component={DataExportScreen}
        options={{ headerShown: true, title: '데이터 다운로드', headerTintColor: AppColors.ink }}
      />
    </Stack.Navigator>
  );
}
