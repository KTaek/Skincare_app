import { AppColors } from './theme';

/**
 * 케어 항목 — 루틴 화면의 두 갈래("일상 루틴" / "사용 제품")를 같은 모양으로 다룬다.
 *
 * 둘은 사용자가 보기엔 다른 목록이지만 (이름 · 실행 시각 · PUSH 알람 · 오늘 했는지)를 공유해서,
 * 홈의 "오늘의 피부 케어"는 둘을 한 목록에 담아 보여준다 — 사용 제품을 먼저, 일상 루틴을 그
 * 아래에 묶고, 각 묶음 안에서는 시각순으로 둔다(RoutineContext.careItemsForOffset). 제품만
 * "사용 주기"를 추가로 갖는다 — 매일 쓰는 보습제와 격일로 가는 음압 패치를 한 목록에서
 * 구분해야 하기 때문이다.
 */
export type CareKind = 'routine' | 'product';

export interface Routine {
  id: number;
  name: string;
  /**
   * 하루 중 실행 시각들 — 원소 수가 곧 "하루 횟수"다(["09:00"] = 하루 1회, ["09:00","21:00"] =
   * 하루 2회). 시각을 정해두지 않은 실행은 null로 남긴다 — 등록은 하되 특정 시각에 매이지
   * 않는 루틴("생각날 때 하기")을 위해서다. 최소 한 원소는 항상 있다(시각 없이 하루 1회면
   * [null]).
   */
  times: (string | null)[];
  done: boolean;
  /** PUSH 알람 수신 여부 */
  push: boolean;
}

/** 사용 제품 — 루틴에 "사용 주기(일)"가 붙은 것 */
export interface CareProduct extends Routine {
  /** 며칠에 한 번 쓰는지 (1 = 매일, 2 = 격일 …) */
  cycleDays: number;
}

/**
 * 화면에 뿌릴 때 쓰는 합본 항목 — 루틴/제품 어느 쪽에서 왔는지 kind로 구분한다.
 * Routine.times(하루 여러 번) 하나는 그 횟수만큼 CareItem 여러 개로 펼쳐진다 — 목록의 한 줄이
 * "그날의 실행 한 번"과 1:1로 대응해야 각 줄을 따로 체크할 수 있기 때문이다.
 */
export interface CareItem {
  id: number;
  name: string;
  /** 이 실행(occurrence) 하나의 시각 — 정해두지 않았으면 null */
  time: string | null;
  done: boolean;
  push: boolean;
  kind: CareKind;
  /** 제품일 때만 채워진다 */
  cycleDays?: number;
  /** 목록 key 겸 토글 대상 식별자 ("product:3:0") — id는 종류별로만, occurrence는 그 안에서만 유일 */
  key: string;
  /** 그날 쓰는 항목인지 — 주기가 맞지 않는 제품은 false (루틴은 항상 true) */
  due: boolean;
  /** 하루 여러 번 중 몇 번째(0-based)인지 — 시각이 없을 때 "1회/2회"로 구분해 보여주는 데 쓴다 */
  occurrenceIndex: number;
  /** 이 항목의 하루 총 횟수 — 1이면 굳이 회차를 표시하지 않는다 */
  occurrenceCount: number;
}

export const careItemKey = (kind: CareKind, id: number, occurrenceIndex = 0): string =>
  `${kind}:${id}:${occurrenceIndex}`;

/** 사용 주기 라벨 — 1일이면 "매일", 2일이면 "격일", 그 외엔 "N일마다" */
export function cycleLabel(cycleDays: number): string {
  if (cycleDays <= 1) return '매일';
  if (cycleDays === 2) return '격일';
  return `${cycleDays}일마다`;
}

/** 신체 영역 — 촬영 전 사용자가 표시한 증상 위치를 6개 구역으로 단순화 */
export type BodyRegion = 'head' | 'leftArm' | 'rightArm' | 'torso' | 'leftLeg' | 'rightLeg';

export const BODY_REGION_LABELS: Record<BodyRegion, string> = {
  head: '머리',
  leftArm: '왼쪽 팔',
  rightArm: '오른쪽 팔',
  torso: '몸통',
  leftLeg: '왼쪽 다리',
  rightLeg: '오른쪽 다리',
};

export const BODY_REGIONS: BodyRegion[] = ['head', 'leftArm', 'rightArm', 'torso', 'leftLeg', 'rightLeg'];

/** 촬영 기록 — 실제로는 카메라 분석 결과가 누적됨 */
export interface SkinRecord {
  date: Date;
  disease: string;
  sev: number; // 1..3
  itch: string;
  region?: BodyRegion;
  photoUri?: string;
  /** 모니터링 촬영으로 저장된 기록일 때만 채워진다 */
  siteLabel?: string;
  /** 촬영·후처리 신뢰도 (0~100). 낮은 기록은 추세에서 가중치를 낮춰야 한다 */
  confidence?: number;
}

