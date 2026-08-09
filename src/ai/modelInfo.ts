/**
 * 번들에 포함된 tflite 모델 파일 크기 (바이트).
 * assets/models/*.tflite 실제 파일 크기를 그대로 적어둔다 — 셋 다 입출력 float32라 용량이 크다.
 */
const SEG_MODEL_BYTES = 24609688; // seg_lesion_512.tflite
const SEV_MODEL_BYTES = 13820904; // sev_cls_384.tflite
const DISEASE_MODEL_BYTES = 18638852; // disease_cls_512.tflite

export const TOTAL_MODEL_SIZE_MB =
  (SEG_MODEL_BYTES + SEV_MODEL_BYTES + DISEASE_MODEL_BYTES) / (1024 * 1024);
