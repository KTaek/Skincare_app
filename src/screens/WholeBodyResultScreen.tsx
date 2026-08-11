import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { AppColors, cardDecoration } from '../theme';
import Body2DView, { PartMarkerStyle } from '../components/Body2DView';
import { BodyPartId, COARSE_OF_PART, CoarseGroupId, COARSE_GROUPS, partsOfSpotId } from '../monitoring/bodyParts';
import { useFolders, addDaysKey, daysBetween, todayKey, folderHasSeverity } from '../folders/store';
import { DISPLAY_SCALE, skinConditionInfo, SKIN_SEGMENTS } from '../folders/theme';
import { useMonitoring } from '../context/MonitoringContext';
import { plainSiteLabel } from '../models';

/**
 * 전신 결과 — 지켜보는 자리들의 "지금 상태"를 인체 그림 위에 동그라미로 얹어 한 눈에 본다.
 *
 * 그림은 부위 선택 화면(PartSelectScreen)과 같은 2D 몸 그림(Body2DView)을 그대로 쓴다 — 등록 흐름과
 * 결과 화면이 다른 그림을 쓰면 "그때 고른 그 팔"이라는 감각이 끊긴다. 다만 부위 선택은 고른 덩어리
 * 전체를 색으로 칠하지만, 여기서는 덩어리 전체가 아니라 그 덩어리 안 정해진 자리에 작은 동그라미만
 * 찍는다(partMarkers) — 팔 전체가 병변인 게 아니라 "팔 어딘가에 병변이 있다"는 뜻이라서다.
 *
 * 동그라미 색은 그 시점 "피부 종합 상태" 값 그대로다 — 다른 화면(피부 종합 상태 카드·그래프)과
 * 같은 4단계(좋음·주의·나쁨·매우 나쁨, SKIN_SEGMENTS)를 써서, 여기서만 다른 색 체계(호전/유지/
 * 악화)를 따로 배우지 않아도 된다. 아래 "부위별 변화" 목록의 왼쪽 색 막대(trendSwatch)도 같은
 * skinConditionInfo 색을 쓴다 — 지도의 동그라미와 목록의 그 자리가 같은 색이어야 "이게 그 부위구나"
 * 하고 눈으로 바로 잇는다. 그 시점 대비 좋아지고 있었는지/나빠지고 있었는지는 색이 아니라 오른쪽
 * 화살표·태그(개선/악화/유지)로 따로 보여준다 — 그래서 그 태그만 별도의 호전/악화 색 체계를 쓴다.
 *
 * 아래 슬라이더를 끌면 그 날짜 시점의 색으로 바뀐다 — "그때 이 부위가 어떤 상태였나"를 되짚어
 * 보는 타임라인이다.
 */

/** 추세를 재는 창 — 그 시점에서 이만큼 이전의 기록과 견준다 */
const TREND_WINDOW_DAYS = 14;

const TREND_COLORS = {
  better: '#4FB86A',
  same: '#EFD152',
  worse: '#E2584B',
} as const;

