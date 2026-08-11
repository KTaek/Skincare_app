import type { SkImage } from '@shopify/react-native-skia';
import { readResizedRGBA } from '../ai/skiaPixels';
import { estimateSkin, SKIN_GATE, type SkinBox } from './skinMask';
import {
  alignTargetFor,
  coverageOf,
  evaluateAlign,
  roiOf,
  SCALE_SPEC,
  type AlignEvaluation,
  type ScaleFrame,
  type ScaleFraming,
  type PoseReference,
  type ScaleRoi,
} from '../ai/scaleFrame';
import {
  AreaEligibility,
  AreaRejectCode,
  Baseline,
  FrameEvaluation,
  HardGateKey,
  ImageQualityMetrics,
} from './types';

/**
 * 촬영을 **막는** 유일한 조건 — 명백한 오촬영만 본다.
 *
 * 예전에는 품질 조건 셋(피부·초점·노출)이 전부 참이어야 자동 셔터가 열렸고, 얼굴 자리에서는
 * 정렬 넷이 더 붙었다. 하나하나는 타당했지만 **한 순간에 동시에** 참일 것을 요구하는 구조가
 * 문제였다: 각 조건이 80%씩 통과해도 아홉 개를 곱하면 한 틱당 13%가 되고, 그 위에 권장 점수
 * 하한이 하나 더 있었다. 실기기에서 자동 촬영이 사실상 열리지 않은 것은 임계값이 아니라 이
 * 곱셈 때문이었다.
 *
 * 그래서 역할을 갈랐다. 여기 남은 셋은 "이건 피부 사진이 아니다"에 해당하는 것뿐이고,
 * 나머지는 전부 점수로 내려갔다 — 촬영을 막는 대신 **어느 프레임을 채택할지**를 정하고,
 * 낮은 품질은 신뢰도에 그대로 기록된다.
 *
 * 되돌릴 수 없는 것(초점)을 왜 여기 두지 않는가: 흐린 것은 분명 못 고치지만, 흐리다고 촬영을
 * 막으면 **아무것도 남지 않는다.** 흐린 기록 한 장은 나중에 다시 찍으면 되고 신뢰도가 그 사실을
 * 말해 주지만, 셔터가 안 열린 사용자는 앱이 고장 났다고 판단하고 떠난다. 여기 남긴 하한은
 * "렌즈가 가려졌다" 수준이다.
 */
export const SAFETY = {
  /** 이 아래면 피부를 찍은 사진이 아니다 (책상·벽·천장) */
  skinMin: 0.2,
  /** 렌즈가 가려졌거나 완전히 초점이 나간 수준 */
  sharpnessMin: 0.02,
  /** 사실상 암흑 — 이 사진에는 아무 정보도 없다 */
  shadowClipMax: 0.6,
} as const;

/**
 * 품질 점수의 기준값.
 *
 * ⚠️ **이 값들은 더 이상 촬영을 막지 않는다.** 화면 막대의 만점 기준이자 신뢰도 점수의
 * 자(尺)이고, 자동 셔터에서는 "여러 후보 중 어느 것이 나은가"를 가르는 데만 쓰인다.
 * 촬영을 막는 것은 위 SAFETY뿐이다.
 *
 * 뺀 것과 이유:
 *   · 거리·각도 정합 — 면적 측정을 걷어내면서 "지난번과 같은 배율"을 지킬 이유가 사라졌다.
 *   · 구도(framing) — 병변 세그의 bbox 크기·위치를 기준으로 삼고 있었는데,
 *     ① 정상 피부만 찍으면 검출되는 병변이 없어 영영 통과할 수 없고,
 *     ② 병변이 작아지면(= 좋아지면) bbox가 줄어 게이트에 걸린다 — 호전을 촬영 실패로 취급한다.
 *     크기가 변하는 대상을 크기 기준으로 쓸 수는 없다.
 *
 * 그 결과 이 파일의 판정은 **어떤 모델에도 의존하지 않는다**. 프레임 픽셀만 보면 되므로
 * 촬영 루프에서 세그 추론이 통째로 빠졌다.
 */
