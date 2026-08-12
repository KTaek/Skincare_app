import { LocalAnalysisResult } from '../ai/analyzeLocal';
import { DiseasePrediction } from '../ai/diseaseModel';
import { MonitorSession, MonitorTarget } from '../monitoring/types';

/**
 * 피부 촬영 탭에서 시작할 수 있는 세 가지 흐름.
 *   new      — 신규 증상 기록하기: 부위 선택 → 촬영 → 결과
 *   followUp — 이어서 기록하기: 촬영 → 결과 (이미 등록된 자리를 다시 찍는다)
 *   quick    — 피부 바로 스캔: 촬영 → 결과 (등록도 없고, 기록으로 남기지 않는다)
 */
export type ExamKind = 'new' | 'followUp' | 'quick';

/** 촬영·후처리까지 끝난 기록 한 건 — 결과 화면이 필요로 하는 입력 전부 */
export interface ExamCapture {
  kind: ExamKind;
  target: MonitorTarget;
  session: MonitorSession;
  /** 후처리까지 끝난 사진 */
  photoUri: string;
  /**
   * 그날 기록해 둔 가려움(VAS 0~10). 촬영이 재는 값이 아니라 기록 탭에서 하루에 한 번 받는
   * 값을 찍는 순간 읽어 온 것이라(records/itchStore), 아직 적지 않은 날에는 null이다.
   *
   * null이어도 잃는 것은 없다 — 나중에 적으면 그날 기록 전체에 소급 적용된다(applyDayItch).
   * 여기 담긴 값은 "이 촬영을 기록으로 만들 때 함께 넣을 값"일 뿐이다.
   */
  itchVas: number | null;
  /** 이어서 기록하기일 때, 이어붙일 경과 관찰 폴더 */
  folderId?: string;
}

/** 결과 화면이 보여주는 온디바이스 분석 묶음 */
export interface ExamAnalysis {
  /** 분할 → 크롭 → 중증도(증상 4가지 + IGA) */
  local: LocalAnalysisResult;
  /**
   * 질환 분류 Top3. 의사 진단이 있거나 경과 이어서 기록인 경우에는 아예 돌리지 않으므로 null이다
   * (슬라이드 지시 1: "의사 진단 있을 경우, 이어서 기록하는 경우 질환분류 모델 X").
   */
  diseases: DiseasePrediction[] | null;
  /**
   * local(피부 종합 상태·4가지 증상)이 믿을 수 있는 값인지 — 이 촬영의 진단명이 "아토피피부염"
   * (또는 "정상")일 때만 true다. Stage2 모델이 아토피 채점 기준으로 학습돼 있어서, 다른 질환에는
   * 적용할 근거가 없다. false면 local은 자리만 채운 값이니 결과·모니터링 화면 모두 그 두 카드를
   * 숨기고 가려움·수면 점수만 보여줘야 한다.
   */
  severitySupported: boolean;
}