/** 지켜보지 않는 부위(동그라미)·아직 기록이 없는 구간의 회색 — 지도 범례·동그라미 둘 다 이 색을 쓴다 */
const NO_RECORD_COLOR = '#DCE1E8';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * 동그라미 크기 ↔ 병변 넓이(%) 매핑.
 *
 * 넓이는 카메라 촬영 분석(analyzeLocal의 maskAreaPct)이 매 회차 재서 기록에 남기는 값
 * (folders/store.js recordExam → record.lesionAreaPct)이다. 그 값이 줄면 동그라미도 작아지고,
 * 늘면 커진다 — 색(피부 종합 상태)과는 별개 축이라 "덜 붉어졌지만 아직 넓다" 같은 상태도
 * 색·크기 두 신호로 따로 읽힌다.
 *
 * ── 반지름이 아니라 "넓이"에 선형이어야 하는 이유 ──────────────────────
 * 동그라미는 시각적으로 "넓이"를 나타낸다. 사람 눈에 面積(원의 넓이 = πr²)로 읽히는 도형에서
 * 반지름을 넓이%에 그대로 비례시키면(r ∝ area%) 실제 넓이는 area%의 제곱으로 부풀어 보인다 —
 * 절반으로 줄어든 병변이 화면에서는 넓이가 1/4로 줄어든 것처럼 보인다. 그래서 반지름은
 * area%의 **제곱근**에 비례시킨다(r ∝ √area%) — 이래야 원의 넓이 자체가 area%에 선형으로
 * 비례해서, "줄어든 비율"이 눈에 보이는 크기 변화 비율과 맞는다. 사진 카드의 병변 윤곽선
 * (folders/components/LesionThumb.js)도 같은 원칙(√area% 비례)을 쓴다 — 앱 전체가 병변
 * 넓이를 그리는 방식을 통일해 둔 것이다.
 *
 * ── 구간을 정하는 기준값 ──────────────────────────────────────────
 * ⚠️ AREA_FULL을 한 번 8%까지 낮췄다가(민감도만 보고) 되돌린 적이 있다 — 데모 폴더의 실제 병변
 *    넓이는 보통 6~28% 사이를 오가는데, 상한을 8%로 두면 그 범위 대부분이 이미 상한을 넘겨
 *    "항상 최대 크기"로 고정되고, 슬라이더를 끝까지 움직여도 동그라미가 거의 안 움직이는
 *    것처럼 보였다(회차 대부분이 saturate 구간에 몰려서). 상한은 반드시 **실제로 관찰되는 값의
 *    범위를 덮어야** 그 안에서 변화가 보인다 — 민감도는 상한을 낮추는 대신 MIN_R/MAX_R 폭을
 *    넓혀서 확보한다.
 *   AREA_MIN  0.5%  — recordExam이 기록을 저장할 때 두는 하한(clamp)과 같다 — 그 아래 값 자체가
 *                   없으므로 이 값이 곧 "동그라미가 가장 작아지는 지점"이다.
 *   AREA_FULL 25%  — 이 이상은 최대 크기로 고정한다(saturate). store.js 데모 폴더들의 병변 넓이
 *                   상한이 대략 22~28% 사이라(폴더마다 다른 from/to의 iga로 정해짐), 그 실측
 *                   범위를 거의 다 덮는 값으로 잡았다 — 그래야 슬라이더를 끝에서 끝까지 움직이는
 *                   동안 대부분의 구간에서 동그라미가 실제로 커졌다 작아졌다 한다.
 *   MIN_R 16, MAX_R 68 — 반지름 폭(52px)을 크게 잡아서, 상한을 25%로 넉넉히 잡고도 웬만큼
 *                   민감하게 반응한다 — 예: 15%→13.3%(약 −1.7%p, 한 회차 정도의 전형적인 변화)만
 *                   돼도 반지름이 56.0→53.6으로 준다. 가운데 숫자(존재하는 세부 증상 개수)도
 *                   항상 큼직하게 보여야 하므로 하한(16)도 예전보다 작게 잡지 않았다. 몸 그림
 *                   (Body2DView)의 SVG는 잘라내지 않으므로(그 컴포넌트의 주석 참고) 동그라미가
 *                   몸 윤곽 밖으로, 서로 겹치는 자리까지도 걸칠 수 있다 — 그래도 잘리지 않고
 *                   그대로 그려진다.
 *
 * 예시(면적% → 반지름 px):  0.5%→16   3%→32.6   5%→38.3   7%→42.8   10%→48.4   15%→56.0   20%→62.4   25%↑→68
 */
const AREA_MIN = 0.5;
const AREA_FULL = 25;
const MARKER_MIN_R = 16;
const MARKER_MAX_R = 68;

function areaToRadius(areaPct: number): number {
  const t = clamp01((areaPct - AREA_MIN) / (AREA_FULL - AREA_MIN));
  return MARKER_MIN_R + (MARKER_MAX_R - MARKER_MIN_R) * Math.sqrt(t);
}

/** 지켜보지 않는(기록 없는) 덩어리의 동그라미 — 크기로도 "잴 값이 없다"를 보여주려 최소 크기로 둔다 */
const NO_RECORD_RADIUS = MARKER_MIN_R;

/**
 * 존재하는 세부 증상 개수 — 홍반·구진·긁은 상처·태선화 중 0보다 큰(=등급이 매겨진) 것만 센다.
 *
 * 부위별 증상 카드(ExamResultScreen의 RegionSymptomsCard)와 달리 **크롭 이미지 기준이 아니라
 * 그 촬영의 대표값(가장 나쁜 판정 단위)** 그대로다 — 기록에 저장되는 값 자체가 이미 그 대표값이라
 * (folders/store.js recordExam), 특정 판정 단위 하나만 골라 셀 수도 없고 그럴 필요도 없다. 전신
 * 지도는 "이 부위 전체가 지금 어떤 상태인가"를 보는 화면이라, 그 자리의 기록이 대표하는 값 하나로
 * 충분하다.
 */
function symptomCountOf(record: any): number {
  return [record.redness, record.bumps, record.scratch, record.thickening].filter((v) => v > 0).length;
}

/**
 * 색만으로는 미묘한 차이가 읽히지 않아서 글자로도 같이 알려 준다.
 *
 * delta는 IGA 원래 척도(낮을수록 좋음)라 "개선"이 실제로는 숫자가 줄어드는 쪽이지만, 아이콘은
 * 주가 그래프처럼 "위로 오르면 좋다"는 직관을 따른다 — 개선=trending-up, 악화=trending-down으로
 * 일부러 뒤집어 둔다. 경과 관찰 카드(TrendMini)의 "개선/악화" 용어와도 맞춘다.
 */