export const GATE = {
  /**
   * 정규화 선명도(lapVar/grayVar) 하한. 대비로 나눈 값이라 매끈한 피부에서도 통한다.
   *
   * ⚠️ 이 두 값은 아직 캘리브레이션되지 않은 초기값이다. 지표를 바꿨으므로 예전 라플라시안
   *    절대값(45/140)과는 아무 관계가 없다. 실기기에서 흐린 샷·선명한 샷을 각 20장씩 찍어
   *    두 분포가 갈리는 지점으로 다시 잡을 것.
   *    일부러 낮게 잡아 뒀다 — 너무 높으면 자동 셔터가 영영 안 열려 앱이 고장 난 것처럼 보이는데,
   *    그건 흐린 사진 몇 장이 통과하는 것보다 훨씬 나쁜 실패다 (통과해도 신뢰도 점수가 깎인다).
   */
  focusMin: 0.06,
  /** 이 값 이상이면 초점 점수 만점 */
  focusGood: 0.3,
  /**
   * 직전 프레임과의 상관도 — "충분히 멈춰 있다"의 기준.
   *
   * 선명도만으로는 "사용자가 가만히 있는가"를 알 수 없다 — takePictureAsync는 실제 정지 촬영이라
   * 밝은 곳에서는 셔터가 짧아 흔들리는 손도 또렷하게 찍힌다. 정지 여부는 애초에 한 장으로는
   * 판정할 수 없는, 프레임 사이에만 존재하는 정보다.
   *
   * 16×16으로 뭉갠 지문을 쓰므로 손떨림 정도의 미세한 흔들림에는 둔감하고,
   * 피사체가 바뀌는 수준의 움직임에만 반응한다. 합성 장면으로 잰 상관도 대응표:
   *
   *   프레임 폭의 1~3% 이동 → 0.99   (손떨림)
   *   6% 이동              → 0.97
   *   12% 이동             → 0.90
   *   손이 화면을 가로지름  → 0.24~0.63
   *
   * ⚠️ **이 값은 더 이상 셔터를 막지 않는다** (soft.stability의 만점 기준으로만 쓴다).
   *    막던 시절의 실패 방식이 이랬다: 비교 대상이 0.9초 전 프레임이라, 근접 촬영에서 손이
   *    그 시간 동안 화면 폭 8% 안에 머무는 일이 드물어 셔터가 계속 닫혀 있었다. 틱 주기를
   *    절반으로 줄이면서(MonitorCaptureScreen의 TICK_MS) 같은 손떨림에도 값이 올라갔고,
   *    무엇보다 이제는 움직인 프레임이 차단되는 대신 후보 경쟁에서 지기만 한다.
   */
  stabilityMin: 0.95,
  /** RGB가 전부 날아간 픽셀(경면반사) 상한 */
  highlightClipMax: 0.03,
  /** 채널 하나라도 포화된 픽셀 상한 — 홍반 등급을 지키는 게이트 */
  channelClipMax: 0.02,
  shadowClipMax: 0.18,
  /** ↓ 여기부터는 권장 조건의 "만점 기준" */
  goodBrightnessDelta: 0.06,
  /** 피부 점유율 만점 기준 — 세그 모델 학습 분포(평균 94.5%) 근방 */
  goodSkinRatio: 0.9,
  /**
   * 자동 셔터가 처음에 노리는 점수. 넘기지 못하면 시간이 지나면서 이 목표가 내려간다
   * (MonitorCaptureScreen의 SHUTTER_TARGETS) — 고정 하한이 아니라 **출발점**이다.
   */
  autoShutterSoftScore: 0.7,
  /** 이 점수를 넘으면 더 좋은 프레임을 기다리지 않고 바로 확정 */
  excellentSoftScore: 0.88,
  /**
   * 면적을 회차 간 비교하려 할 때만 요구하는 밝기 차 상한 (기준 세션 대비).
   *
   * 평소에는 밝기가 권장 조건(soft)이다 — 조명 보정이 게인으로 흡수하고, 등급 판정은 그 정도
   * 차이를 견딘다. 면적은 사정이 다르다: 밝기가 달라지면 세그 마스크의 경계가 통째로 밀려서
   * 병변이 커지거나 작아진 것처럼 보인다. 그 오차는 보정으로 되돌릴 수 없다.
   *
   * 부위마다 다르게 두는 이유는 **변화 문턱이 다르기 때문**이다. 몸통은 자 자체의 잡음이 커서
   * 문턱이 ±44%(얼굴 ±30%)인데, 조명 조건만 얼굴과 똑같이 조이면 통과하지 못하는 사진만 늘고
   * 얻는 것은 이미 문턱에 덮인 정밀도다. 실내 조명이 회차마다 조금씩 다른 것은 정상이다.
   */
  areaBrightnessDelta: 0.1,
  areaBrightnessDeltaTorso: 0.18,
  /**
   * 넓이를 재기 위해 부위가 분석 영역에 담겨야 하는 최소 비율 (coverageOf).
   *
   * 예전에는 이것이 예/아니오였다(roiFits) — 여백까지 포함한 3s 사각형이 사진에 통째로
   * 들어와야 했다. 그 기준에서는 **얼굴을 가득 채워 찍은 사진이 거의 전부 탈락한다.** 아이
   * 얼굴을 가까이서 찍으면 이마 위나 귀 바깥이 조금 잘리는 것이 정상인데, 실제로 잘린 것은
   * 머리카락과 배경이고 병변이 있는 볼은 멀쩡히 다 나와 있다.
   *
   * 0.92는 "얼굴의 8%까지는 없어도 잰다"는 뜻이다. 그 8%가 통째로 병변이었다면 지수가 그만큼
   * 낮게 나오지만, **회차마다 비슷한 비율로 잘린다면 그 오차는 변화율에서 상쇄된다** — 그래서
   * 절대 하한과 아래 회차 간 차이를 함께 본다. 한쪽만으로는 부족하다.
   *
   * ⚠️ 캘리브레이션 대상. 실제 근접 촬영 사진들의 covered 분포를 보고 다시 잡을 것 —
   *    측정 자격에서 빠질 때마다 개발 콘솔에 실제 값이 찍힌다.
   */
  areaCoveredMin: 0.92,
  /**
   * 기준 회차와 담긴 정도가 이만큼 넘게 다르면 넓이를 견주지 않는다.
   *
   * 절대량보다 이쪽이 실질적으로 더 중요하다. 매번 얼굴의 94%만 담겨도 추이는 성립하지만,
   * 100%였다가 85%가 되면 병변이 그대로여도 지수가 15% 내려간다 — 얼굴의 변화 문턱(±30%)의
   * 절반을 촬영 방식만으로 써 버리는 셈이다.
   */
  areaCoveredDelta: 0.06,
  /**
   * 기준 회차와 촬영 배율이 이만큼 넘게 다르면 넓이를 견주지 않는다 (몸통 전용).
   *
   * 얼굴에는 없는 조건이다. 얼굴은 넓이를 자로 나누는 순간 배율이 계산에서 사라지지만, 몸통의
   * 자는 사람 전체를 보는 랜드마크 모델에서 나와 프레이밍을 탄다 — 배율 폭을 ±16%로 두고 잰
   * areaRef 퍼짐이 32.2%, ±3%로 조이면 11.7%였다(poseDetector 실측).
   *
   * **표준 구도가 아니라 기준 회차와 견주는 것이 핵심이다.** 사용자가 등을 찍는 구도는 어깨너비가
   * 화면의 0.49~0.75까지 퍼져 있어서 어느 표준을 정해도 대부분이 벗어난다. 그런데 매번 같은
   * 거리에서 찍기만 하면 그 편향은 회차마다 같아서 변화율에서 상쇄된다 — 문제는 벗어남이 아니라
   * **달라짐**이다.
   */
  areaScaleLn: 0.16,
} as const;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** 선명도를 재는 중앙 정사각형의 크기 (짧은 변 대비) */
const FOCUS_ROI = 0.5;
/** 정지 판정용 지문의 한 변. 거칠게 뭉개야 손떨림에 둔감하고 실제 움직임에만 반응한다 */
const SIG_SIZE = 16;
/** 정지 막대의 0점. 상관도는 0.8 아래로 내려가면 어차피 "크게 움직이는 중"이라 구분할 실익이 없다 */
const STABILITY_FLOOR = 0.8;

