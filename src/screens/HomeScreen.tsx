import React, { useEffect, useRef } from 'react';
import { Animated, ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { AppColors, cardDecoration } from '../theme';
import { CareItem } from '../models';
import { SectionHeader, RoutineRowContent } from '../components/widgets';
import { useRoutines } from '../context/RoutineContext';
import { useProfile } from '../context/ProfileContext';
import { useLatestMonitoringRecord } from '../folders/store';
import { DISPLAY_SCALE, skinConditionInfo, itchBand, sleepBand } from '../folders/theme';
import { StatBox } from '../components/MetricCard';

export default function HomeScreen({ navigation }: { navigation: any }) {
  const { careItemsForOffset, toggleForOffset } = useRoutines();
  const { name, healthConnected } = useProfile();
  const latest = useLatestMonitoringRecord();

  /** 요약 카드를 누르면 가장 최근 촬영의 상세 결과 페이지로 바로 넘어간다 */
  const goLatestDetail = () => {
    if (!latest) return;
    navigation.navigate('MonitoringDetail', { folderId: latest.folder.id, recordId: latest.record.id });
  };

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24 }}
    >
      <Text style={styles.greeting}>안녕하세요, {name}님</Text>
      <View style={{ height: 3 }} />
      <Text style={styles.headline}>오늘 피부 상태를 확인해볼까요?</Text>
      <View style={{ height: 18 }} />

      <RecentStatusCard
        record={latest?.record}
        healthConnected={healthConnected}
        onPress={goLatestDetail}
      />

      <View style={{ height: 14 }} />
      {/* 문진 없이 지금 피부만 찍어 결과만 보는 길 — 기록으로 남기지 않는다.
          오늘 할 일(루틴) 목록보다 먼저 두어, 상태를 확인한 바로 다음 동작으로 이어지게 한다. */}
      <Pressable
        onPress={() => navigation.navigate('Camera', { mode: 'quick' })}
        style={[cardDecoration(), styles.quickCard]}
      >
        <View style={styles.quickIcon}>
          <MaterialIcons name="center-focus-strong" size={22} color="#16320A" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.quickTitle}>피부 바로 스캔</Text>
          <Text style={styles.quickSub}>피부를 빠르게 촬영하고 분석 결과를 확인해요</Text>
          {/* 누르면 바로 카메라로 들어가므로, 저장되지 않는다는 건 여기서 미리 알려야 한다 */}
          <Text style={styles.noticeText}>피부 바로 스캔 기능으로 촬영한 사진은 저장되지 않아요</Text>
        </View>
      </Pressable>

      <SectionHeader title="오늘의 피부 케어" onMore={() => navigation.navigate('Routine')} />
      <TodayCareCard
        items={careItemsForOffset(0)}
        onToggle={(key) => toggleForOffset(0, key)}
      />
    </ScrollView>
  );
}

/**
 * "경과 관찰" 요약 카드 — 상세 결과·경과 관찰 화면과 같은 생김새(큰 숫자 + 단계 배지)를 쓴다.
 * 예전의 진한 초록 카드는 값이 작아 정작 중요한 "지금 어느 단계인지"가 눈에 안 들어왔다.
 */
function RecentStatusCard({
  record,
  healthConnected,
  onPress,
}: {
  record?: { iga: number; itchVas: number; sleepScore: number };
  healthConnected: boolean;
  onPress: () => void;
}) {
  if (!record) {
    return (
      <View style={[cardDecoration(), styles.emptyStatus]}>
        <MaterialIcons name="photo-camera" size={26} color={AppColors.sub} />
        <View style={{ height: 8 }} />
        <Text style={styles.emptyStatusText}>아직 기록이 없어요{'\n'}첫 촬영을 남기면 여기에 상태가 쌓여요</Text>
      </View>
    );
  }

  const skinValue = DISPLAY_SCALE.iga(record.iga);
  const itchValue = DISPLAY_SCALE.itch(record.itchVas);
  const sleepValue = healthConnected ? record.sleepScore : null;

  return (
    <Pressable onPress={onPress} style={[cardDecoration(), styles.statusCard]}>
      <View style={styles.statusHead}>
        <Text style={styles.statusTitle} numberOfLines={1}>
          최근 피부 상태
        </Text>
        <View style={{ flex: 1 }} />
        <MaterialIcons name="chevron-right" size={20} color={AppColors.sub} />
      </View>
      <View style={styles.statusRow}>
        <StatBox label="피부 종합 상태" value={`${Math.round(skinValue)}`} band={skinConditionInfo(skinValue)} />
        <StatBox label="가려움 안정도" value={`${itchValue}`} band={itchBand(itchValue)} />
        <StatBox
          label="수면 점수"
          value={sleepValue != null ? `${sleepValue}` : '-'}
          band={sleepValue != null ? sleepBand(sleepValue) : null}
        />
      </View>
    </Pressable>
  );
}

