import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { AppColors, cardDecoration } from '../theme';
import Body3DView from '../components/Body3DView';
import { BodyPartId, COARSE_OF_PART, partsOfSpotId } from '../monitoring/bodyParts';
import { BodyModelId } from '../three/humanModel';
import { useFolders, addDaysKey, daysBetween, todayKey } from '../folders/store';
import { DISPLAY_SCALE, skinConditionInfo } from '../folders/theme';
import { useMonitoring } from '../context/MonitoringContext';
import { plainSiteLabel } from '../models';

/**
 * 전신 결과 — 지켜보는 자리들의 호전/악화를 3D 인체 위에 색으로 얹어 한 눈에 본다.
 *
 * 부위 선택·경과 관찰에서 쓰는 것과 **같은 3D 메시**(Body3DView)를 그대로 쓰되, 부위마다 다른
 * 색을 입힐 수 있게 partColors를 넘긴다. 지금 색을 칠하는 단위가 머리·몸통·팔·다리 네 덩어리라
 * 앞모습 한 벌이면 모든 자리가 다 드러나서, 정면만 크게 보여준다.
 *
 * 아래 슬라이더를 끌면 그 날짜 시점의 색으로 바뀐다 — "그때 이 부위가 좋아지는 중이었나"를
 * 되짚어 보는 타임라인이다.
 */

/** 추세를 재는 창 — 그 시점에서 이만큼 이전의 기록과 견준다 */
const TREND_WINDOW_DAYS = 14;
/** 이만큼(IGA 0~4 스케일) 변하면 색이 끝까지 간다 */
const FULL_SWING = 1.5;

const TREND_COLORS = {
  better: '#4FB86A',
  same: '#EFD152',
  worse: '#E2584B',
  none: '#DCE1E8',
} as const;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
}

const toHex = (v: number) => Math.round(v).toString(16).padStart(2, '0');

/** -1(뚜렷한 호전, 초록) ~ 0(유지, 노랑) ~ +1(뚜렷한 악화, 빨강) */
function trendColor(score: number): string {
  const t = Math.min(1, Math.max(-1, score));
  const [from, to, localT] =
    t < 0
      ? [hexToRgb(TREND_COLORS.better), hexToRgb(TREND_COLORS.same), t + 1]
      : [hexToRgb(TREND_COLORS.same), hexToRgb(TREND_COLORS.worse), t];
  return `#${from.map((c, i) => toHex(c + (to[i] - c) * localT)).join('')}`;
}

/** 색만으로는 미묘한 차이가 읽히지 않아서 글자로도 같이 알려 준다 */
function trendLabel(delta: number): { text: string; color: string; icon: 'trending-down' | 'trending-flat' | 'trending-up' } {
  if (delta <= -0.3) return { text: '호전', color: TREND_COLORS.better, icon: 'trending-down' };
  if (delta >= 0.3) return { text: '악화', color: TREND_COLORS.worse, icon: 'trending-up' };
  return { text: '유지', color: '#B99A18', icon: 'trending-flat' };
}

interface TrackedSite {
  folderId: string;
  /** 화면에 쓰는 자리 이름 ("팔", "머리" …) */
  label: string;
  parts: BodyPartId[];
  records: any[];
}

/** 슬라이더가 가리키는 시점에서 한 자리가 어떤 상태였는지 */
interface SiteTrend {
  site: TrackedSite;
  /** 그 시점의 가장 최근 기록 */
  current: any;
  /** 견줄 대상이 된 이전 기록 (없으면 첫 기록 하나뿐이라는 뜻) */
  previous: any | null;
  /** IGA 변화량 (양수 = 악화) */
  delta: number;
}

