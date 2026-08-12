import { Skia, ColorType, AlphaType, type SkImage, type SkRect } from '@shopify/react-native-skia';
import { span, spanAsync } from './profile';

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
  // 파일 읽기 + JPEG 디코딩. 분석 한 번에 두세 번 도는 자리라 따로 잰다
  // (질환 분류·세그가 각자 이미지를 연다 — 계측이 이 중복을 드러낸다).
  const { data, image } = await spanAsync('디코딩(파일읽기+JPEG)', async () => {
    const d = await Skia.Data.fromURI(uri);
    return { data: d, image: Skia.Image.MakeImageFromEncoded(d) };
  });
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

/**
 * 잘라낼 자리를 **기울기까지 포함해** 지정한다.
 *
 * rotation은 원본에서 잰 면내 회전(rad)이고, 잘라낼 때 그만큼 **되돌린다**. 얼굴이 7° 기울어
 * 찍혔으면 7° 반대로 돌려 반듯한 얼굴을 잘라 낸다는 뜻이다.
 *
 * 왜 게이트가 아니라 여기서 처리하는가: 기울기는 촬영 순간에만 고칠 수 있는 것이 아니라
 * **아는 순간 언제든 되돌릴 수 있는 것**이다(자를 찾았다면 각도는 이미 알고 있다). 되돌릴 수
 * 있는 것을 사용자에게 시키면, 고칠 수 없는 것(초점·조명)에 쓸 주의력을 거기에 뺏긴다.
 * 앨범에서 고른 사진처럼 촬영 안내를 받을 기회가 없었던 사진에도 똑같이 적용된다는 것이
 * 게이트에는 없는 이점이다.
 */
export interface CropRect extends SkRect {
  /** 면내 회전 (rad). 0이거나 없으면 예전과 같은 축 정렬 크롭이다 */
  rotation?: number;
}

/** 레터박스 배치 — 원본(의 일부)을 정사각형 안에 종횡비를 지켜 넣었을 때의 배치 정보 */
export interface Letterbox {
  /** 정사각형 한 변 */
  size: number;
  /** 원본 → 정사각형 배율 */
  scale: number;
  /** 정사각형 안에서 그림이 시작하는 좌표 (남는 쪽은 검게 채워진다) */
  padX: number;
  padY: number;
  /** 원본에서 잘라 온 자리 — 좌표를 되돌릴 때 다시 더한다 */
  srcX: number;
  srcY: number;
}

/**
 * 정사각형 정규화 좌표(0~1) → 원본 픽셀 좌표.
 * 레터박스로 넣은 모델의 출력을 원본 위에 되돌려 놓을 때 쓴다.
 */
export function unletterbox(box: Letterbox, nx: number, ny: number): { x: number; y: number } {
  return {
    x: (nx * box.size - box.padX) / box.scale + box.srcX,
    y: (ny * box.size - box.padY) / box.scale + box.srcY,
  };
}

/**
 * 이미지(또는 그 일부)를 size×size 정사각형에 **종횡비를 지켜** 그려 넣고 픽셀을 읽는다.
 *
 * extractNormalizedRGB는 종횡비를 무시하고 눌러 넣는다 — 병변 세그 모델이 학습 때 그렇게 봤기
 * 때문이다. 얼굴 검출은 사정이 다르다: 눌러 넣으면 얼굴이 가로세로로 찌그러져 검출률이 떨어지고,
 * 무엇보다 우리가 재려는 값(안간거리·눈-입 거리의 비율)이 그 찌그러짐만큼 왜곡된다. 그 비율이
 * 곧 자세 게이트의 기준이라, 여기서는 반드시 비율을 지켜야 한다.
 *
 * src를 주면 그 부분만 잘라 넣는다 — 얼굴을 한 번 찾은 뒤 그 자리를 크게 다시 보거나, 몸통
 * 랜드마크에 넣을 사람 자리를 잘라 낼 때 쓴다. 남는 여백은 검게 채운다 (BlazePose 계열 모델이
 * 검은 패딩에 안정적이다).
 *
 * **src는 사진 밖으로 나가도 된다.** 몸통에서는 그게 정상이다 — 전신을 감싸는 원이 화면보다 클
 * 때가 많다. 그때 사진 밖 영역은 검게 남고, 사진 안쪽은 **원래 있어야 할 자리에** 그려진다.
 * 이 자리를 잘못 다루면(잘린 src를 목적지 전체에 늘려 그리면) 좌표가 통째로 어긋나서, 관절
 * 위치를 되돌릴 때 몇십 픽셀씩 밀린다 — 그건 그대로 자의 오차가 된다.
 */
