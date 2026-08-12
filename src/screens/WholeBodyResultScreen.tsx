import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { AppColors, cardDecoration } from '../theme';
import Body2DView, { PartMarkerStyle } from '../components/Body2DView';
import { BodyPartId, COARSE_OF_PART, CoarseGroupId, COARSE_GROUPS, partsOfSpotId } from '../monitoring/bodyParts';
import { useFolders, addDaysKey, daysBetween, todayKey, folderHasSeverity } from '../folders/store';
// 넓이 환산은 폴더 카드와 **같은 출처**를 쓴다 — 두 화면이 같은 값을 다르게 말하면 안 된다
import { coveragePctOf, scaleKindOfRecord } from '../folders/areaTrend';
import { DISPLAY_SCALE, skinConditionInfo, SKIN_SEGMENTS, NO_GRADE_COLOR } from '../folders/theme';
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
 * 자리마다 **도형이 둘**이고 서로 다른 것을 말한다:
 *
 *   불투명 원 — 얼마나 나쁜가. 그 시점 "피부 종합 상태" 4단계 색 그대로(SKIN_SEGMENTS)라
 *     다른 화면(카드·그래프)과 같은 체계를 쓴다. 크기는 고정이다.
 *   점선 원   — 얼마나 넓은가. 부위 대비 병변 넓이에 비례한다. **넓이를 잰 회차에만** 그린다.
 *
 * 하나의 원이 색과 크기로 둘을 함께 말하던 때가 있었는데, 그러면 "색이 진해졌는데 작아졌다"처럼
 * 서로 다른 축의 변화가 한 도형에서 섞여 어느 쪽이 나빠진 것인지 읽을 수 없었다.
 *
 * **아토피가 아닌 질환은 회색이다.** 4가지 증상·IGA 모델이 아토피 채점 기준으로 학습돼 있어서
 * 다른 질환에는 등급의 근거가 없고, 기록에는 자리 채우기 0이 들어 있다. 예전에는 그런 폴더를
 * 지도에서 통째로 뺐지만 — 0을 색으로 옮기면 "완전 정상"이 되니 맞는 판단이었다 — 대가로
 * 지켜보는 자리가 지도에 아예 없는 상태가 됐다. 지금은 올리되 어느 단계도 아닌 회색으로 둔다.
 * 넓이는 질환과 무관하게 성립하므로 그 자리에도 점선 원은 그대로 그린다.
 *
 * 아래 "부위별 변화" 목록의 왼쪽 색 막대(trendSwatch)도 같은 색 규칙을 쓴다 — 지도의 동그라미와
 * 목록의 그 자리가 같은 색이어야 "이게 그 부위구나" 하고 눈으로 바로 잇는다. 그 시점 대비
 * 좋아지고 있었는지/나빠지고 있었는지는 색이 아니라 오른쪽 화살표·태그(개선/악화/유지)로 따로
 * 보여준다 — 그래서 그 태그만 별도의 호전/악화 색 체계를 쓴다.
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
 * ── 무엇을 넣는가 ────────────────────────────────────────────────
 * **부위 대비 넓이(coveragePct)**다 — 폴더 카드가 "얼굴의 12%"로 보여주는 바로 그 값. 예전에는
 * 사진 대비 %(lesionAreaPct)를 넣었는데 그건 10cm만 가까이 가도 두 배가 되는 값이라, 같은 병변이
 * 촬영 거리에 따라 다른 크기로 그려졌다. 지도는 회차를 넘겨 가며 보는 화면이라 그 값을 쓸 수 없다.
 *
 * ── 구간을 정하는 기준값 ──────────────────────────────────────────
 *   AREA_MIN  0.5%  — 이 값이 곧 "점선 원이 가장 작아지는 지점"이다.
 *   AREA_FULL 25%   — 이 이상은 최대 크기로 고정한다(saturate).
 *   MIN_R 24, MAX_R 118 — 반지름 폭(94px)을 크게 잡아 상한이 넉넉해도 민감하게 반응한다.
 *                   **몸 윤곽을 넘어가도 된다** — Body2DView의 SVG는 잘라내지 않으므로 원이
 *                   몸 밖으로, 서로 겹치는 자리까지 걸쳐도 그대로 그려진다. 넓이는 이 지도에서
 *                   유일하게 "크기"로만 말하는 값이라, 작게 그리면 변화가 아예 안 읽힌다 —
 *                   몸 그림을 가리지 않는 것보다 그쪽이 훨씬 나쁜 거래다.
 *
 * ⚠️ 상한 25%는 사진 대비 %를 쓰던 시절 데모 폴더의 관측 범위(6~28%)에서 나온 값이다. 입력이
 *    부위 대비 %로 바뀌었으므로 **실제 기록이 쌓이면 다시 잡아야 한다** — 상한은 반드시 실제로
 *    관찰되는 범위를 덮어야 그 안에서 변화가 보인다(한 번 8%로 낮췄다가 회차 대부분이 saturate
 *    구간에 몰려 동그라미가 안 움직이는 것처럼 보여 되돌린 적이 있다).
 *
 * 예시(넓이% → 반지름 px):  0.5%→24   3%→54   5%→64   7%→72   10%→82   15%→96   25%↑→118
 */