export default function WholeBodyResultScreen() {
  const folders = useFolders();
  const { findTarget, targets } = useMonitoring();

  // 폴더 → 3D 부위. 대상(MonitorTarget)이 없는 폴더는 몸의 어디인지 알 수 없어 지도에 올리지 못한다.
  const sites = useMemo<TrackedSite[]>(() => {
    const out: TrackedSite[] = [];
    for (const folder of folders) {
      if (!folder.records.length) continue;
      const target = folder.targetId ? findTarget(folder.targetId) : undefined;
      if (!target) continue;
      const parts = partsOfSpotId(target.spotId) ?? [target.part];
      out.push({
        folderId: folder.id,
        label: plainSiteLabel(target.label),
        parts,
        records: folder.records,
      });
    }
    return out;
  }, [folders, findTarget]);

  const today = todayKey();
  // 슬라이더가 훑는 구간 — 가장 오래된 기록부터 오늘까지
  const span = useMemo(() => {
    let oldest = today;
    sites.forEach((s) => {
      const first = s.records[0].date;
      if (daysBetween(first, oldest) > 0) oldest = first;
    });
    return Math.max(0, daysBetween(oldest, today));
  }, [sites, today]);

  // 0 = 가장 오래된 날, span = 오늘. 처음에는 오늘을 보여준다.
  const [tick, setTick] = useState<number | null>(null);
  const dayIndex = Math.min(span, tick ?? span);
  const daysAgo = span - dayIndex;
  const selectedKey = addDaysKey(today, -daysAgo);

  const trends = useMemo<SiteTrend[]>(() => {
    const out: SiteTrend[] = [];
    const windowKey = addDaysKey(selectedKey, -TREND_WINDOW_DAYS);
    for (const site of sites) {
      const upto = site.records.filter((r) => daysBetween(r.date, selectedKey) >= 0);
      if (!upto.length) continue; // 이 시점엔 아직 등록 전이다
      const current = upto[upto.length - 1];
      const earlier = upto.filter((r) => daysBetween(r.date, windowKey) >= 0);
      // 창 안에 이전 기록이 없으면 첫 기록과 견준다 — 등록 직후에도 방향은 알려줘야 한다.
      // 마지막 촬영 자체가 창보다 오래됐으면 그 바로 앞 기록이 비교 대상이 된다.
      const picked = earlier.length ? earlier[earlier.length - 1] : upto[0];
      const previous = picked !== current ? picked : upto.length > 1 ? upto[upto.length - 2] : null;
      out.push({ site, current, previous, delta: previous ? current.iga - previous.iga : 0 });
    }
    return out;
  }, [sites, selectedKey]);

  // 한 부위에 여러 자리가 겹치면(예: 팔 두 곳) 평균을 낸다
  const partColors = useMemo<Partial<Record<BodyPartId, string>>>(() => {
    const acc = new Map<BodyPartId, { sum: number; n: number }>();
    trends.forEach((t) => {
      const score = Math.min(1, Math.max(-1, t.delta / FULL_SWING));
      t.site.parts.forEach((p) => {
        const cur = acc.get(p);
        if (cur) {
          cur.sum += score;
          cur.n += 1;
        } else acc.set(p, { sum: score, n: 1 });
      });
    });
    // 지켜보지 않는 부위도 "기록 없음" 색으로 명시해 둔다 — 기본 살색으로 남겨 두면 범례와
    // 어긋나서 "회색인데 왜 기록이 없다는 거지"가 된다
    const out: Partial<Record<BodyPartId, string>> = {};
    (Object.keys(COARSE_OF_PART) as BodyPartId[]).forEach((part) => {
      const v = acc.get(part);
      out[part] = v ? trendColor(v.sum / v.n) : TREND_COLORS.none;
    });
    return out;
  }, [trends]);

  const modelId: BodyModelId = targets[0]?.modelId ?? 'adultMale';

  if (!sites.length) {
    return (
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 24, flexGrow: 1 }}
      >
        <Text style={styles.subtitle}>지켜보는 자리가 쌓이면 전신 지도에 표시돼요</Text>
        <View style={styles.emptyWrap}>
          <MaterialIcons name="accessibility-new" size={40} color={AppColors.sub} />
          <View style={{ height: 10 }} />
          <Text style={styles.emptyText}>아직 표시할 기록이 없어요</Text>
        </View>
      </ScrollView>
    );
  }

  const [y, m, d] = selectedKey.split('-').map(Number);

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 32 }}
    >
      <Text style={styles.subtitle}>
        슬라이더를 끌면 그 시점에 부위별로 좋아지고 있었는지 색으로 보여줘요
      </Text>
      <View style={{ height: 14 }} />

      <View style={[cardDecoration(), styles.mapCard]}>
        <View style={styles.bodyCanvas}>
          <Body3DView modelId={modelId} partColors={partColors} view={{ yaw: 0, pitch: 0 }} rotatable={false} />
        </View>

        <View style={{ height: 6 }} />
        <Text style={styles.dayLabel}>{daysAgo === 0 ? '오늘' : `${daysAgo}일 전`}</Text>
        <Text style={styles.dateLabel}>
          {y}.{m}.{d}
        </Text>
        <View style={{ height: 8 }} />

        <DaySlider max={span} value={dayIndex} onChange={setTick} />
        <View style={styles.sliderEnds}>
          <Text style={styles.endText}>{span === 0 ? '오늘' : `${span}일 전`}</Text>
          <Text style={styles.endText}>오늘</Text>
        </View>

        <View style={{ height: 16 }} />
        <Legend />
      </View>

      <View style={{ height: 18 }} />
      <Text style={styles.sectionTitle}>부위별 변화</Text>
      <Text style={styles.sectionCaption}>
        최근 {TREND_WINDOW_DAYS}일 사이의 피부 종합 상태 변화 기준
      </Text>
      <View style={{ height: 10 }} />

      {trends.length === 0 ? (
        <View style={[cardDecoration(), styles.noneCard]}>
          <Text style={styles.emptyText}>이 시점에는 아직 기록이 없어요</Text>
        </View>
      ) : (
        trends.map((t, i) => (
          <View key={t.site.folderId} style={i !== trends.length - 1 ? { marginBottom: 10 } : undefined}>
            <TrendRow trend={t} />
          </View>
        ))
      )}
    </ScrollView>
  );
}

