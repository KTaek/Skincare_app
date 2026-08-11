import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, ImageStyle, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
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

/** 스플래시가 화면에 머무는 시간 — 너무 짧으면 깜빡이듯 지나가고, 너무 길면 로딩이 느려 보인다 */
const SPLASH_HOLD_MS = 5000;
const SPLASH_FADE_MS = 300;

/**
 * 앱 시작 화면 — assets/splash.png(오프라인 빌드 스플래시와 같은 이미지)를 그대로 띄운다.
 *
 * 네이티브 빌드는 app.json의 splash 설정이 JS가 뜨기도 전에 이 이미지를 먼저 보여주지만, 이 컴포넌트가
 * 뜨는 시점엔 이미 JS가 실행 중이라 그 자리를 이어받는 것뿐이다 — 그래서 정적 스플래시가 없는
 * 웹 미리보기에서도 앱을 열면 항상 같은 화면이 먼저 보인다. 실제 앱 트리는 이 뒤에서 같이
 * 마운트돼 있고(providers가 데이터를 준비할 시간을 벌어준다), 붙잡아 둔 시간이 끝나면 살짝
 * 페이드아웃하고 사라진다.
 */
function SplashOverlay({ onDone }: { onDone: () => void }) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: SPLASH_FADE_MS, useNativeDriver: true }).start(onDone);
    }, SPLASH_HOLD_MS);
    return () => clearTimeout(timer);
  }, [opacity, onDone]);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.splashRoot, { opacity }]} pointerEvents="none">
      <Image source={require('./assets/splash.png')} style={splashImageStyle} resizeMode="contain" />
    </Animated.View>
  );
}

export default function App() {
  const [showSplash, setShowSplash] = useState(true);

  return (
    <PhoneFrame>
      <View style={{ flex: 1 }}>
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
        {showSplash && <SplashOverlay onDone={() => setShowSplash(false)} />}
      </View>
    </PhoneFrame>
  );
}

// width+aspectRatio(1)만 쓰면 실제 휴대폰처럼 세로로 훨씬 긴 화면에서 그 비율 그대로 정사각형
// 박스를 만드는데, 그 박스가 화면 비율과 안 맞아 보였다 — width·height를 둘 다 넉넉한 테두리
// 상자로 주고 resizeMode="contain"이 그 상자 안에서 원본(정사각형) 비율 그대로 맞추게 한다.
const splashImageStyle: ImageStyle = { width: '88%', height: '70%' };

const styles = StyleSheet.create({
  splashRoot: {
    backgroundColor: '#EDF0F4',
    alignItems: 'center',
    justifyContent: 'center',
  },
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
