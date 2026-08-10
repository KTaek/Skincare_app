import { Skia, ColorType, AlphaType, ImageFormat, type SkImage } from '@shopify/react-native-skia';

/**
 * 분할 마스크를 사진 위에 겹쳐 그린 그림 한 장을 만든다 (data URI).
 *
 * 왜 앱에서 합성해 내려주는가: seg 입력은 원본을 정사각형으로 눌러 리사이즈한 것이라
 * 마스크(512×512)와 원본의 종횡비가 다르다. 화면에서 사진과 마스크를 각각 <Image>로 올리면
 * RN의 resizeMode(cover는 잘라내고 contain은 여백을 넣는다)가 둘을 서로 다르게 배치해
 * 마스크가 실제 병변에서 어긋난다. 픽셀 단계에서 미리 겹쳐 버리면 화면이 이 사진을 어떻게
 * 늘리든 병변과 색칠이 같이 움직인다.
 *
 * 그림은 두 겹이다:
 *   · 반투명한 면 — 어디가 병변인지 한눈에 보여준다. 판정 단위마다 색이 달라서, 병변별 카드의
 *     색 칩과 눈으로 맞출 수 있다.
 *   · 불투명한 흰 테두리(+얇은 어두운 선) — 홍반처럼 원래 붉은 피부 위에서는 붉은 면이
 *     배경에 묻혀 경계가 사라진다. 색만으로는 안 되니 선을 얹어 모양을 살린다. 흰 선 양옆에
 *     어두운 선을 한 겹 두르는 이유는 그 반대 경우 — 하얗게 날아간 피부나 밝은 배경 위에서
 *     흰 선이 사라지는 것 — 을 막기 위해서다.
 *     테두리는 판정 단위와 무관하게 항상 흰색이다 — 판정 단위를 색으로 구분하려고 이 선의
 *     색을 건드리면, 정작 선을 넣은 이유(어떤 피부색 위에서도 경계가 보이게)가 무너진다.
 *
 * 결과 이미지는 원본 종횡비를 유지하되 긴 변을 MAX_SIDE로 줄인다 — 사진 카드에서 130px로
 * 보이는 그림에 수백만 화소를 base64로 들고 다닐 이유가 없다.
 */

/** 합성 결과의 긴 변 최대 길이 — 결과 화면의 사진 카드 크기에 비하면 이미 충분히 크다 */
const MAX_SIDE = 768;
/**
 * 판정 단위(region)별 색. 화면의 병변별 카드가 같은 색을 칩으로 쓰므로, 사용자가 사진의 색과
 * 카드의 줄을 눈으로 맞출 수 있다 — 그래서 이 배열이 두 곳의 유일한 출처다.
 * 0번은 예전부터 쓰던 붉은색(theme의 sev3)이라, 판정 단위가 하나면 화면이 전과 같아 보인다.
 */
export const REGION_COLORS = ['#EB5757', '#2F80ED', '#F2C94C'] as const;
/** 너무 작아 등급을 매기지 않은 덩어리 — 색을 빼서 "판정에서 빠졌다"를 색으로 말한다 */
export const EXCLUDED_COLOR = '#9AA0A6';
/** 색칠의 불투명도 — 병변의 결이 밑에서 보일 만큼은 남긴다 */
const OVERLAY_ALPHA = 0.45;
/** 테두리 색과 그 바깥을 감싸는 어두운 색 — 둘 다 불투명하게 얹는다 */
const LINE_RGB = [255, 255, 255] as const;
const LINE_EDGE_RGB = [28, 28, 30] as const;
/**
 * 테두리 두께 (마스크 격자 픽셀, 경계에서 안팎 양쪽으로). 화면의 사진 카드는 130px인데
 * 이 그림은 768px이라 5~6배 줄어든다 — 1px로 그리면 그 축소에서 통째로 사라진다.
 */
const LINE_R = 2;
const LINE_EDGE_R = 1;
const JPEG_QUALITY = 85;

