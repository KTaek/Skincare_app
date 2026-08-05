/**
 * 모니터링 폴더 저장소 (세션 메모리 + 구독).
 *
 * 부위별로 폴더를 만들고, 폴더 안에 촬영 날짜별 기록(수면 점수 · 가려움 VAS · 피부 종합 상태 IGA)을 쌓는다.
 * 아직 실제 스캔 파이프라인과 연결되지 않아 프리셋 폴더 2개 + 새로 만드는 폴더 모두
 * dump(가짜) 시계열 데이터로 채워서 UI 흐름을 시연한다.
 *
 * ⚠️ 세션 메모리에만 유지된다(앱 재시작 시 초기화).
 */
import { useSyncExternalStore } from 'react';
import { ATOPIC_PHOTOS, CHEEK_PHOTOS, GENERAL_PHOTOS } from './dumpPhotos';

const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayKey = () => keyOf(new Date());
export const addDaysKey = (dateKey, n) => {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return keyOf(dt);
};
export const daysBetween = (fromKey, toKey) => {
  const [y1, m1, d1] = fromKey.split('-').map(Number);
  const [y2, m2, d2] = toKey.split('-').map(Number);
  const ms = new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1);
  return Math.round(ms / 86400000);
};
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round1 = (v) => Math.round(v * 10) / 10;
const lerp = (a, b, t) => a + (b - a) * t;

/** 문자열 -> 32bit 정수 시드 (간단 해시) */
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
/** seed -> [0,1) 결정적 난수 제공자 (mulberry32) */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 촬영 시작일부터 spanDays 동안 captureCount번 촬영했다고 가정하고
 * 3개 지표(수면 점수 · 가려움 VAS · 피부 종합 상태 IGA)의 dump 시계열을 생성한다.
 * 실제 사용자는 매일 촬영하지 않으므로 날짜 간격을 일부러 들쭉날쭉하게 만든다.
 *
 * from -> to로 밋밋하게 한쪽으로만 줄어들면 비현실적이라, 물결(wave) 성분을 얹어
 * 중간중간 좋아졌다 나빠졌다 하는 변동을 준다. 처음/마지막 기록은 폴더가 의도한
 * from/to 값 그대로 남도록 물결의 진폭을 양 끝에서 0으로 줄이는 envelope을 곱한다.
 */
