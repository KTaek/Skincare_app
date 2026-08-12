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
import { makeRng } from '../folders/store';

/**
 * 데모용 과거 이행 기록 — 경과 관찰의 이행률 스케일바가 처음부터 그럴듯한 값을 보여주도록,
 * 오늘 이전 60일치를 결정적으로 흔들어 채워 둔다. 오늘(offset 0)과 그 이후는 건드리지 않는다 —
 * 실사용자가 루틴 탭에서 직접 체크해야 하는 날이라, 미리 체크돼 있으면 "오늘의 피부 케어"가
 * 이미 다 한 것처럼 보여서 혼란스럽다.
 *
 * id 1(BT4 Complex, 하루 1회)·2(음압 패치, 격일)는 models.ts의 initialProducts 시드와 짝이
 * 맞아야 한다 — 시드가 바뀌면 이 함수도 같이 고쳐야 한다. (BT4가 하루 2회이던 시절에는 여기서
 * 두 번째 시각의 key도 함께 채웠는데, 그 key는 이제 어느 줄과도 짝이 없어 조용히 버려진다.)
 */
function seedDemoCompletions(): Record<string, Set<string>> {
  const rng = makeRng(20260215);
  const bt4Keys = [careItemKey('product', 1, 0)]; // BT4 Complex — 하루 1회
  const patchKey = careItemKey('product', 2, 0); // 음압 패치 — 격일
  const map: Record<string, Set<string>> = {};
  for (let offset = 60; offset >= 1; offset--) {
    const day = addDays(new Date(), -offset);
    const done = new Set<string>();
    bt4Keys.forEach((key) => {
      if (rng() < 0.85) done.add(key);
    });
    if (isCycleDay(2, day) && rng() < 0.75) done.add(patchKey);
    if (done.size > 0) map[recordKey(day)] = done;
  }
  return map;
}

/** 루틴/제품을 추가할 때 화면에서 넘겨주는 값 */
export interface CareDraft {
  name: string;
  /** 하루 실행 시각들 — Routine.times와 같은 규칙(원소 수 = 하루 횟수, null = 시각 안 정함) */
  times: (string | null)[];
  /** 제품일 때만 의미가 있다 (기본 1 = 매일) */
  cycleDays?: number;
}

interface RoutineContextValue {
  /** 등록된 일상 루틴 (틀) */
  routines: Routine[];
  /** 등록된 사용 제품 (틀) */
  products: CareProduct[];

  /** offsetDays 날짜(음수=과거, 0=오늘)의 일상 루틴 — 하루 여러 번인 항목은 그 수만큼 펼쳐진다 */
  routinesForOffset: (offsetDays: number) => CareItem[];
  /** offsetDays 날짜에 실제로 쓰는 제품만 (사용 주기 반영) */
  productsForOffset: (offsetDays: number) => CareItem[];
  /** 등록된 제품 전부 — 주기가 맞지 않는 날은 due=false로 표시된다 (루틴 탭의 관리 목록용) */
  allProductsForOffset: (offsetDays: number) => CareItem[];
  /** 위 둘을 시각 순으로 합친 "오늘의 피부 케어" 목록 */
  careItemsForOffset: (offsetDays: number) => CareItem[];

  /** 체크 토글 — key는 careItemKey(kind, id, occurrenceIndex) */
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

  /**
   * 이름이 productName과 정확히 같은 "사용 제품"의 이행률 — [from, to] 구간(둘 다 포함) 동안
   * 사용 주기상 써야 했던 실행(occurrence) 중 실제로 체크한 것의 비율(0~1). 하루 2회 쓰는
   * 제품(BT4 Complex 등)은 그 두 번을 각각 센다 — 아침만 챙기고 저녁을 빠뜨렸으면 그 날은
   * 절반만 채운 걸로 잡힌다. 그 이름의 제품이 없거나 구간에 써야 했던 실행이 하나도 없으면
   * null이다 — 경과 관찰의 이행률 스케일바가 쓴다.
   */
  adherenceRate: (productName: string, from: Date, to: Date) => number | null;
}

const RoutineContext = createContext<RoutineContextValue | null>(null);

/** 시각 비교 — null(시각 안 정함)은 항상 뒤로 보낸다 */
function compareTime(a: string | null, b: string | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a.localeCompare(b);
}

