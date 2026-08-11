/**
 * 모니터링 폴더 저장소 (세션 메모리 + 구독).
 *
 * 폴더 하나 = 모니터링 대상(MonitorTarget) 하나. 폴더 안에는 촬영 날짜별 기록
 * (수면 점수 · 가려움 VAS · 피부 종합 상태 IGA)이 쌓인다.
 *
 * 폴더는 사용자가 직접 만들지 않는다 — 카메라 탭의 "신규 검사"(부위 선택 → 질환 등록 →
 * 가려움 문진 → 촬영 → 결과)를 끝낸 뒤 결과 화면에서 "경과 기록에 연동"을 누르면
 * ensureFolder가 "{부위} {질환}" 이름으로 만들고 recordExam이 그 검사의 실측값을 첫 기록으로
 * 넣는다. 프리셋 폴더 3개는 UI 흐름 시연용 dump 시계열이다.
 *
 * ⚠️ 세션 메모리에만 유지된다(앱 재시작 시 초기화).
 */
import { useSyncExternalStore } from 'react';
import { SEVERITY_SUPPORTED_DISEASE } from '../ai/labels';
import { ATOPIC_PHOTOS, CHEEK_PHOTOS } from './dumpPhotos';
import { DEMO_TARGETS, folderNameOf } from './targets';

/** 이 폴더의 진단명이 4가지 증상·IGA 모델이 커버하는 질환(아토피피부염)인지 — "피부 종합 상태"·
 *  "4가지 증상" 카드를 보여줄지 모니터링 화면들이 이 값으로 정한다. */
export function folderHasSeverity(folder) {
  return folder?.disease === SEVERITY_SUPPORTED_DISEASE;
}

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

    // 수면 점수(삼성헬스, 0~100, 정수) · 가려움 VAS(0~10, 정수) — 둘 다 그대로 나올 수 있는 값이다.
    const sleepScore = clamp(Math.round(lerp(from.sleep, to.sleep, t) + wave(0) * sleepSpan * 0.4 + noise() * sleepSpan * 0.14), 0, 100);
    const itchVas = clamp(Math.round(lerp(from.itch, to.itch, t) + wave(1.3) * itchSpan * 0.4 + noise() * itchSpan * 0.14), 0, 10);
    // 피부 종합 상태(IGA) — 모델은 5단계(0~4) 확률의 기댓값을 계산해서 쓰지만, 화면·기록에 실제로
    // 남는 값(igaGrade)은 그 기댓값을 등급 경계로 이산화한 정수다(src/ai/dex.ts의 bucketize) —
    // 1.7 같은 소수는 실제로는 절대 나오지 않으므로, dump도 정수 등급만 뽑는다.
    const igaContinuous = clamp(lerp(from.iga, to.iga, t) + wave(2.6) * igaSpan * 0.4 + noise() * igaSpan * 0.14, 0, 4);
    const iga = Math.round(igaContinuous);

    // 세부 증상(피부 붉기 · 오돌토돌함 · 긁은 상처 · 피부 두꺼워짐) — 모델은 sign마다 4단계
    // (None~Severe, 0~3)만 예측하므로 화면 스케일(0~10)로 옮겨도 {0, 3.3, 6.7, 10} 네 값만
    // 나올 수 있다(examMetrics.signDisplayValue와 같은 식). 종합 점수(iga)를 중심으로 등급을
    // 흔들어, 같은 날이라도 증상별로 조금씩 다른 등급이 나오게 한다.
    const symptomNoise = (phaseOffset) => wave(phaseOffset) * 0.9 + noise() * 1.1;
    const gradeToDisplay10 = (grade) => Math.round((grade / 3) * 100) / 10;
    const symptomGrade = (phaseOffset) => Math.round(clamp((iga * 3) / 4 + symptomNoise(phaseOffset), 0, 3));
    const redness = gradeToDisplay10(symptomGrade(3.1));
    const bumps = gradeToDisplay10(symptomGrade(4.4));
    const scratch = gradeToDisplay10(symptomGrade(5.7));
    const thickening = gradeToDisplay10(symptomGrade(7.0));

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

function makeFolder({ id, targetId, name, disease, spanDaysAgoStart, spanDays, captureCount, from, to, photos }) {
  const startDate = addDaysKey(todayKey(), -spanDaysAgoStart);
  const seedBase = hashStr(id + name);
  return {
    id,
    targetId,
    name,
    disease,
    startDate,
    createdTs: Date.now(),
    records: generateRecords(startDate, seedBase, { spanDays, captureCount, from, to, photos }),
  };
}