function generateRecords(startKey, seedBase, { spanDays, captureCount, from, to, photos }) {
  const rng = makeRng(seedBase);

  // 0일차, 마지막 날은 반드시 포함 + 중간은 불규칙 간격으로 샘플링
  const offsets = new Set([0, spanDays]);
  while (offsets.size < captureCount) {
    offsets.add(Math.round(1 + rng() * (spanDays - 2)));
  }
  const sorted = Array.from(offsets).sort((a, b) => a - b);

  const wavePhase = rng() * Math.PI * 2;
  const waveFreq = 2.2 + rng() * 2.3; // 전체 구간 동안 오르내림이 대략 2~4.5회 정도 반복

  return sorted.map((offset, i) => {
    const t = sorted.length > 1 ? i / (sorted.length - 1) : 1;
    const noise = () => (rng() - 0.5);
    const envelope = Math.sin(t * Math.PI); // 0(양 끝) ~ 1(중간) — 첫/최근 기록은 from/to 값을 그대로 유지
    const wave = (phaseOffset) => Math.sin(t * Math.PI * waveFreq + wavePhase + phaseOffset) * envelope;

    const sleepSpan = Math.max(6, Math.abs(to.sleep - from.sleep));
    const itchSpan = Math.max(1.5, Math.abs(to.itch - from.itch));
    const igaSpan = Math.max(1, Math.abs(to.iga - from.iga));

    // 수면 점수(삼성헬스, 0~100, 정수) · 가려움 VAS(0~10, 정수) · 피부 종합 상태 IGA(0~4, 소수 가능)
    const sleepScore = clamp(Math.round(lerp(from.sleep, to.sleep, t) + wave(0) * sleepSpan * 0.4 + noise() * sleepSpan * 0.14), 0, 100);
    const itchVas = clamp(Math.round(lerp(from.itch, to.itch, t) + wave(1.3) * itchSpan * 0.4 + noise() * itchSpan * 0.14), 0, 10);
    // 모델이 5단계(0~4) 각각의 확률에 대한 기댓값을 출력하므로 argmax처럼 정수로 딱 떨어지지 않고
    // 1.7처럼 소수로도 나온다 — round1로 소수 첫째 자리까지만 남겨 정수/소수가 섞여서 나오게 한다.
    const iga = clamp(round1(lerp(from.iga, to.iga, t) + wave(2.6) * igaSpan * 0.4 + noise() * igaSpan * 0.14), 0, 4);

    // 세부 증상(피부 붉기 · 오돌토돌함 · 긁은 상처 · 피부 두꺼워짐, 0~10) — 종합 점수(iga×2)를
    // 중심으로 증상마다 독립적인 잡음을 더해, 같은 날이라도 증상별로 조금씩 다르게 흔들리게 한다.
    const skin10 = iga * 2;
    const symptomNoise = (phaseOffset) => wave(phaseOffset) * 1.2 + noise() * 1.4;
    const redness = clamp(round1(skin10 + symptomNoise(3.1)), 0, 10);
    const bumps = clamp(round1(skin10 + symptomNoise(4.4)), 0, 10);
    const scratch = clamp(round1(skin10 + symptomNoise(5.7)), 0, 10);
    const thickening = clamp(round1(skin10 + symptomNoise(7.0)), 0, 10);

    const date = addDaysKey(startKey, offset);
    return {
      id: `${startKey}-${offset}`,
      seed: hashStr(`${startKey}-${offset}-${seedBase}`),
      date,
      dayOffset: offset,
      ts: new Date(date).getTime(),
      sleepScore,
      itchVas,
      iga,
      redness,
      bumps,
      scratch,
      thickening,
      // LesionThumb의 사진 오버레이 윤곽선 크기에만 쓰는 dump 값 — IGA 단계가 높을수록 넓게 잡는다.
      // UI 지표/그래프에는 더 이상 "병변 면적"으로 노출하지 않는다.
      lesionAreaPct: clamp(round1(3 + iga * 6 + noise() * 3), 0.5, 45),
      // 촬영 순서(i, 시간순 정렬됨)에 맞춰 실제 사진을 1:1로 매칭 — 그려낸 이미지가 아니라 실제 dump 이미지
      photo: photos[i % photos.length],
    };
  });
}

function makeFolder({ id, name, spanDaysAgoStart, spanDays, captureCount, from, to, photos = GENERAL_PHOTOS }) {
  const startDate = addDaysKey(todayKey(), -spanDaysAgoStart);
  const seedBase = hashStr(id + name);
  return {
    id,
    name,
    startDate,
    createdTs: Date.now(),
    records: generateRecords(startDate, seedBase, { spanDays, captureCount, from, to, photos }),
  };
}

// ── 프리셋 폴더 2개 (dump) ───────────────────────────────────────────────
let folders = [
  makeFolder({
    id: 'f1',
    name: '오른팔 아토피 피부염 모니터링',
    spanDaysAgoStart: 53,
    spanDays: 53,
    captureCount: 14,
    from: { sleep: 58, itch: 7, iga: 3.8 },
    to: { sleep: 84, itch: 2, iga: 0.4 },
    photos: ATOPIC_PHOTOS,
  }),
  makeFolder({
    id: 'f2',
    name: '왼쪽 뺨 홍반 모니터링',
    spanDaysAgoStart: 21,
    spanDays: 21,
    captureCount: 7,
    from: { sleep: 82, itch: 2, iga: 0.8 },
    to: { sleep: 68, itch: 5, iga: 3.6 },
    photos: CHEEK_PHOTOS,
  }),
];
const listeners = new Set();
function emit() { listeners.forEach((l) => l()); }
function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function getFolders() { return folders; }
export function useFolders() { return useSyncExternalStore(subscribe, getFolders); }
export function getFolder(id) { return folders.find((f) => f.id === id) || null; }
export function useFolder(id) {
  useFolders(); // 변경 시 리렌더 트리거용 구독
  return getFolder(id);
}

/** 폴더의 촬영 시작일로부터 오늘까지 며칠째인지 (예: D+53) */
export function dayCount(folder) {
  return Math.max(0, daysBetween(folder.startDate, todayKey()));
}

/**
 * 새 모니터링 폴더 생성. 아직 실제 촬영 연동 전이라 데모용 dump 시계열을 함께 채워 넣는다
 * (70% 확률로 호전 추세, 30% 확률로 악화 추세 — 다양한 케이스를 보여주기 위함).
 * 호전 = 수면 점수↑ · 가려움 VAS↓ · 피부 종합 상태(IGA)↓.
 */
