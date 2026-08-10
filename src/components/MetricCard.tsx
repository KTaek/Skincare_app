import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AppColors } from '../theme';
import { monitoringColors as mc, monitoringCard, segmentFor } from '../folders/theme';
import ScaleBar from '../folders/components/ScaleBar';

type Segment = { to: number; ko: string; color: string };

/**
 * 지표 하나를 보여주는 카드 — 피부 촬영 분석 결과 화면과 경과 관찰 상세 결과 화면이 **같은**
 * 컴포넌트를 써서 생김새가 어긋나지 않게 한다.
 *
 * 읽는 순서는 "무엇을 / 지금 어느 단계인지 / 얼마나"다: 제목 옆에 단계 배지를 크게 달고, 그
 * 아래 막대는 단계 색으로 채워 길이와 색이 같은 이야기를 하게 만든다. 숫자는 참고값이라
 * 제목 옆에 작게 붙인다.
 */
export function MetricCard({
  label,
  value,
  unit = '',
  segments,
  foot,
  children,
}: {
  label: string;
  value: number;
  /** 몇 점 만점인지 값 옆에 덧붙인다 (예: "/100") — 기본은 안 붙인다 */
  unit?: string;
  segments: Segment[];
  foot?: string;
  children?: React.ReactNode;
}) {
  const band = segmentFor(value, segments);
  return (
    <View style={[monitoringCard(), styles.card]}>
      <View style={styles.headRow}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>
          {Math.round(value)}
          {unit !== '' && <Text style={styles.unit}>{unit}</Text>}
        </Text>
        <View style={{ flex: 1 }} />
        <Badge text={band.ko} color={band.color} />
      </View>
      <ScaleBar value={value} segments={segments} />
      {foot != null && <Text style={styles.foot}>{foot}</Text>}
      {children}
    </View>
  );
}

/**
 * 증상 4종처럼 카드 하나 안에 여러 지표를 쌓을 때 쓰는 줄. 카드와 같은 배치(제목 · 숫자 ·
 * 배지 · 막대)를 한 단계 작은 크기로 반복한다.
 */
export function MetricRow({
  label,
  value,
  unit = '',
  segments,
  first,
}: {
  label: string;
  value: number;
  /** 몇 점 만점인지 값 옆에 덧붙인다 (예: "/100") — 기본은 안 붙인다 */
  unit?: string;
  segments: Segment[];
  /** 카드 안 첫 줄이면 위 구분선을 그리지 않는다 */
  first?: boolean;
}) {
  const band = segmentFor(value, segments);
  return (
    <View style={[styles.row, first && styles.rowFirst, !first && styles.rowDivided]}>
      <View style={styles.headRow}>
        <Text style={styles.rowLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.rowValue}>
          {Math.round(value)}
          {unit !== '' && <Text style={styles.rowUnit}>{unit}</Text>}
        </Text>
        <View style={{ flex: 1 }} />
        <Badge text={band.ko} color={band.color} small />
      </View>
      <ScaleBar value={value} segments={segments} compact />
    </View>
  );
}

/** 측정하지 않은 지표 — 0점으로 넣으면 실제로 좋았던 날과 구분이 안 되므로 값 없이 남긴다 */
export function EmptyMetricCard({ label, text }: { label: string; text: string }) {
  return (
    <View style={[monitoringCard(), styles.card]}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{text}</Text>
      </View>
    </View>
  );
}

/**
 * 지표 하나를 작은 정사각 박스로 보여주는 요약칸 — 라벨 / 큰 숫자 / 단계 배지를 세로로 쌓는다.
 * 홈의 "최근 피부 상태" 카드가 원래 자리이고, 기록 탭의 날짜별 분석 결과도 같은 모양을 써서
 * 어느 화면에서 봐도 같은 지표는 같게 보이게 한다. 세 칸을 나란히(피부 종합 상태 · 가려움 ·
 * 수면 점수) 쓰는 게 기본 쓰임이다.
 */
export function StatBox({
  label,
  value,
  band,
}: {
  label: string;
  value: string;
  band: { ko: string; color: string } | null;
}) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
      <View style={{ height: 7 }} />
      <Text style={styles.statValue}>{value}</Text>
      <View style={{ height: 7 }} />
      {band ? <Badge text={band.ko} color={band.color} small /> : <Text style={styles.statNone}>미기재</Text>}
    </View>
  );
}

export function Badge({ text, color, small }: { text: string; color: string; small?: boolean }) {
  return (
    <View style={[styles.badge, small && styles.badgeSmall, { backgroundColor: color }]}>
      <Text style={[styles.badgeText, small && styles.badgeTextSmall]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16 },
  headRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  label: { fontSize: 16, fontWeight: '800', color: mc.ink },
  value: { fontSize: 15, fontWeight: '800', color: mc.ink, marginLeft: 8 },
  unit: { fontSize: 11, fontWeight: '700', color: mc.sub },
  foot: { fontSize: 11.5, color: mc.sub, marginTop: 10, lineHeight: 17 },

  row: { paddingTop: 14 },
  // 카드 제목("4가지 증상") 바로 아래 줄은 제목 여백과 겹치지 않게 붙인다
  rowFirst: { paddingTop: 0 },
  rowDivided: { borderTopWidth: 1, borderTopColor: mc.line, marginTop: 14 },
  rowLabel: { fontSize: 14, fontWeight: '800', color: mc.ink, flexShrink: 1 },
  rowValue: { fontSize: 13.5, fontWeight: '800', color: mc.ink, marginLeft: 8 },
  rowUnit: { fontSize: 10, fontWeight: '700', color: mc.sub },

  badge: { borderRadius: 9, paddingHorizontal: 12, paddingVertical: 6, minWidth: 62, alignItems: 'center' },
  badgeSmall: { paddingHorizontal: 10, paddingVertical: 4, minWidth: 54 },
  badgeText: { fontSize: 13, fontWeight: '800', color: '#FFFFFF' },
  badgeTextSmall: { fontSize: 11.5 },

  empty: {
    borderRadius: 12, backgroundColor: mc.bg, borderWidth: 1, borderColor: mc.line,
    paddingVertical: 18, alignItems: 'center',
  },
  emptyText: { fontSize: 15, fontWeight: '800', color: mc.sub },

  statBox: {
    flex: 1, alignItems: 'center', backgroundColor: '#F6F8FA', borderRadius: 14,
    paddingVertical: 12, paddingHorizontal: 4,
  },
  statLabel: { fontSize: 11, fontWeight: '600', color: AppColors.sub },
  statValue: { fontSize: 21, fontWeight: '800', color: AppColors.ink },
  statNone: { fontSize: 11.5, fontWeight: '800', color: AppColors.sub, paddingVertical: 4 },
});