/**
 * 프레임의 선명도·노출·피부 점유율을 잰다. 어떤 모델도 부르지 않는다.
 *
 * 지표마다 봐야 할 영역이 다르므로 표본을 두 번 뜬다:
 *
 *   · 노출·피부·밝기 → **분석에 들어갈 영역**. 보통은 프레임 전체다(질환 분류 모델이 크롭 없이
 *     프레임을 통째로 먹으므로, 가운데만 재면 "가운데는 피부, 주변은 카펫"인 프레임을 통과시킨다).
 *     얼굴 자리에서는 roi로 얼굴 관심영역이 들어온다 — 그때 분석에 실제로 들어가는 것이 그
 *     영역이고, 배경 창문이 하얗게 날아갔다고 촬영을 막을 이유가 없기 때문이다.
 *   · 선명도 → **가운데 고정 정사각형**. 한때 병변 bbox를 관심영역으로 썼지만, 병변 크기는
 *     세션마다 변하는 값이라 관심영역까지 같이 변해 선명도를 세션 간 비교할 수 없게 된다.
 *     정상 피부만 찍은 사진에는 bbox가 아예 없기도 하다. 고정 영역이라야 기준이 선다.
 *
 * 정지 판정용 지문(signature)만은 roi가 있어도 **항상 프레임 전체**에서 뜬다. 관심영역은 얼굴을
 * 따라 움직이므로, 그 안에서 지문을 뜨면 폰과 얼굴이 함께 움직일 때 "멈춰 있다"고 오판한다.
 */
export function measureImageQuality(
  image: SkImage,
  opts: { sampleSize?: number; roi?: ScaleRoi } = {},
): ImageQualityMetrics {
  const sampleSize = opts.sampleSize ?? 160;
  const w = image.width();
  const h = image.height();

  // ── 프레임 전체 표본: 정지 판정용 지문 (+ roi가 없으면 나머지 지표도 여기서) ────
  const full = readResizedRGBA(image, { x: 0, y: 0, width: w, height: h }, sampleSize, sampleSize);
  const signature = signatureOf(full, sampleSize);

  // ── 분석 영역 표본: 노출·피부·밝기 ─────────────────────────────
  const region = opts.roi
    ? readResizedRGBA(image, opts.roi, sampleSize, sampleSize)
    : full;

  const skin = estimateSkin(region, sampleSize, sampleSize);

  /*
    노출과 밝기는 **피부가 모여 있는 창 안에서만** 잰다.

    프레임 전체로 재면 뒤쪽 창문 하나로 채널 포화가 2%를 넘어 노출 판정이 깨지는데, 정작
    재려는 것은 피부의 노출이다 — 배경이 하얗게 날아간 것은 병변의 붉기를 읽는 데 아무 영향이
    없다. 실기기에서 노출 경고가 늘 붙어 있던 원인의 상당 부분이 이것이었다.

    피부 픽셀만 골라 세지 않고 **상자**를 쓰는 이유가 있다. 피부색 규칙은 완전히 날아간 픽셀
    (RGB가 모두 255)을 애초에 피부로 치지 않는다 — 밝기 상한에 걸려서다. 그러니 피부 픽셀만
    세면 경면반사는 정의상 언제나 0이 되어, 하필 가장 잡고 싶은 현상이 통째로 보이지 않는다.
    상자를 쓰면 피부 위의 번들거림은 안에 들어오고 배경의 창문은 밖에 남는다.

    피부를 못 찾았으면 예전처럼 영역 전체를 잰다 — 좁힐 근거가 없을 때 좁히면 그게 더 위험하다.
  */
  const win = windowOf(skin.box, sampleSize);
  let sumY = 0;
  let specular = 0;
  let shadow = 0;
  let clipR = 0;
  let clipG = 0;
  let clipB = 0;
  let count = 0;

  for (let y = win.y0; y <= win.y1; y++) {
    const row = y * sampleSize;
    for (let x = win.x0; x <= win.x1; x++) {
      const i = (row + x) * 4;
      const r = region[i];
      const g = region[i + 1];
      const b = region[i + 2];

      // 채널별 포화 — 하나라도 255에 붙으면 그 채널의 정보는 사라진 것이다
      if (r >= 250) clipR += 1;
      if (g >= 250) clipG += 1;
      if (b >= 250) clipB += 1;
      // RGB가 동시에 날아간 것은 색 포화가 아니라 경면반사(번들거림)다
      if (r >= 250 && g >= 250 && b >= 250) specular += 1;

      const yy = 0.299 * r + 0.587 * g + 0.114 * b;
      sumY += yy;
      if (yy <= 8) shadow += 1;
      count += 1;
    }
  }
  const m = count || 1;

  return {
    // 선명도만은 창을 쓰지 않는다 — 고정 영역이라야 세션 간 비교가 성립하고,
    // 피부 상자는 회차마다 자리와 크기가 달라진다
    sharpness: measureSharpness(image, sampleSize, opts.roi),
    highlightClip: specular / m,
    channelClip: Math.max(clipR, clipG, clipB) / m,
    shadowClip: shadow / m,
    brightness: sumY / m / 255,
    skinRatio: skin.ratio,
    skinSource: skin.source,
    skinMedians: skin.skinMedians,
    skinCount: skin.skinCount,
    signature,
  };
}