export function addFolder(name) {
  const id = `f_${Date.now()}`;
  const rng = makeRng(hashStr(id + name));
  const spanDays = 10 + Math.round(rng() * 50);
  const captureCount = Math.max(3, Math.round(spanDays / 4));
  const improving = rng() < 0.7;

  // iga는 정수로 딱 떨어뜨리지 않고 round1(소수 첫째 자리)로 남겨서, 첫/마지막 기록도
  // 기댓값 출력다운 소수(예: 1.7)로 나올 수 있게 한다.
  const from = { sleep: Math.round(55 + rng() * 20), itch: Math.round(4 + rng() * 5), iga: round1(1 + rng() * 3) };
  const to = improving
    ? { sleep: clamp(Math.round(from.sleep + (20 + rng() * 20)), 0, 100), itch: clamp(Math.round(from.itch * (0.1 + rng() * 0.3)), 0, 10), iga: clamp(round1(from.iga * (0.1 + rng() * 0.3)), 0, 4) }
    : { sleep: clamp(Math.round(from.sleep - (10 + rng() * 20)), 0, 100), itch: clamp(Math.round(from.itch + (2 + rng() * 3)), 0, 10), iga: clamp(round1(from.iga + (1 + rng())), 0, 4) };

  const folder = makeFolder({ id, name, spanDaysAgoStart: spanDays, spanDays, captureCount, from, to });
  folders = [folder, ...folders];
  emit();
  return folder;
}

export function deleteFolder(id) {
  folders = folders.filter((f) => f.id !== id);
  emit();
}

/**
 * "오늘의 피부 상태 기록" 버튼으로 방금 촬영한 사진을 폴더에 새 기록으로 추가한다.
 * 아직 실제 분석 파이프라인이 없어(온디바이스 모델 연동 전) 마지막 기록 값을 기준으로 살짝
 * 흔들어 오늘치 dump 수치를 만든다 — addFolder의 시계열 생성과 같은 잡음 스타일이다.
 * 같은 날 이미 기록이 있으면(하루 여러 번 촬영) 새로 덮어쓴다.
 *
 * @param {string} folderId
 * @param {{ uri: string }} photo — 카메라/앨범에서 방금 고른 사진
 */
export function addRecord(folderId, photo) {
  const folder = folders.find((f) => f.id === folderId);
  if (!folder) return null;

  const date = todayKey();
  const dayOffset = daysBetween(folder.startDate, date);
  const last = folder.records[folder.records.length - 1];
  const rng = makeRng(hashStr(`${folderId}-${date}-${Date.now()}`));
  const jitter = (span, amt) => (rng() - 0.5) * span * amt;

  const sleepScore = clamp(Math.round((last ? last.sleepScore : 75) + jitter(100, 0.12)), 0, 100);
  const itchVas = clamp(Math.round((last ? last.itchVas : 3) + jitter(10, 0.12)), 0, 10);
  const iga = clamp(round1((last ? last.iga : 1.5) + jitter(4, 0.12)), 0, 4);
  const skin10 = iga * 2;
  const symptomNoise = () => jitter(3, 0.4);
  const redness = clamp(round1(skin10 + symptomNoise()), 0, 10);
  const bumps = clamp(round1(skin10 + symptomNoise()), 0, 10);
  const scratch = clamp(round1(skin10 + symptomNoise()), 0, 10);
  const thickening = clamp(round1(skin10 + symptomNoise()), 0, 10);

  const record = {
    id: `${folderId}-${date}-${Date.now()}`,
    seed: hashStr(`${folderId}-${date}-${Date.now()}`),
    date,
    dayOffset,
    ts: Date.now(),
    sleepScore,
    itchVas,
    iga,
    redness,
    bumps,
    scratch,
    thickening,
    lesionAreaPct: clamp(round1(3 + iga * 6 + jitter(3, 0.4)), 0.5, 45),
    photo,
  };

  const existingIdx = folder.records.findIndex((r) => r.date === date);
  const records = existingIdx >= 0
    ? folder.records.map((r, i) => (i === existingIdx ? record : r))
    : [...folder.records, record].sort((a, b) => a.dayOffset - b.dayOffset);

  folders = folders.map((f) => (f.id === folderId ? { ...f, records } : f));
  emit();
  return record;
}
