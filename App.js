import React from 'react';
import { Platform, View, StyleSheet, useWindowDimensions } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import HomeScreen from './src/screens/HomeScreen';
import MonitoringScreen from './src/screens/MonitoringScreen';
import MonitoringFolderScreen from './src/screens/MonitoringFolderScreen';
import MonitoringDetailScreen from './src/screens/MonitoringDetailScreen';

const Stack = createStackNavigator();

/**
 * 모바일 브라우저는 주소창/하단 툴바 때문에 CSS `height:100%`(html/body/#root 체인)이
 * 실제로 보이는 영역과 다르게 계산될 때가 많다 — 특히 iOS Safari에서 심하다.
 * 이 프로젝트는 Expo가 자동 생성하는 web/index.html을 직접 건드릴 수 없으므로,
 * window.visualViewport(가능하면)로 "진짜 보이는 높이"를 읽어 루트 View에 픽셀값으로
 * 직접 지정한다 — 그러면 하단이 화면 밖으로 잘리지 않는다.
 */
function useWebViewportHeight() {
  const getH = () => {
    if (typeof window === 'undefined') return undefined;
    return window.visualViewport ? window.visualViewport.height : window.innerHeight;
  };
  const [h, setH] = React.useState(getH);

  React.useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const update = () => setH(getH());
    update();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  return h;
}

// 웹 미리보기 전용: 아이폰 17 Pro 추정 논리 해상도(402×874)로 앱을 감싸서
// 데스크톱 브라우저에서도 실제 폰 화면 비율로 확인할 수 있게 한다.
// 네이티브(iOS/Android)에서는 그대로 통과시켜 전혀 영향이 없다.
//
// 뷰포트 자체가 이미 폰 크기(실제 휴대폰으로 접속한 경우)일 때는 이 프레임을 씌우면 안 된다 —
// 프레임이 고정 크기(874)라 실제 폰 화면 높이보다 크면 하단이 화면 밖으로 잘려나가기 때문.
// 이런 경우엔 프레임 없이 화면을 그대로 꽉 채운다.
const PHONE = { width: 402, height: 874 };

function WebPhoneFrame({ children }) {
  const { width, height } = useWindowDimensions();
  if (Platform.OS !== 'web') return children;
  if (width < PHONE.width + 40) return children; // 이미 폰 크기 뷰포트 — 프레임 없이 꽉 채움

  const frameH = Math.min(PHONE.height, height - 56);
  return (
    <View style={webStyles.backdrop}>
      <View style={[webStyles.frame, { height: frameH }]}>
        {children}
      </View>
    </View>
  );
}

export default function App() {
  const webViewportH = useWebViewportHeight();
  const rootStyle = Platform.OS === 'web' && webViewportH
    ? { height: webViewportH, width: '100%', overflow: 'hidden' }
    : webStyles.nativeFill;

  return (
    <View style={rootStyle}>
      <WebPhoneFrame>
        <SafeAreaProvider>
          <NavigationContainer>
            <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName="Home">
              <Stack.Screen name="Home" component={HomeScreen} />
              <Stack.Screen name="Monitoring" component={MonitoringScreen} />
              <Stack.Screen name="MonitoringFolder" component={MonitoringFolderScreen} />
              <Stack.Screen name="MonitoringDetail" component={MonitoringDetailScreen} />
            </Stack.Navigator>
          </NavigationContainer>
        </SafeAreaProvider>
      </WebPhoneFrame>
    </View>
  );
}

const webStyles = StyleSheet.create({
  nativeFill: { flex: 1 },
  backdrop: {
    minHeight: '100vh', width: '100%',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#232228', padding: 28,
  },
  frame: {
    width: PHONE.width, height: PHONE.height,
    borderRadius: 56, borderWidth: 12, borderColor: '#0B0B0D',
    overflow: 'hidden', backgroundColor: '#000',
    boxShadow: '0 40px 90px rgba(0,0,0,0.5)',
  },
});