/**
 * 틀(Routine/CareProduct) 목록을 그날의 CareItem 줄로 펼친다 — times가 여러 개면 그 수만큼
 * 줄이 생기고(각자 자기 시각과 자기 완료 여부를 갖는다), 펼친 뒤에 시각순으로 정렬한다.
 * (틀 단계에서 먼저 정렬하면 하루 2회인 항목의 두 시각이 서로 멀리 떨어져 있을 때 둘 다
 * 첫 시각 자리에 붙어버려서, 반드시 펼친 다음에 정렬해야 한다.)
 */
function expandForDate<T extends Routine>(
  items: T[],
  kind: CareKind,
  date: Date,
  completions: Record<string, Set<string>>,
  dueOf: (item: T) => boolean,
): CareItem[] {
  const done = completions[recordKey(date)];
  const rows: CareItem[] = [];
  items.forEach((item) => {
    const times = item.times.length > 0 ? item.times : [null];
    const due = dueOf(item);
    times.forEach((time, occurrenceIndex) => {
      const key = careItemKey(kind, item.id, occurrenceIndex);
      rows.push({
        id: item.id,
        name: item.name,
        time,
        kind,
        cycleDays: (item as unknown as CareProduct).cycleDays,
        key,
        due,
        occurrenceIndex,
        occurrenceCount: times.length,
        done: done ? done.has(key) : false,
      });
    });
  });
  return rows.sort((a, b) => compareTime(a.time, b.time));
}

export function RoutineProvider({ children }: { children: React.ReactNode }) {
  // routines/products는 이름·시각 등 '틀'만 담는다 — 완료 여부는 날짜별로 completions에 따로 쌓인다
  const [routines, setRoutines] = useState<Routine[]>(initialRoutines);
  const [products, setProducts] = useState<CareProduct[]>(initialProducts);
  // 날짜 키("2026-8-6") -> 그날 완료 처리된 항목 key 집합. 과거분은 데모용 dump로 미리 채운다.
  const [completions, setCompletions] = useState<Record<string, Set<string>>>(seedDemoCompletions);

  const routinesForDate = useCallback(
    (date: Date): CareItem[] => expandForDate(routines, 'routine', date, completions, () => true),
    [routines, completions],
  );

  /** 등록된 제품 전부를 그날 기준(due 판정 포함)으로 펼친다 */
  const allProductsForDate = useCallback(
    (date: Date): CareItem[] =>
      expandForDate(products, 'product', date, completions, (p) => isCycleDay(p.cycleDays, date)),
    [products, completions],
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
    const times = draft.times.length > 0 ? draft.times : [null];
    const base = { id: Date.now(), name: draft.name, times, done: false };
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
      if (patch.times != null) next.times = patch.times.length > 0 ? patch.times : [null];
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

  const adherenceRate = useCallback(
    (productName: string, from: Date, to: Date): number | null => {
      const product = products.find((p) => p.name === productName);
      if (!product) return null;
      const occurrenceCount = Math.max(1, product.times.length);
      let due = 0;
      let done = 0;
      // 시각을 뗀 달력 날짜로만 하루씩 훑는다 — from/to에 시각이 섞여 있어도 날짜 경계가 흔들리지 않는다
      let day = new Date(from.getFullYear(), from.getMonth(), from.getDate());
      const last = new Date(to.getFullYear(), to.getMonth(), to.getDate());
      while (day.getTime() <= last.getTime()) {
        if (isCycleDay(product.cycleDays, day)) {
          const doneSet = completions[recordKey(day)];
          for (let occurrenceIndex = 0; occurrenceIndex < occurrenceCount; occurrenceIndex++) {
            due += 1;
            if (doneSet?.has(careItemKey('product', product.id, occurrenceIndex))) done += 1;
          }
        }
        day = addDays(day, 1);
      }
      return due > 0 ? done / due : null;
    },
    [products, completions],
  );

  const value = useMemo(
    () => ({
      routines,
      products,
      routinesForOffset,
      productsForOffset,
      allProductsForOffset,
      careItemsForOffset,
      toggleForOffset,
      add,
      update,
      remove,
      productsUsedOn,
      adherenceRate,
    }),
    [
      routines,
      products,
      routinesForOffset,
      productsForOffset,
      allProductsForOffset,
      careItemsForOffset,
      toggleForOffset,
      add,
      update,
      remove,
      productsUsedOn,
      adherenceRate,
    ],
  );

  return <RoutineContext.Provider value={value}>{children}</RoutineContext.Provider>;
}

export function useRoutines(): RoutineContextValue {
  const ctx = useContext(RoutineContext);
  if (!ctx) throw new Error('useRoutines must be used within a RoutineProvider');
  return ctx;
}
