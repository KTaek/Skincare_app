import React, { useState } from 'react';
import { useMonitoring } from '../context/MonitoringContext';
import { BodyModelId } from '../three/humanModel';
import { MonitorTarget } from '../monitoring/types';
import { ExamCapture, ExamKind } from '../exam/examTypes';
import PartSelectScreen from './PartSelectScreen';
import ItchSurveyScreen from './ItchSurveyScreen';
import CaptureSourceScreen, { CaptureSource } from './CaptureSourceScreen';
import MonitorCaptureScreen from './MonitorCaptureScreen';

type Step = 'part' | 'itch' | 'source' | 'capture';

/**
 * "피부 바로 스캔"이 쓰는 임시 자리.
 *
 * 촬영 화면은 어느 자리를 찍는지(기준 사진·가이드) 알아야 해서 대상을 요구하는데, 바로 스캔은
 * 지켜보는 자리가 아니므로 모니터링 저장소에 등록하지 않고 이 객체만 넘긴다 — 기준 사진이 없으니
 * 조명 보정 없이 그냥 찍히고, 기록으로도 남지 않는다.
 */
const QUICK_TARGET: MonitorTarget = {
  id: 'tgt_quick_scan',
  modelId: 'adultMale',
  spotId: 'quick:scan',
  part: 'chest',
  facing: 'front',
  label: '피부 바로 스캔',
  createdAt: new Date(),
  sessionCount: 0,
};

/**
 * 촬영 전 흐름 — 무엇을 기록하느냐에 따라 단계가 달라진다.
 *
 *   신규 증상 기록하기 : 부위 선택(머리·몸통·팔·다리) → 가려움 문진 → 촬영 방법 → 촬영
 *   이어서 기록하기    : 가려움 문진 → 촬영 방법 → 촬영 (부위는 이미 등록된 자리를 그대로 쓴다)
 *   피부 바로 스캔     : 촬영 방법 → 촬영 (문진도 등록도 없다)
 *
 * "촬영 방법"은 카메라로 그 자리에서 찍을지, 갤러리에 있는 사진을 고를지를 미리 정하는 단계다.
 * 예전에는 카메라 화면 안에 앨범 버튼이 같이 있었는데, 가이드를 받으며 찍는 흐름과 이미 찍어 둔
 * 사진을 고르는 흐름은 하는 일이 달라서 들어가기 전에 갈라 놓았다.
 *
 * 진단명은 여기서 묻지 않는다 — 진단명을 안다고 이 앱이 하는 일(계속 지켜보기)이 달라지지
 * 않아서, 알고 있으면 결과 화면에서 고쳐 넣도록 뒤로 미뤘다.
 *
 * 3D 모델은 성인 남성 체형 하나만 쓴다. 후처리까지 끝난 사진과 문진 결과를 상위(촬영 화면)로
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
  /** 이어서 기록하기일 때 이어 찍을 자리 */
  target?: MonitorTarget;
  /** 이어서 기록하기일 때 이어붙일 폴더 */
  folderId?: string;
  onExit: () => void;
  onCaptured: (capture: ExamCapture) => void;
}) {
  const isNew = kind === 'new';
  const isQuick = kind === 'quick';
  const [step, setStep] = useState<Step>(isQuick ? 'source' : isNew ? 'part' : 'itch');
  const modelId: BodyModelId = 'adultMale';
  const [source, setSource] = useState<CaptureSource>('camera');
  const [itchVas, setItchVas] = useState<number | null>(null);
  const [target, setTarget] = useState<MonitorTarget | null>(presetTarget ?? (isQuick ? QUICK_TARGET : null));
  const { createTarget, findTarget } = useMonitoring();

  // 신규 증상 기록에서만 거치는 앞 단계 — 부위 선택 한 번
  if (isNew && (step === 'part' || !target)) {
    return (
      <PartSelectScreen
        onBack={onExit}
        onNext={(spot) => {
          /*
            자리는 여기서 확정한다. 진단명은 결과 화면에서 붙인다.

            같은 자리를 전에 등록했더라도 **새 대상을 만든다.** 사용자가 "신규 증상 기록하기"를
            고른 것 자체가 새로 시작하겠다는 뜻이고, 이어 붙이려면 "이어서 기록하기"가 따로
            있다(MonitoringContext의 createTarget 주석에 그 사이에서 무엇이 잘못됐었는지 적어 뒀다).
          */
          setTarget(createTarget(modelId, spot));
          setStep('itch');
        }}
      />
    );
  }

  if (step === 'itch') {
    return (
      <ItchSurveyScreen
        stepLabel={isNew ? '2 / 3' : '1 / 2'}
        onBack={() => (isNew ? setStep('part') : onExit())}
        onDone={(vas) => {
          setItchVas(vas);
          setStep('source');
        }}
      />
    );
  }

  if (step === 'source') {
    return (
      <CaptureSourceScreen
        stepLabel={isQuick ? undefined : isNew ? '3 / 3' : '2 / 2'}
        onBack={() => (isQuick ? onExit() : setStep('itch'))}
        onPick={(picked) => {
          setSource(picked);
          setStep('capture');
        }}
      />
    );
  }

  // 여기까지 왔으면 자리는 반드시 정해져 있다 (신규는 위 부위 선택에서, 이어서는 부모가, 바로
  // 스캔은 임시 자리를 쓴다)
  if (!target) return null;

  // createTarget이 만든 대상은 컨텍스트에서 최신 상태(baseline 포함)를 다시 읽어온다
  const current = findTarget(target.id) ?? target;

  return (
    <MonitorCaptureScreen
      target={current}
      /*
        바로 스캔에서는 넓이를 재지 않는다. 기록으로 남지 않는 촬영이라 견줄 회차가 영영 없고,
        임시 대상의 부위를 그대로 믿으면 엉뚱한 자리에서 자를 찾으려 든다.
      */
      measureArea={!isQuick}
      source={source}
      onCancel={() => setStep('source')}
      onComplete={(processedUri, session) =>
        onCaptured({ kind, target: current, session, photoUri: processedUri, itchVas, folderId })
      }
    />
  );
}