/**
 * "오늘의 피부 케어" 카드 — 오늘 할 일상 루틴과 사용 제품을 시각 순으로 섞어 보여준다.
 * 사용자가 추가한 항목은 몇 개든 다 보여준다 — 예전엔 3개까지만 보이고 나머지는 "더 보기"로
 * 루틴 탭까지 가야 했는데, 홈에서 오늘 할 일을 한눈에 다 보는 게 우선이라 잘라내지 않는다.
 * 지난 날짜를 넘겨보는 기능은 두지 않는다 — 홈에서는 "오늘 무엇이 남았는지"만 보면 되고,
 * 지난 기록은 기록 탭에서 본다.
 */
function TodayCareCard({ items, onToggle }: { items: CareItem[]; onToggle: (key: string) => void }) {
  if (items.length === 0) {
    return (
      <View style={[cardDecoration(), styles.careEmpty]}>
        <Text style={styles.careEmptyText}>오늘 등록된 루틴·제품이 없어요</Text>
      </View>
    );
  }
  return (
    <View style={[cardDecoration(), { paddingHorizontal: 18 }]}>
      {items.map((item, i) => (
        <View
          key={item.key}
          style={[
            { paddingVertical: 15 },
            i !== items.length - 1 && { borderBottomWidth: 1, borderBottomColor: AppColors.line },
          ]}
        >
          <FadingCareRow item={item} onToggle={() => onToggle(item.key)} />
        </View>
      ))}
    </View>
  );
}

/** 체크 시 목록에서 사라지지 않고, 줄긋기와 함께 서서히 흐려지는 홈 케어 행 */
function FadingCareRow({ item, onToggle }: { item: CareItem; onToggle?: () => void }) {
  const opacity = useRef(new Animated.Value(item.done ? 0.45 : 1)).current;
  useEffect(() => {
    Animated.timing(opacity, {
      toValue: item.done ? 0.45 : 1,
      duration: 400,
      useNativeDriver: true,
    }).start();
  }, [item.done, opacity]);
  return (
    <Animated.View style={{ opacity }}>
      <RoutineRowContent item={item} onToggle={onToggle} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  greeting: { fontSize: 14, color: AppColors.sub },
  headline: { fontSize: 18, fontWeight: '700', color: AppColors.ink },

  statusCard: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16 },
  statusHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  statusTitle: { fontSize: 16.5, fontWeight: '800', color: AppColors.ink, flexShrink: 1 },
  statusRow: { flexDirection: 'row', gap: 8 },

  emptyStatus: { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 20 },
  emptyStatusText: { fontSize: 13, color: AppColors.sub, textAlign: 'center', lineHeight: 19 },

  careEmpty: { alignItems: 'center', paddingVertical: 24, paddingHorizontal: 20 },
  careEmptyText: { fontSize: 13, color: AppColors.sub },

  // 피부 촬영 탭의 "피부 바로 스캔" 카드와 같은 치수를 쓴다 — 같은 글이 한쪽에서만 두 줄로
  // 접히지 않게 하려면 글자가 놓이는 폭까지 같아야 한다
  quickCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  quickIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: AppColors.greenTop,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickTitle: { fontSize: 16, fontWeight: '800', color: AppColors.ink },
  quickSub: { fontSize: 12, color: AppColors.sub, lineHeight: 17, marginTop: 4 },
  noticeText: { fontSize: 11.5, fontWeight: '600', color: AppColors.sub, lineHeight: 17, marginTop: 4 },
});
