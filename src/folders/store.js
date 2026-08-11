/**
 * 모니터링 폴더 저장소 (세션 메모리 + 구독).
 *
 * 폴더 하나 = 모니터링 대상(MonitorTarget) 하나. 폴더 안에는 촬영 날짜별 기록
 * (수면 점수 · 가려움 VAS · 피부 종합 상태 IGA)이 쌓인다.
 *
 * 폴더는 사용자가 직접 만들지 않는다 — 카메라 탭의 "신규 검사"(부위 선택 → 질환 등록 →
 * 가려움 문진 → 촬영 → 결과)를 끝낸 뒤 결과 화면에서 "경과 기록에 연동"을 누르면
 * ensureFolder가 "{부위} {질환}" 이름으로 만들고 recordExam이 그 검사의 실측값을 첫 기록으로
 * 넣는다.
 *
 * ── 저장 ──────────────────────────────────────────────────
 *
 * 앱을 껐다 켜도 남는다(AsyncStorage). 화면은 여전히 메모리의 folders를 읽고, 저장은 바뀔 때마다
 * 뒤에서 따라간다 — 화면이 저장을 기다리게 만들면 촬영 직후의 흐름이 저장 속도에 묶인다.
 *
 * 불러오기는 비동기라 첫 렌더에는 빈 배열이 보인다. 그 순간이 "기록이 없음"과 구분되지 않으므로
 * hydrated 플래그를 함께 내보내고, 목록 화면은 그것으로 "불러오는 중"과 "아직 없음"을 가른다.
 *
 * 예시(dump) 폴더는 없다. 예전에는 UI 흐름을 보여주려고 프리셋 두 개를 넣어 두었는데, 저장이
 * 붙은 뒤로는 그 둘이 **지워지지 않는 남의 기록**처럼 남는다.
 */
import { useSyncExternalStore } from 'react';
import { FOLDERS_KEY, deletePhotos, loadSaved, persistPhoto, saveLater } from './persist';

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

/*
  폴더 목록. 처음에는 비어 있고, 저장된 것을 불러오면 채워진다.

  hydrated는 "불러오기가 끝났는가"다. 이것이 없으면 앱을 켠 직후의 빈 배열과 정말로 기록이 없는
  상태를 화면이 구분할 수 없어서, 기록이 있는 사용자에게 잠깐 "아직 기록이 없어요"가 스쳐 지나간다.
*/
let folders = [];
let hydrated = false;

const listeners = new Set();
function emit() { listeners.forEach((l) => l()); }
function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** 바뀐 것을 알리고 저장을 예약한다 — 모든 변경이 이 문을 지난다 */
function commit() {
  emit();
  saveLater(FOLDERS_KEY, () => folders);
}

/**
 * 저장된 폴더를 불러온다. 앱이 뜰 때 한 번만 돈다(아래 즉시 실행).
 *
 * 실패해도 빈 상태로 시작한다 — 저장이 깨졌다고 앱이 안 뜨는 것이 가장 나쁘다.
 */
async function hydrate() {
  const saved = await loadSaved(FOLDERS_KEY);
  if (Array.isArray(saved)) {
    /*
      불러온 것을 그냥 대입하지 않는다.

      앱을 켜자마자 촬영해 기록을 남기면, 그 기록이 메모리에 들어간 뒤에 불러오기가 끝날 수 있다.
      그때 통째로 덮어쓰면 방금 만든 폴더가 **저장되기도 전에 사라진다.** 저장된 것을 먼저 놓고,
      그 사이에 생긴 것만 뒤에 붙인다.
    */
    const savedIds = new Set(saved.map((f) => f.id));
    folders = [...folders.filter((f) => !savedIds.has(f.id)), ...saved];
  }
  hydrated = true;
  // 사이에 생긴 폴더가 있었다면 그것까지 포함해 저장해 둔다
  commit();
}
hydrate();

