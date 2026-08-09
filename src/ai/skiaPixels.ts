import { Skia, ColorType, AlphaType, type SkImage, type SkRect } from '@shopify/react-native-skia';

/**
 * uri의 이미지를 열어 fn에 넘기고, 끝나면 반드시 해제한다.
 *
 * ⚠️ 반드시 이 함수를 쓸 것. Skia 객체(Data·Image·Surface)는 네이티브 메모리를 잡고 있어서
 * dispose()를 부르지 않으면 GC가 회수하지 못한다. 촬영 화면은 1초에 한 번씩 이 경로를 도는데,
 * 한 번이라도 흘리면 얼마 못 가 Surface.MakeOffscreen이 null을 돌려주기 시작하고 —
 * 그 시점부터 품질 판정이 통째로 죽는다.
 *
 * Data와 Image의 수명을 한 곳에 묶어 두려고 콜백 형태로 만들었다. 둘을 따로 돌려주면
 * 호출부마다 해제 순서를 지켜야 하는데, 그건 언젠가 반드시 빠뜨린다.
 */
export async function withSkImage<T>(uri: string, fn: (image: SkImage) => T | Promise<T>): Promise<T> {
  const data = await Skia.Data.fromURI(uri);
  const image = Skia.Image.MakeImageFromEncoded(data);
  if (!image) {
    data.dispose();
    throw new Error('이미지를 디코딩하지 못했어요');
  }
  try {
    return await fn(image);
  } finally {
    image.dispose();
    data.dispose();
  }
}

/**
 * src 영역을 outW x outH로 그려 RGBA 8888 픽셀을 읽어온다.
 * (정규화 없이 통계·품질 판정용으로 픽셀이 필요할 때 사용)
 */
export function readResizedRGBA(image: SkImage, src: SkRect, outW: number, outH: number): Uint8Array {
  return withOffscreen(image, src, outW, outH, (pixels) =>
    // 스냅샷을 해제하기 전에 JS가 소유한 사본으로 옮긴다 —
    // 반환값이 함수 밖으로 나가므로 네이티브 버퍼를 그대로 넘기면 해제 이후를 보증할 수 없다
    pixels.slice(),
  );
}

/** src 영역을 outSize x outSize로 리사이즈해 픽셀을 읽고, 0~1 스케일 후 imagenet mean/std로 정규화한
 * NHWC(RGB) Float32Array를 반환한다. 종횡비를 유지하지 않는 단순 리사이즈로,
 * 파이썬 학습 파이프라인(cv2.resize)과 동일하게 동작한다.
 *
 * colorGain을 주면 0~1 스케일 직후, imagenet 정규화 직전에 채널별로 곱한다 — 세션 간 조명 차이를
 * 여기서 흡수한다. 이미지를 다시 그리거나 파일로 쓰지 않고 텐서에만 적용하는 방식이라
 * 실패할 지점이 없고, 사용자가 보는 사진은 찍은 그대로 남는다. */
export function extractNormalizedRGB(
  image: SkImage,
  src: SkRect,
  outSize: number,
  mean: readonly number[],
  std: readonly number[],
  colorGain?: readonly number[],
): Float32Array {
  const gR = colorGain?.[0] ?? 1;
  const gG = colorGain?.[1] ?? 1;
  const gB = colorGain?.[2] ?? 1;

  return withOffscreen(image, src, outSize, outSize, (pixels) => {
    const out = new Float32Array(outSize * outSize * 3);
    let o = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      // 게인은 0~1 스케일에서 곱하고 1로 잘라낸다 — 보정이 범위를 넘어서면 학습 때 본 적 없는
      // 값이 되므로, 넘치는 만큼은 포기하는 편이 낫다
      out[o++] = (Math.min(1, (pixels[i] / 255) * gR) - mean[0]) / std[0];
      out[o++] = (Math.min(1, (pixels[i + 1] / 255) * gG) - mean[1]) / std[1];
      out[o++] = (Math.min(1, (pixels[i + 2] / 255) * gB) - mean[2]) / std[2];
    }
    return out;
  });
}

/**
 * 오프스크린 서피스에 src를 그려 픽셀을 읽고 consume에 넘긴다.
 * 서피스와 스냅샷은 성공하든 실패하든 반드시 해제된다 (위 withSkImage 주석 참고).
 */
function withOffscreen<T>(
  image: SkImage,
  src: SkRect,
  outW: number,
  outH: number,
  consume: (pixels: Uint8Array) => T,
): T {
  const surface = Skia.Surface.MakeOffscreen(outW, outH);
  if (!surface) throw new Error('오프스크린 서피스를 만들지 못했어요 (Skia 네이티브 메모리 부족일 수 있어요)');

  let snapshot: SkImage | null = null;
  try {
    const canvas = surface.getCanvas();
    canvas.drawImageRect(image, src, { x: 0, y: 0, width: outW, height: outH }, Skia.Paint());
    surface.flush();

    snapshot = surface.makeImageSnapshot();
    const pixels = snapshot.readPixels(0, 0, {
      width: outW,
      height: outH,
      colorType: ColorType.RGBA_8888,
      alphaType: AlphaType.Unpremul,
    }) as Uint8Array | null;
    if (!pixels) throw new Error('픽셀을 읽지 못했어요');

    return consume(pixels);
  } finally {
    snapshot?.dispose();
    surface.dispose();
  }
}
