import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { BodySpot } from '../monitoring/bodyParts';
import { BodyModelId } from '../three/humanModel';
import { Baseline, MonitorDiagnosis, MonitorSession, MonitorTarget } from '../monitoring/types';
import { newId } from '../monitoring/postProcess';
import { DEMO_TARGETS } from '../folders/targets';

interface MonitoringContextValue {
  targets: MonitorTarget[];
  sessions: MonitorSession[];
  /** 같은 자리를 다시 고르면 기존 대상을 돌려준다 (기준 세션이 이어져야 비교가 된다) */
  ensureTarget: (modelId: BodyModelId, spot: BodySpot, diagnosis?: MonitorDiagnosis) => MonitorTarget;
  findTarget: (id: string) => MonitorTarget | undefined;
  addSession: (session: MonitorSession, baseline?: Baseline) => void;
  sessionsOf: (targetId: string) => MonitorSession[];
}

const MonitoringContext = createContext<MonitoringContextValue | null>(null);

/**
 * 모니터링 대상과 세션을 들고 있는 저장소.
 * 지금은 앱 메모리에만 남는다 — 실제 서비스에서는 AsyncStorage/서버로 옮겨야
 * 재설치·재시작 후에도 기준 세션(baseline)이 유지된다.
 */
export function MonitoringProvider({ children }: { children: React.ReactNode }) {
  // 데모 모니터링 폴더 2개(folders/store.js의 프리셋)가 참조하는 대상을 미리 넣어 둔다 —
  // 그래야 그 폴더에서도 "오늘의 피부 상태 기록"이 실제 가이드 촬영을 띄울 수 있다.
  const [targets, setTargets] = useState<MonitorTarget[]>(DEMO_TARGETS);
  const [sessions, setSessions] = useState<MonitorSession[]>([]);

  const ensureTarget = useCallback(
    (modelId: BodyModelId, spot: BodySpot, diagnosis?: MonitorDiagnosis) => {
      const existing = targets.find((t) => t.spotId === spot.id && t.modelId === modelId);
      if (existing) {
        // 같은 자리를 다시 등록하면서 문진을 새로 했으면 질환 정보만 갱신한다
        if (diagnosis) {
          setTargets((prev) => prev.map((t) => (t.id === existing.id ? { ...t, diagnosis } : t)));
          return { ...existing, diagnosis };
        }
        return existing;
      }
      const created: MonitorTarget = {
        id: newId('tgt'),
        modelId,
        spotId: spot.id,
        part: spot.part,
        facing: spot.facing,
        label: spot.label,
        diagnosis,
        createdAt: new Date(),
        sessionCount: 0,
      };
      setTargets((prev) => [...prev, created]);
      return created;
    },
    [targets],
  );

  const findTarget = useCallback((id: string) => targets.find((t) => t.id === id), [targets]);

  const addSession = useCallback((session: MonitorSession, baseline?: Baseline) => {
    setSessions((prev) => [...prev, session]);
    setTargets((prev) =>
      prev.map((t) =>
        t.id === session.targetId
          ? {
              ...t,
              sessionCount: t.sessionCount + 1,
              lastCapturedAt: session.capturedAt,
              // 기준 세션은 처음 한 번만 정한다. 이후 세션이 기준을 덮어쓰면
              // 조금씩 밀려서(drift) 예전 사진과의 비교가 무의미해진다.
              baseline: t.baseline ?? baseline,
            }
          : t,
      ),
    );
  }, []);

  const sessionsOf = useCallback(
    (targetId: string) => sessions.filter((s) => s.targetId === targetId),
    [sessions],
  );

  const value = useMemo(
    () => ({ targets, sessions, ensureTarget, findTarget, addSession, sessionsOf }),
    [targets, sessions, ensureTarget, findTarget, addSession, sessionsOf],
  );

  return <MonitoringContext.Provider value={value}>{children}</MonitoringContext.Provider>;
}

export function useMonitoring(): MonitoringContextValue {
  const ctx = useContext(MonitoringContext);
  if (!ctx) throw new Error('useMonitoring must be used within a MonitoringProvider');
  return ctx;
}
