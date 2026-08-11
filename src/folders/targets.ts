/**
 * 모니터링 폴더 이름 규칙 — "{부위} {질환}" (예: "왼쪽 상완 앞 아토피피부염").
 *
 * 부위는 3D 부위 선택에서 고른 지점의 이름(BodySpot.label), 질환은 사전 문진 결과
 * (MonitorDiagnosis.disease)를 그대로 쓴다. 사용자가 폴더 이름을 직접 짓는 곳은 없다 —
 * 등록 흐름을 끝내면 이 규칙으로 자동으로 붙는다.
 */
export function folderNameOf(siteLabel: string, disease?: string): string {
  return [siteLabel, disease].filter(Boolean).join(' ').trim();
}