/**
 * 목록에 보여줄 부위 이름에서 좌우 구분을 뗀다 (예: "왼쪽 팔오금" → "팔오금").
 *
 * 좌우는 촬영할 때(3D에서 자리를 고를 때) 필요하지만, 며칠 뒤 목록에서 "좌측 팔 / 우측 팔"을
 * 보면 어느 쪽이었는지 기억하지 못한다 — 그래서 화면에 뿌릴 때만 떼고 데이터는 그대로 둔다.
 */
export function plainSiteLabel(label: string): string {
  return label.replace(/^(왼쪽|오른쪽|좌측|우측)\s*/, '');
}

/** 홈 상단 카드에 표시되는 최근 상태 (질환명 · 증상 중증도) */
export interface SkinStatus {
  disease: string;
  sev: number;
}

/** 중증도 정보 (단계 / 색 / 라벨) */
export interface Severity {
  stage: string;
  color: string;
  label: string;
}

export const kSeverity: Record<number, Severity> = {
  1: { stage: '1단계', color: AppColors.sev1, label: '경증' },
  2: { stage: '2단계', color: AppColors.sev2, label: '중등증' },
  3: { stage: '3단계', color: AppColors.sev3, label: '중증' },
};

export const sevOf = (s: number): Severity => kSeverity[s] ?? kSeverity[1];

/** ===== 시드 데이터 (서버 연동 전 예시) ===== */

export const kUserName = '임경택';

/** 일상 루틴 시드 — 사용자가 직접 추가/삭제할 수 있다 */
export const initialRoutines = (): Routine[] => [
  { id: 4, name: '피부 상태 사진찍기', times: ['09:00'], done: false, push: true },
  { id: 1, name: '손톱 짧게 깎기', times: ['12:00'], done: false, push: true },
  { id: 2, name: '물 마시기', times: ['14:00'], done: false, push: true },
  { id: 3, name: '미지근한 물로 샤워하기', times: ['18:00'], done: false, push: false },
];

/** 사용 제품 시드 — 상세 결과의 "사용한 제품"도 이 목록에서 나온다 */
export const initialProducts = (): CareProduct[] => [
  { id: 1, name: 'BT4 Complex', times: ['09:00', '21:00'], done: false, push: true, cycleDays: 1 },
  { id: 2, name: '음압 패치', times: ['14:00'], done: false, push: true, cycleDays: 2 },
  { id: 3, name: '보습제', times: ['18:00'], done: false, push: false, cycleDays: 1 },
];