/**
 * @param image     원본 사진 (호출부가 소유·해제한다)
 * @param mask      maskSize×maskSize 확률 마스크
 * @param threshold 이 값을 넘는 픽셀만 칠한다 (bbox·면적 계산과 같은 임계값을 써야 한다)
 * @param regionOf  픽셀 → 판정 단위 번호 (-1은 판정에서 제외된 덩어리). null이면 전부 0번 색.
 * @returns `data:image/jpeg;base64,...` — 만들지 못하면 null
 */
export function renderMaskOverlay(
  image: SkImage,
  mask: Float32Array,
  maskSize: number,
  threshold: number,
  regionOf: Int32Array | null = null,
): string | null {
  const origW = image.width();
  const origH = image.height();
  const scale = Math.min(1, MAX_SIDE / Math.max(origW, origH));
  const outW = Math.max(1, Math.round(origW * scale));
  const outH = Math.max(1, Math.round(origH * scale));

  const on = binarize(mask, maskSize, threshold);

  // 두 겹 모두 flush가 끝날 때까지 살려 둔다 — 오프스크린 서피스는 GPU 백엔드일 수 있고,
  // 그때 draw는 기록만 되므로 flush 전에 해제하면 무엇을 그렸는지 보증할 수 없다.
  const fill = makeMaskImage(fillBitmap(on, maskSize, regionOf), maskSize);
  const line = makeMaskImage(outlineBitmap(on, maskSize), maskSize);
  try {
    if (!fill || !line) return null;

    const surface = Skia.Surface.MakeOffscreen(outW, outH);
    if (!surface) return null;

    const dest = { x: 0, y: 0, width: outW, height: outH };
    const maskSrc = { x: 0, y: 0, width: maskSize, height: maskSize };

    let snapshot: SkImage | null = null;
    try {
      const canvas = surface.getCanvas();
      canvas.drawImageRect(image, { x: 0, y: 0, width: origW, height: origH }, dest, Skia.Paint());

      // 마스크 전체를 사진 전체에 맞춰 늘린다 — seg 입력이 그 반대 방향의 같은 변환이었다.
      // 면은 paint 알파로 투명하게, 테두리는 그 위에 불투명하게 얹는다.
      const fillPaint = Skia.Paint();
      fillPaint.setAlphaf(OVERLAY_ALPHA);
      canvas.drawImageRect(fill.image, maskSrc, dest, fillPaint);
      canvas.drawImageRect(line.image, maskSrc, dest, Skia.Paint());
      surface.flush();

      snapshot = surface.makeImageSnapshot();
      // 합성 결과는 불투명하므로 JPEG로 충분하다 (PNG는 같은 그림에 몇 배 크기가 된다)
      const base64 = snapshot.encodeToBase64(ImageFormat.JPEG, JPEG_QUALITY);
      return base64 ? `data:image/jpeg;base64,${base64}` : null;
    } finally {
      snapshot?.dispose();
      surface.dispose();
    }
  } finally {
    fill?.dispose();
    line?.dispose();
  }
}

/** 확률 마스크 → 0/1 배열. 이후 단계(면·테두리)가 같은 판정을 공유해야 한다 */
function binarize(mask: Float32Array, maskSize: number, threshold: number): Uint8Array {
  const pixelCount = maskSize * maskSize;
  const on = new Uint8Array(pixelCount);
  const n = Math.min(mask.length, pixelCount);
  for (let i = 0; i < n; i++) on[i] = mask[i] > threshold ? 1 : 0;
  return on;
}

/**
 * 칠하지 않는 픽셀은 alpha=0으로 두고 RGB도 0으로 맞춘다 — 그래야 프리멀티플라이 해석이
 * 어느 쪽이든 같은 그림이 된다. 칠하는 픽셀도 alpha는 255만 쓰고, 반투명은 paint 알파로 준다.
 */