export function getFolders() { return folders; }
export function isHydrated() { return hydrated; }
export function useFolders() { return useSyncExternalStore(subscribe, getFolders); }
/** 저장된 기록을 다 불러왔는지 — 목록 화면이 "불러오는 중"과 "아직 없음"을 가르는 데 쓴다 */
export function useFoldersHydrated() {
  useSyncExternalStore(subscribe, getFolders);
  return hydrated;
}
export function getFolder(id) { return folders.find((f) => f.id === id) || null; }
export function useFolder(id) {
  useFolders(); // 변경 시 리렌더 트리거용 구독
  return getFolder(id);
}

/** 폴더의 촬영 시작일로부터 오늘까지 며칠째인지 (예: D+53) */
export function dayCount(folder) {
  return Math.max(0, daysBetween(folder.startDate, todayKey()));
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
  const gone = folders.find((f) => f.id === id);
  folders = folders.filter((f) => f.id !== id);
  commit();
  // 폴더가 사라지면 그 사진들도 쓸 곳이 없다 — 문서 폴더에 남겨 두면 용량만 먹는다
  if (gone) deletePhotos(gone.records.map((r) => r.photo?.uri));
}

/**
 * 한 모니터링 대상의 폴더를 (없으면 "{부위} {질환}" 이름으로 만들어서) 돌려준다 — 기록은 넣지 않는다.
 *
 * 카메라 탭의 "경과 기록에 연동" 흐름이 쓴다: 폴더를 먼저 확보한 뒤 recordExam으로 방금 검사한
 * 실측값을 오늘 기록으로 넣는다. 여기서 일부러 emit하지 않는데, 기록이 0개인 순간이 구독자에게
 * 보이면 폴더 화면이 빈 배열을 그리게 되기 때문이다 — 기록까지 채운 recordExam이 한 번만 알린다.
 *
 * @param {{ targetId: string, name: string }} args
 * @returns {string} 폴더 id
 */
export function ensureFolder({ targetId, name }) {
  const existing = getFolderByTarget(targetId);
  if (existing) {
    // 질환명이 바뀌었으면(모델이 추정한 이름이 새로 붙는 경우 등) 폴더 이름도 따라간다.
    // 이름 변경은 그 자체로 저장돼야 한다 — 뒤이을 recordExam이 없을 수도 있다.
    if (existing.name !== name) {
      folders = folders.map((f) => (f.id === existing.id ? { ...f, name } : f));
      commit();
    }
    return existing.id;
  }
  const id = `f_${targetId}`;
  folders = [{ id, targetId, name, startDate: todayKey(), createdTs: Date.now(), records: [] }, ...folders];
  return id;
}

/**
 * 카메라 탭 검사 결과(온디바이스 모델의 **실측값**)를 폴더의 오늘 기록으로 남긴다.
 *
 * iga·세부 증상·병변 면적이 전부 온디바이스 모델의 실측값이다 (지어낸 수치는 없다).
 * 같은 날 이미 기록이 있으면(하루 여러 번 검사) 새로 덮어쓴다.
 *
 * 수면 점수는 검사가 만들어내는 값이 아니라 삼성헬스 연동 값이라, 직전 기록의 값을 이어받는다.
 * 이어받을 기록조차 없으면 그래프가 깨지지 않도록 중립값을 넣되 hasSleepSource=false로 알려서
 * 결과 화면이 "등록 안함"을 띄우게 한다. 가려움도 문진을 건너뛰면(null) 같은 이유로 직전 값을
 * 이어받고, "이번 검사에서 실제로 등록했는지"는 결과 화면이 따로 판단한다.
 *
 * faceAreaIndex는 얼굴 자리를 가이드에 맞춰 찍었을 때만 들어온다 — 촬영 거리가 상쇄된 넓이라
 * 이것만이 회차 간 비교에 쓸 수 있다(lesionAreaPct는 사진 대비 %라 거리에 따라 통째로 흔들린다).
 * 없으면 null로 남겨서 넓이 추이 그래프가 그 회차를 건너뛰게 한다 — 0으로 채우면 그래프가
 * "병변이 사라졌다"고 말하게 된다.
 *
 * @param {{ folderId: string, iga: number, redness: number, bumps: number, scratch: number,
 *           thickening: number, itchVas: number|null, areaPct: number,
 *           faceAreaIndex?: number|null, faceAreaKind?: 'face'|'torso'|null,
 *           faceAreaLowRes?: boolean, photoUri?: string }} args
 * @returns {{ record: any, hasSleepSource: boolean }|null}
 */
