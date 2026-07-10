/** tflite 모델의 입출력 텐서가 float16이라 JS의 표준 Float32Array와 주고받기 위한 수동 변환.
 * (Hermes/RN에는 표준 Float16Array가 없어 비트 연산으로 직접 인코딩/디코딩한다) */

const f32 = new Float32Array(1);
const i32 = new Int32Array(f32.buffer);

function float32ToFloat16Bits(value: number): number {
  f32[0] = value;
  const x = i32[0];

  const sign = (x >>> 16) & 0x8000;
  const exponent = ((x >>> 23) & 0xff) - 127 + 15;
  const mantissa = x & 0x7fffff;

  if (exponent <= 0) {
    if (exponent < -10) return sign;
    const withImplicitBit = mantissa | 0x800000;
    const shift = 14 - exponent;
    let half = withImplicitBit >>> shift;
    if ((withImplicitBit >>> (shift - 1)) & 1) half += 1;
    return sign | half;
  }
  if (exponent >= 0x1f) {
    return sign | 0x7c00;
  }
  let half = sign | (exponent << 10) | (mantissa >>> 13);
  if (mantissa & 0x1000) half += 1;
  return half;
}

function float16BitsToFloat32(half: number): number {
  const sign = (half & 0x8000) >>> 15;
  const exponent = (half & 0x7c00) >>> 10;
  const mantissa = half & 0x03ff;

  let value: number;
  if (exponent === 0) {
    value = (mantissa / 1024) * Math.pow(2, -14);
  } else if (exponent === 0x1f) {
    value = mantissa === 0 ? Infinity : NaN;
  } else {
    value = (1 + mantissa / 1024) * Math.pow(2, exponent - 15);
  }
  return sign ? -value : value;
}

export function float32ArrayToFloat16Buffer(input: Float32Array): ArrayBuffer {
  const out = new Uint16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    out[i] = float32ToFloat16Bits(input[i]);
  }
  return out.buffer;
}

export function float16BufferToFloat32Array(buffer: ArrayBuffer): Float32Array {
  const view = new Uint16Array(buffer);
  const out = new Float32Array(view.length);
  for (let i = 0; i < view.length; i++) {
    out[i] = float16BitsToFloat32(view[i]);
  }
  return out;
}
