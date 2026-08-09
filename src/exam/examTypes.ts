import { LocalAnalysisResult } from '../ai/analyzeLocal';
import { DiseasePrediction } from '../ai/diseaseModel';
import { MonitorSession, MonitorTarget } from '../monitoring/types';

/**
 * 피부 촬영 탭에서 시작할 수 있는 세 가지 흐름.
 *   new      — 신규 증상 기록하기: 부위 선택 → 가려움 문진 → 촬영 → 결과
 *   followUp — 이어서 기록하기: 가려움 문진 → 촬영 → 결과 (이미 등록된 자리를 다시 찍는다)
 *   quick    — 피부 바로 스캔: 촬영 → 결과 (문진도 등록도 없고, 기록으로 남기지 않는다)
 */
export type ExamKind = 'new' | 'followUp' | 'quick';

/** 촬영·후처리까지 끝난 기록 한 건 — 결과 화면이 필요로 하는 입력 전부 */
export interface ExamCapture {
  kind: ExamKind;
  target: MonitorTarget;
  session: MonitorSession;
  /** 후처리까지 끝난 사진 */
  photoUri: string;
  /** 가려움 문진 결과(0~10). 문진을 거치지 않는 바로 스캔에서만 null이다 */
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
}
