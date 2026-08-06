import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Routine, initialRoutines, withPatchDayDisplay, addDays, recordKey } from '../models';

interface RoutineContextValue {
  /** 오늘 기준, 시각 순으로 정렬된 전체 루틴 */
  sorted: Routine[];
  /** 오늘 루틴 체크 토글 */
  toggle: (id: number) => void;
  add: (name: string, time: string) => void;
  remove: (id: number) => void;
  /** offsetDays만큼 떨어진 날짜(음수=과거, 0=오늘, 양수=미래)의 루틴 목록을 반환 —
   *  홈의 "루틴" 카드를 좌우로 넘겨볼 때 사용 */
  routinesForOffset: (offsetDays: number) => Routine[];
  /** offsetDays 날짜의 특정 루틴 체크를 토글 (과거 기록 정정용, 오늘 포함) */
  toggleForOffset: (offsetDays: number, id: number) => void;
}

const RoutineContext = createContext<RoutineContextValue | null>(null);

export function RoutineProvider({ children }: { children: React.ReactNode }) {
  // routines는 이름/시각 등 '틀'만 담는다 — 완료 여부는 날짜별로 completions에 따로 쌓인다
  const [routines, setRoutines] = useState<Routine[]>(initialRoutines);
  // 날짜 키("2026-8-6") -> 그날 완료 처리된 루틴 id 집합
  const [completions, setCompletions] = useState<Record<string, Set<number>>>({});

  const routinesForDate = useCallback(
    (date: Date): Routine[] => {
      const key = recordKey(date);
      const done = completions[key];
      const named = withPatchDayDisplay(
        [...routines].sort((a, b) => a.time.localeCompare(b.time)),
        date,
      );
      return named.map((r) => ({ ...r, done: done ? done.has(r.id) : false }));
    },
    [routines, completions],
  );

  const routinesForOffset = useCallback(
    (offsetDays: number) => routinesForDate(addDays(new Date(), offsetDays)),
    [routinesForDate],
  );

  const sorted = useMemo(() => routinesForDate(new Date()), [routinesForDate]);

  const toggleForOffset = useCallback((offsetDays: number, id: number) => {
    const key = recordKey(addDays(new Date(), offsetDays));
    setCompletions((prev) => {
      const next = new Set(prev[key] ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, [key]: next };
    });
  }, []);

  const toggle = useCallback((id: number) => toggleForOffset(0, id), [toggleForOffset]);

  const add = useCallback((name: string, time: string) => {
    setRoutines((prev) => [...prev, { id: Date.now(), name, time, done: false }]);
  }, []);

  const remove = useCallback((id: number) => {
    setRoutines((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const value = useMemo(
    () => ({ sorted, toggle, add, remove, routinesForOffset, toggleForOffset }),
    [sorted, toggle, add, remove, routinesForOffset, toggleForOffset],
  );

  return <RoutineContext.Provider value={value}>{children}</RoutineContext.Provider>;
}

export function useRoutines(): RoutineContextValue {
  const ctx = useContext(RoutineContext);
  if (!ctx) throw new Error('useRoutines must be used within a RoutineProvider');
  return ctx;
}