/**
 * 날짜 슬라이더 — 0(가장 오래된 기록) ~ max(오늘).
 * 손가락 x는 화면 절대좌표로만 안정적으로 얻을 수 있어서, 트랙이 놓인 위치를 재 두고 그 차이로
 * 값을 계산한다 (가려움 문진의 VAS 슬라이더와 같은 방식).
 */
function DaySlider({ max, value, onChange }: { max: number; value: number; onChange: (v: number) => void }) {
  const trackRef = useRef<View>(null);
  const geom = useRef({ x: 0, width: 0 });
  const maxRef = useRef(max);
  maxRef.current = max;

  const updateFromPageX = (pageX: number) => {
    const { x, width } = geom.current;
    if (width <= 0) return;
    onChange(Math.round(clamp01((pageX - x) / width) * maxRef.current));
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      // 세로로 끌면 스크롤에 양보한다 — 화면 전체가 스크롤 안에 있다
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderGrant: (e) => updateFromPageX(e.nativeEvent.pageX),
      onPanResponderMove: (_e, g) => updateFromPageX(g.moveX),
    }),
  ).current;

  const frac = max > 0 ? value / max : 1;

  return (
    <View
      ref={trackRef}
      style={styles.sliderTrack}
      onLayout={() => trackRef.current?.measureInWindow((x, _y, width) => { geom.current = { x, width }; })}
      {...pan.panHandlers}
    >
      <View style={styles.sliderRail} />
      <View style={[styles.sliderFill, { width: `${frac * 100}%` }]} />
      <View style={[styles.sliderThumb, { left: `${frac * 100}%` }]} />
    </View>
  );
}

