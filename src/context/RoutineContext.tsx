import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  CareItem,
  CareKind,
  CareProduct,
  Routine,
  addDays,
  careItemKey,
  initialProducts,
  initialRoutines,
  isCycleDay,
  recordKey,
} from '../models';

/** 루틴/제품을 추가할 때 화면에서 넘겨주는 값 */
export interface CareDraft {
  name: string;
  time: string;
  push: boolean;
  /** 제품일 때만 의미가 있다 (기본 1 = 매일) */
  cycleDays?: number;
}

interface RoutineContextValue {
  /** 등록된 일상 루틴 (틀) — 시각 순 */
  routines: Routine[];
  /** 등록된 사용 제품 (틀) — 시각 순 */
  products: CareProduct[];

  /** offsetDays 날짜(음수=과거, 0=오늘)의 일상 루틴 */
  routinesForOffset: (offsetDays: number) => CareItem[];
  /** offsetDays 날짜에 실제로 쓰는 제품만 (사용 주기 반영) */
  productsForOffset: (offsetDays: number) => CareItem[];
  /** 등록된 제품 전부 — 주기가 맞지 않는 날은 due=false로 표시된다 (루틴 탭의 관리 목록용) */
  allProductsForOffset: (offsetDays: number) => CareItem[];
  /** 위 둘을 시각 순으로 합친 "오늘의 피부 케어" 목록 */
  careItemsForOffset: (offsetDays: number) => CareItem[];

  /** 체크 토글 — key는 careItemKey(kind, id) */
  toggleForOffset: (offsetDays: number, key: string) => void;

  add: (kind: CareKind, draft: CareDraft) => void;
  update: (kind: CareKind, id: number, patch: Partial<CareDraft>) => void;
  remove: (kind: CareKind, id: number) => void;

  /**
   * 특정 날짜에 쓴 제품 — 상세 결과 화면의 "사용한 제품"이 쓴다.
   * 그날 체크 기록이 있으면 체크한 것만, 아직 아무것도 체크하지 않은 날(과거 dump 기록 등)은
   * 그날 쓰기로 되어 있던 제품을 그대로 돌려준다.
   */
  productsUsedOn: (date: Date) => CareItem[];
}

const RoutineContext = createContext<RoutineContextValue | null>(null);

const byTime = <T extends { time: string }>(list: T[]): T[] =>
  [...list].sort((a, b) => a.time.localeCompare(b.time));

