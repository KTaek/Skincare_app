/**
 * 4단계 구간(segments)으로 나뉜 스케일 바 — 상세 결과 화면의 피부 종합 상태 · 세부 증상 4종 ·
 * 가려움 · 수면 점수가 모두 이 컴포넌트 하나를 공유해 같은 모양으로 보인다.
 * (삼성헬스 체중 그래프 스타일 참고: 구간마다 색을 다르게 칠하지 않고, 연한 회색 트랙 위에
 * 지금 값까지만 단색으로 채우고, 눈금선 + 경계선 + 그 아래 라벨로 4단계를 구분한다.)
 *
 * 구간마다 실제 폭이 다르다(예: 가려움의 "편함"은 0점 하나뿐이라 폭이 0). 폭 그대로 그리면 그런
 * 구간이 화면에서 아예 안 보이므로, 항상 4칸을 똑같은 너비로 그리고 그 칸 "안에서"만 값의 상대
 * 위치로 채움 길이를 정한다 — 그래야 폭 0인 구간도 자기 칸을 갖고, 채움 끝은 어떤 지표든 항상
 * 정확히 어느 4단계에 속하는지로 위치가 정해진다.
 *
 * 같은 구간을 쓰는 스케일 바를 여러 개 세로로 쌓을 때(예: 세부 증상 4개)는 눈금/경계/라벨이
 * 매번 똑같이 반복돼 공간만 차지한다 — ScaleAxis를 맨 위에 한 번만 놓고, 그 아래 각 ScaleBar는
 * minimal로 막대(트랙+채움)만 그리면 된다.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { monitoringColors as mc } from '../styles/theme';

// 채움 색은 지금 값이 4단계 중 어디인지와 상관없이 항상 이 색 하나로 통일한다 — 참고 디자인의
// 브랜드 그린(greenTop)을 그대로 쓴다.
const FILL_COLOR = mc.greenTop;

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

// 눈금 자 느낌만 주는 작은 보조 눈금(값과 무관, 순수 장식) — 10% 간격
const MINOR_TICKS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
// 4단계 경계(25/50/75%)에는 더 진하고 긴 눈금을 그려 실제 구간 경계임을 보여준다
const BOUNDARY_TICKS = [0.25, 0.5, 0.75];

function fmtNum(v) {
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

/** 눈금(보조 눈금 + 굵은 경계 눈금) + 경계 숫자 + 4단계 이름 라벨만 그리는 축 — 같은 segments를 쓰는
 *  스케일 바 여러 개를 쌓을 때 이 축을 맨 위에 한 번만 두고, 아래 막대들은 minimal로 그린다.
 *  값이 없어 채움은 없지만, 아래 막대들과 같은 모양의 빈 트랙(테두리 포함)을 기준선으로 보여준다. */
export function ScaleAxis({ segments }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.track} />

      <View style={styles.tickStrip}>
        {MINOR_TICKS.map((f) => (
          <View key={`m-${f}`} style={[styles.minorTick, { left: `${f * 100}%` }]} />
        ))}
        {BOUNDARY_TICKS.map((f) => (
          <View key={`b-${f}`} style={[styles.boundaryTick, { left: `${f * 100}%` }]} />
        ))}
      </View>

      <View style={styles.tickNumStrip}>
        {BOUNDARY_TICKS.map((f, i) => (
          <Text key={`n-${f}`} style={[styles.tickNum, { left: `${f * 100}%` }]} numberOfLines={1}>
            {fmtNum(segments[i].to)}
          </Text>
        ))}
      </View>

      <View style={styles.labelRow}>
        {segments.map((s, i) => (
          <Text key={i} style={styles.label} numberOfLines={1}>{s.ko}</Text>
        ))}
      </View>
    </View>
  );
}

/** minimal=true면 트랙(막대)만 그리고 눈금/숫자/라벨은 생략한다 — 위에 ScaleAxis가 이미 있을 때 쓴다 */
export default function ScaleBar({ value, segments, minimal = false }) {
  const frac = fillFrac(value, segments);
  return (
    <View style={styles.wrap}>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${frac * 100}%`, backgroundColor: FILL_COLOR }]} />
      </View>
      {!minimal && (
        <>
          {/* 눈금 자 — 촘촘한 보조 눈금 사이사이에 4단계 경계(25/50/75%)만 더 길고 진하게 그린다 */}
          <View style={styles.tickStrip}>
            {MINOR_TICKS.map((f) => (
              <View key={`m-${f}`} style={[styles.minorTick, { left: `${f * 100}%` }]} />
            ))}
            {BOUNDARY_TICKS.map((f) => (
              <View key={`b-${f}`} style={[styles.boundaryTick, { left: `${f * 100}%` }]} />
            ))}
          </View>

          {/* 굵은 눈금 바로 아래에, 그 경계의 실제 값을 숫자로 적는다(segments[i].to = i번째 구간의 위쪽 경계) */}
          <View style={styles.tickNumStrip}>
            {BOUNDARY_TICKS.map((f, i) => (
              <Text key={`n-${f}`} style={[styles.tickNum, { left: `${f * 100}%` }]} numberOfLines={1}>
                {fmtNum(segments[i].to)}
              </Text>
            ))}
          </View>

          <View style={styles.labelRow}>
            {segments.map((s, i) => (
              <Text key={i} style={styles.label} numberOfLines={1}>{s.ko}</Text>
            ))}
          </View>
        </>
      )}
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
  fill: { position: 'absolute', top: 0, left: 0, bottom: 0, borderRadius: 5 },
  tickStrip: { position: 'relative', height: 6, marginTop: 2 },
  minorTick: {
    position: 'absolute', top: 0, width: 1, height: 4,
    backgroundColor: mc.line, marginLeft: -0.5,
  },
  boundaryTick: {
    position: 'absolute', top: 0, width: 1.5, height: 6,
    backgroundColor: mc.sub, marginLeft: -0.75,
  },
  tickNumStrip: { position: 'relative', height: 12, marginTop: 1 },
  tickNum: {
    position: 'absolute', top: 0, width: 30, marginLeft: -15,
    fontSize: 9, color: mc.sub, textAlign: 'center',
  },
  labelRow: { flexDirection: 'row', marginTop: 2 },
  label: { flex: 1, fontSize: 10, color: mc.sub, textAlign: 'center' },
});
