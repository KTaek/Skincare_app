import React, { useState } from 'react';
import { useMonitoring } from '../context/MonitoringContext';
import { BodyModelId } from '../three/humanModel';
import { PartGroupId } from '../monitoring/bodyParts';
import { MonitorSession, MonitorTarget } from '../monitoring/types';
import MonitorIntakeScreen, { IntakeResult } from './MonitorIntakeScreen';
import PartSelectScreen from './PartSelectScreen';
import SpotSelectScreen from './SpotSelectScreen';
import MonitorCaptureScreen from './MonitorCaptureScreen';

type Step = 'intake' | 'group' | 'spot' | 'capture';

/**
 * 모니터링 촬영 전체 흐름 — ⓪ 문진 → ① 부위 선택 → ② 촬영할 면 선택 → ③ 가이드 촬영/후처리.
 * 3D 모델은 성인 남성 체형 하나만 쓴다.
 * 후처리까지 끝난 사진을 상위(카메라 화면)로 넘겨 기존 분석·기록 파이프라인에 그대로 태운다.
 */
export default function MonitoringFlow({
  onExit,
  onCaptured,
}: {
  onExit: () => void;
  onCaptured: (processedUri: string, target: MonitorTarget, session: MonitorSession) => void;
}) {
  const [step, setStep] = useState<Step>('intake');
  const modelId: BodyModelId = 'adultMale';
  const [intake, setIntake] = useState<IntakeResult | null>(null);
  const [group, setGroup] = useState<PartGroupId | null>(null);
  const [initialSpotId, setInitialSpotId] = useState<string | undefined>();
  const [target, setTarget] = useState<MonitorTarget | null>(null);
  const { ensureTarget, findTarget } = useMonitoring();

  if (step === 'intake') {
    return (
      <MonitorIntakeScreen
        onBack={onExit}
        onDone={(result) => {
          setIntake(result);
          setStep('group');
        }}
      />
    );
  }

  if (step === 'group' || !group) {
    return (
      <PartSelectScreen
        modelId={modelId}
        onBack={() => setStep('intake')}
        onNext={(g, spotId) => {
          setGroup(g);
          setInitialSpotId(spotId);
          setStep('spot');
        }}
      />
    );
  }

  if (step === 'spot' || !target) {
    return (
      <SpotSelectScreen
        modelId={modelId}
        group={group}
        initialSpotId={initialSpotId}
        onBack={() => setStep('group')}
        onNext={(spot) => {
          setTarget(ensureTarget(modelId, spot, intake ?? undefined));
          setStep('capture');
        }}
      />
    );
  }

  // ensureTarget이 만든 대상은 컨텍스트에서 최신 상태(baseline 포함)를 다시 읽어온다
  const current = findTarget(target.id) ?? target;

  return (
    <MonitorCaptureScreen
      target={current}
      onCancel={() => setStep('spot')}
      onComplete={(processedUri, session) => onCaptured(processedUri, current, session)}
    />
  );
}
