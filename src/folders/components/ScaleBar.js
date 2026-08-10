/**
 * 4단계 구간(segments)의 지금 단계를 보여주는 막대 — 상세 결과·분석 결과 화면의 피부 종합 상태 ·
 * 증상 4종 · 가려움 · 수면 점수가 모두 이 컴포넌트 하나를 공유해 같은 모양으로 보인다.
 *
 * 값이 어디쯤인지(연속된 채움 길이)보다 "지금 몇 단계인지"가 더 중요해서, 4단계를 각각 같은
 * 폭의 알약 모양 칸으로 나란히 그리고 그중 지금 단계에 해당하는 칸 하나만 그 단계 색으로 채운다
 * (좋음=연두 … 매우 나쁨=빨강). 나머지 칸은 옅은 회색으로 남겨 넷 중 어디인지 한눈에 들어오게
 * 한다. 막대 아래에는 4단계 이름을 깔고, 지금 해당하는 단계만 그 색으로 굵게 표시한다.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { monitoringColors as mc, segmentFor } from '../theme';

/** compact=true면 막대를 얇게 그린다 — 증상 4종처럼 여러 개를 쌓을 때 쓴다 */
export default function ScaleBar({ value, segments, compact = false }) {
  const band = segmentFor(value, segments);

  return (
    <View style={styles.wrap}>
      <View style={styles.segmentsRow}>
        {segments.map((s, i) => (
          <View
            key={i}
            style={[
              styles.segment,
              compact && styles.segmentCompact,
              { backgroundColor: i === band.index ? s.color : mc.line },
            ]}
          />
        ))}
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
  segmentsRow: { flexDirection: 'row', gap: 5 },
  segment: { flex: 1, height: 10, borderRadius: 5 },
  segmentCompact: { height: 7, borderRadius: 4 },
  labelRow: { flexDirection: 'row', marginTop: 5 },
  label: { flex: 1, fontSize: 10.5, color: mc.sub, textAlign: 'center' },
});
