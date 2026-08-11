import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { BodySpot } from '../monitoring/bodyParts';
import { BodyModelId } from '../three/humanModel';
import { Baseline, MonitorDiagnosis, MonitorSession, MonitorTarget } from '../monitoring/types';
import { newId } from '../monitoring/postProcess';
import { loadSaved, persistPhoto, saveLater, TARGETS_KEY } from '../folders/persist';

interface MonitoringContextValue {
  targets: MonitorTarget[];
  sessions: MonitorSession[];
  /** 같은 자리를 다시 고르면 기존 대상을 돌려준다 (기준 세션이 이어져야 비교가 된다) */
  ensureTarget: (modelId: BodyModelId, spot: BodySpot, diagnosis?: MonitorDiagnosis) => MonitorTarget;
  findTarget: (id: string) => MonitorTarget | undefined;
  /** 결과 화면에서 질환 분류 모델이 이름을 알아냈을 때 대상에 붙여 준다 (폴더 이름이 여기서 나온다) */
  setDiagnosis: (targetId: string, diagnosis: MonitorDiagnosis) => void;
  addSession: (session: MonitorSession, baseline?: Baseline) => void;
  sessionsOf: (targetId: string) => MonitorSession[];
}

const MonitoringContext = createContext<MonitoringContextValue | null>(null);

/**
 * 모니터링 대상(지켜보는 자리)과 이번 실행의 촬영 세션을 들고 있는 저장소.
 *
 * ── 무엇이 남고 무엇이 사라지는가 ─────────────────────────────
 *
 * **대상은 저장된다**(AsyncStorage). 여기에 기준 세션(baseline)이 붙어 있기 때문이다 — 그것이
 * 사라지면 다음 촬영이 맞출 고스트와 자세 기준이 없어져서, 같은 자리를 다시 찍어도 넓이를 회차
 * 간에 견줄 수 없다. 즉 대상을 저장하지 않으면 **앱을 껐다 켜는 것만으로 추이가 끊긴다.**
 *
 * **세션은 저장하지 않는다.** 촬영 순간에만 의미가 있는 값(정지 판정 지문 등)이고, 다음 촬영이
 * 필요로 하는 것은 baseline뿐이다. 결과로 남길 값은 이미 폴더 기록(folders/store)에 들어간다.
 *
 * 예시 대상은 없다. 예전에는 데모 폴더 두 개가 참조할 대상을 미리 넣어 두었는데, 저장이 붙은
 * 뒤로는 지워지지 않는 남의 기록처럼 남는다.
 */
export function MonitoringProvider({ children }: { children: React.ReactNode }) {
  const [targets, setTargets] = useState<MonitorTarget[]>([]);
  const [sessions, setSessions] = useState<MonitorSession[]>([]);
  /**
   * 저장된 대상을 다 불러왔는지.
   *
   * 이 플래그가 필요한 이유: 불러오기가 끝나기 전에 저장을 예약하면 **빈 배열이 저장되어 기존
   * 기록을 지운다.** 앱을 켜자마자 촬영 화면에 들어가는 경우가 정확히 그 순간이다.
   */
  const hydrated = useRef(false);

  useEffect(() => {
    let alive = true;
    loadSaved<MonitorTarget[]>(TARGETS_KEY).then((saved) => {
      if (!alive) return;
      // JSON에는 Date가 없다 — 문자열로 돌아온 것을 되살린다 (촬영 시각으로 정렬·표시한다)
      if (Array.isArray(saved)) {
        /*
          불러온 것으로 덮어쓰지 않고 합친다. 앱을 켜자마자 자리를 등록하면 그것이 먼저 상태에
          들어가는데, 뒤늦게 끝난 불러오기가 통째로 덮으면 방금 만든 자리가 사라진다.
        */
        const revived = saved.map(reviveTarget);
        const savedIds = new Set(revived.map((t) => t.id));
        setTargets((prev) => [...prev.filter((t) => !savedIds.has(t.id)), ...revived]);
      }
      hydrated.current = true;
    });
    return () => {
      alive = false;
    };
  }, []);

  // 불러오기가 끝난 뒤의 변경만 저장한다 (위 hydrated 주석)
  useEffect(() => {
    if (hydrated.current) saveLater(TARGETS_KEY, () => targets);
  }, [targets]);

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

  const setDiagnosis = useCallback((targetId: string, diagnosis: MonitorDiagnosis) => {
    setTargets((prev) => prev.map((t) => (t.id === targetId ? { ...t, diagnosis } : t)));
  }, []);

  const addSession = useCallback((session: MonitorSession, baseline?: Baseline) => {
    setSessions((prev) => [...prev, session]);

    /*
      기준 세션의 사진은 오래 남는 자리로 옮긴다.

      이 사진은 다음 촬영의 고스트로 화면에 깔리는 그림이자 정렬 목표다. 캐시에 둔 채 저장하면
      OS가 캐시를 비우는 순간 고스트가 사라지고, 사용자는 맞출 대상 없이 촬영하게 된다.
      복사를 기다리지 않고 끝나는 대로 경로만 바꾼다 — 촬영 흐름이 파일 복사에 묶이면 안 된다.
    */
    if (baseline?.processedUri) {
      persistPhoto(baseline.processedUri).then((uri) => {
        if (!uri || uri === baseline.processedUri) return;
        setTargets((prev) =>
          prev.map((t) =>
            t.id === session.targetId && t.baseline?.sessionId === baseline.sessionId
              ? { ...t, baseline: { ...t.baseline, processedUri: uri } }
              : t,
          ),
        );
      });
    }

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
    () => ({ targets, sessions, ensureTarget, findTarget, setDiagnosis, addSession, sessionsOf }),
    [targets, sessions, ensureTarget, findTarget, setDiagnosis, addSession, sessionsOf],
  );

  return <MonitoringContext.Provider value={value}>{children}</MonitoringContext.Provider>;
}

/**
 * 저장에서 되살린 대상의 날짜 필드를 Date로 되돌린다.
 * JSON은 Date를 문자열로 만들고, 그 문자열에 .getTime()을 부르면 앱이 죽는다.
 */
function reviveTarget(t: MonitorTarget): MonitorTarget {
  return {
    ...t,
    createdAt: new Date(t.createdAt),
    lastCapturedAt: t.lastCapturedAt ? new Date(t.lastCapturedAt) : undefined,
  };
}

export function useMonitoring(): MonitoringContextValue {
  const ctx = useContext(MonitoringContext);
  if (!ctx) throw new Error('useMonitoring must be used within a MonitoringProvider');
  return ctx;
}
