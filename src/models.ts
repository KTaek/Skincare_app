import { AppColors } from './theme';

/** 루틴 — 실제 앱에서는 서버/로컬 저장소에 저장 */
export interface Routine {
  id: number;
  name: string;
  time: string; // "HH:mm"
  done: boolean;
}

/** 신체 영역 — 촬영 전 사용자가 표시한 병변 위치를 6개 구역으로 단순화 */
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

/** 검사 기록 — 실제로는 카메라 분석 결과가 누적됨 */
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

/** 주변 병원 */
export interface Hospital {
  name: string;
  dist: string;
  addr: string;
  open: string;
  rating: number;
}

/** 홈 상단 카드에 표시되는 최근 상태 */
export interface SkinStatus {
  disease: string;
  sev: number;
  itch: string; // "4 / 10"
  itchDelta: string; // "2점 ↓"
  lastExam: string; // "2일 전"
  rate: string; // "66%"
  rateDelta: string; // "22% ↑"
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

export const initialRoutines = (): Routine[] => [
  { id: 1, name: '병변 상태 사진 찍기', time: '12:00', done: false },
  { id: 2, name: '세라마이드 보습제 바르기', time: '14:00', done: false },
  { id: 3, name: '미지근한 물로 샤워하기', time: '18:00', done: false },
  { id: 4, name: '항히스타민제 복용', time: '21:00', done: false },
];

export const seedHospitals: Hospital[] = [
  { name: '맑은피부과의원', dist: '320m', rating: 4.8, addr: '수원시 영통구 매탄로 12', open: '진료 중' },
  { name: '연세서울피부과', dist: '540m', rating: 4.6, addr: '수원시 영통구 영통로 88', open: '진료 중' },
  { name: '굿모닝피부과의원', dist: '1.1km', rating: 4.5, addr: '수원시 팔달구 인계로 30', open: '19:00 마감' },
  { name: '하늘피부과', dist: '1.4km', rating: 4.3, addr: '수원시 영통구 광교로 5', open: '진료 마감' },
];

export const recordKey = (d: Date): string => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

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

/** 가려움 정도 변화량 — 직전 검사 대비 최근 검사의 차이 */
function itchDeltaOf(latest: SkinRecord, previous: SkinRecord | undefined): string {
  if (!previous) return '변화없음';
  const diff = parseItch(latest.itch) - parseItch(previous.itch);
  if (diff === 0) return '변화없음';
  return diff < 0 ? `${-diff}점 ↓` : `${diff}점 ↑`;
}

const daysAgo = (date: Date): string => {
  const now = new Date();
  const diff = Math.round((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  return diff <= 0 ? '오늘' : `${diff}일 전`;
};

/** 오늘 루틴 중 완료한 비율 (예: 4개 중 2개 완료 → "50%") */
export function routineRateOf(routines: Routine[]): string {
  if (routines.length === 0) return '0%';
  const done = routines.filter((r) => r.done).length;
  return `${Math.round((done / routines.length) * 100)}%`;
}

/** 검사 기록과 오늘의 루틴 이행 현황을 토대로 홈 화면에 표시할 최근 피부 상태를 계산 */
export function currentStatusFromRecords(records: Record<string, SkinRecord[]>, routines: Routine[]): SkinStatus {
  const sorted = Object.values(records)
    .flat()
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  const [latest, previous] = sorted;
  return {
    disease: latest.disease,
    sev: latest.sev,
    itch: latest.itch,
    itchDelta: itchDeltaOf(latest, previous),
    lastExam: daysAgo(latest.date),
    rate: routineRateOf(routines),
    rateDelta: ' ',
  };
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
