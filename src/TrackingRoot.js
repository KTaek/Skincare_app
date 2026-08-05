// 면적추적 미니 라우터 — react-navigation 스택(=reanimated 의존) 없이 JS 상태로 화면 전환.
// navigate/push/replace/goBack/canGoBack + route.params 를 합성 navigation으로 제공.
import React, { useMemo, useRef, useState } from 'react';
import TrackingBodyScreen from './screens/TrackingBodyScreen';
import TrackingSitesScreen from './screens/TrackingSitesScreen';
import TrackingSiteDetailScreen from './screens/TrackingSiteDetailScreen';
import TrackingFlowScreen from './screens/TrackingFlowScreen';

const SCREENS = {
  TrackingBody: TrackingBodyScreen,
  TrackingSites: TrackingSitesScreen,
  TrackingSiteDetail: TrackingSiteDetailScreen,
  TrackingFlow: TrackingFlowScreen,
};

export default function TrackingRoot({ onExit }) {
  const [stack, setStack] = useState([{ name: 'TrackingBody', params: {} }]);
  const stackRef = useRef(stack);
  stackRef.current = stack;

  const nav = useMemo(() => ({
    navigate: (name, params = {}) => setStack((s) => [...s, { name, params }]),
    push:     (name, params = {}) => setStack((s) => [...s, { name, params }]),
    replace:  (name, params = {}) => setStack((s) => [...s.slice(0, -1), { name, params }]),
    goBack: () => {
      if (stackRef.current.length > 1) setStack((s) => s.slice(0, -1));
      else onExit();
    },
    canGoBack: () => stackRef.current.length > 1,
  }), [onExit]);

  const top = stack[stack.length - 1];
  const Screen = SCREENS[top.name] || TrackingSitesScreen;
  return <Screen navigation={nav} route={{ params: top.params }} />;
}