/** 피부 상자를 표본 격자의 정수 범위로 (없으면 격자 전체) */
function windowOf(box: SkinBox | null, sampleSize: number) {
  if (!box) return { x0: 0, y0: 0, x1: sampleSize - 1, y1: sampleSize - 1 };
  const clampIdx = (v: number) => Math.max(0, Math.min(sampleSize - 1, Math.round(v)));
  return {
    x0: clampIdx(box.x * sampleSize),
    y0: clampIdx(box.y * sampleSize),
    x1: clampIdx((box.x + box.width) * sampleSize - 1),
    y1: clampIdx((box.y + box.height) * sampleSize - 1),
  };
}

/** 프레임을 SIG_SIZE×SIG_SIZE 블록 평균으로 뭉갠 정지 판정용 지문 */
function signatureOf(px: Uint8Array, sampleSize: number): Float32Array {
  const block = sampleSize / SIG_SIZE;
  const sig = new Float32Array(SIG_SIZE * SIG_SIZE);
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    const y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    const sx = Math.min(SIG_SIZE - 1, ((p % sampleSize) / block) | 0);
    const sy = Math.min(SIG_SIZE - 1, (((p / sampleSize) | 0) / block) | 0);
    sig[sy * SIG_SIZE + sx] += y;
  }
  return normalizeSignature(sig);
}

/** 평균 0·크기 1로 맞춰, 두 지문의 내적이 곧 정규화 상관도가 되게 한다 */
function normalizeSignature(sig: Float32Array): Float32Array {
  let mean = 0;
  for (let i = 0; i < sig.length; i++) mean += sig[i];
  mean /= sig.length;

  let ss = 0;
  for (let i = 0; i < sig.length; i++) {
    sig[i] -= mean;
    ss += sig[i] * sig[i];
  }
  const norm = Math.sqrt(ss) || 1;
  for (let i = 0; i < sig.length; i++) sig[i] /= norm;
  return sig;
}

/** 두 지문의 상관도 (-1~1, 같을수록 1). 한쪽이 없으면 1 — 비교할 것이 없으면 막지 않는다 */
export function frameSimilarity(a?: Float32Array | null, b?: Float32Array | null): number {
  if (!a || !b || a.length !== b.length) return 1;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * 가운데 고정 영역의 정규화 선명도 = 라플라시안 분산 / 밝기 분산.
 *
 * 생 라플라시안 분산만 보면 "텍스처가 얼마나 많은가"를 재게 되어, 초점이 맞은 매끈한 피부가
 * 흐린 사진과 같은 값으로 나온다. 전체 대비로 나누면 — 흐릴 때는 고주파만 죽고 대비는 남으므로 —
 * 콘텐츠 의존성이 줄어 baseline 없이도 절대 임계값을 쓸 수 있다.
 *
 * roi가 있으면 그 안의 가운데를 잰다. 얼굴 촬영에서 화면 정중앙은 코끝인데, 초점이 맞아야 하는
 * 것은 피부 전체이고 배경이 섞여 들면 값이 흔들린다 — 관심영역 안에서 재야 기준이 같아진다.
 */
function measureSharpness(image: SkImage, sampleSize: number, roi?: ScaleRoi): number {
  const rx = roi?.x ?? 0;
  const ry = roi?.y ?? 0;
  const w = roi?.width ?? image.width();
  const h = roi?.height ?? image.height();
  const side = Math.min(w, h) * FOCUS_ROI;
  const src = { x: rx + (w - side) / 2, y: ry + (h - side) / 2, width: side, height: side };

  const px = readResizedRGBA(image, src, sampleSize, sampleSize);
  const gray = new Float32Array(sampleSize * sampleSize);
  let sumY = 0;
  let sumYSq = 0;
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    const y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    gray[p] = y;
    sumY += y;
    sumYSq += y * y;
  }

  let lapSum = 0;
  let lapSqSum = 0;
  let count = 0;
  for (let y = 1; y < sampleSize - 1; y++) {
    const row = y * sampleSize;
    for (let x = 1; x < sampleSize - 1; x++) {
      const i = row + x;
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - sampleSize] - gray[i + sampleSize];
      lapSum += lap;
      lapSqSum += lap * lap;
      count += 1;
    }
  }
  if (count === 0) return 0;

  const n = sampleSize * sampleSize;
  const lapVar = lapSqSum / count - (lapSum / count) ** 2;
  const grayVar = Math.max(sumYSq / n - (sumY / n) ** 2, 1);
  return lapVar / grayVar;
}