const AREA_MIN = 0.5;
const AREA_FULL = 25;
const MARKER_MIN_R = 24;
const MARKER_MAX_R = 118;

function areaToRadius(areaPct: number): number {
  const t = clamp01((areaPct - AREA_MIN) / (AREA_FULL - AREA_MIN));
  return MARKER_MIN_R + (MARKER_MAX_R - MARKER_MIN_R) * Math.sqrt(t);
}

/**
 * 불투명 원(피부 종합 상태)의 반지름 — **고정이다.**
 *
 * 예전에는 이 원 하나가 색으로 상태를, 크기로 넓이를 함께 말했다. 그러면 "색이 진해졌는데
 * 작아졌다"처럼 서로 다른 축의 변화가 한 도형 안에서 섞여, 어느 쪽이 나빠진 것인지 읽을 수 없다.
 * 지금은 상태는 색만, 넓이는 점선 원만 맡는다.
 */
const IGA_MARKER_R = 28;

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
  /** IGA 등급을 매길 수 있는 자리인지 (아토피피부염 폴더만) — false면 색을 회색으로 둔다 */
  gradable: boolean;
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
      const target = folder.targetId ? findTarget(folder.targetId) : undefined;
      if (!target) continue;
      const parts = partsOfSpotId(target.spotId) ?? [target.part];
      out.push({
        folderId: folder.id,
        label: plainSiteLabel(target.label),
        parts,
        records: folder.records,
        /*
          등급(IGA)을 매길 수 있는 자리인지. 4가지 증상·IGA 모델은 아토피 채점 기준으로 학습돼
          있어서 다른 질환에는 근거가 없고, 그런 촬영의 기록에는 **자리 채우기 0**이 들어 있다.

          예전에는 이런 폴더를 지도에서 통째로 뺐다. 0을 그대로 쓰면 "완전 정상"으로 잘못 보이니
          맞는 판단이었지만, 대가로 **지켜보는 자리인데 지도에 아예 없는** 상태가 됐다. 지금은
          올리되 색을 회색으로 둔다 — "여기를 지켜보고 있고, 다만 등급은 매길 수 없다"가
          아무것도 없는 것보다 정확하다. 넓이(점선 원)는 질환과 무관하게 성립하므로 그대로 그린다.
        */
        gradable: folderHasSeverity(folder),
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
    const acc = new Map<
      CoarseGroupId,
      { skinSum: number; skinN: number; areaSum: number; areaN: number }
    >();
    trends.forEach((t) => {
      // 등급을 매길 수 없는 자리의 iga는 자리 채우기 0이라, 평균에 넣으면 "완전 정상"으로 끌어올린다
      const skinValue = t.site.gradable ? DISPLAY_SCALE.iga(t.current.iga) : 0;
      /*
        넓이는 **잰 회차에만** 있다. lesionAreaFaceIndex가 null이면 그날은 자격이 안 돼서 빠진
        것이므로, 0으로 채워 평균에 넣으면 안 된다 — 안 잰 것이 "넓이 0"으로 섞여 들어가 점선
        원이 실제보다 작게 그려진다. 그래서 넓이는 분모(areaN)를 따로 센다.

        값은 areaTrend와 같은 환산을 쓴다 — "부위의 몇 %"(coveragePct). 폴더 카드가 "얼굴의 12%"로
        보여주는 그 숫자와 같아야, 두 화면이 같은 것을 다르게 말하지 않는다.
      */
      const idx = t.current.lesionAreaFaceIndex;
      const hasArea = typeof idx === 'number' && idx > 0;
      const areaValue = hasArea ? coveragePctOf(idx, scaleKindOfRecord(t.current)) : 0;
      const groups = new Set(t.site.parts.map((p) => COARSE_OF_PART[p]));
      groups.forEach((g) => {
        const cur = acc.get(g) ?? { skinSum: 0, skinN: 0, areaSum: 0, areaN: 0 };
        if (t.site.gradable) {
          cur.skinSum += skinValue;
          cur.skinN += 1;
        }
        if (hasArea) {
          cur.areaSum += areaValue;
          cur.areaN += 1;
        }
        acc.set(g, cur);
      });
    });
    /*
      기록이 있는 덩어리만 그린다. 예전에는 지켜보지 않는 덩어리에도 "기록 없음" 색의 최소 크기
      동그라미를 찍었는데, 넷 중 셋이 회색 점인 지도는 **읽을 것이 없는 표시로 그림을 채우는**
      셈이었다. 아무것도 없는 자리는 비워 두는 편이 "여기엔 기록이 없다"를 더 분명히 말한다.
    */
    const out: Partial<Record<CoarseGroupId, PartMarkerStyle>> = {};
    COARSE_GROUPS.forEach((group) => {
      const v = acc.get(group);
      if (!v) return;
      out[group] = {
        /*
          한 덩어리에 등급 있는 자리와 없는 자리가 섞이면 **등급 있는 쪽을 따른다** — 회색은
          "잴 수 있는 것이 하나도 없다"는 뜻이라야 의미가 있다.
        */
        color: v.skinN > 0 ? skinConditionInfo(v.skinSum / v.skinN).color : NO_GRADE_COLOR,
        radius: IGA_MARKER_R,
        areaRadius: v.areaN > 0 ? areaToRadius(v.areaSum / v.areaN) : undefined,
      };
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
/**
 * 두 도형이 서로 다른 것을 말하므로 범례도 두 줄이다 — 색은 상태, 점선은 넓이.
 * "기록 없음" 항목은 뺐다: 이제 기록이 없는 부위에는 아무것도 그리지 않으므로 가리킬 도형이 없다.
 */
function Legend() {
  return (
    <>
      <View style={styles.legendRow}>
        {[...SKIN_SEGMENTS].reverse().map((seg) => (
          <View key={seg.ko} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: seg.color }]} />
            <Text style={styles.legendText}>{seg.ko}</Text>
          </View>
        ))}
        {/* 아토피가 아닌 질환 — 등급 모델의 근거가 없어 어느 단계도 아니다 */}
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: NO_GRADE_COLOR }]} />
          <Text style={styles.legendText}>등급 없음</Text>
        </View>
      </View>
      <View style={{ height: 6 }} />
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={styles.legendAreaDot} />
          <Text style={styles.legendText}>점선 = 병변 넓이 (잰 회차에만)</Text>
        </View>
      </View>
    </>
  );
}

