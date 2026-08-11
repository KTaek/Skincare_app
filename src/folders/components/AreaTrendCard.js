/**
 * 병변 넓이 추이 — 가이드에 맞춰 찍어 넓이를 잰 회차들만 이어 그린다 (얼굴·몸통).
 *
 * **왜 별도 카드인가.** 결합 그래프(TrendChart)는 수면·가려움·피부 종합 상태를 "100점이 가장
 * 좋음"으로 맞춘 0~100 축 하나에 겹쳐 그린다. 넓이는 그 축에 올릴 수 없다 — 상한이 없고,
 * 그날 한 장에서 읽는 값이 아니라 **첫 촬영과 견줘야만 의미가 생기는** 값이기 때문이다.
 *
 * **왜 그래프는 절대값이 아니라 상대 변화인가.** 넓이 지수의 절대값에는 세그 모델의 계통 편향
 * (경계를 조금 넓게 혹은 좁게 잡는 버릇)이 그대로 들어 있다. 같은 편향이 모든 회차에 똑같이
 * 들어가므로 비율을 내면 상당 부분 상쇄된다. 그래서 **선은 변화율로 그린다.**
 *
 * **그런데 숫자는 넓이부터 말한다.** 변화율만 보여주면 "42% 줄었다"가 무엇에서 무엇으로 줄었는지
 * 알 수 없다. 그래서 큰 숫자는 "몸통의 12%"처럼 지금 얼마나 넓은지이고, 변화율은 그 아래 한 줄로
 * 따라간다 — 결과 화면(ExamResultScreen)의 카드와 **같은 순서·같은 문구**다. 두 화면이 같은 값을
 * 다르게 말하면 사용자는 어느 쪽을 믿어야 할지 알 수 없다.
 *
 * ⚠️ 두 숫자의 신뢰도가 다르다. 부위 대비 %는 그 부위의 넓이를 성인 평균 비례로 어림해 환산한
 *    값이라 체형에 따라 흔들리지만(ai/scaleFrame의 areaOverAreaRef), 변화율에는 그 상수가
 *    분자·분모에서 상쇄돼 남지 않는다. 그래서 판정 배지는 **변화율에만** 붙인다.
 *
 * **왜 변화 없음 띠(LoD)를 그리는가.** 같은 자리를 연달아 두 번 찍어도 넓이는 조금씩 다르게
 * 나온다(정렬 오차·조명·마스크 경계). 그 폭 안의 움직임을 호전/악화로 읽으면 안 되는데, 띠가
 * 없으면 사람은 반드시 그렇게 읽는다. 띠 안에 있는 회차는 선으로만 잇고 판정을 붙이지 않는다.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { monitoringColors as mc, monitoringCard } from '../theme';
import { areaTrendOf, changePhrase, fmtCoverage, fmtPct, timeAxisOf, verdictOf } from '../areaTrend';

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
          아직 넓이를 잰 촬영이 없어요. 가이드에 맞춰 찍으면 촬영 거리와 상관없이 넓이 변화를
          이어서 볼 수 있어요.
        </Text>
      </View>
    );
  }

  const { points, skipped } = series;
  const latest = points[points.length - 1];
  const verdict = verdictOf(latest.delta, series.kind);
  const lod = series.lod;

  // 한 번만 쟀으면 아직 "변화"가 없다 — 그래프는 못 그리지만 **오늘 얼마나 넓은지는 말할 수 있다**.
  // 그 값은 그날 한 장에서 나오는 값이라 견줄 회차가 없어도 성립한다.
  if (series.baselineOnly) {
    return (
      <View style={[monitoringCard(), styles.card]}>
        <View style={styles.headRow}>
          <Text style={styles.title}>병변 넓이</Text>
          <Text style={styles.sub}>{latest.noun} 대비</Text>
        </View>
        <View style={styles.valueRow}>
          <Text style={styles.value}>
            {latest.noun}의 {fmtCoverage(latest.coveragePct)}
          </Text>
        </View>
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
  const maxAbs = Math.max(lod * 1.6, ...points.map((p) => Math.abs(p.delta)));
  // 가로 축은 촬영 순서가 아니라 **시각**이다 (timeAxisOf 주석 참고)
  const tx = timeAxisOf(points);
  const xAt = (i) => PAD_LEFT + tx[i] * plotW;
  const yAt = (v) => PAD_TOP + (1 - (v + maxAbs) / (2 * maxAbs)) * plotH;

  const line = points.map((p, i) => `${xAt(i)},${yAt(p.delta)}`).join(' ');

  return (
    <View style={[monitoringCard(), styles.card]}>
      <View style={styles.headRow}>
        <Text style={styles.title}>병변 넓이</Text>
        <Text style={styles.sub}>{latest.noun} 대비 · 첫 촬영 대비</Text>
      </View>

      {/* 큰 숫자는 "지금 얼마나 넓은가", 배지는 "첫 촬영에서 어떻게 달라졌나" — 둘의 근거가 다르다 */}
      <View style={styles.valueRow}>
        <Text style={styles.value}>
          {latest.noun}의 {fmtCoverage(latest.coveragePct)}
        </Text>
        <View style={[styles.pill, { backgroundColor: verdict.color }]}>
          {/* 밝은 배경(연두)에는 흰 글자가 안 읽힌다 — 어느 색이 밝은지는 areaTrend가 알려준다 */}
          <Text style={[styles.pillText, verdict.lightBg && { color: mc.ink }]}>{verdict.ko}</Text>
        </View>
      </View>
      <Text style={styles.change}>
        {changePhrase(latest.delta, series.kind)} <Text style={styles.changeExact}>(첫 촬영 대비 {fmtPct(latest.delta)})</Text>
      </Text>
      {/* 그래프의 0%가 무엇인지 밝힌다 — 안 그러면 "0%면 병변이 없는 건가"로 읽힌다 */}
      <Text style={styles.foot}>
        아래 그래프는 첫 촬영 대비 변화율이에요 — 그때의 {fmtCoverage(points[0].coveragePct)}가 0% 자리입니다.
      </Text>

      <Svg width={chartW} height={CHART_H}>
        {/* 변화 없음 띠 — 이 안의 오르내림은 측정 잡음과 구분되지 않는다 */}
        <Rect
          x={PAD_LEFT}
          y={yAt(lod)}
          width={plotW}
          height={yAt(-lod) - yAt(lod)}
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
        회색 띠 안({fmtPct(-lod)} ~ {fmtPct(lod)})의 오르내림은 측정 오차와 구분되지 않아 변화로 보지 않아요.
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
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, marginBottom: 2 },
  change: { fontSize: 14, fontWeight: '800', color: mc.ink, marginBottom: 6 },
  changeExact: { fontSize: 12, fontWeight: '600', color: mc.sub },
  value: { fontSize: 26, fontWeight: '800', color: mc.ink },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  pillText: { fontSize: 12, fontWeight: '700', color: '#FFFFFF' },
  empty: { marginTop: 8, fontSize: 13, color: mc.sub, lineHeight: 20 },
  foot: { marginTop: 8, fontSize: 11, color: mc.sub, lineHeight: 16 },
});
