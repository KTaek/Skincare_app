/**
 * 메모 저장소 — 기록(항목) 한 건에 한 장씩.
 *
 * 기록 탭 달력에서 날짜를 고르면 나오는 기록 카드마다 자유 메모를 한 장 붙일 수 있다
 * ("어제 긁어서 덧남", "연고 바꾼 뒤 첫 촬영"처럼 수치로 남지 않는 것들).
 *
 * 다른 저장소(folders/store.js, MonitoringContext)와 달리 **AsyncStorage에 남긴다**.
 * 나머지는 다시 만들 수 있는 측정값이지만 메모는 사용자가 직접 쓴 글이라, 앱을 껐다 켰다고
 * 사라지면 안 된다.
 *
 * 저장 형태는 나중에 **PDF 내보내기**가 그대로 집어갈 수 있게 잡아 뒀다 — 글만 남기지 않고
 * 날짜·대상·표시 이름·수정 시각을 함께 들고 있어서, 내보내기 쪽은 listMemos()를 날짜순으로
 * 훑기만 하면 된다. 화면 코드를 뒤져 이름을 다시 만들 필요가 없다.
 */
import { useMemo, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'records.memos.v2';
/** 날짜 하나에 한 장씩 달던 시절의 키 — 그 기능이 없어졌으니 남은 것도 지운다 */
const LEGACY_KEY = 'records.memos.v1';
/** 저장이 타자마다 일어나지 않도록 마지막 입력에서 이만큼 기다렸다 한 번만 쓴다 */
const SAVE_DELAY_MS = 400;
/** 기록 메모의 키 앞자리. 예전 날짜 메모("date:…")와 구분해 걸러내는 용도이기도 하다 */
const KEY_PREFIX = 'record:';

/** 메모를 붙일 기록 한 건 */
export interface MemoTarget {
  /** 그 기록을 찍은 날 */
  date: string;
  folderId: string;
  recordId: string;
  /** 내보내기에서 소제목으로 쓸 이름 (예: "건선 · 팔") */
  label?: string;
}

export interface MemoEntry {
  /** 이 메모가 걸린 기록의 날짜 — 내보내기 정렬 기준 */
  date: string;
  folderId: string;
  recordId: string;
  label?: string;
  text: string;
  /** 마지막으로 고친 시각 (epoch ms) */
  updatedAt: number;
}

/** 달력 셀 키("2026-8-9")도 기록 날짜("2026-08-09")도 같은 칸을 가리키도록 0을 채워 맞춘다 */
export function normalizeDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 저장소 안에서 이 기록을 가리키는 키 */
export function memoKeyOf(target: MemoTarget): string {
  return `${KEY_PREFIX}${target.folderId}:${target.recordId}`;
}

let memos: Record<string, MemoEntry> = {};
let hydrated = false;

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

// 앱이 뜰 때 한 번 읽어 온다. 읽기 전에 화면이 먼저 그려질 수 있어서, 다 읽고 나면
// hydrated를 올리고 알린다 (메모 입력칸은 이 값이 바뀔 때 한 번 다시 마운트된다).
(async () => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        // 날짜 단위로 남겨 뒀던 메모는 기능과 함께 걷어낸다 — 기록 메모만 남긴다
        const kept: Record<string, MemoEntry> = {};
        Object.entries(parsed as Record<string, MemoEntry>).forEach(([key, entry]) => {
          if (key.startsWith(KEY_PREFIX) && entry?.text) kept[key] = entry;
        });
        memos = kept;
        if (Object.keys(kept).length !== Object.keys(parsed).length) {
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(memos));
        }
      }
    }
    await AsyncStorage.removeItem(LEGACY_KEY);
  } catch {
    // 읽기에 실패해도(첫 실행·저장소 손상) 빈 메모로 시작한다 — 쓰는 건 계속 된다
  } finally {
    hydrated = true;
    emit();
  }
})();

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(memos)).catch(() => {});
  }, SAVE_DELAY_MS);
}

export function getMemo(target: MemoTarget): string {
  return memos[memoKeyOf(target)]?.text ?? '';
}

/**
 * 빈 글은 아예 지운다 — 달력·카드의 메모 표시가 빈 메모에도 켜지지 않도록.
 *
 * 구독자에게 알리는 건 "메모가 있냐 없냐"가 뒤집힐 때뿐이다. 글자만 바뀌는 동안에도 알리면
 * 타자 한 번마다 달력 31칸이 다시 그려지는데, 정작 달력이 보는 건 있고 없고뿐이다.
 * 입력칸은 자기 state로 글자를 들고 있으므로 알림을 놓쳐도 문제가 없다.
 */
export function setMemo(target: MemoTarget, text: string): void {
  const key = memoKeyOf(target);
  const had = key in memos;

  if (text.trim() === '') {
    if (!had) return;
    const { [key]: _removed, ...rest } = memos;
    memos = rest;
    emit();
    scheduleSave();
    return;
  }

  if (memos[key]?.text === text) return;
  const entry: MemoEntry = {
    date: normalizeDateKey(target.date),
    folderId: target.folderId,
    recordId: target.recordId,
    label: target.label,
    text,
    updatedAt: Date.now(),
  };
  if (had) {
    memos[key] = entry; // 있고 없고가 그대로 → 조용히 갱신
  } else {
    memos = { ...memos, [key]: entry };
    emit();
  }
  scheduleSave();
}

const getSnapshot = () => memos;

/** 메모 전체 (키 → 내용) */
export function useMemos(): Record<string, MemoEntry> {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** 이 기록에 메모가 달려 있는지 — 접힌 카드에 표시를 띄울 때 쓴다 */
export function useHasMemo(target: MemoTarget): boolean {
  const all = useMemos();
  return memoKeyOf(target) in all;
}

/** 메모가 하나라도 달린 날짜들 — 달력 표시용 */
export function useDatesWithMemos(): Set<string> {
  const all = useMemos();
  return useMemo(() => new Set(Object.values(all).map((m) => m.date)), [all]);
}

const getHydrated = () => hydrated;

/** 저장소를 다 읽었는지 — 입력칸을 그 시점에 한 번 다시 세우기 위한 신호 */
export function useMemosHydrated(): boolean {
  return useSyncExternalStore(subscribe, getHydrated, getHydrated);
}

/**
 * 메모 전체를 날짜순(같은 날이면 쓴 순서)으로 돌려준다.
 * PDF 내보내기가 붙는 자리 — 화면을 거치지 않고 여기만 읽으면 된다.
 */
export function listMemos(): MemoEntry[] {
  return Object.values(memos).sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.updatedAt - b.updatedAt;
  });
}
