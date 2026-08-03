/** 번들에 포함된 tflite 모델 파일 크기 (바이트). assets/models/*.tflite 실제 파일 크기를 그대로 적어둠 */
const SEG_MODEL_BYTES = 44150140;
const CLS_MODEL_BYTES = 8696092;

export const TOTAL_MODEL_SIZE_MB = (SEG_MODEL_BYTES + CLS_MODEL_BYTES) / (1024 * 1024);
