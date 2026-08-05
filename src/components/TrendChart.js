/**
 * 수면 점수 · 가려움(VAS) · 피부 종합 상태(IGA)를 하나의 결합 그래프에 겹쳐 그린다.
 * 세 지표 모두 theme.js의 DISPLAY_SCALE로 0~100 표시값으로 맞춰서 같은 축, 같은 25/50/75/100
 * 눈금 위에 그대로 겹쳐 그린다(다른 화면의 스케일 바·요약 박스와 완전히 같은 스케일).
 * 셋 다 같은 방식(꺾은선 + 점)으로 그려서, 색으로만 지표를 구분한다.
 *   - 수면 점수: 이미 0~100 → 그대로, 파란 꺾은선
 *   - 피부 종합 상태 IGA(기댓값, 0~4의 연속값) × 25: 쿨 그레이 꺾은선
 *   - 가려움 VAS(0~10) × 10: 웜 브라운 꺾은선
 *
 * 점 하나(=촬영 1회)가 항상 POINT_W만큼의 고정 폭을 차지하도록 그려서, 기록이 많아
 * 한 화면에 안 들어가도 잘라내지 않고 옆으로 계속 이어지게 한다. 화면 쪽(부모)이
 * 이 그래프와 날짜/사진 행을 같은 가로 ScrollView 안에 두면 스크롤해도 서로 어긋나지 않는다.
 * 그래프 위에는 포인트 폭만큼의 투명 터치 영역을 겹쳐 그려서, 포인트를 한 번 탭하면
 * onSelect(record)로 선택만 바뀌어 그 날짜의 세로 폭 전체가 초록색 띠로 물들고(요약 박스도
 * 갱신), 같은 포인트를 다시 한번(두 번째) 탭하면 onDoubleSelect(record)로 그 기록의 상세
 * 결과로 넘어간다.
 *
 * 세로 높이는 부모가 넘겨주는 고정값 chartHeight를 그대로 쓴다 — 예전에는 남는 공간을 실측해서
 * 꽉 채우도록 계산했지만, 화면이 좁으면 그 계산이 어긋나면서 그래프 아래 날짜/사진 줄이 화면
 * 밖으로 밀려 잘리는 문제가 있었다. 고정 높이를 쓰고, 넘치면 부모 화면이 세로로 스크롤하게 하는
 * 편이 어떤 화면 크기에서도 안전하다.
 */
import React, { useRef } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Svg, { Polyline, Circle, Line, Rect } from 'react-native-svg';
import { monitoringColors as mc, CHART_SERIES, DISPLAY_SCALE } from '../styles/theme';

export const MIN_CHART_H = 150; // chartHeight를 안 넘겨줬을 때 쓰는 기본값
export const POINT_W = 64; // 그래프 점 하나 = 점 아래 날짜/사진 칸과 반드시 같은 폭이어야 정렬됨
export const Y_AXIS_W = 34; // 왼쪽 y축 숫자 라벨 칼럼 폭 — 가로 스크롤과 무관하게 고정
const PAD_TOP = 10;
const PAD_BOTTOM = 8;

// 0(바닥)은 축 자체가 기준선이라 라벨을 따로 안 그리고, 가로줄 4개를 25 단위로 균등하게 긋는다
const GRID_VALUES = [100, 75, 50, 25];
const AXIS_MAX = 100;

// 그래프에 그리는 순서 — 뒤에 그릴수록 위에 겹쳐 보인다. 파란 수면 점수를 맨 위에 그려 항상 또렷하게 보이게 한다.
const SERIES_ORDER = ['skin', 'itch', 'sleep'];

export function chartContentWidth(n) {
  return Math.max(POINT_W, POINT_W * n);
}

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const xAt = (i) => (i + 0.5) * POINT_W;
const yAt = (v, h) => PAD_TOP + (1 - clamp01(v / AXIS_MAX)) * (h - PAD_TOP - PAD_BOTTOM);

// 정규화 — 다른 화면(요약 박스·상세 결과)과 같은 DISPLAY_SCALE로 셋 다 0~100 표시값으로 맞춘다
export const normalize = {
  sleep: (r) => r.sleepScore, // 0~100 그대로
  itch: (r) => DISPLAY_SCALE.itch(r.itchVas), // VAS(0~10) × 10 → 0~100
  skin: (r) => DISPLAY_SCALE.iga(r.iga), // IGA 기댓값(0~4) × 25 → 0~100
};

function toPointsAttr(pts) {
  return pts.map(([x, y]) => `${x},${y}`).join(' ');
}

const DOUBLE_TAP_MS = 300;

/**
 * 결합 그래프 본체 — 지표 이름은 TrendChartLegend가, 좌우 y축 숫자는 TrendChartYAxis가 각각
 * 스크롤 밖 고정 자리에 그린다. selectedId와 같은 기록의 폭 전체를 옅은 초록 띠로 칠해 어떤
 * 날짜가 선택되어 있는지 보여주고, 포인트를 한 번 탭하면 onSelect(record)로 선택을 바꾸고, 같은
 * 포인트를 300ms 안에 두 번 탭(더블클릭)하면 onDoubleSelect(record)로 상세 결과로 넘어가라는
 * 신호를 준다.
 */