function trendLabel(delta: number): { text: string; color: string; icon: 'trending-down' | 'trending-flat' | 'trending-up' } {
  if (delta <= -0.3) return { text: '개선', color: TREND_COLORS.better, icon: 'trending-up' };
  if (delta >= 0.3) return { text: '악화', color: TREND_COLORS.worse, icon: 'trending-down' };
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
  const { findTarget } = useMonitoring();

  // 폴더 → 몸 그림의 덩어리. 대상(MonitorTarget)이 없는 폴더는 몸의 어디인지 알 수 없어 지도에 올리지 못한다.
  const sites = useMemo<TrackedSite[]>(() => {
    const out: TrackedSite[] = [];
    for (const folder of folders) {
      if (!folder.records.length) continue;
      // 이 지도는 IGA(피부 종합 상태) 변화를 비교하는 화면이라, 아토피피부염이 아닌 폴더는 그
      // 값 자체가 없어(플레이스홀더 0) 끼워 넣으면 늘 "완전 정상"으로 잘못 보인다.
      if (!folderHasSeverity(folder)) continue;
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

  // 한 덩어리(머리·몸통·팔·다리)에 여러 자리가 겹치면(예: 팔 두 곳) 평균을 낸다. site.parts는
  // 세부 부위(BodyPartId)라 COARSE_OF_PART로 네 덩어리 중 하나로 먼저 묶는다 — 등록 흐름이 항상
  // 이 네 덩어리 단위로만 자리를 만들어서(PartSelectScreen), 실제로는 site.parts가 전부 같은
  // 덩어리에 속한다. 색은 그 시점 "피부 종합 상태"(0~100 표시값) 평균을 SKIN_SEGMENTS 4단계로
  // 매긴다 — 다른 화면의 피부 종합 상태 카드·그래프와 같은 기준이다. 크기는 같은 평균 방식으로
  // 낸 "병변 넓이(%)" 평균을 areaToRadius로 반지름으로 바꾼 값이다 — 색과 크기가 서로 다른 값
  // (상태 vs 넓이)에서 나오므로 둘은 독립적으로 움직인다. 가운데 숫자(존재하는 세부 증상 개수)도
  // 같은 방식으로 평균 내어 반올림한다 — 슬라이더로 회차를 넘겨 호전되면 이 숫자가 줄어든다.
  const groupMarkers = useMemo<Partial<Record<CoarseGroupId, PartMarkerStyle>>>(() => {
    const acc = new Map<CoarseGroupId, { skinSum: number; areaSum: number; symptomSum: number; n: number }>();
    trends.forEach((t) => {
      const skinValue = DISPLAY_SCALE.iga(t.current.iga);
      // 옛 dump 기록 등 lesionAreaPct가 없는 경우를 대비해 0으로 폴백 — 최소 크기로 그려진다
      const areaValue = typeof t.current.lesionAreaPct === 'number' ? t.current.lesionAreaPct : 0;
      const symptomValue = symptomCountOf(t.current);
      const groups = new Set(t.site.parts.map((p) => COARSE_OF_PART[p]));
      groups.forEach((g) => {
        const cur = acc.get(g);
        if (cur) {
          cur.skinSum += skinValue;
          cur.areaSum += areaValue;
          cur.symptomSum += symptomValue;
          cur.n += 1;
        } else acc.set(g, { skinSum: skinValue, areaSum: areaValue, symptomSum: symptomValue, n: 1 });
      });
    });
    // 지켜보지 않는 덩어리도 "기록 없음" 색·최소 크기로 명시해 둔다 — 동그라미를 아예 안 찍으면
    // 범례와 어긋나서 "왜 이 부위엔 동그라미가 없지"가 된다. count는 아예 넣지 않는다 —
    // 잴 값이 없는 부위에 "0"을 적으면 "다 나았다"처럼 보인다.
    const out: Partial<Record<CoarseGroupId, PartMarkerStyle>> = {};
    COARSE_GROUPS.forEach((group) => {
      const v = acc.get(group);
      out[group] = v
        ? {
            color: skinConditionInfo(v.skinSum / v.n).color,
            radius: areaToRadius(v.areaSum / v.n),
            count: Math.round(v.symptomSum / v.n),
          }
        : { color: NO_RECORD_COLOR, radius: NO_RECORD_RADIUS };
    });
    return out;
  }, [trends]);

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
      <View style={[cardDecoration(), styles.mapCard]}>
        <View style={styles.bodyCanvas}>
          <Body2DView partMarkers={groupMarkers} />
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

/** 지도 동그라미와 같은 기준(SKIN_SEGMENTS) — 안 좋은 쪽부터 정의돼 있어서 좋은 쪽부터 보이게 뒤집는다 */
function Legend() {
  const items: { color: string; text: string }[] = [
    ...[...SKIN_SEGMENTS].reverse().map((s) => ({ color: s.color, text: s.ko })),
    { color: NO_RECORD_COLOR, text: '기록 없음' },
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

  return (
    <View style={[cardDecoration(16), styles.trendRow]}>
      <View style={[styles.trendSwatch, { backgroundColor: skin.color }]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.trendSite}>{site.label}</Text>
        <Text style={styles.trendMeta}>
          {current.date.replace(/-/g, '.')} 기준 · 피부 종합 상태 {Math.round(skinValue)}
          <Text style={{ color: skin.color }}> {skin.ko}</Text>
        </Text>
      </View>
      {tag ? (
        <View style={[styles.trendTag, { backgroundColor: `${tag.color}22` }]}>
          <MaterialIcons name={tag.icon} size={14} color={tag.color} />
          <Text style={[styles.trendTagText, { color: tag.color }]}>{tag.text}</Text>
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
