import raw from '../../assets/models/labels.json';

export type SignKey = 'erythema' | 'papulation' | 'excoriation' | 'lichenification';
export type SignOrIga = SignKey | 'iga';

export const SIGN_KEYS: SignKey[] = ['erythema', 'papulation', 'excoriation', 'lichenification'];

export const labels = raw as {
  sign_names: string[];
  grade_names_by_sign: Record<SignOrIga, string[]>;
  dex_thresholds_by_sign: Record<SignOrIga, number[]>;
  img_size_seg: number;
  img_size_cls: number;
  mask_threshold: number;
  crop_margin: number;
  min_crop_ratio: number;
  imagenet_mean: number[];
  imagenet_std: number[];
};

export const SIGN_NAMES_KO: Record<SignOrIga, string> = {
  erythema: '홍반',
  papulation: '구진',
  excoriation: '긁힌 자국',
  lichenification: '태선화',
  iga: '종합 중증도',
};

export const GRADE_NAMES_KO: Record<string, string> = {
  None: '없음',
  Clear: '클리어',
  'Almost Clear': '관해 임박',
  Mild: '경증',
  Moderate: '중등도',
  Severe: '중증',
};

/** IGA 5단계를 앱 전역에서 쓰는 3단계 중증도(1=경증, 2=중등증, 3=중증)로 축약 — 서버 severity_model과 동일 매핑 */
export const IGA_GRADE_TO_SEVERITY: Record<number, number> = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 3 };