/** 넓이를 재는 자리(얼굴·몸통)에서만 넘어오는 정렬 판정 재료 */
export interface ScaleContext {
  /** 이 자리가 무엇을 자로 쓰는지 — 게이트 임계값이 여기에 따라 달라진다 (SCALE_SPEC) */
  kind: ScaleFrame['kind'];
  frame: ScaleFrame | null;
  imageWidth: number;
  imageHeight: number;
  /**
   * 화면에 깔린 지난 사진의 구도 — 이번 촬영이 맞춰야 할 목표.
   * 없으면(첫 촬영) 고정 표준 프레이밍으로 유도한다.
   */
  framing?: ScaleFraming;
  /** 자세(d/v) 비교 기준 — 첫 촬영이면 없다 (그때는 비대칭만으로 정면성을 본다) */
  reference?: PoseReference;
}

/**
 * 안전 조건 → 촬영 가능 여부, 품질 조건 → 0~1 점수. 기준 세션이 없으면 밝기 항목은 만점 처리한다.
 *
 * **막는 것과 재는 것을 갈라 두었다.** safe는 셔터를 막고(명백한 오촬영만), hard·soft는 품질을
 * 잴 뿐 아무것도 막지 않는다. 예전에는 hard가 둘을 겸했는데, 그러면 "이 사진은 좋지 않다"가
 * 곧바로 "이 사진을 찍을 수 없다"가 되어 — 조건이 여럿이면 그 곱만큼 촬영이 어려워졌다.
 *
 * prevSignature를 주면 직전 프레임과의 상관도로 정지 여부를 함께 낸다. 이 값은 점수(soft)로만
 * 들어간다 — 움직인 프레임은 차단되는 것이 아니라 후보 경쟁에서 진다.
 *
 * scale을 주면(넓이를 재는 자리) 정렬 판정을 함께 낸다. 그 결과 역시 셔터를 막지 않는다 —
 * 면적 측정 자격(evaluateAreaEligibility)과 화면 안내에만 쓰인다.
 */
export function evaluateFrame(
  metrics: ImageQualityMetrics,
  baseline?: Baseline,
  prevSignature?: Float32Array | null,
  scale?: ScaleContext,
): FrameEvaluation {
  // 피부 기준값은 추정 출처를 따라간다 — 부정확한 추정기에 높은 기준을 걸면
  // 멀쩡한 사진의 점수를 부당하게 깎는다 (skinMask.ts의 SKIN_GATE 주석 참고)
  const skinMin = SKIN_GATE[metrics.skinSource];
  const stability = frameSimilarity(metrics.signature, prevSignature);

  /*
    셔터를 막는 유일한 조건. 여기 걸리는 프레임은 "덜 좋은 피부 사진"이 아니라 **피부 사진이
    아닌 것**이다 — 그걸 찍어 봐야 분석도 기록도 의미가 없으므로 이것만은 막는다.
  */
  const safe =
    metrics.skinRatio >= SAFETY.skinMin &&
    metrics.sharpness >= SAFETY.sharpnessMin &&
    metrics.shadowClip <= SAFETY.shadowClipMax;

  const hard: Record<HardGateKey, boolean> = {
    skin: metrics.skinRatio >= skinMin,
    // 정지 여부는 여기서 뺐다 — 한 순간의 흔들림으로 품질 전체를 실패로 만들 이유가 없고,
    // 그 정보는 soft.stability로 채택 기준에 이미 들어간다
    focus: metrics.sharpness >= GATE.focusMin,
    exposure:
      metrics.highlightClip <= GATE.highlightClipMax &&
      metrics.channelClip <= GATE.channelClipMax &&
      metrics.shadowClip <= GATE.shadowClipMax,
  };
  const hardPass = hard.skin && hard.focus && hard.exposure;

  // 막대로 보여줄 0~1 값. 통과선이 아니라 "만점 기준"에 대한 비율이라, 기준을 넘긴 뒤에도
  // 더 채우면 더 차오른다. 초점은 선명도와 정지 중 나쁜 쪽을 쓴다 — 막대가 지금 무엇에
  // 발목 잡혀 있는지를 보여줘야 하기 때문이다.
  const gauges: Record<HardGateKey, number> = {
    skin: clamp01(metrics.skinRatio / GATE.goodSkinRatio),
    focus: Math.min(
      clamp01(metrics.sharpness / GATE.focusGood),
      clamp01((stability - STABILITY_FLOOR) / (GATE.stabilityMin - STABILITY_FLOOR)),
    ),
    exposure: clamp01(
      1 -
        Math.max(
          metrics.highlightClip / GATE.highlightClipMax,
          metrics.channelClip / GATE.channelClipMax,
          metrics.shadowClip / GATE.shadowClipMax,
        ),
    ),
  };

  const soft = {
    sharpness: clamp01((metrics.sharpness - GATE.focusMin) / (GATE.focusGood - GATE.focusMin)),
    stability: clamp01((stability - STABILITY_FLOOR) / (GATE.stabilityMin - STABILITY_FLOOR)),
    skin: clamp01((metrics.skinRatio - skinMin) / Math.max(GATE.goodSkinRatio - skinMin, 1e-3)),
    brightness: baseline
      ? clamp01(1 - (Math.abs(metrics.brightness - baseline.brightness) - GATE.goodBrightnessDelta) / 0.2)
      : 1,
  };
  /*
    자동 셔터가 후보 중 한 장을 고르는 기준.

    되돌릴 수 없는 것(선명도·정지)에 무게의 6할을 싣는다 — 이 둘은 이제 셔터를 막지 않으므로,
    막는 대신 여기서 걸러야 한다. 흔들린 프레임과 멈춘 프레임이 같은 창 안에 있으면 멈춘 쪽이
    이기고, 흔들린 것밖에 없을 때만 그것이 채택된다. 조명은 후처리가 게인으로 흡수하므로 최소.
  */
  const softScore =
    soft.sharpness * 0.35 + soft.stability * 0.25 + soft.skin * 0.25 + soft.brightness * 0.15;

  const align = scaleAlign(scale);

  return {
    metrics,
    hard,
    hardPass,
    safe,
    stability,
    gauges,
    soft,
    softScore,
    align,
    scale: scale?.frame ?? null,
    frameSize: { width: scale?.imageWidth ?? 0, height: scale?.imageHeight ?? 0 },
    hint: buildHint(safe, hard, soft, metrics, stability, align, scale),
  };
}

