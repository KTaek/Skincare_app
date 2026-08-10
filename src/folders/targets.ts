import { MonitorTarget } from '../monitoring/types';

/**
 * 모니터링 폴더 이름 규칙 — "{부위} {질환}" (예: "왼쪽 상완 앞 아토피피부염").
 *
 * 부위는 부위 선택에서 고른 지점의 이름(BodySpot.label), 질환은 사전 문진 결과
 * (MonitorDiagnosis.disease)를 그대로 쓴다. 사용자가 폴더 이름을 직접 짓는 곳은 없다 —
 * 등록 흐름을 끝내면 이 규칙으로 자동으로 붙는다.
 */
export function folderNameOf(siteLabel: string, disease?: string): string {
  return [siteLabel, disease].filter(Boolean).join(' ').trim();
}

/**
 * 데모용 모니터링 폴더 2개가 참조하는 대상.
 *
 * 폴더의 시계열은 dump 데이터지만, "오늘의 피부 상태 기록"은 실제 가이드 촬영
 * (MonitorCaptureScreen)을 띄운다 — 그 화면이 MonitorTarget을 요구하므로 데모 폴더에도
 * 짝이 되는 대상이 있어야 한다. baseline은 비워 둔다: 데모 폴더에서 처음 찍는 사진이
 * 그 폴더의 기준 사진이 되는 게 맞다.
 */
export const DEMO_TARGETS: MonitorTarget[] = [
  {
    id: 'tgt_demo_arm',
    modelId: 'adultMale',
    spotId: 'coarse:arm',
    part: 'rightUpperArm',
    facing: 'front',
    label: '팔',
    diagnosis: { diagnosed: true, disease: '건선', source: 'self' },
    createdAt: new Date(),
    sessionCount: 0,
  },
  {
    id: 'tgt_demo_face',
    modelId: 'adultMale',
    spotId: 'coarse:head',
    part: 'head',
    facing: 'front',
    label: '머리',
    diagnosis: { diagnosed: true, disease: '주사', source: 'self' },
    createdAt: new Date(),
    sessionCount: 0,
  },
];
