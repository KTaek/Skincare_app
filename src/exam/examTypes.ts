import { LocalAnalysisResult } from '../ai/analyzeLocal';
import { DiseasePrediction } from '../ai/diseaseModel';
import { MonitorSession, MonitorTarget } from '../monitoring/types';

/**
 * 카메라 탭에서 시작할 수 있는 두 가지 검사.
 *   new      — 신규 검사: 부위 선택 → 질환 등록 → 가려움 문진 → 카메라 → 결과
 *   followUp — 경과 이어서 기록: 가려움 문진 → 카메라 → 결과 (이미 등록된 자리를 다시 찍는다)
 */
export type ExamKind = 'new' | 'followUp';

/** 촬영·후처리까지 끝난 검사 한 건 — 결과 화면이 필요로 하는 입력 전부 */
export interface ExamCapture {
  kind: ExamKind;
  target: MonitorTarget;
  session: MonitorSession;
  /** 후처리까지 끝난 사진 */
  photoUri: string;
  /** 가려움 문진 결과(0~10). 사용자가 "넘어가기"를 고르면 null → 결과에 "등록 안함"으로 표시된다 */
  itchVas: number | null;
  /** 경과 이어서 기록일 때, 이어붙일 모니터링 폴더 */
  folderId?: string;
}

/** 결과 화면이 보여주는 온디바이스 분석 묶음 */
export interface ExamAnalysis {
  /** 분할 → 크롭 → 중증도(홍반/구진/찰상/태선화 + IGA) */
  local: LocalAnalysisResult;
  /**
   * 질환 분류 Top3. 의사 진단이 있거나 경과 이어서 기록인 경우에는 아예 돌리지 않으므로 null이다
   * (슬라이드 지시 1: "의사 진단 있을 경우, 이어서 기록하는 경우 질환분류 모델 X").
   */
  diseases: DiseasePrediction[] | null;
}
