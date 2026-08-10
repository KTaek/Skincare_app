/**
 * 병변 넓이 변화 추이 — 얼굴 자리를 가이드에 맞춰 찍은 회차들만 이어 그린다.
 *
 * **왜 별도 카드인가.** 결합 그래프(TrendChart)는 수면·가려움·피부 종합 상태를 "100점이 가장
 * 좋음"으로 맞춘 0~100 축 하나에 겹쳐 그린다. 넓이는 그 축에 올릴 수 없다 — 상한이 없고,
 * 그날 한 장에서 읽는 값이 아니라 **첫 촬영과 견줘야만 의미가 생기는** 값이기 때문이다.
 *
 * **왜 절대값이 아니라 상대 변화인가.** 넓이 지수의 절대값에는 세그 모델의 계통 편향(경계를
 * 조금 넓게 혹은 좁게 잡는 버릇)이 그대로 들어 있다. 같은 편향이 모든 회차에 똑같이 들어가므로
 * 비율을 내면 상당 부분 상쇄된다. 사용자가 알고 싶은 것도 "몇 %인가"가 아니라 "줄었나"다.
 *
 * **왜 변화 없음 띠(LoD)를 그리는가.** 같은 자리를 연달아 두 번 찍어도 넓이는 조금씩 다르게
 * 나온다(정렬 오차·조명·마스크 경계). 그 폭 안의 움직임을 호전/악화로 읽으면 안 되는데, 띠가
 * 없으면 사람은 반드시 그렇게 읽는다. 띠 안에 있는 회차는 선으로만 잇고 판정을 붙이지 않는다.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { monitoringColors as mc, monitoringCard } from '../theme';
import { areaTrendOf, fmtPct, LOD, timeAxisOf, verdictOf } from '../areaTrend';

const CHART_H = 150;
const PAD_TOP = 14;
const PAD_BOTTOM = 22;
const PAD_LEFT = 34;
const PAD_RIGHT = 12;

export default function AreaTrendCard({ records, width }) {
  const series = areaTrendOf(records || []);

  // 잰 회차가 아예 없으면 카드를 비워 두지 않고 왜 없는지 말한다 —
  // 조용히 빈 자리를 두면 사용자는 기능이 고장 났다고 생각한다
  if (!series) {
    return (
      <View style={[monitoringCard(), styles.card]}>
        <Text style={styles.title}>병변 넓이 변화</Text>
        <Text style={styles.empty}>
          아직 넓이를 잰 촬영이 없어요. 얼굴 자리를 가이드에 맞춰 찍으면 촬영 거리와 상관없이
          넓이 변화를 이어서 볼 수 있어요.
        </Text>
      </View>
    );
  }

  const { points, skipped } = series;
  const latest = points[points.length - 1];
  const verdict = verdictOf(latest.delta);

  // 한 번만 쟀으면 아직 "변화"가 없다 — 그래프 대신 기준이 잡혔다는 것만 알린다
  if (series.baselineOnly) {
    return (
      <View style={[monitoringCard(), styles.card]}>
        <Text style={styles.title}>병변 넓이 변화</Text>
        <Text style={styles.empty}>
          기준이 되는 첫 촬영이 기록됐어요. 다음에 같은 자리를 한 번 더 찍으면 변화가 보이기 시작해요.
        </Text>
      </View>
    );
  }

  const chartW = Math.max(160, (width || 300) - 32);
  const plotW = chartW - PAD_LEFT - PAD_RIGHT;
  const plotH = CHART_H - PAD_TOP - PAD_BOTTOM;

  // 세로 축은 0을 가운데 두고 대칭으로 — 늘어난 쪽과 줄어든 쪽을 같은 눈으로 봐야 한다.
  // 최소 폭은 LOD 띠보다 넉넉히 잡아, 띠가 그래프를 꽉 채워 보이지 않게 한다.
  const maxAbs = Math.max(LOD * 1.6, ...points.map((p) => Math.abs(p.delta)));
  // 가로 축은 촬영 순서가 아니라 **시각**이다 (timeAxisOf 주석 참고)
  const tx = timeAxisOf(points);
  const xAt = (i) => PAD_LEFT + tx[i] * plotW;
  const yAt = (v) => PAD_TOP + (1 - (v + maxAbs) / (2 * maxAbs)) * plotH;

  const line = points.map((p, i) => `${xAt(i)},${yAt(p.delta)}`).join(' ');

  return (
    <View style={[monitoringCard(), styles.card]}>
      <View style={styles.headRow}>
        <Text style={styles.title}>병변 넓이 변화</Text>
        <Text style={styles.sub}>첫 촬영 대비</Text>
      </View>

      <View style={styles.valueRow}>
        <Text style={styles.value}>{fmtPct(latest.delta)}</Text>
        <View style={[styles.pill, { backgroundColor: verdict.color }]}>
          {/* 밝은 배경(연두)에는 흰 글자가 안 읽힌다 — 어느 색이 밝은지는 areaTrend가 알려준다 */}
          <Text style={[styles.pillText, verdict.lightBg && { color: mc.ink }]}>{verdict.ko}</Text>
        </View>
      </View>

      <Svg width={chartW} height={CHART_H}>
        {/* 변화 없음 띠 — 이 안의 오르내림은 측정 잡음과 구분되지 않는다 */}
        <Rect
          x={PAD_LEFT}
          y={yAt(LOD)}
          width={plotW}
          height={yAt(-LOD) - yAt(LOD)}
          fill={mc.navInactive}
          opacity={0.14}
        />
        {/* 기준선(첫 촬영) */}
        <Line x1={PAD_LEFT} y1={yAt(0)} x2={PAD_LEFT + plotW} y2={yAt(0)} stroke={mc.line} strokeWidth={1} />

        <SvgText x={4} y={yAt(maxAbs) + 9} fontSize={9} fill={mc.sub}>
          {fmtPct(maxAbs)}
        </SvgText>
        <SvgText x={4} y={yAt(0) + 3} fontSize={9} fill={mc.sub}>
          0%
        </SvgText>
        <SvgText x={4} y={yAt(-maxAbs)} fontSize={9} fill={mc.sub}>
          {fmtPct(-maxAbs)}
        </SvgText>

        <Polyline points={line} fill="none" stroke={mc.greenTop} strokeWidth={2} />
        {points.map((p, i) => (
          <Circle
            key={p.record.id}
            cx={xAt(i)}
            cy={yAt(p.delta)}
            r={3.5}
            fill="#FFFFFF"
            stroke={mc.greenTop}
            strokeWidth={2}
          />
        ))}
      </Svg>

      <Text style={styles.foot}>
        회색 띠 안({fmtPct(-LOD)} ~ {fmtPct(LOD)})의 오르내림은 측정 오차와 구분되지 않아 변화로 보지 않아요.
      </Text>
      {skipped > 0 && (
        <Text style={styles.foot}>
          가이드와 어긋나게 찍힌 {skipped}회는 넓이를 견줄 수 없어 이 그래프에서 빠졌어요
          (등급·증상 기록은 그대로 있어요).
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, marginTop: 12 },
  headRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  title: { fontSize: 15, fontWeight: '800', color: mc.ink },
  sub: { fontSize: 12, color: mc.sub },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, marginBottom: 6 },
  value: { fontSize: 26, fontWeight: '800', color: mc.ink },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  pillText: { fontSize: 12, fontWeight: '700', color: '#FFFFFF' },
  empty: { marginTop: 8, fontSize: 13, color: mc.sub, lineHeight: 20 },
  foot: { marginTop: 8, fontSize: 11, color: mc.sub, lineHeight: 16 },
});
