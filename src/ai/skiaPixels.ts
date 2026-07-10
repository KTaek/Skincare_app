import { Skia, ColorType, AlphaType, type SkImage, type SkRect } from '@shopify/react-native-skia';

export async function loadSkImage(uri: string): Promise<SkImage> {
  const data = await Skia.Data.fromURI(uri);
  const image = Skia.Image.MakeImageFromEncoded(data);
  if (!image) throw new Error('이미지를 디코딩하지 못했어요');
  return image;
}

/** src 영역을 outSize x outSize로 리사이즈해 픽셀을 읽고, 0~1 스케일 후 imagenet mean/std로 정규화한
 * NHWC(RGB) Float32Array를 반환한다. 종횡비를 유지하지 않는 단순 리사이즈로,
 * 파이썬 학습 파이프라인(cv2.resize)과 동일하게 동작한다. */
export function extractNormalizedRGB(
  image: SkImage,
  src: SkRect,
  outSize: number,
  mean: readonly number[],
  std: readonly number[],
): Float32Array {
  const surface = Skia.Surface.MakeOffscreen(outSize, outSize);
  if (!surface) throw new Error('오프스크린 서피스를 만들지 못했어요');

  const canvas = surface.getCanvas();
  const dest: SkRect = { x: 0, y: 0, width: outSize, height: outSize };
  canvas.drawImageRect(image, src, dest, Skia.Paint());
  surface.flush();

  const snapshot = surface.makeImageSnapshot();
  const pixels = snapshot.readPixels(0, 0, {
    width: outSize,
    height: outSize,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  }) as Uint8Array | null;
  if (!pixels) throw new Error('픽셀을 읽지 못했어요');

  const out = new Float32Array(outSize * outSize * 3);
  let o = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    out[o++] = (pixels[i] / 255 - mean[0]) / std[0];
    out[o++] = (pixels[i + 1] / 255 - mean[1]) / std[1];
    out[o++] = (pixels[i + 2] / 255 - mean[2]) / std[2];
  }
  return out;
}
