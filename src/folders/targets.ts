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
 * 데모용 모니터링 폴더가 참조하는 대상 — 정의는 다섯이고, 그중 화면에 올리는 것은
 * 아래 VISIBLE_DEMO_TARGET_IDS에 든 둘뿐이다.
 *
 * 폴더의 시계열은 dump 데이터지만, "오늘의 피부 상태 기록"은 실제 가이드 촬영
 * (MonitorCaptureScreen)을 띄운다 — 그 화면이 MonitorTarget을 요구하므로 데모 폴더에도
 * 짝이 되는 대상이 있어야 한다. baseline은 비워 둔다: 데모 폴더에서 처음 찍는 사진이
 * 그 폴더의 기준 사진이 되는 게 맞다.
 *
 * 팔·머리(주사)는 아토피가 아닌 질환이라 "피부 종합 상태"·"4가지 증상" 카드도, 전신 결과 지도의
 * 동그라미도 안 뜬다 — 그 예시가 다리 하나뿐이면 지도에 점이 하나만 찍혀 심심해서, 얼굴에 아토피
 * 대상을 하나 더 둔다(다리와 다른 부위라 지도에서 두 곳이 같이 보인다).
 */
export const DEMO_TARGETS: MonitorTarget[] = [
  {
    id: 'tgt_demo_arm',
    modelId: 'adultMale',
    // 실제 "신규 증상 기록하기"의 부위 선택이 만드는 id("coarse:arm")와 겹치면, 사용자가 팔을
    // 고를 때마다 이 데모 대상을 재사용해 버려서 질환 분류 모델이 한 번도 돌지 않고 곧장 이
    // 데모의 자가 진단명("건선")으로 고정돼 버린다 — 그래서 데모 전용 id를 따로 쓴다.
    spotId: 'demo:arm',
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
    spotId: 'demo:head',
    part: 'head',
    facing: 'front',
    label: '머리',
    diagnosis: { diagnosed: true, disease: '주사', source: 'self' },
    createdAt: new Date(),
    sessionCount: 0,
  },
  {
    id: 'tgt_demo_leg',
    modelId: 'adultMale',
    spotId: 'demo:leg',
    part: 'rightThigh',
    facing: 'front',
    label: '다리',
    diagnosis: { diagnosed: true, disease: '아토피피부염', source: 'self' },
    createdAt: new Date(),
    sessionCount: 0,
  },
  {
    id: 'tgt_demo_cheek',
    modelId: 'adultMale',
    spotId: 'demo:face',
    part: 'head',
    facing: 'front',
    label: '얼굴',
    diagnosis: { diagnosed: true, disease: '아토피피부염', source: 'self' },
    createdAt: new Date(),
    sessionCount: 0,
  },
  /*
    ⚠️ 새 대상은 **반드시 배열 끝에** 붙일 것 — folders/store.js가 DEMO_TARGETS[0..3]을 인덱스로
    참조한다. 가운데에 끼워 넣으면 프리셋 폴더가 조용히 다른 대상을 가리키게 된다.
  */
  {
    /*
      몸통 아토피 — 넓이 측정이 켜진 두 부위(얼굴·몸통) 중 몸통 쪽 예시다. 전신 지도에 네 덩어리
      중 세 곳이 서로 다른 색으로 뜨게 하는 역할도 겸한다(아토피 폴더만 지도에 오르는데, 예전에는
      머리·다리 둘뿐이라 색이 두 가지밖에 안 나왔다).
    */
    id: 'tgt_demo_torso',
    modelId: 'adultMale',
    spotId: 'demo:torso',
    part: 'chest',
    facing: 'back',
    label: '몸통',
    diagnosis: { diagnosed: true, disease: '아토피피부염', source: 'self' },
    createdAt: new Date(),
    sessionCount: 0,
  },
];

/**
 * 지금 앱에 **실제로 띄우는** 데모 자리 — 팔 건선 · 몸통 아토피피부염 둘뿐이다.
 *
 * 나머지 셋(머리 주사 · 다리 아토피 · 얼굴 아토피)은 지우지 않고 위에 그대로 둔다. 각 폴더의
 * 시계열은 화면을 확인하려고 값을 하나하나 골라 만든 것이라(개선/악화/유지, 넓이 자·색 단계
 * 조합) 지웠다가 다시 만들려면 그 판단을 처음부터 다시 해야 한다. **이 목록에 id를 넣었다 뺐다
 * 하는 것만으로** 켜고 끌 수 있게 두는 편이 싸다.
 *
 * 둘만 남겨도 화면들이 비어 보이지 않는지 확인한 것:
 *   · 팔 건선   — 아토피가 아닌 질환(등급 없음·회색) 쪽 예시
 *   · 몸통 아토피 — 등급이 매겨지는 쪽 예시이자, 넓이 자가 '몸통'인 유일한 폴더
 * 즉 "등급 있음/없음" 두 갈래와 얼굴·몸통 두 자 중 몸통이 그대로 남는다.
 *
 * **순서도 뜻이 있다.** 데모 폴더는 마지막 기록이 전부 "오늘"이라 최신 시각이 동률이고, 그때는
 * 먼저 나온 폴더가 홈 화면 "최근 피부 상태"에 뜬다(folders/store의 latestRecordAcrossFolders).
 * 등급이 매겨지는 몸통을 앞에 둬야 그 카드가 점수까지 온전히 보여준다 — 건선이 앞에 오면 같은
 * 자리에 점수 대신 질환명만 적힌다.
 */
export const VISIBLE_DEMO_TARGET_IDS: readonly string[] = ['tgt_demo_torso', 'tgt_demo_arm'];

/** 화면에 올릴 데모 대상만 — 모니터링 목록·이어서 기록하기가 이 목록을 쓴다 */
export const VISIBLE_DEMO_TARGETS: MonitorTarget[] = DEMO_TARGETS.filter((t) =>
  VISIBLE_DEMO_TARGET_IDS.includes(t.id),
);