function fillBitmap(on: Uint8Array, maskSize: number, regionOf: Int32Array | null): Uint8Array {
  const rgba = new Uint8Array(maskSize * maskSize * 4);
  for (let i = 0; i < on.length; i++) {
    if (!on[i]) continue;
    const region = regionOf ? regionOf[i] : 0;
    // 판정 단위가 색 개수를 넘으면 색을 돌려 쓴다. 단위 수 상한(maxRegions)이 색 개수와 같으면
    // 실제로는 돌지 않지만, 상한만 올리고 색을 잊는 일을 막아 둔다.
    const c = region >= 0 ? REGION_RGB[region % REGION_RGB.length] : EXCLUDED_RGB;
    const o = i * 4;
    rgba[o] = c[0];
    rgba[o + 1] = c[1];
    rgba[o + 2] = c[2];
    rgba[o + 3] = 255;
  }
  return rgba;
}

/** '#RRGGBB' → [r,g,b]. 색 정의를 화면과 한 곳에서 공유하려고 문자열로 두고 여기서 푼다. */
function toRgb(hex: string): readonly [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const REGION_RGB = REGION_COLORS.map(toRgb);
const EXCLUDED_RGB = toRgb(EXCLUDED_COLOR);

/**
 * 마스크 경계선 비트맵.
 *
 * 경계 픽셀(마스크 안쪽이면서 4-이웃 중 하나가 바깥인 픽셀)을 찾아 체비쇼프 거리로 부풀린다.
 * 이미지 밖은 바깥으로 취급한다 — 병변이 사진 밖으로 이어지면 사진 가장자리가 곧 경계다.
 * 거리에 따라 안쪽은 흰 선, 그 바깥 한 겹은 어두운 선이 된다.
 */
function outlineBitmap(on: Uint8Array, maskSize: number): Uint8Array {
  const R = LINE_R + LINE_EDGE_R;
  const dist = new Uint8Array(maskSize * maskSize).fill(255);

  for (let y = 0; y < maskSize; y++) {
    const row = y * maskSize;
    for (let x = 0; x < maskSize; x++) {
      const i = row + x;
      if (!on[i]) continue;
      const inside =
        x > 0 && on[i - 1] &&
        x < maskSize - 1 && on[i + 1] &&
        y > 0 && on[i - maskSize] &&
        y < maskSize - 1 && on[i + maskSize];
      if (inside) continue;

      // 경계 픽셀 하나를 중심으로 R 반경을 도장 찍듯 채운다 (가장 가까운 경계까지의 거리만 남긴다)
      const y0 = Math.max(0, y - R);
      const y1 = Math.min(maskSize - 1, y + R);
      const x0 = Math.max(0, x - R);
      const x1 = Math.min(maskSize - 1, x + R);
      for (let ny = y0; ny <= y1; ny++) {
        const dy = Math.abs(ny - y);
        const nrow = ny * maskSize;
        for (let nx = x0; nx <= x1; nx++) {
          const d = Math.max(dy, Math.abs(nx - x));
          const j = nrow + nx;
          if (d < dist[j]) dist[j] = d;
        }
      }
    }
  }

  const rgba = new Uint8Array(maskSize * maskSize * 4);
  for (let i = 0; i < dist.length; i++) {
    const d = dist[i];
    if (d > R) continue;
    const c = d <= LINE_R ? LINE_RGB : LINE_EDGE_RGB;
    const o = i * 4;
    rgba[o] = c[0];
    rgba[o + 1] = c[1];
    rgba[o + 2] = c[2];
    rgba[o + 3] = 255;
  }
  return rgba;
}

/**
 * RGBA 바이트 → SkImage. Image와 그 바탕 Data의 수명이 같이 가야 하므로 해제를 한 곳에 묶었다.
 * 호출부는 그리기가 flush될 때까지 들고 있다가 dispose()를 부른다.
 */
function makeMaskImage(
  rgba: Uint8Array,
  maskSize: number,
): { image: SkImage; dispose: () => void } | null {
  const data = Skia.Data.fromBytes(rgba);
  const image = Skia.Image.MakeImage(
    {
      width: maskSize,
      height: maskSize,
      colorType: ColorType.RGBA_8888,
      alphaType: AlphaType.Unpremul,
    },
    data,
    maskSize * 4,
  );
  if (!image) {
    data.dispose();
    return null;
  }
  return {
    image,
    dispose: () => {
      image.dispose();
      data.dispose();
    },
  };
}
