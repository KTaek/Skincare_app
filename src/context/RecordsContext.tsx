import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { SkinRecord, buildSeedRecords, recordKey } from '../models';
import { getDayItch, subscribeItch } from '../records/itchStore';

interface RecordsContextValue {
  records: Record<string, SkinRecord[]>;
  addRecord: (record: SkinRecord) => void;
}

const RecordsContext = createContext<RecordsContextValue | null>(null);

/** 가려움 값 표기 — 없으면 "등록 안함" (models의 parseItch가 숫자만 뽑아 간다) */
const itchText = (vas: number | null) => (vas != null ? `${vas} / 10` : '등록 안함');

export function RecordsProvider({ children }: { children: React.ReactNode }) {
  const [records, setRecords] = useState<Record<string, SkinRecord[]>>(buildSeedRecords);

  const addRecord = useCallback((record: SkinRecord) => {
    setRecords((prev) => {
      const key = recordKey(record.date);
      const existing = prev[key] ?? [];
      return { ...prev, [key]: [...existing, record] };
    });
  }, []);

  /*
    "오늘의 가려움"이 바뀌면 그날 기록의 가려움도 함께 고친다.

    이 목록은 폴더 기록(folders/store)과 **같은 촬영을 다른 각도로 들고 있는 사본**이다 — 저쪽은
    자리별 추이, 이쪽은 날짜별 목록·가려움 추이(ItchDetailScreen)에 쓰인다. 소급 적용을 저쪽에만
    하면 같은 촬영이 화면에 따라 다른 가려움을 말하게 된다.

    사본을 두는 것 자체가 좋은 구조는 아니지만, 지금 두 저장소를 합치는 것은 이 변경의 범위를
    한참 넘는다. 대신 값이 갈라지지 않게 **한쪽(itchStore)만 원본**으로 두고 나머지는 따라오게 한다.
  */
  useEffect(
    () =>
      subscribeItch(() => {
        setRecords((prev) => {
          let changed = false;
          const next: Record<string, SkinRecord[]> = {};
          Object.entries(prev).forEach(([key, list]) => {
            const vas = getDayItch(key);
            if (vas == null) {
              next[key] = list;
              return;
            }
            const text = itchText(vas);
            if (list.every((r) => r.itch === text)) {
              next[key] = list;
              return;
            }
            changed = true;
            next[key] = list.map((r) => (r.itch === text ? r : { ...r, itch: text }));
          });
          return changed ? next : prev;
        });
      }),
    [],
  );

  const value = useMemo(() => ({ records, addRecord }), [records, addRecord]);

  return <RecordsContext.Provider value={value}>{children}</RecordsContext.Provider>;
}

export function useRecords(): RecordsContextValue {
  const ctx = useContext(RecordsContext);
  if (!ctx) throw new Error('useRecords must be used within a RecordsProvider');
  return ctx;
}
