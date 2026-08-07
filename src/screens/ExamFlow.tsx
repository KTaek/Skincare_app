import React, { useState } from 'react';
import { useMonitoring } from '../context/MonitoringContext';
import { BodyModelId } from '../three/humanModel';
import { PartGroupId } from '../monitoring/bodyParts';
import { MonitorTarget } from '../monitoring/types';
import { ExamCapture, ExamKind } from '../exam/examTypes';
import MonitorIntakeScreen from './MonitorIntakeScreen';
import PartSelectScreen from './PartSelectScreen';
import SpotSelectScreen from './SpotSelectScreen';
import ItchSurveyScreen from './ItchSurveyScreen';
import MonitorCaptureScreen from './MonitorCaptureScreen';

type Step = 'group' | 'spot' | 'intake' | 'itch' | 'capture';

/**
 * 카메라 탭의 촬영 전 흐름 — 검사 종류에 따라 단계가 달라진다.
 *
 *   신규 검사        : 부위 선택(3D) → 촬영할 면 선택 → 질환 등록 → 가려움 문진 → 가이드 촬영
 *   경과 이어서 기록 : 가려움 문진 → 가이드 촬영 (부위·질환은 이미 등록된 자리를 그대로 쓴다)
 *
 * 3D 모델은 성인 남성 체형 하나만 쓴다. 후처리까지 끝난 사진과 문진 결과를 상위(카메라 화면)로
 * 넘겨 분석·결과 화면에 태운다.
 */
export default function ExamFlow({
  kind,
  target: presetTarget,
  folderId,
  onExit,
  onCaptured,
}: {
  kind: ExamKind;
  /** 경과 이어서 기록일 때 이어 찍을 자리 */
  target?: MonitorTarget;
  /** 경과 이어서 기록일 때 이어붙일 폴더 */
  folderId?: string;
  onExit: () => void;
  onCaptured: (capture: ExamCapture) => void;
}) {
  const isNew = kind === 'new';
  const [step, setStep] = useState<Step>(isNew ? 'group' : 'itch');
  const modelId: BodyModelId = 'adultMale';
  const [group, setGroup] = useState<PartGroupId | null>(null);
  const [initialSpotId, setInitialSpotId] = useState<string | undefined>();
  const [itchVas, setItchVas] = useState<number | null>(null);
  const [target, setTarget] = useState<MonitorTarget | null>(presetTarget ?? null);
  const { ensureTarget, findTarget, setDiagnosis } = useMonitoring();

  // 신규 검사에서만 거치는 앞 단계 3개 (부위 → 면 → 질환)
  if (isNew) {
    if (step === 'group' || !group) {
      return (
        <PartSelectScreen
          modelId={modelId}
          stepLabel="1 / 4"
          onBack={onExit}
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
          stepLabel="2 / 4"
          onBack={() => setStep('group')}
          onNext={(spot) => {
            // 자리는 여기서 확정한다. 질환은 다음 단계(질환 등록)에서 붙인다.
            setTarget(ensureTarget(modelId, spot));
            setStep('intake');
          }}
        />
      );
    }

    if (step === 'intake') {
      return (
        <MonitorIntakeScreen
          stepLabel="3 / 4 · 사전 문진"
          onBack={() => setStep('spot')}
          onDone={(result) => {
            setDiagnosis(target.id, result);
            setStep('itch');
          }}
        />
      );
    }
  }

  if (step === 'itch') {
    return (
      <ItchSurveyScreen
        stepLabel={isNew ? '4 / 4 · 가려움 문진' : '1 / 1 · 가려움 문진'}
        onBack={() => (isNew ? setStep('intake') : onExit())}
        onDone={(vas) => {
          setItchVas(vas);
          setStep('capture');
        }}
      />
    );
  }

  // 여기까지 왔으면 자리는 반드시 정해져 있다 (신규는 위 spot 단계에서, 경과는 부모가 넘겨준다)
  if (!target) return null;

  // ensureTarget이 만든 대상은 컨텍스트에서 최신 상태(baseline·질환 포함)를 다시 읽어온다
  const current = findTarget(target.id) ?? target;

  return (
    <MonitorCaptureScreen
      target={current}
      onCancel={() => setStep('itch')}
      onComplete={(processedUri, session) =>
        onCaptured({ kind, target: current, session, photoUri: processedUri, itchVas, folderId })
      }
    />
  );
}
