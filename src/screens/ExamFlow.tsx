import React, { useState } from 'react';
import { useMonitoring } from '../context/MonitoringContext';
import { getFolder } from '../folders/store';
import { BodyModelId } from '../three/humanModel';
import { MonitorTarget } from '../monitoring/types';
import { ExamCapture, ExamKind } from '../exam/examTypes';
import { todayKey } from '../folders/store';
import { getDayItch } from '../records/itchStore';
import PartSelectScreen from './PartSelectScreen';
import CaptureSourceScreen, { CaptureSource } from './CaptureSourceScreen';
import MonitorCaptureScreen from './MonitorCaptureScreen';

type Step = 'part' | 'source' | 'capture';

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
 *   신규 증상 기록하기 : 부위 선택(머리·몸통·팔·다리) → 촬영 방법 → 촬영
 *   이어서 기록하기    : 촬영 방법 → 촬영 (부위는 이미 등록된 자리를 그대로 쓴다)
 *   피부 바로 스캔     : 촬영 방법 → 촬영 (등록도 기록도 없다)
 *
 * "촬영 방법"은 카메라로 그 자리에서 찍을지, 갤러리에 있는 사진을 고를지를 미리 정하는 단계다.
 * 예전에는 카메라 화면 안에 앨범 버튼이 같이 있었는데, 가이드를 받으며 찍는 흐름과 이미 찍어 둔
 * 사진을 고르는 흐름은 하는 일이 달라서 들어가기 전에 갈라 놓았다.
 *
 * **가려움 문진은 여기 없다.** 촬영 방법 앞에 한 단계로 있었는데, 가려움은 사진 한 장의 속성이
 * 아니라 하루의 상태라서 기록 탭으로 옮겼다(records/itchStore에 옮긴 이유 전부). 여기서는 그날
 * 적어 둔 값을 읽어 촬영에 붙이기만 하고, 아직 안 적었으면 null인 채로 둔다 — 나중에 적으면
 * 그날 기록에 소급 적용된다.
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
  const [step, setStep] = useState<Step>(isNew ? 'part' : 'source');
  const modelId: BodyModelId = 'adultMale';
  const [source, setSource] = useState<CaptureSource>('camera');
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
          setStep('source');
        }}
      />
    );
  }

  if (step === 'source') {
    return (
      <CaptureSourceScreen
        // 단계가 하나뿐인 흐름(이어서 기록·바로 스캔)에는 "1 / 1"을 붙이지 않는다 — 셀 것이 없다
        stepLabel={isNew ? '2 / 2' : undefined}
        onBack={() => (isNew ? setStep('part') : onExit())}
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

  /*
    이어서 기록할 때만 프리뷰에 겹칠 지난 사진을 넘긴다 — **그 폴더의 첫 기록 사진**이다.

    첫 사진이어야 하는 이유: 매번 직전 사진을 목표로 삼으면 회차마다 허용 오차만큼 밀린 구도가
    다음 목표가 되어 서서히 흘러간다(drift). 하나로 고정해야 모든 회차가 같은 자리로 수렴한다.

    신규 기록에는 깔지 않는다 — 맞출 지난 사진이 아직 없고, 그 촬영이 곧 기준이 된다.
    폴더 기록에 사진이 없으면(옛 기록 등) 대상의 기준 세션 사진으로 물러선다.
  */
  const ghostUri =
    kind === 'followUp'
      ? (folderId ? getFolder(folderId)?.records[0]?.photo?.uri : undefined) ??
        current.baseline?.processedUri
      : undefined;

  return (
    <MonitorCaptureScreen
      target={current}
      /*
        바로 스캔에서는 넓이를 재지 않는다. 기록으로 남지 않는 촬영이라 견줄 회차가 영영 없고,
        임시 대상의 부위를 그대로 믿으면 엉뚱한 자리에서 자를 찾으려 든다.
      */
      measureArea={!isQuick}
      ghostUri={ghostUri}
      source={source}
      onCancel={() => setStep('source')}
      onComplete={(processedUri, session) =>
        /*
          가려움은 이 촬영이 재는 값이 아니라 **그날 적어 둔 값**이라, 찍는 순간의 값을 그대로
          붙인다. 아직 안 적었으면 null이고, 나중에 기록 탭에서 적으면 그날 기록 전체에 소급
          적용된다(folders/store의 applyDayItch) — 그래서 여기서 못 읽어도 잃는 것이 없다.
        */
        onCaptured({
          kind,
          target: current,
          session,
          photoUri: processedUri,
          itchVas: getDayItch(todayKey()),
          folderId,
        })
      }
    />
  );
}
