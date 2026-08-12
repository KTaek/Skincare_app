/**
 * 그날의 가려움 저장소 — 날짜 하나에 값 하나.
 *
 * 예전에는 촬영할 때마다 물었다(부위 선택 → **가려움 문진** → 촬영 방법 → 촬영). 두 가지가
 * 어긋나 있었다:
 *
 *   · 가려움은 **하루의 상태**이지 사진 한 장의 속성이 아니다. 같은 날 팔과 다리를 이어서 찍으면
 *     같은 질문에 같은 답을 두 번 하게 되고, 두 기록에 서로 다른 값이 들어갈 수도 있다 —
 *     같은 날 같은 몸인데.
 *   · 찍으러 들어온 사람 앞을 막는 단계라 그냥 넘기게 된다. 넘긴 값은 직전 기록에서 물려받으므로
 *     (folders/store의 recordExam) 추이는 "비었다"가 아니라 **틀린 값**으로 채워진다.
 *
 * 그래서 기록 탭에서 하루에 한 번만 받고, 그 값을 그날 촬영한 기록 전부에 적용한다.
 * **적용은 소급된다** — 저녁에 기록해도 그날 아침에 찍은 사진까지 함께 바뀐다(applyDayItch).
 * 촬영과 문진의 순서를 사용자가 신경 쓸 이유가 없어야 한다.
 *
 * 메모(memoStore)와 같은 이유로 AsyncStorage에 남긴다: 모델이 다시 만들어낼 수 있는 측정값이
 * 아니라 사용자가 직접 입력한 값이라, 앱을 껐다 켰다고 사라지면 안 된다.
 */
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { applyDayItch } from '../folders/store';
import { normalizeDateKey } from './memoStore';

const STORAGE_KEY = 'records.itchDay.v1';

/** 가려움 VAS의 최댓값 — 0(가렵지 않음) ~ 10(상상할 수 있는 최악) */
export const MAX_VAS = 10;

export interface DayItch {
  /** 가려움 VAS 0~10 (화면에 보여줄 때는 DISPLAY_SCALE.itch로 0~100 안정도로 뒤집는다) */
  vas: number;
  /** 마지막으로 고친 시각 (epoch ms) */
  updatedAt: number;
}

let byDate: Record<string, DayItch> = {};

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** 저장소가 바뀔 때 알려준다 — 화면 밖(RecordsContext)에서도 따라와야 해서 밖으로 연다 */
export function subscribeItch(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// 앱이 뜰 때 한 번 읽어 온다. 읽기 전에 화면이 먼저 그려질 수 있으므로, 다 읽고 나서 알린다.
(async () => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const kept: Record<string, DayItch> = {};
        Object.entries(parsed as Record<string, DayItch>).forEach(([date, entry]) => {
          if (typeof entry?.vas === 'number') kept[date] = entry;
        });
        byDate = kept;
      }
    }
  } catch {
    // 읽기에 실패해도(첫 실행·저장소 손상) 빈 채로 시작한다 — 쓰는 건 계속 된다
  } finally {
    /*
      저장돼 있던 값을 그날 기록에 다시 입힌다.

      폴더 기록은 세션 메모리라 앱을 다시 켤 때마다 새로 만들어지는데(folders/store 머리말),
      가려움만 저장소에 살아남는다. 다시 입히지 않으면 어제 기록해 둔 값이 오늘 앱을 켠 순간
      기록에서만 사라진 것처럼 보인다.
    */
    Object.entries(byDate).forEach(([date, entry]) => applyDayItch(date, entry.vas));
    emit();
  }
})();

/** 그날 기록해 둔 가려움 VAS. 아직 기록하지 않았으면 null */
export function getDayItch(dateKey: string): number | null {
  return byDate[normalizeDateKey(dateKey)]?.vas ?? null;
}

/**
 * 그날의 가려움을 정하고, **그날 촬영한 기록 전부에 적용한다.**
 *
 * 값이 그대로여도 적용은 다시 한다 — 기록해 둔 뒤에 찍은 사진이 있으면 그것도 같은 값이어야
 * 하는데, 촬영 쪽에서 이미 읽어 갔는지 여기서는 알 수 없기 때문이다(applyDayItch는 실제로
 * 바뀐 기록이 없으면 아무에게도 알리지 않으므로 헛일이 되지 않는다).
 */
export function setDayItch(dateKey: string, vas: number): void {
  const date = normalizeDateKey(dateKey);
  const v = Math.max(0, Math.min(MAX_VAS, Math.round(vas)));
  const changed = byDate[date]?.vas !== v;

  if (changed) {
    byDate = { ...byDate, [date]: { vas: v, updatedAt: Date.now() } };
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(byDate)).catch(() => {});
  }
  applyDayItch(date, v);
  if (changed) emit();
}

const getSnapshot = () => byDate;

/** 날짜별 가려움 전체 */
export function useDayItchMap(): Record<string, DayItch> {
  return useSyncExternalStore(subscribeItch, getSnapshot, getSnapshot);
}

/** 그날 기록해 둔 가려움 VAS (없으면 null) */
export function useDayItch(dateKey: string): number | null {
  const all = useDayItchMap();
  return all[normalizeDateKey(dateKey)]?.vas ?? null;
}
