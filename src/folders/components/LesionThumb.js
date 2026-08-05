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

export default function LesionThumb({ photo, areaPct = 10, seed = 1, mode = 'photo', size = 64, style }) {
  return (
    <View style={[{ width: size, height: size, borderRadius: 10, overflow: 'hidden', backgroundColor: mc.bg }, style]}>
      {photo && <Image source={photo} style={{ width: '100%', height: '100%' }} resizeMode="cover" />}
      {mode === 'overlay' && (
        <OverlayOutline areaPct={areaPct} seed={seed} />
      )}
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