/**
 * 얼굴을 못 찾았을 때의 정렬 판정 — 실패지만 "무엇이 나쁘다"가 아니라 "아직 못 봤다"이므로
 * 막대는 0으로 두고 안내만 다르게 준다.
 */
/** 자를 아예 못 찾았을 때의 정렬 판정 — 부위마다 문구가 다르다 */
const notFound = (kind: ScaleFrame['kind']): AlignEvaluation => ({
  ok: false,
  gauge: 0,
  fault: 'scale',
  hint:
    kind === 'face'
      ? '얼굴이 보이지 않아요 — 가이드 안으로 들어와주세요'
      : '몸통이 보이지 않아요 — 양 어깨가 화면에 들어오게 서주세요',
  scaleLn: 0,
  poseOk: false,
  poseRef: null,
});

function scaleAlign(scale?: ScaleContext): AlignEvaluation | null {
  if (!scale) return null;
  if (!scale.frame) return notFound(scale.kind);
  return evaluateAlign(
    scale.frame,
    alignTargetFor(scale.kind, scale.imageWidth, scale.imageHeight, scale.framing),
    scale.reference,
  );
}

/**
 * 이번 촬영의 넓이를 회차 간 비교에 써도 되는지.
 *
 * **정렬 통과 여부(align.ok)를 그대로 쓰지 않는다.** 정렬 항목 넷 중 배율·위치·기울기는 넓이를
 * d·v로 나누는 순간 계산에서 사라진다 — 얼굴이 화면 어디에 얼마나 크게 담겼든 몫은 같다.
 * 그 셋은 촬영을 안내하기 위한 것(해상도를 확보하고 얼굴이 잘리지 않게)이지 측정의 자격이 아니다.
 *
 * 그래서 측정을 실제로 망치는 것만 본다:
 *
 *   · 얼굴 — 없으면 나눌 자가 없다
 *   · 자세 — 고개를 돌리거나 숙이면 투영 자체가 바뀌고, 그건 되돌릴 수 없다
 *   · 해상도 — 배율은 사라져도 픽셀 수는 사라지지 않는다 (앨범 사진에서 주로 걸린다)
 *   · 조명 — 밝기가 다르면 마스크 경계가 통째로 밀려 병변이 커지거나 작아진 것처럼 보인다
 *
 * 이 구분 덕분에 **앨범에서 고른 사진도 넓이를 잴 수 있다.** 가이드를 볼 기회가 없었으니 구도는
 * 당연히 어긋나 있지만, 정면으로 찍혔고 얼굴이 충분히 크고 조명이 비슷하면 그 사진의 넓이는
 * 지난 회차와 견줄 자격이 있다. 구도를 이유로 버리면 멀쩡한 측정을 버리는 것이다.
 *
 * 자격이 없어도 사진과 등급은 그대로 기록한다 — 빠지는 것은 넓이 추세뿐이다.
 */
