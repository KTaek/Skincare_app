import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
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
  const width = 300;
  const height = 150;
  const padL = 30;   // y축 라벨 공간
  const padR = 10;
  const padT = 12;
  const padB = 22;

  if (data.length === 0) {
    return <Text style={styles.empty}>{emptyText}</Text>;
  }

  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const x = (i: number) => padL + (data.length > 1 ? (i * plotW) / (data.length - 1) : plotW / 2);
  const y = (v: number) => padT + (1 - Math.min(v, maxValue) / maxValue) * plotH;

  const points = data.map((d, i) => ({ x: x(i), y: y(d.value), date: d.date }));
  const lineD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');

  // y축 눈금 (0, 25, 50, 75, 100%)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxValue);
  const fmt = (t: number) => (Number.isInteger(t) ? `${t}` : t.toFixed(t < 10 ? 1 : 0));

  return (
    <View>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        {/* 가로 눈금선 + y 라벨 */}
        {ticks.map((t, i) => (
          <React.Fragment key={i}>
            <Line x1={padL} y1={y(t)} x2={width - padR} y2={y(t)} stroke={AppColors.line} strokeWidth={1} />
            <SvgYLabel yy={y(t)} label={fmt(t)} padL={padL} />
          </React.Fragment>
        ))}
        {/* 데이터 선 + 점 */}
        <Path d={lineD} stroke={color} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <Circle key={i} cx={p.x} cy={p.y} r={4} fill={color} />
        ))}
      </Svg>
      <View style={[styles.labelsRow, { paddingLeft: padL, paddingRight: padR }]}>
        {points.map((p, i) => (
          <Text key={i} style={styles.label}>
            {p.date.getMonth() + 1}/{p.date.getDate()}
          </Text>
        ))}
      </View>
    </View>
  );
}

function SvgYLabel({ yy, label, padL }: { yy: number; label: string; padL: number }) {
  return (
    <SvgText x={padL - 5} y={yy + 3} fontSize="9" fill={AppColors.sub} textAnchor="end">
      {label}
    </SvgText>
  );
}

const styles = StyleSheet.create({
  empty: { fontSize: 12.5, color: AppColors.sub, lineHeight: 18 },
  labelsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { fontSize: 10.5, color: AppColors.sub },
});
