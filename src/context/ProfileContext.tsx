import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { kUserName } from '../models';

/**
 * 프로필 · 앱 설정 — "더보기" 화면에서 고치는 값들.
 *
 * 여기서 특히 중요한 건 healthConnected다: 수면 점수는 앱이 직접 재는 값이 아니라 스마트워치
 * (Samsung Health) 연동으로 들어오는 값이라, 연동을 끊어 두면 결과·상세 화면의 수면 점수는
 * 0점이 아니라 "미기재"로 남아야 한다.
 */
export interface BodyInfo {
  /** cm */
  height: number;
  /** kg */
  weight: number;
  /** 만 나이 */
  age: number;
  sex: 'male' | 'female';
}

interface ProfileContextValue {
  name: string;
  body: BodyInfo;
  /** 스마트워치(Samsung Health) 연동 여부 — 수면 점수의 출처 */
  healthConnected: boolean;
  /**
   * 루틴·제품 알림을 받을지 — **앱 전체에 한 번만 정한다.**
   *
   * 예전에는 루틴을 추가할 때마다 "PUSH 알람 수신 여부"를 물었다. 그런데 사용자가 실제로
   * 내리는 결정은 "알림을 받을까 말까" 하나이고, 항목마다 다르게 정하고 싶은 경우는 드물다 —
   * 그 질문이 등록 흐름에서 매번 한 단계를 차지하고, 저장 버튼까지 막고 있었다(답해야만 저장됨).
   * 기기의 알림 권한도 어차피 앱 단위라, 설정이 있어야 할 자리도 여기가 맞다.
   */
  pushEnabled: boolean;
  setName: (name: string) => void;
  setBody: (patch: Partial<BodyInfo>) => void;
  setHealthConnected: (connected: boolean) => void;
  setPushEnabled: (enabled: boolean) => void;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [name, setNameState] = useState(kUserName);
  const [body, setBodyState] = useState<BodyInfo>({ height: 174, weight: 68, age: 32, sex: 'male' });
  const [healthConnected, setHealthConnected] = useState(true);
  const [pushEnabled, setPushEnabled] = useState(true);

  const setName = useCallback((next: string) => {
    const trimmed = next.trim();
    if (trimmed) setNameState(trimmed);
  }, []);

  const setBody = useCallback((patch: Partial<BodyInfo>) => {
    setBodyState((prev) => ({ ...prev, ...patch }));
  }, []);

  const value = useMemo(
    () => ({ name, body, healthConnected, pushEnabled, setName, setBody, setHealthConnected, setPushEnabled }),
    [name, body, healthConnected, pushEnabled, setName, setBody],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfile must be used within a ProfileProvider');
  return ctx;
}
