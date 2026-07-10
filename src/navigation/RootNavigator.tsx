import React from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { AppColors } from '../theme';
import BottomNav from './BottomNav';
import HomeScreen from '../screens/HomeScreen';
import RecordsScreen from '../screens/RecordsScreen';
import CameraScreen from '../screens/CameraScreen';
import RoutineScreen from '../screens/RoutineScreen';
import HospitalScreen from '../screens/HospitalScreen';

const Tab = createBottomTabNavigator();

/** 카메라를 제외한 화면은 상단 세이프 에어리어 패딩을 준다 (Flutter SafeArea top: index != 2 대응) */
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
const HospitalWrapped = withTopInset(HospitalScreen);

export default function RootNavigator() {
  return (
    <Tab.Navigator
      // 모든 탭을 처음부터 마운트 (Flutter IndexedStack 동작과 동일하게 상태 보존)
      backBehavior="none"
      screenOptions={{ headerShown: false, lazy: false }}
      tabBar={(props) => <BottomNav {...props} />}
    >
      <Tab.Screen name="Home" component={HomeWrapped} />
      <Tab.Screen name="Records" component={RecordsWrapped} />
      <Tab.Screen name="Camera" component={CameraScreen} />
      <Tab.Screen name="Routine" component={RoutineWrapped} />
      <Tab.Screen name="Hospital" component={HospitalWrapped} />
    </Tab.Navigator>
  );
}