function Legend() {
  const items: { color: string; text: string }[] = [
    { color: TREND_COLORS.better, text: '호전' },
    { color: TREND_COLORS.same, text: '유지' },
    { color: TREND_COLORS.worse, text: '악화' },
    { color: TREND_COLORS.none, text: '기록 없음' },
  ];
  return (
    <View style={styles.legendRow}>
      {items.map((it) => (
        <View key={it.text} style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: it.color }]} />
          <Text style={styles.legendText}>{it.text}</Text>
        </View>
      ))}
    </View>
  );
}

function TrendRow({ trend }: { trend: SiteTrend }) {
  const { site, current, previous, delta } = trend;
  const skinValue = DISPLAY_SCALE.iga(current.iga);
  const skin = skinConditionInfo(skinValue);
  const tag = previous ? trendLabel(delta) : null;
  // 표시값(0~100) 기준 변화량 — 카드의 상태 값과 같은 눈금이라야 읽힌다
  const shift = DISPLAY_SCALE.iga(delta);

  return (
    <View style={[cardDecoration(16), styles.trendRow]}>
      <View style={[styles.trendSwatch, { backgroundColor: trendColor(Math.min(1, Math.max(-1, delta / FULL_SWING))) }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.trendSite}>{site.label}</Text>
        <Text style={styles.trendMeta}>
          {current.date.replace(/-/g, '.')} 기준 · 피부 종합 상태 {skinValue.toFixed(1)}
          <Text style={{ color: skin.color }}> {skin.ko}</Text>
        </Text>
      </View>
      {tag ? (
        <View style={[styles.trendTag, { backgroundColor: `${tag.color}22` }]}>
          <MaterialIcons name={tag.icon} size={14} color={tag.color} />
          <Text style={[styles.trendTagText, { color: tag.color }]}>
            {tag.text} {shift > 0 ? '+' : ''}
            {shift.toFixed(1)}
          </Text>
        </View>
      ) : (
        <View style={styles.trendTag}>
          <Text style={styles.trendTagText}>첫 기록</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  subtitle: { fontSize: 13.5, color: AppColors.sub },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: AppColors.ink },
  sectionCaption: { fontSize: 12, color: AppColors.sub, marginTop: 3 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 80 },
  emptyText: { fontSize: 14, color: AppColors.sub },

  mapCard: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 18 },
  bodyCanvas: { width: '100%', height: 320 },

  dayLabel: { textAlign: 'center', fontSize: 15, fontWeight: '800', color: AppColors.ink },
  dateLabel: { textAlign: 'center', fontSize: 11.5, color: AppColors.sub, marginTop: 2 },

  sliderTrack: { height: 34, justifyContent: 'center' },
  sliderRail: { height: 4, borderRadius: 2, backgroundColor: AppColors.line },
  sliderFill: { position: 'absolute', height: 4, borderRadius: 2, backgroundColor: AppColors.greenTop },
  sliderThumb: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    marginLeft: -10,
    backgroundColor: AppColors.greenTop,
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  sliderEnds: { flexDirection: 'row', justifyContent: 'space-between' },
  endText: { fontSize: 11, color: AppColors.sub },

  legendRow: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 8 },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginRight: 5 },
  legendText: { fontSize: 11.5, color: AppColors.sub },

  noneCard: { padding: 18, alignItems: 'center' },
  trendRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14 },
  trendSwatch: { width: 8, height: 34, borderRadius: 4, marginRight: 12 },
  trendSite: { fontSize: 14.5, fontWeight: '700', color: AppColors.ink },
  trendMeta: { fontSize: 11.5, color: AppColors.sub, marginTop: 2 },
  trendTag: { flexDirection: 'row', alignItems: 'center', borderRadius: 9, paddingHorizontal: 8, paddingVertical: 5, backgroundColor: '#F1F3F6' },
  trendTagText: { fontSize: 11, fontWeight: '800', color: AppColors.sub, marginLeft: 2 },
});