function TrendRow({ trend }: { trend: SiteTrend }) {
  const { site, current, previous, delta } = trend;
  const skinValue = DISPLAY_SCALE.iga(current.iga);
  const skin = skinConditionInfo(skinValue);
  // 등급이 없는 자리에는 변화도 없다 — 0에서 0으로 간 것을 "유지"라고 말하면 안 된다
  const tag = site.gradable && previous ? trendLabel(delta) : null;

  return (
    <View style={[cardDecoration(16), styles.trendRow]}>
      <View
        style={[styles.trendSwatch, { backgroundColor: site.gradable ? skin.color : NO_GRADE_COLOR }]}
      />
      <View style={{ flex: 1 }}>
        <Text style={styles.trendSite}>{site.label}</Text>
        {/*
          등급을 매길 수 없는 자리에는 점수를 적지 않는다. 기록에 들어 있는 0은 자리 채우기라,
          "피부 종합 상태 100 좋음"으로 적으면 앱이 없는 판정을 지어내는 것이 된다.
        */}
        <Text style={styles.trendMeta}>
          {current.date.replace(/-/g, '.')} 기준 ·{' '}
          {site.gradable ? (
            <>
              피부 종합 상태 {Math.round(skinValue)}
              <Text style={{ color: skin.color }}> {skin.ko}</Text>
            </>
          ) : (
            '아토피가 아니라 등급을 매기지 않아요'
          )}
        </Text>
      </View>
      {tag ? (
        <View style={[styles.trendTag, { backgroundColor: `${tag.color}22` }]}>
          <MaterialIcons name={tag.icon} size={14} color={tag.color} />
          <Text style={[styles.trendTagText, { color: tag.color }]}>{tag.text}</Text>
        </View>
      ) : (
        <View style={styles.trendTag}>
          <Text style={styles.trendTagText}>{site.gradable ? '첫 기록' : '등급 없음'}</Text>
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
  /** 점선 원 범례 — 지도의 도형과 같은 모양이라야 무엇을 가리키는지 바로 읽힌다 */
  legendAreaDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: AppColors.sub,
  },
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
