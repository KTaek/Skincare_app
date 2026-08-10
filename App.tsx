import React from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { RoutineProvider } from './src/context/RoutineContext';
import { ProfileProvider } from './src/context/ProfileContext';
import { RecordsProvider } from './src/context/RecordsContext';
import { LeaveGuardProvider } from './src/context/LeaveGuardContext';
import { MonitoringProvider } from './src/context/MonitoringContext';
import RootNavigator from './src/navigation/RootNavigator';

/** 이 앱이 실제로 쓰일 화면 비율(세로가 긴 휴대폰) — 웹 미리보기 프레임 크기를 여기 맞춘다 */
const PHONE_W = 402;
const PHONE_H = 874;
/** 브라우저 창이 이 폭보다 좁으면 이미 휴대폰(또는 좁은 창)이라 프레임을 씌우지 않는다 */
const FRAME_MIN_WINDOW_W = 520;

/**
 * 웹으로 열었을 때만 화면을 휴대폰 비율(402×874)의 틀 안에 가둔다.
 *
 * 데스크톱 브라우저 창은 앱이 실제로 쓰일 세로로 긴 휴대폰 화면과 비율이 전혀 달라서, 그대로
 * 늘려 보면 레이아웃이 실제 휴대폰과 다르게 보인다. 네이티브(iOS/Android)에서는 이미 휴대폰
 * 화면 그 자체이므로 이 틀을 씌우지 않고 그대로 꽉 채운다. 브라우저 창을 좁게(휴대폰처럼) 줄여
 * 열었을 때도 틀을 씌우지 않고 실제 창 크기를 그대로 쓴다.
 */
function PhoneFrame({ children }: { children: React.ReactNode }) {
  const { width, height } = useWindowDimensions();
  if (Platform.OS !== 'web' || width < FRAME_MIN_WINDOW_W) {
    return <>{children}</>;
  }
  const frameH = Math.min(PHONE_H, height - 48);
  const frameW = Math.min(PHONE_W, frameH * (PHONE_W / PHONE_H));
  return (
    <View style={styles.backdrop}>
      <View style={[styles.phoneBody, { width: frameW + 16, height: frameH + 16 }]}>
        <View style={[styles.phoneScreen, { width: frameW, height: frameH }]}>{children}</View>
      </View>
    </View>
  );
}

export default function App() {
  return (
    <PhoneFrame>
      <SafeAreaProvider>
        <ProfileProvider>
          <RoutineProvider>
            <RecordsProvider>
              <MonitoringProvider>
                <LeaveGuardProvider>
                  <NavigationContainer>
                    <StatusBar style="dark" />
                    <RootNavigator />
                  </NavigationContainer>
                </LeaveGuardProvider>
              </MonitoringProvider>
            </RecordsProvider>
          </RoutineProvider>
        </ProfileProvider>
      </SafeAreaProvider>
    </PhoneFrame>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    // @ts-expect-error 웹 전용 단위(vh) — RN의 DimensionValue 타입엔 없지만 react-native-web에선 그대로 CSS로 전달된다
    minHeight: '100vh',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DCE0E6',
  },
  phoneBody: {
    borderRadius: 46,
    backgroundColor: '#111214',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 24px 70px rgba(0,0,0,0.35)',
  },
  phoneScreen: {
    borderRadius: 38,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
});
