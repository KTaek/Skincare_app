// 병변 면적 추적 진입 1단계 — 신규 모니터링 등록과 똑같은 사전문진.
// minji의 MonitorIntakeScreen을 그대로 재활용하고, 끝나면 3D 부위 선택으로 넘긴다.
import React from 'react';
import MonitorIntakeScreen from './MonitorIntakeScreen';

export default function AreaIntakeScreen({ navigation }) {
  return (
    <MonitorIntakeScreen
      onBack={() => navigation.goBack()}
      onDone={(intake) => navigation.navigate('AreaBody3D', { intake })}
    />
  );
}
