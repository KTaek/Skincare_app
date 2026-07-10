import React from 'react';
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { AppColors, cardDecoration } from '../theme';
import {
  BODY_REGION_LABELS,
  RegionHeat,
  SkinRecord,
  recentItchSeries,
  regionHeatmap,
  weeklyItchStats,
} from '../models';
import BodyHeatmapView from '../components/BodyHeatmapView';
import LineChart from '../components/LineChart';

export default function ItchDetailScreen({
  records,
  onBack,
}: {
  records: Record<string, SkinRecord[]>;
  onBack: () => void;
}) {
  const series = recentItchSeries(records, 8);
  const weekly = weeklyItchStats(records);
  const trend: 'down' | 'up' | null =
    weekly.thisWeekAvg == null || weekly.lastWeekAvg == null
      ? null
      : weekly.thisWeekAvg < weekly.lastWeekAvg
        ? 'down'
        : weekly.thisWeekAvg > weekly.lastWeekAvg
          ? 'up'
          : null;
  const heat = regionHeatmap(records);
  const topRegion = heat.reduce<RegionHeat | null>(
    (best, r) => (r.count > 0 && (!best || r.score > best.score) ? r : best),
    null,
  );

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={onBack}>
          <MaterialIcons name="chevron-left" size={24} color={AppColors.ink} />
        </Pressable>
        <Text style={styles.headerTitle}>가려움 정도 추이</Text>
      </View>

      <View style={[cardDecoration(), styles.card]}>
        <Text style={styles.cardTitle}>최근 가려움 변화</Text>
        <View style={{ height: 14 }} />
        <LineChart
          data={series.map((s) => ({ date: s.date, value: s.itch }))}
          maxValue={10}
          color={AppColors.greenTop}
          emptyText="아직 검사 기록이 없어요."
        />
      </View>

      <View style={{ height: 14 }} />

      <View style={[cardDecoration(), styles.card, { flexDirection: 'row' }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.metricLabel}>이번 주 평균</Text>
          <View style={{ height: 6 }} />
          <Text style={styles.metricValue}>
            {weekly.thisWeekAvg != null ? weekly.thisWeekAvg.toFixed(1) : '-'}
            <Text style={styles.metricUnit}> / 10</Text>
          </Text>
        </View>
        <View style={styles.cardDivider} />
        <View style={{ flex: 1 }}>
          <Text style={styles.metricLabel}>전 주 대비</Text>
          <View style={{ height: 6 }} />
          <Text style={styles.metricValue}>{weekly.deltaText}</Text>
        </View>
      </View>

      {trend && (
        <>
          <View style={{ height: 14 }} />
          <TrendTipCard trend={trend} />
        </>
      )}

      <View style={{ height: 14 }} />

      <View style={[cardDecoration(), styles.card]}>
        <Text style={styles.cardTitle}>부위별 히트맵</Text>
        <View style={{ height: 4 }} />
        <Text style={styles.cardSub}>최근 30일 동안 가려움/중증 빈도가 높은 부위일수록 빨갛게 표시돼요</Text>
        <View style={{ height: 18 }} />
        <BodyHeatmapView heat={heat} />
        <View style={{ height: 18 }} />
        <Text style={styles.cardSub}>
          {topRegion
            ? `가장 주의가 필요한 부위: ${BODY_REGION_LABELS[topRegion.region]}`
            : '최근 30일 동안 기록된 부위 데이터가 없어요'}
        </Text>
      </View>
    </ScrollView>
  );
}

function TrendTipCard({ trend }: { trend: 'down' | 'up' }) {
  const isDown = trend === 'down';
  return (
    <View style={[styles.tipCard, isDown ? styles.tipCardDown : styles.tipCardUp]}>
      <View style={[styles.tipIcon, isDown ? styles.tipIconDown : styles.tipIconUp]}>
        <MaterialIcons
          name={isDown ? 'trending-down' : 'trending-up'}
          size={20}
          color={isDown ? '#2E8B57' : '#D9534F'}
        />
      </View>
      <View style={{ width: 12 }} />
      <Text style={[styles.tipText, isDown ? styles.tipTextDown : styles.tipTextUp]}>
        {isDown ? (
          <Text style={styles.tipBold}>가려움이 줄어들고 있어요. </Text>
        ) : (
          <Text style={styles.tipBold}>가려움이 늘고 있어 많이 불편했겠어요. </Text>
        )}
        {isDown
          ? '지금처럼 꾸준히 관리한 결과가 나타나고 있으니, 오늘도 피부가 편안해질 수 있게 보습과 자극 줄이기를 이어가보세요.'
          : '오늘은 긁기보다 냉찜질과 보습으로 피부를 먼저 진정시키고, 증상이 계속 심해지면 의료진 상담을 받아보세요.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 24 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  backBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: AppColors.ink },
  card: { padding: 18 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: AppColors.ink },
  cardSub: { fontSize: 12.5, color: AppColors.sub, lineHeight: 18 },
  cardDivider: { width: 1, backgroundColor: AppColors.line, marginHorizontal: 14 },
  metricLabel: { fontSize: 12, fontWeight: '600', color: AppColors.sub },
  metricValue: { fontSize: 19, fontWeight: '800', color: AppColors.ink },
  metricUnit: { fontSize: 13, fontWeight: '600', color: AppColors.sub },

  tipCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14 },
  tipCardDown: { backgroundColor: '#EAF7EE' },
  tipCardUp: { backgroundColor: '#FDEDEC' },
  tipIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  tipIconDown: { backgroundColor: '#FFFFFF' },
  tipIconUp: { backgroundColor: '#FFFFFF' },
  tipText: { flex: 1, fontSize: 12.5, lineHeight: 18 },
  tipTextDown: { color: '#1F6B3F' },
  tipTextUp: { color: '#A33A33' },
  tipBold: { fontWeight: '800' },
});
