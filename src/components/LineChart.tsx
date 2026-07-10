import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { AppColors } from '../theme';

export interface LineChartPoint {
  date: Date;
  value: number;
}

export default function LineChart({
  data,
  maxValue,
  color = AppColors.greenTop,
  emptyText = '아직 기록이 없어요.',
}: {
  data: LineChartPoint[];
  maxValue: number;
  color?: string;
  emptyText?: string;
}) {
  const width = 280;
  const height = 140;
  const padding = 20;

  if (data.length === 0) {
    return <Text style={styles.empty}>{emptyText}</Text>;
  }

  const stepX = data.length > 1 ? (width - padding * 2) / (data.length - 1) : 0;
  const points = data.map((d, i) => ({
    x: padding + i * stepX,
    y: height - padding - (d.value / maxValue) * (height - padding * 2),
    date: d.date,
  }));
  const lineD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');

  return (
    <View>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        <Path
          d={`M${padding} ${height - padding} L${width - padding} ${height - padding}`}
          stroke={AppColors.line}
          strokeWidth={1}
        />
        <Path d={lineD} stroke={color} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <Circle key={i} cx={p.x} cy={p.y} r={4} fill={color} />
        ))}
      </Svg>
      <View style={styles.labelsRow}>
        {points.map((p, i) => (
          <Text key={i} style={styles.label}>
            {p.date.getMonth() + 1}/{p.date.getDate()}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { fontSize: 12.5, color: AppColors.sub, lineHeight: 18 },
  labelsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14 },
  label: { fontSize: 10.5, color: AppColors.sub },
});