export function recordExam({
  folderId, iga, redness, bumps, scratch, thickening, itchVas, areaPct,
  faceAreaIndex = null, faceAreaKind = null, faceAreaLowRes = false, photoUri,
}) {
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
    // 상한을 두지 않는다 — 얼굴 크기(d·v) 대비 지수라 100을 넘을 수 있다.
    // 그리고 없는 값은 0이 아니라 null이어야 한다("못 쟀다"와 "없다"는 다르다).
    lesionAreaFaceIndex: faceAreaIndex == null ? null : Math.max(0, round1(faceAreaIndex)),
    /*
      이 지수를 무엇으로 나눴는지 (얼굴 자 / 몸통 자).

      없으면 얼굴로 본다 — 이 필드가 생기기 전의 기록은 전부 얼굴 자리였기 때문이다.
      화면이 "부위의 몇 %"를 환산할 때 이 값이 없으면 6배 틀린 숫자가 나온다.
    */
    lesionAreaScaleKind: faceAreaIndex == null ? null : faceAreaKind ?? 'face',
    /*
      해상도 게이트를 사용자가 직접 열고 잰 회차인지.

      값을 빼지 않고 표시만 남기는 이유: 얼굴이 작게 찍히면 마스크 경계가 뭉개져 넓이가 흔들리지만,
      한쪽으로 치우친 편향이 생기지는 않는다. 버리기엔 아까운 값이라 남기되, 추세에서 이 점이 튀면
      왜 튀는지 설명할 수 있어야 한다.
    */
    lesionAreaLowRes: faceAreaIndex != null && !!faceAreaLowRes,
    photo: photoUri ? { uri: photoUri } : (last ? last.photo : null),
  };

  /*
    촬영 한 번이 기록 하나다 — 같은 날 두 번 찍어도 덮어쓰지 않는다.

    예전에는 날짜가 같으면 덮어썼다. "하루에 한 줄"이라는 규칙 자체는 그래프를 단순하게 만들지만,
    대가가 너무 컸다: 아침에 찍은 사진이 저녁에 찍으면 **소리 없이 사라진다.** 사용자는 분명히
    저장 완료를 봤는데 기록에는 없으니, 앱이 사진을 잃어버린 것으로 보인다.

    넓이 추이에는 더 직접적인 문제가 있었다. 같은 날 여러 번 찍으면 잰 회차가 영영 한 개라,
    "기준이 되는 첫 촬영이 기록됐어요"에서 다음으로 넘어가질 못한다 — 하루 안에서는 기능이
    아예 동작하지 않는 셈이었다.

    같은 날 기록이 여럿이면 시간 순으로 나란히 쌓인다(ts로 뒷순위를 가른다).
  */
  const records = [...folder.records, record].sort((a, b) => a.dayOffset - b.dayOffset || a.ts - b.ts);
  folders = folders.map((f) => (f.id === folder.id ? { ...f, records } : f));
  commit();

  /*
    사진을 오래 남는 자리로 옮기고, 끝나면 그 경로로 기록을 갱신한다.

    기다리지 않는 이유: 복사는 수십 ms가 걸릴 수 있는데 이 함수가 끝나야 결과 화면이 뜬다.
    먼저 캐시 경로로 기록을 만들어 화면을 띄우고, 복사가 끝나면 조용히 경로만 바꾼다 —
    두 경로 모두 같은 사진이라 화면에는 아무 차이가 없다.
  */
  if (record.photo?.uri) {
    persistPhoto(record.photo.uri).then((uri) => {
      if (!uri || uri === record.photo.uri) return;
      folders = folders.map((f) =>
        f.id !== folder.id
          ? f
          : { ...f, records: f.records.map((r) => (r.id === record.id ? { ...r, photo: { uri } } : r)) },
      );
      commit();
    });
  }
  return { record, hasSleepSource: !!last };
}