export function evaluateAreaEligibility(
  evaluation: FrameEvaluation,
  baseline?: Baseline,
  /**
   * quiet=true면 실패 사유를 콘솔에 남기지 않는다.
   *
   * 촬영 루프가 매 틱(0.45초)마다 "지금 찍으면 넓이까지 되는가"를 묻기 때문에 필요하다 —
   * 그대로 두면 자세를 잡는 몇 초 동안 같은 경고가 수십 줄 쌓여서, 정작 촬영이 확정될 때
   * 남는 **진짜 한 줄**이 그 안에 묻힌다. 기록으로 남는 판정만 로그를 남긴다.
   */
  opts: { quiet?: boolean } = {},
): AreaEligibility {
  const { width, height } = evaluation.frameSize;
  const frame = evaluation.scale;

  /*
    실패하면 잰 값을 함께 남긴다.

    사용자에게 보여주는 문구는 "무엇을 고쳐야 하는지"만 말해야 해서 숫자가 들어갈 자리가 없다.
    그런데 임계값들이 전부 아직 캘리브레이션 전이라, 실기기에서 왜 걸렸는지 숫자를 못 보면 고칠
    방향을 정할 수 없다. 개발 콘솔에만 남긴다.
  */
  /*
    담긴 정도는 실패했을 때도 남겨야 한다 — 기준 회차가 이 값을 들고 있어야 다음 회차와 견줄 수
    있고, 실기기에서 임계값을 다시 잡을 때 읽어야 할 숫자도 이것이다. 자를 못 찾은 촬영에서는
    잴 수 없으므로 undefined로 남는다.
  */
  let covered: number | undefined;
  /** 해상도가 낮아 값이 흔들릴 수 있는 촬영인지 — 제외 사유가 아니라 표시다 */
  let lowRes = false;

  const reject = (code: AreaRejectCode, reason: string, detail: Record<string, unknown>) => {
    if (!opts.quiet) {
      console.warn('[area] 넓이 측정 제외:', reason, {
        code,
        frame: `${Math.round(width)}×${Math.round(height)}`,
        ...detail,
      });
    }
    return { ok: false, reason, code, covered, lowRes };
  };

  if (!frame) {
    return reject('noFace', '기준이 되는 자리를 찾지 못해 넓이를 잴 수 없어요', { detected: false });
  }

  const spec = SCALE_SPEC[frame.kind];
  const noun = spec.noun;
  covered = coverageOf(frame, roiOf(frame, width, height));

  // 잰 값을 한자리에 모아 둔다 — 어느 검사에서 걸리든 같은 숫자를 함께 남기기 위해서다
  const seen = {
    kind: frame.kind,
    s: Math.round(frame.s),
    minS: spec.minScalePx,
    roiSide: Math.round(spec.roiSide * frame.s),
    asym: Math.round(frame.asym * 1000) / 1000,
    // 기준이 있으면 '자기 기준과의 차이', 없으면 느슨한 절대 상한을 본다
    refAsym: evaluation.align?.poseRef ?? null,
    maxAsym: evaluation.align?.poseRef == null ? spec.gate.asymAbs : spec.gate.asymDelta,
    brightness: Math.round(evaluation.metrics.brightness * 1000) / 1000,
    baseBrightness: baseline ? Math.round(baseline.brightness * 1000) / 1000 : null,
  };

  /*
    몸통에만 있는 검사다. 어깨나 골반이 화면 밖으로 나가도 랜드마크 모델은 그 자리를 **추정해서**
    값을 내므로, 좌표만 보면 언제나 자가 있는 것처럼 보인다. 그대로 쓰면 있지도 않은 어깨너비가
    기록된다.
  */
  /*
    몸통에만 있는 검사다. 어깨가 화면 밖으로 나가도 랜드마크 모델은 그 자리를 **추정해서** 값을
    내므로, 좌표만 보면 언제나 자가 있는 것처럼 보인다(torsoFrame이 visibility까지 함께 본다).
    골반은 더 이상 자에 들어가지 않으므로 요구하지 않는다.
  */
  if (!frame.complete) {
    return reject('partialBody', '양 어깨가 모두 나와야 몸통 크기를 잴 수 있어요', seen);
  }
  /*
    **해상도는 넓이 측정을 막지 않는다. 표시만 한다.**

    넓이 지수는 병변 픽셀 ÷ 자²라서, 해상도가 절반이 되면 분자와 분모가 함께 4분의 1이 되어
    **몫은 그대로다.** 해상도는 값을 틀리게 만들지 않는다 — 남는 영향은 마스크 경계의 양자화와
    아주 작은 병변이 뭉개져 사라지는 것뿐이고, 둘 다 방향이 정해진 편향이 아니라 잡음이다.

    다른 자격 조건들은 성격이 다르다: 부위가 잘리면 병변이 통째로 빠지고, 몸이 돌아가면 투영이
    바뀌며, 조명이 다르면 경계가 한쪽으로 밀린다. 전부 호전/악화로 읽히는 **편향**이라 재지
    않는 편이 낫다. 해상도를 그 무리에 넣어 둔 것이 잘못이었고, 대가로 웹이나 메신저를 거쳐
    줄어든 사진 — 화면을 가득 채웠는데도 원본이 400px대인 사진 — 이 통째로 탈락했다.
    "몸통이 너무 작게 찍혔다"는 말을 화면을 꽉 채운 사진에 대고 하고 있었던 것이다.

    바닥값도 두지 않는다. 정말로 못 잴 만큼 작으면 그 전에 자 검출이 먼저 실패한다 —
    검출이 성공했다는 것 자체가 잴 수 있다는 뜻이라, 여기서 한 번 더 막을 근거가 없다.
  */
  lowRes = frame.s < spec.minScalePx;
  if (lowRes) {
    console.warn('[area] 해상도가 낮아 넓이가 흔들릴 수 있어요 (측정은 그대로 합니다)', seen);
  }
  /*
    부위가 분석 영역에 얼마나 담겼는가.

    예전에는 여백까지 포함한 3s 사각형이 사진에 통째로 들어오는지를 예/아니오로 봤다(roiFits).
    그 기준에서는 **얼굴을 가득 채워 찍은 사진이 거의 전부 탈락한다** — 아이 얼굴을 가까이서
    찍으면 이마 위나 귀 바깥이 잘리는 것이 정상이고, 정작 잘린 것은 머리카락과 배경인데도
    "얼굴이 잘렸다"며 넓이를 통째로 뺐다.

    지금은 살 자체가 얼마나 들어왔는지를 연속값으로 재서 두 가지를 나눠 본다:
      · 절대량 — 세지 못한 병변이 지수를 크게 끌어내릴 만큼 없어졌는가
      · 회차 간 차이 — 이쪽이 실질적으로 더 중요하다. 매번 같은 비율로 잘리면 그 오차는
        변화율에서 상쇄되지만, 회차마다 다르면 그 차이가 그대로 호전/악화로 읽힌다.
  */
  const coveredSeen = { ...seen, covered: Math.round(covered * 1000) / 10 };

  if (covered < GATE.areaCoveredMin) {
    return reject('cropped', `${noun}의 상당 부분이 화면 밖이라 넓이를 다 셀 수 없어요`, {
      ...coveredSeen,
      minCovered: GATE.areaCoveredMin,
      // ROI가 화면보다 크면 "너무 가까이", 크기는 맞는데 안 들어오면 "치우침"이다
      cause:
        spec.roiSide * frame.s > Math.min(width, height)
          ? '너무 가까움 (ROI > 화면 짧은 변)'
          : '가장자리로 치우침',
      center: `${Math.round(frame.cx)},${Math.round(frame.cy)}`,
    });
  }

  const refCovered = baseline?.scale?.covered;
  if (refCovered != null && Math.abs(covered - refCovered) > GATE.areaCoveredDelta) {
    return reject('framingChanged', `지난번과 ${noun}이 담긴 정도가 달라 넓이 비교가 어려워요`, {
      ...coveredSeen,
      refCovered: Math.round(refCovered * 1000) / 10,
      maxDelta: GATE.areaCoveredDelta,
    });
  }

  /*
    촬영 배율이 기준 회차와 얼마나 다른가 — **몸통에만 건다.**

    얼굴은 넓이를 d·v로 나누는 순간 배율이 사라지므로 앨범에서 고른 사진도 거리를 따지지 않는다.
    몸통은 자를 내는 랜드마크 모델이 프레이밍을 타서 배율이 달라지면 자도 달라진다 — 그래서
    같은 몸인데 회차마다 다른 어깨너비가 기록되고, 그 차이가 그대로 호전/악화로 읽힌다.

    첫 촬영에는 걸리지 않는다(견줄 기준이 없다). 어떤 구도로 찍었든 그것이 기준이 되고,
    이후 회차가 거기에 맞추면 된다.
  */
  const refS = baseline?.scale?.sOfMinSide;
  if (frame.kind === 'torso' && refS != null && refS > 0) {
    const sOfMinSide = frame.s / Math.min(width, height);
    const scaleLn = Math.log(sOfMinSide / refS);
    if (Math.abs(scaleLn) > GATE.areaScaleLn) {
      return reject(
        'framingChanged',
        scaleLn > 0
          ? `지난번보다 가까이서 찍혀 넓이 비교가 어려워요`
          : `지난번보다 멀리서 찍혀 넓이 비교가 어려워요`,
        {
          ...coveredSeen,
          sOfMinSide: Math.round(sOfMinSide * 1000) / 1000,
          refSOfMinSide: Math.round(refS * 1000) / 1000,
          scaleLn: Math.round(scaleLn * 1000) / 1000,
          maxScaleLn: GATE.areaScaleLn,
        },
      );
    }
  }
  if (evaluation.align && !evaluation.align.poseOk) {
    return reject(
      'pose',
      frame.kind === 'face'
        ? '고개가 돌아가거나 숙여진 채로 찍혀서 넓이 비교가 어려워요'
        : '몸이 돌아갔거나 지난번과 다른 거리·위치에서 찍혀 넓이 비교가 어려워요',
      { ...seen, maxPoseLn: spec.gate.poseLn, ratio: Math.round(frame.ratio * 1000) / 1000 },
    );
  }
  const maxBrightnessDelta =
    frame.kind === 'torso' ? GATE.areaBrightnessDeltaTorso : GATE.areaBrightnessDelta;
  if (baseline && Math.abs(evaluation.metrics.brightness - baseline.brightness) > maxBrightnessDelta) {
    return reject('lighting', '조명이 지난번과 많이 달라 넓이 비교가 어려워요', {
      ...seen,
      maxDelta: maxBrightnessDelta,
    });
  }
  return { ok: true, covered, lowRes };
}