export default function TrendChart({ records, chartHeight = MIN_CHART_H, selectedId, onSelect, onDoubleSelect }) {
  const n = records.length;
  const width = chartContentWidth(n);
  const h = chartHeight;
  const selectedIndex = Math.max(0, records.findIndex((r) => r.id === selectedId));
  const lastTapRef = useRef({});

  const handlePress = (r) => {
    const now = Date.now();
    const last = lastTapRef.current[r.id] || 0;
    if (now - last < DOUBLE_TAP_MS) {
      lastTapRef.current[r.id] = 0;
      onDoubleSelect?.(r);
    } else {
      lastTapRef.current[r.id] = now;
      onSelect?.(r);
    }
  };

  // 지표별 (x, y) 점 목록을 미리 계산해 둔다 — 꺾은선과 점 둘 다 이 좌표를 그대로 쓴다.
  const seriesPts = {};
  SERIES_ORDER.forEach((key) => {
    seriesPts[key] = records.map((r, i) => [xAt(i), yAt(normalize[key](r), h)]);
  });

  return (
    <View style={{ width, height: h }}>
      <Svg width={width} height={h}>
        {/* 선택된 날짜를 가리키는 세로 띠 — 점선 대신 그 날짜의 폭(POINT_W) 전체를 옅은 초록으로
            칠해서 강조한다. 그리드/데이터보다 먼저 그려서 뒤(배경)에 깔린다. 기본은 가장 최근
            기록(오른쪽 끝). */}
        {records[selectedIndex] && (
          <Rect
            x={xAt(selectedIndex) - POINT_W / 2} y={0} width={POINT_W} height={h}
            fill={mc.greenTop} opacity={0.22}
          />
        )}

        {/* 가로줄 4개 — 25 단위로 균등한 위치, 왼쪽 y축과 같은 실제 값(25/50/75/100)을 쓴다 */}
        {GRID_VALUES.map((v) => {
          const y = yAt(v, h);
          return <Line key={`grid-${v}`} x1={0} y1={y} x2={width} y2={y} stroke={mc.line} strokeWidth={1} />;
        })}

        {/* 세 지표 모두 같은 방식(꺾은선 + 점)으로 그린다 — 뒤에 그릴수록 위에 겹쳐 보인다 */}
        {SERIES_ORDER.map((key) => {
          const pts = seriesPts[key];
          const color = CHART_SERIES[key].color;
          return (
            <React.Fragment key={key}>
              {n > 1 && (
                <Polyline points={toPointsAttr(pts)} fill="none" stroke={color}
                  strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />
              )}
              {records.map((r, i) => (
                <Circle key={`${key}-pt-${r.id}`} cx={pts[i][0]} cy={pts[i][1]}
                  r={i === selectedIndex ? 4.6 : 3.4} fill={color} stroke="#fff"
                  strokeWidth={i === selectedIndex ? 1.8 : 1.2} />
              ))}
            </React.Fragment>
          );
        })}
      </Svg>

      {/* 터치 영역 — 포인트 하나(POINT_W 폭)를 한 번 탭하면 그 날짜가 선택되고, 두 번 연속 탭(더블클릭)하면 상세 결과로 넘어간다 */}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <View style={{ flexDirection: 'row', width, height: h }}>
          {records.map((r) => (
            <Pressable key={`hit-${r.id}`} style={{ width: POINT_W, height: h }} onPress={() => handlePress(r)} />
          ))}
        </View>
      </View>
    </View>
  );
}

/** 그래프 왼쪽에 고정으로 붙는 y축 숫자 칼럼(0~100) — TrendChart의 가로줄과 같은 높이에 맞춰 그린다 */
export function TrendChartYAxis({ chartHeight = MIN_CHART_H }) {
  return (
    <View style={{ width: Y_AXIS_W, height: chartHeight }}>
      {GRID_VALUES.map((v) => (
        <Text key={v} style={[styles.axisLabel, { top: yAt(v, chartHeight) - 7 }]}>{v}</Text>
      ))}
    </View>
  );
}

/**
 * 세 지표가 한 그래프에 겹쳐 그려지므로, 무엇이 무슨 색인지 알려주는 범례 배지 — 그래프
 * 위에 겹쳐서 100 가로줄과 부딪히지 않도록, 그래프보다 먼저 일반 문서 흐름으로 그 위에 놓고
 * 쓴다(더 이상 absolute 겹침이 아니라 그래프를 아래로 밀어내는 자기 자리를 가진 한 줄이다).
 */
export function TrendChartLegend() {
  return (
    <View style={styles.legendRow}>
      {['skin', 'itch', 'sleep'].map((key) => {
        const s = CHART_SERIES[key];
        return (
          <View key={key} style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: s.color }]} />
            <Text style={styles.labelText}>{s.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  legendRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10,
    paddingHorizontal: 3, paddingBottom: 8,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  labelText: { fontSize: 10.5, color: mc.ink, fontWeight: '600' },
  axisLabel: {
    position: 'absolute', right: 6, fontSize: 10, color: mc.sub,
    textAlign: 'right', width: Y_AXIS_W - 6,
  },
});