/** 1970-01-01부터 며칠째인지 — 사용 주기 판정의 기준축 */
function epochDay(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

/**
 * 그 날짜가 이 제품을 쓰는 날인지 — 주기(cycleDays)로 자동 판정한다.
 * 달력상의 절대 날짜를 기준으로 나눠서, 어제/내일을 넘겨봐도 판정이 흔들리지 않는다.
 */
export function isCycleDay(cycleDays: number, date: Date = new Date()): boolean {
  if (cycleDays <= 1) return true;
  return epochDay(date) % cycleDays === 0;
}

export const recordKey = (d: Date): string => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/** 기준일에서 days만큼 이동한 날짜 (음수면 과거) */
export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** 홈의 "루틴" 카드를 좌우로 넘길 때 붙이는 날짜 라벨 (예: "오늘 · 8월 6일", "2일 전 · 8월 4일") */
export function dayOffsetLabel(offsetDays: number, date: Date): string {
  const md = `${date.getMonth() + 1}월 ${date.getDate()}일`;
  if (offsetDays === 0) return `오늘 · ${md}`;
  if (offsetDays === -1) return `어제 · ${md}`;
  if (offsetDays === 1) return `내일 · ${md}`;
  return offsetDays < 0 ? `${-offsetDays}일 전 · ${md}` : `${offsetDays}일 후 · ${md}`;
}

export function buildSeedRecords(): Record<string, SkinRecord[]> {
  const now = new Date();
  const map: Record<string, SkinRecord[]> = {};
  const add = (offset: number, dis: string, sev: number, itch: string, region: BodyRegion) => {
    const d = new Date(now);
    d.setDate(d.getDate() - offset);
    const key = recordKey(d);
    map[key] = [...(map[key] ?? []), { date: d, disease: dis, sev, itch, region }];
  };

  add(2, '아토피 피부염', 2, '4 / 10', 'leftArm');
  add(9, '아토피 피부염', 3, '7 / 10', 'leftArm');
  add(16, '접촉성 피부염', 1, '2 / 10', 'torso');
  add(23, '아토피 피부염', 2, '5 / 10', 'rightLeg');
  return map;
}

export const parseItch = (itch: string): number => parseInt(itch.split('/')[0].trim(), 10);

/** 검사 기록 중 가장 최근 것을 토대로 홈 화면 상단에 표시할 질환명·중증도를 계산 */
export function currentStatusFromRecords(records: Record<string, SkinRecord[]>): SkinStatus {
  const [latest] = Object.values(records)
    .flat()
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  return { disease: latest.disease, sev: latest.sev };
}

/** 하루를 4구간으로 나눠 시간대별 가려움 패턴을 본다 */
export type TimeSlot = 'dawn' | 'morning' | 'afternoon' | 'night';

export const TIME_SLOT_LABELS: Record<TimeSlot, string> = {
  dawn: '새벽',
  morning: '오전',
  afternoon: '오후',
  night: '밤',
};

export function timeSlotOf(date: Date): TimeSlot {
  const h = date.getHours();
  if (h < 6) return 'dawn';
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'night';
}

export interface TimeSlotItch {
  slot: TimeSlot;
  avgItch: number;
  count: number;
}

/** 기록을 시간대별로 묶어, 평균 가려움이 가장 높은 시간대를 찾는다 */
export function worstItchTimeSlot(records: Record<string, SkinRecord[]>): TimeSlotItch | null {
  const list = Object.values(records).flat();
  const buckets: Record<TimeSlot, { sum: number; count: number }> = {
    dawn: { sum: 0, count: 0 },
    morning: { sum: 0, count: 0 },
    afternoon: { sum: 0, count: 0 },
    night: { sum: 0, count: 0 },
  };

  list.forEach((r) => {
    const bucket = buckets[timeSlotOf(r.date)];
    bucket.sum += parseItch(r.itch);
    bucket.count += 1;
  });

  let best: TimeSlotItch | null = null;
  (Object.keys(buckets) as TimeSlot[]).forEach((slot) => {
    const b = buckets[slot];
    if (b.count === 0) return;
    const avgItch = b.sum / b.count;
    if (!best || avgItch > best.avgItch) best = { slot, avgItch, count: b.count };
  });
  return best;
}

export interface WeeklyItchStats {
  thisWeekAvg: number | null;
  lastWeekAvg: number | null;
  deltaText: string;
}

/** 최근 7일 평균 가려움 vs 그 이전 7일 평균 비교 */
export function weeklyItchStats(records: Record<string, SkinRecord[]>): WeeklyItchStats {
  const now = new Date();
  const list = Object.values(records).flat();
  const ageDays = (d: Date) => (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
  const avg = (arr: SkinRecord[]) =>
    arr.length === 0 ? null : arr.reduce((sum, r) => sum + parseItch(r.itch), 0) / arr.length;

  const thisWeekAvg = avg(list.filter((r) => ageDays(r.date) >= 0 && ageDays(r.date) < 7));
  const lastWeekAvg = avg(list.filter((r) => ageDays(r.date) >= 7 && ageDays(r.date) < 14));

  let deltaText = '비교할 이전 기록이 없어요';
  if (thisWeekAvg != null && lastWeekAvg != null) {
    const diff = Math.round((thisWeekAvg - lastWeekAvg) * 10) / 10;
    deltaText = diff === 0 ? '변화없음' : diff < 0 ? `${(-diff).toFixed(1)}점 ↓` : `${diff.toFixed(1)}점 ↑`;
  }
  return { thisWeekAvg, lastWeekAvg, deltaText };
}

/** 그래프에 쓸 최근 검사 기록 (날짜 오름차순), 최대 N개 */
export function recentItchSeries(records: Record<string, SkinRecord[]>, limit = 8): { date: Date; itch: number }[] {
  return Object.values(records)
    .flat()
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(-limit)
    .map((r) => ({ date: r.date, itch: parseItch(r.itch) }));
}

export interface RegionHeat {
  region: BodyRegion;
  avgItch: number;
  severeCount: number;
  count: number;
  /** 0~1, 해당 부위가 다른 부위 대비 얼마나 "주의가 필요한지" */
  score: number;
}

/** 최근 30일 기록을 부위별로 묶어, 평균 가려움 또는 중증 빈도가 높은 부위를 찾는다 */
export function regionHeatmap(records: Record<string, SkinRecord[]>): RegionHeat[] {
  const now = new Date();
  const recent = Object.values(records)
    .flat()
    .filter((r) => {
      const diffDays = (now.getTime() - r.date.getTime()) / (1000 * 60 * 60 * 24);
      return diffDays <= 30 && r.region;
    });

  const sums = new Map<BodyRegion, { itchSum: number; count: number; severeCount: number }>();
  BODY_REGIONS.forEach((r) => sums.set(r, { itchSum: 0, count: 0, severeCount: 0 }));

  recent.forEach((r) => {
    const bucket = sums.get(r.region as BodyRegion);
    if (!bucket) return;
    bucket.itchSum += parseItch(r.itch);
    bucket.count += 1;
    if (r.sev >= 3) bucket.severeCount += 1;
  });

  const base = BODY_REGIONS.map((region) => {
    const s = sums.get(region)!;
    return { region, avgItch: s.count > 0 ? s.itchSum / s.count : 0, severeCount: s.severeCount, count: s.count };
  });

  const maxAvg = Math.max(...base.map((r) => r.avgItch), 0.0001);
  const maxSevere = Math.max(...base.map((r) => r.severeCount), 1);

  return base.map((r) => ({
    ...r,
    score: Math.max(r.avgItch / maxAvg, r.severeCount / maxSevere),
  }));
}
