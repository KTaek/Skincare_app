import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { BodySpot } from '../monitoring/bodyParts';
import { BodyModelId } from '../three/humanModel';
import { Baseline, MonitorDiagnosis, MonitorSession, MonitorTarget } from '../monitoring/types';
import { newId } from '../monitoring/postProcess';
import { VISIBLE_DEMO_TARGETS } from '../folders/targets';

interface MonitoringContextValue {
  targets: MonitorTarget[];
  sessions: MonitorSession[];
  /**
   * "신규 증상 기록하기"가 부르는 유일한 생성 함수 — **부를 때마다 새 대상을 만든다.**
   *
   * 예전에는 같은 자리(spotId)를 고르면 기존 대상을 돌려줬다(ensureTarget). 기준 세션이 이어져야
   * 비교가 된다는 이유였는데, 실제로는 이런 일이 생겼다: 머리를 등록해 두 번 찍고(그때 판정은
   * '주사') 나중에 **"신규 증상 기록하기"로 머리를 다시 등록했더니 판정이 '아토피피부염'인데도
   * 그 두 장에 이어붙었다.** 폴더는 대상 하나당 하나라서, 새 질환의 기록이 옛 질환의 시계열
   * 뒤에 붙고 폴더 이름만 새 질환으로 바뀌었다 — 사용자 눈에는 처음부터 아토피였던 것이 된다.
   *
   * 사용자가 "신규"를 골랐다는 것 자체가 "이건 새로 시작하는 기록"이라는 뜻이다. 이어 붙이고
   * 싶으면 "이어서 기록하기"라는 길이 따로 있다. 이름과 동작이 어긋나지 않게 맞췄다.
   *
   * 이 규칙 덕분에 **폴더의 질환은 만들어질 때 정해지고 끝까지 바뀌지 않는다.** 이어서 기록은
   * 질환 분류를 아예 돌리지 않으므로(CameraScreen의 skipDisease), 한 폴더 안에서는 등급을
   * 매길 수 있는지 여부(severitySupported)도 회차마다 같다 — 등급을 재지 않은 회차의 0이
   * 아토피 그래프에 "완벽히 깨끗함"으로 섞여 들어가던 문제가 여기서 함께 사라진다.
   */
  createTarget: (modelId: BodyModelId, spot: BodySpot, diagnosis?: MonitorDiagnosis) => MonitorTarget;
  findTarget: (id: string) => MonitorTarget | undefined;
  /** 결과 화면에서 질환 분류 모델이 이름을 알아냈을 때 대상에 붙여 준다 (폴더 이름이 여기서 나온다) */
  setDiagnosis: (targetId: string, diagnosis: MonitorDiagnosis) => void;
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
  /*
    화면에 올린 데모 폴더(folders/store.js의 프리셋)가 참조하는 대상을 미리 넣어 둔다 — 그래야
    그 폴더에서도 "오늘의 피부 상태 기록"이 실제 가이드 촬영을 띄울 수 있다.

    **보이는 폴더의 것만 넣는다.** 폴더를 감춘 자리의 대상까지 넣어 두면, 폴더 목록에는 없는
    자리가 "이어서 기록하기"의 대상 목록에는 그대로 떠서 고를 수 있게 된다 — 고르고 나면 기록이
    보이지 않는 폴더로 들어간다.
  */
  const [targets, setTargets] = useState<MonitorTarget[]>(VISIBLE_DEMO_TARGETS);
  const [sessions, setSessions] = useState<MonitorSession[]>([]);

  /*
    같은 자리를 다시 등록해도 **찾지 않고 무조건 만든다.** spotId가 겹치는 대상이 여럿 생기는데
    의도한 것이다 — 어디에서도 spotId로 대상을 찾지 않고(찾는 곳은 id뿐이다), 3D 지도의 하이라이트
    계산(partsOfSpotId)은 순수 변환이라 중복에 영향을 받지 않는다.

    새 대상은 baseline이 비어 있으므로 **첫 촬영이 그 폴더의 기준 사진이 된다.** 이것도 옳다:
    새로 시작한 기록이 옛 기록의 조명·구도를 기준으로 삼을 이유가 없다.
  */
  const createTarget = useCallback(
    (modelId: BodyModelId, spot: BodySpot, diagnosis?: MonitorDiagnosis) => {
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
    [],
  );

  const findTarget = useCallback((id: string) => targets.find((t) => t.id === id), [targets]);

  const setDiagnosis = useCallback((targetId: string, diagnosis: MonitorDiagnosis) => {
    setTargets((prev) => prev.map((t) => (t.id === targetId ? { ...t, diagnosis } : t)));
  }, []);

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
    () => ({ targets, sessions, createTarget, findTarget, setDiagnosis, addSession, sessionsOf }),
    [targets, sessions, createTarget, findTarget, setDiagnosis, addSession, sessionsOf],
  );

  return <MonitoringContext.Provider value={value}>{children}</MonitoringContext.Provider>;
}

export function useMonitoring(): MonitoringContextValue {
  const ctx = useContext(MonitoringContext);
  if (!ctx) throw new Error('useMonitoring must be used within a MonitoringProvider');
  return ctx;
}
