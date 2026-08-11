/**
 * 촬영 사진 표시 — monitoringStore가 각 기록에 매칭해 둔 실제 dump 이미지(photo)를 그대로 보여준다.
 *
 * mode="photo"  : 사진 원본만 표시
 * mode="overlay": 같은 사진 위에 AI가 예측한 병변 경계를 흰 점선 윤곽으로 겹쳐 표시(사진 자체는 그대로, 윤곽선만 표시용)
 */
import React from 'react';
import { View, Image } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { monitoringColors as mc } from '../theme';
import { makeRng } from '../store';

const S = 100; // 오버레이 윤곽선 좌표계 — size prop은 렌더 크기만 조절

function blobPath(cx, cy, baseR, jitter, n, rng) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = baseR * (1 - jitter / 2 + rng() * jitter);
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const first = mid(pts[n - 1], pts[0]);
  let d = `M ${first[0].toFixed(1)} ${first[1].toFixed(1)} `;
  for (let i = 0; i < n; i++) {
    const next = pts[(i + 1) % n];
    const m = mid(pts[i], next);
    d += `Q ${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)}, ${m[0].toFixed(1)} ${m[1].toFixed(1)} `;
  }
  return d + 'Z';
}

/**
 * @param overlay 분석이 실제로 합성해 둔 병변 오버레이 이미지 ({ uri }). 실촬영 기록에만 있다.
 *
 * 있으면 **그 이미지를 그대로 보여준다** — 촬영 직후 결과 화면(ExamResultScreen의 PhotoPair)이
 * 보여주는 바로 그 그림이다. 반투명한 색 면과 흰 테두리로 병변의 실제 모양이 담겨 있다.
 *
 * 없으면 예전처럼 흰 점선 윤곽을 그린다. 그건 **넓이 값으로 크기만 흉내 낸 도형**이라 실제 병변
 * 모양이 아니다 — 시계열이 dump인 데모 폴더를 위해 남겨 둔 길이고, 실제 분석 기록에는 쓰이지
 * 않아야 한다. 같은 자리에 하나는 측정 결과를, 하나는 지어낸 그림을 놓으면 사용자는 구분할 수 없다.
 */
export default function LesionThumb({ photo, overlay = null, areaPct = 10, seed = 1, mode = 'photo', size = 64, style }) {
  const real = mode === 'overlay' && overlay ? overlay : null;
  const source = real ?? photo;
  return (
    <View style={[{ width: size, height: size, borderRadius: 10, overflow: 'hidden', backgroundColor: mc.bg }, style]}>
      {source && <Image source={source} style={{ width: '100%', height: '100%' }} resizeMode="cover" />}
      {mode === 'overlay' && !real && <OverlayOutline areaPct={areaPct} seed={seed} />}
    </View>
  );
}

function OverlayOutline({ areaPct, seed }) {
  const rng = makeRng(seed);
  const cx = S / 2 + (rng() - 0.5) * 14;
  const cy = S / 2 + (rng() - 0.5) * 14;
  const r = Math.min(40, Math.max(12, Math.sqrt(Math.max(areaPct, 1) / 100) * S * 0.65));
  const d = blobPath(cx, cy, r, 0.55, 9, rng);
  return (
    <Svg width="100%" height="100%" viewBox={`0 0 ${S} ${S}`} style={{ position: 'absolute', top: 0, left: 0 }}>
      <Path d={d} fill="none" stroke="#FFFFFF" strokeWidth={2.6} strokeDasharray="5,3" />
    </Svg>
  );
}