/**
 * 한 번에 하나씩만 말한다. 여러 개를 나열하면 사용자는 무엇부터 고쳐야 할지 모른다.
 * 순서는 "고치면 가장 많이 해결되는 것" 순 — 피부를 채우면 해상도도 함께 따라온다.
 *
 * 안내의 성격이 바뀌었다는 점이 중요하다. 예전에는 이 문구가 곧 **차단 사유**였다("이걸 고쳐야
 * 찍힙니다"). 지금은 조건과 무관하게 곧 찍히므로, 같은 문장이 **개선 제안**으로 읽혀야 한다.
 * 그래서 촬영이 막힌 것처럼 들리는 표현을 쓰지 않고, 지금 무엇을 하면 더 나은 한 장이 잡히는지만
 * 말한다. 유일한 예외가 safe 실패인데, 그때는 실제로 촬영이 열리지 않으므로 그 사실을 말한다.
 */
function buildHint(
  safe: boolean,
  hard: Record<HardGateKey, boolean>,
  soft: FrameEvaluation['soft'],
  metrics: ImageQualityMetrics,
  stability: number,
  align: AlignEvaluation | null,
  scale?: ScaleContext,
): string {
  // 촬영이 실제로 열리지 않는 유일한 경우 — 무엇이 문제인지 정확히 말해야 한다
  if (!safe) {
    if (metrics.shadowClip > SAFETY.shadowClipMax) return '너무 어두워요 — 밝은 곳으로 옮겨주세요';
    if (metrics.skinRatio < SAFETY.skinMin) return '피부가 보이지 않아요 — 촬영할 부위를 화면에 담아주세요';
    return '화면이 흐려요 — 렌즈가 가려졌는지 확인해주세요';
  }
  // 얼굴을 아직 못 찾았으면 다른 어떤 안내도 소용이 없다 — 화면에 얼굴부터 들어와야 한다
  if (scale && !scale.frame) return notFound(scale.kind).hint;
  if (!hard.skin) return '조금 더 가까이 — 화면을 피부로 채우면 더 정확해요';
  if (stability < GATE.stabilityMin) return '잠깐 멈춰주세요 — 멈춘 순간을 골라 찍어요';
  if (!hard.focus) return '초점이 흐려요 — 잠깐 멈춰서 초점을 맞춰주세요';
  if (!hard.exposure) {
    if (metrics.shadowClip > GATE.shadowClipMax) return '조금 더 밝은 곳이면 좋아요';
    return '빛이 반사돼요 — 각도를 살짝 바꿔주세요';
  }
  // 되돌릴 수 없는 것(초점·노출)을 먼저 해결한 뒤에 정렬을 말한다
  if (align && !align.ok) return align.hint;
  if (soft.skin < 0.5) return '조금만 더 가까이 가면 더 정확해요';
  return '좋아요 — 그대로 유지해주세요';
}