export function readLetterboxRGBA(
  image: SkImage,
  size: number,
  src?: { x: number; y: number; width: number; height: number },
): { pixels: Uint8Array; box: Letterbox } {
  const srcX = src?.x ?? 0;
  const srcY = src?.y ?? 0;
  const w = src?.width ?? image.width();
  const h = src?.height ?? image.height();
  const scale = size / Math.max(w, h);
  const dw = w * scale;
  const dh = h * scale;
  const padX = (size - dw) / 2;
  const padY = (size - dh) / 2;

  const surface = Skia.Surface.MakeOffscreen(size, size);
  if (!surface) throw new Error('오프스크린 서피스를 만들지 못했어요 (Skia 네이티브 메모리 부족일 수 있어요)');

  let snapshot: SkImage | null = null;
  try {
    const canvas = surface.getCanvas();
    canvas.clear(Skia.Color('black'));

    /*
      사진 안에 실제로 있는 부분만 그린다. 목적지도 같은 비율로 잘라서, 사진 밖이었던 자리는
      검은 채로 남는다 — src 전체를 목적지 전체에 대응시키는 관계가 그대로 유지되므로
      unletterbox가 좌표를 정확히 되돌릴 수 있다.
    */
    const vx = Math.max(srcX, 0);
    const vy = Math.max(srcY, 0);
    const vw = Math.min(srcX + w, image.width()) - vx;
    const vh = Math.min(srcY + h, image.height()) - vy;
    if (vw > 0 && vh > 0) {
      canvas.drawImageRect(
        image,
        { x: vx, y: vy, width: vw, height: vh },
        {
          x: padX + (vx - srcX) * scale,
          y: padY + (vy - srcY) * scale,
          width: vw * scale,
          height: vh * scale,
        },
        Skia.Paint(),
      );
    }
    surface.flush();

    snapshot = surface.makeImageSnapshot();
    const pixels = snapshot.readPixels(0, 0, {
      width: size,
      height: size,
      colorType: ColorType.RGBA_8888,
      alphaType: AlphaType.Unpremul,
    }) as Uint8Array | null;
    if (!pixels) throw new Error('픽셀을 읽지 못했어요');

    return { pixels: pixels.slice(), box: { size, scale, padX, padY, srcX, srcY } };
  } finally {
    snapshot?.dispose();
    surface.dispose();
  }
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
  src: CropRect,
  outSize: number,
  mean: readonly number[],
  std: readonly number[],
  colorGain?: readonly number[],
): Float32Array {
  const gR = colorGain?.[0] ?? 1;
  const gG = colorGain?.[1] ?? 1;
  const gB = colorGain?.[2] ?? 1;

  // 전처리는 두 부분이다: Skia가 GPU/CPU로 잘라 리사이즈하는 부분(withOffscreen)과,
  // 그 픽셀을 JS 루프로 정규화하는 부분. 후자는 outSize²번 도는 순수 JS라 Hermes에서 무겁고,
  // 전자와 성격이 완전히 달라서(네이티브 vs 인터프리터) 갈라 재야 어디를 고칠지가 보인다.
  return span(`전처리 ${outSize}px`, () =>
    withOffscreen(image, src, outSize, outSize, (pixels) =>
      span('정규화 루프(JS)', () => {
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
      }),
    ),
  );
}

/**
 * 오프스크린 서피스에 src를 그려 픽셀을 읽고 consume에 넘긴다.
 * 서피스와 스냅샷은 성공하든 실패하든 반드시 해제된다 (위 withSkImage 주석 참고).
 */
function withOffscreen<T>(
  image: SkImage,
  src: CropRect,
  outW: number,
  outH: number,
  consume: (pixels: Uint8Array) => T,
): T {
  const surface = Skia.Surface.MakeOffscreen(outW, outH);
  if (!surface) throw new Error('오프스크린 서피스를 만들지 못했어요 (Skia 네이티브 메모리 부족일 수 있어요)');

  let snapshot: SkImage | null = null;
  try {
    const canvas = surface.getCanvas();
    if (src.rotation) {
      /*
        기울기를 되돌려 잘라낸다. 변환을 목적지 쪽부터 읽으면 이렇다:
        출력 한가운데로 옮기고 → -rotation만큼 돌리고 → 출력 크기에 맞춰 늘리고 →
        잘라낼 자리의 중심이 원점에 오도록 원본을 민다.

        돌린 사각형의 네 귀퉁이가 사진 밖으로 나갈 수 있으므로 먼저 검게 채운다 — 채우지 않으면
        그 자리에 서피스의 초기값이 그대로 남아 무엇이 들어갈지 보증할 수 없다.
      */
      canvas.clear(Skia.Color('black'));
      canvas.save();
      canvas.translate(outW / 2, outH / 2);
      canvas.rotate((-src.rotation * 180) / Math.PI, 0, 0);
      canvas.scale(outW / src.width, outH / src.height);
      canvas.translate(-(src.x + src.width / 2), -(src.y + src.height / 2));
      canvas.drawImage(image, 0, 0, Skia.Paint());
      canvas.restore();
    } else {
      canvas.drawImageRect(image, src, { x: 0, y: 0, width: outW, height: outH }, Skia.Paint());
    }
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
