/**
 * 4단계 구간(segments)으로 나뉜 스케일 바 — 상세 결과·분석 결과 화면의 피부 종합 상태 ·
 * 증상 4종 · 가려움 · 수면 점수가 모두 이 컴포넌트 하나를 공유해 같은 모양으로 보인다.
 *
 * 막대는 "길이"와 "색" 두 가지로 상태를 말한다 — 길이만으로는 좋은 값인지 나쁜 값인지 한눈에
 * 안 들어와서, 지금 값이 속한 단계의 색(좋음=연두 … 매우 나쁨=빨강)으로 채운다. 막대 아래에는
 * 4단계 이름을 깔고, 지금 해당하는 단계만 그 색으로 굵게 표시한다.
 *
 * 구간마다 실제 폭이 다르다(예: 가려움의 "좋음"은 0점 하나뿐이라 폭이 0). 폭 그대로 그리면 그런
 * 구간이 화면에서 아예 안 보이므로, 항상 4칸을 똑같은 너비로 그리고 그 칸 "안에서"만 값의 상대
 * 위치로 채움 길이를 정한다 — 그래야 폭 0인 구간도 자기 칸을 갖고, 채움 끝은 어떤 지표든 항상
 * 정확히 어느 4단계에 속하는지로 위치가 정해진다.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { monitoringColors as mc, segmentFor } from '../theme';

function fillFrac(value, segments) {
  for (let i = 0; i < segments.length; i++) {
    const lo = i === 0 ? 0 : segments[i - 1].to;
    const hi = segments[i].to;
    if (value <= hi || i === segments.length - 1) {
      const span = hi - lo;
      const within = span > 0 ? Math.min(1, Math.max(0, (value - lo) / span)) : (value <= lo ? 0 : 1);
      return (i + within) / segments.length;
    }
  }
  return 1;
}

/** compact=true면 막대를 얇게 그린다 — 증상 4종처럼 여러 개를 쌓을 때 쓴다 */
export default function ScaleBar({ value, segments, compact = false }) {
  const frac = fillFrac(value, segments);
  const band = segmentFor(value, segments);

  return (
    <View style={styles.wrap}>
      <View style={[styles.track, compact && styles.trackCompact]}>
        <View style={[styles.fill, { width: `${frac * 100}%`, backgroundColor: band.color }]} />
      </View>
      <View style={styles.labelRow}>
        {segments.map((s, i) => (
          <Text
            key={i}
            style={[styles.label, i === band.index && { color: s.color, fontWeight: '800' }]}
            numberOfLines={1}
          >
            {s.ko}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  track: {
    position: 'relative', height: 10, borderRadius: 5,
    backgroundColor: mc.bg, overflow: 'hidden',
    borderWidth: 1, borderColor: mc.line,
  },
  trackCompact: { height: 7, borderRadius: 4 },
  fill: { position: 'absolute', top: 0, left: 0, bottom: 0, borderRadius: 5 },
  labelRow: { flexDirection: 'row', marginTop: 5 },
  label: { flex: 1, fontSize: 10.5, color: mc.sub, textAlign: 'center' },
});
