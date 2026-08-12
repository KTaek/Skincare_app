/**
 * 촬영 사진 표시 — 원본과 병변 오버레이를 같은 규칙으로 그린다.
 *
 * mode="photo"   : 사진 원본
 * mode="overlay" : 분석이 합성해 둔 병변 오버레이 (촬영 직후 결과 화면이 보여주는 바로 그 그림)
 *
 * **오버레이가 없으면 원본을 그대로 보여준다.** 예전에는 넓이 값으로 크기만 흉내 낸 흰 점선
 * 도형을 그렸는데, 그건 실제 병변 모양과 아무 관계가 없는 지어낸 그림이었다 — 같은 자리에
 * 하나는 측정 결과를, 하나는 지어낸 그림을 놓으면 사용자는 둘을 구분할 수 없다. 데모 기록도
 * 이제 진짜 사진에 진짜 세그를 돌려 오버레이를 만든다(folders/lesionOverlay).
 */
import React from 'react';
import { View, Image } from 'react-native';
import { monitoringColors as mc } from '../theme';

export default function LesionThumb({ photo, overlay = null, mode = 'photo', size = 64, style }) {
  const source = (mode === 'overlay' && overlay) || photo;
  return (
    <View style={[{ width: size, height: size, borderRadius: 10, overflow: 'hidden', backgroundColor: mc.bg }, style]}>
      {source && <Image source={source} style={{ width: '100%', height: '100%' }} resizeMode="cover" />}
    </View>
  );
}