export function RoutineProvider({ children }: { children: React.ReactNode }) {
  // routines/products는 이름·시각 등 '틀'만 담는다 — 완료 여부는 날짜별로 completions에 따로 쌓인다
  const [routines, setRoutines] = useState<Routine[]>(initialRoutines);
  const [products, setProducts] = useState<CareProduct[]>(initialProducts);
  // 날짜 키("2026-8-6") -> 그날 완료 처리된 항목 key 집합
  const [completions, setCompletions] = useState<Record<string, Set<string>>>({});

  const sortedRoutines = useMemo(() => byTime(routines), [routines]);
  const sortedProducts = useMemo(() => byTime(products), [products]);

  const routinesForDate = useCallback(
    (date: Date): CareItem[] => {
      const done = completions[recordKey(date)];
      return sortedRoutines.map((r) => {
        const key = careItemKey('routine', r.id);
        return { ...r, kind: 'routine' as const, key, due: true, done: done ? done.has(key) : false };
      });
    },
    [sortedRoutines, completions],
  );

  /** 등록된 제품 전부를 그날 기준(due 판정 포함)으로 펼친다 */
  const allProductsForDate = useCallback(
    (date: Date): CareItem[] => {
      const done = completions[recordKey(date)];
      return sortedProducts.map((p) => {
        const key = careItemKey('product', p.id);
        return {
          ...p,
          kind: 'product' as const,
          key,
          due: isCycleDay(p.cycleDays, date),
          done: done ? done.has(key) : false,
        };
      });
    },
    [sortedProducts, completions],
  );

  /** 그날 실제로 쓰는 제품만 */
  const productsForDate = useCallback(
    (date: Date): CareItem[] => allProductsForDate(date).filter((p) => p.due),
    [allProductsForDate],
  );

  const routinesForOffset = useCallback(
    (offsetDays: number) => routinesForDate(addDays(new Date(), offsetDays)),
    [routinesForDate],
  );

  const productsForOffset = useCallback(
    (offsetDays: number) => productsForDate(addDays(new Date(), offsetDays)),
    [productsForDate],
  );

  const allProductsForOffset = useCallback(
    (offsetDays: number) => allProductsForDate(addDays(new Date(), offsetDays)),
    [allProductsForDate],
  );

  /**
   * 홈의 "오늘의 피부 케어" 목록 — 사용 제품을 먼저, 일상 루틴을 그 아래에 묶어서 보여준다.
   * 예전엔 둘을 시각순으로 한 줄에 섞었는데, 그러면 제품 하나 사이사이에 루틴이 끼어들어
   * "오늘 뭘 발라야 하지"를 한눈에 훑기 어려웠다. 각 묶음 안에서는 여전히 시각순이다
   * (routinesForOffset/productsForOffset이 이미 시각순으로 정렬해서 준다).
   */
  const careItemsForOffset = useCallback(
    (offsetDays: number) => [...productsForOffset(offsetDays), ...routinesForOffset(offsetDays)],
    [routinesForOffset, productsForOffset],
  );

  const toggleForOffset = useCallback((offsetDays: number, key: string) => {
    const dateKey = recordKey(addDays(new Date(), offsetDays));
    setCompletions((prev) => {
      const next = new Set(prev[dateKey] ?? []);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...prev, [dateKey]: next };
    });
  }, []);

  const add = useCallback((kind: CareKind, draft: CareDraft) => {
    const base = { id: Date.now(), name: draft.name, time: draft.time, done: false, push: draft.push };
    if (kind === 'product') {
      setProducts((prev) => [...prev, { ...base, cycleDays: Math.max(1, draft.cycleDays ?? 1) }]);
    } else {
      setRoutines((prev) => [...prev, base]);
    }
  }, []);

  const update = useCallback((kind: CareKind, id: number, patch: Partial<CareDraft>) => {
    const apply = <T extends Routine>(item: T): T => {
      if (item.id !== id) return item;
      const next: any = { ...item };
      if (patch.name != null) next.name = patch.name;
      if (patch.time != null) next.time = patch.time;
      if (patch.push != null) next.push = patch.push;
      if (patch.cycleDays != null) next.cycleDays = Math.max(1, patch.cycleDays);
      return next;
    };
    if (kind === 'product') setProducts((prev) => prev.map(apply));
    else setRoutines((prev) => prev.map(apply));
  }, []);

  const remove = useCallback((kind: CareKind, id: number) => {
    if (kind === 'product') setProducts((prev) => prev.filter((p) => p.id !== id));
    else setRoutines((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const productsUsedOn = useCallback(
    (date: Date) => {
      const scheduled = productsForDate(date);
      const checked = scheduled.filter((p) => p.done);
      return checked.length > 0 ? checked : scheduled;
    },
    [productsForDate],
  );

  const value = useMemo(
    () => ({
      routines: sortedRoutines,
      products: sortedProducts,
      routinesForOffset,
      productsForOffset,
      allProductsForOffset,
      careItemsForOffset,
      toggleForOffset,
      add,
      update,
      remove,
      productsUsedOn,
    }),
    [
      sortedRoutines,
      sortedProducts,
      routinesForOffset,
      productsForOffset,
      allProductsForOffset,
      careItemsForOffset,
      toggleForOffset,
      add,
      update,
      remove,
      productsUsedOn,
    ],
  );

  return <RoutineContext.Provider value={value}>{children}</RoutineContext.Provider>;
}

export function useRoutines(): RoutineContextValue {
  const ctx = useContext(RoutineContext);
  if (!ctx) throw new Error('useRoutines must be used within a RoutineProvider');
  return ctx;
}
