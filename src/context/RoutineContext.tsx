import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Routine, initialRoutines } from '../models';

interface RoutineContextValue {
  /** 시각 순으로 정렬된 전체 루틴 */
  sorted: Routine[];
  /** 홈에 노출되는, 아직 숨겨지지 않은 다가오는 3개 */
  upcoming: Routine[];
  toggle: (id: number) => void;
  add: (name: string, time: string) => void;
  remove: (id: number) => void;
}

const RoutineContext = createContext<RoutineContextValue | null>(null);

export function RoutineProvider({ children }: { children: React.ReactNode }) {
  const [routines, setRoutines] = useState<Routine[]>(initialRoutines);
  // 완료 애니메이션이 끝나 홈에서 사라진 루틴
  const [hiddenFromHome, setHiddenFromHome] = useState<Set<number>>(new Set());
  // setTimeout 정리를 위한 보관
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const sorted = useMemo(
    () => [...routines].sort((a, b) => a.time.localeCompare(b.time)),
    [routines],
  );

  const upcoming = useMemo(
    () => sorted.filter((r) => !hiddenFromHome.has(r.id)).slice(0, 3),
    [sorted, hiddenFromHome],
  );

  const toggle = useCallback((id: number) => {
    setRoutines((prev) => {
      const next = prev.map((r) => (r.id === id ? { ...r, done: !r.done } : r));
      const target = next.find((r) => r.id === id);
      if (target?.done) {
        // 줄긋기는 즉시, 홈 목록에서 제거는 1초 페이드 아웃 후
        const t = setTimeout(() => {
          setHiddenFromHome((h) => new Set(h).add(id));
          timers.current.delete(id);
        }, 1000);
        timers.current.set(id, t);
      } else {
        const t = timers.current.get(id);
        if (t) {
          clearTimeout(t);
          timers.current.delete(id);
        }
        setHiddenFromHome((h) => {
          if (!h.has(id)) return h;
          const copy = new Set(h);
          copy.delete(id);
          return copy;
        });
      }
      return next;
    });
  }, []);

  const add = useCallback((name: string, time: string) => {
    setRoutines((prev) => [...prev, { id: Date.now(), name, time, done: false }]);
  }, []);

  const remove = useCallback((id: number) => {
    setRoutines((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const value = useMemo(
    () => ({ sorted, upcoming, toggle, add, remove }),
    [sorted, upcoming, toggle, add, remove],
  );

  return <RoutineContext.Provider value={value}>{children}</RoutineContext.Provider>;
}

export function useRoutines(): RoutineContextValue {
  const ctx = useContext(RoutineContext);
  if (!ctx) throw new Error('useRoutines must be used within a RoutineProvider');
  return ctx;
}