/** 데모 폴더도 실제 등록으로 만들어진 폴더와 똑같이 "{부위} {질환}" 이름을 쓴다 */
const demoName = (t) => folderNameOf(t.label, t.diagnosis?.disease);

// ── 프리셋 폴더 4개 (dump) ───────────────────────────────────────────────
// 네 폴더 모두 마지막 기록이 "오늘"이라(spanDaysAgoStart === spanDays로 맞춰 둠) 마지막 기록
// 시각이 완전히 같다 — latestRecordAcrossFolders()는 동률이면 배열에서 먼저 나온 쪽을 최신으로
// 본다. 홈 화면의 "최근 피부 상태"가 피부 종합 상태까지 온전히 보여주는 아토피 폴더를 기본으로
// 보여주도록, 아토피 폴더(다리)를 맨 앞에 둔다.
let folders = [
  makeFolder({
    id: 'f3',
    targetId: DEMO_TARGETS[2].id, // 다리 아토피피부염
    name: demoName(DEMO_TARGETS[2]),
    disease: DEMO_TARGETS[2].diagnosis?.disease,
    spanDaysAgoStart: 30,
    spanDays: 30,
    captureCount: 10,
    from: { sleep: 64, itch: 6, iga: 3.2 },
    to: { sleep: 79, itch: 2, iga: 0.6 },
    photos: ATOPIC_PHOTOS,
  }),
  makeFolder({
    id: 'f1',
    targetId: DEMO_TARGETS[0].id, // 팔 건선
    name: demoName(DEMO_TARGETS[0]),
    disease: DEMO_TARGETS[0].diagnosis?.disease,
    spanDaysAgoStart: 53,
    spanDays: 53,
    captureCount: 14,
    from: { sleep: 58, itch: 7, iga: 3.8 },
    to: { sleep: 84, itch: 2, iga: 0.4 },
    photos: ATOPIC_PHOTOS,
  }),
  makeFolder({
    id: 'f2',
    targetId: DEMO_TARGETS[1].id, // 머리 주사
    name: demoName(DEMO_TARGETS[1]),
    disease: DEMO_TARGETS[1].diagnosis?.disease,
    spanDaysAgoStart: 21,
    spanDays: 21,
    captureCount: 7,
    from: { sleep: 82, itch: 2, iga: 0.8 },
    to: { sleep: 68, itch: 5, iga: 3.6 },
    photos: CHEEK_PHOTOS,
  }),
  makeFolder({
    id: 'f4',
    targetId: DEMO_TARGETS[3].id, // 얼굴 아토피피부염
    name: demoName(DEMO_TARGETS[3]),
    disease: DEMO_TARGETS[3].diagnosis?.disease,
    spanDaysAgoStart: 18,
    spanDays: 18,
    captureCount: 6,
    from: { sleep: 60, itch: 6, iga: 3.0 },
    to: { sleep: 75, itch: 2, iga: 0.8 },
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

/** 한 모니터링 대상(MonitorTarget)에 딸린 폴더 */
export function getFolderByTarget(targetId) {
  return folders.find((f) => f.targetId === targetId) || null;
}

/**
 * 모든 폴더를 통틀어 가장 최근 촬영 기록 하나 (홈 화면 요약 카드용). 폴더 안 기록은 항상
 * 날짜 오름차순(offset 순)으로 쌓이므로 각 폴더의 마지막 기록끼리만 ts로 비교하면 된다.
 * 폴더가 하나도 없으면(또는 전부 기록이 비어 있으면) null.
 */
export function latestRecordAcrossFolders() {
  let best = null;
  for (const folder of folders) {
    const last = folder.records[folder.records.length - 1];
    if (last && (!best || last.ts > best.record.ts)) best = { folder, record: last };
  }
  return best;
}

export function useLatestMonitoringRecord() {
  useFolders(); // 변경 시 리렌더 트리거용 구독
  return latestRecordAcrossFolders();
}

export function deleteFolder(id) {
  folders = folders.filter((f) => f.id !== id);
  emit();
}

/**
 * 한 모니터링 대상의 폴더를 (없으면 "{부위} {질환}" 이름으로 만들어서) 돌려준다 — 기록은 넣지 않는다.
 *
 * 카메라 탭의 "경과 기록에 연동" 흐름이 쓴다: 폴더를 먼저 확보한 뒤 recordExam으로 방금 검사한
 * 실측값을 오늘 기록으로 넣는다. 여기서 일부러 emit하지 않는데, 기록이 0개인 순간이 구독자에게
 * 보이면 폴더 화면이 빈 배열을 그리게 되기 때문이다 — 기록까지 채운 recordExam이 한 번만 알린다.
 *
 * @param {{ targetId: string, name: string, disease?: string }} args
 * @returns {string} 폴더 id
 */
export function ensureFolder({ targetId, name, disease }) {
  const existing = getFolderByTarget(targetId);
  if (existing) {
    // 질환명이 바뀌었으면(모델이 추정한 이름이 새로 붙는 경우 등) 폴더 이름도 따라간다
    if (existing.name !== name || existing.disease !== disease) {
      folders = folders.map((f) => (f.id === existing.id ? { ...f, name, disease } : f));
    }
    return existing.id;
  }
  const id = `f_${targetId}`;
  folders = [{ id, targetId, name, disease, startDate: todayKey(), createdTs: Date.now(), records: [] }, ...folders];
  return id;
}

/**
 * 카메라 탭 검사 결과(온디바이스 모델의 **실측값**)를 폴더의 오늘 기록으로 남긴다.
 *
 * addRecord가 만드는 dump 수치와 달리 iga·세부 증상·병변 면적이 전부 실제 분석 결과다.
 * 같은 날 이미 기록이 있으면(하루 여러 번 검사) 새로 덮어쓴다.
 *
 * 수면 점수는 검사가 만들어내는 값이 아니라 삼성헬스 연동 값이라, 직전 기록의 값을 이어받는다.
 * 이어받을 기록조차 없으면 그래프가 깨지지 않도록 중립값을 넣되 hasSleepSource=false로 알려서
 * 결과 화면이 "등록 안함"을 띄우게 한다. 가려움도 문진을 건너뛰면(null) 같은 이유로 직전 값을
 * 이어받고, "이번 검사에서 실제로 등록했는지"는 결과 화면이 따로 판단한다.
 *
 * @param {{ folderId: string, iga: number, redness: number, bumps: number, scratch: number,
 *           thickening: number, itchVas: number|null, areaPct: number, photoUri?: string }} args
 * @returns {{ record: any, hasSleepSource: boolean }|null}
 */
export function recordExam({ folderId, iga, redness, bumps, scratch, thickening, itchVas, areaPct, photoUri }) {
  const folder = folders.find((f) => f.id === folderId);
  if (!folder) return null;

  const date = todayKey();
  const dayOffset = daysBetween(folder.startDate, date);
  const last = folder.records[folder.records.length - 1];
  const stamp = Date.now();

  const record = {
    id: `${folder.id}-${date}-${stamp}`,
    seed: hashStr(`${folder.id}-${date}-${stamp}`),
    date,
    dayOffset,
    ts: stamp,
    sleepScore: last ? last.sleepScore : 75,
    itchVas: itchVas != null ? clamp(Math.round(itchVas), 0, 10) : (last ? last.itchVas : 0),
    iga: clamp(round1(iga), 0, 4),
    redness: clamp(round1(redness), 0, 10),
    bumps: clamp(round1(bumps), 0, 10),
    scratch: clamp(round1(scratch), 0, 10),
    thickening: clamp(round1(thickening), 0, 10),
    lesionAreaPct: clamp(round1(areaPct), 0.5, 100),
    photo: photoUri ? { uri: photoUri } : (last ? last.photo : null),
  };

  const idx = folder.records.findIndex((r) => r.date === date);
  const records = idx >= 0
    ? folder.records.map((r, i) => (i === idx ? record : r))
    : [...folder.records, record].sort((a, b) => a.dayOffset - b.dayOffset);
  folders = folders.map((f) => (f.id === folder.id ? { ...f, records } : f));
  emit();
  return { record, hasSleepSource: !!last };
}

/**
 * "오늘의 피부 상태 기록" 버튼으로 방금 촬영한 사진을 폴더에 새 기록으로 추가한다.
 * 아직 실제 분석 파이프라인이 없어(온디바이스 모델 연동 전) 마지막 기록 값을 기준으로 살짝
 * 흔들어 오늘치 dump 수치를 만든다 — 프리셋 폴더의 시계열 생성과 같은 잡음 스타일이다.
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
