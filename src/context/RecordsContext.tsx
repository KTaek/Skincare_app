import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { SkinRecord, buildSeedRecords, recordKey } from '../models';

interface RecordsContextValue {
  records: Record<string, SkinRecord[]>;
  addRecord: (record: SkinRecord) => void;
}

const RecordsContext = createContext<RecordsContextValue | null>(null);

export function RecordsProvider({ children }: { children: React.ReactNode }) {
  const [records, setRecords] = useState<Record<string, SkinRecord[]>>(buildSeedRecords);

  const addRecord = useCallback((record: SkinRecord) => {
    setRecords((prev) => {
      const key = recordKey(record.date);
      const existing = prev[key] ?? [];
      return { ...prev, [key]: [...existing, record] };
    });
  }, []);

  const value = useMemo(() => ({ records, addRecord }), [records, addRecord]);

  return <RecordsContext.Provider value={value}>{children}</RecordsContext.Provider>;
}

export function useRecords(): RecordsContextValue {
  const ctx = useContext(RecordsContext);
  if (!ctx) throw new Error('useRecords must be used within a RecordsProvider');
  return ctx;
}
